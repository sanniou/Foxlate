import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');
let bundledModules;

async function loadTabStateManager() {
    if (bundledModules) {
        return bundledModules;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-tab-state-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { TabStateManager } from ${JSON.stringify(path.join(projectRoot, 'src/background/tab-state-manager.js'))};
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

function createBrowserMock(initialStore = {}) {
    const store = structuredClone(initialStore);
    const removedListeners = [];

    return {
        store,
        removedListeners,
        tabs: {
            onRemoved: {
                addListener(listener) {
                    removedListeners.push(listener);
                },
            },
        },
        storage: {
            session: {
                async get(keys) {
                    if (Array.isArray(keys)) {
                        return Object.fromEntries(keys.map(key => [key, store[key] ?? {}]));
                    }
                    if (typeof keys === 'string') {
                        return { [keys]: store[keys] ?? {} };
                    }
                    return { ...store };
                },
                async set(values) {
                    Object.assign(store, structuredClone(values));
                },
            },
        },
    };
}

test('TabStateManager tracks injected files per frame', async () => {
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { TabStateManager } = await loadTabStateManager();
    const manager = new TabStateManager(browserMock);

    await manager.markFrameAsInjected(12, 0, ['content/subtitle/subtitle-manager.js']);

    assert.equal(await manager.isFrameInjected(12, 0), true);
    assert.equal(await manager.isFrameInjected(12, 0, ['content/subtitle/subtitle-manager.js']), true);
    assert.equal(await manager.isFrameInjected(12, 0, ['content/content-script.js']), false);

    await manager.markFrameAsInjected(12, 0, ['content/content-script.js', 'content/style.css']);

    assert.equal(await manager.isFrameInjected(12, 0, [
        'content/subtitle/subtitle-manager.js',
        'content/content-script.js',
        'content/style.css',
    ]), true);
    assert.deepEqual(browserMock.store.injectedFrames[12][0], [
        'content/subtitle/subtitle-manager.js',
        'content/content-script.js',
        'content/style.css',
    ]);
});

test('TabStateManager cleans tab status, auto-translation, and injection state', async () => {
    const browserMock = createBrowserMock({
        tabTranslationStates: { 7: 'translated' },
        sessionTabTranslations: { 7: 'example.com' },
        injectedFrames: {
            7: { 0: ['content/content-script.js'] },
            8: { 0: ['content/content-script.js'] },
        },
    });
    globalThis.__foxlateBrowserMock = browserMock;
    const { TabStateManager } = await loadTabStateManager();
    const manager = new TabStateManager(browserMock);

    await manager.removeTab(7);

    assert.equal(browserMock.store.tabTranslationStates[7], undefined);
    assert.equal(browserMock.store.sessionTabTranslations[7], undefined);
    assert.equal(browserMock.store.injectedFrames[7], undefined);
    assert.deepEqual(browserMock.store.injectedFrames[8], { 0: ['content/content-script.js'] });
});

test('TabStateManager writes tab translation and auto-translation state under their storage keys', async () => {
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { TabStateManager } = await loadTabStateManager();
    const manager = new TabStateManager(browserMock);

    await manager.setTabStatus(5, 'loading');
    await manager.registerTabForAutoTranslation(5, 'example.com');

    assert.deepEqual(browserMock.store.tabTranslationStates, { 5: 'loading' });
    assert.deepEqual(browserMock.store.sessionTabTranslations, { 5: 'example.com' });
    assert.equal(await manager.isTabRegisteredForAutoTranslation(5, 'example.com'), true);

    await manager.setTabStatus(5, 'original');
    await manager.unregisterTabForAutoTranslation(5);

    assert.deepEqual(browserMock.store.tabTranslationStates, {});
    assert.deepEqual(browserMock.store.sessionTabTranslations, {});
});

test('TabStateManager keeps backward-compatible old frame-only injection state', async () => {
    const browserMock = createBrowserMock({
        injectedFrames: { 3: [0] },
    });
    globalThis.__foxlateBrowserMock = browserMock;
    const { TabStateManager } = await loadTabStateManager();
    const manager = new TabStateManager(browserMock);

    assert.equal(await manager.isFrameInjected(3, 0), true);
    assert.equal(await manager.isFrameInjected(3, 0, ['content/content-script.js']), false);
});
