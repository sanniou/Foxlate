import browser from '../lib/browser-polyfill.js';
import * as Constants from './constants.js';
import { DEFAULT_STRATEGY_MAP } from '../content/subtitle/strategy-manifest.js';

export class SettingsManager {
    // --- Private Static State ---  
    static #validatedSettingsCache = null;

    static #effectiveSettingsCache = new Map();

    //缓存默认预检规则
    static #defaultPrecheckRules = null;

    // --- Static Initialization Block ---
    // 静态初始化块，在类加载时执行一次，设置初始值。
    static {
        // Listen for changes in storage and invalidate the cache accordingly.
        browser.storage.onChanged.addListener((changes, area) => {
            // 使用类名直接访问静态成员，可以完全避免 `this` 上下文可能引发的混淆或错误，
            // 尤其是在事件监听器的回调函数和静态块中。
            if (area === 'sync' && changes.settings) {
                SettingsManager.#invalidateCache();
                SettingsManager.#effectiveSettingsCache.clear(); //设置变更时清除缓存
            }
        });

        // 直接使用类名进行初始化，以确保在任何环境下都能正确工作。
        SettingsManager.#defaultPrecheckRules = SettingsManager.generateDefaultPrecheckRules();
    }

    // --- Public Static Methods ---

    /**
     * @private
     * (新) 智能地合并两个逗号分隔的选择器字符串，同时移除重复项和多余的空格。
     * @param {string} baseSelectors - 基础选择器字符串（例如，全局规则）。
     * @param {string} additionalSelectors - 要添加的选择器字符串（例如，域名规则）。
     * @returns {string} 一个干净、无重复的合并后选择器字符串。
     */
    static #mergeSelectors(baseSelectors, additionalSelectors) {
        const base = (baseSelectors || '').split(',').map(s => s.trim()).filter(Boolean);
        const additional = (additionalSelectors || '').split(',').map(s => s.trim()).filter(Boolean);
        // 使用 Set 自动处理重复项
        const combined = new Set([...base, ...additional]);
        return Array.from(combined).join(', ');
    }


    /**
     * (私有) 使设置缓存失效，当设置更改时调用。
     */
    static #invalidateCache() {
        SettingsManager.#validatedSettingsCache = null;
    }

    /**
     * 预编译 precheck 规则中的正则表达式字符串，提高性能。
     * @param {object} rules - precheck 规则对象。
     * @returns {object} 规则对象，每个规则都添加了 `compiledRegex` 属性。
     */

    static precompileRules(rules) {
        if (!rules) return {};
        const compiledRules = structuredClone(rules);
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
        const defaultRules = structuredClone(Constants.DEFAULT_PRECHECK_RULES);
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
        if (SettingsManager.#validatedSettingsCache) {
            return structuredClone(SettingsManager.#validatedSettingsCache); // 使用 structuredClone 返回安全副本
        }

        const { settings: storedSettings } = await browser.storage.sync.get('settings');
        const defaultSettings = structuredClone(Constants.DEFAULT_SETTINGS);
        defaultSettings.precheckRules = SettingsManager.generateDefaultPrecheckRules();

        const settingsToValidate = storedSettings || defaultSettings;

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

        if (validatedSettings.aiEngines && Array.isArray(validatedSettings.aiEngines)) {
            validatedSettings.aiEngines.forEach(engine => {
                if (engine.wordCountThreshold === undefined) engine.wordCountThreshold = 1;
                if (engine.fallbackEngine === undefined) engine.fallbackEngine = 'default';
            });
        }

        // 移除预编译步骤。编译应该在消费端（content-script 或 background script）进行，
        // 以避免在跨上下文传递消息时序列化 RegExp 对象。
        // validatedSettings.precheckRules = this.precompileRules(validatedSettings.precheckRules);

        SettingsManager.#validatedSettingsCache = structuredClone(validatedSettings); // 缓存未编译但已验证的设置
        return validatedSettings;
    }

    /**
     * @private
     * 根据全局设置、域名规则和默认策略，计算最终生效的字幕设置。
     * @param {string} hostname - 当前页面的主机名。
     * @param {object} domainRule - 匹配到的域名规则。
     * @returns {object} 最终的字幕设置对象。
     */
    static #calculateEffectiveSubtitleSettings(hostname, domainRule) {
        if (domainRule.subtitleSettings) {
            // 情况 1: 用户为此域名定义了字幕设置。与默认值合并以确保所有属性都存在。
            return {
                enabled: false, strategy: 'none', displayMode: 'off', ...domainRule.subtitleSettings
            };
        } else if (DEFAULT_STRATEGY_MAP.has(hostname)) {
            // 情况 2: 没有用户规则，但存在默认策略。默认启用注入。
            return {
                enabled: true,
                strategy: DEFAULT_STRATEGY_MAP.get(hostname),
                displayMode: 'off' // 默认隐藏，用户可以在弹出窗口中启用它
            };
        } else {
            // 情况 3: 没有用户规则，也没有默认策略。
            return { enabled: false, strategy: 'none', displayMode: 'off' };
        }
    }

    /**
     * @private
     * 根据全局设置和域名规则，计算最终生效的 CSS 选择器。
     * @param {object} globalSelector - 全局的选择器设置。
     * @param {object} ruleSelector - 域名规则中的选择器设置。
     * @param {boolean} override - 是否覆盖而不是合并选择器。
     * @returns {object} 最终的选择器对象 { inline, block, exclude }。
     */
    static #calculateEffectiveSelectorSettings(globalSelector, ruleSelector, override) {
        const defaultSelector = globalSelector || { inline: '', block: '', exclude: '' };

        let finalInlineSelector = defaultSelector.inline || '';
        let finalBlockSelector = defaultSelector.block || '';
        let finalExcludeSelector = defaultSelector.exclude || '';

        if (ruleSelector) {
            const ruleInline = ruleSelector.inline || '';
            const ruleBlock = ruleSelector.block || '';
            const ruleExclude = ruleSelector.exclude || '';
            if (override) {
                finalInlineSelector = ruleInline;
                finalBlockSelector = ruleBlock;
                finalExcludeSelector = ruleExclude;
            } else {
                finalInlineSelector = SettingsManager.#mergeSelectors(finalInlineSelector, ruleInline);
                finalBlockSelector = SettingsManager.#mergeSelectors(finalBlockSelector, ruleBlock);
                finalExcludeSelector = SettingsManager.#mergeSelectors(finalExcludeSelector, ruleExclude);
            }
        }

        return { inline: finalInlineSelector, block: finalBlockSelector, exclude: finalExcludeSelector };
    }

    /**
     * 为给定的主机名计算有效设置，通过合并全局设置和特定于域的规则。
     * @param {string} [hostname] - 当前页面的主机名。
     * @returns {Promise<object>} 一个 Promise，解析为最终的有效设置对象。
     */

    static async getEffectiveSettings(hostname) {
        if (SettingsManager.#effectiveSettingsCache.has(hostname)) {
            return structuredClone(SettingsManager.#effectiveSettingsCache.get(hostname));
        }

        const settings = await SettingsManager.getValidatedSettings();

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

        // --- 字幕和选择器逻辑 (已重构) ---
        effectiveSettings.subtitleSettings = SettingsManager.#calculateEffectiveSubtitleSettings(hostname, domainRule);

        effectiveSettings.translationSelector = SettingsManager.#calculateEffectiveSelectorSettings(
            settings.translationSelector?.default,
            domainRule.cssSelector,
            domainRule.cssSelectorOverride || false
        );

        // 如果存在特定于域的预检查规则，则使用它们，否则使用全局规则。
        // 注意：编译步骤已从此函数中移除，应由调用者处理。
        if (domainRule.precheckRules) {
            effectiveSettings.precheckRules = domainRule.precheckRules;
        }
        else {
            effectiveSettings.precheckRules = SettingsManager.#defaultPrecheckRules;
        }

        const compiledSettings = SettingsManager.precompileRules(effectiveSettings.precheckRules);
        effectiveSettings.precheckRules = compiledSettings;

        SettingsManager.#effectiveSettingsCache.set(hostname, structuredClone(effectiveSettings));
        return effectiveSettings;
    }

    /**
     * 将提供的设置对象保存到存储中。
     * @param {object} settings - 要保存的设置对象。
     */
    static async saveSettings(settings) {
        const settingsToSave = structuredClone(settings);
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

    /**
     * 清除 effectiveSettingsCache
     */
    static clearCache() {
        SettingsManager.#effectiveSettingsCache.clear();
    }
}