import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function bundleContentRuntimeModules() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-content-runtime-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');
    const mockSummaryPath = path.join(tempDir, 'summary-mock.js');
    const mockInputHandlerPath = path.join(tempDir, 'input-handler-mock.js');
    const mockHudPath = path.join(tempDir, 'hud-mock.js');

    await writeFile(entryPath, `
        export { ContentRuntime } from ${JSON.stringify(path.join(projectRoot, 'src/content/content-runtime.js'))};
        export { TranslationBatchQueue } from ${JSON.stringify(path.join(projectRoot, 'src/content/translation-batch-queue.js'))};
        export { ElementTranslationController } from ${JSON.stringify(path.join(projectRoot, 'src/content/element-translation-controller.js'))};
    `);
    await writeFile(mockBrowserPath, 'export default globalThis.__foxlateBrowserMock;');
    await writeFile(mockSummaryPath, 'export function initializeSummary(settings) { globalThis.__summaryCalls.push(settings); }');
    await writeFile(mockInputHandlerPath, 'export function initializeInputHandler() { globalThis.__inputHandlerCalls += 1; }');
    await writeFile(mockHudPath, `
        export class TranslationPerformanceHud {
            constructor() { this.calls = []; }
            update(payload) { this.calls.push(['update', payload]); }
            updateBatch(payload) { this.calls.push(['batch', payload]); }
            updateRetry(payload) { this.calls.push(['retry', payload]); }
            reset() { this.calls.push(['reset']); }
            hide(payload) { this.calls.push(['hide', payload]); }
        }
    `);

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'content-runtime-test-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({ path: mockBrowserPath }));
                buildContext.onResolve({ filter: /summary\/summary\.js$/ }, () => ({ path: mockSummaryPath }));
                buildContext.onResolve({ filter: /input-handler\.js$/ }, () => ({ path: mockInputHandlerPath }));
                buildContext.onResolve({ filter: /translation-performance-hud\.js$/ }, () => ({ path: mockHudPath }));
            },
        }],
    });

    installBrowserMock();
    globalThis.__summaryCalls = [];
    globalThis.__inputHandlerCalls = 0;
    const modules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

function installBrowserMock() {
    globalThis.__foxlateBrowserMock = {
        runtime: {
            getURL(pathname) {
                return `extension://${pathname}`;
            },
            onMessage: {
                addListener() {},
            },
            sendMessage: async () => ({}),
        },
        i18n: {
            getMessage(key) {
                return key;
            },
        },
    };
}

function setupDom(html = '<main></main>') {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
        url: 'https://example.com/page',
        pretendToBeVisual: true,
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.self = {
        crypto: {
            randomUUID: () => 'uuid',
        },
    };
    return dom;
}

function createRuntimeBrowserMock({ settings }) {
    const messages = [];
    let messageListener = null;
    return {
        messages,
        get messageListener() {
            return messageListener;
        },
        runtime: {
            getURL(pathname) {
                return `extension://${pathname}`;
            },
            onMessage: {
                addListener(listener) {
                    messageListener = listener;
                },
            },
            async sendMessage(message) {
                messages.push(message);
                if (message.type === 'GET_EFFECTIVE_SETTINGS') return settings;
                if (message.type === 'GET_TAB_ID') return { tabId: 99 };
                return {};
            },
        },
        i18n: {
            getMessage(key) {
                return key;
            },
        },
    };
}

function createSettings() {
    return {
        targetLanguage: 'zh',
        translatorEngine: 'google',
        displayMode: 'append',
        translationSelector: { content: 'p' },
        summarySettings: { enabled: true },
    };
}

