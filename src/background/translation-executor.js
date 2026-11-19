import { applyGlossaryToText } from '../common/translation-glossary.js';
import { postProcess } from './translation-pipeline.js';

/**
 * 哪些批量失败值得「拆小重试」。
 *
 * 只限响应形状类问题（模型漏条、包话、返回非数组）。鉴权、配额、网络层面的
 * 失败拆小只会把一次报错变成十几次报错，不能算。
 */
function isSplittableBatchError(error) {
    const message = String(error?.message || '');
    return /length mismatch|must be a string|must be a JSON array|Invalid response structure|Unexpected token|lost placeholder tags|JSON/i.test(message);
}

/**
 * 翻译执行器：把「已经准备好的翻译」真正送进引擎，并把结果写回缓存。
 *
 * 两条执行路径：
 *  * `executeTranslation` —— 单条（含重试、词汇表后处理、写缓存）
 *  * `executeAiBatchGroup` —— 一组走 AI 批量接口的条目
 *
 * 与 `TranslationPipeline` 的分工：pipeline 决定「翻什么、键是什么」，
 * executor 决定「怎么翻、失败怎么办」。缓存与重试失败语义都在这一层。
 */
export class TranslationExecutor {
    #browserApi;
    #cacheStore;
    #retryController;
    #engineResolver;

    constructor({ browserApi, cacheStore, retryController, engineResolver }) {
        this.#browserApi = browserApi;
        this.#cacheStore = cacheStore;
        this.#retryController = retryController;
        this.#engineResolver = engineResolver;
    }

    /**
     * 执行一条已经准备好的翻译。
     *
     * 调用方保证「缓存未命中」，因此这里直接记录缓存未命中。
     */
    async executeTranslation(prepared, targetLang, sourceLang = 'auto', signal, tabId) {
        const { cacheKey, glossary, processedText, resolution, textForTranslation } = prepared;
        const { translator, engine: resolvedEngine, config } = resolution;
        const getMessage = (key, args) => this.#browserApi.i18n.getMessage(key, args);
        const log = [];
        log.push(getMessage('logEntryStart', [processedText, sourceLang, targetLang]));

        if (sourceLang !== 'auto' && sourceLang === targetLang) {
            log.push(getMessage('logEntryPrecheckMatch', [
                getMessage('precheckRuleSameLanguage') || 'source language equals target language',
                'blacklist',
            ]) || `[Pre-check] Rule matched: ${getMessage('precheckRuleSameLanguage')}`);
            log.push(getMessage('logEntryPrecheckNoTranslation'));
            return { text: processedText, translated: false, log };
        }

        if (signal?.aborted) {
            throw new DOMException('Translation was interrupted by the user.', 'AbortError');
        }

        try {
            log.push(getMessage('logEntryCacheMiss'));

            if (!translator) {
                const errorMessage = getMessage('errorNoTranslator')
                    || 'No translation engine available. Enable one in settings.';
                log.push(getMessage('logEntryNoTranslator'));
                log.push(errorMessage);
                return { text: '', translated: false, log, error: errorMessage };
            }
            log.push(getMessage('logEntryEngineUsed', [translator.name, resolvedEngine]));

            // 步骤 2: 准备配置，包含上下文信息
            let finalConfig = config;
            if (config && tabId && translator.name === 'AI') {
                // 为 AI 翻译器添加上下文信息
                try {
                    finalConfig = await this.#engineResolver.withTabContext(config, tabId);
                } catch (error) {
                    console.warn('[TranslatorExecutor] Failed to extract context:', error);
                }
            }

            // 步骤 3: 使用解析出的翻译器执行翻译
            const { text: translatedResult, log: translatorLog } = await this.#retryController.execute({
                engine: resolvedEngine,
                tabId,
                signal,
                log,
                operation: () => translator.translate(textForTranslation, targetLang, sourceLang, finalConfig, signal),
            });
            log.push(...translatorLog);
            log.push(getMessage('logEntryTranslationSuccess'));

            const finalResult = applyGlossaryToText(postProcess(translatedResult), glossary);
            if (finalResult) {
                this.#cacheStore.set(cacheKey, finalResult);
            }
            this.#cacheStore.scheduleSave();
            return { text: finalResult, translated: true, log };
        } catch (error) {
            if (error.name === 'AbortError') throw error;

            const errorMessage = `Translation failed: ${error.message}`;
            log.push(getMessage('logEntryTranslationError', errorMessage));
            console.error('[TranslatorExecutor] Overall error caught:', error);
            return { text: '', translated: false, log, error: errorMessage };
        }
    }

    /**
     * 执行一组 AI 批量翻译。`items` 是 `{ index, prepared }` 的数组，
     * 返回的结果保留各自的 `index`。
     */
    async executeAiBatchGroup(items, targetLang, sourceLang, engine, config, signal, tabId) {
        const getMessage = (key, args) => this.#browserApi.i18n.getMessage(key, args);
        const log = [];
        const translator = this.#engineResolver.getTranslator(engine);
        if (!translator || translator.name !== 'AI' || typeof translator.translateBatch !== 'function') {
            throw new Error(`Engine ${engine} does not support AI batch translation.`);
        }

        if (signal?.aborted) {
            throw new DOMException('Translation was interrupted by the user.', 'AbortError');
        }

        const finalConfig = await this.#engineResolver.withTabContext(config, tabId);
        log.push(`AI batch translation started. Count: ${items.length}`);

        try {
            const textsForTranslation = items.map(item => item.prepared.textForTranslation);
            const { texts: translatedTexts, log: translatorLog = [] } = await this.#retryController.execute({
                engine,
                tabId,
                signal,
                log,
                operation: () => translator.translateBatch(
                    textsForTranslation,
                    targetLang,
                    sourceLang,
                    finalConfig,
                    signal,
                ),
            });
            log.push(...translatorLog);

            const results = translatedTexts.map((translatedText, index) => {
                const { index: originalIndex, prepared } = items[index];
                const finalText = applyGlossaryToText(postProcess(translatedText), prepared.glossary);
                if (finalText) {
                    this.#cacheStore.set(prepared.cacheKey, finalText);
                }
                return {
                    index: originalIndex,
                    text: finalText,
                    translated: true,
                    log,
                };
            });

            this.#cacheStore.scheduleSave();
            return results;
        } catch (error) {
            if (error.name === 'AbortError') throw error;

            // 整批失败时先试着把问题隔离开：模型漏一条、多包一层话、把数组包成对象，
            // 都会让同一次付费请求里的十几条一起变红。拆成两半各自重试，最终每个标签
            // 只为自己的失败负责，而不是连坐整批。
            if (items.length > 1 && isSplittableBatchError(error)) {
                const middle = Math.ceil(items.length / 2);
                const halves = await Promise.all([
                    this.executeAiBatchGroup(items.slice(0, middle), targetLang, sourceLang, engine, config, signal, tabId),
                    this.executeAiBatchGroup(items.slice(middle), targetLang, sourceLang, engine, config, signal, tabId),
                ]);
                return halves.flat();
            }

            const errorMessage = `AI batch translation failed: ${error.message}`;
            console.warn('[TranslatorExecutor] AI batch failed:', error);
            return items.map(item => ({
                index: item.index,
                text: '',
                translated: false,
                log: [...log, getMessage('logEntryTranslationError', errorMessage)],
                error: errorMessage,
            }));
        }
    }
}
