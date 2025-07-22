import browser from '../lib/browser-polyfill.js';
import * as Constants from './constants.js';
import { DEFAULT_STRATEGY_MAP } from '../content/subtitle/strategy-manifest.js';

export class SettingsManager {
    // --- Private Static State ---
    static #validatedSettingsCache = null;

    // --- Static Initialization Block ---
    // 静态初始化块，在类加载时执行一次，设置初始值。
    static {
        // Listen for changes in storage and invalidate the cache accordingly.
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.settings) {
                this.#invalidateCache();
            }
        });

    }

    // --- Public Static Methods ---


    /**
     * Deep clones an object, correctly handling RegExp instances.
     * @param {any} obj - The object to clone.
     * @returns {any} The cloned object.
     */
    static deepClone(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (obj instanceof RegExp) {
            return new RegExp(obj.source, obj.flags); // RegExp 可以被在同一个上下文中克隆
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.deepClone(item));
        }

        const clonedObj = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                clonedObj[key] = this.deepClone(obj[key]);
            }
        }
        return clonedObj;
    }

    /**
     * (私有) 使设置缓存失效，当设置更改时调用。
     */
    static #invalidateCache() {
        this.#validatedSettingsCache = null;
    }

    /**
     * 预编译 precheck 规则中的正则表达式字符串，提高性能。
     * @param {object} rules - precheck 规则对象。
     * @returns {object} 规则对象，每个规则都添加了 `compiledRegex` 属性。
     */

    static precompileRules(rules) {
        if (!rules) return {};
        const compiledRules = this.deepClone(rules);
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
     * 生成完整的默认预检规则集，包括国际化的名称。
     * @returns {object} 完整的默认预检规则对象。
     */


    static generateDefaultPrecheckRules() {
        const defaultRules = this.deepClone(Constants.DEFAULT_PRECHECK_RULES);
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
     * 从存储中检索设置，验证它们，预编译规则，并缓存结果。
     * @returns {Promise<object>} 一个 Promise，解析为已验证和编译的设置对象。
     */

    static async getValidatedSettings() {
        if (this.#validatedSettingsCache) {
            return this.deepClone(this.#validatedSettingsCache); // 使用 deepClone 返回安全副本
        }

        const { settings: storedSettings } = await browser.storage.sync.get('settings');
        const defaultSettings = this.deepClone(Constants.DEFAULT_SETTINGS);
        defaultSettings.precheckRules = this.generateDefaultPrecheckRules();

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

        // 移除预编译步骤。编译应该在消费端（content-script 或 background script）进行，
        // 以避免在跨上下文传递消息时序列化 RegExp 对象。
        // validatedSettings.precheckRules = this.precompileRules(validatedSettings.precheckRules);

        this.#validatedSettingsCache = this.deepClone(validatedSettings); // 缓存未编译但已验证的设置
        return validatedSettings;
    }

    /**
     * 为给定的主机名计算有效设置，通过合并全局设置和特定于域的规则。
     * @param {string} [hostname] - 当前页面的主机名。
     * @returns {Promise<object>} 一个 Promise，解析为最终的有效设置对象。
     */

    static async getEffectiveSettings(hostname) {
        const settings = await this.getValidatedSettings();
        const domainRules = settings.domainRules || {};
        let domainRule = {};
        let ruleSource = 'default';

        if (hostname) {
            const matchingDomain = Object.keys(domainRules)
                .filter(d => hostname.endsWith(d))
                .sort((a, b) => b.length - a.length)[0];

            if (matchingDomain) {
                const rule = domainRules[matchingDomain];
                if (rule.applyToSubdomains !== false || hostname === matchingDomain) {
                    domainRule = rule;
                    ruleSource = matchingDomain;
                }
            }
        }

        // Start with global settings as the base and merge the domain rule
        const effectiveSettings = { ...settings, ...domainRule, source: ruleSource };

        // --- Subtitle Logic ---
        if (domainRule.subtitleSettings) {
            // Case 1: User has defined subtitle settings for this domain. Merge with defaults to ensure all properties exist.
            effectiveSettings.subtitleSettings = {
                enabled: false, strategy: 'none', displayMode: 'off', ...domainRule.subtitleSettings
            };
        } else if (DEFAULT_STRATEGY_MAP.has(hostname)) {
            // Case 2: No user rule, but a default strategy exists. Enable by default for injection.
            effectiveSettings.subtitleSettings = {
                enabled: true,
                strategy: DEFAULT_STRATEGY_MAP.get(hostname),
                displayMode: 'off' // Hide by default, user can enable it in popup
            };
        } else {
            // Case 3: No user rule and no default strategy.
            effectiveSettings.subtitleSettings = { enabled: false, strategy: 'none', displayMode: 'off' };
        }

        const defaultSelector = settings.translationSelector?.default || { inline: '', block: '', exclude: '' };
        const ruleSelector = domainRule.cssSelector;
        const override = domainRule.cssSelectorOverride || false;

        let finalInlineSelector = defaultSelector.inline || '';
        let finalBlockSelector = defaultSelector.block || '';
        let finalExcludeSelector = defaultSelector.exclude || '';

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

        effectiveSettings.translationSelector = {
            inline: finalInlineSelector,
            block: finalBlockSelector,
        };

        // 如果存在特定于域的预检查规则，则使用它们，否则使用全局规则。
        // 注意：编译步骤已从此函数中移除，应由调用者处理。
        if (domainRule.precheckRules) {
            effectiveSettings.precheckRules = domainRule.precheckRules;
        }
        return effectiveSettings;
    }

    /**
     * 将提供的设置对象保存到存储中。
     * @param {object} settings - 要保存的设置对象。
     * @returns {Promise<void>} 一个 Promise，在设置保存时解析。
     */


    static async saveSettings(settings) {
        const settingsToSave = this.deepClone(settings);
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
}