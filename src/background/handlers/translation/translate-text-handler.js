import { MESSAGE_TYPES } from '../../../common/message-types.js';
import { getHostname } from '../handler-context.js';
import {
    recordEngineHealth,
    recordTranslationOutcome,
    sendToTabIgnoringMissingReceiver,
} from './translation-handler-support.js';

/** 单个元素的页面翻译请求（只能来自内容脚本——必须有 elementId 才能把结果送回原元素）。 */
export function createTranslateTextHandler({
    browserApi,
    translatorManager,
    historyStore,
    failureQueue,
    healthStore,
    logError,
}) {
    return async function translateText(request, sender) {
        const { text, targetLang, sourceLang, elementId, translatorEngine, tabId } = request.payload;
        const originTabId = sender.tab?.id || tabId;

        if (!originTabId || !elementId) {
            logError('TRANSLATE_TEXT', new Error('Invalid TRANSLATE_TEXT call: Missing originTabId or elementId. This handler is for content scripts only.'));
            return;
        }

        const startedAt = Date.now();
        try {
            const result = await translatorManager.translateText(text, targetLang, sourceLang, translatorEngine, originTabId);
            await recordEngineHealth({
                healthStore,
                engine: translatorEngine,
                startedAt,
                error: result.error || null,
            });
            await recordTranslationOutcome({
                historyStore,
                failureQueue,
                sourceText: text,
                result,
                targetLang,
                sourceLang,
                engine: translatorEngine,
                hostname: getHostname(sender),
                surface: 'page',
            });
            await sendToTabIgnoringMissingReceiver({
                browserApi,
                tabId: originTabId,
                message: {
                    type: MESSAGE_TYPES.TRANSLATE_TEXT_RESULT,
                    payload: {
                        elementId,
                        success: !result.error,
                        translatedText: result.text,
                        wasTranslated: result.translated,
                        error: result.error || null,
                    },
                },
                logError,
                label: 'TRANSLATE_TEXT (sending error)',
            });
        } catch (error) {
            logError('TRANSLATE_TEXT (execution)', error);
            await recordEngineHealth({
                healthStore,
                engine: translatorEngine,
                startedAt,
                error: error.message,
            });
            await failureQueue.recordFailure({
                sourceText: text,
                targetLang,
                sourceLang,
                engine: translatorEngine,
                hostname: getHostname(sender),
                surface: 'page',
                error: error.message,
            });
            await sendToTabIgnoringMissingReceiver({
                browserApi,
                tabId: originTabId,
                message: {
                    type: MESSAGE_TYPES.TRANSLATE_TEXT_RESULT,
                    payload: { elementId, success: false, translatedText: '', wasTranslated: false, error: error.message },
                },
                logError,
                label: 'TRANSLATE_TEXT (sending error)',
            });
        }
    };
}
