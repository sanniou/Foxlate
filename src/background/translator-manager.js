import { getValidatedSettings } from '../common/settings-manager.js';
import { DeepLxTranslator } from './translators/deeplx-translator.js';
import { GoogleTranslator } from './translators/google-translator.js';
import { AITranslator } from './translators/ai-translator.js';

// 内存缓存
const translationCache = new Map();
// 进行中请求的缓存，用于复用在途的 API 调用
const inFlightRequests = new Map();

const translators = {
  deeplx: new DeepLxTranslator(),
  google: new GoogleTranslator(),
  ai: new AITranslator(),
};

// --- 并发控制与任务队列 ---
const taskQueue = [];
// 使用 Map 来存储活跃任务的 AbortController，以便可以中止它们
const activeTasks = new Map();
let taskIdCounter = 0;
// 从设置中读取，如果未设置，则默认为 5
let MAX_CONCURRENT_REQUESTS = 5;

function preProcess(text) {
    if (typeof text !== 'string') return '';
    return text.trim(); // 只移除首尾空白，保留内部换行符
}

function postProcess(text) {
    if (typeof text !== 'string') return '';
    return text;
}

/**
 * 调度器，检查队列并启动新的工作者（如果有名额）。
 */
function processQueue() {
    if (taskQueue.length === 0 || activeTasks.size >= MAX_CONCURRENT_REQUESTS) {
        return;
    }

    const task = taskQueue.shift();
    const taskId = taskIdCounter++;
    activeTasks.set(taskId, task.controller);

    // 使用 async/await 结构来处理任务，使代码更清晰
    (async () => {
        try {
            // 将 AbortSignal 传递给执行函数
            const result = await executeTranslation(task.text, task.targetLang, task.sourceLang, task.engine, task.controller.signal);
            task.resolve(result);
        } catch (error) {
            // 将所有错误（包括 AbortError）传递给调用者
            task.reject(error);
        } finally {
            // 确保任务完成后从活跃列表中移除
            activeTasks.delete(taskId);
            processQueue();
        }
    })();
}


/**
 * 实际的翻译执行逻辑，从旧的 translateText 中提取。
 */
async function executeTranslation(text, targetLang, sourceLang = 'auto', engine, signal) {

    const log = [];
    log.push(browser.i18n.getMessage('logEntryStart', [text, sourceLang, targetLang]));

    // 快速失败：如果在开始前任务就被中止了
    if (signal?.aborted) {
        // 抛出标准的 AbortError
        throw new DOMException('Translation was interrupted by the user.', 'AbortError');
    }

    try {
        // This simple check remains in the backend as a final safeguard.
        if (sourceLang !== 'auto' && sourceLang === targetLang) {
            log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [browser.i18n.getMessage('precheckRuleSameLanguage'), 'blacklist']));
            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
            return { text: text, translated: false, log: log };
        }
        const processedText = preProcess(text);
        if (!processedText) {
            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
            return { text: "", translated: false, log: log };
        }

        // Pre-check logic is now handled in content-script.js before sending the request.
        // The service worker now assumes that any text it receives is meant to be translated.

        const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;
        if (translationCache.has(cacheKey)) {
            const cachedResult = translationCache.get(cacheKey);
            log.push(browser.i18n.getMessage('logEntryCacheHit'));
            return { text: postProcess(cachedResult), translated: true, log: log };
        } else {
            log.push(browser.i18n.getMessage('logEntryCacheMiss'));
        }

        const translator = await TranslatorManager.getTranslator(engine);
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

                // 1. 解析“使用默认设置”
                if (fallbackEngineName === 'default') {
                    fallbackEngineName = settings.translatorEngine;
                    log.push(`短文本引擎为“默认”，解析为全局引擎: ${fallbackEngineName}`);
                }

                // 2. 检查循环依赖
                const isCircular = fallbackEngineName === `ai:${aiConfig.id}`;

                if (isCircular) {
                    log.push(`[警告] 检测到循环依赖：备用引擎 (${fallbackEngineName}) 与当前引擎相同。为防止死循环，将使用原始AI引擎。`);
                    // 回退到使用原始翻译器
                    ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, aiConfig, signal));
                } else {
                    const fallbackTranslator = await TranslatorManager.getTranslator(fallbackEngineName);
                    if (fallbackTranslator) {
                        log.push(`短文本切换：单词数 ${wordCount} <= ${aiConfig.wordCountThreshold}，切换到 ${fallbackEngineName}`);
                        let fallbackAiConfig = null;
                        if (fallbackEngineName.startsWith('ai:')) {
                            const fallbackEngineId = fallbackEngineName.split(':')[1];
                            fallbackAiConfig = settings.aiEngines.find(e => e.id === fallbackEngineId);
                        }
                        ({ text: translatedResult, log: translatorLog } = await fallbackTranslator.translate(processedText, targetLang, sourceLang, fallbackAiConfig, signal));
                    } else {
                        log.push(`[警告] 找不到备用翻译器 '${fallbackEngineName}'。将使用原始AI引擎。`);
                        ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, aiConfig, signal));
                    }
                }
            } else {
                // 标准翻译，不使用备用引擎
                ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, aiConfig, signal));
            }
        } else {
            ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, null, signal));
        }
        log.push(...translatorLog);
        log.push(browser.i18n.getMessage('logEntryTranslationSuccess'));

        if (translatedResult) {
            translationCache.set(cacheKey, translatedResult);
        }
        const finalResult = postProcess(translatedResult);
        return { text: finalResult, translated: true, log: log };
    } catch (error) {
        // 如果是中止错误，直接重新抛出
        if (error.name === 'AbortError') throw error;

        const errorMessage = `Translation failed: ${error.message}`;
        log.push(browser.i18n.getMessage('logEntryTranslationError', errorMessage));
        console.error(`[TranslatorManager] Overall error caught:`, error);
        return { text: "", translated: false, log: log, error: errorMessage };
    }
}


