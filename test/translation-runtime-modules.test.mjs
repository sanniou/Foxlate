// 从 `TranslatorManager` 里拆出来的四个部件的单元测试。
//
// 拆之前它们全是 550 行静态类的私有字段与方法：并发额度、在途去重、流水线准备
// 都只能通过打包整个 service worker + mock `browser` 全局才能触达。拆开之后
// 每一块都能直接实例化、直接驱动——这套测试就是那个收益的凭据。
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

// 打包时 browser-polyfill 会被换成读这个全局的转接层；这几个模块并不真正使用它。
globalThis.__foxlateBrowserMock ??= {};

let modulesPromise;
function modules() {
    modulesPromise ??= (async () => {
        const [scheduler, registry, pipeline] = await Promise.all([
            bundleModule(
                reexportSource('src/background/translation-task-scheduler.js', ['TranslationTaskScheduler']),
            ),
            bundleModule(
                reexportSource('src/background/in-flight-registry.js', ['InFlightRegistry']),
            ),
            bundleModule(
                reexportSource('src/background/translation-pipeline.js', ['TranslationPipeline', 'preProcess', 'postProcess']),
            ),
        ]);
        return { ...scheduler, ...registry, ...pipeline };
    })();
    return modulesPromise;
}

/**
 * 等待一个 promise 结算，超时就抛错。
 *
 * 不是为了“防偷懒”，而是因为本文件断言的正是「谁该结谁」：一旦那处回归，
 * 被等的那一方会永远不结，直接 await 会把整个测试进程吊死——
 * 看起来像“跑得慢”，而不是“跑红了”。限时失败才是可信的失败。
 */
async function settleWithin(promise, ms = 1000) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('等待结算超时：对方永远不会结算')), ms);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** 假的引擎解析器：只记录收到的入参，返回一个固定的解析结果。 */
function makePipeline({ TranslationPipeline }) {
    const calls = [];
    const engineResolver = {
        async resolveTranslatorForText(text, engine, log, settings) {
            calls.push({ text, engine, log, settings });
            return { engine: 'google', translator: { name: 'Google' }, config: { temperature: 0 } };
        },
    };
    return { pipeline: new TranslationPipeline({ engineResolver }), calls };
}

// ---------------------------------------------------------------- 调度器

test('调度器：并发额度是硬上限，超出的任务排队等待', async () => {
    const { TranslationTaskScheduler } = await modules();
    const scheduler = new TranslationTaskScheduler({ maxConcurrent: 2 });
    const started = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });

    const jobs = Array.from({ length: 5 }, (_, i) => scheduler.run(async () => {
        started.push(i);
        await gate;
        return i;
    }));

    assert.deepEqual(started, [0, 1], '第三个任务必须还在排队，不能越过额度');
    assert.equal(scheduler.activeCount, 2);
    assert.equal(scheduler.pendingCount, 3);

    release();
    assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4], '槽位腾出后按入队顺序推进');
    assert.equal(scheduler.activeCount, 0);
    assert.equal(scheduler.pendingCount, 0);
});

test('调度器：调大并发额度立即放行排队任务', async () => {
    const { TranslationTaskScheduler } = await modules();
    const scheduler = new TranslationTaskScheduler({ maxConcurrent: 1 });
    const started = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });

    const jobs = [0, 1, 2].map(i => scheduler.run(async () => {
        started.push(i);
        await gate;
    }));

    assert.deepEqual(started, [0]);
    assert.equal(scheduler.setMaxConcurrent(3), true);
    assert.deepEqual(started, [0, 1, 2], '提高额度必须把已经在排队的任务放出去');

    release();
    await Promise.all(jobs);
});

test('调度器：拒绝非法并发额度，保持原值', async () => {
    const { TranslationTaskScheduler } = await modules();
    const scheduler = new TranslationTaskScheduler({ maxConcurrent: 2 });

    for (const bad of [0, -1, Number.NaN, Infinity, '3', null, undefined]) {
        assert.equal(scheduler.setMaxConcurrent(bad), false, `${String(bad)} 不应被采纳`);
    }
    assert.equal(scheduler.maxConcurrent, 2);
});

test('调度器：单个任务失败不阻塞后续任务', async () => {
    const { TranslationTaskScheduler } = await modules();
    const scheduler = new TranslationTaskScheduler({ maxConcurrent: 1 });

    const failed = scheduler.run(async () => { throw new Error('boom'); })
        .catch(error => `err:${error.message}`);
    const followed = scheduler.run(async () => 'ok');

    assert.equal(await failed, 'err:boom');
    assert.equal(await followed, 'ok', '前一个任务失败不能把队列卡死');
    assert.equal(scheduler.activeCount, 0);
});

