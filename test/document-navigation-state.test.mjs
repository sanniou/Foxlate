import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

// 同一标签页内的第二次导航必须重新注入。
//
// 注入记录按 (tabId, frameId) 保存，而 frameId 跨文档不变 —— 顶层文档被替换后，
// 旧记录已经指向一个不存在的执行环境。若此时不清除，`isFrameInjected` 会命中陈旧
// 记录，`ensureScriptsInjected` 直接短路返回 true，后续 `tabs.sendMessage` 抛
// "Receiving end does not exist"，该标签页的翻译/摘要/字幕全部失效且无法自愈。

const CSS_FILES = ['content/style.css'];
const CORE_SCRIPT_FILES = ['content/content-script.js'];

let bundled;

async function loadModules() {
    if (bundled) {
        return bundled;
    }
    // 模块级 `export default new TabStateManager()` 在 import 时就会访问浏览器全局，
    // 所以 mock 必须先就位再打包。
    globalThis.__foxlateBrowserMock = createBrowserMock();
    bundled = await bundleModule([
        reexportSource('src/background/navigation-handler.js', ['createNavigationHandler']),
        reexportSource('src/background/script-injector.js', ['createEnsureScriptsInjected']),
        reexportSource('src/background/tab-state-manager.js', ['TabStateManager']),
    ].join('\n'), { prefix: 'foxlate-navigation-state-' });
    return bundled;
}

function createBrowserMock() {
    const storage = {};
    const calls = { executeScript: [], insertCSS: [] };

    return {
        calls,
        storage,
        runtime: {
            onMessage: { addListener() {} },
            onInstalled: { addListener() {} },
            sendMessage: async () => ({ success: true }),
        },
        tabs: {
            onRemoved: { addListener() {} },
            sendMessage: async () => ({ success: true }),
            query: async () => [],
        },
        scripting: {
            async insertCSS({ files }) {
                calls.insertCSS.push([...files]);
            },
            async executeScript({ files }) {
                calls.executeScript.push([...files]);
            },
        },
        action: {
            setBadgeText: async () => {},
            setBadgeBackgroundColor: async () => {},
        },
        storage: {
            onChanged: { addListener() {} },
            session: {
                async get(keys) {
                    const names = Array.isArray(keys) ? keys : [keys];
                    const result = {};
                    for (const name of names) {
                        if (storage[name] !== undefined) {
                            result[name] = structuredClone(storage[name]);
                        }
                    }
                    return result;
                },
                async set(patch) {
                    Object.assign(storage, structuredClone(patch));
                },
            },
        },
    };
}

async function setup() {
    const { createNavigationHandler, createEnsureScriptsInjected, TabStateManager } = await loadModules();
    const browser = createBrowserMock();
    globalThis.__foxlateBrowserMock = browser;

    const tabStateManager = new TabStateManager(browser);
    const ensureScriptsInjected = createEnsureScriptsInjected({
        browserApi: browser,
        tabStateManager,
        logError: () => {},
    });

    const errors = [];
    const interruptedTabs = [];
    const handleNavigation = createNavigationHandler({
        browserApi: browser,
        ensureScriptsInjected,
        handleSubtitleInjection: async () => {},
        tabStateManager,
        logError: (context, error) => errors.push([context, error]),
        interruptTab: tabId => interruptedTabs.push(tabId),
        settingsManager: { getEffectiveSettings: async () => ({ autoTranslate: 'manual' }) },
        cssFiles: CSS_FILES,
        coreScriptFiles: CORE_SCRIPT_FILES,
    });

    return { browser, tabStateManager, handleNavigation, errors, interruptedTabs };
}

test('re-injects core scripts after an in-tab full navigation', async () => {
    const { browser, handleNavigation } = await setup();

    await handleNavigation({ tabId: 7, url: 'https://example.com/', frameId: 0 }, { documentReplaced: true });
    assert.equal(browser.calls.executeScript.length, 1, '首次导航应注入一次');

    await handleNavigation({ tabId: 7, url: 'https://example.com/other', frameId: 0 }, { documentReplaced: true });
    assert.equal(browser.calls.executeScript.length, 2, '第二次导航必须重新注入');
    assert.deepEqual(browser.calls.executeScript[1], CORE_SCRIPT_FILES);
});

test('keeps the injection record across SPA history navigations', async () => {
    const { browser, handleNavigation } = await setup();

    await handleNavigation({ tabId: 7, url: 'https://example.com/', frameId: 0 }, { documentReplaced: true });
    await handleNavigation({ tabId: 7, url: 'https://example.com/spa', frameId: 0 });

    assert.equal(browser.calls.executeScript.length, 1, 'SPA 路由仍是同一个文档，不得重复注入');
});

test('clears the stale translation state when the document is replaced', async () => {
    const { browser, tabStateManager, handleNavigation } = await setup();

    await handleNavigation({ tabId: 7, url: 'https://example.com/', frameId: 0 }, { documentReplaced: true });
    await tabStateManager.setTabStatus(7, 'translated');

    await handleNavigation({ tabId: 7, url: 'https://example.com/other', frameId: 0 }, { documentReplaced: true });

    assert.deepEqual(await tabStateManager.getActiveTabIds(), [], '新文档不该沿用上一页的翻译状态');
    assert.equal(browser.storage.injectedFrames?.[7], undefined, '注入记录必须被清除');
});

test('keeps session-level auto translation registration across navigations', async () => {
    const { tabStateManager, handleNavigation } = await setup();

    await tabStateManager.registerTabForAutoTranslation(7, 'example.com');
    await handleNavigation({ tabId: 7, url: 'https://example.com/other', frameId: 0 }, { documentReplaced: true });

    assert.equal(await tabStateManager.isTabRegisteredForAutoTranslation(7, 'example.com'), true);
});

test('interrupts the tab\'s translation jobs when its document is replaced', async () => {
    const { handleNavigation, interruptedTabs } = await setup();

    await handleNavigation({ tabId: 7, url: 'https://example.com/', frameId: 0 }, { documentReplaced: true });
    await handleNavigation({ tabId: 7, url: 'https://example.com/other', frameId: 0 }, { documentReplaced: true });

    // 首次导航时调度器里没有作业，interrupt 是无操作；关键是每次文档替换都发出中止信号。
    assert.deepEqual(interruptedTabs, [7, 7], '旧文档的翻译作业已经没有接收方，必须在导航时中止');
});

test('does not interrupt jobs on SPA history navigations', async () => {
    const { handleNavigation, interruptedTabs } = await setup();

    await handleNavigation({ tabId: 7, url: 'https://example.com/', frameId: 0 }, { documentReplaced: true });
    const before = interruptedTabs.length;
    await handleNavigation({ tabId: 7, url: 'https://example.com/spa', frameId: 0 });

    assert.equal(interruptedTabs.length, before, '同一文档仍在跑，SPA 路由不能把它打断');
});
