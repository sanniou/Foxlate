import * as Constants from './constants.js';
import { generateUniqueEngineId } from './ids.js';
import { normalizeGlossary } from './translation-glossary.js';
import { DEFAULT_STRATEGY_MAP } from './subtitle-strategy-manifest.js';

export function generateDefaultSettings() {
    return structuredClone(Constants.DEFAULT_SETTINGS);
}

export function generateDomainTimestamp(domain) {
    let hash = 0;
    for (let index = 0; index < domain.length; index++) {
        const charCode = domain.charCodeAt(index);
        hash = ((hash << 5) - hash) + charCode;
        hash &= hash;
    }
    return Math.abs(hash) + 1600000000000;
}

function mergeSelectors(baseSelectors, additionalSelectors) {
    const base = (baseSelectors || '').split(',').map(selector => selector.trim()).filter(Boolean);
    const additional = (additionalSelectors || '').split(',').map(selector => selector.trim()).filter(Boolean);
    return Array.from(new Set([...base, ...additional])).join(', ');
}

/**
 * 校验「导入的备份」是否真的是一份设置。
 *
 * 导入入口此前只有 `JSON.parse` 就写库：一个 `"aiEngines": "x"` 的备份会让下一次
 * `settings.aiEngines.find(...)` 直接抛 TypeError，而界面提示的是「导入成功」。
 * 这里只做形状判定与错误定位，真正的归一化仍交给 `validateSettings`。
 *
 * @param {unknown} raw `JSON.parse` 的结果
 * @returns {{ settings: object } | { error: string }}
 */
/**
 * 把「发往界面/内容脚本」的有效设置里的密钥抹掉。
 *
 * `GET_EFFECTIVE_SETTINGS` 的响应会整份发给内容脚本和 popup，而 `aiEngines[].apiKey`
 * 是明文。内容侧只需要引擎 id 与名字，popup 只需要 id/名字，谁都不需要密钥；
 * 明文密钥每注入一次就多传一次（实测设置整包 16 KB 量级），也把凭据暴露在
 * 内容脚本这个更大的攻击面里。写回路径（GET_VALIDATED_SETTINGS）不受影响。
 *
 * @param {object} settings 有效设置（可以是合并了域规则的副本）
 * @returns {object} 抹掉 `aiEngines[].apiKey` 的浅拷贝
 */
export function redactSecrets(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    if (!Array.isArray(settings.aiEngines)) return settings;

    return {
        ...settings,
        aiEngines: settings.aiEngines.map(engine => {
            if (!engine || typeof engine !== 'object') return engine;
            const { apiKey: _apiKey, ...rest } = engine;
            return rest;
        }),
    };
}

export function validateImportedSettings(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: 'not-an-object' };
    }

    // 兼容云备份导出的 `{ settings: {...} }` 外壳。
    const candidate = (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings))
        ? raw.settings
        : raw;

    if (!Array.isArray(candidate.aiEngines)) {
        return { error: 'invalid-ai-engines' };
    }
    if (candidate.domainRules !== undefined
        && (candidate.domainRules === null || typeof candidate.domainRules !== 'object' || Array.isArray(candidate.domainRules))) {
        return { error: 'invalid-domain-rules' };
    }
    if (candidate.glossary !== undefined
        && (candidate.glossary === null || typeof candidate.glossary !== 'object' || Array.isArray(candidate.glossary))) {
        return { error: 'invalid-glossary' };
    }
    if (candidate.summarySettings !== undefined
        && (candidate.summarySettings === null || typeof candidate.summarySettings !== 'object' || Array.isArray(candidate.summarySettings))) {
        return { error: 'invalid-summary-settings' };
    }

    return { settings: validateSettings(candidate) };
}