test('调度器：interruptAll 拒绝排队任务并中止在跑任务', async () => {
    const { TranslationTaskScheduler } = await modules();
    const scheduler = new TranslationTaskScheduler({ maxConcurrent: 1 });
    const observed = [];

    const running = scheduler.run(signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
            observed.push(signal.reason ?? 'aborted');
            reject(new DOMException('Translation was interrupted by the user.', 'AbortError'));
        });
    }));
    const queued = scheduler.run(async () => 'never');

    // 两个都先接住拒绝，否则会报 unhandled rejection
    const runningOutcome = running.then(() => 'resolved', error => error.name);
    const queuedOutcome = queued.then(() => 'resolved', error => error.name);

    scheduler.interruptAll();

    assert.equal(await settleWithin(queuedOutcome), 'AbortError', '排队任务从未开始，只能被直接拒绝');
    assert.equal(await settleWithin(runningOutcome), 'AbortError');
    assert.equal(observed.length, 1, '在跑的任务必须收到 abort 信号');
    assert.equal(scheduler.pendingCount, 0);
});

// ---------------------------------------------------------------- 在途表

test('在途表：同一 key 的第二个占用者复用同一个 promise', async () => {
    const { InFlightRegistry } = await modules();
    const registry = new InFlightRegistry();

    const first = registry.claim('key');
    assert.equal(first.reused, false);
    assert.equal(registry.size, 1);

    const second = registry.claim('key');
    assert.equal(second.reused, true, '同样的请求不能付两次费');
    assert.equal(second.promise, first.promise);

    first.settle('done');
    assert.equal(await settleWithin(second.promise), 'done');
    await Promise.resolve();
    assert.equal(registry.size, 0, '结算后必须从表中摘除');
});

test('在途表：fail 让所有等待者一起被拒', async () => {
    const { InFlightRegistry } = await modules();
    const registry = new InFlightRegistry();

    const first = registry.claim('key');
    const second = registry.claim('key');
    first.fail(new Error('boom'));

    await assert.rejects(settleWithin(second.promise), /boom/);
    await Promise.resolve();
    assert.equal(registry.size, 0);
});

test('在途表：不同 key 互不干扰，旧条目结束后不误删新条目', async () => {
    const { InFlightRegistry } = await modules();
    const registry = new InFlightRegistry();

    const a = registry.claim('a');
    const b = registry.claim('b');
    assert.equal(a.reused, false);
    assert.equal(b.reused, false);
    assert.equal(registry.size, 2);

    a.settle('a');
    await Promise.resolve();
    await Promise.resolve();

    const again = registry.claim('a');
    assert.equal(again.reused, false, '条目已摘除，应当重新占用');
    assert.equal(registry.size, 2, '与 b 各占一条');

    again.settle('again-a');
    b.settle('b');
    assert.equal(await again.promise, 'again-a');
    assert.equal(await b.promise, 'b', 'b 不能被 a 的清理动作误删');
});

// ---------------------------------------------------------------- 流水线

test('流水线：词汇表指纹为空时恒为 none', async () => {
    const { pipeline } = makePipeline(await modules());

    assert.equal(pipeline.glossaryFingerprint(undefined), 'none');
    assert.equal(pipeline.glossaryFingerprint({ enabled: false, entries: [{ source: 'a', target: 'b' }] }), 'none');
    assert.equal(pipeline.glossaryFingerprint({ enabled: true, entries: [] }), 'none');
    assert.equal(pipeline.glossaryFingerprint({ enabled: true, entries: [{ source: '', target: '' }] }), 'none');
});

test('流水线：词汇表指纹对词条内容、大小写敏感标志与顺序都敏感', async () => {
    const { pipeline } = makePipeline(await modules());

    const base = pipeline.glossaryFingerprint({ enabled: true, entries: [{ source: 'a', target: 'x' }] });
    assert.notEqual(
        base,
        pipeline.glossaryFingerprint({ enabled: true, entries: [{ source: 'a', target: 'y' }] }),
        '换了译法必须换指纹，否则会一直拿旧词汇表的结果',
    );
    assert.notEqual(
        base,
        pipeline.glossaryFingerprint({ enabled: true, entries: [{ source: 'a', target: 'x', caseSensitive: true }] }),
        '大小写敏感标志会改变匹配集合',
    );
    assert.notEqual(
        pipeline.glossaryFingerprint({ enabled: true, entries: [{ source: 'a', target: 'x' }, { source: 'x', target: 'y' }] }),
        pipeline.glossaryFingerprint({ enabled: true, entries: [{ source: 'x', target: 'y' }, { source: 'a', target: 'x' }] }),
        '词汇表是逐条 reduce 应用的，顺序会影响结果',
    );
});

