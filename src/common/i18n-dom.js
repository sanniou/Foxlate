import browser from '../lib/browser-polyfill.js';

/**
 * 声明式本地化：把 HTML 上的 `i18n-*` 标记翻译成真实属性。
 *
 * 为什么集中在 `common/`：popup 与 options 各自实现过一份，而且两边都只覆盖
 * `i18n-text` / `i18n-placeholder`。结果是 `aria-label` 与 `title` 只能写死英文——
 * 中文用户的「设置 / 交换语言 / 翻译设置」按钮会被读屏念成英文。
 * 这里补全属性面并统一实现，避免两个入口再次漂移。
 */

const TEXT_ATTRIBUTE = 'i18n-text';

/** HTML 上的标记属性 → 需要被写入的真实属性。 */
const DIRECT_TARGETS = [
    ['i18n-placeholder', 'placeholder'],
    ['i18n-aria-label', 'aria-label'],
    ['i18n-title', 'title'],
];

/**
 * 就地应用本地化。
 *
 * @param {ParentNode} root 作用范围（通常是 `document`）。
 * @param {object} [options]
 * @param {object} [options.browserApi] WebExtension API 入口，便于测试注入。
 * @param {(element: Element) => Element} [options.resolveTextTarget] 返回真正承载可见
 *   文字的元素。默认是元素自身；popup 的主按钮需要指向内部的 `.btn-text`，
 *   否则改 textContent 会把图标与加载指示一起清掉。
 */
export function applyI18nAttributes(root, {
    browserApi = browser,
    resolveTextTarget = element => element,
} = {}) {
    root.querySelectorAll(`[${TEXT_ATTRIBUTE}]`).forEach(element => {
        const message = browserApi.i18n.getMessage(element.getAttribute(TEXT_ATTRIBUTE));
        // 缺失的 key 在真实浏览器里返回空字符串，此时保留 HTML 里的兜底文案
        if (!message) return;
        resolveTextTarget(element).textContent = message;
    });

    for (const [marker, target] of DIRECT_TARGETS) {
        root.querySelectorAll(`[${marker}]`).forEach(element => {
            const message = browserApi.i18n.getMessage(element.getAttribute(marker));
            if (!message) return;
            element.setAttribute(target, message);
        });
    }
}
