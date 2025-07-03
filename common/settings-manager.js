/**
 * @file Manages loading and validation of extension settings.
 */

// This function cannot be in a class as it needs to be globally accessible
// by different parts of the extension (background, content, options).

/**
 * Generates the full set of default pre-check rules, including internationalized names.
 * This function is called when initializing settings for the first time.
 * It combines general rules from constants with dynamically generated language-specific rules.
 * @returns {object} The complete default pre-check rules object.
 */
import '/lib/browser-polyfill.js'; 
import * as Constants from '/common/constants.js';
export function generateDefaultPrecheckRules() { 
    // Start with a deep copy of the general rules from constants.
    const defaultRules = JSON.parse(JSON.stringify(Constants.DEFAULT_PRECHECK_RULES));

    // 1. Internationalize the names of the general rules using the stable `nameKey`.
    if (defaultRules.general) {
        defaultRules.general.forEach(rule => {
            rule.name = browser.i18n.getMessage(rule.nameKey) || rule.name; // Use nameKey for i18n
            delete rule.nameKey; // Clean up the temporary key
        });
    }

    // 2. Dynamically generate and add language-specific whitelist rules.
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
 * Retrieves settings from storage, validates them against defaults, and returns a complete settings object.
 * @returns {Promise<object>} A promise that resolves to the validated settings object.
 */
export async function getValidatedSettings() {
    const { settings: storedSettings } = await browser.storage.sync.get('settings');
    const defaultSettings = JSON.parse(JSON.stringify(Constants.DEFAULT_SETTINGS));
    
    // Precheck rules need special handling due to i18n
    defaultSettings.precheckRules = generateDefaultPrecheckRules();

    if (!storedSettings) {
        return defaultSettings;
    }

    // Simple merge, assuming stored settings structure is generally correct.
    // A more robust solution could validate each field's type.
    const validatedSettings = { ...defaultSettings, ...storedSettings };

    // Deep merge for nested objects to prevent overwriting entire objects
    validatedSettings.translationSelector = {
        ...defaultSettings.translationSelector,
        ...(storedSettings.translationSelector || {})
    };
    validatedSettings.precheckRules = storedSettings.precheckRules && Object.keys(storedSettings.precheckRules).length > 0 
        ? storedSettings.precheckRules 
        : defaultSettings.precheckRules;
    
    // Ensure all top-level keys from defaultSettings exist.
    for (const key in defaultSettings) {
        if (!Object.prototype.hasOwnProperty.call(validatedSettings, key)) {
            validatedSettings[key] = defaultSettings[key];
        }
    }

    return validatedSettings;
}

/**
 * Calculates the effective settings for a given hostname by merging the validated global settings
 * with any matching domain-specific rules.
 * @param {string} [hostname] - The hostname of the current page.
 * @returns {Promise<object>} A promise that resolves to the final, effective settings object.
 */
export async function getEffectiveSettings(hostname) {
    const settings = await getValidatedSettings();
    let effectiveRule = {};
    let ruleSource = 'default'; // Start with default

    if (hostname) {
        const domainRules = settings.domainRules || {};
        // Find the most specific domain rule that matches the current hostname.
        const matchingDomain = Object.keys(domainRules)
            .filter(d => hostname.endsWith(d))
            .sort((a, b) => b.length - a.length)[0];

        if (matchingDomain) {
            const rule = domainRules[matchingDomain];
            // Ensure subdomain application is respected.
            if (rule.applyToSubdomains !== false || hostname === matchingDomain) {
                effectiveRule = rule;
                ruleSource = matchingDomain; // A domain rule is being applied
            }
        }
    }

    // Merge global settings with the specific rule. Properties in the specific rule will overwrite globals.
    const finalSettings = {
        ...settings,
        ...effectiveRule
    };

    // --- CSS Selector Logic ---
    const defaultSelector = settings.translationSelector?.default || '';
    const ruleSelector = effectiveRule.cssSelector; // Can be undefined or an empty string
    const override = effectiveRule.cssSelectorOverride || false; // Default to false

    // Case 1: Rule selector is defined and set to override.
    if (ruleSelector && override) {
        finalSettings.translationSelector = ruleSelector;
    }
    // Case 2: Rule selector is defined but not set to override.
    else if (ruleSelector && !override) {
        // Combine default and rule selectors, ensuring no leading comma.
        finalSettings.translationSelector = `${defaultSelector}, ${ruleSelector}`.replace(/^, /, '');
    }
    // Case 3: No rule selector is defined (or it's empty).
    else {
        finalSettings.translationSelector = defaultSelector;
    }

    // Add the source property to the final object
    finalSettings.source = ruleSource;

    return finalSettings;
}
