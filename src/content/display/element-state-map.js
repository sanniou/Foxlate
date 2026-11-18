/**
 * 元素状态表的唯一持有者。
 *
 * 为什么单独成模块：四个显示策略只「读」元素状态，却要通过
 * `import { DisplayManager }` 拿到它，而 DisplayManager 又经
 * `display/display-strategy-registry.js` 反向 import 这四个策略——模块图成环。
 * ESM 的环不会死锁，但只要有一侧在模块求值期就用到另一侧的值，就会拿到 undefined；
 * 状态表是纯数据、无依赖，放在叶子模块里，策略就只依赖叶子，环从 4 个降到 0 个。
 *
 * WeakMap 的键是 DOM 元素：元素被移除且没有其他引用时，状态项随元素一起被回收，
 * 动态页面上不会因为记录状态而泄漏内存。
 */
export const elementStates = new WeakMap();

/**
 * 读取元素上的显示状态数据（包括 `state`、`translatedText`、原文等）。
 *
 * @param {Element} element 目标元素
 * @returns {object | undefined} 状态数据；从未翻译过时为 undefined
 */
export function getElementData(element) {
    return elementStates.get(element);
}
