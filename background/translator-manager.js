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
    const processedText = preProcess(text);
    if (!processedText) {
        return ""; // Return empty if text is empty after processing
    }

    const cacheKey = `${sourceLang}:${targetLang}:${processedText}`;

    // 1. Check cache first
    if (translationCache.has(cacheKey)) {
        const cachedResult = translationCache.get(cacheKey);
        return postProcess(cachedResult);
    }

    // 2. If not in cache, call the translator
    const translator = await this.getTranslator();
    if (!translator) {
        throw new Error('No valid translator selected.');
    }
    
    try {
        const translatedText = await translator.translate(processedText, targetLang, sourceLang);
        
        // 3. Store result in cache if translation was successful
        if (translatedText) {
            translationCache.set(cacheKey, translatedText);
        }

        // 4. Post-process and return
        return postProcess(translatedText);

    } catch (error) {
        console.error(`Translation error with ${translator.name}:`, error);
        // Do not cache errors, re-throw to be handled by the caller
        throw error;
    }
  }
}
