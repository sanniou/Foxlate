import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createI18nMock, englishMessage } from './helpers/i18n-mock.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function bundlePopupModules() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-popup-architecture-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { PopupApp } from ${JSON.stringify(path.join(projectRoot, 'src/popup/popup-app.js'))};
        export { PopupActions, getHostname } from ${JSON.stringify(path.join(projectRoot, 'src/popup/popup-actions.js'))};
        export { queryPopupElements } from ${JSON.stringify(path.join(projectRoot, 'src/popup/popup-elements.js'))};
        export { PopupRenderer } from ${JSON.stringify(path.join(projectRoot, 'src/popup/popup-renderer.js'))};
        export { bindPopupEvents } from ${JSON.stringify(path.join(projectRoot, 'src/popup/popup-events.js'))};
    `);
    await writeFile(mockBrowserPath, 'export default globalThis.__foxlateBrowserMock;');

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'foxlate-popup-test-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({
                    path: mockBrowserPath,
                }));
            },
        }],
    });

    installBrowserMock();
    const modules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

function installBrowserMock() {
    globalThis.__foxlateBrowserMock = {
        i18n: createI18nMock(),
        runtime: {
            getManifest: () => ({ version: '1.6.0' }),
            onMessage: { addListener: () => {} },
            openOptionsPage: () => {},
            sendMessage: async () => ({}),
        },
        tabs: {
            query: async () => [],
            sendMessage: async () => ({}),
        },
        storage: {
            onChanged: { addListener: () => {} },
            local: {
                get: async () => ({}),
                set: async () => {},
            },
            sync: {
                get: async () => ({}),
                set: async () => {},
            },
        },
    };
}

function setupDom(html) {
    const dom = new JSDOM(html || `<!doctype html><html><body>
        <select id="sourceLanguageSelect"></select>
        <select id="targetLanguageSelect"></select>
        <select id="engineSelect"></select>
        <div id="displayModeGroup" class="segmented" role="radiogroup">
            <button type="button" class="segment" data-mode="replace" role="radio">Replace</button>
            <button type="button" class="segment" data-mode="append" role="radio">Append</button>
            <button type="button" class="segment" data-mode="hover" role="radio">Hover</button>
        </div>
        <button id="translatePageBtn"><span class="btn-text"></span></button>
        <input type="checkbox" id="autoTranslate">
        <input type="checkbox" id="scrollIdleTranslation">
        <span id="currentRuleIndicator"></span>
        <span id="glossaryIndicator" class="meta-pill" hidden></span>
        <button id="openOptionsBtn"></button>
        <button id="swapLanguagesBtn"></button>
        <select id="subtitleDisplayModeSelect"></select>
        <section class="subtitle-section"></section>
        <span id="versionDisplay"></span>
        <div id="error-display"></div>
    </body></html>`, { pretendToBeVisual: true });

    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Element = dom.window.Element;
    globalThis.SVGElement = dom.window.SVGElement;
    globalThis.MutationObserver = dom.window.MutationObserver;
    Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: () => null,
    });
    installBrowserMock();
    return dom;
}

test('popup entry stays a bootstrap module after architecture split', async () => {
    const source = await readFile(path.join(projectRoot, 'src/popup/popup.js'), 'utf8');
    assert.match(source, /bootPopupApp/);
    assert.ok(source.split('\n').length <= 5);
});

test('popup modules own element lookup and translated select rendering', async () => {
    setupDom();
    const { queryPopupElements, PopupRenderer } = await bundlePopupModules();
    const elements = queryPopupElements(document);
    const renderer = new PopupRenderer(elements);

    // 用真实的引擎映射表取 key，避免测试里手写的假 key 与产品侧脱节。
    renderer.populateSelect(
        elements.engineSelect,
        { google: 'googleTranslate', deeplx: 'deeplx' },
        'deeplx',
    );
    renderer.renderTranslationButtonState('translated');
    renderer.renderRuleIndicator('default');

    assert.equal(elements.engineSelect.value, 'deeplx');
    assert.equal(elements.engineSelect.selectedOptions[0].textContent, englishMessage('deeplx'));
    assert.equal(elements.translatePageBtn.dataset.state, 'translated');
    assert.equal(elements.translatePageBtn.querySelector('.btn-text').textContent, englishMessage('popupShowOriginal'));
    assert.equal(elements.currentRuleIndicator.textContent, englishMessage('popupRuleDefault'));
});

test('every i18n-text element in the real popup markup receives localized text', async () => {
    // 用真实 popup.html，而不是测试自己手抄的瘦身版 DOM：
    // 这样“标记里写了 i18n-text，但应用阶段没真正写进去”的缺陷才逃不掉。
    const popupHtml = await readFile(path.join(projectRoot, 'src/popup/popup.html'), 'utf8');
    const dom = setupDom(popupHtml);
    const { PopupRenderer, queryPopupElements } = await bundlePopupModules();

    const zhMessages = JSON.parse(await readFile(path.join(projectRoot, 'public/_locales/zh_CN/messages.json'), 'utf8'));
    const renderer = new PopupRenderer(queryPopupElements(dom.window.document), {
        browserApi: {
            i18n: {
                getMessage: (key) => zhMessages[key]?.message ?? '',
                getUILanguage: () => 'zh-CN',
            },
        },
    });

    renderer.applyTranslations(dom.window.document);

    // 逐个元素回查：消息必须真的落到可见文本上。
    // 典型漏网：分段按钮没有 .btn-text 子元素，旧实现会整段跳过。
    const notApplied = [];
    for (const element of dom.window.document.querySelectorAll('[i18n-text]')) {
        const key = element.getAttribute('i18n-text');
        const expected = zhMessages[key]?.message;
        assert.ok(expected, `${key} 必须在 zh_CN 词典中存在`);

        const textTarget = element.querySelector('.btn-text') ?? element;
        if (textTarget.textContent.trim() !== expected) {
            notApplied.push(`${key}: 实际 ${JSON.stringify(textTarget.textContent.trim())}，应为 ${JSON.stringify(expected)}`);
        }
    }

    assert.deepEqual(notApplied, [], `以下 i18n-text 元素没有拿到本地化文案：\n${notApplied.join('\n')}`);
    assert.equal(dom.window.document.documentElement.lang, 'zh-CN');

    // 主按钮的图标/加载态子元素不能被文案写入清掉。
    const primaryButton = dom.window.document.querySelector('#translatePageBtn');
    assert.equal(primaryButton.querySelector('.btn-text').textContent, zhMessages.popupTranslatePage.message);
    assert.ok(primaryButton.querySelector('.btn-spinner'), '写文案不得删除按钮里的 spinner');

    // 分段按钮就是回归现场，单独钉一下。
    assert.equal(
        dom.window.document.querySelector('#displayModeGroup [data-mode="replace"]').textContent.trim(),
        zhMessages.popupDisplayModeReplace.message,
    );
});

test('popup action layer uses host-scoped settings and message registry protocols', async () => {
    setupDom();
    const { PopupActions, PopupRenderer, queryPopupElements, getHostname } = await bundlePopupModules();
    const elements = queryPopupElements(document);
    const renderer = new PopupRenderer(elements);
    const state = {
        activeTabId: 9,
        currentHostname: 'docs.example.com',
        currentRuleSource: 'default',
    };
    const saved = [];
    const messages = [];
    const browserApi = {
        ...globalThis.__foxlateBrowserMock,
        runtime: {
            ...globalThis.__foxlateBrowserMock.runtime,
            sendMessage: async (message) => {
                messages.push(message);
                return {};
            },
        },
        tabs: {
            ...globalThis.__foxlateBrowserMock.tabs,
            sendMessage: async () => ({ state: 'original' }),
        },
    };

    const actions = new PopupActions({
        elements,
        renderer,
        state,
        browserApi,
        settingsManager: {
            saveDomainRuleProperty: async (...args) => saved.push(args),
        },
    });

    assert.equal(getHostname('https://docs.example.com/path'), 'docs.example.com');
    assert.equal(getHostname('about:blank'), null);

    await actions.saveChangeToRule('targetLanguage', 'zh-CN');
    await actions.handleTranslateButtonClick();

    assert.deepEqual(saved, [['docs.example.com', 'targetLanguage', 'zh-CN']]);
    assert.equal(messages[0].type, 'TOGGLE_TRANSLATION_REQUEST');
    assert.equal(messages[0].payload.tabId, 9);

    const tabMessages = [];
    browserApi.tabs.sendMessage = async (_tabId, message) => {
        tabMessages.push(message);
        return { state: 'original' };
    };
    await actions.handleDisplayModeChange('hover');
    assert.equal(elements.displayModeGroup.querySelector('[data-mode="hover"]').classList.contains('is-active'), true);
    assert.deepEqual(saved.at(-1), ['docs.example.com', 'displayMode', 'hover']);
    assert.equal(tabMessages[0].type, 'UPDATE_DISPLAY_MODE');
    assert.equal(tabMessages[0].payload.displayMode, 'hover');
    assert.equal(state.currentRuleSource, 'docs.example.com');
});
