// story: e05s01
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function bundleModules() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-mode-switch-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');
    await writeFile(mockBrowserPath, `
        export default {
            i18n: { getMessage: (k) => k, getUILanguage: () => 'en' },
            runtime: {
                sendMessage: async () => ({}),
                onMessage: { addListener() {} },
            },
        };
    `);
    await writeFile(entryPath, `
        export { DisplayManager } from ${JSON.stringify(path.join(projectRoot, 'src/content/display-manager.js'))};
        export { ContentRuntime } from ${JSON.stringify(path.join(projectRoot, 'src/content/content-runtime.js'))};
    `);
    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'polyfill-mock',
            setup(b) {
                b.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({ path: mockBrowserPath }));
            },
        }],
    });
    const mod = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return mod;
}

function setupDom(html = '<p id="t">Hello world</p>') {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Node = dom.window.Node;
    globalThis.WeakRef = globalThis.WeakRef || class WeakRef {
        #v;
        constructor(v) { this.#v = v; }
        deref() { return this.#v; }
    };
    return dom;
}

test('updateDisplayMode switches append UI to replace using stored originalContent', async () => {
    setupDom();
    const { DisplayManager } = await bundleModules();
    const el = document.getElementById('t');
    const original = el.innerHTML;

    DisplayManager.registerElement('ut-1', el);
    await DisplayManager.displayLoading(el, 'append', {
        originalContent: original,
        translationUnit: { appendType: 'inline', nodeMap: {} },
    });
    await DisplayManager.displayTranslation(el, {
        translatedText: '你好世界',
        plainText: '你好世界',
    });

    assert.equal(DisplayManager.getElementState(el), 'translated');
    assert.ok(el.querySelector('.foxlate-appended-text'), 'append chrome present');
    assert.equal(el.dataset.translationStrategy, 'append');

    await DisplayManager.updateDisplayMode('replace');

    assert.equal(el.dataset.translationStrategy, 'replace');
    assert.equal(el.querySelector('.foxlate-appended-text'), null, 'append chrome removed');
    assert.match(el.textContent, /你好世界/);
    assert.equal(DisplayManager.getElementState(el), 'translated');
});

test('updateDisplayMode switches replace back to hover and restores host text for tooltip', async () => {
    setupDom();
    const { DisplayManager } = await bundleModules();
    const el = document.getElementById('t');
    const original = el.innerHTML;

    DisplayManager.registerElement('ut-2', el);
    await DisplayManager.displayLoading(el, 'replace', {
        originalContent: original,
        translationUnit: { nodeMap: {} },
    });
    await DisplayManager.displayTranslation(el, {
        translatedText: '你好世界',
        plainText: '你好世界',
    });
    assert.match(el.textContent, /你好世界/);

    await DisplayManager.updateDisplayMode('hover');

    assert.equal(el.dataset.translationStrategy, 'hover');
    assert.equal(el.innerHTML, original, 'host text restored for hover mode');
    assert.ok(el.classList.contains('foxlate-hover-highlight'));
});

test('SETTINGS_UPDATED re-resolves effective settings instead of applying raw global payload', async () => {
    const dom = setupDom();
    const { ContentRuntime } = await bundleModules();

    const effective = {
        displayMode: 'hover',
        targetLanguage: 'ZH',
        translatorEngine: 'google',
        translationSelector: { content: 'p', exclude: 'nav' },
        glossary: { enabled: false, entries: [] },
        quickActionPanel: { enabled: true, showOnSelection: true },
        summarySettings: {},
        source: 'example.com',
    };

    let getEffectiveCalls = 0;
    const modeCalls = [];
    const runtime = new ContentRuntime({
        browserApi: {
            runtime: {
                onMessage: { addListener() {} },
                sendMessage: async () => ({}),
                getURL: (p) => p,
            },
            i18n: { getMessage: (k) => k },
        },
        win: dom.window,
        displayManager: {
            updateDisplayMode: async (mode) => { modeCalls.push(mode); },
            handleEphemeralTranslation() {},
        },
        getEffectiveSettings: async () => {
            getEffectiveCalls += 1;
            return effective;
        },
        cssFilePath: 'content/style.css',
        PageTranslationJobClass: class {
            constructor(tabId, settings) {
                this.tabId = tabId;
                this.settings = settings;
                this.state = 'translated';
            }
            async start() {}
            async revert() { this.state = 'idle'; }
        },
        QuickActionPanelClass: class {
            initialize() {}
            updateSettings() {}
            destroy() {}
        },
        initializeSummaryFn() {},
        initializeInputHandlerFn() {},
    });

    await runtime.initialize();
    runtime.currentPageJob = {
        tabId: 1,
        state: 'translated',
        settings: { displayMode: 'append', translationSelector: { content: 'p' } },
    };

    const rawGlobal = {
        displayMode: 'append',
        translationSelector: { default: { content: 'div' } },
        domainRules: { 'example.com': { displayMode: 'hover' } },
    };

    await runtime.handleSettingsUpdated(rawGlobal);

    assert.equal(getEffectiveCalls >= 1, true);
    assert.equal(runtime.currentPageJob.settings.displayMode, 'hover');
    assert.equal(runtime.currentPageJob.settings.translationSelector.content, 'p');
    assert.deepEqual(modeCalls.slice(-1), ['hover']);
});
