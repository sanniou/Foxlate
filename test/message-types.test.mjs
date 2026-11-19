import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createI18nMock } from './helpers/i18n-mock.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function loadModules(entrySource) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-message-types-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, entrySource);
    // 与其它测试一致的 mock 策略：把 lib/browser-polyfill 换成读全局的转接层。
    await writeFile(mockBrowserPath, 'export default globalThis.__foxlateBrowserMock;');

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'foxlate-message-type-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({ path: mockBrowserPath }));
            },
        }],
    });

    const modules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

async function loadMessageTypes() {
    return loadModules(`
        export { MESSAGE_TYPES } from ${JSON.stringify(path.join(projectRoot, 'src/common/message-types.js'))};
    `);
}

async function loadBackgroundHandlers() {
    globalThis.__foxlateBrowserMock = {
        i18n: createI18nMock(),
        tabs: { sendMessage: async () => {}, query: async () => [] },
        // 模块初始化阶段会订阅 storage.onChanged，夹具必须提供。
        storage: {
            onChanged: { addListener: () => {} },
            local: { get: async () => ({}), set: async () => {} },
            sync: { get: async () => ({}), set: async () => {} },
        },
    };
    return loadModules(
        `export { createBackgroundMessageHandlers } from ${JSON.stringify(path.join(projectRoot, 'src/background/background-message-handlers.js'))};`
    );
}

/**
 * 消息类型的完整分类。
 *
 * 三张表必须**无重叠、无遗漏**地覆盖 `MESSAGE_TYPES` 的全部取值：
 * 任何新增类型都必须被显式归类，不允许悄悄漂在协议里没人处理。
 */
const BACKGROUND_INBOUND_TYPES = [
    // translation-handlers
    'TRANSLATE_TEXT', 'TRANSLATE_TEXT_BATCH', 'TEST_TRANSLATE_TEXT', 'TRANSLATE_BATCH', 'TRANSLATE_INPUT_TEXT', 'TEST_CONNECTION',
    // ai-task-handlers
    'SUMMARIZE_CONTENT', 'CONVERSE_WITH_AI', 'INFER_SUGGESTIONS',
    // settings-handlers
    'GET_EFFECTIVE_SETTINGS', 'GET_VALIDATED_SETTINGS', 'SAVE_RULE_CHANGE',
    // tab-handlers
    'TOGGLE_TRANSLATION_REQUEST', 'TOGGLE_DISPLAY_MODE', 'STOP_TRANSLATION', 'TRANSLATION_STATUS_UPDATE', 'PING', 'GET_TAB_ID',
    // 摘要按需注入：content → SW 请求注入摘要包
    'ENSURE_SUMMARY_MODULE',
    // product-data-handlers
    'GET_CACHE_INFO', 'CLEAR_CACHE', 'GET_TRANSLATION_HISTORY', 'CLEAR_TRANSLATION_HISTORY', 'GET_PROVIDER_HEALTH', 'CLEAR_PROVIDER_HEALTH',
    'GET_CLOUD_BACKUPS', 'UPLOAD_SETTINGS_TO_CLOUD', 'DOWNLOAD_SETTINGS_FROM_CLOUD', 'DELETE_CLOUD_BACKUP',
];

const CONTENT_INBOUND_TYPES = [
    'DISPLAY_SELECTION_TRANSLATION', 'RELOAD_TRANSLATION_JOB', 'REQUEST_SUBTITLE_TRANSLATION_STATUS', 'REQUEST_TRANSLATION_STATUS',
    'REVERT_PAGE_TRANSLATION', 'SETTINGS_UPDATED', 'TOGGLE_SUBTITLE_TRANSLATION', 'TOGGLE_SUMMARY_REQUEST',
    'TRANSLATE_PAGE_REQUEST', 'TRANSLATE_SELECTION_REQUEST',
];

const BACKGROUND_PUSH_TYPES = [
    'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT', 'TRANSLATE_TEXT_RESULT', 'TRANSLATE_TEXT_BATCH_RESULT',
    'UPDATE_DISPLAY_MODE', 'TRANSLATION_RETRY_SCHEDULED',
];

test('message type registry has stable unique values', async () => {
    const { MESSAGE_TYPES } = await loadMessageTypes();
    const values = Object.values(MESSAGE_TYPES);
    assert.equal(new Set(values).size, values.length);
    assert.equal(MESSAGE_TYPES.TRANSLATE_INPUT_TEXT, 'translateInputText');
    assert.equal(MESSAGE_TYPES.SAVE_RULE_CHANGE, 'SAVE_RULE_CHANGE');
});

test('every message type is classified exactly once as background-inbound, content-inbound, or background-push', async () => {
    const { MESSAGE_TYPES } = await loadMessageTypes();
    const all = new Set(Object.values(MESSAGE_TYPES));
    // 分类表写 key 名，这里统一解析成协议值。
    const classified = [...BACKGROUND_INBOUND_TYPES, ...CONTENT_INBOUND_TYPES, ...BACKGROUND_PUSH_TYPES]
        .map(name => MESSAGE_TYPES[name]);

    const duplicates = classified.filter((type, index) => classified.indexOf(type) !== index);
    assert.deepEqual(duplicates, [], '分类表里出现了重复归类或未知 key 的消息类型');

    const unclassified = [...all].filter(type => !classified.includes(type));
    assert.deepEqual(unclassified, [], '有消息类型没有被归类——新增协议时必须同步更新分类表');

    assert.equal(classified.length, all.size, '分类表覆盖数和协议取值数必须一致');
});

