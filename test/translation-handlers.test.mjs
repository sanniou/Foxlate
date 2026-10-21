// 翻译类消息处理器的行为测试。
//
// 这块此前零测试：`createTranslationHandlers` 是一个 311 行的工厂，没有任何用例
// 实例化过它。拆成 `translation/` 下一个 handler 一个文件之后，每个入口都能用
// 一组注入的桩直接驱动，于是「什么时候记历史、什么时候记失败队列、什么时候
// 只报错」这些真正有产品后果的分支才第一次被锁住。
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

// engine-test-handlers 里的 TEST_CONNECTION 会动态载入 AITranslator，
// 它引用 browser-polyfill；这里给出转接层需要的全局。
globalThis.__foxlateBrowserMock ??= {};

let modulesPromise;
function modules() {
    modulesPromise ??= (async () => {
        const [handlers, types] = await Promise.all([
            bundleModule(reexportSource('src/background/handlers/translation-handlers.js', ['createTranslationHandlers'])),
            bundleModule(reexportSource('src/common/message-types.js', ['MESSAGE_TYPES'])),
        ]);
        return { createTranslationHandlers: handlers.createTranslationHandlers, MESSAGE_TYPES: types.MESSAGE_TYPES };
    })();
    return modulesPromise;
}

/**
 * 组装一组可观测的依赖桩。
 * @param {object} [overrides]
 * @param {Function} [overrides.translateText]
 * @param {Function} [overrides.translateBatch]
 * @param {object}   [overrides.effectiveSettings]
 * @param {Function} [overrides.tabsSend]
 */
function makeHarness({ translateText, translateBatch, effectiveSettings, tabsSend } = {}) {
    const calls = { health: [], history: [], failures: [], errors: [], sent: [] };
    const deps = {
        browserApi: {
            tabs: {
                sendMessage: tabsSend ?? (async (tabId, message) => { calls.sent.push({ tabId, message }); }),
            },
        },
        settingsManager: {
            getEffectiveSettings: async () => effectiveSettings ?? {
                targetLanguage: 'zh-CN',
                translatorEngine: 'google',
                inputTranslationSettings: {},
            },
        },
        translatorManager: {
            translateText: translateText ?? (async () => ({ text: '译', translated: true, log: [] })),
            translateBatch: translateBatch ?? (async texts => texts.map(() => ({ text: '译', translated: true, log: [] }))),
        },
        historyStore: { recordSuccess: async entry => { calls.history.push(entry); } },
        failureQueue: { recordFailure: async entry => { calls.failures.push(entry); } },
        healthStore: { record: async entry => { calls.health.push(entry); } },
        logError: (label, error) => { calls.errors.push({ label, message: error?.message }); },
    };
    return { deps, calls };
}

const SENDER = { tab: { id: 7, url: 'https://example.com/a/b' } };

test('TRANSLATE_TEXT 成功：记一次健康度、一条历史，并把结果发回原标签页', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const { deps, calls } = makeHarness();
    const handlers = createTranslationHandlers(deps);

    await handlers[MESSAGE_TYPES.TRANSLATE_TEXT](
        { payload: { text: 'hello', targetLang: 'zh-CN', sourceLang: 'en', elementId: 'e1', translatorEngine: 'google' } },
        SENDER,
    );

    assert.equal(calls.health.length, 1, '健康度整条请求只记一次');
    assert.equal(calls.health[0].success, true);
    assert.equal(calls.health[0].engine, 'google');
    assert.equal(calls.health[0].error, null);

    assert.deepEqual(calls.history, [{
        sourceText: 'hello',
        translatedText: '译',
        targetLang: 'zh-CN',
        sourceLang: 'en',
        engine: 'google',
        hostname: 'example.com',
        surface: 'page',
    }]);
    assert.equal(calls.failures.length, 0);

    assert.equal(calls.sent.length, 1);
    assert.equal(calls.sent[0].tabId, 7);
    assert.deepEqual(calls.sent[0].message, {
        type: MESSAGE_TYPES.TRANSLATE_TEXT_RESULT,
        payload: { elementId: 'e1', success: true, translatedText: '译', wasTranslated: true, error: null },
    });
});

test('TRANSLATE_TEXT 缺 elementId：只报错，绝不发起翻译', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    let translateCalls = 0;
    const { deps, calls } = makeHarness({
        translateText: async () => { translateCalls += 1; return { text: '', translated: false, log: [] }; },
    });
    const handlers = createTranslationHandlers(deps);

    await handlers[MESSAGE_TYPES.TRANSLATE_TEXT]({ payload: { text: 'hi', targetLang: 'zh-CN' } }, SENDER);

    assert.equal(translateCalls, 0, '没有 elementId 就没有回送目标，不该白花钱');
    assert.equal(calls.health.length, 0);
    assert.equal(calls.errors.length, 1);
    assert.match(calls.errors[0].message, /Missing originTabId or elementId/);
});

