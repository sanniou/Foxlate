import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function bundleContentFeatureModules() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-content-feature-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export {
            getLastSentence,
            getTextContent,
            replaceTextContent,
            resolveTargetLanguageOverride,
            shouldAppendKey,
        } from ${JSON.stringify(path.join(projectRoot, 'src/content/input/input-text-utils.js'))};
        export { InputTranslationClient } from ${JSON.stringify(path.join(projectRoot, 'src/content/input/input-translation-client.js'))};
        export { classifySummaryError, generateUserFriendlySummaryError } from ${JSON.stringify(path.join(projectRoot, 'src/content/summary/summary-error-messages.js'))};
        export { SubtitleManager } from ${JSON.stringify(path.join(projectRoot, 'src/content/subtitle/subtitle-manager.js'))};
        export { SubtitleRenderer } from ${JSON.stringify(path.join(projectRoot, 'src/content/subtitle/subtitle-renderer.js'))};
        export { parseYouTubeTimedSentences } from ${JSON.stringify(path.join(projectRoot, 'src/content/subtitle/youtube-subtitle-parser.js'))};
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
            name: 'foxlate-content-feature-test-mocks',
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
                return key === 'contextMenuErrorPrefix' ? 'Error' : key;
            },
        },
        runtime: {
            onMessage: {
                addListener() {},
            },
            sendMessage: async () => ({}),
        },
        storage: {
            onChanged: { addListener: () => {} },
            local: { get: async () => ({}), set: async () => {} },
            sync: { get: async () => ({}), set: async () => {} },
        },
    };
}

function setupDom() {
    const dom = new JSDOM('<!doctype html><html><body><input id="input" value="Hello. World //EN-fox"></body></html>', {
        pretendToBeVisual: true,
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Element = dom.window.Element;
    installBrowserMock();
    return dom;
}

test('input text utilities own sentence extraction, range replacement, and language aliases', async () => {
    setupDom();
    const {
        getLastSentence,
        getTextContent,
        replaceTextContent,
        resolveTargetLanguageOverride,
        shouldAppendKey,
    } = await bundleContentFeatureModules();
    const input = document.getElementById('input');

    assert.deepEqual(getLastSentence(getTextContent(input)), { text: ' World //EN-fox', index: 6 });
    replaceTextContent(input, '你好', { start: 7, end: 12 });
    assert.equal(input.value, 'Hello. 你好 //EN-fox');
    assert.equal(resolveTargetLanguageOverride('EN', { languageMapping: { EN: 'en' } }), 'en');
    assert.equal(shouldAppendKey('a'), true);
});

test('input translation client sends TRANSLATE_INPUT_TEXT and replaces target value', async () => {
    setupDom();
    const sent = [];
    const browserApi = {
        runtime: {
            async sendMessage(message) {
                sent.push(message);
                return { translatedText: '你好世界' };
            },
        },
    };
    const { InputTranslationClient } = await bundleContentFeatureModules();
    const client = new InputTranslationClient({ browserApi, documentRef: document });
    const target = document.getElementById('input');
    const indicator = { show() {}, hide() {} };

    await client.translateAndReplace({
        target,
        text: 'Hello world',
        indicator,
    });

    assert.equal(sent[0].type, 'translateInputText');
    assert.equal(sent[0].payload.text, 'Hello world');
    assert.equal(sent[0].payload.source, 'inputHandler');
    assert.equal(target.value, '你好世界');
});

test('summary error module classifies common retryable failures', async () => {
    setupDom();
    const { classifySummaryError, generateUserFriendlySummaryError } = await bundleContentFeatureModules();

    assert.equal(classifySummaryError(new Error('HTTP 429 rate limit')), 'rate_limit');
    assert.match(generateUserFriendlySummaryError(new Error('failed to extract content')), /内容为空/);
});

test('subtitle manager reports status through the message registry boundary', async () => {
    setupDom();
    let listener = null;
    const browserApi = {
        ...globalThis.__foxlateBrowserMock,
        runtime: {
            ...globalThis.__foxlateBrowserMock.runtime,
            onMessage: {
                addListener(callback) {
                    listener = callback;
                },
            },
        },
    };
    const { SubtitleManager } = await bundleContentFeatureModules();
    const manager = new SubtitleManager({ browserApi });
    let response = null;

    listener({ type: 'REQUEST_SUBTITLE_TRANSLATION_STATUS' }, {}, value => {
        response = value;
    });

    assert.deepEqual(response, { isSupported: false, isEnabled: false });

    class Strategy {
        constructor() {}
        initialize() {}
        cleanup() {}
    }

    window.getEffectiveSettings = async () => ({ subtitleSettings: { enabled: true } });
    await manager.registerStrategy(Strategy);
    assert.deepEqual(manager.getStatus(), { isSupported: true, isEnabled: true });
});

test('youtube subtitle parser normalizes segmented timed text into sentences', async () => {
    setupDom();
    const { parseYouTubeTimedSentences } = await bundleContentFeatureModules();
    const timedText = JSON.stringify({
        events: [
            { tStartMs: 1000, dDurationMs: 700, segs: [{ utf8: 'Hello ' }] },
            { tStartMs: 1700, dDurationMs: 800, segs: [{ utf8: 'world. Next' }] },
            { tStartMs: 2500, dDurationMs: 900, segs: [{ utf8: ' line' }] },
            { tStartMs: 3400, dDurationMs: 600, segs: [{ utf8: '[Music]' }] },
        ],
    });

    assert.deepEqual(parseYouTubeTimedSentences(timedText), [
        { text: 'Hello world.', startTime: 1000, endTime: 2500 },
        { text: 'Next line', startTime: 1700, endTime: 3400 },
    ]);
});
