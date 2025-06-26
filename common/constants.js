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
        'google': 'googleTranslate',
        'ai': 'aiTranslator'
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
            { nameKey: 'precheckRulePunctuation', name: 'Numbers, Punctuation, Symbols', regex: '^[\\d\\s\\p{P}\\p{S}]+$', mode: 'blacklist', enabled: true, flags: 'u' }, // Matches text that is only numbers, punctuation, and symbols. (Removed comma from regex as it's already covered by \p{P})
            { nameKey: 'precheckRuleEmoji', name: 'Single Emoji', regex: '^\\p{Emoji}$', mode: 'blacklist', enabled: true, flags: 'u' }, // Matches a single emoji character.
            { nameKey: 'precheckRuleSingleWord', name: 'Single English Letter', regex: '^[A-Za-z]$', mode: 'blacklist', enabled: true, flags: '' }, // Matches a single English letter.
            { nameKey: 'precheckRuleCommonAcronyms', name: 'Common Acronyms', regex: '^\\b(AI|WHO|CN|CPU|GPU|API|URL|HTTP|HTTPS|NASA|FBI|CIA|UFO|DIY|FAQ|PDF|HTML|CSS|JS|JSON|XML|SQL|RAM|ROM|OS|PC|USB|WIFI|GPS|CEO|CFO|CTO|HR|PR|AD|ID|PIN|SIM|SMS|TV|VIP|OK)\\b$', mode: 'blacklist', enabled: true, flags: 'i' }, // Matches common acronyms and initialisms.
        ],
    },

    DEFAULT_TRANSLATION_SELECTOR: 'p, h1, h2, h3, h4, li, a, span, div, td, th, blockquote, pre, code, strong, em, b, i, small, sub, sup, dd, dt, caption, figcaption, legend, label',

};