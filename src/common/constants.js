export const SUPPORTED_LANGUAGES = {
    'auto': 'langAuto',
    'EN': 'langEN',
    'ZH': 'langZH',
    'JA': 'langJA',
    'KO': 'langKO',
    'FR': 'langFR',
    'DE': 'langDE',
    'ES': 'langES',
    'RU': 'langRU'
};

// --- DOMWalker Tag Definitions ---
// Tags that should be completely skipped during DOM traversal.
export const SKIPPED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
    'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'SVG',
    'SLOT', 'HR' // SLOT and HR do not contain translatable content.
]);

export const SUPPORTED_ENGINES = {
    'google': 'googleTranslate',
    'deeplx': 'deeplx',
};

// Maps language codes to their corresponding script regex for pre-check rules.
export const LANG_REGEX_MAP = {
    'ZH': { regex: '\\p{Script=Han}', flags: 'u' },
    'EN': { regex: '[a-zA-Z]', flags: '' },
    'JA': { regex: '[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}]', flags: 'u' },
    'KO': { regex: '\\p{Script=Hangul}', flags: 'u' },
    'FR': { regex: '[a-zA-Z]', flags: '' },
    'DE': { regex: '[a-zA-Z]', flags: '' },
    'ES': { regex: '[a-zA-Z]', flags: '' },
    'RU': { regex: '\\p{Script=Cyrillic}', flags: 'u' },
};

export const DEFAULT_PRECHECK_RULES = {
    general: [
        { nameKey: 'precheckRuleWhitespace', name: 'Whitespace only', regex: '^\\s*$', mode: 'blacklist', enabled: true, flags: '' },
        { nameKey: 'precheckRulePunctuation', name: 'Numbers, Punctuation, Symbols', regex: '^[\\d\\s\\p{P}\\p{S}]+$', mode: 'blacklist', enabled: true, flags: 'u' },
        { nameKey: 'precheckRuleEmoji', name: 'Single Emoji', regex: '^\\p{Extended_Pictographic}$', mode: 'blacklist', enabled: true, flags: 'u' },
        { nameKey: 'precheckRuleSingleWord', name: 'Single English Letter', regex: '^[A-Za-z]$', mode: 'blacklist', enabled: true, flags: '' },        
        { nameKey: 'precheckRuleEmail', name: 'Email Address', regex: '\\b[\\w.%+-]+@[\\w.-]+\\.[a-zA-Z]{2,}\\b', mode: 'blacklist', enabled: true, flags: 'i' },
        { nameKey: 'precheckRuleUrl', name: 'URL', regex: '^(https?|ftp)://[\\w\\-]+(\\.[\\w\\-]+)+([\\w\\-\\.,@?^=%&:/~\\+#]*[\\w\\-\\@?^=%&/~\\+#])?$', mode: 'blacklist', enabled: true, flags: 'i' },
        { nameKey: 'precheckRuleAcronymsGeneral', name: 'General Acronyms', regex: '\\b(OK|DIY|FAQ|ID|PIN|SIM|SMS|TV|ASAP|AKA|FYI|etc|vs|am|pm)\\b', mode: 'blacklist', enabled: true, flags: 'i' },
        { nameKey: 'precheckRuleAcronymsTech', name: 'Tech Acronyms', regex: '\\b(AI|CPU|GPU|API|URL|HTTP|HTTPS|PDF|HTML|CSS|JS|JSON|XML|SQL|RAM|ROM|OS|PC|USB|WIFI|GPS|ICP)\\b', mode: 'blacklist', enabled: true, flags: 'i' },
        { nameKey: 'precheckRuleAcronymsBusiness', name: 'Business Acronyms', regex: '\\b(CEO|CFO|CTO|HR|PR|AD|VIP|B2B|B2C|ROI|KPI)\\b', mode: 'blacklist', enabled: true, flags: 'i' },
        { nameKey: 'precheckRuleAcronymsGov', name: 'Government & Org Acronyms', regex: '\\b(WHO|CN|NASA|FBI|CIA|UFO|UN|EU|NATO)\\b', mode: 'blacklist', enabled: true, flags: 'i' },
    ],
};

export const DEFAULT_SETTINGS = {
    translatorEngine: 'google',
    targetLanguage: 'ZH',
    displayMode: 'append',
    deeplxApiUrl: '',
    translationSelector: {
        default: {
            // 用于匹配需要翻译的页面元素。
            content: 'h1, h2, h3, h4, h5, h6, label, button, [role="tab"], [role="link"], p, div, li, td, th, blockquote, pre, dd, dt, caption, figcaption, article, section',
            exclude: 'pre, kbd, samp' // 新增：全局排除选择器
        }
    },
    aiEngines: [],
    domainRules: {},
    precheckRules: {}, // Populated dynamically in options.js to handle i18n
    cacheSize: 5000, // Number of translation items to cache
    parallelRequests: 5, // Number of parallel translation requests
    summarySettings: { charThreshold: 150 },
};

export const AI_PROMPTS = {
    summarize: "You are a text summarization expert. Please summarize the following text into concise, easy-to-understand bullet points. The summary must be in {targetLang}.",
    converse: "You are a helpful AI assistant. Please answer the user's question concisely and accurately. The answer must be in {targetLang}.",
    suggest: "You are an AI assistant designed to suggest follow-up questions or actions based on the current conversation history. Provide three distinct, concise suggestions as a JSON array of strings. Each suggestion should be a question or a short command. The suggestions must be in {targetLang}. Example: [\"What is the main idea?\", \"Tell me more about X.\", \"Summarize this.\"], must as plain text format."
};

export const DISPLAY_MODES = {
    'replace': {
        optionsKey: 'replaceOriginal',
        popupKey: 'popupDisplayModeReplace'
    },
    'append': {
        optionsKey: 'appendTranslated',
        popupKey: 'popupDisplayModeAppend'
    },
    'hover': {
        optionsKey: 'hoverToDisplay',
        popupKey: 'popupDisplayModeHover'
    }
};

export const AUTO_TRANSLATE_MODES = {
    'always': 'alwaysTranslate',
    'manual': 'manualTranslate'
};

export const SUBTITLE_DISPLAY_MODES = {
    'off': 'subtitleDisplayModeOff', // 关闭 (注入但不显示)
    'translated': 'subtitleDisplayModeTranslated', // 仅译文
    'bilingual': 'subtitleDisplayModeBilingual' // 双语
};

export const DISPLAY_MANAGER_STATES = {
    ORIGINAL: 'original',
    LOADING: 'loading',
    TRANSLATED: 'translated',
    ERROR: 'error',
};
