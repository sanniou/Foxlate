import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createI18nMock } from './helpers/i18n-mock.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');

/**
 * 摘要面板是无障碍缺口最集中的地方（键盘根本进不去），
 * 因此这里用 jsdom 直接驱动真实的 SummaryDialog / SummaryButton，
 * 断言的是「键盘用户能不能操作」，而不是类名有没有写对。
 */
function setupDom() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    const { window } = dom;

    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Element = window.Element;
    globalThis.Node = window.Node;
    globalThis.Event = window.Event;
    globalThis.CustomEvent = window.CustomEvent;
    globalThis.KeyboardEvent = window.KeyboardEvent;
    globalThis.MouseEvent = window.MouseEvent;
    globalThis.getComputedStyle = window.getComputedStyle.bind(window);
    globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window)
        ?? (callback => setTimeout(() => callback(Date.now()), 0));
    globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout;
    globalThis.ResizeObserver = window.ResizeObserver ?? class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    globalThis.MutationObserver = window.MutationObserver;

    // jsdom 没有 canvas 实现，getContext 只会往控制台喷 "Not implemented"。
    // 给一个确定性的测量替身，让布局服务跑真实代码路径而不是降级启发式。
    window.HTMLCanvasElement.prototype.getContext = function getContext() {
        return { font: '', measureText: text => ({ width: String(text).length * 7 }) };
    };

    globalThis.__foxlateBrowserMock = {
        i18n: createI18nMock(),
        runtime: { sendMessage: async () => ({}) },
        storage: {
            local: { get: async () => ({}), set: async () => {} },
            onChanged: { addListener() {} },
        },
    };

    return dom;
}

async function bundleSummaryModules() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-summary-a11y-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { SummaryDialog } from ${JSON.stringify(path.join(projectRoot, 'src/content/summary/summary.view.js'))};
        export { SummaryButton } from ${JSON.stringify(path.join(projectRoot, 'src/content/summary/summary-button.view.js'))};
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
            name: 'foxlate-summary-a11y-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({ path: mockBrowserPath }));
            },
        }],
    });

    const modules = await import(pathToFileURL(outputPath).href);
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

/** 打开一个已经渲染好标签页的面板，返回事件收集器。 */
async function openDialogWithTabs({ tabCount = 2 } = {}) {
    const { SummaryDialog } = await bundleSummaryModules();
    const dialog = new SummaryDialog();

    const tabs = Array.from({ length: tabCount }, (_, index) => ({
        id: index + 1,
        title: `Tab ${index + 1}`,
        type: index === 0 ? 'page' : 'selection',
    }));
    dialog.renderTabs(tabs, tabs[0].id);

    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const dispatched = [];
    for (const type of ['request-close', 'tab-switch', 'tab-close', 'tab-toggle-original']) {
        dialog.element.addEventListener(type, event => dispatched.push({ type, detail: event.detail }));
    }
    // 模拟真实控制器的响应：收到 tab-switch 后重建 tablist。
    // 这决定了方向键测试里“当前页”会不会前进，必须忠实复现。
    dialog.element.addEventListener('tab-switch', event => {
        dialog.renderTabs(tabs, event.detail.tabId);
    });

    dialog.show({ sourceElement: trigger, left: 10, top: 10, right: 60, bottom: 60, width: 50, height: 50 });

    return { dialog, dispatched, trigger, tabs };
}

test('摘要悬浮入口是真实 button，键盘可聚焦且可激活', async () => {
    setupDom();
    const { SummaryButton } = await bundleSummaryModules();

    const button = new SummaryButton();

    assert.equal(button.element.tagName, 'BUTTON', 'div 形式对键盘与读屏都不可达');
    assert.equal(button.element.type, 'button', 'type=button 防止意外触发表单提交');
    assert.ok(button.element.getAttribute('aria-label'), '图标按钮必须有可读名称');
    assert.equal(button.element.hasAttribute('tabindex'), false, '不能被 tabindex=-1 移出 Tab 序列');
});

test('面板声明为 dialog 并带有可读名称（但不谎报为模态）', async () => {
    setupDom();
    const { dialog } = await openDialogWithTabs();

    assert.equal(dialog.element.getAttribute('role'), 'dialog');
    assert.ok(dialog.element.getAttribute('aria-label'), 'dialog 必须有可读名称');
    assert.equal(dialog.element.getAttribute('aria-modal'), null, '页面其余部分仍可交互，不应标为模态');
});

