import browser from '../lib/browser-polyfill.js';
import { detectProjectLang } from './utils.js';

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

    // 使用专用的项目语言检测函数
    const { rawCode, projectCode } = detectProjectLang(text);

    if (enableLog) {
        log.push(`Detected language: ${rawCode} (mapped to ${projectCode || 'unsupported'})`);
    }

    // If language is undetectable or not supported, skip translation
    if (!projectCode) {
        const reason = 'Language undetectable or unsupported.';
        if (enableLog) {
            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation') || 'Decision: Do not translate.');
        }
        return { result: false, reason, log };
    }

    if (projectCode !== targetLang) {
        if (enableLog) {
            log.push(browser.i18n.getMessage('logEntryPrecheckFinalCheck', [text]) || `Text needs translation from ${projectCode} to ${targetLang}`);
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
