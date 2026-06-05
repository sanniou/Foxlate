import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

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
        i18n: {
            getMessage(key) {
                const messages = {
                    popupTranslatePage: 'Translate Page',
                    popupShowOriginal: 'Show Original',
                    popupRuleDefault: 'Using default settings',
                    googleTranslate: 'Google',
                    deeplxTranslate: 'DeepLx',
                    displayModeTranslated: 'Translated',
                    displayModeBilingual: 'Bilingual',
                    displayModeOriginal: 'Original',
                    subtitleDisplayModeOff: 'Off',
                    subtitleDisplayModeTranslated: 'Translated',
                    subtitleDisplayModeBilingual: 'Bilingual',
                    auto: 'Auto',
                    english: 'English',
                    simplifiedChinese: 'Chinese',
                    japanese: 'Japanese',
                    korean: 'Korean',
                    french: 'French',
                    german: 'German',
                    spanish: 'Spanish',
                    russian: 'Russian',
                };
                return messages[key] || key;
            },
            getUILanguage() {
                return 'en-US';
            },
        },
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

function setupDom() {
    const dom = new JSDOM(`<!doctype html><html><body>
        <select id="sourceLanguageSelect"></select>
        <select id="targetLanguageSelect"></select>
        <select id="engineSelect"></select>
        <select id="displayModeSelect"></select>
        <button id="translatePageBtn"><span class="btn-text"></span></button>
        <input type="checkbox" id="autoTranslate">
        <input type="checkbox" id="scrollIdleTranslation">
        <span id="currentRuleIndicator"></span>
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

    renderer.populateSelect(elements.engineSelect, { google: 'googleTranslate', deeplx: 'deeplxTranslate' }, 'deeplx');
    renderer.renderTranslationButtonState('translated');
    renderer.renderRuleIndicator('default');

    assert.equal(elements.engineSelect.value, 'deeplx');
    assert.equal(elements.engineSelect.selectedOptions[0].textContent, 'DeepLx');
    assert.equal(elements.translatePageBtn.dataset.state, 'translated');
    assert.equal(elements.translatePageBtn.querySelector('.btn-text').textContent, 'Show Original');
    assert.equal(elements.currentRuleIndicator.textContent, 'Using default settings');
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
});
