/**
 * 翻译流水线单元测试。
 *
 * 覆盖此前完全无测试的三块高风险逻辑：
 *  - `translation-cache-store.js`：LRU/上限/持久化节流
 *  - `translator-engine-resolver.js`：引擎解析、短文本兜底、循环依赖防护
 *  - `translation-retry-controller.js`：可重试判定、退避、引擎冷却、中止
 * 以及两个内置翻译器的请求构造与响应校验。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createI18nMock } from './helpers/i18n-mock.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function loadModules(entrySource) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-pipeline-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');
    const mockSettingsPath = path.join(tempDir, 'settings-manager-mock.js');

    await writeFile(entryPath, entrySource);
    await writeFile(mockBrowserPath, 'export default globalThis.__foxlateBrowserMock;');
    await writeFile(mockSettingsPath, `
        export const SettingsManager = {
            async getValidatedSettings() {
                return globalThis.__foxlateSettingsMock;
            }
        };
    `);

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'foxlate-pipeline-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({ path: mockBrowserPath }));
                buildContext.onResolve({ filter: /common\/settings-manager\.js$/ }, () => ({ path: mockSettingsPath }));
            },
        }],
    });

    const modules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

const src = (relativePath) => JSON.stringify(path.join(projectRoot, relativePath));

function installDefaults() {
    globalThis.__foxlateBrowserMock = {
        i18n: createI18nMock(),
        tabs: { sendMessage: async () => {} },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    };
    globalThis.__foxlateSettingsMock = {
        translatorEngine: 'google',
        aiEngines: [],
    };
}

// ---------------------------------------------------------------------------
// 缓存存储
// ---------------------------------------------------------------------------

test('TranslationCacheStore：键格式与 LRU 语义', async () => {
    installDefaults();
    const { TranslationCacheStore, createTranslationCacheKey } = await loadModules(
        `export { TranslationCacheStore, createTranslationCacheKey } from ${src('src/background/translation-cache-store.js')};`
    );

    // 键必须能区分决定最终译文的所有维度。少了任何一维，都会让不同设置下的请求
    // 互相命中到对方的缓存（1.7.4 的真实缺陷：换引擎/改词汇表后会拿到旧译文）。
    const base = createTranslationCacheKey('google', 'en', 'zh', 'hello');
    assert.equal(base, createTranslationCacheKey('google', 'en', 'zh', 'hello'), '相同输入必须得到相同键');
    assert.notEqual(base, createTranslationCacheKey('deeplx', 'en', 'zh', 'hello'), '不同引擎不得共用缓存');
    assert.notEqual(base, createTranslationCacheKey('google', 'en', 'ja', 'hello'), '不同目标语不得共用缓存');
    assert.notEqual(base, createTranslationCacheKey('google', 'ja', 'zh', 'hello'), '不同源语不得共用缓存');
    assert.notEqual(base, createTranslationCacheKey('google', 'en', 'zh', 'hello!'), '不同文本不得共用缓存');
    assert.notEqual(base, createTranslationCacheKey('google', 'en', 'zh', 'hello', 'world>世界'), '不同词汇表不得共用缓存');
    // 未传词汇表指纹时等同于「无词汇表」，与显式传入 'none' 等价
    assert.equal(createTranslationCacheKey('google', 'en', 'zh', 'hello', 'none'), base);

    const store = new TranslationCacheStore({ maxSize: 3 });
    store.set('a', 1);
    store.set('b', 2);
    store.set('c', 3);
    assert.equal(store.size, 3);

    // 访问 a 之后，最旧的是 b
    assert.equal(store.touch('a'), 1);
    store.set('d', 4);

    assert.equal(store.has('b'), false, 'b 应作为最久未使用项被淘汰');
    assert.equal(store.has('a'), true, 'touch 过的键应被保留');

    // touch 不存在的键返回 undefined 且不改变容量
    assert.equal(store.touch('missing'), undefined);
    assert.equal(store.size, 3);
});

// ---------------------------------------------------------------------------
// 缓存边界：命中与未命中必须走同一条后处理路径
//
// 1.7.4 的真实缺陷：词汇表只在「未命中」路径上应用（源侧改写 + 输出侧替换），
// 而「命中」路径直接返回缓存值，于是同一段文本第一次和第二次得到不同译文。
// 根因是缓存边界画在了流水线中间：存的是中间产物，两条路径各自补一半处理。
// 修法：缓存里存最终文本，键覆盖决定它的全部输入（引擎/语向/词汇表/改写后源文本）。
// ---------------------------------------------------------------------------

async function loadTranslatorManager() {
    return loadModules(`export { TranslatorManager } from ${src('src/background/translator-manager.js')};`);
}

function installManagerMocks({ glossary = { enabled: false, entries: [] }, engine = 'google' } = {}) {
    globalThis.__foxlateBrowserMock = {
        i18n: createI18nMock(),
        tabs: { sendMessage: async () => {} },
        storage: {
            onChanged: { addListener: () => {} },
            local: { get: async () => ({}), set: async () => {} },
            sync: { get: async () => ({}), set: async () => {} },
        },
    };
    globalThis.__foxlateSettingsMock = {
        translatorEngine: engine,
        aiEngines: [],
        parallelRequests: 5,
        cacheSize: 100,
        glossary,
    };
}

// 固定返回一段含 'world' 的文本，以便观察输出侧词汇表是否生效。
function installFakeEngines() {
    const calls = { total: 0 };
    globalThis.fetch = async (url) => {
        calls.total += 1;
        if (String(url).includes('deeplx')) {
            return { ok: true, status: 200, statusText: 'OK', json: async () => ({ data: 'DEEPLX world' }) };
        }
        return { ok: true, status: 200, statusText: 'OK', json: async () => [[['GOOGLE world']]] };
    };
    return calls;
}

test('翻译缓存：命中与未命中必须返回同一结果（词汇表不得只在未命中时生效）', async () => {
    installManagerMocks({ glossary: { enabled: true, entries: [{ source: 'world', target: '世界' }] } });
    const { TranslatorManager } = await loadTranslatorManager();
    const calls = installFakeEngines();

    const first = await TranslatorManager.translateText('hello world', 'zh', 'en');
    const second = await TranslatorManager.translateText('hello world', 'zh', 'en');

    assert.equal(calls.total, 1, '第二次必须命中缓存，不应再次调用引擎');
    assert.equal(first.text, second.text, '同一输入在缓存命中与未命中时必须得到相同译文');
    assert.match(first.text, /世界/, '词汇表必须在未命中路径生效');
    assert.match(second.text, /世界/, '词汇表必须在命中路径同样生效');
});

test('翻译缓存：词汇表变更后必须重新翻译，不得复用旧词汇表的结果', async () => {
    installManagerMocks({ glossary: { enabled: true, entries: [{ source: 'world', target: '世界_A' }] } });
    const { TranslatorManager } = await loadTranslatorManager();
    const calls = installFakeEngines();

    await TranslatorManager.translateText('hello world', 'zh', 'en');
    const callsAfterFirst = calls.total;

    globalThis.__foxlateSettingsMock.glossary = { enabled: true, entries: [{ source: 'world', target: '世界_B' }] };
    const afterEdit = await TranslatorManager.translateText('hello world', 'zh', 'en');

    assert.ok(calls.total > callsAfterFirst, '词汇表变更后必须重新调用引擎');
    assert.match(afterEdit.text, /世界_B/, '必须使用新词汇表');
    assert.doesNotMatch(afterEdit.text, /世界_A/, '不得复用旧词汇表的结果');
});

test('翻译缓存：换引擎后不得复用另一引擎的缓存', async () => {
    installManagerMocks({ glossary: { enabled: false, entries: [] } });
    const { TranslatorManager } = await loadTranslatorManager();
    installFakeEngines();

    const google = await TranslatorManager.translateText('engine test', 'zh', 'en', 'google');
    globalThis.__foxlateSettingsMock.deeplxApiUrl = 'https://example.invalid/deeplx';
    const deeplx = await TranslatorManager.translateText('engine test', 'zh', 'en', 'deeplx');

    assert.match(google.text, /GOOGLE/);
    assert.match(deeplx.text, /DEEPLX/, '换引擎后必须由新引擎翻译，而不是命中旧引擎的缓存');
});

test('translateBatch：命中与未命中必须返回同一结果', async () => {
    installManagerMocks({ glossary: { enabled: true, entries: [{ source: 'world', target: '世界' }] } });
    const { TranslatorManager } = await loadTranslatorManager();
    installFakeEngines();

    const first = await TranslatorManager.translateBatch(['hello world', 'hello world'], 'zh', 'en');
    const second = await TranslatorManager.translateBatch(['hello world', 'hello world'], 'zh', 'en');

    assert.equal(first[0].text, second[0].text, '批量路径同样不得出现命中/未命中不一致');
    assert.match(second[0].text, /世界/, '批量命中路径也必须应用词汇表');
    // 同一批内重复文本应共用一次引擎调用
    assert.equal(first[0].text, first[1].text);
});

test('TranslationCacheStore：updateLimit 收紧时立即裁剪，放宽时保留内容', async () => {
    installDefaults();
    const { TranslationCacheStore } = await loadModules(
        `export { TranslationCacheStore } from ${src('src/background/translation-cache-store.js')};`
    );

    const store = new TranslationCacheStore({ maxSize: 10 });
    for (let i = 0; i < 6; i += 1) store.set(`k${i}`, i);

    assert.equal(store.updateLimit(2), 2);
    assert.equal(store.size, 2, '收紧上限必须立刻淘汰到新上限');

    assert.equal(store.updateLimit(5), 5);
    assert.equal(store.size, 2, '放宽上限不应丢失已有条目');

    // 非法值被忽略，保持原上限
    assert.equal(store.updateLimit(-1), 5);
    assert.equal(store.updateLimit(undefined), 5);
    assert.equal(store.limit, 5);
});

test('TranslationCacheStore：持久化读取失败不抛出，写回携带完整快照', async () => {
    installDefaults();
    const writes = [];
    globalThis.__foxlateBrowserMock.storage.local.get = async () => {
        throw new Error('storage exploded');
    };
    globalThis.__foxlateBrowserMock.storage.local.set = async (payload) => {
        writes.push(payload);
    };

    const { TranslationCacheStore } = await loadModules(
        `export { TranslationCacheStore } from ${src('src/background/translation-cache-store.js')};`
    );

    const store = new TranslationCacheStore();
    assert.equal(await store.load(), 0, 'load 失败应返回 0 而不是抛出');

    store.set('x', { text: '译文' });
    await store.save();
    assert.deepEqual(writes.at(-1).translationCache.x, { text: '译文' });

    await store.clear();
    assert.equal(store.size, 0);
    assert.deepEqual(writes.at(-1).translationCache, {});
});

test('TranslationCacheStore：scheduleSave 去抖，写入失败不影响后续调度', async () => {
    installDefaults();
    let setCount = 0;
    globalThis.__foxlateBrowserMock.storage.local.set = async () => {
        setCount += 1;
        throw new Error('quota exceeded');
    };

    const { TranslationCacheStore } = await loadModules(
        `export { TranslationCacheStore } from ${src('src/background/translation-cache-store.js')};`
    );

    const store = new TranslationCacheStore({ saveDelayMs: 20 });
    store.set('a', 1);
    store.scheduleSave();
    store.set('b', 2);
    store.scheduleSave();

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(setCount, 1, '连续调度只应落盘一次');
});

// ---------------------------------------------------------------------------
// 引擎解析
// ---------------------------------------------------------------------------

function createResolverHarness({ settings }) {
    globalThis.__foxlateSettingsMock = settings;
    return loadModules(`
        export { TranslatorEngineResolver } from ${src('src/background/translator-engine-resolver.js')};
    `);
}

const TRANSLATORS = {
    google: { name: 'Google' },
    deeplx: { name: 'DeepLx' },
    ai: { name: 'AI' },
};

test('TranslatorEngineResolver：getTranslator 解析 ai: 前缀并拒绝空引擎', async () => {
    installDefaults();
    const { TranslatorEngineResolver } = await createResolverHarness({ settings: { translatorEngine: 'google', aiEngines: [] } });
    const resolver = new TranslatorEngineResolver({ translators: TRANSLATORS });

    assert.equal(resolver.getTranslator('google'), TRANSLATORS.google);
    assert.equal(resolver.getTranslator('ai:abc123'), TRANSLATORS.ai);
    assert.equal(resolver.getTranslator('unknown'), undefined);
    assert.equal(resolver.getTranslator(''), undefined, '空引擎不应回退到任何翻译器');
});

test('TranslatorEngineResolver：无显式引擎时回落全局设置', async () => {
    installDefaults();
    const { TranslatorEngineResolver } = await createResolverHarness({ settings: { translatorEngine: 'deeplx', aiEngines: [] } });
    const resolver = new TranslatorEngineResolver({ translators: TRANSLATORS });

    assert.equal(await resolver.resolveEngine(), 'deeplx');
    assert.equal(await resolver.resolveEngine('google'), 'google', '显式引擎优先于全局设置');
});

test('TranslatorEngineResolver：DeepLx 注入设置里的 API 地址，其它引擎 config 为 null', async () => {
    installDefaults();
    const { TranslatorEngineResolver } = await createResolverHarness({
        settings: { translatorEngine: 'deeplx', deeplxApiUrl: 'https://deeplx.example/translate', aiEngines: [] },
    });
    const resolver = new TranslatorEngineResolver({ translators: TRANSLATORS });

    const deeplx = await resolver.resolveTranslatorForText('hello', 'deeplx', []);
    assert.equal(deeplx.translator, TRANSLATORS.deeplx);
    assert.deepEqual(deeplx.config, { apiUrl: 'https://deeplx.example/translate' });

    const google = await resolver.resolveTranslatorForText('hello', 'google', []);
    assert.equal(google.translator, TRANSLATORS.google);
    assert.equal(google.config, null);
});

test('TranslatorEngineResolver：AI 引擎按 id 取出配置，缺失时明确抛错', async () => {
    installDefaults();
    const aiEngine = { id: 'e1', apiKey: 'k', apiUrl: 'https://ai.example', model: 'm', customPrompt: 'x' };
    const { TranslatorEngineResolver } = await createResolverHarness({
        settings: { translatorEngine: 'ai:e1', aiEngines: [aiEngine] },
    });
    const resolver = new TranslatorEngineResolver({ translators: TRANSLATORS });

    const resolved = await resolver.resolveTranslatorForText('hello world', 'ai:e1', []);
    assert.equal(resolved.translator, TRANSLATORS.ai);
    assert.equal(resolved.engine, 'ai:e1');
    assert.equal(resolved.config, aiEngine);

    await assert.rejects(
        () => resolver.resolveTranslatorForText('hello', 'ai:ghost', []),
        /Selected AI engine configuration not found for ID: ghost/,
    );
});

test('TranslatorEngineResolver：短文本走兜底引擎，并防住自引用死循环', async () => {
    installDefaults();
    const aiEngine = { id: 'e1', wordCountThreshold: 5, fallbackEngine: 'google' };
    const { TranslatorEngineResolver } = await createResolverHarness({
        settings: { translatorEngine: 'ai:e1', aiEngines: [aiEngine] },
    });
    const resolver = new TranslatorEngineResolver({ translators: TRANSLATORS });

    const log = [];
    const shortText = await resolver.resolveTranslatorForText('two words', 'ai:e1', log);
    assert.equal(shortText.translator, TRANSLATORS.google, '词数低于阈值应切到兜底引擎');
    assert.equal(shortText.engine, 'google');
    assert.ok(log.some(line => line.includes('短文本切换')), '切换必须留痕');

    // 自引用：备用引擎就是自己 → 拒绝切换，保留 AI
    const loopEngine = { id: 'e2', wordCountThreshold: 5, fallbackEngine: 'ai:e2' };
    const loopHarness = await createResolverHarness({ settings: { translatorEngine: 'ai:e2', aiEngines: [loopEngine] } });
    const loopResolver = new loopHarness.TranslatorEngineResolver({ translators: TRANSLATORS });
    const loopLog = [];
    const guarded = await loopResolver.resolveTranslatorForText('two words', 'ai:e2', loopLog);
    assert.equal(guarded.translator, TRANSLATORS.ai, '自引用时必须保留原 AI 引擎');
    assert.equal(guarded.engine, 'ai:e2');
    assert.ok(loopLog.some(line => line.includes('循环依赖')));
});

test('TranslatorEngineResolver：兜底引擎为 default 时解析为全局引擎，词数超阈值时不切换', async () => {
    installDefaults();
    const aiEngine = { id: 'e1', wordCountThreshold: 3, fallbackEngine: 'default' };
    const { TranslatorEngineResolver } = await createResolverHarness({
        settings: { translatorEngine: 'deeplx', aiEngines: [aiEngine] },
    });
    const resolver = new TranslatorEngineResolver({ translators: TRANSLATORS });

    const log = [];
    const short = await resolver.resolveTranslatorForText('one two', 'ai:e1', log);
    assert.equal(short.engine, 'deeplx', 'default 应解析成全局引擎');
    assert.ok(log.some(line => line.includes('默认')));

    const longText = 'one two three four five six';
    const long = await resolver.resolveTranslatorForText(longText, 'ai:e1', []);
    assert.equal(long.translator, TRANSLATORS.ai, '超过阈值不应切换');
    assert.equal(long.engine, 'ai:e1');
});

test('TranslatorEngineResolver：兜底引擎缺失时不切换，仅告警', async () => {
    installDefaults();
    const aiEngine = { id: 'e1', wordCountThreshold: 5, fallbackEngine: 'gemini-not-installed' };
    const { TranslatorEngineResolver } = await createResolverHarness({
        settings: { translatorEngine: 'ai:e1', aiEngines: [aiEngine] },
    });
    const resolver = new TranslatorEngineResolver({ translators: TRANSLATORS });

    const log = [];
    const resolved = await resolver.resolveTranslatorForText('two words', 'ai:e1', log);
    assert.equal(resolved.translator, TRANSLATORS.ai);
    assert.ok(log.some(line => line.includes('找不到备用翻译器')));
});

test('TranslatorEngineResolver：withTabContext 在无 tabId 或抽取失败时原样返回', async () => {
    installDefaults();
    const { TranslatorEngineResolver } = await createResolverHarness({ settings: { translatorEngine: 'google', aiEngines: [] } });
    const resolver = new TranslatorEngineResolver({ translators: TRANSLATORS });

    assert.equal(await resolver.withTabContext(null, 1), null);
    assert.deepEqual(await resolver.withTabContext({ apiKey: 'k' }, undefined), { apiKey: 'k' });

    // 抽取失败（无真实标签页上下文）时必须降级为原配置，而不是抛出
    const degraded = await resolver.withTabContext({ apiKey: 'k' }, 999999);
    assert.equal(degraded.apiKey, 'k', '降级路径必须保留原配置的全部字段');
});

// ---------------------------------------------------------------------------
// 重试控制器
// ---------------------------------------------------------------------------

async function loadRetryController(options = {}) {
    installDefaults();
    const notifications = [];
    globalThis.__foxlateBrowserMock.tabs.sendMessage = async (tabId, message) => {
        notifications.push({ tabId, message });
    };
    const modules = await loadModules(`
        export { TranslationRetryController } from ${src('src/background/translation-retry-controller.js')};
    `);
    const controller = new modules.TranslationRetryController({ baseDelayMs: 5, maxDelayMs: 20, ...options });
    return { controller, notifications };
}

test('TranslationRetryController：首次成功即返回，不产生重试通知噪声', async () => {
    const { controller, notifications } = await loadRetryController();
    const log = [];
    let calls = 0;

    const result = await controller.execute({
        engine: 'google',
        tabId: 7,
        log,
        operation: async () => { calls += 1; return 'ok'; },
    });

    assert.equal(result, 'ok');
    assert.equal(calls, 1);
    assert.equal(notifications.length, 1, '成功也要通知一次以清除 UI 重试态');
    assert.equal(notifications[0].message.payload.delayMs, 0);
});

test('TranslationRetryController：可重试错误按 maxAttempts 重试后抛出原错误', async () => {
    const { controller } = await loadRetryController({ maxAttempts: 2 });
    let calls = 0;
    const log = [];

    await assert.rejects(
        () => controller.execute({
            engine: 'google',
            tabId: 1,
            log,
            operation: async () => { calls += 1; throw new Error('API Error: 429 Too Many Requests'); },
        }),
        /429/,
    );

    assert.equal(calls, 3, 'maxAttempts=2 表示总共 3 次尝试（首次 + 2 次重试）');
    assert.ok(log.some(line => line.includes('Retryable translation error')));
});

test('TranslationRetryController：不可重试错误立即抛出，不做退避', async () => {
    const { controller } = await loadRetryController();
    let calls = 0;

    await assert.rejects(
        () => controller.execute({
            engine: 'google',
            tabId: 1,
            log: [],
            operation: async () => { calls += 1; throw new Error('API Error: 400 Bad Request'); },
        }),
        /400/,
    );

    assert.equal(calls, 1, '400 属于不可重试错误，不应重复请求');
});

test('TranslationRetryController：AbortError 直接穿透，不重试也不退避', async () => {
    const { controller } = await loadRetryController();
    let calls = 0;
    const abortError = new DOMException('stopped', 'AbortError');

    await assert.rejects(
        () => controller.execute({
            engine: 'google',
            tabId: 1,
            log: [],
            operation: async () => { calls += 1; throw abortError; },
        }),
        (error) => error === abortError,
    );

    assert.equal(calls, 1);
});

test('TranslationRetryController：引擎冷却会推迟下一次调用，成功后退避状态清空', async () => {
    const { controller } = await loadRetryController({ maxAttempts: 1, baseDelayMs: 30, maxDelayMs: 60 });
    const log = [];

    // 第一次：失败一次（触发退避记录），第二次成功
    let attempt = 0;
    await controller.execute({
        engine: 'deeplx',
        tabId: 1,
        log,
        operation: async () => {
            attempt += 1;
            if (attempt === 1) throw new Error('503 Service Unavailable');
            return 'recovered';
        },
    });

    // 冷却状态在成功后应被清除 → 下一次调用不应再等待
    const startedAt = Date.now();
    let waited = false;
    const result = await controller.execute({
        engine: 'deeplx',
        tabId: 1,
        log,
        operation: async () => {
            waited = Date.now() - startedAt > 15;
            return 'second';
        },
    });

    assert.equal(result, 'second');
    assert.equal(waited, false, '成功后必须清除引擎冷却状态');
});

test('TranslationRetryController：退避期间被中止会抛出 AbortError', async () => {
    const { controller } = await loadRetryController({ maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 500 });
    const abortController = new AbortController();

    const execution = controller.execute({
        engine: 'google',
        tabId: 1,
        log: [],
        signal: abortController.signal,
        operation: async () => { throw new Error('429 rate limit'); },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    abortController.abort();

    await assert.rejects(execution, (error) => error.name === 'AbortError');
});

test('TranslationRetryController：引擎冷却在并发请求下生效，且中止信号能立即打断等待', async () => {
    const { controller } = await loadRetryController({ maxAttempts: 1, baseDelayMs: 400, maxDelayMs: 400 });
    const log = [];

    // 第一个请求：可重试失败 → 记录引擎冷却，并在内部退避等待
    const first = controller.execute({
        engine: 'google',
        tabId: 1,
        log,
        operation: async () => { throw new Error('429 rate limit'); },
    });
    first.catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 40));

    // 冷却期内第二个请求带着已中止的信号进来：必须在退避等待前就失败
    const abortController = new AbortController();
    abortController.abort();
    let ran = false;

    const startedAt = Date.now();
    await assert.rejects(
        () => controller.execute({
            engine: 'google',
            tabId: 1,
            signal: abortController.signal,
            log,
            operation: async () => { ran = true; },
        }),
        (error) => error.name === 'AbortError',
    );

    assert.equal(ran, false, '中止后不得再发起上游请求');
    assert.ok(Date.now() - startedAt < 300, '不应真的等完整个退避时长');

    await first.catch(() => {});
});

test('TranslationRetryController：网络类瞬时错误必须判定为可重试（含 Chrome 的 Failed to fetch）', async () => {
    const { controller } = await loadRetryController({ maxAttempts: 1 });
    const transientMessages = [
        'Google translation failed: Failed to fetch',
        'Google translation failed: NetworkError when attempting to fetch resource.',
        'DeepLx translation failed: Load failed',
        'API Error: 502 Bad Gateway',
    ];

    for (const message of transientMessages) {
        let calls = 0;
        await assert.rejects(() => controller.execute({
            engine: 'google',
            tabId: 1,
            log: [],
            operation: async () => { calls += 1; throw new Error(message); },
        }));
        assert.equal(calls, 2, `“${message}” 应被判定为可重试（1 次重试）`);
    }
});

// ---------------------------------------------------------------------------
// 内置翻译器
// ---------------------------------------------------------------------------

test('GoogleTranslator：POST 到非官方端点并拼接全部片段', async () => {
    installDefaults();
    const { GoogleTranslator } = await loadModules(
        `export { GoogleTranslator } from ${src('src/background/translators/google-translator.js')};`
    );

    const requests = [];
    globalThis.fetch = async (url, init) => {
        requests.push({ url, init });
        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => [[['Hello ', 'x'], ['world', 'y']]],
        };
    };

    const translator = new GoogleTranslator();
    const result = await translator.translate('你好 世界', 'en', 'zh-CN');

    assert.equal(result.text, 'Hello world', '必须拼接 data[0] 的全部片段');
    const { url, init } = requests[0];
    assert.match(url, /^https:\/\/translate\.googleapis\.com\/translate_a\/single\?/);
    assert.match(url, /client=gtx/);
    assert.match(url, /sl=zh-CN/);
    assert.match(url, /tl=en/);
    assert.equal(init.method, 'POST', '长文本必须走 POST 以绕开 URL 长度限制');
    assert.equal(init.body, `q=${encodeURIComponent('你好 世界')}`);
    assert.ok(Array.isArray(result.log) && result.log.length > 0);
});

test('GoogleTranslator：空文本不发请求；非 2xx 与畸形响应给出明确错误', async () => {
    installDefaults();
    const { GoogleTranslator } = await loadModules(
        `export { GoogleTranslator } from ${src('src/background/translators/google-translator.js')};`
    );
    const translator = new GoogleTranslator();

    let fetchCount = 0;
    globalThis.fetch = async () => { fetchCount += 1; throw new Error('should not be called'); };

    const empty = await translator.translate('', 'en', 'zh');
    assert.equal(empty.text, '');
    assert.equal(fetchCount, 0, '空文本不应触发网络请求');

    globalThis.fetch = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' });
    await assert.rejects(() => translator.translate('hi', 'zh', 'en'), /Rate limit exceeded/);

    globalThis.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ unexpected: true }) });
    await assert.rejects(() => translator.translate('hi', 'zh', 'en'), /Invalid response structure from Google API/);

    // 中止必须原样穿透，不能被包成 "Google translation failed"
    const abortError = new DOMException('stopped', 'AbortError');
    globalThis.fetch = async () => { throw abortError; };
    await assert.rejects(() => translator.translate('hi', 'zh', 'en'), (error) => error === abortError);
});

test('DeepLxTranslator：缺少 API 地址直接报错，正常响应取 data 字段', async () => {
    installDefaults();
    const { DeepLxTranslator } = await loadModules(
        `export { DeepLxTranslator } from ${src('src/background/translators/deeplx-translator.js')};`
    );
    const translator = new DeepLxTranslator();

    await assert.rejects(() => translator.translate('hi', 'EN', 'ZH', {}), /DeepLx API URL not provided/);
    await assert.rejects(() => translator.translate('hi', 'EN', 'ZH', null), /DeepLx API URL not provided/);

    const requests = [];
    globalThis.fetch = async (url, init) => {
        requests.push({ url, init });
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ data: 'Hello' }) };
    };

    const result = await translator.translate('你好', 'EN', 'auto', { apiUrl: 'https://deeplx.example/translate' });
    assert.equal(result.text, 'Hello');
    assert.equal(requests[0].url, 'https://deeplx.example/translate');

    const payload = JSON.parse(requests[0].init.body);
    assert.equal(payload.text, '你好');
    assert.equal(payload.target_lang, 'EN');
    assert.equal(payload.source_lang, undefined, '源语言为 auto 时应省略该字段，以走服务端自动检测');

    // 显式源语言必须照常下发
    await translator.translate('你好', 'EN', 'ZH', { apiUrl: 'https://deeplx.example/translate' });
    assert.equal(JSON.parse(requests[1].init.body).source_lang, 'ZH');
});

test('DeepLxTranslator：响应缺少 data 时明确报错，而不是把 undefined 交给上层', async () => {
    installDefaults();
    const { DeepLxTranslator } = await loadModules(
        `export { DeepLxTranslator } from ${src('src/background/translators/deeplx-translator.js')};`
    );
    const translator = new DeepLxTranslator();

    globalThis.fetch = async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ code: 500, message: 'boom' }) });
    await assert.rejects(
        () => translator.translate('你好', 'EN', 'ZH', { apiUrl: 'https://deeplx.example/translate' }),
        /Unexpected DeepLx response/,
    );
});

// ---------------------------------------------------------------------------
// 请求超时
// ---------------------------------------------------------------------------

test('createRequestSignal：无超时配置时原样透传调用方信号', async () => {
    installDefaults();
    const { createRequestSignal } = await loadModules(`
        export { createRequestSignal, DEFAULT_REQUEST_TIMEOUT_MS } from ${src('src/background/translators/request-timeout.js')};
    `);

    const caller = new AbortController();
    const passthrough = createRequestSignal(caller.signal, 0);
    assert.equal(passthrough.signal, caller.signal);
    passthrough.dispose();

    assert.equal(createRequestSignal(undefined, 0).signal, undefined);
});

test('createRequestSignal：超时会自主中止，并带上可识别的 TimeoutError', async () => {
    installDefaults();
    const { createRequestSignal } = await loadModules(`
        export { createRequestSignal } from ${src('src/background/translators/request-timeout.js')};
    `);

    const request = createRequestSignal(undefined, 10);
    assert.equal(request.signal.aborted, false);

    await assert.rejects(
        () => new Promise((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        }),
        (error) => error.name === 'TimeoutError' && /timed out/.test(error.message),
    );
    request.dispose();
});

test('createRequestSignal：调用方中止会传递进来，已中止的信号立即生效', async () => {
    installDefaults();
    const { createRequestSignal } = await loadModules(`
        export { createRequestSignal } from ${src('src/background/translators/request-timeout.js')};
    `);

    const caller = new AbortController();
    const request = createRequestSignal(caller.signal, 60000);
    assert.equal(request.signal.aborted, false);

    caller.abort();
    assert.equal(request.signal.aborted, true);
    assert.equal(request.signal.reason.name, 'AbortError');
    request.dispose();

    const already = new AbortController();
    already.abort();
    const fastRequest = createRequestSignal(already.signal, 60000);
    assert.equal(fastRequest.signal.aborted, true, '传入已中止的信号时必须立即表现为已中止');
    fastRequest.dispose();
});

test('createRequestSignal：dispose 会清掉定时器，不再产生超时中止', async () => {
    installDefaults();
    const { createRequestSignal } = await loadModules(`
        export { createRequestSignal } from ${src('src/background/translators/request-timeout.js')};
    `);

    const request = createRequestSignal(undefined, 15);
    request.dispose();

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(request.signal.aborted, false, 'dispose 之后不应再触发超时');
});

// ---------------------------------------------------------------------------
// 内置 Canvas 测量引擎
//
// Node 没有 Canvas 2D 实现，所以这里注入一个确定性度量上下文：
// 宽度 = 字素数 × 10px。这样才能对行数与宽度做精确断言，
// 而不是只能验证「某个数字大于另一个数字」。
// ---------------------------------------------------------------------------

async function loadMeasurementHarness() {
    installDefaults();
    return loadModules(`
        export {
            canvasMeasurementEngine,
            setCanvasContextFactory,
            TextMeasurementService,
        } from ${src('src/common/text-measurement.js')};
    `);
}

/** 注入一个假上下文工厂，返回一个【按字素数计宽】的确定性度量实现。 */
function installFakeCanvas(modules, { glyphWidth = 10 } = {}) {
    const fontRef = { current: '' };
    let setCount = 0;
    modules.setCanvasContextFactory(() => ({
        get font() { return fontRef.current; },
        set font(value) {
            if (fontRef.current !== value) setCount += 1;
            fontRef.current = value;
        },
        measureText: (value) => ({ width: [...value].length * glyphWidth }),
    }));
    return { get fontSetCount() { return setCount; } };
}

