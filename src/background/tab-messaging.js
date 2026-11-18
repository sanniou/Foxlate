/**
 * 向标签页里的 content script 发消息，并容忍「刚注入、脚本还没跑起来」。
 *
 * 注入成功不等于脚本已经求值：`scripting.executeScript` 返回后，content script 要到
 * 下一次微任务/宏任务才会有 `runtime.onMessage` 监听器。这中间的窗口里 `tabs.sendMessage`
 * 会抛 "Could not establish connection. Receiving end does not exist."，用户点翻译
 * 看到的就是一次无声失败。这里按短退避重试几次，把窗口熬过去。
 *
 * 其它错误（标签页已关闭、权限不足）立刻抛出：重试不会让它们变好。
 */
const CONNECTION_LOST_PATTERNS = [
    'Receiving end does not exist',
    'Could not establish connection',
    'message channel closed',
    'message port closed',
];

export function isContentConnectionLostError(error) {
    const message = String(error?.message || '');
    return CONNECTION_LOST_PATTERNS.some(pattern => message.includes(pattern));
}

export async function sendMessageToContent({
    browserApi,
    tabId,
    message,
    retryDelaysMs = [50, 150, 300],
    sleep = defaultSleep,
} = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
        try {
            return await browserApi.tabs.sendMessage(tabId, message);
        } catch (error) {
            if (!isContentConnectionLostError(error)) {
                throw error;
            }
            lastError = error;
            const delay = retryDelaysMs[attempt];
            if (delay === undefined) {
                break;
            }
            await sleep(delay);
        }
    }
    throw lastError;
}

function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
