import { recordEngineHealth } from './translation-handler-support.js';

/**
 * 引擎连通性 / 试译测试（来自设置页）。
 *
 * 与页面翻译的刻意差异：失败**不进失败队列**（这是用户主动发起的探测，不是真实
 * 翻译失败），但成功仍记一次历史，方便用户回看测试结果。
 */
export function createTestTranslateTextHandler({
    translatorManager,
    historyStore,
    healthStore,
}) {
    return async function testTranslateText(request) {
        const { text, targetLang, sourceLang, translatorEngine } = request.payload;
        const startedAt = Date.now();
        const result = await translatorManager.translateText(text, targetLang, sourceLang, translatorEngine);

        await recordEngineHealth({
            healthStore,
            engine: translatorEngine,
            startedAt,
            error: result.error || null,
        });

        if (!result.error && result.translated) {
            await historyStore.recordSuccess({
                sourceText: text,
                translatedText: result.text,
                targetLang,
                sourceLang,
                engine: translatorEngine,
                surface: 'test',
            });
        }

        return {
            success: !result.error,
            translatedText: { text: result.text, translated: result.translated },
            error: result.error || null,
            log: result.log || [],
        };
    };
}

/**
 * AI 引擎的连接测试：直接拿设置页当前填写的配置试一次，不落库、不进历史。
 * 这是唯一一个需要临时构造翻译器的入口，所以它单独一个文件。
 */
export function createTestConnectionHandler({ healthStore, logError }) {
    return async function testConnection(request) {
        const { engine, settings, text } = request.payload;
        if (engine !== 'ai') {
            return { success: false, error: `Connection test is only supported for AI engines, but got: ${engine}` };
        }

        const { AITranslator } = await import('../../translators/ai-translator.js');
        const translator = new AITranslator();
        const startedAt = Date.now();
        try {
            const result = await translator.translate(text, 'EN', 'auto', settings);
            await recordEngineHealth({
                healthStore,
                engine: settings?.name || settings?.id || engine,
                startedAt,
            });
            return { success: true, translatedText: { text: result.text, translated: true } };
        } catch (error) {
            logError('TEST_CONNECTION handler', error);
            await recordEngineHealth({
                healthStore,
                engine: settings?.name || settings?.id || engine,
                startedAt,
                error: error.message,
            });
            return { success: false, error: error.message };
        }
    };
}
