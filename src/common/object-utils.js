/**
 * 对象工具：深冻结与结构化相等。
 *
 * 这两个函数存在的理由是一件事：**设置对象是共享的、只读的**。
 * 早期实现对每次读取都做一次 `structuredClone` 全量深拷贝来"保证安全"，
 * 而变更检测又对每个关键项做 `JSON.stringify` 来"比较"。两者都在热路径上
 * 无谓分配。改成「写入时深冻结一次 + 比较时短路递归」后，读取是零分配，
 * 比较在第一个差异处即返回，且越界写入会立即抛错而不是静默污染共享状态。
 */

/**
 * 递归冻结对象及其所有嵌套的普通对象/数组，并返回同一引用。
 *
 * 幂等：遇到已经冻结的子树（设置对象里大量嵌套结构与顶层共享引用）直接跳过，
 * 因此对 `resolveEffectiveSettings` 这类「浅拷贝 + 复用嵌套」的产物开销极小。
 *
 * @template T
 * @param {T} value - 待冻结的值；原始值与非对象原样返回。
 * @returns {T} 同一引用。
 */
export function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
        return value;
    }

    Object.freeze(value);
    for (const key of Object.keys(value)) {
        deepFreeze(value[key]);
    }
    return value;
}

/**
 * 结构化相等：递归比较，遇到第一个差异立即返回，不构造中间字符串。
 *
 * 与 `JSON.stringify(a) === JSON.stringify(b)` 的关键区别：
 * - 不分配：不会把整个对象序列化成字符串（大数组如 `aiEngines` 上是数量级差异）；
 * - 键序无关：`{a:1,b:2}` 与 `{b:2,a:1}` 判为相等（JSON 会误判为不等）；
 * - 语义正确：`NaN` 视为等于 `NaN`，`undefined` 属性与缺失属性视为相等。
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function isDeepEqual(a, b) {
    if (a === b) {
        return true;
    }
    if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
        return true;
    }
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }
    if (Array.isArray(a) !== Array.isArray(b)) {
        return false;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }

    for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) {
            return false;
        }
        if (!isDeepEqual(a[key], b[key])) {
            return false;
        }
    }
    return true;
}
