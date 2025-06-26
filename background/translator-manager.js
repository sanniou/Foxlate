import { DeepLxTranslator } from './translators/deeplx-translator.js';
import { GoogleTranslator } from './translators/google-translator.js';
import { AITranslator } from './translators/ai-translator.js';
// ... 导入其他翻译器

// In-memory cache for translations
const translationCache = new Map();

const translators = {
  deeplx: new DeepLxTranslator(),
  google: new GoogleTranslator(),
  ai: new AITranslator(),
  // ...
};

/**
 * Pre-processes text before translation.
 * e.g., trims whitespace, normalizes newlines.
 * @param {string} text - The original text.
 * @returns {string} - The pre-processed text.
 */
function preProcess(text) {
    if (typeof text !== 'string') return '';
    // Example: Collapse multiple whitespace characters into a single space
    return text.trim().replace(/\s+/g, ' ');
}

/**
 * Post-processes text after translation.
 * e.g., fixes common API quirks.
 * @param {string} text - The translated text.
 * @returns {string} - The post-processed text.
 */
function postProcess(text) {
    if (typeof text !== 'string') return '';
    // Example: You could fix common formatting issues here.
    // e.g., text.replace(/【/g, '[').replace(/】/g, ']');
    return text;
}

export class TranslatorManager {
  /**
   * Gets the translator instance based on user's preferred engine from sync storage.
   * Defaults to 'deeplx' if no engine is specified in settings.
   * @returns {Promise<object>} The translator instance corresponding to the selected engine.
   */
  static async getTranslator() {
    const { settings } = await browser.storage.sync.get('settings');
    const engine = settings?.translatorEngine || 'deeplx'; // 默认使用 deeplx
    return translators[engine];
  }

  static async translateText(text, targetLang, sourceLang = 'auto') {
    const log = []; // 为本次翻译请求初始化日志
    log.push(browser.i18n.getMessage('logEntryStart', [text, sourceLang, targetLang])); // 记录翻译开始

    try {
      // 1. 预处理和语言相同检查
      if (sourceLang !== 'auto' && sourceLang === targetLang) {
        log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [browser.i18n.getMessage('precheckRuleSameLanguage'), 'blacklist']));
        log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
        return { text: text, translated: false, log: log };
      }

      const processedText = preProcess(text);
      if (!processedText) {
          log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation')); // 或者更具体的提示
          return { text: "", translated: false, log: log };
      }

      const { settings } = await browser.storage.sync.get('settings');
      const precheckRules = settings?.precheckRules;

      // 2. 预检查规则配置检查
      if (!precheckRules || Object.keys(precheckRules).length === 0) {
          const errorMessage = "预检查规则未配置。请打开扩展选项页面并保存设置以完成初始化。";
          log.push(browser.i18n.getMessage('logEntryPrecheckError', errorMessage));
          return { text: "", translated: false, log: log, error: errorMessage };
      }

      // --- 3. 预检查规则评估 ---
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
                      console.error(`[Pre-check] Error applying blacklist rule "${rule.name}":`, e);
                  }
              }
          }
      }

      // 4. 白名单规则 (语言特定)
      const whitelistRule = precheckRules[targetLang]?.find(rule => rule.mode === 'whitelist' && rule.enabled);
      if (whitelistRule) {
          try {
              const letterChars = processedText.match(/\p{L}/gu);
              if (!letterChars) {
                  log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [browser.i18n.getMessage('precheckRulePunctuation'), 'blacklist'])); // 假设没有字母意味着它是标点符号
                  log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                  return { text: text, translated: false, log: log };
              }
              const allLettersString = letterChars.join('');
              const langRegex = new RegExp(whitelistRule.regex, whitelistRule.flags + 'g');
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
              console.error("[Pre-check] Error applying language regex:", e);
          }
      } else {
          log.push(browser.i18n.getMessage('logEntryPrecheckNoWhitelistRule', targetLang));
      }

      // 5. 缓存检查 (在预检查之后)
      const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;
      if (translationCache.has(cacheKey)) {
          const cachedResult = translationCache.get(cacheKey);
          log.push(browser.i18n.getMessage('logEntryCacheHit'));
          return { text: postProcess(cachedResult), translated: true, log: log };
      } else {
          log.push(browser.i18n.getMessage('logEntryCacheMiss'));
      }

      // 6. 获取翻译器
      const translator = await this.getTranslator();
      if (!translator) {
          const errorMessage = browser.i18n.getMessage('logEntryNoTranslator');
          log.push(errorMessage);
          return { text: "", translated: false, log: log, error: errorMessage };
      }
      log.push(browser.i18n.getMessage('logEntryEngineUsed', translator.name));
      
      // 7. 调用具体翻译器进行翻译
      const { text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang);
      log.push(...translatorLog); // 追加翻译器特有的日志
      log.push(browser.i18n.getMessage('logEntryTranslationSuccess'));
      
      if (translatedResult) {
          translationCache.set(cacheKey, translatedResult);
      }
      const finalResult = postProcess(translatedResult);
      return { text: finalResult, translated: true, log: log };
    } catch (error) {
      // 捕获 TranslatorManager 内部的任何意外错误，或来自 translator.translate 的错误
      const errorMessage = `Translation failed: ${error.message}`;
      log.push(browser.i18n.getMessage('logEntryTranslationError', errorMessage));
      console.error(`[TranslatorManager] Overall error:`, error);
      return { text: "", translated: false, log: log, error: errorMessage }; // 返回错误状态
    }
  }
}