test('流水线：同样的输入得到同样的缓存键，词汇表变化则键变化', async () => {
    const { pipeline } = makePipeline(await modules());
    const options = { sourceLang: 'en', targetLang: 'zh' };

    const settings = { glossary: { enabled: true, entries: [{ source: 'world', target: '世界' }] } };
    const first = await pipeline.prepare('hello world', { ...options, settings });
    const second = await pipeline.prepare('hello world', { ...options, settings });
    assert.equal(first.cacheKey, second.cacheKey, '同样的输入必须得到同样的键');

    // 关键构造：新词条**不出现在源文本里**，因此送进引擎的文本两版完全相同，
    // 只有「词汇表在输出侧的后处理」会不同。这种差异如果没进缓存键，
    // 用户新增一条只命中译文的词条就永远看不到效果。
    const extended = {
        glossary: {
            enabled: true,
            entries: [
                { source: 'world', target: '世界' },
                { source: '地球', target: '地球（蓝星）' },
            ],
        },
    };
    const firstExtended = await pipeline.prepare('hello world', { ...options, settings: extended });
    assert.equal(
        firstExtended.textForTranslation,
        first.textForTranslation,
        '本用例的前提：送进引擎的文本两版相同',
    );
    assert.notEqual(first.cacheKey, firstExtended.cacheKey, '只影响输出侧的词条也要让缓存键变化');
});

test('流水线：AI 提示词/模型变化会让缓存键与在途键一起变化', async () => {
    const { TranslationPipeline } = await modules();
    const makeAiPipeline = (config) => {
        const pipeline = new TranslationPipeline({
            engineResolver: {
                async resolveTranslatorForText() {
                    return { engine: 'ai:default', translator: { name: 'AI' }, config };
                },
            },
        });
        return pipeline;
    };
    const options = { sourceLang: 'en', targetLang: 'zh', settings: { glossary: { enabled: false, entries: [] } } };
    const config = { model: 'gpt-x', customPrompt: '翻成 {targetLang}: {textToTranslate}' };

    const first = await makeAiPipeline(config).prepare('hello', options);
    const same = await makeAiPipeline({ ...config }).prepare('hello', options);
    assert.equal(first.cacheKey, same.cacheKey, '同样的 AI 配置必须复用缓存');

    const otherPrompt = await makeAiPipeline({ ...config, customPrompt: '用更口语的方式翻成 {targetLang}' }).prepare('hello', options);
    assert.notEqual(first.cacheKey, otherPrompt.cacheKey, '改了提示词就不能继续命中旧译文');

    const otherModel = await makeAiPipeline({ ...config, model: 'gpt-y' }).prepare('hello', options);
    assert.notEqual(first.cacheKey, otherModel.cacheKey, '换了模型就不能继续命中旧译文');
});

test('流水线：词汇表在引擎解析之前应用，原文原样保留', async () => {
    const { pipeline, calls } = makePipeline(await modules());

    const prepared = await pipeline.prepare('hello world', {
        sourceLang: 'en',
        targetLang: 'zh',
        settings: { glossary: { enabled: true, entries: [{ source: 'world', target: '世界' }] } },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, 'hello 世界', '解析器必须看到词汇表替换后的文本');
    assert.equal(prepared.textForTranslation, 'hello 世界');
    assert.equal(prepared.processedText, 'hello world', 'processedText 保留原文');
    assert.equal(prepared.resolution.engine, 'google');
});

test('流水线：解析失败的异常向上抛，由调用方决定降级形态', async () => {
    const { TranslationPipeline } = await modules();
    const pipeline = new TranslationPipeline({
        engineResolver: {
            async resolveTranslatorForText() {
                throw new Error('引擎已被删除');
            },
        },
    });

    await assert.rejects(
        () => pipeline.prepare('hi', { sourceLang: 'en', targetLang: 'zh', settings: { glossary: {} } }),
        /引擎已被删除/,
    );
});

test('预处理：非字符串一律视为空；后处理不 trim 引擎输出', async () => {
    const { preProcess, postProcess } = await modules();

    assert.equal(preProcess('  hi  '), 'hi');
    assert.equal(preProcess(''), '');
    assert.equal(preProcess(null), '');
    assert.equal(preProcess(undefined), '');
    assert.equal(preProcess(123), '');

    assert.equal(postProcess('  keep  '), '  keep  ');
    assert.equal(postProcess(undefined), '');
});
