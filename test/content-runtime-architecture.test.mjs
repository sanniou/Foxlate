import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createI18nMock } from './helpers/i18n-mock.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function bundleContentRuntimeModules() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-content-runtime-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');
    const mockInputHandlerPath = path.join(tempDir, 'input-handler-mock.js');
    const mockHudPath = path.join(tempDir, 'hud-mock.js');

    await writeFile(entryPath, `
        export { ContentRuntime } from ${JSON.stringify(path.join(projectRoot, 'src/content/content-runtime.js'))};
        export { TranslationBatchQueue } from ${JSON.stringify(path.join(projectRoot, 'src/content/translation-batch-queue.js'))};
        export { ElementTranslationController } from ${JSON.stringify(path.join(projectRoot, 'src/content/element-translation-controller.js'))};
    `);
    await writeFile(mockBrowserPath, 'export default globalThis.__foxlateBrowserMock;');
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
        i18n: createI18nMock(),
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
        i18n: createI18nMock(),
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
    // 摘要模块不再由运行时静态装进内容包：运行时只请求后台按需注入。
    // 这条断言是拆包的护栏——把它改回「运行时自己 initialize」就等于把
    // readability + marked 又拖回每个页面的内容包。
    assert.deepEqual(
        browserMock.messages.filter(message => message.type === 'ENSURE_SUMMARY_MODULE'),
        [{ type: 'ENSURE_SUMMARY_MODULE', payload: { hostname: 'example.com', enabled: true } }],
    );
    assert.deepEqual(globalThis.__summaryCalls, []);
    assert.equal(globalThis.__inputHandlerCalls, 1);

    // 完成度计数是 popup 判断「翻好了」还是「每段都失败」的依据，属于状态契约的一部分。
    const idleStatus = {
        state: 'original',
        emptyCandidates: false,
        allPrecheckSkipped: false,
        failedCount: 0,
        completedCount: 0,
    };
    assert.deepEqual(await runtime.handleMessage({ type: 'REQUEST_TRANSLATION_STATUS' }), idleStatus);
    assert.deepEqual(await runtime.handleMessage({ type: 'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT', payload: { tabId: 7 } }), { success: true });
    assert.deepEqual(jobEvents, [['start', 7, settings]]);
    assert.deepEqual(await runtime.handleMessage({ type: 'REQUEST_TRANSLATION_STATUS' }), {
        ...idleStatus,
        state: 'loading',
    });

    assert.deepEqual(await runtime.handleMessage({ type: 'UPDATE_DISPLAY_MODE', payload: { displayMode: 'replace' } }), { success: true });
    assert.deepEqual(displayCalls, [['mode', 'replace']]);

    assert.deepEqual(await runtime.handleMessage({ type: 'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT', payload: { tabId: 7 } }), { success: true });
    assert.deepEqual(jobEvents, [['start', 7, settings], ['revert', 7]]);
    assert.deepEqual(await runtime.handleMessage({ type: 'REQUEST_TRANSLATION_STATUS' }), idleStatus);
});

test('message listener is registered before the first await finishes', async () => {
    const dom = setupDom();
    const settings = createSettings();
    const browserMock = createRuntimeBrowserMock({ settings });
    const { ContentRuntime } = await bundleContentRuntimeModules();

    let releaseSettings;
    const runtime = new ContentRuntime({
        browserApi: browserMock,
        win: dom.window,
        PageTranslationJobClass: class {
            async start() {}
            async revert() {}
        },
        displayManager: {
            updateDisplayMode() {},
            handleEphemeralTranslation() {},
        },
        // 背景在注入返回后立刻发消息；此时 settings 往返很可能还没回来。
        getEffectiveSettings: () => new Promise(resolve => {
            releaseSettings = () => resolve(settings);
        }),
        cssFilePath: 'content/style.css',
    });

    const initPromise = runtime.initialize();

    assert.equal(typeof browserMock.messageListener, 'function', 'listener must exist before settings resolve');
    assert.deepEqual(await browserMock.messageListener({ type: 'PING' }), { status: 'PONG' });

    releaseSettings();
    await initPromise;
});

test('concurrent startTranslationJob calls create exactly one job', async () => {
    const dom = setupDom();
    const settings = createSettings();
    const browserMock = createRuntimeBrowserMock({ settings });
    const { ContentRuntime } = await bundleContentRuntimeModules();
    const created = [];
    let createdWhileAwaitingSettings = 0;
    class CountingJob {
        constructor(tabId) {
            this.tabId = tabId;
            this.state = 'idle';
            created.push(tabId);
        }
        async start() {
            this.state = 'translating';
        }
        async revert() {
            this.state = 'idle';
        }
    }

    const runtime = new ContentRuntime({
        browserApi: browserMock,
        win: dom.window,
        PageTranslationJobClass: CountingJob,
        displayManager: {
            updateDisplayMode() {},
            handleEphemeralTranslation() {},
        },
        // 模拟真实的异步设置读取：两个并发入口都会在 await 之后才创建 job。
        getEffectiveSettings: async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
            if (runtime.currentPageJob) createdWhileAwaitingSettings += 1;
            return settings;
        },
        cssFilePath: 'content/style.css',
    });

    await runtime.initialize();

    // popup 点击与快捷键命令几乎同时到达内容脚本（TRANSLATE_PAGE_REQUEST 带 ignoreIfActive）。
    await Promise.all([
        runtime.startTranslationJob(5, { ignoreIfActive: true }),
        runtime.startTranslationJob(5, { ignoreIfActive: true }),
    ]);

    assert.equal(created.length, 1, 'only one page job is created');
    assert.equal(runtime.currentPageJob.tabId, 5);
    assert.equal(createdWhileAwaitingSettings, 0, 'second entry sees the first job instead of racing past it');
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
