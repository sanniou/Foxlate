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

    DEFAULT_TRANSLATION_SELECTOR: 'p, h1, h2, h3, h4, li, a, span, div, td, th, blockquote, pre, code, strong, em, b, i, small, sub, sup, dd, dt, caption, figcaption, legend, label',

};