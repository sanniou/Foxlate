import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');
let bundledModules;

async function loadScriptInjector() {
    if (bundledModules) {
        return bundledModules;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-script-injector-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { createEnsureScriptsInjected } from ${JSON.stringify(path.join(projectRoot, 'src/background/script-injector.js'))};
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
            name: 'browser-polyfill-mock',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({
                    path: mockBrowserPath,
                }));
            },
        }],
    });

    bundledModules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return bundledModules;
}

function createBrowserMock({ failCss = false, failJs = false } = {}) {
    const calls = {
        insertCSS: [],
        executeScript: [],
    };

    return {
        calls,
        tabs: {
            onRemoved: {
                addListener() {},
            },
        },
        storage: {
            session: {
                async get() { return {}; },
                async set() {},
            },
        },
        scripting: {
            async insertCSS(details) {
                calls.insertCSS.push(details);
                if (failCss) {
                    throw new Error('css blocked');
                }
            },
            async executeScript(details) {
                calls.executeScript.push(details);
                if (failJs) {
                    throw new Error('js blocked');
                }
            },
        },
    };
}

function createTabStateManager(initialInjectedFiles = []) {
    const injected = new Set(initialInjectedFiles);
    const marks = [];

    return {
        marks,
        async isFrameInjected(_tabId, _frameId, files = []) {
            if (files.length === 0) {
                return injected.size > 0;
            }
            return files.every(file => injected.has(file));
        },
        async markFrameAsInjected(tabId, frameId, files = []) {
            marks.push({ tabId, frameId, files });
            files.forEach(file => injected.add(file));
        },
    };
}

test('ensureScriptsInjected injects unique missing css before js and marks files', async () => {
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { createEnsureScriptsInjected } = await loadScriptInjector();
    const tabStateManager = createTabStateManager();
    const ensureScriptsInjected = createEnsureScriptsInjected({
        browserApi: browserMock,
        tabStateManager,
        logError() {},
    });

    const result = await ensureScriptsInjected(10, 2, [
        'content/style.css',
        'content/content-script.js',
        'content/style.css',
        'content/enhanced-style.css',
    ]);

    assert.equal(result, true);
    assert.deepEqual(browserMock.calls.insertCSS, [{
        target: { tabId: 10, frameIds: [2] },
        files: ['content/style.css', 'content/enhanced-style.css'],
    }]);
    assert.deepEqual(browserMock.calls.executeScript, [{
        target: { tabId: 10, frameIds: [2] },
        files: ['content/content-script.js'],
    }]);
    assert.deepEqual(tabStateManager.marks, [{
        tabId: 10,
        frameId: 2,
        files: ['content/style.css', 'content/content-script.js', 'content/enhanced-style.css'],
    }]);
});

test('ensureScriptsInjected skips already injected files but injects missing core script', async () => {
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { createEnsureScriptsInjected } = await loadScriptInjector();
    const tabStateManager = createTabStateManager([
        'content/subtitle/subtitle-manager.js',
        'content/subtitle/youtube-subtitle-strategy.js',
    ]);
    const ensureScriptsInjected = createEnsureScriptsInjected({
        browserApi: browserMock,
        tabStateManager,
        logError() {},
    });

    const result = await ensureScriptsInjected(11, 0, [
        'content/subtitle/subtitle-manager.js',
        'content/content-script.js',
    ]);

    assert.equal(result, true);
    assert.deepEqual(browserMock.calls.insertCSS, []);
    assert.deepEqual(browserMock.calls.executeScript, [{
        target: { tabId: 11, frameIds: [0] },
        files: ['content/content-script.js'],
    }]);
    assert.deepEqual(tabStateManager.marks, [{
        tabId: 11,
        frameId: 0,
        files: ['content/content-script.js'],
    }]);
});

test('ensureScriptsInjected returns true without browser calls when all files are already injected', async () => {
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { createEnsureScriptsInjected } = await loadScriptInjector();
    const tabStateManager = createTabStateManager([
        'content/style.css',
        'content/content-script.js',
    ]);
    const ensureScriptsInjected = createEnsureScriptsInjected({
        browserApi: browserMock,
        tabStateManager,
        logError() {},
    });

    const result = await ensureScriptsInjected(12, 0, [
        'content/style.css',
        'content/content-script.js',
    ]);

    assert.equal(result, true);
    assert.deepEqual(browserMock.calls.insertCSS, []);
    assert.deepEqual(browserMock.calls.executeScript, []);
    assert.deepEqual(tabStateManager.marks, []);
});

test('ensureScriptsInjected returns false and logs when injection fails', async () => {
    const browserMock = createBrowserMock({ failJs: true });
    globalThis.__foxlateBrowserMock = browserMock;
    const { createEnsureScriptsInjected } = await loadScriptInjector();
    const tabStateManager = createTabStateManager();
    const errors = [];
    const ensureScriptsInjected = createEnsureScriptsInjected({
        browserApi: browserMock,
        tabStateManager,
        logError(context, error) {
            errors.push({ context, message: error.message });
        },
    });

    const result = await ensureScriptsInjected(13, 4, ['content/content-script.js']);

    assert.equal(result, false);
    assert.deepEqual(browserMock.calls.executeScript, [{
        target: { tabId: 13, frameIds: [4] },
        files: ['content/content-script.js'],
    }]);
    assert.deepEqual(tabStateManager.marks, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0].context, /ensureScriptsInjected for tab 13, frame 4/);
    assert.match(errors[0].message, /js blocked/);
});
