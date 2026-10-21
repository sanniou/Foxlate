import { getLatency } from '../handler-context.js';

/**
 * 记录一次引擎调用的健康度。
 *
 * 这组字段原先在 6 个 handler 里逐字重复 7 遍，任何一次改动都可能只改到其中几处。
 * `error` 为假值即成功——与 `ProviderHealthStore.record` 的 `success` 语义一致。
 */
export async function recordEngineHealth({ healthStore, engine, startedAt, error = null }) {
    await healthStore.record({
        engine: engine || 'default',
        success: !error,
        error: error || null,
        latencyMs: getLatency(startedAt),
    });
}

/**
 * 成功记历史、失败记失败队列。
 *
 * 页面翻译、页面批量、输入框翻译三条路都执行这一支，只有 `surface` 不同。
 * 「测试」类入口刻意不走这里——它们不该污染用户的历史与失败队列。
 */
export async function recordTranslationOutcome({
    historyStore,
    failureQueue,
    sourceText,
    result,
    targetLang,
    sourceLang,
    engine,
    hostname,
    surface,
}) {
    if (result.error) {
        await failureQueue.recordFailure({
            sourceText,
            targetLang,
            sourceLang,
            engine,
            hostname,
            surface,
            error: result.error,
        });
        return;
    }
    if (result.translated) {
        await historyStore.recordSuccess({
            sourceText,
            translatedText: result.text,
            targetLang,
            sourceLang,
            engine,
            hostname,
            surface,
        });
    }
}

/**
 * 把结果发回标签页。
 *
 * 接收方可能已经跑掉（页面导航、标签关闭），这种「Receiving end does not exist」
 * 是正常竞态而不是故障，只有其他发送错误才值得上报。
 */
export async function sendToTabIgnoringMissingReceiver({ browserApi, tabId, message, logError, label }) {
    try {
        await browserApi.tabs.sendMessage(tabId, message);
    } catch (sendError) {
        if (!sendError.message.includes('Receiving end does not exist')) {
            logError(label, sendError);
        }
    }
}
