import { SettingsManager } from '../common/settings-manager.js';
import * as Constants from '../common/constants.js';

export class AiTaskRunner {
    constructor({ settingsManager = SettingsManager, aiTranslator }) {
        this.settingsManager = settingsManager;
        this.aiTranslator = aiTranslator;
    }

    async summarize(text, aiModel, targetLang, tabId) {
        const result = await this.#executeAiTask(text, aiModel, targetLang, Constants.AI_PROMPTS.summarize, tabId);
        return { ...result, summary: result.text };
    }

    async converse(history, aiModel, targetLang, tabId) {
        const result = await this.#executeAiTask(history, aiModel, targetLang, Constants.AI_PROMPTS.converse, tabId);
        return { ...result, reply: result.text };
    }

    async inferSuggestions(history, aiModel, targetLang, tabId) {
        const promptHistory = [
            ...history,
            { role: 'user', content: Constants.AI_PROMPTS.suggestUserMessage },
        ];
        const result = await this.#executeAiTask(promptHistory, aiModel, targetLang, Constants.AI_PROMPTS.suggest, tabId);

        if (!result.success) {
            return result;
        }

        let jsonText = result.text.trim();
        const match = jsonText.match(/^```json\s*([\s\S]*?)```$/);
        if (match) {
            jsonText = match[1].trim();
        }

        try {
            return { success: true, suggestions: JSON.parse(jsonText) };
        } catch (parseError) {
            return {
                success: false,
                error: `Failed to parse AI suggestions: ${parseError.message}. Raw text: "${result.text}"`,
            };
        }
    }

    async #executeAiTask(input, aiModel, targetLang, promptTemplate, tabId) {
        if (!input || !aiModel) {
            return { success: false, error: 'Input or AI model not provided for AI task.' };
        }

        try {
            const settings = await this.settingsManager.getValidatedSettings();
            const engineId = aiModel.startsWith('ai:') ? aiModel.substring(3) : aiModel;
            const aiConfig = settings.aiEngines.find(engine => engine.id === engineId);

            if (!aiConfig) {
                throw new Error(`AI engine configuration not found for ID: ${engineId}`);
            }

            const taskConfig = await this.#withTaskContext({ ...aiConfig, customPrompt: promptTemplate }, tabId);
            const result = await this.aiTranslator.translate(input, targetLang, 'auto', taskConfig);

            if (result.error) {
                throw new Error(result.error);
            }

            return { success: true, text: result.text };
        } catch (error) {
            console.error('[TranslatorManager] Error in AI task:', error);
            return { success: false, error: error.message };
        }
    }

    async #withTaskContext(config, tabId) {
        if (!tabId) {
            return config;
        }

        try {
            const { extractTabContext } = await import('../common/context-extractor.js');
            const context = await extractTabContext(tabId);
            return { ...config, context };
        } catch (error) {
            console.warn('[TranslatorManager] Failed to extract context for AI task:', error);
            return config;
        }
    }
}
