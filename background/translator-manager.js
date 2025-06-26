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
    console.log(`[Debug] translateText called with: text="${text}", targetLang="${targetLang}", sourceLang="${sourceLang}"`);

    if (sourceLang !== 'auto' && sourceLang === targetLang) {
      console.log(`[Debug] Skipping translation because sourceLang (${sourceLang}) and targetLang (${targetLang}) are the same.`);
      return text;
    }

    const processedText = preProcess(text);
    console.log(`[Debug] Pre-processed text: "${processedText}"`);

    if (!processedText) {
        console.log("[Debug] Processed text is empty. Returning empty string.");
        return ""; // Return empty if text is empty after processing
    }

    // --- Pre-check Rule Implementation (Corrected) ---
    console.log("[Debug] Starting pre-check to see if text is already in the target language.");
    
    // 1. Load settings from storage
    const { settings } = await browser.storage.sync.get('settings');
    let precheckRules = settings?.precheckRules;

    // 2. If no rules in storage, generate defaults
    // Pre-check rules should always be present in storage, as the options page
    // initializes them on first load/save. If they are missing, it indicates
    // a configuration issue.
    if (!precheckRules || Object.keys(precheckRules).length === 0) {
        throw new Error("预检查规则未配置。请打开扩展选项页面并保存设置以完成初始化。");
    }

    // 3. Apply general blacklist rules first. These rules prevent translation of things like code, numbers, or single words.
    if (precheckRules.general) {
        for (const rule of precheckRules.general) {
            if (rule.enabled && rule.mode === 'blacklist') {
                try {
                    const regex = new RegExp(rule.regex, rule.flags);
                    if (regex.test(processedText)) {
                        console.log(`[Debug] [Pre-check] Text matched blacklist rule "${rule.name}". Skipping translation.`);
                        return text; // Return original, untrimmed text
                    }
                } catch (e) {
                    console.error(`[Debug] [Pre-check] Error applying blacklist rule "${rule.name}":`, e);
                }
            }
        }
    }

    // 4. Find and apply the relevant whitelist rule for the target language. This is to check if the text is already in the target language.
    const whitelistRule = precheckRules[targetLang]?.find(rule => rule.mode === 'whitelist' && rule.enabled);
    console.log(`[Debug] Whitelist rule for ${targetLang}:`, whitelistRule);

    if (whitelistRule) {
        try {
            const letterChars = processedText.match(/\p{L}/gu);
            if (!letterChars) {
                console.log(`[Debug] [Pre-check] Text contains no letters. Skipping translation.`);
                return text;
            }
            const allLettersString = letterChars.join('');
            
            const langRegex = new RegExp(whitelistRule.regex, whitelistRule.flags + 'g');
            const remainingChars = allLettersString.replace(langRegex, '');
            console.log(`[Debug] Characters remaining after removing ${targetLang} script: "${remainingChars}"`);

            if (remainingChars.length === 0) {
                console.log(`[Debug] [Pre-check] Text is already in target language (${targetLang}). Skipping translation.`);
                return text;
            }
        } catch (e) {
            console.error("[Debug] [Pre-check] Error applying language regex:", e);
        }
    } else {
        console.log(`[Debug] No enabled whitelist rule found for targetLang "${targetLang}". Skipping pre-check.`);
    }

    const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;
    console.log(`[Debug] Cache key: "${cacheKey}"`);

    if (translationCache.has(cacheKey)) {
        const cachedResult = translationCache.get(cacheKey);
        console.log(`[Debug] Cache hit. Returning cached result: "${cachedResult}"`);
        return postProcess(cachedResult);
    }
    console.log("[Debug] Cache miss.");

    const translator = await this.getTranslator();
    if (!translator) {
        console.error('[Debug] No valid translator could be selected.');
        throw new Error('No valid translator selected.');
    }
    console.log(`[Debug] Using translator: "${translator.constructor.name}"`);
    
    try {
        console.log(`[Debug] Calling translator.translate with text: "${processedText}", targetLang: "${targetLang}", sourceLang: "${sourceLang}"`);
        const translatedText = await translator.translate(processedText, targetLang, sourceLang);
        console.log(`[Debug] Translation result from translator: "${translatedText}"`);
        
        if (translatedText) {
            console.log(`[Debug] Caching result: "${translatedText}" for key: "${cacheKey}"`);
            translationCache.set(cacheKey, translatedText);
        }

        const finalResult = postProcess(translatedText);
        console.log(`[Debug] Final result after post-processing: "${finalResult}"`);
        return finalResult;

    } catch (error) {
        console.error(`[Debug] Translation error with ${translator.name}:`, error);
        throw error;
    }
  }
}