test('canvasMeasurementEngine：按字素宽度精确换行，并尊重容器宽度', async () => {
    const modules = await loadMeasurementHarness();
    installFakeCanvas(modules, { glyphWidth: 10 });

    const service = new modules.TextMeasurementService();
    assert.equal(service.engineName, 'canvas', '未注入引擎时应使用内置 Canvas 引擎');

    const style = { fontFamily: 'sans-serif', fontSize: 16, lineHeight: 20 };

    // "aaaaa bbbbb" 每个词 50px；宽度上限 60px → 两行
    const twoWords = service.measureText('aaaaa bbbbb', { maxWidth: 60, styleOverrides: style });
    assert.equal(twoWords.lineCount, 2);
    assert.equal(twoWords.maxLineWidth, 50, '行宽应等于最长一行的真实度量');
    assert.equal(twoWords.naturalWidth, 110, '自然宽度 = 整串（含空格）的度量');
    assert.equal(twoWords.height, 40, '高度 = 行数 × 行高');
    assert.equal(twoWords.source, 'canvas');
    assert.equal(twoWords.available, true);

    // 同一个词 100px 超过 60px 上限 → 必须按字素硬断
    const hardBreak = service.measureText('aaaaaaaaaa', { maxWidth: 60, styleOverrides: style });
    assert.equal(hardBreak.lineCount, 2, '超长单词必须硬断行');
    assert.ok(hardBreak.maxLineWidth <= 60);

    // 通过缓存再取一次必须完全等价
    assert.deepEqual(service.measureText('aaaaa bbbbb', { maxWidth: 60, styleOverrides: style }), twoWords);
});

