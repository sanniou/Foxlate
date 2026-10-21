import { recordTranslationOutcome } from './translation-handler-support.js';

/**
 * 输入框翻译（连续空格触发）。
 *
 * 语向与引擎有额外的解析层级：输入框有自己的一层设置，其中任一项留作默认时才
 * 回落到域名级设置。这个回落只发生在输入框这条路上，所以它留在这里而不是下沉。
 */
export function createTranslateInputTextHandler({
    translatorManager,
    settingsManager,
    historyStore,
    failureQueue,
    logError,
}) {
    return async function translateInputText(request, sender) {
        const { text, targetLang } = request.payload;
        const tabId = sender.tab?.id;
        const tabUrl = sender.tab?.url;
        if (!tabId || !tabUrl) {
            logError('translateInputText', new Error('Request must come from a tab with a URL.'));
            return { success: false, error: 'Invalid sender context.' };
        }

        try {
            const hostname = new URL(tabUrl).hostname;
            const effectiveRule = await settingsManager.getEffectiveSettings(hostname);
            const inputSettings = effectiveRule.inputTranslationSettings || {};
            const finalTargetLang = targetLang
                || (inputSettings.targetLanguage !== 'auto' ? inputSettings.targetLanguage : effectiveRule.targetLanguage);
            const finalEngine = inputSettings.translatorEngine !== 'default'
                ? inputSettings.translatorEngine
                : effectiveRule.translatorEngine;

            const result = await translatorManager.translateText(text, finalTargetLang, 'auto', finalEngine, tabId);
            await recordTranslationOutcome({
                historyStore,
                failureQueue,
                sourceText: text,
                result,
                targetLang: finalTargetLang,
                sourceLang: 'auto',
                engine: finalEngine,
                hostname,
                surface: 'input',
            });
            return { success: !result.error, translatedText: result.text, error: result.error || null };
        } catch (error) {
            logError('translateInputText (execution)', error);
            return { success: false, error: error.message };
        }
    };
}
