/**
 * @file Manages loading, validation, caching, and pre-compilation of extension settings.
 */
import '../lib/browser-polyfill.js';
import * as Constants from '../common/constants.js';

// --- Module-level Cache ---
let validatedSettingsCache = null;

/**
 * Deep clones an object, correctly handling RegExp instances.
 * @param {any} obj - The object to clone.
 * @returns {any} The cloned object.
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (obj instanceof RegExp) {
        return new RegExp(obj.source, obj.flags);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item));
    }

    const clonedObj = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            clonedObj[key] = deepClone(obj[key]);
        }
    }
    return clonedObj;
}


/**
 * Invalidates the settings cache. Called when settings are changed.
 */
function invalidateCache() {
    validatedSettingsCache = null;
}

// Listen for changes in storage and invalidate the cache accordingly.
browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
        invalidateCache();
    }
});

/**
 * Pre-compiles the regex strings in the precheck rules into RegExp objects for performance.
 * @param {object} rules - The precheck rules object.
 * @returns {object} The rules object with `compiledRegex` properties added to each rule.
 */
function precompileRules(rules) {
    if (!rules) return {};
    const compiledRules = deepClone(rules); // Use the new deepClone
    for (const category in compiledRules) {
        if (Array.isArray(compiledRules[category])) {
            compiledRules[category].forEach(rule => {
                try {
                    const flags = rule.flags ? [...new Set(rule.flags + 'g')].join('') : 'g';
                    rule.compiledRegex = new RegExp(rule.regex, flags);
                } catch (e) {
                    rule.compiledRegex = null;
                    console.error(`Invalid regex for rule "${rule.name}": /${rule.regex}/${rule.flags}`, e);
                }
            });
        }
    }
    return compiledRules;
}


/**
 * Generates the full set of default pre-check rules, including internationalized names.
 * @returns {object} The complete default pre-check rules object.
 */
export function generateDefaultPrecheckRules() {
    const defaultRules = deepClone(Constants.DEFAULT_PRECHECK_RULES);
    if (defaultRules.general) {
        defaultRules.general.forEach(rule => {
            rule.name = browser.i18n.getMessage(rule.nameKey) || rule.name;
            delete rule.nameKey;
        });
    }
    for (const langCode in Constants.LANG_REGEX_MAP) {
        if (Constants.SUPPORTED_LANGUAGES[langCode]) {
            const langName = browser.i18n.getMessage(Constants.SUPPORTED_LANGUAGES[langCode]) || langCode;
            defaultRules[langCode] = [{
                name: `${browser.i18n.getMessage('precheckRuleContains') || 'Contains '} ${langName}`,
                regex: Constants.LANG_REGEX_MAP[langCode].regex,
                mode: 'whitelist',
                enabled: true,
                flags: Constants.LANG_REGEX_MAP[langCode].flags,
            }];
        }
    }
    return defaultRules;
}

/**
 * Retrieves settings from storage, validates them, pre-compiles rules, and caches the result.
 * @returns {Promise<object>} A promise that resolves to the validated and compiled settings object.
 */