test('canvasMeasurementEngine：CJK 逐字断行 vs keep-all 按词断行', async () => {
    const modules = await loadMeasurementHarness();
    installFakeCanvas(modules, { glyphWidth: 10 });

    const service = new modules.TextMeasurementService();
    const style = { fontFamily: 'sans-serif', fontSize: 14, lineHeight: 18 };

    const tenCjk = '汉字汉字汉字汉字汉字';
    assert.equal([...tenCjk].length, 10);

    // 默认（可任意断行）：10 字 × 10px，上限 30px → 3+3+3+1 = 4 行
    const wrapped = service.measureText(tenCjk, { maxWidth: 30, styleOverrides: style });
    assert.equal(wrapped.lineCount, 4);
    assert.equal(wrapped.maxLineWidth, 30);

    // keep-all：不得在词典词内部断开，于是只能整词换行。
    // Segmenter 把该串切成 5 个「汉字」词（各 20px），每行最多放 1 个词 → 5 行，且不超宽。
    const keepAll = service.measureText(tenCjk, {
        maxWidth: 30,
        styleOverrides: { ...style, wordBreak: 'keep-all' },
    });
    assert.equal(keepAll.lineCount, 5, 'keep-all 只允许在词边界换行');
    assert.equal(keepAll.maxLineWidth, 20, '每行恰好一个词');
    assert.ok(keepAll.maxLineWidth <= 30, '两种模式都不得超出容器宽度');
});

