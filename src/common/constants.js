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
        { nameKey: 'precheckRuleEmoji', name: 'Single Emoji', regex: '^\\p{Emoji}$', mode: 'blacklist', enabled: true, flags: 'u' },        
        { nameKey: 'precheckRuleSingleWord', name: 'Single English Letter', regex: '^[A-Za-z]$', mode: 'blacklist', enabled: true, flags: '' },        
        { nameKey: 'precheckRuleEmail', name: 'Email Address', regex: '\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b', mode: 'blacklist', enabled: true, flags: 'gi' },
        { nameKey: 'precheckRuleUrl', name: 'URL', regex: '^\\w+://\\S+$', mode: 'blacklist', enabled: true, flags: 'gi' },
        { nameKey: 'precheckRuleAcronymsGeneral', name: 'General Acronyms', regex: '(?<![a-zA-Z])(OK|DIY|FAQ|ID|PIN|SIM|SMS|TV|ASAP|AKA|FYI|etc|vs|am|pm)(?![a-zA-Z])', mode: 'blacklist', enabled: true, flags: 'gi' },
        { nameKey: 'precheckRuleAcronymsTech', name: 'Tech Acronyms', regex: '(?<![a-zA-Z])(AI|CPU|GPU|API|URL|HTTP|HTTPS|PDF|HTML|CSS|JS|JSON|XML|SQL|RAM|ROM|OS|PC|USB|WIFI|GPS|ICP)(?![a-zA-Z])', mode: 'blacklist', enabled: true, flags: 'gi' },
        { nameKey: 'precheckRuleAcronymsBusiness', name: 'Business Acronyms', regex: '(?<![a-zA-Z])(CEO|CFO|CTO|HR|PR|AD|VIP|B2B|B2C|ROI|KPI)(?![a-zA-Z])', mode: 'blacklist', enabled: true, flags: 'gi' },
        { nameKey: 'precheckRuleAcronymsGov', name: 'Government & Org Acronyms', regex: '(?<![a-zA-Z])(WHO|CN|NASA|FBI|CIA|UFO|UN|EU|NATO)(?![a-zA-Z])', mode: 'blacklist', enabled: true, flags: 'gi' },
    ],
};

export const DEFAULT_SETTINGS = {
    translatorEngine: 'google',
    targetLanguage: 'ZH',
    displayMode: 'append',
    deeplxApiUrl: '',
    translationSelector: {
        default: {
            // 用于标题、按钮、标签等短文本。译文将合并为单行显示。
            inline: 'h1, h2, h3, h4, h5, h6, a, span, strong, em, b, i, small, sub, sup, label, button, [role="button"], [role="link"], [role="tab"]',
            // 用于段落、文章等主要内容。译文将保留原有换行。
            block: 'p, div, li, td, th, blockquote, pre, dd, dt, caption, figcaption, article, section'
        }
    },
    aiEngines: [],
    domainRules: {},
    precheckRules: {} // Populated dynamically in options.js to handle i18n
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
