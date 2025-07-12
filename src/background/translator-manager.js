import { getValidatedSettings } from '../common/settings-manager.js';
import { DeepLxTranslator } from './translators/deeplx-translator.js';
import { GoogleTranslator } from './translators/google-translator.js';
import { AITranslator } from './translators/ai-translator.js';

export class TranslatorManager {
  // --- Private Static State ---
  static #translationCache = new Map();
  static #inFlightRequests = new Map();
  static #translators = {
    deeplx: new DeepLxTranslator(),
    google: new GoogleTranslator(),
    ai: new AITranslator(),
  };
  static #taskQueue = [];
  static #activeTasks = new Map();
  static #taskIdCounter = 0;
  static #MAX_CONCURRENT_REQUESTS = 5;

  // --- Static Initialization Block ---
  // This block runs once when the class is loaded, setting up initial values.
  static {
    (async () => {
        try {
            await this.updateConcurrencyLimit();
        } catch (e) {
            console.error("[TranslatorManager] Failed to set initial concurrency limit.", e);
        }
    })();
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

  static #processQueue() {
      if (this.#taskQueue.length === 0 || this.#activeTasks.size >= this.#MAX_CONCURRENT_REQUESTS) {
          return;
      }

      const task = this.#taskQueue.shift();
      const taskId = this.#taskIdCounter++;
      this.#activeTasks.set(taskId, task.controller);

      (async () => {
          try {
              const result = await this.#executeTranslation(task.text, task.targetLang, task.sourceLang, task.engine, task.controller.signal);
              task.resolve(result);
          } catch (error) {
              task.reject(error);
          } finally {
              this.#activeTasks.delete(taskId);
              this.#processQueue();
          }
      })();
  }

  static async #executeTranslation(text, targetLang, sourceLang = 'auto', engine, signal) {
      const log = [];
      log.push(browser.i18n.getMessage('logEntryStart', [text, sourceLang, targetLang]));
          if (sourceLang !== 'auto' && sourceLang === targetLang) {
              log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [browser.i18n.getMessage('precheckRuleSameLanguage'), 'blacklist']));
              log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
              return { text: text, translated: false, log: log };
          }
          const processedText = this.#preProcess(text);
          if (!processedText) {
              log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
              return { text: "", translated: false, log: log };
          }

      if (signal?.aborted) {
          throw new DOMException('Translation was interrupted by the user.', 'AbortError');
      }

      try {
          const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;
          if (this.#translationCache.has(cacheKey)) {
              const cachedResult = this.#translationCache.get(cacheKey);
              log.push(browser.i18n.getMessage('logEntryCacheHit'));
              return { text: this.#postProcess(cachedResult), translated: true, log: log };
          } else {
              log.push(browser.i18n.getMessage('logEntryCacheMiss'));
          }

          const { translator, engine: resolvedEngine } = await this.getTranslator(engine);
          engine = resolvedEngine;
          if (!translator) {
              const errorMessage = "未选择或初始化有效的翻译器。";
              log.push(browser.i18n.getMessage('logEntryNoTranslator'));
              log.push(errorMessage);
              return { text: "", translated: false, log: log, error: errorMessage };
          }
          log.push(browser.i18n.getMessage('logEntryEngineUsed', translator.name));

          let translatedResult;
          let translatorLog;

          if (translator.name === 'AI') {
              if (!engine || !engine.startsWith('ai:')) {
                  throw new Error(`Invalid AI engine identifier provided: ${engine}`);
              }
              const settings = await getValidatedSettings();
              const selectedEngineId = engine.split(':')[1];
              const aiConfig = settings.aiEngines.find(e => e.id === selectedEngineId);

              if (!aiConfig) {
                  throw new Error(`Selected AI engine configuration not found for ID: ${selectedEngineId}`);
              }

              const wordCount = processedText.split(/\s+/).length;
              if (aiConfig.wordCountThreshold && wordCount <= aiConfig.wordCountThreshold && aiConfig.fallbackEngine) {
                  let fallbackEngineName = aiConfig.fallbackEngine;

                  if (fallbackEngineName === 'default') {
                      fallbackEngineName = settings.translatorEngine;
                      log.push(`短文本引擎为“默认”，解析为全局引擎: ${fallbackEngineName}`);
                  }

                  const isCircular = fallbackEngineName === `ai:${aiConfig.id}`;

                  if (isCircular) {
                      log.push(`[警告] 检测到循环依赖：备用引擎 (${fallbackEngineName}) 与当前引擎相同。为防止死循环，将使用原始AI引擎。`);
                      ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, aiConfig, signal));
                  } else {
                      const { translator: fallbackTranslator, engine: resolvedFallbackEngine } = await this.getTranslator(fallbackEngineName);
                      if (fallbackTranslator) {
                          log.push(`短文本切换：单词数 ${wordCount} <= ${aiConfig.wordCountThreshold}，切换到 ${resolvedFallbackEngine}`);
                          let fallbackAiConfig = null;
                          if (resolvedFallbackEngine.startsWith('ai:')) {
                              const fallbackEngineId = resolvedFallbackEngine.split(':')[1];
                              fallbackAiConfig = settings.aiEngines.find(e => e.id === fallbackEngineId);
                          }
                          ({ text: translatedResult, log: translatorLog } = await fallbackTranslator.translate(processedText, targetLang, sourceLang, fallbackAiConfig, signal));
                      } else {
                          log.push(`[警告] 找不到备用翻译器 '${fallbackEngineName}'。将使用原始AI引擎。`);
                          ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, aiConfig, signal));
                      }
                  }
              } else {
                  ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, aiConfig, signal));
              }
          } else {
              ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, null, signal));
          }
          log.push(...translatorLog);
          log.push(browser.i18n.getMessage('logEntryTranslationSuccess'));

          if (translatedResult) {
              this.#translationCache.set(cacheKey, translatedResult);
          }
          const finalResult = this.#postProcess(translatedResult);
          return { text: finalResult, translated: true, log: log };
      } catch (error) {
          if (error.name === 'AbortError') throw error;

          const errorMessage = `Translation failed: ${error.message}`;
          log.push(browser.i18n.getMessage('logEntryTranslationError', errorMessage));
          console.error(`[TranslatorManager] Overall error caught:`, error);
          return { text: "", translated: false, log: log, error: errorMessage };
      }
  }

  // --- Public Static API ---

  static async getTranslator(engine) { // engine can be undefined
    let resolvedEngine = engine;
    if (!resolvedEngine) {
        const settings = await getValidatedSettings();
        resolvedEngine = settings.translatorEngine;
    }
    let translatorKey = resolvedEngine;
    if (translatorKey.startsWith('ai:')) {
      translatorKey = 'ai';
    }
    // 返回解析后的引擎ID和翻译器实例
    return { translator: this.#translators[translatorKey], engine: resolvedEngine };
  }

  /**
   * 将翻译任务添加到队列，并返回一个解析结果的 Promise。
   * 此方法会处理缓存和在途请求复用。
   * @param {string} text - 要翻译的文本。
   * @param {string} targetLang - 目标语言。
   * @param {string} [sourceLang='auto'] - 源语言。
   * @returns {Promise<object>} 一个解析为翻译结果的 Promise。
   */
  static translateText(text, targetLang, sourceLang = 'auto', engine) {
    const processedText = this.#preProcess(text);
    if (!processedText) {
      return Promise.resolve({ text: "", translated: false, log: [browser.i18n.getMessage('logEntryPrecheckNoTranslation')] });
    }
    const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;

    // 1. 检查永久缓存
    if (this.#translationCache.has(cacheKey)) {
      const cachedResult = this.#translationCache.get(cacheKey);
      const log = [
        browser.i18n.getMessage('logEntryStart', [text, sourceLang, targetLang]),
        browser.i18n.getMessage('logEntryCacheHit')
      ];
      return Promise.resolve({ text: this.#postProcess(cachedResult), translated: true, log: log });
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
        text,
        targetLang,
        sourceLang,
        engine,
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
      console.log("[TranslatorManager] All pending and active translation tasks have been interrupted.");
  }

  static async updateConcurrencyLimit() {
      const settings = await getValidatedSettings();
      const max = settings.parallelRequests;
      if (max && typeof max === 'number' && max > 0) {
          this.#MAX_CONCURRENT_REQUESTS = max;
      }
      console.log(`[TranslatorManager] Concurrency limit updated to ${this.#MAX_CONCURRENT_REQUESTS}`);
  }
}