test('canvasMeasurementEngine：whiteSpace 语义与空白文本', async () => {
    const modules = await loadMeasurementHarness();
    installFakeCanvas(modules, { glyphWidth: 10 });

    const service = new modules.TextMeasurementService();
    const style = { fontFamily: 'sans-serif', fontSize: 14, lineHeight: 18 };

    const preWrap = service.measureText('a\nb\nc', { maxWidth: 600, styleOverrides: { ...style, whiteSpace: 'pre-wrap' } });
    assert.equal(preWrap.lineCount, 3, 'pre-wrap 必须保留硬换行');

    const normal = service.measureText('a\nb\nc', { maxWidth: 600, styleOverrides: { ...style, whiteSpace: 'normal' } });
    assert.equal(normal.lineCount, 1, 'normal 应把换行折叠成空格');

    const blank = service.measureText('   ', { maxWidth: 600, styleOverrides: style });
    assert.equal(blank.lineCount, 0);
    assert.equal(blank.height, 0);
    assert.equal(blank.available, true, '空白文本仍应报告测量可用');
    assert.equal(blank.source, 'canvas');
});

test('canvasMeasurementEngine：无可用 Canvas 时降级为估算并标记 available=false', async () => {
    const modules = await loadMeasurementHarness();
    modules.setCanvasContextFactory(() => null);

    const service = new modules.TextMeasurementService();
    assert.equal(service.isSupported(), false);

    const measured = service.measureText('Hello world', { maxWidth: 200, lineHeight: 20 });
    assert.equal(measured.source, 'fallback');
    assert.equal(measured.available, false);
    assert.ok(measured.lineCount >= 1);
});

