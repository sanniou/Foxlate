import browser from '../lib/browser-polyfill.js';
import { SettingsManager } from '../common/settings-manager.js';
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
  // --- 静态配置 ---
  static #MAX_CONCURRENT_REQUESTS = 5;
  static #maxCacheSize = 5000; // 默认缓存大小，可以被用户设置覆盖
  static #STORAGE_KEY = 'translationCache';

  // --- Static Initialization Block ---
  // This block runs once when the class is loaded, setting up initial values.
  static {
    (async () => {
        try {
            await this.#loadCacheFromStorage();
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
            console.log("[TranslatorManager] Settings changed, updating configuration.");
            // 无需等待这些promise，因为它们是后台更新，不阻塞其他操作。
            this.updateConcurrencyLimit();
            this.updateCacheSize();
        }
    });
  }

  // --- Private Static Methods ---

  static async #loadCacheFromStorage() {
    try {
        const result = await browser.storage.local.get(this.#STORAGE_KEY);
        if (result[this.#STORAGE_KEY]) {
            // 从普通对象重建 Map
            this.#translationCache = new Map(Object.entries(result[this.#STORAGE_KEY]));
            console.log(`[TranslatorManager] Loaded ${this.#translationCache.size} items from persistent cache.`);
        }
    } catch (e) {
        console.error("[TranslatorManager] Failed to load cache from storage.", e);
    }
  }

  static async #saveCacheToStorage() {
      try {
          // 将 Map 转换为可序列化的普通对象
          const plainObject = Object.fromEntries(this.#translationCache);
          await browser.storage.local.set({ [this.#STORAGE_KEY]: plainObject });
      } catch (e) {
          console.error("[TranslatorManager] Failed to save cache to storage.", e);
      }
  }

  static #setCache(key, value) {
      this.#translationCache.set(key, value);
      this.#enforceCacheLimit();
  }

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

  /**
   * (新) 解析引擎ID。如果未提供，则从设置中获取默认值。
   * @param {string|undefined} engine - 初始请求的引擎ID。
   * @returns {Promise<string>} 解析后的引擎ID。
   * @private
   */
  static async #resolveEngine(engine) {
      if (engine) {
          return engine;
      }
      const settings = await SettingsManager.getValidatedSettings();
      return settings.translatorEngine;
  }

  /**
   * (新) 根据文本和引擎设置，解析出最终应使用的翻译器及其配置。
   * 此方法将复杂的 AI 备用逻辑从 #executeTranslation 中分离出来。
   * @param {string} processedText - 已预处理的文本。
   * @param {string} initialEngine - 初始请求的引擎。
   * @param {string[]} log - 用于记录决策过程的日志数组。
   * @returns {Promise<{translator: object, engine: string, config: object|null}>}
   */
  static async #resolveTranslatorForText(processedText, initialEngine, log) {
      const resolvedInitialEngine = await this.#resolveEngine(initialEngine);
      const translator = this.getTranslator(resolvedInitialEngine);

      // 对于非 AI 引擎，逻辑更简单。
      if (!translator || translator.name !== 'AI') {
          if (translator && translator.name === 'DeepLx') {
              const settings = await SettingsManager.getValidatedSettings();
              const deeplxConfig = { apiUrl: settings.deeplxApiUrl };
              return { translator, engine: resolvedInitialEngine, config: deeplxConfig };
          }
          // 对于其他非 AI 引擎（如 Google），不需要额外的配置。
          return { translator, engine: resolvedInitialEngine, config: null };
      }

      // --- AI 引擎的特殊逻辑 ---
      const settings = await SettingsManager.getValidatedSettings();
      const engineId = resolvedInitialEngine.split(':')[1];
      const aiConfig = settings.aiEngines.find(e => e.id === engineId);

      if (!aiConfig) {
          throw new Error(`Selected AI engine configuration not found for ID: ${engineId}`);
      }

      // 检查是否满足短文本备用条件
      const wordCount = processedText.split(/\s+/).length;
      if (aiConfig.wordCountThreshold && wordCount <= aiConfig.wordCountThreshold && aiConfig.fallbackEngine) {
          let fallbackEngineName = aiConfig.fallbackEngine;
          if (fallbackEngineName === 'default') {
              fallbackEngineName = settings.translatorEngine;
              log.push(`短文本引擎为“默认”，解析为全局引擎: ${fallbackEngineName}`);
          }

          // 避免循环依赖
          if (fallbackEngineName === `ai:${aiConfig.id}`) {
              log.push(`[警告] 检测到循环依赖：备用引擎 (${fallbackEngineName}) 与当前引擎相同。为防止死循环，将使用原始AI引擎。`);
              return { translator, engine: resolvedInitialEngine, config: aiConfig };
          }

          const resolvedFallbackEngine = await this.#resolveEngine(fallbackEngineName);
          const fallbackTranslator = this.getTranslator(resolvedFallbackEngine);
          if (fallbackTranslator) {
              log.push(`短文本切换：单词数 ${wordCount} <= ${aiConfig.wordCountThreshold}，切换到 ${resolvedFallbackEngine}`);
              let fallbackConfig = null;
              if (resolvedFallbackEngine.startsWith('ai:')) {
                  const fallbackEngineId = resolvedFallbackEngine.split(':')[1];
                  fallbackConfig = settings.aiEngines.find(e => e.id === fallbackEngineId);
              }
              return { translator: fallbackTranslator, engine: resolvedFallbackEngine, config: fallbackConfig };
          }
          log.push(`[警告] 找不到备用翻译器 '${fallbackEngineName}'。将使用原始AI引擎。`);
      }

      // 默认情况：使用原始请求的 AI 引擎
      return { translator, engine: resolvedInitialEngine, config: aiConfig };
  }

  static async #executeTranslation(processedText, targetLang, sourceLang = 'auto', engine, signal) {
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

          const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;

          // 步骤 1: 解析出最终要使用的翻译器和配置
          const { translator, engine: resolvedEngine, config } = await this.#resolveTranslatorForText(processedText, engine, log);

          if (!translator) {
              const errorMessage = browser.i18n.getMessage('errorNoTranslator');
              log.push(browser.i18n.getMessage('logEntryNoTranslator'));
              log.push(errorMessage);
              return { text: "", translated: false, log: log, error: errorMessage };
          }
          log.push(browser.i18n.getMessage('logEntryEngineUsed', [translator.name, resolvedEngine]));

          // 步骤 2: 使用解析出的翻译器执行翻译
          const { text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, config, signal);
          log.push(...translatorLog);
          log.push(browser.i18n.getMessage('logEntryTranslationSuccess'));

          if (translatedResult) {
              this.#setCache(cacheKey, translatedResult);
          }
          await this.#saveCacheToStorage(); // 保存更新后的缓存
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

  static #enforceCacheLimit() {
      // 当缓存超出大小时，移除最旧的条目。
      // Map 会记住原始的插入顺序，所以这是一种有效的 FIFO 驱逐策略。
      while (this.#translationCache.size > this.#maxCacheSize) {
          // map.keys().next().value 获取第一个（即最旧的）键
          const oldestKey = this.#translationCache.keys().next().value;
          this.#translationCache.delete(oldestKey);
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
    if (!resolvedEngine) {
        console.error("getTranslator requires a resolved engine ID.");
        return undefined;
    }
    let translatorKey = resolvedEngine;
    if (translatorKey.startsWith('ai:')) {
      translatorKey = 'ai';
    }
    return this.#translators[translatorKey];
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
      const log = [
        browser.i18n.getMessage('logEntryStart', [text, sourceLang, targetLang]),
        browser.i18n.getMessage('logEntryCacheHit')
      ];
      const cachedResult = this.#translationCache.get(cacheKey);

      // 实现 LRU 策略：当一个条目被访问时，将它移动到 Map 的末尾，
      // 表示它是“最近使用的”。这可以防止常用翻译被不常用的新翻译挤出缓存。
      this.#translationCache.delete(cacheKey);
      this.#translationCache.set(cacheKey, cachedResult);

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
      const settings = await SettingsManager.getValidatedSettings();
      const max = settings.parallelRequests;
      if (max && typeof max === 'number' && max > 0) {
          this.#MAX_CONCURRENT_REQUESTS = max;
      }
      console.log(`[TranslatorManager] Concurrency limit updated to ${this.#MAX_CONCURRENT_REQUESTS}`);
  }

  static async updateCacheSize() {
      const settings = await SettingsManager.getValidatedSettings();
      const size = settings.cacheSize; // 假设设置项名为 cacheSize
      if (size && typeof size === 'number' && size >= 0) {
          this.#maxCacheSize = size;
      }
      console.log(`[TranslatorManager] Cache size limit updated to ${this.#maxCacheSize}`);
  }

  /**
   * 获取当前缓存的信息。
   * @returns {Promise<{count: number, limit: number}>}
   */
  static async getCacheInfo() {
      return {
          count: this.#translationCache.size,
          limit: this.#maxCacheSize
      };
  }

  static async clearCache() {
      this.#translationCache.clear();
      await this.#saveCacheToStorage();
      console.log("[TranslatorManager] Translation cache has been cleared.");
  }
}