test('composed background handler map covers every background-inbound type and nothing else', async () => {
    const { MESSAGE_TYPES } = await loadMessageTypes();
    const { createBackgroundMessageHandlers } = await loadBackgroundHandlers();

    const handlers = createBackgroundMessageHandlers({
        browserApi: globalThis.__foxlateBrowserMock,
        settingsManager: stubSettingsManager(),
        translatorManager: stubTranslatorManager(),
        tabStateManager: {},
        ensureScriptsInjected: async () => true,
        setBadgeAndState: async () => {},
        cloudBackups: {},
        logError: () => {},
        cssFiles: [],
        coreScriptFiles: [],
    });

    const registered = Object.keys(handlers).sort();
    const expected = BACKGROUND_INBOUND_TYPES.map(name => MESSAGE_TYPES[name]).sort();
    assert.deepEqual(registered, expected, '组装后的 handler map 必须与后台入站协议一一对应');

    for (const type of expected) {
        assert.equal(typeof handlers[type], 'function', `${type} 必须由某个域提供处理函数`);
    }
});

// ---------------------------------------------------------------------------
// save-rule-change：走 SettingsManager，而不是 service worker 直接落库
// ---------------------------------------------------------------------------

function stubSettingsManager(overrides = {}) {
    return {
        getEffectiveSettings: async () => ({ translatorEngine: 'google', targetLanguage: 'ZH', displayMode: 'replace', source: 'default' }),
        getValidatedSettings: async () => ({}),
        saveDomainRuleProperty: async () => {},
        ...overrides,
    };
}

function stubTranslatorManager(overrides = {}) {
    return {
        translateText: async () => ({ text: '', translated: false, error: null, log: [] }),
        translateBatch: async () => [],
        summarize: async () => ({ success: true }),
        converse: async () => ({ success: true }),
        inferSuggestions: async () => ({ success: true, suggestions: [] }),
        interruptAll: async () => {},
        getCacheInfo: async () => ({}),
        clearCache: async () => {},
        ...overrides,
    };
}

async function createSaveRuleChangeHarness() {
    const { MESSAGE_TYPES } = await loadMessageTypes();
    const { createBackgroundMessageHandlers } = await loadBackgroundHandlers();

    const calls = [];
    const settingsManager = stubSettingsManager({
        saveDomainRuleProperty: async (domain, key, value) => {
            calls.push({ domain, key, value });
        },
    });

    const handlers = createBackgroundMessageHandlers({
        browserApi: globalThis.__foxlateBrowserMock,
        settingsManager,
        translatorManager: stubTranslatorManager(),
        tabStateManager: {},
        ensureScriptsInjected: async () => true,
        setBadgeAndState: async () => {},
        cloudBackups: {},
        logError: () => {},
    });

    return { handler: handlers[MESSAGE_TYPES.SAVE_RULE_CHANGE], calls };
}

test('save-rule-change handler persists through SettingsManager and maps ruleSource=default onto the hostname', async () => {
    const { handler, calls } = await createSaveRuleChangeHarness();
    assert.equal(typeof handler, 'function');

    // 站点规则：写到自己身上
    await handler({ payload: { hostname: 'news.example.com', ruleSource: 'news.example.com', key: 'displayMode', value: 'append' } });
    // 默认规则：ruleSource=default 时回落到 hostname
    await handler({ payload: { hostname: 'news.example.com', ruleSource: 'default', key: 'targetLanguage', value: 'ZH' } });

    assert.deepEqual(calls, [
        { domain: 'news.example.com', key: 'displayMode', value: 'append' },
        { domain: 'news.example.com', key: 'targetLanguage', value: 'ZH' },
    ]);
});

test('save-rule-change handler rejects an incomplete payload', async () => {
    const { handler, calls } = await createSaveRuleChangeHarness();

    await assert.rejects(
        () => handler({ payload: { hostname: '', key: 'displayMode', value: 'append' } }),
        /Missing hostname or key/,
    );
    await assert.rejects(
        () => handler({ payload: { hostname: 'news.example.com', value: 'append' } }),
        /Missing hostname or key/,
    );

    assert.deepEqual(calls, [], '非法载荷不得落库');
});

test('service worker dispatches through the handler map instead of bypassing it for rule writes', async () => {
    const serviceWorkerSource = await readFile(path.join(projectRoot, 'src/background/service-worker.js'), 'utf8');

    // 站点规则的写入只能落在 SettingsManager 上——service worker 不得越过它自己碰存储。
    assert.doesNotMatch(serviceWorkerSource, /saveDomainRuleProperty/);
    assert.doesNotMatch(serviceWorkerSource, /domainRules/);
    assert.match(serviceWorkerSource, /messageHandlers\[request\.type\]/, 'service worker 必须只经由 handler map 分发');
});
