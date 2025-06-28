import { DeepLxTranslator } from './translators/deeplx-translator.js';
import { GoogleTranslator } from './translators/google-translator.js';
import { AITranslator } from './translators/ai-translator.js';

// 内存缓存
const translationCache = new Map();

const translators = {
  deeplx: new DeepLxTranslator(),
  google: new GoogleTranslator(),
  ai: new AITranslator(),
};

// --- 并发控制与任务队列 ---
const taskQueue = [];
let activeWorkers = 0;
// 从设置中读取，如果未设置，则默认为 5
let MAX_CONCURRENT_REQUESTS = 5;

function preProcess(text) {
    if (typeof text !== 'string') return '';
    return text.trim().replace(/\s+/g, ' ');
}

function postProcess(text) {
    if (typeof text !== 'string') return '';
    return text;
}

/**
 * 调度器，检查队列并启动新的工作者（如果有名额）。
 */
function processQueue() {
    if (taskQueue.length === 0 || activeWorkers >= MAX_CONCURRENT_REQUESTS) {
        return;
    }

    activeWorkers++;
    const task = taskQueue.shift();

    // 使用 async/await 结构来处理任务，使代码更清晰
    (async () => {
        try {
            const result = await executeTranslation(task.text, task.targetLang, task.sourceLang);
            task.resolve(result);
        } catch (error) {
            task.reject(error);
        } finally {
            activeWorkers--;
            processQueue();
        }
    })();
}


/**
 * 实际的翻译执行逻辑，从旧的 translateText 中提取。
 */
async function executeTranslation(text, targetLang, sourceLang = 'auto') {
    // ... (这里的代码与您之前版本中的 `translateText` 内部逻辑几乎完全相同)
    // 为了简洁，我们假设这里的逻辑是完整的，包括预处理、规则检查、缓存、调用翻译器等
    const log = [];
    log.push(browser.i18n.getMessage('logEntryStart', [text, sourceLang, targetLang]));

    try {
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

        const { settings } = await browser.storage.sync.get('settings');
        const precheckRules = settings?.precheckRules;

        if (!precheckRules || Object.keys(precheckRules).length === 0) {
            const errorMessage = "预检查规则未配置或为空，请检查设置。";
            log.push(browser.i18n.getMessage('logEntryPrecheckError', errorMessage));
            return { text: "", translated: false, log: log, error: errorMessage };
        }

        log.push(browser.i18n.getMessage('logEntryPrecheckStart'));
        if (precheckRules.general) {
            for (const rule of precheckRules.general) {
                if (rule.enabled && rule.mode === 'blacklist') {
                    try {
                        const regex = new RegExp(rule.regex, rule.flags);
                        if (regex.test(processedText)) {
                            log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [rule.name, 'blacklist']));
                            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                            return { text: text, translated: false, log: log };
                        } else {
                            log.push(browser.i18n.getMessage('logEntryPrecheckNoMatch', [rule.name, 'blacklist']));
                        }
                    } catch (e) {
                        log.push(browser.i18n.getMessage('logEntryPrecheckRuleError', [rule.name, e.message]));
                    }
                }
            }
        }

        const whitelistRule = precheckRules[targetLang]?.find(rule => rule.mode === 'whitelist' && rule.enabled);
        if (whitelistRule) {
            try {
                const letterChars = processedText.match(/\p{L}/gu);
                if (!letterChars) {
                    log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [browser.i18n.getMessage('precheckRulePunctuation'), 'blacklist']));
                    log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                    return { text: text, translated: false, log: log };
                }
                const allLettersString = letterChars.join('');
                const flags = whitelistRule.flags || '';
                const globalFlags = flags.includes('g') ? flags : flags + 'g';
                const langRegex = new RegExp(whitelistRule.regex, globalFlags);
                const remainingChars = allLettersString.replace(langRegex, '');
                if (remainingChars.length === 0) {
                    log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [whitelistRule.name, 'whitelist']));
                    log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                    return { text: text, translated: false, log: log };
                } else {
                    log.push(browser.i18n.getMessage('logEntryPrecheckNoMatch', [whitelistRule.name, 'whitelist']));
                }
            } catch (e) {
                log.push(browser.i18n.getMessage('logEntryPrecheckRuleError', [whitelistRule.name, e.message]));
            }
        } else {
            log.push(browser.i18n.getMessage('logEntryPrecheckNoWhitelistRule', targetLang));
        }

        const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;
        if (translationCache.has(cacheKey)) {
            const cachedResult = translationCache.get(cacheKey);
            log.push(browser.i18n.getMessage('logEntryCacheHit'));
            return { text: postProcess(cachedResult), translated: true, log: log };
        } else {
            log.push(browser.i18n.getMessage('logEntryCacheMiss'));
        }

        const translator = await TranslatorManager.getTranslator();
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
            const { settings } = await browser.storage.sync.get('settings');
            const selectedEngineId = settings?.translatorEngine.split(':')[1];
            const aiConfig = settings?.aiEngines?.find(engine => engine.id === selectedEngineId);

            if (!aiConfig) {
                throw new Error('Selected AI engine configuration not found.');
            }
            ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang, aiConfig));
        } else {
            ({ text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang));
        }
        log.push(...translatorLog);
        log.push(browser.i18n.getMessage('logEntryTranslationSuccess'));

        if (translatedResult) {
            translationCache.set(cacheKey, translatedResult);
        }
        const finalResult = postProcess(translatedResult);
        return { text: finalResult, translated: true, log: log };
    } catch (error) {
        const errorMessage = `Translation failed: ${error.message}`;
        log.push(browser.i18n.getMessage('logEntryTranslationError', errorMessage));
        console.error(`[TranslatorManager] Overall error caught:`, error);
        return { text: "", translated: false, log: log, error: errorMessage };
    }
}


