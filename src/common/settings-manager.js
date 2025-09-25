import browser from '../lib/browser-polyfill.js';
import * as Constants from './constants.js';
import { generateUniqueEngineId } from './utils.js';
import { DEFAULT_STRATEGY_MAP } from '../content/subtitle/strategy-manifest.js';

export class SettingsManager {
    // --- Private Static State ---  
    static #validatedSettingsCache = null;

    static #effectiveSettingsCache = new Map();

    //缓存默认预检规则
    static #defaultPrecheckRules = null;

    // --- (新) 事件监听器 ---
    static #listeners = new Map();

    // --- Static Initialization Block ---
    // 静态初始化块，在类加载时执行一次，设置初始值。
    static {
        // Listen for changes in storage and invalidate the cache accordingly.
        browser.storage.onChanged.addListener(async (changes, area) => {
            // 使用类名直接访问静态成员，可以完全避免 `this` 上下文可能引发的混淆或错误，
            // 尤其是在事件监听器的回调函数和静态块中。
            if ((area === 'sync' && changes.settings) || (area === 'local' && changes.localAiEngines)) {
                // (已修改) 直接传递新旧值
                await SettingsManager.notifySettingsChanged(changes.settings?.newValue, changes.settings?.oldValue);
            }
        });

        // 直接使用类名进行初始化，以确保在任何环境下都能正确工作。
        SettingsManager.#defaultPrecheckRules = SettingsManager.generateDefaultPrecheckRules();
    }

