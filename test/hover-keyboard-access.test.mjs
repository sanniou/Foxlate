import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { bundleModule, projectRoot } from './helpers/bundle.mjs';

/**
 * hover 显示模式此前只有 `mouseenter`：用键盘 Tab 在链接间移动的人，
 * 在整个模式下拿不到任何译文。这里锁住三件事：
 * 1. 键盘聚焦也能看到译文（focus 触发、blur 收起）；
 * 2. revert 之后四个监听器全部摘掉（不留焦点进不去、鼠标一碰还弹窗的僵尸元素）；
 * 3. 错误态文案走 i18n，不再写死英文。
 */

const MESSAGES = {
    contextMenuErrorPrefix: '错误',
    translationFailedFallback: '翻译失败',
};

const dom = new JSDOM('<!doctype html><html><body><a id="link" href="#x">原文</a></body></html>', {
    pretendToBeVisual: true,
});
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

globalThis.__foxlateBrowserMock = {
    i18n: { getMessage: (key) => MESSAGES[key] ?? '' },
};

const hoverStrategyPath = path.join(projectRoot, 'src/content/strategies/hover-strategy.js');
const { HoverStrategy } = await bundleModule(
    `export { HoverStrategy } from ${JSON.stringify(hoverStrategyPath)};`,
);

function createSurfaceSpy() {
    const calls = { show: [], scheduleHide: 0, cleanup: 0 };
    return {
        calls,
        surface: {
            show: (payload) => calls.show.push(payload),
            scheduleHide: () => { calls.scheduleHide += 1; },
            cleanup: () => { calls.cleanup += 1; },
        },
    };
}

test('键盘聚焦也显示译文，失焦收起', () => {
    const { calls, surface } = createSurfaceSpy();
    const strategy = new HoverStrategy({ surface });
    const link = document.getElementById('link');

    strategy.displayTranslation(link, '原文', '【译】原文');

    link.dispatchEvent(new window.MouseEvent('mouseenter'));
    assert.deepEqual(calls.show.at(-1), { text: '【译】原文', targetElement: link, isError: false });

    link.dispatchEvent(new window.Event('focus'));
    assert.equal(calls.show.length, 2, 'focus 必须和 mouseenter 走同一条展示路径');

    link.dispatchEvent(new window.Event('blur'));
    assert.ok(calls.scheduleHide >= 1, 'blur 后应收起浮层');
});

test('revert 之后鼠标与焦点都不再触发浮层', () => {
    const { calls, surface } = createSurfaceSpy();
    const strategy = new HoverStrategy({ surface });
    const link = document.getElementById('link');

    strategy.displayTranslation(link, '原文', '【译】原文');
    strategy.revert(link);

    const before = calls.show.length;
    link.dispatchEvent(new window.MouseEvent('mouseenter'));
    link.dispatchEvent(new window.Event('focus'));
    assert.equal(calls.show.length, before, '监听器必须全部摘掉，否则撤销翻译后仍会弹译文');
});

test('错误态文案来自 i18n，不写死英文', async () => {
    const { calls, surface } = createSurfaceSpy();
    const strategy = new HoverStrategy({ surface });
    const link = document.getElementById('link');
    // 没有任何状态数据：错误详情为空，只剩回退文案。这条路径以前写死英文 'Translation Error'。
    strategy.updateUI(link, 'error');

    link.dispatchEvent(new window.MouseEvent('mouseenter'));
    assert.equal(calls.show.at(-1).text, '错误: 翻译失败');
    assert.equal(calls.show.at(-1).isError, true);
});