test('TRANSLATE_TEXT 失败：进失败队列，不进历史', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const { deps, calls } = makeHarness({
        translateText: async () => ({ text: '', translated: false, log: [], error: '引擎超时' }),
    });
    const handlers = createTranslationHandlers(deps);

    await handlers[MESSAGE_TYPES.TRANSLATE_TEXT](
        { payload: { text: 'hello', targetLang: 'zh-CN', sourceLang: 'en', elementId: 'e1', translatorEngine: 'google' } },
        SENDER,
    );

    assert.equal(calls.history.length, 0);
    assert.equal(calls.failures.length, 1);
    assert.equal(calls.failures[0].error, '引擎超时');
    assert.equal(calls.failures[0].surface, 'page');
    assert.equal(calls.health[0].success, false);
    assert.equal(calls.health[0].error, '引擎超时');
    assert.equal(calls.sent[0].message.payload.success, false);
});

test('TRANSLATE_TEXT：页面跑掉的竞态不能把成功的翻译记成失败', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();

    // 翻译期间页面导航 / 标签关闭：回送结果时接收方已经不在了。
    // 这是正常竞态，不是故障——尤其不能反过来污染 provider health 与失败队列。
    const gone = makeHarness({
        tabsSend: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); },
    });
    await createTranslationHandlers(gone.deps)[MESSAGE_TYPES.TRANSLATE_TEXT](
        { payload: { text: 'hello', targetLang: 'zh-CN', sourceLang: 'en', elementId: 'e1', translatorEngine: 'google' } },
        SENDER,
    );
    assert.deepEqual(gone.calls.errors, [], '页面跑掉了不是故障，不该上报');
    assert.equal(gone.calls.health.length, 1, '健康度照常只记一次');
    assert.equal(gone.calls.health[0].success, true, '翻译确实成功了，不能记成失败');
    assert.equal(gone.calls.history.length, 1, '成功的翻译必须进历史');
    assert.deepEqual(gone.calls.failures, [], '不能往失败队列里塞假失败');

    const broken = makeHarness({
        tabsSend: async () => { throw new Error('tabs.sendMessage exploded'); },
    });
    await createTranslationHandlers(broken.deps)[MESSAGE_TYPES.TRANSLATE_TEXT](
        { payload: { text: 'hello', targetLang: 'zh-CN', sourceLang: 'en', elementId: 'e1', translatorEngine: 'google' } },
        SENDER,
    );
    assert.equal(broken.calls.errors.length, 1, '真正的发送故障要上报');
    assert.equal(broken.calls.errors[0].label, 'TRANSLATE_TEXT (sending error)');
});

test('TRANSLATE_TEXT_BATCH 部分失败：健康度记聚合错误，历史与失败队列逐条记', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const { deps, calls } = makeHarness({
        translateBatch: async () => ([
            { text: 'A译', translated: true, log: [] },
            { text: '', translated: false, log: [], error: '单条失败' },
        ]),
    });
    const handlers = createTranslationHandlers(deps);

    await handlers[MESSAGE_TYPES.TRANSLATE_TEXT_BATCH]({
        payload: {
            batchId: 'b1',
            items: [{ elementId: 'e1', text: 'A' }, { elementId: 'e2', text: 'B' }],
            targetLang: 'zh-CN',
            sourceLang: 'en',
            translatorEngine: 'google',
        },
    }, SENDER);

    assert.equal(calls.health.length, 1, '整批只记一次，条数不该放大成功/失败计数');
    assert.equal(calls.health[0].success, false);
    assert.equal(calls.health[0].error, 'One or more batch items failed.');

    assert.equal(calls.history.length, 1);
    assert.equal(calls.history[0].sourceText, 'A');
    assert.equal(calls.history[0].surface, 'page-batch');
    assert.equal(calls.failures.length, 1);
    assert.equal(calls.failures[0].sourceText, 'B');
    assert.equal(calls.failures[0].surface, 'page-batch');

    assert.deepEqual(calls.sent[0].message.payload.items, [
        { elementId: 'e1', success: true, translatedText: 'A译', wasTranslated: true, error: null },
        { elementId: 'e2', success: false, translatedText: '', wasTranslated: false, error: '单条失败' },
    ]);
});

