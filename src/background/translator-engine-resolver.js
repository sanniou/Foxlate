import { SettingsManager } from '../common/settings-manager.js';

export class TranslatorEngineResolver {
    constructor({ settingsManager = SettingsManager, translators }) {
        this.settingsManager = settingsManager;
        this.translators = translators;
    }

    getTranslator(resolvedEngine) {
        if (!resolvedEngine) {
            console.error('getTranslator requires a resolved engine ID.');
            return undefined;
        }

        const translatorKey = resolvedEngine.startsWith('ai:') ? 'ai' : resolvedEngine;
        return this.translators[translatorKey];
    }

    async resolveEngine(engine) {
        if (engine) {
            return engine;
        }
        const settings = await this.settingsManager.getValidatedSettings();
        return settings.translatorEngine;
    }

    async resolveTranslatorForText(processedText, initialEngine, log) {
        const resolvedInitialEngine = await this.resolveEngine(initialEngine);
        const translator = this.getTranslator(resolvedInitialEngine);

        if (!translator || translator.name !== 'AI') {
            if (translator?.name === 'DeepLx') {
                const settings = await this.settingsManager.getValidatedSettings();
                return {
                    translator,
                    engine: resolvedInitialEngine,
                    config: { apiUrl: settings.deeplxApiUrl },
                };
            }
            return { translator, engine: resolvedInitialEngine, config: null };
        }

        const settings = await this.settingsManager.getValidatedSettings();
        const engineId = resolvedInitialEngine.split(':')[1];
        const aiConfig = settings.aiEngines.find(engine => engine.id === engineId);

        if (!aiConfig) {
            throw new Error(`Selected AI engine configuration not found for ID: ${engineId}`);
        }

        const wordCount = processedText.split(/\s+/).length;
        if (aiConfig.wordCountThreshold && wordCount <= aiConfig.wordCountThreshold && aiConfig.fallbackEngine) {
            const fallbackResolution = await this.#resolveFallbackEngine({
                aiConfig,
                settings,
                wordCount,
                log,
            });
            if (fallbackResolution) {
                return fallbackResolution;
            }
        }

        return { translator, engine: resolvedInitialEngine, config: aiConfig };
    }

    async withTabContext(config, tabId) {
        if (!config || !tabId) {
            return config;
        }

        try {
            const { extractTabContext } = await import('../common/context-extractor.js');
            const context = await extractTabContext(tabId);
            return { ...config, context };
        } catch (error) {
            console.warn('[TranslatorManager] Failed to extract context:', error);
            return config;
        }
    }

    async #resolveFallbackEngine({ aiConfig, settings, wordCount, log }) {
        let fallbackEngineName = aiConfig.fallbackEngine;
        if (fallbackEngineName === 'default') {
            fallbackEngineName = settings.translatorEngine;
            log.push(`短文本引擎为“默认”，解析为全局引擎: ${fallbackEngineName}`);
        }

        if (fallbackEngineName === `ai:${aiConfig.id}`) {
            log.push(`[警告] 检测到循环依赖：备用引擎 (${fallbackEngineName}) 与当前引擎相同。为防止死循环，将使用原始AI引擎。`);
            return null;
        }

        const resolvedFallbackEngine = await this.resolveEngine(fallbackEngineName);
        const fallbackTranslator = this.getTranslator(resolvedFallbackEngine);
        if (!fallbackTranslator) {
            log.push(`[警告] 找不到备用翻译器 '${fallbackEngineName}'。将使用原始AI引擎。`);
            return null;
        }

        log.push(`短文本切换：单词数 ${wordCount} <= ${aiConfig.wordCountThreshold}，切换到 ${resolvedFallbackEngine}`);
        let fallbackConfig = null;
        if (resolvedFallbackEngine.startsWith('ai:')) {
            const fallbackEngineId = resolvedFallbackEngine.split(':')[1];
            fallbackConfig = settings.aiEngines.find(engine => engine.id === fallbackEngineId);
        }

        return {
            translator: fallbackTranslator,
            engine: resolvedFallbackEngine,
            config: fallbackConfig,
        };
    }
}