export async function getValidatedSettings() {
    if (validatedSettingsCache) {
        return deepClone(validatedSettingsCache); // Use deepClone to return a safe copy
    }

    const { settings: storedSettings } = await browser.storage.sync.get('settings');
    const defaultSettings = deepClone(Constants.DEFAULT_SETTINGS);
    defaultSettings.precheckRules = generateDefaultPrecheckRules();

    let settingsToValidate = storedSettings || defaultSettings;

    const validatedSettings = { ...defaultSettings, ...settingsToValidate };

    // Deep merge for translationSelector
    const storedDefaultSelector = settingsToValidate.translationSelector?.default;
    const defaultDefaultSelector = defaultSettings.translationSelector.default;
    validatedSettings.translationSelector = settingsToValidate.translationSelector || {};
    if (typeof storedDefaultSelector === 'object' && storedDefaultSelector !== null) {
        validatedSettings.translationSelector.default = { ...defaultDefaultSelector, ...storedDefaultSelector };
    } else {
        validatedSettings.translationSelector.default = defaultDefaultSelector;
    }

    validatedSettings.precheckRules = settingsToValidate.precheckRules && Object.keys(settingsToValidate.precheckRules).length > 0
        ? settingsToValidate.precheckRules
        : defaultSettings.precheckRules;

    for (const key in defaultSettings) {
        if (!Object.prototype.hasOwnProperty.call(validatedSettings, key)) {
            validatedSettings[key] = defaultSettings[key];
        }
    }
    
    if (validatedSettings.aiEngines && Array.isArray(validatedSettings.aiEngines)) {
        validatedSettings.aiEngines.forEach(engine => {
            if (engine.wordCountThreshold === undefined) engine.wordCountThreshold = 1;
            if (engine.fallbackEngine === undefined) engine.fallbackEngine = 'default';
        });
    }

    validatedSettings.precheckRules = precompileRules(validatedSettings.precheckRules);

    validatedSettingsCache = deepClone(validatedSettings); // Cache the fully processed settings
    return validatedSettings;
}

/**
 * Calculates the effective settings for a given hostname by merging global settings with domain-specific rules.
 * @param {string} [hostname] - The hostname of the current page.
 * @returns {Promise<object>} A promise that resolves to the final, effective settings object.
 */
export async function getEffectiveSettings(hostname) {
    const settings = await getValidatedSettings();
    let effectiveRule = {};
    let ruleSource = 'default';

    if (hostname) {
        const domainRules = settings.domainRules || {};
        const matchingDomain = Object.keys(domainRules)
            .filter(d => hostname.endsWith(d))
            .sort((a, b) => b.length - a.length)[0];

        if (matchingDomain) {
            const rule = domainRules[matchingDomain];
            if (rule.applyToSubdomains !== false || hostname === matchingDomain) {
                effectiveRule = rule;
                ruleSource = matchingDomain;
            }
        }
    }

    const finalSettings = { ...settings, ...effectiveRule };

    const defaultSelector = settings.translationSelector?.default || { inline: '', block: '' };
    const ruleSelector = effectiveRule.cssSelector;
    const override = effectiveRule.cssSelectorOverride || false;

    let finalInlineSelector = defaultSelector.inline || '';
    let finalBlockSelector = defaultSelector.block || '';

    if (ruleSelector) {
        const ruleInline = ruleSelector.inline || '';
        const ruleBlock = ruleSelector.block || '';
        if (override) {
            finalInlineSelector = ruleInline;
            finalBlockSelector = ruleBlock;
        } else {
            if (ruleInline) finalInlineSelector = `${finalInlineSelector}, ${ruleInline}`.replace(/^, /, '');
            if (ruleBlock) finalBlockSelector = `${finalBlockSelector}, ${ruleBlock}`.replace(/^, /, '');
        }
    }

    finalSettings.translationSelector = {
        inline: finalInlineSelector,
        block: finalBlockSelector,
    };
    finalSettings.source = ruleSource;

    if (effectiveRule.precheckRules) {
        finalSettings.precheckRules = precompileRules(effectiveRule.precheckRules);
    }

    return finalSettings;
}

/**
 * Saves the provided settings object to storage.
 * @param {object} settings - The settings object to save.
 * @returns {Promise<void>} A promise that resolves when the settings are saved.
 */
export async function saveSettings(settings) {
    const settingsToSave = deepClone(settings);
    delete settingsToSave.source;

    if (settingsToSave.precheckRules) {
        for (const category in settingsToSave.precheckRules) {
            if (Array.isArray(settingsToSave.precheckRules[category])) {
                settingsToSave.precheckRules[category].forEach(rule => {
                    delete rule.compiledRegex;
                });
            }
        }
    }

    await browser.storage.sync.set({ settings: settingsToSave });
}