import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function bundleDisplaySystemModules() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-display-system-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');

    await writeFile(entryPath, `
        export { DisplayStateStore } from ${JSON.stringify(path.join(projectRoot, 'src/content/display/display-state-store.js'))};
    `);

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
    });

    const modules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

function setupDom() {
    const dom = new JSDOM('<!doctype html><html><body><p id="target">Hello</p></body></html>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.WeakRef = globalThis.WeakRef || dom.window.WeakRef;
    return dom;
}

test('display state store owns element lifecycle state, registry, and ephemeral targets', async () => {
    setupDom();
    const { DisplayStateStore } = await bundleDisplaySystemModules();
    const store = new DisplayStateStore({
        states: {
            ORIGINAL: 'ORIGINAL',
            LOADING: 'LOADING',
            TRANSLATED: 'TRANSLATED',
        },
    });
    const element = document.getElementById('target');

    assert.equal(store.getState(element), 'ORIGINAL');

    store.setState(element, 'LOADING', { strategy: 'hover', originalContent: 'Hello' });
    assert.equal(store.getState(element), 'LOADING');
    assert.equal(element.dataset.foxlateState, 'loading');

    store.patchData(element, { plainText: '你好' });
    assert.deepEqual(store.getData(element), {
        strategy: 'hover',
        originalContent: 'Hello',
        state: 'LOADING',
        plainText: '你好',
    });

    store.registerElement('node-1', element);
    assert.equal(store.findElementById('node-1'), element);
    assert.equal([...store.entries()].length, 1);

    const ephemeralTarget = { dataset: { source: 'context-menu' } };
    store.setActiveEphemeral('enhancedContextMenu', ephemeralTarget);
    assert.equal(store.getActiveEphemeral('enhancedContextMenu'), ephemeralTarget);
    store.removeActiveEphemeral('enhancedContextMenu', ephemeralTarget);
    assert.equal(store.getActiveEphemeral('enhancedContextMenu'), undefined);

    store.deleteTarget(element);
    assert.equal(store.getState(element), 'ORIGINAL');
    store.removeElementId('node-1');
    assert.equal(store.findElementById('node-1'), undefined);
});
