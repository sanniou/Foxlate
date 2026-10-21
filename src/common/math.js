/**
 * 数值夹取。
 *
 * 这个函数原本在 6 个文件里逐字节重复了一份（common/ 1 处、content/layout/ 4 处、
 * options/ 1 处），改一处就得改六处。集中到这里作为唯一实现。
 *
 * @param {number} value 待夹取的数值
 * @param {number} min 下界
 * @param {number} max 上界
 * @returns {number} 夹取后的数值
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}