    /**
     * (新) 通知所有订阅者设置已更改。
     * 会使缓存失效，然后获取最新设置并发出事件。
     */
    static async notifySettingsChanged(newValue, oldValue) {
        SettingsManager.#invalidateCache();
        SettingsManager.#effectiveSettingsCache.clear(); // (已修复) 确保在任何设置变更时都清除域名规则缓存
        // 如果 newValue 未定义 (例如，在清除设置时)，则重新获取。
        // getValidatedSettings 内部有缓存，所以如果缓存有效，这里不会有额外开销。
        const finalNewValue = newValue ? await SettingsManager.getValidatedSettings() : SettingsManager.generateDefaultSettings();
        SettingsManager.#emit('settingsChanged', {
            newValue: finalNewValue,
            oldValue: oldValue
        });
    }

    // --- Public Static Methods ---


    /**
     * (新) 注册一个事件监听器。
     * @param {string} eventName - 事件名称 (例如, 'settingsChanged').
     * @param {Function} callback - 当事件触发时调用的回调函数。
     */
    static on(eventName, callback) {
        if (!SettingsManager.#listeners.has(eventName)) {
            SettingsManager.#listeners.set(eventName, []);
        }
        SettingsManager.#listeners.get(eventName).push(callback);
    }

    /**
     * (新) 注销一个事件监听器。
     * @param {string} eventName - 事件名称。
     * @param {Function} callback - 要移除的回调函数。
     */
    static off(eventName, callback) {
        if (SettingsManager.#listeners.has(eventName)) {
            const callbacks = SettingsManager.#listeners.get(eventName);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * (新) 触发一个事件。
     * @private
     * @param {string} eventName - 事件名称。
     * @param {*} data - 传递给回调函数的数据。
     */
    static #emit(eventName, data) {
        if (SettingsManager.#listeners.has(eventName)) {
            SettingsManager.#listeners.get(eventName).forEach(callback => callback(data));
        }
    }

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
     * (新) 生成一个完整的默认设置对象，包括动态生成的预检规则。
     * @returns {object} 默认设置对象。
     */
    static generateDefaultSettings() {
        const defaultSettings = structuredClone(Constants.DEFAULT_SETTINGS);
        defaultSettings.precheckRules = SettingsManager.generateDefaultPrecheckRules();
        return defaultSettings;
    }

    /**
     * 从存储中检索设置，验证它们，预编译规则，并缓存结果。
     * @returns {Promise<object>} 一个 Promise，解析为已验证和编译的设置对象。
     */

    static async getValidatedSettings() {
        if (SettingsManager.#validatedSettingsCache) {
            return structuredClone(SettingsManager.#validatedSettingsCache); // 使用 structuredClone 返回安全副本
        }

        // 并行获取 sync 和 local 的数据
        const [syncData, localData] = await Promise.all([
            browser.storage.sync.get('settings'),
            browser.storage.local.get('localAiEngines')
        ]);

        const { settings: storedSettings } = syncData;
        const localAiEngines = localData.localAiEngines || [];

        const defaultSettings = SettingsManager.generateDefaultSettings();

        const settingsToValidate = storedSettings || defaultSettings;

        const validatedSettings = { ...defaultSettings, ...settingsToValidate };

        // --- (新) 合并 AI 引擎 ---
        const syncedEngines = validatedSettings.aiEngines || [];
        syncedEngines.forEach(engine => engine.syncStatus = 'synced');

        const localEnginesWithStatus = localAiEngines.map(engine => ({ ...engine, syncStatus: 'local' }));

        // 合并，并确保 local 中的引擎不会覆盖 sync 中的同 ID 引擎
        const syncedEngineIds = new Set(syncedEngines.map(e => e.id));
        const uniqueLocalEngines = localEnginesWithStatus.filter(e => !syncedEngineIds.has(e.id));

        validatedSettings.aiEngines = [...syncedEngines, ...uniqueLocalEngines];

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
        // 默认选择器现在只包含 content 和 exclude
        const defaultSelector = globalSelector || { content: '', exclude: '' };

        let finalContentSelector = defaultSelector.content || '';
        let finalExcludeSelector = defaultSelector.exclude || '';

        if (ruleSelector) {
            // 域名规则的选择器也只包含 content 和 exclude
            const ruleContent = ruleSelector.content || '';
            const ruleExclude = ruleSelector.exclude || '';
            if (override) {
                finalContentSelector = ruleContent;
                finalExcludeSelector = ruleExclude;
            } else {
                finalContentSelector = SettingsManager.#mergeSelectors(finalContentSelector, ruleContent);
                finalExcludeSelector = SettingsManager.#mergeSelectors(finalExcludeSelector, ruleExclude);
            }
        }

        return { content: finalContentSelector, exclude: finalExcludeSelector };
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
        // (新) 在修改前获取当前设置，作为 oldValue
        const oldSettings = await this.getValidatedSettings();

        // 1. 准备要保存到 sync 的主设置对象
        const settingsToSave = structuredClone(settings);
        delete settingsToSave.source; // 移除运行时状态

        // 2. 从主对象中分离出 AI 引擎
        const allEngines = settingsToSave.aiEngines || [];
        delete settingsToSave.aiEngines;

        // 3. 根据 syncStatus 分离同步引擎和本地引擎
        let enginesToSync = [];
        let enginesToSaveLocally = [];

        allEngines.forEach(engine => {
            const cleanEngine = { ...engine };
            delete cleanEngine.syncStatus; // 从存储中移除 syncStatus
            if (engine.syncStatus === 'local') {
                enginesToSaveLocally.push(cleanEngine);
            } else {
                enginesToSync.push(cleanEngine);
            }
        });

        // 4. 将同步引擎列表放回主设置对象
        settingsToSave.aiEngines = enginesToSync;

        // 5. 清理 precheckRules 中的 compiledRegex
        if (settingsToSave.precheckRules) {
            for (const category in settingsToSave.precheckRules) {
                if (Array.isArray(settingsToSave.precheckRules[category])) {
                    settingsToSave.precheckRules[category].forEach(rule => {
                        delete rule.compiledRegex;
                    });
                }
            }
        }

        // 6. 尝试保存到 sync，如果失败则回退
        try {
            await browser.storage.sync.set({ settings: settingsToSave });
        } catch (e) {
            if (e.message.includes('QUOTA_BYTES')) {
                console.warn('[SettingsManager] Sync storage quota exceeded. Moving all AI engines to local storage and retrying.');
                // 将所有待同步的引擎移至本地列表
                enginesToSaveLocally.push(...enginesToSync);
                // 清空同步列表
                settingsToSave.aiEngines = [];
                // 再次尝试保存，这次只保存不含AI引擎的主设置到sync
                await browser.storage.sync.set({ settings: settingsToSave });
            } else {
                // 如果是其他错误，则直接抛出
                throw e;
            }
        }

        // 7. 保存本地引擎
        await browser.storage.local.set({ localAiEngines: enginesToSaveLocally });

        // 8. 手动触发通知
        // (已修复) 将新旧设置传递给通知函数
        await SettingsManager.notifySettingsChanged(settingsToSave, oldSettings);
    }
    /**
         * (新) 保存单个 AI 引擎。此方法现在是 saveSettings 的一个简单封装。
         * @param {object} engineData - 要保存的引擎数据，可以不包含 id。
         * @param {string|null} existingId - 如果是编辑，则为现有引擎的 ID。
         */
    static async saveAiEngine(engineData, existingId = null) {
        const engineId = existingId || generateUniqueEngineId();
        const engineToSave = { id: engineId, ...engineData };

        const settings = await this.getValidatedSettings();
        const engineIndex = settings.aiEngines.findIndex(e => e.id === engineId);

        if (engineIndex > -1) {
            // 更新现有引擎，并乐观地将其状态设置为 'synced' 以尝试同步
            settings.aiEngines[engineIndex] = { ...settings.aiEngines[engineIndex], ...engineToSave, syncStatus: 'synced' };
        } else {
            // 添加新引擎，并乐观地设置为 'synced'
            settings.aiEngines.push({ ...engineToSave, syncStatus: 'synced' });
        }

        // 委托给统一的 saveSettings 方法处理所有保存逻辑
        await this.saveSettings(settings);
    }

    /**
     * (新) 移除一个 AI 引擎。
     * @param {string} engineId - 要移除的引擎 ID。
     */
    static async removeAiEngine(engineId) {
        const settings = await this.getValidatedSettings();
        settings.aiEngines = settings.aiEngines.filter(e => e.id !== engineId);

        if (settings.translatorEngine === `ai:${engineId}`) {
            const firstAiEngine = settings.aiEngines.find(e => e.syncStatus === 'synced');
            settings.translatorEngine = firstAiEngine ? `ai:${firstAiEngine.id}` : 'google';
        }

        await this.saveSettings(settings);
    }
    /**
     * 清除 effectiveSettingsCache
     */
    static clearCache() {
        SettingsManager.#effectiveSettingsCache.clear();
    }
}