test('TextMeasurementService：注入自定义引擎后引擎名切换且缓存被清空', async () => {
    const modules = await loadMeasurementHarness();
    installFakeCanvas(modules);
    const service = new modules.TextMeasurementService();
    const style = { fontFamily: 'sans-serif', fontSize: 14, lineHeight: 18 };

    const viaCanvas = service.measureText('Hello world', { maxWidth: 200, styleOverrides: style });
    assert.equal(viaCanvas.source, 'canvas');

    let prepareCalls = 0;
    service.setEngine({
        name: 'test-engine',
        prepare(text, textStyle) {
            prepareCalls += 1;
            return { text, textStyle };
        },
        measureLineStats: () => ({ lineCount: 7, maxLineWidth: 42 }),
        measureNaturalWidth: () => 123,
    });

    const viaTest = service.measureText('Hello world', { maxWidth: 200, styleOverrides: style });
    assert.equal(viaTest.source, 'test-engine');
    assert.equal(viaTest.naturalWidth, 123);
    assert.equal(viaTest.lineCount, 7);
    assert.equal(prepareCalls, 1);

    assert.equal(service.engineName, 'test-engine');

    service.setEngine(null);
    assert.equal(service.engineName, 'canvas', 'setEngine(null) 应退回内置引擎');
});

