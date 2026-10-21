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

function press(dom, input, { key, code, ...eventInit }, value) {
    input.value = value;
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        code,
        ...eventInit,
    }));
}

function composition(dom, input, type) {
    input.dispatchEvent(new dom.window.CompositionEvent(type, {
        bubbles: true,
        data: '',
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

test('IME composition keydowns do not count as consecutive trigger presses', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, {}, translations);
    const input = document.getElementById('input');

    // 中文输入法选词时，浏览器上报的 keydown 仍是 key=" "/code="Space"，
    // 但 isComposing=true；这些按键不能进入连按计数。
    press(dom, input, { key: ' ', code: 'Space', isComposing: true }, '你');
    press(dom, input, { key: ' ', code: 'Space', isComposing: true }, '你好');
    press(dom, input, { key: ' ', code: 'Space', isComposing: true }, '你好吗');

    assert.equal(translations.length, 0);
    handler.destroy();
});

test('legacy IME keyCode 229 is ignored even without isComposing', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, {}, translations);
    const input = document.getElementById('input');

    press(dom, input, { key: ' ', code: 'Space', keyCode: 229 }, '你');
    press(dom, input, { key: ' ', code: 'Space', keyCode: 229 }, '你好');
    press(dom, input, { key: ' ', code: 'Space', keyCode: 229 }, '你好吗');

    assert.equal(translations.length, 0);
    handler.destroy();
});

test('composition lifecycle blocks counting until compositionend', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, {}, translations);
    const input = document.getElementById('input');

    composition(dom, input, 'compositionstart');
    press(dom, input, { key: ' ', code: 'Space' }, '你');
    press(dom, input, { key: ' ', code: 'Space' }, '你好');
    press(dom, input, { key: ' ', code: 'Space' }, '你好吗');
    assert.equal(translations.length, 0);

    composition(dom, input, 'compositionend');
    press(dom, input, { key: ' ', code: 'Space' }, '你好吗 ');
    press(dom, input, { key: ' ', code: 'Space' }, '你好吗  ');
    press(dom, input, { key: ' ', code: 'Space' }, '你好吗   ');
    assert.equal(translations.length, 1);

    handler.destroy();
});

test('compositionend on a different target clears the composition state', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, {}, translations);
    const input = document.getElementById('input');

    composition(dom, input, 'compositionstart');
    document.body.dispatchEvent(new dom.window.CompositionEvent('compositionend', {
        bubbles: true,
        data: '',
    }));

    press(dom, input, { key: ' ', code: 'Space' }, '你好');
    press(dom, input, { key: ' ', code: 'Space' }, '你好 ');
    press(dom, input, { key: ' ', code: 'Space' }, '你好  ');
    assert.equal(translations.length, 1);

    handler.destroy();
});

test('focus moving away from the composing input clears the composition state', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, {}, translations);
    const input = document.getElementById('input');
    const other = document.createElement('input');
    document.body.appendChild(other);

    composition(dom, input, 'compositionstart');
    input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));

    press(dom, other, { key: ' ', code: 'Space' }, 'A');
    press(dom, other, { key: ' ', code: 'Space' }, 'A ');
    press(dom, other, { key: ' ', code: 'Space' }, 'A  ');
    assert.equal(translations.length, 1);

    handler.destroy();
});

test('magic word is not triggered while composing', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, { triggerWord: 'fox' }, translations);
    const input = document.getElementById('input');

    composition(dom, input, 'compositionstart');
    press(dom, input, { key: 'x', code: 'KeyX' }, '你好 //fox');
    await new Promise(resolve => setTimeout(resolve, 400));

    assert.equal(translations.length, 0);
    handler.destroy();
});

test('IME candidate selection with plain Space keydowns does not count', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, {}, translations);
    const input = document.getElementById('input');

    // 真实 fcitx5 + Chrome 的 X11 路径：选词空格的 keydown 是普通
    // key=" "/code="Space"/keyCode=32/isComposing=false，但上屏的是汉字。
    press(dom, input, { key: ' ', code: 'Space' }, '');
    press(dom, input, { key: ' ', code: 'Space' }, '你');
    press(dom, input, { key: ' ', code: 'Space' }, '你好');

    assert.equal(translations.length, 0);
    handler.destroy();
});

test('auto-repeat keydown does not count as consecutive presses', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, {}, translations);
    const input = document.getElementById('input');

    // 按住空格产生的 repeat keydown 不是用户连续按了三次。
    press(dom, input, { key: ' ', code: 'Space', repeat: true }, 'A');
    press(dom, input, { key: ' ', code: 'Space', repeat: true }, 'A ');
    press(dom, input, { key: ' ', code: 'Space', repeat: true }, 'A  ');

    assert.equal(translations.length, 0);
    handler.destroy();
});

test('destroy cancels a pending magic-word debounce', async () => {
    const dom = setupDom();
    const InputHandler = await loadInputHandler();
    const translations = [];
    const handler = createHandler(InputHandler, { triggerWord: 'fox' }, translations);
    const input = document.getElementById('input');

    press(dom, input, { key: 'x', code: 'KeyX' }, 'hello //fox');
    handler.destroy();
    await new Promise(resolve => setTimeout(resolve, 400));

    assert.equal(translations.length, 0);
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