test('标签页标题是 role=tab 的真实 button，且使用 roving tabindex', async () => {
    setupDom();
    const { dialog } = await openDialogWithTabs({ tabCount: 3 });

    const titles = Array.from(dialog.tabsArea.querySelectorAll('.foxlate-summary-tab-title'));
    assert.equal(titles.length, 3);
    assert.equal(dialog.tabsArea.getAttribute('role'), 'tablist');

    for (const title of titles) {
        assert.equal(title.tagName, 'BUTTON', '<span> 无法被键盘触达');
        assert.equal(title.type, 'button');
        assert.equal(title.getAttribute('role'), 'tab');
    }

    assert.equal(titles[0].getAttribute('aria-selected'), 'true');
    assert.equal(titles[0].getAttribute('tabindex'), '0', '当前标签页在 Tab 序列里');
    assert.equal(titles[1].getAttribute('aria-selected'), 'false');
    assert.equal(titles[1].getAttribute('tabindex'), '-1', '非当前标签页靠方向键到达');
    assert.equal(titles[2].getAttribute('tabindex'), '-1');
});

test('标签页关闭按钮有无障碍名称，且单标签页时不渲染', async () => {
    setupDom();
    const { dialog } = await openDialogWithTabs({ tabCount: 2 });

    const closeButton = dialog.tabsArea.querySelector('.foxlate-summary-tab-close');
    assert.equal(closeButton.tagName, 'BUTTON');
    assert.equal(closeButton.type, 'button');
    assert.ok(closeButton.getAttribute('aria-label'), '图标按钮必须有可读名称');

    const single = await openDialogWithTabs({ tabCount: 1 });
    assert.equal(single.dialog.tabsArea.querySelector('.foxlate-summary-tab-close'), null);
});

test('Esc 请求关闭面板（并在 destroy 后彻底解除）', async () => {
    setupDom();
    const { dialog, dispatched } = await openDialogWithTabs();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.deepEqual(dispatched.map(entry => entry.type), ['request-close']);

    // 输入法组合期间的 Esc 属于取消候选词，不能顺手关掉面板
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
    assert.equal(dispatched.length, 1, 'isComposing 的 Esc 不应触发关闭');

    dialog.destroy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(dispatched.length, 1, 'destroy 后不得留下全局按键监听');
});

test('← → 在标签页之间切换并把焦点交给新的当前页', async () => {
    setupDom();
    const { dialog, dispatched } = await openDialogWithTabs({ tabCount: 3 });

    const titles = Array.from(dialog.tabsArea.querySelectorAll('.foxlate-summary-tab-title'));
    titles[0].focus();

    dialog.tabsArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.deepEqual(
        dispatched.map(entry => entry.type),
        ['tab-switch'],
    );
    assert.equal(dispatched[0].detail.tabId, 2);

    dialog.tabsArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(dispatched.at(-1).detail.tabId, 3, 'End 直达最后一个标签页');

    dialog.tabsArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(dispatched.at(-1).detail.tabId, 1, '在末尾再次右移应回绕到第一个');

    // 左移同样要回绕
    dialog.tabsArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(dispatched.at(-1).detail.tabId, 3);
});

test('方向键只在焦点确实位于标签页时才生效', async () => {
    setupDom();
    const { dialog, dispatched } = await openDialogWithTabs({ tabCount: 2 });

    // 焦点在面板本体（show() 之后默认如此）时，方向键不应切换标签页
    dialog.element.focus();
    dialog.tabsArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.deepEqual(dispatched, [], '没有标签页获得焦点时不应抢方向键');
});

test('关闭后把焦点还给打开面板前的元素', async () => {
    setupDom();
    const { dialog, trigger } = await openDialogWithTabs();

    assert.equal(document.activeElement, dialog.element, '打开时焦点应进入面板');

    dialog.hide();
    assert.equal(document.activeElement, trigger, '关闭后焦点必须归还，否则键盘用户被丢回页面顶部');
});

test('单标签页时忽略方向键', async () => {
    setupDom();
    const { dialog, dispatched } = await openDialogWithTabs({ tabCount: 1 });

    dialog.tabsArea.querySelector('.foxlate-summary-tab-title').focus();
    dialog.tabsArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    assert.deepEqual(dispatched, []);
});
