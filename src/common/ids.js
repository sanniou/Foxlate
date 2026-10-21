/**
 * 生成一个通用的唯一 ID。
 *
 * 原本在 element-translation-controller / content-runtime / translation-batch-queue
 * 三个文件里各写了一份逐字节相同的 `defaultGenerateId`。
 *
 * @returns {string} 唯一的 ID
 */
export function generateId() {
    if (typeof self !== 'undefined' && self.crypto?.randomUUID) {
        return self.crypto.randomUUID();
    }
    return `foxlate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 生成一个唯一的 AI 引擎 ID。
 * @returns {string} 唯一的 ID。
 */
export function generateUniqueEngineId() {
    return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
