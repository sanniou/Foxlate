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

async function loadLayoutServices() {
    if (bundledModules) {
        return bundledModules;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-layout-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');

    await writeFile(entryPath, `
        export { TextMeasurementService } from ${JSON.stringify(path.join(projectRoot, 'src/content/layout/text-measurement-service.js'))};
        export { FloatingLayoutService } from ${JSON.stringify(path.join(projectRoot, 'src/content/layout/floating-layout-service.js'))};
        export { ResizeController } from ${JSON.stringify(path.join(projectRoot, 'src/content/layout/resize-controller.js'))};
        export { SummaryLayoutController } from ${JSON.stringify(path.join(projectRoot, 'src/content/layout/summary-layout-controller.js'))};
        export { TranslatedContentLayoutService } from ${JSON.stringify(path.join(projectRoot, 'src/content/layout/translated-content-layout-service.js'))};
        export { UITextLayoutService } from ${JSON.stringify(path.join(projectRoot, 'src/common/ui-text-layout-service.js'))};
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

function setupDom(html = '<div id="target">Target</div>') {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    const { window } = dom;

    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.Intl = window.Intl;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });
    Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: () => null,
    });

    return dom;
}

test('TextMeasurementService falls back safely when canvas measurement is unavailable', async () => {
    const dom = setupDom();
    const { TextMeasurementService } = await loadLayoutServices();
    const service = new TextMeasurementService();
    const target = dom.window.document.querySelector('#target');

    const measurement = service.measureText('Hello world '.repeat(12), {
        referenceElement: target,
        maxWidth: 120,
        minWidth: 80,
        styleOverrides: {
            fontSize: '14px',
            lineHeight: '21px',
            whiteSpace: 'normal',
        },
    });

    assert.equal(measurement.available, false);
    assert.equal(measurement.source, 'fallback');
    assert.equal(measurement.width >= 80, true);
    assert.equal(measurement.width <= 120, true);
    assert.equal(measurement.height > 21, true);
});

test('FloatingLayoutService measures tooltip boxes within configured bounds', async () => {
    setupDom();
    const { FloatingLayoutService } = await loadLayoutServices();
    const service = new FloatingLayoutService();

    const box = service.measureTextBox('A longer tooltip label that should wrap within the max width.', {
        minWidth: 90,
        maxWidth: 180,
        paddingX: 20,
        paddingY: 12,
        styleOverrides: {
            fontSize: '12px',
            lineHeight: '16px',
        },
    });

    assert.equal(box.width >= 90, true);
    assert.equal(box.width <= 180, true);
    assert.equal(box.height >= 12, true);
    assert.equal(box.contentWidth <= 160, true);
});

test('FloatingLayoutService caps reserved min-height for long floating text', async () => {
    const dom = setupDom('<div id="panel"></div>');
    const { FloatingLayoutService } = await loadLayoutServices();
    const service = new FloatingLayoutService();
    const panel = dom.window.document.querySelector('#panel');

    service.applyTextBox(panel, 'Long text '.repeat(200), {
        minWidth: 100,
        maxWidth: 160,
        paddingX: 20,
        paddingY: 12,
        maxReservedHeight: 120,
        styleOverrides: {
            fontSize: '12px',
            lineHeight: '16px',
        },
    });

    assert.equal(panel.style.minHeight, '120px');
});

test('FloatingLayoutService chooses an in-viewport placement for anchored boxes', async () => {
    setupDom();
    const { FloatingLayoutService } = await loadLayoutServices();
    const service = new FloatingLayoutService();

    const position = service.placeAnchoredBox({
        anchorRect: { left: 130, right: 170, top: 6, bottom: 36, width: 40, height: 30 },
        boxWidth: 120,
        boxHeight: 80,
        margin: 10,
        gap: 8,
        preferredPlacements: ['top', 'bottom'],
    });

    assert.equal(position.placement, 'bottom');
    assert.equal(position.left >= 10, true);
    assert.equal(position.top >= 10, true);
    assert.equal(position.left + 120 <= 310, true);
    assert.equal(position.top + 80 <= 230, true);
});

test('ResizeController clamps mouse resizing to configured bounds', async () => {
    const dom = setupDom('<div id="panel" style="position: fixed; width: 180px; height: 100px;"></div>');
    const { ResizeController } = await loadLayoutServices();
    const panel = dom.window.document.querySelector('#panel');
    let currentWidth = 180;
    let currentHeight = 100;
    panel.getBoundingClientRect = () => ({
        left: 10,
        top: 10,
        right: 10 + currentWidth,
        bottom: 10 + currentHeight,
        width: currentWidth,
        height: currentHeight,
    });

    const controller = new ResizeController(panel, {
        minWidth: 120,
        minHeight: 80,
        maxWidth: 240,
        maxHeight: 160,
        handles: ['se'],
        onResize: ({ width, height }) => {
            currentWidth = width;
            currentHeight = height;
        },
    });

    const handle = panel.querySelector('.foxlate-resize-se');
    handle.dispatchEvent(new dom.window.MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 400, clientY: 400, bubbles: true }));
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));

    assert.equal(panel.style.width, '240px');
    assert.equal(panel.style.height, '160px');
    assert.equal(panel.dataset.foxlateResizable, 'true');
    assert.equal(panel.dataset.foxlateResizing, undefined);

    controller.destroy();
});

test('ResizeController resizes from north-west handles and emits start state', async () => {
    const dom = setupDom('<div id="panel" style="position: fixed; left: 40px; top: 50px; width: 180px; height: 100px;"></div>');
    const { ResizeController } = await loadLayoutServices();
    const panel = dom.window.document.querySelector('#panel');
    let currentLeft = 40;
    let currentTop = 50;
    let currentWidth = 180;
    let currentHeight = 100;
    let startDirection = null;
    panel.getBoundingClientRect = () => ({
        left: currentLeft,
        top: currentTop,
        right: currentLeft + currentWidth,
        bottom: currentTop + currentHeight,
        width: currentWidth,
        height: currentHeight,
    });

    const controller = new ResizeController(panel, {
        minWidth: 120,
        minHeight: 80,
        maxWidth: 260,
        maxHeight: 180,
        handles: ['nw'],
        onResizeStart: ({ direction }) => {
            startDirection = direction;
        },
        onResize: ({ width, height, left, top }) => {
            currentWidth = width;
            currentHeight = height;
            currentLeft = left;
            currentTop = top;
        },
    });

    const handle = panel.querySelector('.foxlate-resize-nw');
    handle.dispatchEvent(new dom.window.MouseEvent('mousedown', { clientX: 40, clientY: 50, bubbles: true }));
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 10, clientY: 20, bubbles: true }));
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));

    assert.equal(startDirection, 'nw');
    assert.equal(panel.style.width, '210px');
    assert.equal(panel.style.height, '130px');
    assert.equal(panel.style.left, '10px');
    assert.equal(panel.style.top, '20px');

    controller.destroy();
});

test('SummaryLayoutController keeps user-sized dialog inside the viewport', async () => {
    setupDom();
    const { SummaryLayoutController } = await loadLayoutServices();
    const controller = new SummaryLayoutController();

    const plan = controller.planDialog({
        anchorRect: { left: 280, right: 320, top: 200, bottom: 240, width: 40, height: 40 },
        userSize: { width: 900, height: 700 },
        messageTexts: ['A measured summary message '.repeat(20)],
        inputText: 'Follow-up',
    });

    assert.equal(plan.width <= 288, true);
    assert.equal(plan.height <= 208, true);
    assert.equal(plan.left >= 16, true);
    assert.equal(plan.top >= 16, true);
    assert.equal(plan.left + plan.width <= 304, true);
    assert.equal(plan.top + plan.height <= 224, true);
});

test('SummaryLayoutController keeps the dialog edge tight to the floating button when space allows', async () => {
    const dom = setupDom();
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 960 });
    Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 720 });
    const { SummaryLayoutController } = await loadLayoutServices();
    const controller = new SummaryLayoutController();

    const plan = controller.planDialog({
        anchorRect: { left: 800, right: 848, top: 120, bottom: 168, width: 48, height: 48 },
        userSize: { width: 520, height: 420 },
    });

    assert.equal(plan.placement, 'left');
    assert.equal(800 - (plan.left + plan.width), 8);
    assert.equal(plan.top >= 16, true);
    assert.equal(plan.top + plan.height <= 704, true);
});

test('SummaryLayoutController reapplies message measurements when width changes', async () => {
    const dom = setupDom('<div id="message"><div class="message-content"></div></div>');
    const { SummaryLayoutController } = await loadLayoutServices();
    const controller = new SummaryLayoutController();
    const message = dom.window.document.querySelector('#message');
    const text = 'A long measured summary answer should wrap differently after the dialog width changes. '.repeat(8);

    const narrow = controller.applyMessageLayout(message, text, { width: 280, role: 'assistant' });
    const narrowHeight = message.style.getPropertyValue('--foxlate-summary-message-measured-height');
    const wide = controller.applyMessageLayout(message, text, { width: 640, role: 'assistant' });

    assert.equal(message.dataset.foxlateLayoutSource, 'fallback');
    assert.notEqual(message.style.getPropertyValue('--foxlate-summary-message-measured-height'), narrowHeight);
    assert.equal(wide.height < narrow.height, true);
});

test('TranslatedContentLayoutService writes measured layout metadata', async () => {
    const dom = setupDom('<p id="source">Source text</p><span id="appended"></span>');
    const { TranslatedContentLayoutService } = await loadLayoutServices();
    const service = new TranslatedContentLayoutService();
    const source = dom.window.document.querySelector('#source');
    const appended = dom.window.document.querySelector('#appended');
    source.getBoundingClientRect = () => ({ width: 220, height: 40, top: 0, left: 0, right: 220, bottom: 40 });

    const measurement = service.applyAppendLayout(appended, '<t0>Translated text should be measured</t0>', {
        referenceElement: source,
        appendType: 'block',
    });

    assert.equal(appended.dataset.foxlateLayoutSource, 'fallback');
    assert.equal(appended.style.getPropertyValue('--foxlate-translation-line-count'), String(measurement.lineCount));
    assert.match(appended.style.maxWidth, /px$/);
});

test('UITextLayoutService writes measured control metadata', async () => {
    const dom = setupDom('<button id="btn">Translate this entire page now</button>');
    const { UITextLayoutService } = await loadLayoutServices();
    const service = new UITextLayoutService();
    const button = dom.window.document.querySelector('#btn');
    button.getBoundingClientRect = () => ({ width: 180, height: 36, top: 0, left: 0, right: 180, bottom: 36 });

    service.applyElement(button, { minWidth: 80, paddingX: 24 });

    assert.equal(button.dataset.foxlateLayoutSource, 'fallback');
    assert.match(button.style.getPropertyValue('--foxlate-ui-text-width'), /px$/);
});

test('UITextLayoutService skips unchanged repeated measurements', async () => {
    const dom = setupDom('<button id="btn">Translate this page</button>');
    const { UITextLayoutService } = await loadLayoutServices();
    const service = new UITextLayoutService();
    const button = dom.window.document.querySelector('#btn');
    button.getBoundingClientRect = () => ({ width: 180, height: 36, top: 0, left: 0, right: 180, bottom: 36 });

    const first = service.applyElement(button, { minWidth: 80, paddingX: 24 });
    const second = service.applyElement(button, { minWidth: 80, paddingX: 24 });
    button.textContent = 'Show original';
    const third = service.applyElement(button, { minWidth: 80, paddingX: 24 });

    assert.equal(first?.source, 'fallback');
    assert.equal(second, null);
    assert.equal(third?.source, 'fallback');
});
