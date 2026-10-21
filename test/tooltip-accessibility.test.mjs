import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { bundleModule, projectRoot } from './helpers/bundle.mjs';

/**
 * 悬浮窗（划词翻译的增强面板）只靠图标按钮操作，是扩展里最依赖「看到图标就懂」的界面。
 * 这里锁住两件之前完全没有的事：图标按钮有无障碍名称、键盘能把它关掉。
 */

const MESSAGES = {
    tooltipPin: 'Pin',
    tooltipUnpin: 'Unpin',
    tooltipCollapseSource: 'Collapse source',
    tooltipExpandSource: 'Expand source',
    tooltipCopied: 'Copied',
    tooltipReadSource: 'Read source',
    tooltipReadTarget: 'Read translation',
    tooltipCopySource: 'Copy source',
    tooltipCopyTarget: 'Copy translation',
    tooltipClose: 'Close',
    tooltipSourceText: 'Source text',
    tooltipTargetText: 'Translated text',
    tooltipTranslating: 'Translating...',
};

// 必须在 import 被测模块之前就位：`tooltip-speech-controller` 的构造函数默认参数
// 直接读 `window.speechSynthesis`，模块加载瞬间就会求值。
const dom = new JSDOM('<!doctype html><html><body><p id="anchor">hello</p></body></html>', {
    pretendToBeVisual: true,
});
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
// jsdom 没有 canvas，布局测量会退回启发式；显式返回 null 免得刷一屏 "Not implemented"
window.HTMLCanvasElement.prototype.getContext = () => null;

globalThis.__foxlateBrowserMock = {
    i18n: { getMessage: (key) => MESSAGES[key] ?? '' },
};

const iconsPath = path.join(projectRoot, 'src/content/tooltip/tooltip-icons.js');
const managerPath = path.join(projectRoot, 'src/content/enhanced-tooltip-manager.js');

const { createTooltipIconButton, setTooltipIconButtonLabel } = await bundleModule(
    `export { createTooltipIconButton, setTooltipIconButtonLabel } from ${JSON.stringify(iconsPath)};`,
);
const { default: tooltipManager } = await bundleModule(
    `export { default } from ${JSON.stringify(managerPath)};`,
);

const doc = window.document;

function escKey() {
    return new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
}

function showTooltip({ onHide } = {}) {
    const target = doc.querySelector('#anchor');
    tooltipManager.show('hello', '你好', {
        targetElement: target,
        sourceLang: 'en',
        targetLang: 'zh',
        onHide,
    });
    return doc.querySelector('.foxlate-enhanced-panel');
}

test('图标按钮是真实 button，并带与 title 一致的无障碍名称', () => {
    const button = createTooltipIconButton('toggle-btn', 'expand', 'Expand source');

    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button', '缺 type 会在宿主页面的 form 里变成提交按钮');
    assert.equal(button.getAttribute('aria-label'), 'Expand source', '只给 title 时读屏拿不到稳定的名称');
    assert.equal(button.title, 'Expand source');
});

test('更新图标按钮文案时两处一起改，空值移除 aria-label', () => {
    const button = createTooltipIconButton('pin-btn', 'pin', 'Pin');

    setTooltipIconButtonLabel(button, 'Unpin');
    assert.equal(button.getAttribute('aria-label'), 'Unpin');
    assert.equal(button.title, 'Unpin');

    setTooltipIconButtonLabel(button, '');
    assert.equal(button.hasAttribute('aria-label'), false);
});

test('固定 / 取消固定时固定按钮的读屏名称跟着切换', (t) => {
    const panel = showTooltip();
    t.after(() => tooltipManager.dismiss());

    const pinBtn = panel.querySelector('.foxlate-pin-btn');
    assert.equal(pinBtn.getAttribute('aria-label'), 'Pin');

    pinBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(pinBtn.getAttribute('aria-label'), 'Unpin', '否则读屏会一直念上一个状态的名称');

    pinBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(pinBtn.getAttribute('aria-label'), 'Pin');
});

test('折叠 / 展开时折叠按钮的读屏名称跟着切换', (t) => {
    const panel = showTooltip();
    t.after(() => tooltipManager.dismiss());

    // 译文区默认展开，源文区默认折叠
    const targetToggle = panel.querySelector('.target-section .toggle-btn');
    assert.equal(targetToggle.getAttribute('aria-label'), 'Collapse source');

    targetToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(targetToggle.getAttribute('aria-label'), 'Expand source');

    const sourceToggle = panel.querySelector('.source-section .toggle-btn');
    assert.equal(sourceToggle.getAttribute('aria-label'), 'Expand source');

    sourceToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(sourceToggle.getAttribute('aria-label'), 'Collapse source');
});

test('焦点在悬浮窗内时 Esc 关闭它并通知调用方', (t) => {
    let hidden = 0;
    const panel = showTooltip({ onHide: () => { hidden += 1; } });
    t.after(() => tooltipManager.dismiss());

    panel.querySelector('.foxlate-close-btn').focus();
    doc.dispatchEvent(escKey());

    assert.equal(panel.classList.contains('visible'), false);
    assert.equal(hidden, 1, '必须回调 onHide，否则译文显示不会被还原');
});

test('固定状态下即使焦点在页面上，Esc 也能关掉悬浮窗', (t) => {
    let hidden = 0;
    const panel = showTooltip({ onHide: () => { hidden += 1; } });
    t.after(() => tooltipManager.dismiss());

    panel.querySelector('.foxlate-pin-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(panel.classList.contains('pinned'), true);

    doc.querySelector('#anchor').focus();
    doc.dispatchEvent(escKey());

    assert.equal(panel.classList.contains('visible'), false);
    assert.equal(panel.classList.contains('pinned'), false);
    assert.equal(hidden, 1, '固定态下 hide() 会直接返回，先解固定才不会出现「Esc 没反应」');
});

test('未固定且焦点不在悬浮窗内时，Esc 留给页面自己处理', (t) => {
    const panel = showTooltip();
    t.after(() => tooltipManager.dismiss());

    let pageEscape = 0;
    const pageHandler = () => { pageEscape += 1; };
    doc.addEventListener('keydown', pageHandler);
    t.after(() => doc.removeEventListener('keydown', pageHandler));

    doc.querySelector('#anchor').focus();
    doc.dispatchEvent(escKey());

    assert.equal(pageEscape, 1, '抢走页面的 Esc（关弹窗、退全屏）是更糟的体验');
    assert.equal(panel.classList.contains('visible'), true);
});

test('关闭按钮在固定状态下同样能关掉并停掉朗读', (t) => {
    let hidden = 0;
    const panel = showTooltip({ onHide: () => { hidden += 1; } });
    t.after(() => tooltipManager.dismiss());

    panel.querySelector('.foxlate-pin-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    panel.querySelector('.foxlate-close-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    assert.equal(panel.classList.contains('visible'), false);
    assert.equal(hidden, 1);
});
