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
    const log = []; // Initialize log for this translation request
    log.push(browser.i18n.getMessage('logEntryStart', [text, sourceLang, targetLang])); // Log start of translation
    console.log(`[TM Debug] Starting translateText for: "${text}" (from ${sourceLang} to ${targetLang})`); // Debug log

    try {
      // 1. 预处理和语言相同检查
      if (sourceLang !== 'auto' && sourceLang === targetLang) {
        log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [browser.i18n.getMessage('precheckRuleSameLanguage'), 'blacklist']));
        log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
        console.log(`[TM Debug] Pre-check: Same source/target language. Returning early.`); // Debug log
        return { text: text, translated: false, log: log };
      }

      const processedText = preProcess(text);
      console.log(`[TM Debug] Processed text: "${processedText}"`); // Debug log
      if (!processedText) {
          log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation')); // 或者更具体的提示
          console.log(`[TM Debug] Pre-check: Processed text is empty. Returning early.`); // Debug log
          return { text: "", translated: false, log: log };
      }

      const { settings } = await browser.storage.sync.get('settings');
      const precheckRules = settings?.precheckRules;
      console.log(`[TM Debug] Loaded settings:`, settings); // Debug log
      console.log(`[TM Debug] Loaded precheckRules:`, precheckRules); // Debug log

      // 2. 预检查规则配置检查
      if (!precheckRules || Object.keys(precheckRules).length === 0) {
          const errorMessage = "预检查规则未配置或为空，请检查设置。";
          log.push(browser.i18n.getMessage('logEntryPrecheckError', errorMessage));
          console.warn(`[TM Debug] Pre-check: ${errorMessage}`); // Debug log
          return { text: "", translated: false, log: log, error: errorMessage };
      }

      // --- 3. 预检查规则评估 ---
      log.push(browser.i18n.getMessage('logEntryPrecheckStart'));
      console.log(`[TM Debug] Starting pre-check rules evaluation.`); // Debug log

      if (precheckRules.general) {
          console.log(`[TM Debug] Evaluating general rules.`); // Debug log
          for (const rule of precheckRules.general) {
              if (rule.enabled && rule.mode === 'blacklist') {
                  try {
                      console.log(`[TM Debug] General rule: "${rule.name}", regex: "${rule.regex}", flags: "${rule.flags}"`); // Debug log
                      const regex = new RegExp(rule.regex, rule.flags);
                      const testResult = regex.test(processedText);
                      console.log(`[TM Debug] Regex test result for "${rule.name}": ${testResult}`); // Debug log
                      if (testResult) {
                          log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [rule.name, 'blacklist']));
                          log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                          console.log(`[TM Debug] Pre-check: General blacklist rule "${rule.name}" matched. Returning early.`); // Debug log
                          return { text: text, translated: false, log: log };
                      } else {
                          log.push(browser.i18n.getMessage('logEntryPrecheckNoMatch', [rule.name, 'blacklist']));
                      }
                  } catch (e) {
                      log.push(browser.i18n.getMessage('logEntryPrecheckRuleError', [rule.name, e.message]));
                      console.error(`[TM Debug] [Pre-check] Error applying blacklist rule "${rule.name}":`, e); // Debug log
                  }
              }
          }
      }

      // 4. 白名单规则 (语言特定)
      console.log(`[TM Debug] Evaluating language-specific whitelist rules for targetLang: ${targetLang}`); // Debug log
      const whitelistRule = precheckRules[targetLang]?.find(rule => rule.mode === 'whitelist' && rule.enabled);
      if (whitelistRule) {
          console.log(`[TM Debug] Whitelist rule found: "${whitelistRule.name}", regex: "${whitelistRule.regex}", flags: "${whitelistRule.flags}"`); // Debug log
          try {
              const letterChars = processedText.match(/\p{L}/gu);
              console.log(`[TM Debug] Letter chars in processed text:`, letterChars); // Debug log
              if (!letterChars) {
                  log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [browser.i18n.getMessage('precheckRulePunctuation'), 'blacklist'])); // 假设没有字母意味着它是标点符号
                  log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                  console.log(`[TM Debug] Pre-check: No letter chars found. Returning early.`); // Debug log
                  return { text: text, translated: false, log: log };
              }
              const allLettersString = letterChars.join('');
              // IMPORTANT: Ensure 'g' flag is only added if needed, or if it's part of the stored flags.
              // If whitelistRule.flags already contains 'g', adding it again is redundant.
              // If it doesn't, and the regex is meant to match globally, it should be added.
              // For simplicity, let's assume whitelistRule.flags contains all necessary flags.
              const langRegex = new RegExp(whitelistRule.regex, whitelistRule.flags);
              console.log(`[TM Debug] Whitelist regex created: ${langRegex}`); // Debug log
              const remainingChars = allLettersString.replace(langRegex, '');
              console.log(`[TM Debug] Remaining chars after whitelist regex: "${remainingChars}"`); // Debug log
              if (remainingChars.length === 0) {
                  log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [browser.i18n.getMessage(whitelistRule.nameKey), 'whitelist'])); // 使用 i18n 获取规则名称
                  log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                  console.log(`[TM Debug] Pre-check: Whitelist rule "${whitelistRule.name}" matched. Returning early.`); // Debug log
                  return { text: text, translated: false, log: log };
              } else {
                  log.push(browser.i18n.getMessage('logEntryPrecheckNoMatch', [whitelistRule.name, 'whitelist']));
              }
          } catch (e) {
              log.push(browser.i18n.getMessage('logEntryPrecheckRuleError', [whitelistRule.name, e.message]));
              console.error(`[TM Debug] [Pre-check] Error applying language regex for "${whitelistRule.name}":`, e); // Debug log
          }
      } else {
          log.push(browser.i18n.getMessage('logEntryPrecheckNoWhitelistRule', targetLang));
          console.log(`[TM Debug] No enabled whitelist rule found for ${targetLang}.`); // Debug log
      }

      // 5. 缓存检查 (在预检查之后)
      const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;
      if (translationCache.has(cacheKey)) {
          const cachedResult = translationCache.get(cacheKey);
          log.push(browser.i18n.getMessage('logEntryCacheHit'));
          console.log(`[TM Debug] Cache hit for key: ${cacheKey}`); // Debug log
          return { text: postProcess(cachedResult), translated: true, log: log };
      } else {
          log.push(browser.i18n.getMessage('logEntryCacheMiss'));
          console.log(`[TM Debug] Cache miss for key: ${cacheKey}`); // Debug log
      }

      // 6. 获取翻译器
      const translator = await this.getTranslator();
      if (!translator) {
          const errorMessage = "未选择或初始化有效的翻译器。";
          log.push(browser.i18n.getMessage('logEntryNoTranslator'));
          console.warn(`[TM Debug] ${errorMessage}`); // Debug log
          log.push(errorMessage);
          return { text: "", translated: false, log: log, error: errorMessage };
      }
      log.push(browser.i18n.getMessage('logEntryEngineUsed', translator.name));
      console.log(`[TM Debug] Using translator: ${translator.name}`); // Debug log
      
      // 7. 调用具体翻译器进行翻译
      console.log(`[TM Debug] Calling ${translator.name}.translate()`); // Debug log
      const { text: translatedResult, log: translatorLog } = await translator.translate(processedText, targetLang, sourceLang);
      log.push(...translatorLog); // 追加翻译器特有的日志
      log.push(browser.i18n.getMessage('logEntryTranslationSuccess'));
      
      if (translatedResult) {
          translationCache.set(cacheKey, translatedResult);
      }
      const finalResult = postProcess(translatedResult);
      console.log(`[TM Debug] Translation successful. Final result: "${finalResult}"`); // Debug log
      return { text: finalResult, translated: true, log: log };
    } catch (error) {
      // 捕获 TranslatorManager 内部的任何意外错误，或来自 translator.translate 的错误
      const errorMessage = `Translation failed: ${error.message}`;
      log.push(browser.i18n.getMessage('logEntryTranslationError', errorMessage));
      console.error(`[TM Debug] [TranslatorManager] Overall error caught:`, error); // Debug log
      return { text: "", translated: false, log: log, error: errorMessage }; // 返回错误状态
    }
  }
}