export function validateSettings(storedSettings) {
    const defaultSettings = generateDefaultSettings();
    const settingsToValidate = storedSettings ? structuredClone(storedSettings) : defaultSettings;
    const validatedSettings = { ...defaultSettings, ...settingsToValidate };

    if (validatedSettings.domainRules) {
        for (const domain in validatedSettings.domainRules) {
            const rule = validatedSettings.domainRules[domain];
            if (!rule.addedAt) {
                rule.addedAt = generateDomainTimestamp(domain);
            }
            // Normalize legacy cssSelector → canonical translationSelector (keep cssSelector for old UIs).
            if (rule.cssSelector && !rule.translationSelector) {
                rule.translationSelector = { ...rule.cssSelector };
            }
            if (rule.cssSelectorOverride !== undefined && rule.translationSelectorOverride === undefined) {
                rule.translationSelectorOverride = rule.cssSelectorOverride;
            }
            if (rule.translationSelector && !rule.cssSelector) {
                rule.cssSelector = { ...rule.translationSelector };
            }
            if (rule.translationSelectorOverride !== undefined && rule.cssSelectorOverride === undefined) {
                rule.cssSelectorOverride = rule.translationSelectorOverride;
            }
        }
    }

    const storedDefaultSelector = settingsToValidate.translationSelector?.default;
    const defaultDefaultSelector = defaultSettings.translationSelector.default;
    validatedSettings.translationSelector = settingsToValidate.translationSelector || {};
    if (typeof storedDefaultSelector === 'object' && storedDefaultSelector !== null) {
        validatedSettings.translationSelector.default = { ...defaultDefaultSelector, ...storedDefaultSelector };
    } else {
        validatedSettings.translationSelector.default = defaultDefaultSelector;
    }

    validatedSettings.glossary = normalizeGlossary(validatedSettings.glossary);
    validatedSettings.quickActionPanel = {
        enabled: validatedSettings.quickActionPanel?.enabled !== false,
        showOnSelection: validatedSettings.quickActionPanel?.showOnSelection !== false,
    };
    validatedSettings.summarySettings = {
        ...defaultSettings.summarySettings,
        ...(settingsToValidate.summarySettings || {}),
        mainBodySelector: settingsToValidate.summarySettings?.mainBodySelector
            || defaultSettings.summarySettings.mainBodySelector,
    };

    return validatedSettings;
}

/**
 * 规则域名是否覆盖该主机名。
 *
 * 必须是「相等或点边界后缀」：`endsWith` 的裸字符串比较会把 `google.com` 的规则
 * 命中到 `notgoogle.com`，也会让 `m` 这种单字母规则命中所有以 m 结尾的域名。
 */