export class TranslatorManager {
  static async getTranslator() {
    const { settings } = await browser.storage.sync.get('settings');
    let engine = settings?.translatorEngine || 'deeplx';
    if (engine.startsWith('ai:')) {
      engine = 'ai';
    }
    return translators[engine];
  }

  /**
   * 将翻译任务添加到队列，并返回一个解析结果的 Promise。
   * @param {string} text - 要翻译的文本。
   * @param {string} targetLang - 目标语言。
   * @param {string} [sourceLang='auto'] - 源语言。
   * @returns {Promise<object>} 一个解析为翻译结果的 Promise。
   */
  static translateText(text, targetLang, sourceLang = 'auto') {
    return new Promise((resolve, reject) => {
        taskQueue.push({
            text,
            targetLang,
            sourceLang,
            resolve,
            reject
        });
        // 触发调度器
        processQueue();
    });
  }

  /**
   * 清空整个翻译队列，用于中断操作。
   */
  static interruptAll() {
      // 拒绝队列中所有待处理的 Promise
      taskQueue.forEach(task => {
          // ** (修复 #4) 使用特定的中断错误 **
          task.reject(new Error("Translation was interrupted by the user."));
      });
      // 清空队列
      taskQueue.length = 0;
      console.log("[TranslatorManager] All pending translation tasks have been interrupted.");
  }
}

// 当设置变化时，更新并发限制
browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
        const newSettings = changes.settings.newValue;
        const newMax = newSettings?.parallelRequests;
        if (newMax && typeof newMax === 'number' && newMax > 0) {
            MAX_CONCURRENT_REQUESTS = newMax;
            console.log(`[TranslatorManager] Concurrency limit updated to ${MAX_CONCURRENT_REQUESTS}`);
        }
    }
});

// 启动时初始化并发限制
browser.storage.sync.get('settings').then(({ settings }) => {
    const max = settings?.parallelRequests;
    if (max && typeof max === 'number' && max > 0) {
        MAX_CONCURRENT_REQUESTS = max;
    }
    console.log(`[TranslatorManager] Initial concurrency limit set to ${MAX_CONCURRENT_REQUESTS}`);
});