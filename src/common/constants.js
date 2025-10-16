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
    inputTranslationSettings: {
      enabled: true, // 全局启用
      triggerWord: 'fox', // 自定义触发词
      consecutiveKey: 'Space', // 连续按键的键值
      consecutiveKeyPresses: 3, // 连续按键的次数
      keyTriggerEnabled: true, // 是否启用快捷键
      blacklist: [], // 黑名单域名
      languageMapping: { // 语言别名映射
          '中文': 'ZH',
          '英文': 'EN',
          '日文': 'JA',
          '韩文': 'KO',
          '法文': 'FR',
          '德文': 'DE',
          '西班牙文': 'ES'
      }
    }
};

export const AI_PROMPTS = {
    summarize: `你是一个专业的内容分析师。请根据以下内容创建结构化摘要，必须使用 {targetLang} 语言。

上下文: {context}

请根据内容类型提供相应的摘要格式：

**新闻/文章类**:
- **标题**: 简洁的新闻式标题
- **核心摘要**: 3-6个要点，概括主要论点和结论
- **关键洞察**: 一个最令人意外或反直觉的发现
- **重要引述**: 提取一个有力的句子。如果原文语言与{targetLang}不同，请使用格式："原文引用" [翻译: "译文"]

**技术文档类**:
- **目的**: 文档的主要目标
- **关键概念**: 3-5个核心概念解释
- **实施要点**: 2-3个实际应用要点
- **注意事项**: 重要提醒或限制

**学术内容类**:
- **研究问题**: 主要探讨的问题
- **方法论**: 采用的研究方法
- **主要发现**: 2-4个关键发现
- **意义与启示**: 研究的实际或理论意义

如果内容不属于以上类型，请根据内容特点选择最合适的格式，确保摘要简洁、准确、有价值。`,
    converse: `你是一个知识渊博、乐于助人的AI助手。你的任务是：

1. 仔细分析对话历史和上下文
2. 根据用户的问题提供准确、简洁的回答
3. 确保所有回答都使用 {targetLang} 语言
4. 如果问题涉及专业领域，请提供专业但易于理解的解释
5. 当不确定答案时，诚实说明而不是提供可能错误的信息

上下文: {context}

请根据以上指导原则回答用户的问题。`,
    suggest: `你是一个创意对话伙伴，擅长让讨论更加生动、有见地且令人难忘。基于我们的对话历史，生成三个不同目的的后续建议。

上下文: {context}

要求:
1. 所有建议必须使用 {targetLang} 语言
2. 每个建议必须有明确的目的导向
3. 建议要简洁、引人入胜且可操作

建议类型分配:
1. **探索创新**: 挑战话题边界(如"假设"场景、新比喻、意外联系)
2. **实用价值**: 关注实际应用或更深理解(如真实案例、关键要点、学习步骤)
3. **增加趣味**: 让对话更有趣(如趣闻、相关笑话、哲学思考)

请直接返回JSON数组格式，不要添加任何解释文字：
["建议1", "建议2", "建议3"]

示例:
["如果这项技术存在于中世纪会怎样？", "学习这个最重要的单项技能是什么？", "你知道品客薯片发明者现在被埋在自己的发明品里吗？"]`,
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
