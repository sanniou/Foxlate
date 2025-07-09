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
import '../lib/browser-polyfill.js'; 
import * as Constants from '../common/constants.js';
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

    // --- 为 translationSelector 进行深度合并 ---
    // 这确保了新的 {inline, block} 结构得到遵守。
    const storedDefaultSelector = storedSettings.translationSelector?.default;
    const defaultDefaultSelector = defaultSettings.translationSelector.default;

    // 从存储的设置中保留所有域名规则
    validatedSettings.translationSelector = storedSettings.translationSelector || {};
    
    // 合并 'default' 属性，确保它是一个对象。
    // 如果存储的默认选择器是对象，则用它来覆盖默认值，否则使用全新的默认值。
    if (typeof storedDefaultSelector === 'object' && storedDefaultSelector !== null) {
        validatedSettings.translationSelector.default = { ...defaultDefaultSelector, ...storedDefaultSelector };
    } else {
        validatedSettings.translationSelector.default = defaultDefaultSelector;
    }
    validatedSettings.precheckRules = storedSettings.precheckRules && Object.keys(storedSettings.precheckRules).length > 0 
        ? storedSettings.precheckRules 
        : defaultSettings.precheckRules;
    
    // Ensure all top-level keys from defaultSettings exist.
    for (const key in defaultSettings) {
        if (!Object.prototype.hasOwnProperty.call(validatedSettings, key)) {
            validatedSettings[key] = defaultSettings[key];
        }
    }

    // Ensure each AI engine has the new properties
    if (validatedSettings.aiEngines && Array.isArray(validatedSettings.aiEngines)) {
        validatedSettings.aiEngines.forEach(engine => {
            if (engine.wordCountThreshold === undefined) {
                engine.wordCountThreshold = 1;
            }
            if (engine.fallbackEngine === undefined) {
                // 'default' 是一个更好的默认值，因为它代表“使用全局设置”。
                engine.fallbackEngine = 'default';
            }
        });
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
    // 默认选择器现在是一个对象 { inline, block }
    const defaultSelector = settings.translationSelector?.default || { inline: '', block: '' };
    // 规则选择器也是一个对象
    const ruleSelector = effectiveRule.cssSelector; // 可以是 undefined 或一个对象 { inline, block }
    const override = effectiveRule.cssSelectorOverride || false; // Default to false

    let finalInlineSelector = defaultSelector.inline || '';
    let finalBlockSelector = defaultSelector.block || '';

    // 如果存在域名特定选择器规则
    if (ruleSelector) {
        const ruleInline = ruleSelector.inline || '';
        const ruleBlock = ruleSelector.block || '';

        if (override) {
            // 覆盖模式：完全使用域名规则的选择器
            finalInlineSelector = ruleInline;
            finalBlockSelector = ruleBlock;
        } else {
            // 追加模式：将域名规则的选择器追加到全局选择器
            if (ruleInline) finalInlineSelector = `${finalInlineSelector}, ${ruleInline}`.replace(/^, /, '');
            if (ruleBlock) finalBlockSelector = `${finalBlockSelector}, ${ruleBlock}`.replace(/^, /, '');
        }
    }

    // 将最终计算出的选择器对象赋值给 finalSettings
    // 这会替换掉包含 .default 和域名规则的完整 translationSelector 对象
    finalSettings.translationSelector = {
        inline: finalInlineSelector,
        block: finalBlockSelector,
    };

    // Add the source property to the final object
    finalSettings.source = ruleSource;

    return finalSettings;
}
