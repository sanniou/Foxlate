/**
 * @file Centralized constants for the extension.
 * This script attaches a `Constants` object to the global `window` object.
 */

window.Constants = {
    SUPPORTED_LANGUAGES: {
        'auto': 'langAuto',
        'EN': 'langEN',
        'ZH': 'langZH',
        'JA': 'langJA',
        'KO': 'langKO',
        'FR': 'langFR',
        'DE': 'langDE',
        'ES': 'langES',
        'RU': 'langRU'
    },

    SUPPORTED_ENGINES: {
        'deeplx': 'deeplx',
        'google': 'googleTranslate'
    },

    // Maps language codes to their corresponding script regex for pre-check rules.
    LANG_REGEX_MAP: {
        'ZH': { regex: '\\p{Script=Han}', flags: 'u' },
        'EN': { regex: '[a-zA-Z]', flags: '' },
        'JA': { regex: '[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}]', flags: 'u' },
        'KO': { regex: '\\p{Script=Hangul}', flags: 'u' },
        'FR': { regex: '[a-zA-Z]', flags: '' },
        'DE': { regex: '[a-zA-Z]', flags: '' },
        'ES': { regex: '[a-zA-Z]', flags: '' },
        'RU': { regex: '\\p{Script=Cyrillic}', flags: 'u' },
    },
    
   DEFAULT_PRECHECK_RULES: {
        general: [
            { nameKey: 'precheckRuleWhitespace', name: 'Whitespace only', regex: '^\\s*$', mode: 'blacklist', enabled: true, flags: '' }, // Matches text that is only whitespace.
            { nameKey: 'precheckRulePunctuation', name: 'Numbers, Punctuation, Symbols', regex: '^[\\d\\s\\p{P}\\p{S}]+$', mode: 'blacklist', enabled: true, flags: 'u' }, // Matches text that is only numbers, punctuation, and symbols.
            { nameKey: 'precheckRuleEmoji', name: 'Single Emoji', regex: '^\\p{Emoji}$', mode: 'blacklist', enabled: true, flags: 'u' }, // Matches a single emoji character.
            { nameKey: 'precheckRuleSingleWord', name: 'Single English Letter', regex: '^[A-Za-z]$', mode: 'blacklist', enabled: true, flags: '' }, // Matches a single English letter.
            // The original 'Common Acronyms' rule is now split into categories below for better management.
            { nameKey: 'precheckRuleAcronymsGeneral', name: 'General Acronyms', regex: '^\\b(OK|DIY|FAQ|ID|PIN|SIM|SMS|TV|ASAP|AKA|FYI)\\b$', mode: 'blacklist', enabled: true, flags: 'i' }, // Matches common general-purpose acronyms.
            { nameKey: 'precheckRuleAcronymsTech', name: 'Tech Acronyms', regex: '^\\b(AI|CPU|GPU|API|URL|HTTP|HTTPS|PDF|HTML|CSS|JS|JSON|XML|SQL|RAM|ROM|OS|PC|USB|WIFI|GPS|ICP)\\b$', mode: 'blacklist', enabled: true, flags: 'i' }, // Matches common technology and computing acronyms.
            { nameKey: 'precheckRuleAcronymsBusiness', name: 'Business Acronyms', regex: '^\\b(CEO|CFO|CTO|HR|PR|AD|VIP|B2B|B2C|ROI|KPI)\\b$', mode: 'blacklist', enabled: true, flags: 'i' }, // Matches common business-related acronyms.
            { nameKey: 'precheckRuleAcronymsGov', name: 'Government & Org Acronyms', regex: '^\\b(WHO|CN|NASA|FBI|CIA|UFO|UN|EU|NATO)\\b$', mode: 'blacklist', enabled: true, flags: 'i' }, // Matches acronyms for governments and organizations.
        ],
    },

    DEFAULT_TRANSLATION_SELECTOR: 'p, h1, h2, h3, h4, li, a, span, div, td, th, blockquote, pre, code, strong, em, b, i, small, sub, sup, dd, dt, caption, figcaption, legend, label',

    DEFAULT_SETTINGS: {
        translatorEngine: 'deeplx',
        targetLanguage: 'ZH',
        displayMode: 'replace',
        deeplxApiUrl: '',
        translationSelector: {
            default: 'p, h1, h2, h3, h4, li, a, span, div, td, th, blockquote, pre, code, strong, em, b, i, small, sub, sup, dd, dt, caption, figcaption, legend, label',
        },
        aiEngines: [],
        domainRules: {},
        precheckRules: {} // Populated dynamically in options.js to handle i18n
    }
};