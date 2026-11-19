import { MESSAGE_TYPES } from '../../../common/message-types.js';
import { getHostname } from '../handler-context.js';
import {
    recordEngineHealth,
    recordTranslationOutcome,
    sendToTabIgnoringMissingReceiver,
} from './translation-handler-support.js';

/**
 * 页面翻译的批量请求。
 *
 * 与单条路径的区别不只是循环：整批只记一次健康度（条数不该放大成功/失败计数），
 * 而历史与失败队列仍逐条记录。
 */
export function createTranslateTextBatchHandler({
    browserApi,
    translatorManager,
    historyStore,
    failureQueue,
    healthStore,
    logError,
}) {
    return async function translateTextBatch(request, sender) {
        const { batchId, items, targetLang, sourceLang = 'auto', translatorEngine, tabId } = request.payload;
        const originTabId = sender.tab?.id || tabId;

        if (!originTabId || !Array.isArray(items)) {
            logError('TRANSLATE_TEXT_BATCH', new Error('Invalid TRANSLATE_TEXT_BATCH call: Missing originTabId or items.'));
            return;
        }

        const startedAt = Date.now();
        try {
            const texts = items.map(item => item.text);
            const results = await translatorManager.translateBatch(texts, targetLang, sourceLang, translatorEngine, originTabId);
            const hasFailure = results.some(result => result?.error);
            await recordEngineHealth({
                healthStore,
                engine: translatorEngine,
                startedAt,
                error: hasFailure ? 'One or more batch items failed.' : null,
            });

            for (const [index, result] of results.entries()) {
                await recordTranslationOutcome({
                    historyStore,
                    failureQueue,
                    sourceText: items[index]?.text || '',
                    result: result || {},
                    targetLang,
                    sourceLang,
                    engine: translatorEngine,
                    hostname: getHostname(sender),
                    surface: 'page-batch',
                });
            }
            // 记录是内存态 + 合并写；这里显式落盘，别让「整批成功但历史丢了」取决于定时器
            // 能否在 service worker 被回收前跑完。
            await Promise.all([historyStore.flush?.(), failureQueue.flush?.()]);

            await sendToTabIgnoringMissingReceiver({
                browserApi,
                tabId: originTabId,
                message: {
                    type: MESSAGE_TYPES.TRANSLATE_TEXT_BATCH_RESULT,
                    payload: {
                        batchId,
                        items: items.map((item, index) => {
                            const result = results[index] || {};
                            return {
                                elementId: item.elementId,
                                success: !result.error,
                                translatedText: result.text || '',
                                wasTranslated: !!result.translated,
                                error: result.error || null,
                            };
                        }),
                    },
                },
                logError,
                label: 'TRANSLATE_TEXT_BATCH (sending error)',
            });
        } catch (error) {
            logError('TRANSLATE_TEXT_BATCH (execution)', error);
            await recordEngineHealth({
                healthStore,
                engine: translatorEngine,
                startedAt,
                error: error.message,
            });
            for (const item of items) {
                await failureQueue.recordFailure({
                    sourceText: item.text,
                    targetLang,
                    sourceLang,
                    engine: translatorEngine,
                    hostname: getHostname(sender),
                    surface: 'page-batch',
                    error: error.message,
                });
            }
            await sendToTabIgnoringMissingReceiver({
                browserApi,
                tabId: originTabId,
                message: {
                    type: MESSAGE_TYPES.TRANSLATE_TEXT_BATCH_RESULT,
                    payload: {
                        batchId,
                        items: items.map(item => ({
                            elementId: item.elementId,
                            success: false,
                            translatedText: '',
                            wasTranslated: false,
                            error: error.message,
                        })),
                    },
                },
                logError,
                label: 'TRANSLATE_TEXT_BATCH (sending error)',
            });
        }
    };
}
