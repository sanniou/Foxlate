import { franc } from '../lib/franc.bundle.mjs';

/**
 * 统一的语言配置对象。
 * 键是 franc 返回的 ISO 639-3 语言代码。
 * 值包含项目内部代码和用于 Web Speech API 的 BCP 47 代码。
 * @see https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
 */
export const LANGUAGE_CONFIG = {
    'eng': { projectCode: 'EN', speechCode: 'en-US' },    // 英语
    'cmn': { projectCode: 'ZH', speechCode: 'zh-CN' },    // 普通话 (Mandarin)
    'jpn': { projectCode: 'JA', speechCode: 'ja-JP' },    // 日语
    'kor': { projectCode: 'KO', speechCode: 'ko-KR' },    // 韩语
    'fra': { projectCode: 'FR', speechCode: 'fr-FR' },    // 法语
    'deu': { projectCode: 'DE', speechCode: 'de-DE' },    // 德语
    'spa': { projectCode: 'ES', speechCode: 'es-ES' },    // 西班牙语
    'rus': { projectCode: 'RU', speechCode: 'ru-RU' },    // 俄语
    'ita': { projectCode: 'IT', speechCode: 'it-IT' },    // 意大利语
    'por': { projectCode: 'PT', speechCode: 'pt-BR' },    // 葡萄牙语
    'nld': { projectCode: 'NL', speechCode: 'nl-NL' },    // 荷兰语
};

/**
 * 检测给定文本最可能的语言。
 * @param {string} text - 要检测的文本。
 * @param {object} [options={}] - franc 检测库的选项。
 * @param {number} [options.minLength=10] - 触发检测的最短文本长度。
 * @param {string[]} [options.whitelist] - 语言代码白名单 (ISO 639-3)。
 * @returns {string} 三字母 ISO 639-3 语言代码 (例如, 'eng', 'cmn', 'und')。
 */
export function detectLang(text, options = {}) {    
    // (优化) 移除 minLength 硬编码，让 franc 自行处理。
    // franc 对短文本可能不准，但直接放弃会错失很多可识别的短语。
    if (!text || !text.trim()) {
        return 'und';
    }

    let lang = franc(text, options);

    // (优化) 当 franc 无法确定时，增加基于字符集的补充判断，以提高对短文本的识别率。
    // 这对于特征明显的语言（如韩语、日语）尤其有效。
    if (lang === 'und') {
        if (/[가-힣]/.test(text)) { // 韩文音节
            return 'kor';
        } else if (/[ぁ-んァ-ン]/.test(text)) { // 日文平假名和片假名
            return 'jpn';
        } else if (/[\u0400-\u04FF]/.test(text)) { // 西里尔字母 (俄语等)
            return 'rus';
        } else if (/[ñ]/.test(text)) { // 西班牙语特有字符
            return 'spa';
        } else if (/[æœ]/.test(text)) { // 法语特有字符 (æ, œ 是高置信度标志)
            return 'fra';
        } else if (/[ãõ]/.test(text)) { // 葡萄牙语特有字符 (ã, õ 是高置信度标志)
            return 'por';
        } else if (/[ìò]/.test(text) && !/[áéíóú]/.test(text)) { // 意大利语特征字符 (ì, ò 较独特)
            return 'ita';
        } else if (/[äöüß]/.test(text)) { // 德语特有字符 (ß, ä, ö, ü)
            return 'deu';
        } else if (/\bij\b/i.test(text)) { // 荷兰语特有双字母 (ij)
            return 'nld';
        } else if (/^[\u4e00-\u9fa5\s\p{P}]+$/u.test(text)) { // 仅包含汉字、空格和标点
            return 'cmn';
        } else if (/^[a-zA-Z0-9\s\p{P}]+$/u.test(text)) { // 仅包含基础拉丁字符、数字、空格和标点
            return 'eng';
        }
        // 注意：
        // 1. 规则顺序经过精心设计，将高置信度、无歧义的规则（如韩文、日文假名）前置。
        // 2. 对于共享字符集的语言（如法语、意大利语），优先匹配其独有字符（如 œ, ì）。
        // 3. 英语和纯汉字的判断作为最后的后备规则，以覆盖最常见但特征不明显的场景。
    }

    return lang;
}

/**
 * 检测文本的语言并返回一个适用于 SpeechSynthesis 的 BCP 47 代码。
 * @param {string} text - 要检测的文本。
 * @returns {string} BCP 47 语言代码，如果无法确定则默认为 'en-US'。
 */
export function detectSpeechLang(text) {
    const lang3 = detectLang(text, { whitelist: Object.keys(LANGUAGE_CONFIG) });
    return LANGUAGE_CONFIG[lang3]?.speechCode || 'en-US'; // 如果未找到映射，则回退到英语
}

/**
 * 检测文本的语言并返回其原始代码和项目特定代码。
 * @param {string} text - 要检测的文本。
 * @param {object} [options={}] - franc 检测库的选项。
 * @returns {{rawCode: string, projectCode: string|null}} 包含原始 ISO 639-3 代码和项目代码的对象。
 */
export function detectProjectLang(text, options = {}) {
    const mergedOptions = {
        whitelist: Object.keys(LANGUAGE_CONFIG),
        ...options,
    };
    const rawCode = detectLang(text, mergedOptions);
    const projectCode = LANGUAGE_CONFIG[rawCode]?.projectCode || null;
    return { rawCode, projectCode };
}

/**
 * 根据项目语言代码获取对应的语音合成（BCP 47）代码。
 * @param {string} projectCode - 项目内部的语言代码 (例如, 'EN', 'ZH')。
 * @returns {string|null} 对应的 BCP 47 代码，如果找不到则返回 null。
 */
export function getSpeechCode(projectCode) {
    for (const key in LANGUAGE_CONFIG) {
        if (LANGUAGE_CONFIG[key].projectCode === projectCode) {
            return LANGUAGE_CONFIG[key].speechCode;
        }
    }
    return null;
}

/**
 * Escapes a string for safe insertion into HTML.
 * @param {string} unsafe - The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeHtml(unsafe = '') {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 生成一个唯一的 AI 引擎 ID。
 * @returns {string} 唯一的 ID。
 */
export function generateUniqueEngineId() {
    return `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Creates a debounced function that delays invoking `func` until after `delay` milliseconds have elapsed
 * since the last time the debounced function was invoked.
 * @param {Function} func The function to debounce.
 * @param {number} delay The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
export function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}
