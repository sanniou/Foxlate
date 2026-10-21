/**
 * 语言配置表 —— 纯数据，不依赖任何语言检测库。
 *
 * 键是 franc 返回的 ISO 639-3 语言代码。
 * 值包含项目内部代码和用于 Web Speech API 的 BCP 47 代码。
 *
 * 本模块必须保持零依赖：`getSpeechCode` 被 content 的热路径与 options 引用，
 * 一旦这里引入 franc（约 240 KB），每个引用的产物都会被迫打包整个语言检测库。
 * 需要 franc 的检测函数在 `lang-detect.js`。
 *
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

/** 受支持语言的 ISO 639-3 代码列表，用于语言检测白名单。 */
export const SUPPORTED_LANG_CODES = Object.keys(LANGUAGE_CONFIG);

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