export function isHostnameWithin(hostname, domain) {
    if (!hostname || !domain) return false;
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * 把用户输入归一化成能用于匹配的主机名。
 *
 * 用户在「域名规则」里会填 `https://Example.com/path`、`example.com:8080`、带空格或大写。
 * 原样存下来就永远匹配不上（匹配用的是 hostname）。非法输入返回 null，由调用方报错，
 * 而不是保存一条静默无效的规则。
 *
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeRuleDomain(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return null;

    // 允许「裸主机名」与「带 scheme 的 URL」两种输入。
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let hostname = '';
    try {
        hostname = new URL(withScheme).hostname.toLowerCase();
    } catch {
        return null;
    }
    if (!hostname || !hostname.includes('.')) return null;
    return hostname;
}

function findMatchingDomainRule(domainRules = {}, hostname) {
    if (!hostname) return { domainRule: {}, ruleSource: 'default' };

    const matchingDomain = Object.keys(domainRules)
        .filter(domain => isHostnameWithin(hostname, domain))
        .sort((a, b) => b.length - a.length)[0];

    if (!matchingDomain) return { domainRule: {}, ruleSource: 'default' };

    const rule = domainRules[matchingDomain];
    if (rule.applyToSubdomains !== false || hostname === matchingDomain) {
        return { domainRule: rule, ruleSource: matchingDomain };
    }

    return { domainRule: {}, ruleSource: 'default' };
}

function calculateEffectiveSubtitleSettings(hostname, domainRule = {}) {
    if (domainRule.subtitleSettings) {
        return {
            enabled: false,
            strategy: 'none',
            displayMode: 'off',
            ...domainRule.subtitleSettings,
        };
    }

    if (DEFAULT_STRATEGY_MAP.has(hostname)) {
        return {
            enabled: true,
            strategy: DEFAULT_STRATEGY_MAP.get(hostname),
            displayMode: 'off',
        };
    }

    return { enabled: false, strategy: 'none', displayMode: 'off' };
}

function calculateEffectiveSelectorSettings(globalSelector, ruleSelector, override) {
    const defaultSelector = globalSelector || { content: '', exclude: '' };
    let finalContentSelector = defaultSelector.content || '';
    let finalExcludeSelector = defaultSelector.exclude || '';

    if (ruleSelector) {
        const ruleContent = ruleSelector.content || '';
        const ruleExclude = ruleSelector.exclude || '';
        if (override) {
            finalContentSelector = ruleContent;
            finalExcludeSelector = ruleExclude;
        } else {
            finalContentSelector = mergeSelectors(finalContentSelector, ruleContent);
            finalExcludeSelector = mergeSelectors(finalExcludeSelector, ruleExclude);
        }
    }

    return { content: finalContentSelector, exclude: finalExcludeSelector };
}

/** Scalar overrides a domain rule may apply onto hostname-effective settings. */
const DOMAIN_RULE_OVERRIDE_KEYS = Object.freeze([
    'autoTranslate',
    'translatorEngine',
    'targetLanguage',
    'sourceLanguage',
    'displayMode',
]);

/**
 * Build hostname-effective settings without flattening the entire domain rule
 * (which used to clobber nested globals like aiEngines / glossary).
 */
export function resolveEffectiveSettings(settings, hostname) {
    const domainRules = settings.domainRules || {};
    const { domainRule, ruleSource } = findMatchingDomainRule(domainRules, hostname);
    const effectiveSettings = {
        ...settings,
        source: ruleSource,
    };

    for (const key of DOMAIN_RULE_OVERRIDE_KEYS) {
        if (domainRule[key] !== undefined) {
            effectiveSettings[key] = domainRule[key];
        }
    }

    for (const key of DOMAIN_RULE_OVERRIDE_KEYS) {
        if (effectiveSettings[key] === 'default') {
            effectiveSettings[key] = settings[key];
        }
    }

    effectiveSettings.subtitleSettings = calculateEffectiveSubtitleSettings(hostname, domainRule);

    // Prefer canonical translationSelector; keep cssSelector as legacy alias.
    const ruleSelector = domainRule.translationSelector || domainRule.cssSelector;
    const selectorOverride = domainRule.translationSelectorOverride
        ?? domainRule.cssSelectorOverride
        ?? false;
    effectiveSettings.translationSelector = calculateEffectiveSelectorSettings(
        settings.translationSelector?.default,
        ruleSelector,
        selectorOverride,
    );

    // Domain summarySettings (mainBodySelector / enabled / aiModel) overlay globals.
    const globalSummary = settings.summarySettings || {};
    const ruleSummary = domainRule.summarySettings || {};
    effectiveSettings.summarySettings = {
        ...globalSummary,
        ...ruleSummary,
        mainBodySelector: ruleSummary.mainBodySelector
            || globalSummary.mainBodySelector
            || Constants.DEFAULT_SUMMARY_MAIN_BODY,
    };

    return effectiveSettings;
}

export function prepareSettingsForStorage(settings) {
    const settingsToSave = structuredClone(settings);
    delete settingsToSave.source;
    return settingsToSave;
}

export function upsertAiEngine(settings, engineData, existingId = null, generateId = generateUniqueEngineId) {
    const nextSettings = structuredClone(settings);
    const engineId = existingId || generateId();
    const engineToSave = { id: engineId, ...engineData };
    const engineIndex = nextSettings.aiEngines.findIndex(engine => engine.id === engineId);

    if (engineIndex > -1) {
        nextSettings.aiEngines[engineIndex] = { ...nextSettings.aiEngines[engineIndex], ...engineToSave };
    } else {
        nextSettings.aiEngines.push({ ...engineToSave });
    }

    return nextSettings;
}

export function removeAiEngineFromSettings(settings, engineId) {
    const nextSettings = structuredClone(settings);
    nextSettings.aiEngines = nextSettings.aiEngines.filter(engine => engine.id !== engineId);

    if (nextSettings.translatorEngine === `ai:${engineId}`) {
        const firstAiEngine = nextSettings.aiEngines[0];
        nextSettings.translatorEngine = firstAiEngine ? `ai:${firstAiEngine.id}` : 'google';
    }

    return nextSettings;
}

/** Keys popup/options may write onto a domain rule (plus subtitleDisplayMode alias). */
const DOMAIN_RULE_WRITABLE_KEYS = Object.freeze([
    ...DOMAIN_RULE_OVERRIDE_KEYS,
    'cssSelector',
    'cssSelectorOverride',
    'translationSelector',
    'translationSelectorOverride',
    'applyToSubdomains',
    'subtitleSettings',
    'subtitleDisplayMode',
    'summarySettings',
]);

export function setDomainRuleProperty(settings, domain, key, value) {
    if (!DOMAIN_RULE_WRITABLE_KEYS.includes(key)) {
        console.warn(`[settings-domain] ignored non-writable domain rule key: ${key}`);
        return settings;
    }

    const nextSettings = structuredClone(settings);
    const rule = nextSettings.domainRules[domain] || {};

    if (key === 'subtitleDisplayMode') {
        if (!rule.subtitleSettings) rule.subtitleSettings = {};
        rule.subtitleSettings.enabled = true;
        rule.subtitleSettings.displayMode = value;
    } else {
        rule[key] = value;
    }

    nextSettings.domainRules[domain] = rule;
    return nextSettings;
}
