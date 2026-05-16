import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(import.meta.dirname, '..');
let bundledModules;

async function loadDomModules() {
    if (bundledModules) {
        return bundledModules;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-dom-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');

    await writeFile(entryPath, `
        export { DOMWalker } from ${JSON.stringify(path.join(projectRoot, 'src/content/dom-walker.js'))};
        export { reconstructDOM } from ${JSON.stringify(path.join(projectRoot, 'src/content/dom-reconstructor.js'))};
        export { findAllSearchRoots, findTranslatableElements } from ${JSON.stringify(path.join(projectRoot, 'src/content/translatable-elements.js'))};
    `);

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
    });

    bundledModules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return bundledModules;
}

function setupDom(html) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    const { window } = dom;

    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.Node = window.Node;
    globalThis.NodeFilter = window.NodeFilter;
    globalThis.HTMLElement = window.HTMLElement;

    Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get() {
            if (this.tagName === 'HTML' || this.tagName === 'BODY') {
                return null;
            }
            return window.document.body;
        },
    });
    Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get() {
            return this.style.display === 'none' ? 0 : 120;
        },
    });
    Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get() {
            return this.style.display === 'none' ? 0 : 24;
        },
    });

    return dom;
}

test('DOMWalker extracts plain text and preservable inline tags', async () => {
    const { DOMWalker } = await loadDomModules();
    const dom = setupDom('<p id="target">Hello <strong>world</strong><br><code>x</code></p>');
    const target = dom.window.document.querySelector('#target');

    const result = DOMWalker.create(target);

    assert.equal(result.plainText, 'Hello world\nx');
    assert.match(result.sourceText, /^Hello <t0>world<\/t0>\n<t1>x<\/t1>$/);
    assert.equal(result.translationUnit.appendType, 'block');
    assert.equal(result.translationUnit.nodeMap.t0.node.tagName, 'STRONG');
    assert.equal(result.translationUnit.nodeMap.t1.node.tagName, 'CODE');
});

test('DOMWalker honors exclude selectors and extension-generated markers', async () => {
    const { DOMWalker } = await loadDomModules();
    const dom = setupDom('<div id="target"><span class="skip">Skip</span> Keep</div><div id="generated" data-foxlate-appended-text="true">Translated</div>');
    const target = dom.window.document.querySelector('#target');
    const generated = dom.window.document.querySelector('#generated');

    const result = DOMWalker.create(target, { exclude: '.skip' });

    assert.equal(result.plainText, 'Keep');
    assert.equal(result.sourceText, 'Keep');
    assert.equal(DOMWalker.create(generated), null);
});

test('reconstructDOM rebuilds cloned formatting and converts normal newlines to br', async () => {
    const { DOMWalker, reconstructDOM } = await loadDomModules();
    const dom = setupDom('<p id="target">Hello <strong>world</strong><br><code>x</code></p>');
    const target = dom.window.document.querySelector('#target');
    const { translationUnit } = DOMWalker.create(target);

    const fragment = reconstructDOM('Bonjour <t0>monde</t0>\n<t1>x</t1>', translationUnit.nodeMap);
    const wrapper = dom.window.document.createElement('div');
    wrapper.appendChild(fragment);

    assert.equal(wrapper.querySelector('strong')?.textContent, 'monde');
    assert.equal(wrapper.querySelector('code')?.textContent, 'x');
    assert.equal(wrapper.querySelectorAll('br').length, 1);
    assert.equal(wrapper.textContent, 'Bonjour mondex');
});

test('reconstructDOM rejects broken translator tags', async () => {
    const { DOMWalker, reconstructDOM } = await loadDomModules();
    const dom = setupDom('<p id="target">Hello <strong>world</strong></p>');
    const target = dom.window.document.querySelector('#target');
    const { translationUnit } = DOMWalker.create(target);

    assert.throws(
        () => reconstructDOM('Hello <t0>world</t1>', translationUnit.nodeMap),
        /Mismatched closing tag|Unknown translator tag ID/
    );
});

test('DOMWalker skips notranslate, child lang-marked, translate=no, and hidden child content', async () => {
    const { DOMWalker } = await loadDomModules();
    const dom = setupDom(`
        <div id="target">
            Visible
            <span class="notranslate">NoTranslate</span>
            <span lang="fr">Bonjour</span>
            <span translate="no">NoTranslateAttr</span>
            <span style="display: none">Hidden</span>
        </div>
    `);
    const target = dom.window.document.querySelector('#target');

    const result = DOMWalker.create(target);

    assert.equal(result.plainText, 'Visible');
    assert.equal(result.sourceText, 'Visible');
});

