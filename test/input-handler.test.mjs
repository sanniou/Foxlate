import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function loadInputHandler() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-input-handler-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const browserPath = path.join(tempDir, 'browser.js');
    await writeFile(entryPath, `export { InputHandler } from ${JSON.stringify(path.join(projectRoot, 'src/content/input-handler.js'))};`);
    await writeFile(browserPath, 'export default globalThis.__foxlateBrowserMock;');
    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'input-handler-browser-mock',
            setup(context) {
                context.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({ path: browserPath }));
            },
        }],
    });
    const { InputHandler } = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return InputHandler;
}

function setupDom() {
    const dom = new JSDOM('<!doctype html><html><head></head><body><input id="input"></body></html>', {
        url: 'https://example.com',
        pretendToBeVisual: true,
    });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.__foxlateBrowserMock = { runtime: { sendMessage: async () => ({}) } };
    return dom;
}

function createHandler(InputHandler, settings, translations = []) {
    const handler = new InputHandler();
    handler.settings = {
        triggerWord: '',
        debugMode: false,
        enabled: true,
        keyTriggerEnabled: true,
        consecutiveKey: 'Space',
        consecutiveKeyPresses: 3,
        ...settings,
    };
    handler.triggerTranslation = async (_target, text) => translations.push(text);
    handler.attachEventListeners();
    return handler;
}

function press(dom, input, { key, code }, value) {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        code,
    }));
}

test('input translation only triggers after the configured key is pressed consecutively', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, {}, translations);
    const input = document.getElementById('input');

    press(dom, input, { key: ' ', code: 'Space' }, 'A ');
    press(dom, input, { key: 'b', code: 'KeyB' }, 'A B');
    press(dom, input, { key: ' ', code: 'Space' }, 'A B ');
    press(dom, input, { key: 'c', code: 'KeyC' }, 'A B C');
    press(dom, input, { key: ' ', code: 'Space' }, 'A B C ');

    assert.equal(translations.length, 0);
    handler.destroy();
});

test('input translation triggers once for three consecutive spaces', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, {}, translations);
    const input = document.getElementById('input');

    press(dom, input, { key: ' ', code: 'Space' }, 'A ');
    press(dom, input, { key: ' ', code: 'Space' }, 'A  ');
    press(dom, input, { key: ' ', code: 'Space' }, 'A   ');

    assert.equal(translations.length, 1);
    handler.destroy();
});

test('invalid consecutive-key thresholds do not trigger on the first key', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, { consecutiveKeyPresses: 0 }, translations);
    const input = document.getElementById('input');

    press(dom, input, { key: ' ', code: 'Space' }, 'A ');

    assert.equal(translations.length, 0);
    handler.destroy();
});
