/**
 * Escapes a string for safe insertion into HTML.
 * @param {string} unsafe - The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHtml(unsafe = '') {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 生成一个唯一的 AI 引擎 ID。
 * @returns {string} 唯一的 ID。
 */
export function generateUniqueEngineId() {
    return `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Creates a debounced function that delays invoking `func` until after `delay` milliseconds have elapsed
 * since the last time the debounced function was invoked.
 * @param {Function} func The function to debounce.
 * @param {number} delay The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
export function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}