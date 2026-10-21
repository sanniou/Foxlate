import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

/**
 * options 的模态框层承载了「全部破坏性操作」（删除规则、重置设置、导入引擎），
 * 之前只做到了「能点」：焦点不进面板、Tab 能跑到被遮住的页面上、Esc 会把叠起来
 * 的两层一起关掉。这里断言的是键盘与读屏用户实际能不能安全操作。
 */
function setupDom(html) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { pretendToBeVisual: true });
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

    return dom;
}

const { BaseComponent } = await bundleModule(
    reexportSource('src/options/components/BaseComponent.js', ['BaseComponent']),
);

/** 测试用模态框组件：记录 Esc 被触发了几次。 */
function createComponent() {
    const component = new class extends BaseComponent {
        escCount = 0;
        open(modal) {
            this._openModalSurface(modal);
        }
        close(modal) {
            this._closeModalSurface(modal);
        }
        _handleEscKey() {
            this.escCount += 1;
        }
    }();
    return component;
}

const MUTATING_MODAL = `
    <button id="trigger">Open</button>
    <div id="modal" class="modal-backdrop">
        <button id="first">First</button>
        <input id="middle">
        <button id="last">Last</button>
    </div>
`;

/** 模态框栈是模块级状态，每个用例都要把自己开的那层关掉。 */
function closeModal(dom, component, modal) {
    component.close(modal);
    modal.dispatchEvent(new dom.window.Event('transitionend'));
}

test('打开模态框时焦点进入面板，而不是留在被遮住的页面上', (t) => {
    const dom = setupDom(MUTATING_MODAL);
    const component = createComponent();
    const modal = dom.window.document.querySelector('#modal');
    const trigger = dom.window.document.querySelector('#trigger');
    trigger.focus();

    component.open(modal);
    t.after(() => closeModal(dom, component, modal));

    assert.equal(dom.window.document.activeElement, dom.window.document.querySelector('#first'));
});

test('面板内没有可聚焦元素时，焦点兜底落在面板本体上', (t) => {
    const dom = setupDom('<div id="modal" class="modal-backdrop"><p>纯文本</p></div>');
    const component = createComponent();
    const modal = dom.window.document.querySelector('#modal');

    component.open(modal);
    t.after(() => closeModal(dom, component, modal));

    assert.equal(dom.window.document.activeElement, modal);
    assert.equal(modal.getAttribute('tabindex'), '-1', '面板本体要可被程序化聚焦');
});

test('关闭模态框时焦点归还给打开它的控件', () => {
    const dom = setupDom(MUTATING_MODAL);
    const component = createComponent();
    const modal = dom.window.document.querySelector('#modal');
    const trigger = dom.window.document.querySelector('#trigger');
    trigger.focus();

    component.open(modal);
    component.close(modal);
    modal.dispatchEvent(new dom.window.Event('transitionend'));

    assert.equal(dom.window.document.activeElement, trigger, '否则键盘用户被丢回页面开头');
});

test('Tab 在最后一个控件上回绕到第一个，Shift+Tab 反向回绕', (t) => {
    const dom = setupDom(MUTATING_MODAL);
    const component = createComponent();
    const doc = dom.window.document;
    const modal = doc.querySelector('#modal');

    component.open(modal);
    t.after(() => closeModal(dom, component, modal));

    doc.querySelector('#last').focus();
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    assert.equal(doc.activeElement, doc.querySelector('#first'));

    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    assert.equal(doc.activeElement, doc.querySelector('#last'));
});

test('焦点已经跑到面板外时，Tab 把它拉回面板内', (t) => {
    const dom = setupDom(MUTATING_MODAL);
    const component = createComponent();
    const doc = dom.window.document;
    const modal = doc.querySelector('#modal');

    component.open(modal);
    t.after(() => closeModal(dom, component, modal));
    // 模拟脚本或点击遮罩把焦点甩到页面上
    doc.querySelector('#trigger').focus();

    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    assert.equal(doc.activeElement, doc.querySelector('#first'));
});

test('叠放的模态框只关最上面一层', (t) => {
    const dom = setupDom(`
        <div id="lower" class="modal-backdrop"><button>L</button></div>
        <div id="upper" class="modal-backdrop"><button>U</button></div>
    `);
    const doc = dom.window.document;
    const lower = createComponent();
    const upper = createComponent();
    const lowerModal = doc.querySelector('#lower');
    const upperModal = doc.querySelector('#upper');

    lower.open(lowerModal);
    upper.open(upperModal);
    t.after(() => {
        closeModal(dom, upper, upperModal);
        closeModal(dom, lower, lowerModal);
    });

    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    assert.equal(upper.escCount, 1, '栈顶应收到 Esc');
    assert.equal(lower.escCount, 0, '旧实现里两层监听都触发，一个 Esc 关掉全部');
});

test('Esc 只在最上层响应，面板全部关闭后不再残留 document 监听', (t) => {
    const dom = setupDom(MUTATING_MODAL);
    const component = createComponent();
    const doc = dom.window.document;
    const modal = doc.querySelector('#modal');

    component.open(modal);
    t.after(() => closeModal(dom, component, modal));

    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(component.escCount, 1);

    closeModal(dom, component, modal);
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(component.escCount, 1, '关闭后 Esc 不该再被面板截获');
});

test('子元素的 transitionend 不会提前把面板收尾', () => {
    const dom = setupDom(MUTATING_MODAL);
    const component = createComponent();
    const doc = dom.window.document;
    const modal = doc.querySelector('#modal');
    const inner = doc.querySelector('#first');

    component.open(modal);
    component.close(modal);

    // `.modal-content` 的 transform 过渡会冒泡到遮罩上
    inner.dispatchEvent(new dom.window.Event('transitionend', { bubbles: true }));

    assert.equal(modal.style.display, 'flex', '淡出还没走完，不应提前 display:none');
    assert.equal(doc.body.classList.contains('modal-open'), true);

    modal.dispatchEvent(new dom.window.Event('transitionend'));
    assert.equal(modal.style.display, 'none');
    assert.equal(doc.body.classList.contains('modal-open'), false);
});

test('过渡事件始终不来时，兜底计时器仍然完成收尾', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const dom = setupDom(MUTATING_MODAL);
    const component = createComponent();
    const doc = dom.window.document;
    const modal = doc.querySelector('#modal');

    component.open(modal);
    component.close(modal);
    // 完全不派发 transitionend，模拟过渡被禁用
    t.mock.timers.tick(400);

    assert.equal(modal.style.display, 'none', '没有兜底就会留下一个透明但仍 display:flex 的遮罩');
    assert.equal(doc.body.classList.contains('modal-open'), false, 'body.modal-open 不摘掉会让页面再也滚不动');
});
