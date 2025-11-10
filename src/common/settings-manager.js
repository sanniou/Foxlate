import browser from '../lib/browser-polyfill.js';
import * as Constants from './constants.js';
import { generateUniqueEngineId } from './utils.js';
import { DEFAULT_STRATEGY_MAP } from '../content/subtitle/strategy-manifest.js';

export class SettingsManager {
    // --- Private Static State ---  
    static #validatedSettingsCache = null;

    static #effectiveSettingsCache = new Map();

    // --- (新) 事件监听器 ---
    static #listeners = new Map();

    // --- Static Initialization Block ---
    // 静态初始化块，在类加载时执行一次，设置初始值。
    static {
        // Listen for changes in storage and invalidate the cache accordingly.
        browser.storage.onChanged.addListener(async (changes, area) => {
            // 使用类名直接访问静态成员，可以完全避免 `this` 上下文可能引发的混淆或错误，
            // 尤其是在事件监听器的回调函数和静态块中。
            if (area === 'local' && changes.settings) {
                // (已修改) 直接传递新旧值
                await SettingsManager.notifySettingsChanged(changes.settings?.newValue, changes.settings?.oldValue);
            }
        });

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
     * (新) 生成一个完整的默认设置对象，包括动态生成的预检规则。
     * @returns {object} 默认设置对象。
     */
    static generateDefaultSettings() {
        const defaultSettings = structuredClone(Constants.DEFAULT_SETTINGS);
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

        // 优先从 local 获取设置
        const localData = await browser.storage.local.get('settings');
        let storedSettings = localData.settings;

        const defaultSettings = SettingsManager.generateDefaultSettings();

        const settingsToValidate = storedSettings || defaultSettings;

        const validatedSettings = { ...defaultSettings, ...settingsToValidate };

        // 为现有的域名规则添加时间戳（如果没有的话）
        if (validatedSettings.domainRules) {
            for (const domain in validatedSettings.domainRules) {
                if (!validatedSettings.domainRules[domain].addedAt) {
                    // 为现有规则分配一个基于域名哈希的时间戳，确保排序的一致性
                    // 这样可以避免每次加载时都分配新的时间戳导致排序变化
                    validatedSettings.domainRules[domain].addedAt = SettingsManager.#generateDomainTimestamp(domain);
                }
            }
        }

        // Deep merge for translationSelector
        const storedDefaultSelector = settingsToValidate.translationSelector?.default;
        const defaultDefaultSelector = defaultSettings.translationSelector.default;
        validatedSettings.translationSelector = settingsToValidate.translationSelector || {};
        if (typeof storedDefaultSelector === 'object' && storedDefaultSelector !== null) {
            validatedSettings.translationSelector.default = { ...defaultDefaultSelector, ...storedDefaultSelector };
        } else {
            validatedSettings.translationSelector.default = defaultDefaultSelector;
        }

        SettingsManager.#validatedSettingsCache = structuredClone(validatedSettings); // 缓存未编译但已验证的设置
        return validatedSettings;
    }

    /**
     * 从云端存储 (sync) 中检索设置，不进行合并或验证。
     * @returns {Promise<object>} 一个 Promise，解析为从云端获取的原始设置对象。
     */
    static async getSyncSettings() {
        const syncData = await browser.storage.sync.get('settings');
        return syncData.settings || null;
    }

    /**
     * 从云端下载设置并覆盖本地设置。
     * @returns {Promise<void>} 一个 Promise，在操作完成后解析。
     */
    static async downloadSettingsFromCloud() {
        const syncSettings = await SettingsManager.getSyncSettings();
        if (syncSettings) {
            await SettingsManager.saveLocalSettings(syncSettings);
            console.log('[SettingsManager] Settings downloaded from cloud.');
        } else {
            console.warn('[SettingsManager] No settings found in cloud storage to download.');
        }
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

        // (已优化) 解析所有值为 'default' 的规则属性，将其替换为全局设置的实际值。
        // 这确保了 getEffectiveSettings 的调用者永远不会收到 'default' 字符串。
        const keysToResolve = ['autoTranslate', 'translatorEngine', 'targetLanguage', 'sourceLanguage', 'displayMode'];
        for (const key of keysToResolve) {
            if (effectiveSettings[key] === 'default') {
                // 从原始的全局设置 (settings) 中获取回退值
                effectiveSettings[key] = settings[key];
            }
        }

        // --- 字幕和选择器逻辑 (已重构) ---
        effectiveSettings.subtitleSettings = SettingsManager.#calculateEffectiveSubtitleSettings(hostname, domainRule);

        effectiveSettings.translationSelector = SettingsManager.#calculateEffectiveSelectorSettings(
            settings.translationSelector?.default,
            domainRule.cssSelector,
            domainRule.cssSelectorOverride || false
        );

        SettingsManager.#effectiveSettingsCache.set(hostname, structuredClone(effectiveSettings));
        return effectiveSettings;
    }