test('translation batch queue groups compatible AI requests under one protocol message', async () => {
    setupDom();
    const { TranslationBatchQueue } = await bundleContentRuntimeModules();
    const sentMessages = [];
    const batchStates = [];
    const browserMock = {
        runtime: {
            async sendMessage(message) {
                sentMessages.push(message);
                return {};
            },
        },
    };
    const queue = new TranslationBatchQueue({
        browserApi: browserMock,
        generateId: () => 'batch-1',
        maxItems: 2,
        onBatchStateChange: (state) => batchStates.push(state),
    });

    queue.enqueue({
        elementId: 'one',
        text: 'Hello',
        targetLang: 'zh',
        sourceLang: 'auto',
        translatorEngine: 'ai:model',
    });
    queue.enqueue({
        elementId: 'two',
        text: 'World',
        targetLang: 'zh',
        sourceLang: 'auto',
        translatorEngine: 'ai:model',
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    // No GET_TAB_ID hop — SW uses sender.tab.id for content-script batches.
    assert.equal(sentMessages.length, 1);
    assert.deepEqual(sentMessages[0], {
        type: 'TRANSLATE_TEXT_BATCH',
        payload: {
            batchId: 'fb-batch-1',
            items: [
                { elementId: 'one', text: 'Hello' },
                { elementId: 'two', text: 'World' },
            ],
            targetLang: 'zh',
            sourceLang: 'auto',
            translatorEngine: 'ai:model',
            tabId: undefined,
        },
    });
    assert.equal(batchStates.at(-1).inFlight, 1);
});

test('content runtime initializes once and routes page translation messages through the controller', async () => {
    const dom = setupDom();
    const settings = createSettings();
    const browserMock = createRuntimeBrowserMock({ settings });
    const { ContentRuntime } = await bundleContentRuntimeModules();
    const jobEvents = [];
    class FakePageTranslationJob {
        constructor(tabId, activeSettings, options) {
            this.tabId = tabId;
            this.settings = activeSettings;
            this.options = options;
            this.state = 'idle';
        }
        async start() {
            this.state = 'translating';
            jobEvents.push(['start', this.tabId, this.settings]);
        }
        async revert() {
            this.state = 'idle';
            jobEvents.push(['revert', this.tabId]);
            this.options.onReverted(this);
        }
    }
    const displayCalls = [];
    const runtime = new ContentRuntime({
        browserApi: browserMock,
        win: dom.window,
        PageTranslationJobClass: FakePageTranslationJob,
        displayManager: {
            updateDisplayMode: (mode) => displayCalls.push(['mode', mode]),
            handleEphemeralTranslation: (payload, frameId) => displayCalls.push(['selection', payload, frameId]),
        },
        getEffectiveSettings: async () => settings,
        cssFilePath: 'content/style.css',
    });

    await runtime.initialize();
    assert.equal(dom.window.foxlateContentScriptInitialized, true);
    assert.equal(typeof dom.window.getEffectiveSettings, 'function');
    assert.equal(typeof browserMock.messageListener, 'function');
    assert.deepEqual(globalThis.__summaryCalls, [settings]);
    assert.equal(globalThis.__inputHandlerCalls, 1);

    assert.deepEqual(await runtime.handleMessage({ type: 'REQUEST_TRANSLATION_STATUS' }), {
        state: 'original',
        emptyCandidates: false,
        allPrecheckSkipped: false,
    });
    assert.deepEqual(await runtime.handleMessage({ type: 'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT', payload: { tabId: 7 } }), { success: true });
    assert.deepEqual(jobEvents, [['start', 7, settings]]);
    assert.deepEqual(await runtime.handleMessage({ type: 'REQUEST_TRANSLATION_STATUS' }), {
        state: 'loading',
        emptyCandidates: false,
        allPrecheckSkipped: false,
    });

    assert.deepEqual(await runtime.handleMessage({ type: 'UPDATE_DISPLAY_MODE', payload: { displayMode: 'replace' } }), { success: true });
    assert.deepEqual(displayCalls, [['mode', 'replace']]);

    assert.deepEqual(await runtime.handleMessage({ type: 'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT', payload: { tabId: 7 } }), { success: true });
    assert.deepEqual(jobEvents, [['start', 7, settings], ['revert', 7]]);
    assert.deepEqual(await runtime.handleMessage({ type: 'REQUEST_TRANSLATION_STATUS' }), {
        state: 'original',
        emptyCandidates: false,
        allPrecheckSkipped: false,
    });
});

test('content-script entry stays a bootstrap module after runtime split', async () => {
    const source = await readFile(path.join(projectRoot, 'src/content/content-script.js'), 'utf8');
    assert.match(source, /initializeContentRuntime/);
    assert.ok(source.split('\n').length <= 8);
    assert.doesNotMatch(source, /PageTranslationJob|DisplayManager|TRANSLATE_TEXT_BATCH|onMessage\.addListener/);
});

test('display manager delegates state, language context, and strategy dispatch to display system modules', async () => {
    const displayManagerSource = await readFile(path.join(projectRoot, 'src/content/display-manager.js'), 'utf8');
    const registrySource = await readFile(path.join(projectRoot, 'src/content/display/display-strategy-registry.js'), 'utf8');
    const languageSource = await readFile(path.join(projectRoot, 'src/content/display/display-language-context.js'), 'utf8');

    assert.match(displayManagerSource, /DisplayStateStore/);
    assert.match(displayManagerSource, /defaultDisplayStrategyRegistry/);
    assert.match(displayManagerSource, /resolveDisplayLanguageContext/);
    assert.doesNotMatch(displayManagerSource, /_strategies/);
    assert.doesNotMatch(displayManagerSource, /new ReplaceStrategy|new AppendStrategy|new HoverStrategy/);

    assert.match(registrySource, /class DisplayStrategyRegistry/);
    assert.match(registrySource, /replaceStrategy/);
    assert.match(registrySource, /globalCleanup/);
    assert.match(languageSource, /enhancedContextMenu/);
    assert.match(languageSource, /getSpeechCode/);
});

test('tooltip and hover display surfaces are split into focused controllers', async () => {
    const enhancedTooltipSource = await readFile(path.join(projectRoot, 'src/content/enhanced-tooltip-manager.js'), 'utf8');
    const hoverStrategySource = await readFile(path.join(projectRoot, 'src/content/strategies/hover-strategy.js'), 'utf8');
    const hoverSurfaceSource = await readFile(path.join(projectRoot, 'src/content/tooltip/hover-tooltip-surface.js'), 'utf8');

    assert.match(enhancedTooltipSource, /TooltipDragController/);
    assert.match(enhancedTooltipSource, /TooltipResizeController/);
    assert.match(enhancedTooltipSource, /TooltipSpeechController/);
    assert.doesNotMatch(enhancedTooltipSource, /detectSpeechLang|new ResizeController/);

    assert.match(hoverStrategySource, /HoverTooltipSurface/);
    assert.doesNotMatch(hoverStrategySource, /createElement\('div'\)|new ResizeController|placeElement/);
    assert.match(hoverSurfaceSource, /class HoverTooltipSurface/);
    assert.match(hoverSurfaceSource, /ResizeController/);
    assert.match(hoverSurfaceSource, /floatingLayoutService/);
});
