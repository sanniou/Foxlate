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
    // 1.7.10 补齐：此前只映射 11 种语言，阿语/泰语页面「检测出语言但不在白名单」
    // → projectCode 为 null → precheck 判为「不支持」→ 整页 0 条送翻（阿语页实测 33 候选 → 0）。
    'ara': { projectCode: 'AR', speechCode: 'ar-SA' },    // 阿拉伯语
    'tha': { projectCode: 'TH', speechCode: 'th-TH' },    // 泰语
    'vie': { projectCode: 'VI', speechCode: 'vi-VN' },    // 越南语
    'hin': { projectCode: 'HI', speechCode: 'hi-IN' },    // 印地语
    'heb': { projectCode: 'HE', speechCode: 'he-IL' },    // 希伯来语
    'ell': { projectCode: 'EL', speechCode: 'el-GR' },    // 希腊语
    'tur': { projectCode: 'TR', speechCode: 'tr-TR' },    // 土耳其语
    'pol': { projectCode: 'PL', speechCode: 'pl-PL' },    // 波兰语
    'ukr': { projectCode: 'UK', speechCode: 'uk-UA' },    // 乌克兰语
    'swe': { projectCode: 'SV', speechCode: 'sv-SE' },    // 瑞典语
    'dan': { projectCode: 'DA', speechCode: 'da-DK' },    // 丹麦语
    'fin': { projectCode: 'FI', speechCode: 'fi-FI' },    // 芬兰语
    'nob': { projectCode: 'NB', speechCode: 'nb-NO' },    // 挪威语 (Bokmål)
    'hun': { projectCode: 'HU', speechCode: 'hu-HU' },    // 匈牙利语
    'ces': { projectCode: 'CS', speechCode: 'cs-CZ' },    // 捷克语
    'ron': { projectCode: 'RO', speechCode: 'ro-RO' },    // 罗马尼亚语
    'ind': { projectCode: 'ID', speechCode: 'id-ID' },    // 印尼语
    'msa': { projectCode: 'MS', speechCode: 'ms-MY' },    // 马来语
    'fas': { projectCode: 'FA', speechCode: 'fa-IR' },    // 波斯语
    'ben': { projectCode: 'BN', speechCode: 'bn-BD' },    // 孟加拉语
    'cat': { projectCode: 'CA', speechCode: 'ca-ES' },    // 加泰罗尼亚语
};

/** 受支持语言的 ISO 639-3 代码列表，用于语言检测白名单。 */
export const SUPPORTED_LANG_CODES = Object.keys(LANGUAGE_CONFIG);

const PROJECT_BY_BCP47_PRIMARY = new Map();
for (const { projectCode, speechCode } of Object.values(LANGUAGE_CONFIG)) {
    PROJECT_BY_BCP47_PRIMARY.set(speechCode.split('-')[0].toLowerCase(), projectCode);
}

/**
 * 把页面 `<html lang="...">` 的 BCP 47 值映射为项目语言代码。
 *
 * 只需要主语言子标签：`zh-CN` / `zh-TW` / `zh` 都归到 `ZH`，`en-GB` 归到 `EN`。
 * 不认识的标签返回 null（调用方自己决定要不要当真）。
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function getProjectCodeFromBcp47(value) {
    if (typeof value !== 'string') return null;
    const primary = value.trim().toLowerCase().split(/[-_]/)[0];
    if (!primary) return null;
    return PROJECT_BY_BCP47_PRIMARY.get(primary) || null;
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
