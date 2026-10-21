import { MESSAGE_TYPES } from '../../common/message-types.js';

/**
 * AI 任务类消息处理器（摘要 / 追问 / 追问建议）。
 * 这三个都是「把既有对话上下文再送进模型」，与翻译路径共享 TranslatorManager
 * 但走的是独立的 AI 任务通道。
 */
export function createAiTaskHandlers({ translatorManager, logError }) {
    return {
        async [MESSAGE_TYPES.SUMMARIZE_CONTENT](request, sender) {
            const { text, aiModel, targetLang } = request.payload;
            return translatorManager.summarize(text, aiModel, targetLang, sender.tab?.id);
        },

        async [MESSAGE_TYPES.CONVERSE_WITH_AI](request, sender) {
            const { history, aiModel, targetLang } = request.payload;
            return translatorManager.converse(history, aiModel, targetLang, sender.tab?.id);
        },

        async [MESSAGE_TYPES.INFER_SUGGESTIONS](request, sender) {
            const { history, aiModel, targetLang } = request.payload;
            const result = await translatorManager.inferSuggestions(history, aiModel, targetLang, sender.tab?.id);
            if (!result.success) return result;

            try {
                if (!Array.isArray(result.suggestions)) {
                    throw new Error('AI did not return a JSON array of suggestions.');
                }
                return { success: true, suggestions: result.suggestions };
            } catch (parseError) {
                logError('INFER_SUGGESTIONS (JSON parse)', parseError);
                return { success: true, suggestions: [result.text] };
            }
        },
    };
}
