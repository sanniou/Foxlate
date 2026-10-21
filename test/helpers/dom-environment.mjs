// jsdom 环境装配：把 window/document/Node 等挂到全局，并给布局相关的只读属性
// 打上可预测的桩（jsdom 不做真实布局，offsetParent/offsetWidth 天然为 0）。
//
// 原先这段装配散在各个 DOM 测试文件里各写一遍，改一处桩就要同步改多处。
import { JSDOM } from 'jsdom';

/**
 * 建立 jsdom 环境并安装全局。
 *
 * 桩的语义：
 * - `offsetParent`：html/body 之外一律返回 body（即「有布局父级」）。
 * - `offsetWidth`/`offsetHeight`：`display: none` 时为 0，否则为非零值。
 *
 * @param {string} html - 会放进 `<body>` 的内容。
 * @returns {JSDOM} 可直接用 `dom.window` 取文档。
 */
export function installDomEnvironment(html) {
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