test('DOMWalker does not skip normal content under document-level lang attribute', async () => {
    const { DOMWalker } = await loadDomModules();
    const dom = setupDom('<article id="target"><p>Hello <strong>world</strong></p></article>');
    dom.window.document.documentElement.setAttribute('lang', 'en');
    const target = dom.window.document.querySelector('#target');

    const result = DOMWalker.create(target);

    assert.equal(result.plainText, 'Hello world');
    assert.match(result.sourceText, /^<t0>Hello <t1>world<\/t1><\/t0>$/);
});

test('reconstructDOM preserves whitespace inside preformatted nodes', async () => {
    const { DOMWalker, reconstructDOM } = await loadDomModules();
    const dom = setupDom('<pre id="target" style="white-space: pre">line 1\n    line 2</pre>');
    const target = dom.window.document.querySelector('#target');
    const { sourceText, translationUnit } = DOMWalker.create(target);

    assert.match(sourceText, /^line 1\n    line 2$/);

    const nodeMap = {
        t0: {
            node: target.cloneNode(false),
            preservesWhitespace: true,
        },
    };
    const fragment = reconstructDOM('<t0>line A\n    line B</t0>', nodeMap);
    const wrapper = dom.window.document.createElement('div');
    wrapper.appendChild(fragment);

    assert.equal(wrapper.querySelector('pre')?.textContent, 'line A\n    line B');
    assert.equal(wrapper.querySelectorAll('br').length, 0);
    assert.equal(translationUnit.appendType, 'block');
});

test('findAllSearchRoots discovers shadow roots and injects css once per host', async () => {
    const { findAllSearchRoots } = await loadDomModules();
    const dom = setupDom('<main><div id="host"></div></main>');
    const host = dom.window.document.querySelector('#host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Inside shadow</p>';
    const logger = { log() {}, error() {} };

    const roots = findAllSearchRoots(dom.window.document.body, { cssFilePath: 'moz-extension://foxlate/content/style.css', logger });
    const rootsAfterSecondPass = findAllSearchRoots(dom.window.document.body, { cssFilePath: 'moz-extension://foxlate/content/style.css', logger });

    assert.equal(roots.includes(dom.window.document.body), true);
    assert.equal(roots.includes(shadow), true);
    assert.equal(rootsAfterSecondPass.includes(shadow), true);
    assert.equal(host.dataset.foxlateCssInjected, 'true');
    assert.equal(shadow.querySelectorAll('link[rel="stylesheet"]').length, 1);
    assert.equal(shadow.querySelector('link')?.href, 'moz-extension://foxlate/content/style.css');
});

test('findTranslatableElements returns leaves and wraps mixed parent orphan text', async () => {
    const { findTranslatableElements } = await loadDomModules();
    const dom = setupDom('<article id="article">Intro <strong>lead</strong><p id="body">Body</p><p id="done" data-translation-id="x">Done</p></article>');
    const article = dom.window.document.querySelector('#article');
    const settings = { translationSelector: { content: 'article, p' } };

    const elements = findTranslatableElements(settings, [dom.window.document.body]);
    const ids = elements.map(el => el.id).filter(Boolean);
    const wrapper = article.querySelector('foxlate-wrapper[data-foxlate-generated="true"]');

    assert.deepEqual(ids, ['body']);
    assert.equal(elements.includes(wrapper), true);
    assert.equal(wrapper.textContent.replace(/\s+/g, ' ').trim(), 'Intro lead');
    assert.equal(elements.some(el => el.id === 'article'), false);
    assert.equal(elements.some(el => el.id === 'done'), false);
});

test('findTranslatableElements returns no candidates instead of throwing for invalid content selector', async () => {
    const { findTranslatableElements } = await loadDomModules();
    const dom = setupDom('<main><p id="target">Body</p></main>');
    const settings = { translationSelector: { content: 'main, [broken' } };
    const originalConsoleError = console.error;
    let loggedInvalidSelector = false;
    console.error = (message) => {
        loggedInvalidSelector = String(message).includes('Invalid content selector');
    };

    try {
        const elements = findTranslatableElements(settings, [dom.window.document.body]);

        assert.deepEqual(elements, []);
        assert.equal(loggedInvalidSelector, true);
    } finally {
        console.error = originalConsoleError;
    }
});
