import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { bundleModule, projectRoot } from './helpers/bundle.mjs';

/**
 * 性能浮层是开发期的观察工具，不是产品界面。
 *
 * 此前它对**所有用户**渲染在页面右上角，并且每次进度回调都 `innerHTML` 重建约 20 个
 * 节点（`onProgress` 每批一次、`onBatchStateChange` 每批一次、retry 每次一次）。
 * 500 段的页面因此有上千次无谓的 DOM 重建。现在只允许在 `__DEBUG__` 为真时存在。
 */

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;

const hudPath = path.join(projectRoot, 'src/content/performance/translation-performance-hud.js');

async function loadHud(debug) {
    globalThis.__DEBUG__ = debug;
    const { TranslationPerformanceHud } = await bundleModule(
        `export { TranslationPerformanceHud } from ${JSON.stringify(hudPath)};`,
        { prefix: `foxlate-hud-${debug ? 'debug' : 'prod'}-` },
    );
    return new TranslationPerformanceHud();
}

test('生产模式下不创建任何 DOM 节点，也不重绘', async () => {
    const hud = await loadHud(false);

    for (let index = 0; index < 50; index += 1) {
        hud.update({ state: 'loading', started: index, completed: index });
        hud.updateBatch({ queued: index, inFlight: 1 });
        hud.updateRetry({ retryDelayMs: 500 });
    }

    assert.equal(document.querySelector('.foxlate-performance-hud'), null, '生产模式不得在页面上留下浮层');
});

test('调试模式下浮层可见并能反映进度', async () => {
    const hud = await loadHud(true);

    hud.update({ state: 'loading', started: 3, completed: 1, failed: 0 });

    const element = document.querySelector('.foxlate-performance-hud');
    assert.ok(element, '调试模式应当渲染浮层');
    assert.match(element.textContent, /loading/);
    assert.match(element.textContent, /1\/3/);
});