export class TranslatorManager {
  static async getTranslator(engine) {
    if (!engine) {
        const settings = await getValidatedSettings();
        engine = settings.translatorEngine;
    }
    if (engine.startsWith('ai:')) {
      engine = 'ai';
    }
    return translators[engine];
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
    const processedText = preProcess(text);
    if (!processedText) {
      return Promise.resolve({ text: "", translated: false, log: [browser.i18n.getMessage('logEntryPrecheckNoTranslation')] });
    }
    const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;

    // 1. 检查永久缓存
    if (translationCache.has(cacheKey)) {
      const cachedResult = translationCache.get(cacheKey);
      const log = [
        browser.i18n.getMessage('logEntryStart', [text, sourceLang, targetLang]),
        browser.i18n.getMessage('logEntryCacheHit')
      ];
      return Promise.resolve({ text: postProcess(cachedResult), translated: true, log: log });
    }

    // 2. 检查是否有正在进行的相同请求
    if (inFlightRequests.has(cacheKey)) {
      // 复用已在途的请求 Promise
      return inFlightRequests.get(cacheKey);
    }

    // 3. 创建新的翻译任务 Promise
    const translationPromise = new Promise((resolve, reject) => {
      const controller = new AbortController();
      taskQueue.push({
        text,
        targetLang,
        sourceLang,
        engine,
        resolve,
        reject,
        controller // 将控制器与任务关联
      });
      processQueue();
    }).finally(() => {
      // 任务完成后（无论成功或失败），从在途请求映射中移除
      inFlightRequests.delete(cacheKey);
    });

    // 将新的 Promise 存入在途请求映射中
    inFlightRequests.set(cacheKey, translationPromise);

    return translationPromise;
  }

  /**
   * 中断所有待处理和正在进行的翻译任务。
   */
  static interruptAll() {
      // 1. 中止所有正在运行的任务
      for (const controller of activeTasks.values()) {
          controller.abort();
      }
      // activeTasks 会在任务的 finally 块中被自动清理

      // 2. 拒绝队列中所有待处理的 Promise
      taskQueue.forEach(task => {
          task.controller.abort(); // 标记为中止
          task.reject(new DOMException("Translation was interrupted by the user.", "AbortError"));
      });
      // 3. 清空队列
      taskQueue.length = 0;
      // 注意：在途请求(inFlightRequests)中的 Promise 会因为 task.reject() 而被拒绝，
      // 进而触发其 .finally() 块，自动从 inFlightRequests 中清理。
      console.log("[TranslatorManager] All pending and active translation tasks have been interrupted.");
  }

  static async updateConcurrencyLimit() {
    const settings = await getValidatedSettings();
    const max = settings.parallelRequests;
    if (max && typeof max === 'number' && max > 0) {
        MAX_CONCURRENT_REQUESTS = max;
    }
    console.log(`[TranslatorManager] Concurrency limit updated to ${MAX_CONCURRENT_REQUESTS}`);
  }
}



// 启动时初始化并发限制
getValidatedSettings().then((settings) => {
    const max = settings.parallelRequests;
    if (max && typeof max === 'number' && max > 0) {
        MAX_CONCURRENT_REQUESTS = max;
    }
    console.log(`[TranslatorManager] Initial concurrency limit set to ${MAX_CONCURRENT_REQUESTS}`);
});