test('TEST_TRANSLATE_TEXT 失败不进失败队列（那是用户主动探测，不是真实失败）', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const { deps, calls } = makeHarness({
        translateText: async () => ({ text: '', translated: false, log: ['l1'], error: '连不上' }),
    });
    const handlers = createTranslationHandlers(deps);

    const response = await handlers[MESSAGE_TYPES.TEST_TRANSLATE_TEXT]({
        payload: { text: 'hi', targetLang: 'zh-CN', sourceLang: 'auto', translatorEngine: 'ai:x' },
    });

    assert.equal(calls.failures.length, 0);
    assert.equal(calls.history.length, 0);
    assert.equal(calls.health.length, 1);
    assert.equal(calls.health[0].success, false);
    assert.deepEqual(response, {
        success: false,
        translatedText: { text: '', translated: false },
        error: '连不上',
        log: ['l1'],
    });
});

test('TRANSLATE_INPUT_TEXT：输入框留「默认」时回落到域名级设置', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const seen = [];
    const { deps } = makeHarness({
        effectiveSettings: {
            targetLanguage: 'zh-CN',
            translatorEngine: 'deeplx',
            inputTranslationSettings: { targetLanguage: 'ja', translatorEngine: 'default' },
        },
        translateText: async (...args) => { seen.push(args); return { text: '译', translated: true, log: [] }; },
    });
    const handlers = createTranslationHandlers(deps);

    await handlers[MESSAGE_TYPES.TRANSLATE_INPUT_TEXT]({ payload: { text: 'hello' } }, SENDER);

    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], ['hello', 'ja', 'auto', 'deeplx', 7],
        '语向取输入框自己的，引擎留默认则回落域名级');
});

test('TRANSLATE_INPUT_TEXT：请求里的 targetLang 优先于两层设置', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const seen = [];
    const { deps } = makeHarness({
        effectiveSettings: {
            targetLanguage: 'zh-CN',
            translatorEngine: 'deeplx',
            inputTranslationSettings: { targetLanguage: 'ja', translatorEngine: 'ai:x' },
        },
        translateText: async (...args) => { seen.push(args); return { text: '译', translated: true, log: [] }; },
    });
    const handlers = createTranslationHandlers(deps);

    await handlers[MESSAGE_TYPES.TRANSLATE_INPUT_TEXT]({ payload: { text: 'hello', targetLang: 'ko' } }, SENDER);
    assert.deepEqual(seen[0], ['hello', 'ko', 'auto', 'ai:x', 7]);
});

test('TRANSLATE_INPUT_TEXT：sender 没有标签页上下文时直接拒绝', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const { deps, calls } = makeHarness();
    const handlers = createTranslationHandlers(deps);

    const response = await handlers[MESSAGE_TYPES.TRANSLATE_INPUT_TEXT]({ payload: { text: 'hi' } }, {});
    assert.deepEqual(response, { success: false, error: 'Invalid sender context.' });
    assert.equal(calls.errors.length, 1);
});

test('TRANSLATE_BATCH（API 入口）：缺省语言与引擎按域名规则补齐', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const seen = [];
    const { deps } = makeHarness({
        effectiveSettings: { targetLanguage: 'zh-CN', translatorEngine: 'google' },
        translateBatch: async (...args) => { seen.push(args); return [{ text: 'A译' }, { text: 'B译' }]; },
    });
    const handlers = createTranslationHandlers(deps);

    const response = await handlers[MESSAGE_TYPES.TRANSLATE_BATCH]({
        payload: { texts: ['A', 'B'], hostname: 'example.com' },
    });

    assert.deepEqual(seen[0], [['A', 'B'], 'zh-CN', 'auto', 'google']);
    assert.deepEqual(response, { success: true, translatedTexts: ['A译', 'B译'] });
});

test('TRANSLATE_BATCH（API 入口）：texts 不是数组时必须拒绝', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const { deps } = makeHarness();
    const handlers = createTranslationHandlers(deps);

    await assert.rejects(
        () => handlers[MESSAGE_TYPES.TRANSLATE_BATCH]({ payload: { texts: 'not-an-array' } }),
        /'texts' must be an array/,
    );
});

test('TEST_CONNECTION：只支持 AI 引擎，其他引擎原样拒绝且不记录健康度', async () => {
    const { createTranslationHandlers, MESSAGE_TYPES } = await modules();
    const { deps, calls } = makeHarness();
    const handlers = createTranslationHandlers(deps);

    const response = await handlers[MESSAGE_TYPES.TEST_CONNECTION]({ payload: { engine: 'google' } });

    assert.equal(response.success, false);
    assert.match(response.error, /only supported for AI engines/);
    assert.equal(calls.health.length, 0);
});
