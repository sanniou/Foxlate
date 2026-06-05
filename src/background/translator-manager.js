import browser from '../lib/browser-polyfill.js';
import { SettingsManager } from '../common/settings-manager.js';
import { DeepLxTranslator } from './translators/deeplx-translator.js';
import { GoogleTranslator } from './translators/google-translator.js';
import { AITranslator } from './translators/ai-translator.js';
import { createTranslationCacheKey, TranslationCacheStore } from './translation-cache-store.js';
import { TranslationRetryController } from './translation-retry-controller.js';
import { TranslatorEngineResolver } from './translator-engine-resolver.js';
import { AiTaskRunner } from './ai-task-runner.js';
import { applyGlossaryToText } from '../common/translation-glossary.js';

export class TranslatorManager {
  // --- Private Static State ---
  static #inFlightRequests = new Map();
  static #translators = {
    deeplx: new DeepLxTranslator(),
    google: new GoogleTranslator(),
    ai: new AITranslator(),
  };
  static #cacheStore = new TranslationCacheStore({ browserApi: browser });
  static #retryController = new TranslationRetryController({ browserApi: browser });
  static #engineResolver = new TranslatorEngineResolver({
      settingsManager: SettingsManager,
      translators: TranslatorManager.#translators,
  });
  static #aiTaskRunner = new AiTaskRunner({
      settingsManager: SettingsManager,
      aiTranslator: TranslatorManager.#translators.ai,
  });
  static #taskQueue = [];
  static #activeTasks = new Map();
  static #taskIdCounter = 0;
  static #MAX_CONCURRENT_REQUESTS = 5;

  // --- Static Initialization Block ---
  // This block runs once when the class is loaded, setting up initial values.
  static {
    (async () => {
        try {
            await this.#cacheStore.load();
            await this.updateConcurrencyLimit();
            await this.updateCacheSize();
        } catch (e) {
            console.error("[TranslatorManager] Failed to set initial concurrency limit.", e);
        }
    })();

        // 监听存储变化，以便在用户更改设置时动态更新配置。
    browser.storage.onChanged.addListener((changes, area) => {
        // 确保是 sync 存储区域且 settings 对象发生了变化
        if (area === 'sync' && changes.settings) {
            // 无需等待这些promise，因为它们是后台更新，不阻塞其他操作。
            this.updateConcurrencyLimit();
            this.updateCacheSize();
        }
    });
  }

  // --- Private Static Methods ---

  static #preProcess(text) {
      if (typeof text !== 'string') return '';
      return text.trim();
  }

  static #postProcess(text) {
      if (typeof text !== 'string') return '';
      return text;
  }

  static async #getGlossarySettings() {
      const settings = await SettingsManager.getValidatedSettings();
      return settings.glossary;
  }

  static #processQueue() {
      if (this.#taskQueue.length === 0 || this.#activeTasks.size >= this.#MAX_CONCURRENT_REQUESTS) {
          return;
      }

      const task = this.#taskQueue.shift();
      const taskId = this.#taskIdCounter++;
      this.#activeTasks.set(taskId, task.controller);

      (async () => {
          try {
              const result = task.type === 'aiBatch'
                ? await this.#executeAiBatchGroup(task.items, task.targetLang, task.sourceLang, task.engine, task.config, task.controller.signal, task.tabId)
                : await this.#executeTranslation(task.text, task.targetLang, task.sourceLang, task.engine, task.controller.signal, task.tabId);
              task.resolve(result);
          } catch (error) {
              task.reject(error);
          } finally {
              this.#activeTasks.delete(taskId);
              this.#processQueue();
          }
      })();
  }

  static async #executeTranslation(processedText, targetLang, sourceLang = 'auto', engine, signal, tabId) {
      const log = [];
      log.push(browser.i18n.getMessage('logEntryStart', [processedText, sourceLang, targetLang]));
          if (sourceLang !== 'auto' && sourceLang === targetLang) {
              log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [browser.i18n.getMessage('precheckRuleSameLanguage'), 'blacklist']));
              log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
              return { text: processedText, translated: false, log: log };
          }

      if (signal?.aborted) {
          throw new DOMException('Translation was interrupted by the user.', 'AbortError');
      }

      try {
          // 此函数仅在缓存未命中时调用，因此我们直接记录缓存未命中。
          log.push(browser.i18n.getMessage('logEntryCacheMiss'));

          const cacheKey = createTranslationCacheKey(sourceLang, targetLang, processedText);
          const glossary = await this.#getGlossarySettings();
          const textForTranslation = applyGlossaryToText(processedText, glossary);

          // 步骤 1: 解析出最终要使用的翻译器和配置
          const { translator, engine: resolvedEngine, config } = await this.#engineResolver.resolveTranslatorForText(textForTranslation, engine, log);

          if (!translator) {
              const errorMessage = browser.i18n.getMessage('errorNoTranslator');
              log.push(browser.i18n.getMessage('logEntryNoTranslator'));
              log.push(errorMessage);
              return { text: "", translated: false, log: log, error: errorMessage };
          }
          log.push(browser.i18n.getMessage('logEntryEngineUsed', [translator.name, resolvedEngine]));

          // 步骤 2: 准备配置，包含上下文信息
          let finalConfig = config;
          if (config && tabId && translator.name === 'AI') {
            // 为AI翻译器添加上下文信息
            try {
              finalConfig = await this.#engineResolver.withTabContext(config, tabId);
            } catch (error) {
              console.warn('[TranslatorManager] Failed to extract context:', error);
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
          log.push(browser.i18n.getMessage('logEntryTranslationSuccess'));

          if (translatedResult) {
              this.#cacheStore.set(cacheKey, translatedResult);
          }
          this.#cacheStore.scheduleSave();
          const finalResult = applyGlossaryToText(this.#postProcess(translatedResult), glossary);
          return { text: finalResult, translated: true, log: log };
      } catch (error) {
          if (error.name === 'AbortError') throw error;

          const errorMessage = `Translation failed: ${error.message}`;
          log.push(browser.i18n.getMessage('logEntryTranslationError', errorMessage));
          console.error(`[TranslatorManager] Overall error caught:`, error);
          return { text: "", translated: false, log: log, error: errorMessage };
      }
  }

  static async #executeAiBatchGroup(items, targetLang, sourceLang, engine, config, signal, tabId) {
      const log = [];
      const translator = this.getTranslator(engine);
      if (!translator || translator.name !== 'AI' || typeof translator.translateBatch !== 'function') {
          throw new Error(`Engine ${engine} does not support AI batch translation.`);
      }

      if (signal?.aborted) {
          throw new DOMException('Translation was interrupted by the user.', 'AbortError');
      }

      const finalConfig = await this.#engineResolver.withTabContext(config, tabId);
      log.push(`AI batch translation started. Count: ${items.length}`);

      try {
          const glossary = await this.#getGlossarySettings();
          const textsForTranslation = items.map(item => applyGlossaryToText(item.processedText, glossary));
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
                  signal
              ),
          });
          log.push(...translatorLog);

          const results = translatedTexts.map((translatedText, index) => {
              const item = items[index];
              if (translatedText) {
                  this.#cacheStore.set(item.cacheKey, translatedText);
              }
              return {
                  index: item.index,
                  text: applyGlossaryToText(this.#postProcess(translatedText), glossary),
                  translated: true,
                  log,
              };
          });

          this.#cacheStore.scheduleSave();
          return results;
      } catch (error) {
          if (error.name === 'AbortError') throw error;

          const errorMessage = `AI batch translation failed: ${error.message}`;
          console.warn('[TranslatorManager] AI batch failed:', error);
          return items.map(item => ({
              index: item.index,
              text: "",
              translated: false,
              log: [...log, browser.i18n.getMessage('logEntryTranslationError', errorMessage)],
              error: errorMessage,
          }));
      }
  }

  // --- Public Static API ---

  /**
   * (已修改) 根据已解析的引擎ID，同步获取一个翻译器实例。
   * 此方法不再处理默认引擎的解析逻辑。
   * @param {string} resolvedEngine - 一个明确的引擎ID (例如, 'deeplx', 'ai:12345')。
   * @returns {object|undefined} 翻译器实例。
   */
  static getTranslator(resolvedEngine) {
    return this.#engineResolver.getTranslator(resolvedEngine);
  }

  /**
   * 将翻译任务添加到队列，并返回一个解析结果的 Promise。
   * 此方法会处理缓存和在途请求复用。
   * @param {string} text - 要翻译的文本。
   * @param {string} targetLang - 目标语言。
   * @param {string} [sourceLang='auto'] - 源语言。
   * @returns {Promise<object>} 一个解析为翻译结果的 Promise。
   */
  static translateText(text, targetLang, sourceLang = 'auto', engine, tabId) {
    const processedText = this.#preProcess(text);
    if (!processedText) {
      return Promise.resolve({ text: "", translated: false, log: [browser.i18n.getMessage('logEntryPrecheckNoTranslation')] });
    }
    const cacheKey = createTranslationCacheKey(sourceLang, targetLang, processedText);

    // 1. 检查永久缓存
    if (this.#cacheStore.has(cacheKey)) {
      const log = [
        browser.i18n.getMessage('logEntryStart', [text, sourceLang, targetLang]),
        browser.i18n.getMessage('logEntryCacheHit')
      ];
      const cachedResult = this.#cacheStore.touch(cacheKey);

      return Promise.resolve({ text: this.#postProcess(cachedResult), translated: true, log });
    }

    // 2. 检查是否有正在进行的相同请求
    if (this.#inFlightRequests.has(cacheKey)) {
      // 复用已在途的请求 Promise
      return this.#inFlightRequests.get(cacheKey);
    }

    // 3. 创建新的翻译任务 Promise
    const translationPromise = new Promise((resolve, reject) => {
      const controller = new AbortController();
      this.#taskQueue.push({
        text: processedText, // 传递已处理的文本
        targetLang,
        sourceLang,
        engine,
        tabId, // 传递标签页ID用于提取上下文
        resolve,
        reject,
        controller // 将控制器与任务关联
      });
      this.#processQueue();
    }).finally(() => {
      // 任务完成后（无论成功或失败），从在途请求映射中移除
      this.#inFlightRequests.delete(cacheKey);
    });

    // 将新的 Promise 存入在途请求映射中
    this.#inFlightRequests.set(cacheKey, translationPromise);

    return translationPromise;
  }

  static async translateBatch(texts, targetLang, sourceLang = 'auto', engine, tabId) {
      if (!Array.isArray(texts)) {
          throw new Error("Invalid payload: 'texts' must be an array.");
      }
      if (texts.length === 0) {
          return [];
      }

      const results = new Array(texts.length);
      const candidates = [];

      for (let index = 0; index < texts.length; index++) {
          const originalText = texts[index];
          const processedText = this.#preProcess(originalText);

          if (!processedText) {
              results[index] = { text: "", translated: false, log: [browser.i18n.getMessage('logEntryPrecheckNoTranslation')] };
              continue;
          }

          if (sourceLang !== 'auto' && sourceLang === targetLang) {
              results[index] = { text: processedText, translated: false, log: [browser.i18n.getMessage('logEntryPrecheckNoTranslation')] };
              continue;
          }

          const cacheKey = createTranslationCacheKey(sourceLang, targetLang, processedText);
          if (this.#cacheStore.has(cacheKey)) {
              const cachedResult = this.#cacheStore.touch(cacheKey);
              results[index] = {
                  text: this.#postProcess(cachedResult),
                  translated: true,
                  log: [
                      browser.i18n.getMessage('logEntryStart', [originalText, sourceLang, targetLang]),
                      browser.i18n.getMessage('logEntryCacheHit')
                  ]
              };
              continue;
          }

          const resolutionLog = [];
          const { translator, engine: resolvedEngine, config } = await this.#engineResolver.resolveTranslatorForText(processedText, engine, resolutionLog);
          if (translator?.name === 'AI' && resolvedEngine?.startsWith('ai:') && config) {
              candidates.push({ index, processedText, cacheKey, resolvedEngine, config });
          } else {
              results[index] = await this.translateText(processedText, targetLang, sourceLang, resolvedEngine, tabId);
          }
      }

      const aiGroups = new Map();
      for (const candidate of candidates) {
          if (!aiGroups.has(candidate.resolvedEngine)) {
              aiGroups.set(candidate.resolvedEngine, []);
          }
          aiGroups.get(candidate.resolvedEngine).push(candidate);
      }

      const batchPromises = [];
      for (const [resolvedEngine, items] of aiGroups.entries()) {
          const config = items[0].config;
          const batchPromise = new Promise((resolve, reject) => {
              const controller = new AbortController();
              this.#taskQueue.push({
                  type: 'aiBatch',
                  items,
                  targetLang,
                  sourceLang,
                  engine: resolvedEngine,
                  config,
                  tabId,
                  resolve,
                  reject,
                  controller,
              });
              this.#processQueue();
          });
          batchPromises.push(batchPromise);
      }

      const groupedResults = await Promise.all(batchPromises);
      for (const groupResults of groupedResults) {
          for (const result of groupResults) {
              const { index, ...translationResult } = result;
              results[index] = translationResult;
          }
      }

      return results;
  }

  /**
   * (新) 使用 AI 执行内容总结任务。
   * @param {string} text - 要总结的文本。
   * @param {string} aiModel - 用于总结的 AI 模型 ID。
   * @param {string} targetLang - 总结的目标语言。
   * @returns {Promise<{success: boolean, summary?: string, error?: string}>}
   */
  static async summarize(text, aiModel, targetLang, tabId) {
      return this.#aiTaskRunner.summarize(text, aiModel, targetLang, tabId);
  }

  /**
   * (新) 与 AI 进行对话。
   * @param {object[]} history - 对话历史记录。
   * @param {string} aiModel - 使用的 AI 模型 ID。
   * @param {string} targetLang - 回复的目标语言。
   * @returns {Promise<{success: boolean, reply?: string, error?: string}>}
   */
  static async converse(history, aiModel, targetLang, tabId) {
      return this.#aiTaskRunner.converse(history, aiModel, targetLang, tabId);
  }

  /**
   * (新) 使用 AI 推断后续对话建议。
   * @param {object[]} history - 对话历史记录。
   * @param {string} aiModel - 使用的 AI 模型 ID。
   * @param {string} targetLang - 建议的目标语言。
   * @returns {Promise<{success: boolean, suggestions?: string[], error?: string}>}
   */
  static async inferSuggestions(history, aiModel, targetLang, tabId) {
      return this.#aiTaskRunner.inferSuggestions(history, aiModel, targetLang, tabId);
  }

  /**
   * 中断所有待处理和正在进行的翻译任务。
   */
  static interruptAll() {
      // 1. 中止所有正在运行的任务
      for (const controller of this.#activeTasks.values()) {
          controller.abort();
      }
      // activeTasks 会在任务的 finally 块中被自动清理

      // 2. 拒绝队列中所有待处理的 Promise
      this.#taskQueue.forEach(task => {
          task.controller.abort(); // 标记为中止
          task.reject(new DOMException("Translation was interrupted by the user.", "AbortError"));
      });
      // 3. 清空队列
      this.#taskQueue.length = 0;
      // 注意：在途请求(inFlightRequests)中的 Promise 会因为 task.reject() 而被拒绝，
      // 进而触发其 .finally() 块，自动从 inFlightRequests 中清理。
  }

  static async updateConcurrencyLimit() {
      const settings = await SettingsManager.getValidatedSettings();
      const max = settings.parallelRequests;
      if (max && typeof max === 'number' && max > 0) {
          this.#MAX_CONCURRENT_REQUESTS = max;
      }
  }

  static async updateCacheSize() {
      const settings = await SettingsManager.getValidatedSettings();
      const size = settings.cacheSize; // 假设设置项名为 cacheSize
      this.#cacheStore.updateLimit(size);
  }

  /**
   * 获取当前缓存的信息。
   * @returns {Promise<{count: number, limit: number}>}
   */
  static async getCacheInfo() {
      return {
          count: this.#cacheStore.size,
          limit: this.#cacheStore.limit
      };
  }

  static async clearCache() {
      await this.#cacheStore.clear();
  }
}
