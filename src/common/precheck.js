import browser from '../lib/browser-polyfill.js';
import { franc } from '../lib/franc.bundle.mjs';

// Mapping from franc language codes to project language codes
const FRANC_TO_PROJECT_LANG = {
    'eng': 'EN',
    'cmn': 'ZH',
    'jpn': 'JA',
    'kor': 'KO',
    'fra': 'FR',
    'deu': 'DE',
    'spa': 'ES',
    'rus': 'RU'
};

// Whitelist for franc detection
const FRANC_WHITELIST = Object.keys(FRANC_TO_PROJECT_LANG);

/**
 * Determines if a text string should be translated based on pre-check rules.
 * This version uses franc for language detection instead of regex-based erasure.
 * @param {string} text - The text to check.
 * @param {object} settings - A valid settings object containing precheckRules and targetLanguage.
 * @param {boolean} [enableLog=false] - 是否启用详细日志记录。默认为 false。
 * @returns {{result: boolean, reason: string, log?: string[]}} 包含翻译决策和原因（如果未翻译）的对象。
 */
export function shouldTranslate(text, settings, enableLog = false) {
    let log; // 仅在需要时初始化，进行微小优化
    if (enableLog) {
        log = [];
        log.push(browser.i18n.getMessage('logEntryPrecheckStart') || 'Pre-check started.');
    }

    const targetLang = settings?.targetLanguage;

    // Skip very short texts
    if (text.length < 3) {
        const reason = 'Text too short to translate.';
        if (enableLog) {
            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation') || 'Decision: Do not translate.');
        }
        return { result: false, reason, log };
    }

    // Use franc for language detection with options
    const detected = franc(text, { minLength: 10, whitelist: FRANC_WHITELIST });
    const detectedLang = FRANC_TO_PROJECT_LANG[detected];

    if (enableLog) {
        log.push(`Detected language: ${detected} (mapped to ${detectedLang || 'unknown'})`);
    }

    // If language is undetectable or not supported, skip translation
    if (detected === 'und' || !detectedLang) {
        const reason = 'Language undetectable or unsupported.';
        if (enableLog) {
            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation') || 'Decision: Do not translate.');
        }
        return { result: false, reason, log };
    }

    if (detectedLang !== targetLang) {
        if (enableLog) {
            log.push(browser.i18n.getMessage('logEntryPrecheckFinalCheck', [text]) || `Text needs translation from ${detectedLang} to ${targetLang}`);
        }
        return { result: true, reason: '', log };
    } else {
        const reason = `Text is already in target language (${targetLang}).`;
        if (enableLog) {
            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation') || 'Decision: Do not translate.');
        }
        return { result: false, reason, log };
    }
}