    /**
     * 将提供的设置对象保存到存储中。
     * @param {object} settings - 要保存的设置对象。
     */
    /**
     * 将提供的设置对象保存到本地存储中。
     * @param {object} settings - 要保存的设置对象。
     */
    static async saveLocalSettings(settings) {
        const oldSettings = await this.getValidatedSettings();

        const settingsToSave = structuredClone(settings);
        delete settingsToSave.source;

        await browser.storage.local.set({ settings: settingsToSave });

        await SettingsManager.notifySettingsChanged(settingsToSave, oldSettings);
    }

    /**
     * 将当前本地设置上传到云端存储 (sync)。
     * @param {object} settings - 要上传的设置对象。
     */
    static async uploadSettingsToCloud(settings) {
        const settingsToUpload = structuredClone(settings);
        delete settingsToUpload.source;

        // 尝试保存到 sync
        try {
            await browser.storage.sync.set({ settings: settingsToUpload });
            console.log('[SettingsManager] Settings uploaded to cloud successfully.');
        } catch (e) {
            console.error('[SettingsManager] Failed to upload settings to cloud:', e);
            throw e;
        }
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
            // 更新现有引擎
            settings.aiEngines[engineIndex] = { ...settings.aiEngines[engineIndex], ...engineToSave };
        } else {
            // 添加新引擎
            settings.aiEngines.push({ ...engineToSave });
        }

        await this.saveLocalSettings(settings);
    }

    /**
     * (新) 移除一个 AI 引擎。
     * @param {string} engineId - 要移除的引擎 ID。
     */
    static async removeAiEngine(engineId) {
        const settings = await this.getValidatedSettings();
        settings.aiEngines = settings.aiEngines.filter(e => e.id !== engineId);

        if (settings.translatorEngine === `ai:${engineId}`) {
            const firstAiEngine = settings.aiEngines[0]; // Get the first available AI engine
            settings.translatorEngine = firstAiEngine ? `ai:${firstAiEngine.id}` : 'google';
        }

        await this.saveLocalSettings(settings);
    }
    /**
     * (新) 保存单个域名规则的属性。
     * 此方法封装了获取、修改和保存域名规则的逻辑。
     * @param {string} domain - 要更新的域名。
     * @param {string} key - 要更新的规则属性键。
     * @param {*} value - 新的属性值。
     */
    static async saveDomainRuleProperty(domain, key, value) {
        if (!domain) {
            console.warn('[SettingsManager] Cannot save domain rule property without a domain.');
            return;
        }

        const settings = await this.getValidatedSettings();
        const rule = settings.domainRules[domain] || {};

        // 将特殊业务逻辑封装在此处
        if (key === 'subtitleDisplayMode') {
            if (!rule.subtitleSettings) rule.subtitleSettings = {};
            rule.subtitleSettings.enabled = true; // 启用字幕是更改显示模式的副作用
            rule.subtitleSettings.displayMode = value;
        } else {
            rule[key] = value;
        }

        settings.domainRules[domain] = rule;
        await this.saveLocalSettings(settings);
    }
    /**
     * 清除 effectiveSettingsCache
     */
    static clearCache() {
        SettingsManager.#effectiveSettingsCache.clear();
    }

    /**
     * @private
     * 为域名生成一个一致的时间戳，用于排序现有规则
     * @param {string} domain - 域名
     * @returns {number} 基于域名哈希的时间戳
     */
    static #generateDomainTimestamp(domain) {
        // 使用简单的字符串哈希算法生成一致的数字
        let hash = 0;
        for (let i = 0; i < domain.length; i++) {
            const char = domain.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        // 将哈希值转换为正数，并加上一个基准时间戳，确保时间戳在合理范围内
        return Math.abs(hash) + 1600000000000; // 2020年作为基准年
    }
}