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
    summarySettings: {},
    syncEnabled: false, // Whether cloud sync is enabled
};

export const AI_PROMPTS = {
    summarize: `context: {context}.
    You are an expert AI intelligence analyst. Your task is to create a structured briefing of the provided text with the following sections. The entire briefing, including the translation, must be in {targetLang}.

- **Headline:** A concise, news-style headline.
- **Core Summary:** {3-6} bullet points summarizing the main arguments and conclusions.
- **Most Surprising Insight:** One bullet point on the single most surprising or counter-intuitive finding.
- **Key Quote:** Extract one powerful sentence. If its original language differs from {targetLang}, present it in the format: "Original Quote" [Translation: "Translated Quote"].
`,
    converse: "context: {context}. You are a helpful AI assistant. Please answer the user's question concisely and accurately. The answer must be in {targetLang}.",
    suggest: "context: {context}. You are an AI conversationalist with a talent for making discussions more dynamic, insightful, and memorable. Your task is to generate three follow-up suggestions based on our conversation, ensuring each has a distinct intent. Provide them as a JSON array of strings.\n\nThe suggestions must be distinct in their purpose:\n1. One for CREATIVITY: Push the boundaries of the topic (e.g., a \"what if\" scenario, a new metaphor, an unexpected connection).\n2. One for VALUE: Focus on practical application or deeper understanding (e.g., a real-world use case, a key takeaway, a next step for learning).\n3. One for ENTERTAINMENT: Make the conversation more enjoyable (e.g., a fun fact, a related joke, a philosophical puzzle).\n\nThe suggestions must be concise, engaging, and in {targetLang}.\n\nExample: [\"What if this technology existed in the Middle Ages?\", \"What is the single most important skill to learn for this?\", \"Did you know the inventor of the Pringles can is now buried in one?\"]",
    suggestUserMessage: "很有趣。基于我们刚才的对话，给我一些建议吧。"
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
