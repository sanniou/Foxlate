import * as Constants from './constants.js';
import { generateUniqueEngineId } from './utils.js';
import { normalizeGlossary } from './translation-glossary.js';
import { DEFAULT_STRATEGY_MAP } from '../content/subtitle/strategy-manifest.js';

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

export function mergeSelectors(baseSelectors, additionalSelectors) {
    const base = (baseSelectors || '').split(',').map(selector => selector.trim()).filter(Boolean);
    const additional = (additionalSelectors || '').split(',').map(selector => selector.trim()).filter(Boolean);
    return Array.from(new Set([...base, ...additional])).join(', ');
}

export function validateSettings(storedSettings) {
    const defaultSettings = generateDefaultSettings();
    const settingsToValidate = storedSettings ? structuredClone(storedSettings) : defaultSettings;
    const validatedSettings = { ...defaultSettings, ...settingsToValidate };

    if (validatedSettings.domainRules) {
        for (const domain in validatedSettings.domainRules) {
            if (!validatedSettings.domainRules[domain].addedAt) {
                validatedSettings.domainRules[domain].addedAt = generateDomainTimestamp(domain);
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

    return validatedSettings;
}

export function findMatchingDomainRule(domainRules = {}, hostname) {
    if (!hostname) return { domainRule: {}, ruleSource: 'default' };

    const matchingDomain = Object.keys(domainRules)
        .filter(domain => hostname.endsWith(domain))
        .sort((a, b) => b.length - a.length)[0];

    if (!matchingDomain) return { domainRule: {}, ruleSource: 'default' };

    const rule = domainRules[matchingDomain];
    if (rule.applyToSubdomains !== false || hostname === matchingDomain) {
        return { domainRule: rule, ruleSource: matchingDomain };
    }

    return { domainRule: {}, ruleSource: 'default' };
}

export function calculateEffectiveSubtitleSettings(hostname, domainRule = {}) {
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

export function calculateEffectiveSelectorSettings(globalSelector, ruleSelector, override) {
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
export const DOMAIN_RULE_OVERRIDE_KEYS = Object.freeze([
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
export const DOMAIN_RULE_WRITABLE_KEYS = Object.freeze([
    ...DOMAIN_RULE_OVERRIDE_KEYS,
    'cssSelector',
    'cssSelectorOverride',
    'translationSelector',
    'translationSelectorOverride',
    'applyToSubdomains',
    'subtitleSettings',
    'subtitleDisplayMode',
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
