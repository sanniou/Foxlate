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
    if (sourceLang !== 'auto' && sourceLang === targetLang) {
      return { text: text, translated: false };
    }

    const processedText = preProcess(text);
    if (!processedText) {
        return { text: "", translated: false };
    }

    const { settings } = await browser.storage.sync.get('settings');
    const precheckRules = settings?.precheckRules;

    if (!precheckRules || Object.keys(precheckRules).length === 0) {
        throw new Error("预检查规则未配置。请打开扩展选项页面并保存设置以完成初始化。");
    }

    if (precheckRules.general) {
        for (const rule of precheckRules.general) {
            if (rule.enabled && rule.mode === 'blacklist') {
                try {
                    const regex = new RegExp(rule.regex, rule.flags);
                    if (regex.test(processedText)) {
                        return { text: text, translated: false };
                    }
                } catch (e) {
                    console.error(`[Pre-check] Error applying blacklist rule "${rule.name}":`, e);
                }
            }
        }
    }

    const whitelistRule = precheckRules[targetLang]?.find(rule => rule.mode === 'whitelist' && rule.enabled);
    if (whitelistRule) {
        try {
            const letterChars = processedText.match(/\p{L}/gu);
            if (!letterChars) {
                return { text: text, translated: false };
            }
            const allLettersString = letterChars.join('');
            const langRegex = new RegExp(whitelistRule.regex, whitelistRule.flags + 'g');
            const remainingChars = allLettersString.replace(langRegex, '');
            if (remainingChars.length === 0) {
                return { text: text, translated: false };
            }
        } catch (e) {
            console.error("[Pre-check] Error applying language regex:", e);
        }
    }

    const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;
    if (translationCache.has(cacheKey)) {
        const cachedResult = translationCache.get(cacheKey);
        return { text: postProcess(cachedResult), translated: true };
    }

    const translator = await this.getTranslator();
    if (!translator) {
        throw new Error('No valid translator selected.');
    }
    
    try {
        const translatedText = await translator.translate(processedText, targetLang, sourceLang);
        if (translatedText) {
            translationCache.set(cacheKey, translatedText);
        }
        const finalResult = postProcess(translatedText);
        return { text: finalResult, translated: true };
    } catch (error) {
        console.error(`Translation error with ${translator.name}:`, error);
        throw error;
    }
  }
}
