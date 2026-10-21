/**
 * 供其他扩展模块直接调用的批量翻译入口（无 sender、不写产品数据）。
 *
 * 与 `TRANSLATE_TEXT_BATCH` 的区别：那条走内容脚本、要按元素回送结果；
 * 这条是纯 API：给一批文本、拿一批译文。目标语言与引擎缺省时按域名规则解析。
 */
export function createTranslateBatchHandler({ settingsManager, translatorManager }) {
    return async function translateBatch(request) {
        const { texts, targetLanguage, translatorEngine, hostname } = request.payload;
        if (!Array.isArray(texts)) {
            throw new Error("Invalid payload: 'texts' must be an array.");
        }

        let finalTargetLang = targetLanguage;
        let finalEngine = translatorEngine;
        if (!finalTargetLang || !finalEngine) {
            const settings = await settingsManager.getEffectiveSettings(hostname);
            finalTargetLang = finalTargetLang || settings.targetLanguage;
            finalEngine = finalEngine || settings.translatorEngine;
        }

        const results = await translatorManager.translateBatch(texts, finalTargetLang, 'auto', finalEngine);
        return { success: true, translatedTexts: results.map(result => result.text) };
    };
}