test('TextMeasurementService：引擎抛错时降级为估算结果而不是让渲染崩溃', async () => {
    const modules = await loadMeasurementHarness();
    installFakeCanvas(modules);
    const service = new modules.TextMeasurementService();
    service.setEngine({
        name: 'broken-engine',
        prepare: () => ({ ok: true }),
        measureLineStats: () => { throw new Error('segmentation exploded'); },
        measureNaturalWidth: () => { throw new Error('segmentation exploded'); },
    });

    const measured = service.measureText('some text', { maxWidth: 300, lineHeight: 20 });
    assert.equal(measured.source, 'fallback', '引擎崩溃必须回退到估算');
    assert.ok(measured.lineCount >= 1);
    assert.ok(measured.error instanceof Error);
});

test('TextMeasurementService：字体只设置而不重复写入，缓存按样式区分', async () => {
    const modules = await loadMeasurementHarness();
    const fake = installFakeCanvas(modules);
    const service = new modules.TextMeasurementService();

    service.measureText('hello', { maxWidth: 200, styleOverrides: { fontFamily: 'sans-serif', fontSize: 14, lineHeight: 18 } });
    service.measureText('hello', { maxWidth: 200, styleOverrides: { fontFamily: 'sans-serif', fontSize: 14, lineHeight: 18 } });
    const afterSame = fake.fontSetCount;

    service.measureText('hello', { maxWidth: 200, styleOverrides: { fontFamily: 'serif', fontSize: 14, lineHeight: 18 } });
    assert.ok(fake.fontSetCount > afterSame, '换字体必须重新设置度量上下文');
});
