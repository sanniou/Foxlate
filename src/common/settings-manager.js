import browser from '../lib/browser-polyfill.js';
import {
    generateDefaultSettings,
    prepareSettingsForStorage,
    removeAiEngineFromSettings,
    resolveEffectiveSettings,
    setDomainRuleProperty,
    upsertAiEngine,
    validateSettings,
} from './settings-domain.js';

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
        return generateDefaultSettings();
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

        const validatedSettings = validateSettings(storedSettings);

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
     * 为给定的主机名计算有效设置，通过合并全局设置和特定于域的规则。
     * @param {string} [hostname] - 当前页面的主机名。
     * @returns {Promise<object>} 一个 Promise，解析为最终的有效设置对象。
     */

    static async getEffectiveSettings(hostname) {
        if (SettingsManager.#effectiveSettingsCache.has(hostname)) {
            return structuredClone(SettingsManager.#effectiveSettingsCache.get(hostname));
        }

        const settings = await SettingsManager.getValidatedSettings();

        const effectiveSettings = resolveEffectiveSettings(settings, hostname);

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

        const settingsToSave = prepareSettingsForStorage(settings);

        await browser.storage.local.set({ settings: settingsToSave });

        await SettingsManager.notifySettingsChanged(settingsToSave, oldSettings);
    }

    /**
     * 将当前本地设置上传到云端存储 (sync)。
     * @param {object} settings - 要上传的设置对象。
     */
    static async uploadSettingsToCloud(settings) {
        const settingsToUpload = prepareSettingsForStorage(settings);

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
        const settings = await this.getValidatedSettings();
        await this.saveLocalSettings(upsertAiEngine(settings, engineData, existingId));
    }

    /**
     * (新) 移除一个 AI 引擎。
     * @param {string} engineId - 要移除的引擎 ID。
     */
    static async removeAiEngine(engineId) {
        const settings = await this.getValidatedSettings();
        await this.saveLocalSettings(removeAiEngineFromSettings(settings, engineId));
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
        await this.saveLocalSettings(setDomainRuleProperty(settings, domain, key, value));
    }
    /**
     * 清除 effectiveSettingsCache
     */
    static clearCache() {
        SettingsManager.#effectiveSettingsCache.clear();
    }

}
