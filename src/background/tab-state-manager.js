import browser from '../lib/browser-polyfill.js';

/**
 * (已重构) 一个单例类，用于原子化地管理与会话相关的标签页状态。
 * 此类采用“读时加载，写时更新”的模式，并使用异步写队列来防止并发写入 `storage.session` 时可能出现的竞态条件。
 * 它不再维护一个完整的内存状态副本，从而简化了逻辑。
 */
class TabStateManager {
    #writeLock = false;
    #writeQueue = [];

    constructor() {
        // 当标签页关闭时，自动清理状态。
        browser.tabs.onRemoved.addListener(this.removeTab.bind(this));
    }

    /**
     * 将写操作加入队列以确保原子性。
     * @param {Function} writeFunction - 一个执行完整“读-改-写”周期的异步函数。
     * @returns {Promise<void>}
     */
    async #enqueueWrite(writeFunction) {
        return new Promise((resolve, reject) => {
            this.#writeQueue.push({ writeFunction, resolve, reject });
            this.#processWriteQueue(); // 尝试处理队列
        });
    }

    async #processWriteQueue() {
        if (this.#writeLock || this.#writeQueue.length === 0) {
            return; // 如果队列为空或已被锁定，则返回
        }
        this.#writeLock = true;
        const { writeFunction, resolve, reject } = this.#writeQueue.shift();
        try {
            // 执行完整的“读-改-写”事务
            await writeFunction();
            resolve();
        } catch (e) {
            console.error('[TabStateManager] Error processing write queue:', e);
            reject(e);
        } finally {
            this.#writeLock = false;
            this.#processWriteQueue(); // 递归处理队列中的下一项
        }
    }

    // --- Public API ---

    /**
     * 获取所有当前具有活动翻译状态的标签页ID。
     * @returns {Promise<number[]>}
     */
    async getActiveTabIds() {
        const { tabTranslationStates } = await browser.storage.session.get('tabTranslationStates');
        return Object.keys(tabTranslationStates || {}).map(Number);
    }

    /**
     * 设置给定标签页的翻译状态（例如，'loading', 'translated'）。
     * @param {number} tabId
     * @param {string} status - 'loading', 'translated', 或 'original' 用于清除状态。
     */
    async setTabStatus(tabId, status) {
        return this.#enqueueWrite(() => {
            return this.#readModifyWrite('tabTranslationStates', states => {
                if (status === 'original' || !status) {
                    delete states[tabId];
                } else {
                    states[tabId] = status;
                }
                return states;
            });
        });
    }

    /**
     * 注册一个标签页，以便在当前会话中自动翻译。
     * @param {number} tabId
     * @param {string} hostname
     */
    async registerTabForAutoTranslation(tabId, hostname) {
        return this.#enqueueWrite(() => {
            return this.#readModifyWrite('sessionTabTranslations', states => {
                states[tabId] = hostname;
                return states;
            });
        });
    }

    /**
     * 从基于会话的自动翻译中注销一个标签页。
     * @param {number} tabId
     */
    async unregisterTabForAutoTranslation(tabId) {
        return this.#enqueueWrite(() => {
            return this.#readModifyWrite('sessionTabTranslations', states => {
                delete states[tabId];
                return states;
            });
        });
    }

    /**
     * 检查一个标签页当前是否被标记为基于会话的自动翻译。
     * @param {number} tabId
     * @param {string} hostname
     * @returns {Promise<boolean>}
     */
    async isTabRegisteredForAutoTranslation(tabId, hostname) {
        const { sessionTabTranslations } = await browser.storage.session.get('sessionTabTranslations');
        return (sessionTabTranslations || {})[tabId] === hostname;
    }

    /**
     * 移除与给定标签页ID关联的所有状态。
     * 通常在标签页关闭时调用。
     * @param {number} tabId
     */
    async removeTab(tabId) {
        return this.#enqueueWrite(async () => {
            await this.#readModifyWrite(['tabTranslationStates', 'sessionTabTranslations', 'injectedFrames'], states => {
                let changed = false;
                if (states.tabTranslationStates && states.tabTranslationStates[tabId]) {
                    delete states.tabTranslationStates[tabId];
                    changed = true; 
                }
                if (states.sessionTabTranslations && states.sessionTabTranslations[tabId]) {
                    delete states.sessionTabTranslations[tabId];
                    changed = true;
                }
                if (changed) {
                    console.log(`[TabStateManager] Cleaned up state for closed tab ${tabId}.`);
                }
                if (states.injectedFrames && states.injectedFrames[tabId]) {
                    delete states.injectedFrames[tabId];
                    console.log(`[TabStateManager] Cleaned up injection state for closed tab ${tabId}.`);
                }
                return states;
            });
        });
    }

    /**
     * (新) 标记一个框架为已注入脚本。
     * @param {number} tabId
     * @param {number} frameId
     */
    async markFrameAsInjected(tabId, frameId) {
        return this.#enqueueWrite(() => {
            return this.#readModifyWrite('injectedFrames', states => {
                if (!states[tabId]) {
                    states[tabId] = [];
                }
                if (!states[tabId].includes(frameId)) {
                    states[tabId].push(frameId);
                }
                return states;
            });
        });
    }

    /**
     * (新) 检查一个框架是否已被标记为已注入。
     * @param {number} tabId
     * @param {number} frameId
     * @returns {Promise<boolean>}
     */
    async isFrameInjected(tabId, frameId) {
        const { injectedFrames } = await browser.storage.session.get('injectedFrames');
        return !!(injectedFrames?.[tabId]?.includes(frameId));
    }

    /**
     * @private
     * 一个通用的“读-改-写”辅助函数，用于封装对 storage 的原子操作。
     * @param {string|string[]} keys - 要读取的 storage 键。
     * @param {Function} modifier - 一个接收当前值并返回新值的函数。
     */
    async #readModifyWrite(keys, modifier) {
        const currentStates = await browser.storage.session.get(keys);
        const newStates = modifier(currentStates || {});
        await browser.storage.session.set(newStates);
    }
}

export default new TabStateManager();
