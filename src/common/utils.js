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