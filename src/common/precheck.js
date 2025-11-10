import browser from '../lib/browser-polyfill.js';
import { detectProjectLang } from './utils.js';

// (优化) 将通用的、不需翻译的文本模式硬编码为正则表达式，以取代已废弃的用户自定义预检规则。
// 这种方式性能更高，且逻辑更集中。
const PRECHECK_BLACKLIST_REGEX = [
    // 1. 纯粹由空白字符、数字、标点和符号组成的字符串。
    /^[ \t\n\r\d\p{P}\p{S}]*$/u,
    // 2. 常见的 URL 协议头。
    /^(https?|ftp|file):\/\//i,
    // 3. 常见的邮件地址格式。
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    // 4. Markdown/代码块标记。
    /^```|~~~/,
    // 5. 单个表情符号。
    /^\p{Extended_Pictographic}$/u,
];

/**
 * (已重构) 根据内置规则和语言检测，判断文本是否需要翻译。
 * 此函数不再依赖外部传入的 `precheckRules`，而是使用一组固定的高效规则。
 * @param {string} text - The text to check.
 * @param {object} settings - 包含 `targetLanguage` 的有效设置对象。
 * @param {boolean} [enableLog=false] - 是否启用详细日志记录。默认为 false。
 * @returns {{result: boolean, reason: string, log?: string[]}} 包含翻译决策和原因的对象。
 */
export function shouldTranslate(text, settings, enableLog = false) {
    const log = enableLog ? [] : null;
    log?.push(browser.i18n.getMessage('logEntryPrecheckStart') || 'Pre-check started.');

    // 步骤 1: 应用内置的黑名单规则进行快速过滤。
    for (const regex of PRECHECK_BLACKLIST_REGEX) {
        if (regex.test(text)) {
            const reason = `Text matches pre-check blacklist rule: ${regex.source}`;
            log?.push(browser.i18n.getMessage('logEntryPrecheckMatch', [reason, 'blacklist']));
            return { result: false, reason, log };
        }
    }

    // 步骤 2: 使用已优化的 `detectProjectLang` 进行语言检测。
    const { rawCode, projectCode } = detectProjectLang(text);
    log?.push(`Detected language: ${rawCode} (mapped to ${projectCode || 'unsupported'})`);
    
    // 步骤 3: 比较源语言和目标语言。
    if (projectCode && projectCode !== settings.targetLanguage) {
        log?.push(`Decision: Translate from ${projectCode} to ${settings.targetLanguage}.`);
        return { result: true, reason: '', log };
    } else {
        const reason = projectCode ? `Text is already in target language (${settings.targetLanguage}).` : 'Language undetectable or unsupported.';
        log?.push(`Decision: Do not translate. Reason: ${reason}`);
        return { result: false, reason, log };
    }
}
