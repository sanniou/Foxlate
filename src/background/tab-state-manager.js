import browser from '../lib/browser-polyfill.js';

/**
 * 一个单例类，用于原子化地管理与会话相关的标签页状态。
 * 这可以防止多个异步操作同时读/写会话存储时可能出现的竞态条件。
 * 它在内存中维护状态的副本，并对所有写操作进行排队。
 */
class TabStateManager {
    #state = {
        tabTranslationStates: {}, // { [tabId]: 'loading' | 'translated' }
        sessionTabTranslations: {} // { [tabId]: hostname }
    };
    #isInitialized = false;
    #initializationPromise = null;
    #writeLock = false;
    #writeQueue = [];

    constructor() {
        this.#initializationPromise = this.#initialize();
        // 监听存储的外部更改，以保持内存状态同步。
        browser.storage.onChanged.addListener(this.#handleStorageChange.bind(this));
        // 当标签页关闭时，自动清理状态。
        browser.tabs.onRemoved.addListener(this.removeTab.bind(this));
    }

    async #initialize() {
        try {
            const sessionData = await browser.storage.session.get(['tabTranslationStates', 'sessionTabTranslations']);
            this.#state.tabTranslationStates = sessionData.tabTranslationStates || {};
            this.#state.sessionTabTranslations = sessionData.sessionTabTranslations || {};
            console.log('[TabStateManager] Initialized with state:', this.#state);
        } catch (e) {
            console.error('[TabStateManager] Failed to initialize state from storage.', e);
        } finally {
            this.#isInitialized = true;
        }
    }

    async #ensureInitialized() {
        if (!this.#isInitialized) {
            await this.#initializationPromise;
        }
    }

    /**
     * 将写操作加入队列以确保原子性。
     * @param {Function} writeFunction - 一个修改 this.#state 的异步函数。
     * @returns {Promise<void>}
     */
    async #enqueueWrite(writeFunction) {
        return new Promise((resolve, reject) => {
            this.#writeQueue.push({ writeFunction, resolve, reject });
            this.#processWriteQueue();
        });
    }

    async #processWriteQueue() {
        if (this.#writeLock || this.#writeQueue.length === 0) {
            return;
        }
        this.#writeLock = true;
        const { writeFunction, resolve, reject } = this.#writeQueue.shift();
        try {
            await writeFunction();
            // 修改内存状态后，将其持久化到会话存储中。
            await browser.storage.session.set(this.#state);
            resolve();
        } catch (e) {
            console.error('[TabStateManager] Error processing write queue:', e);
            reject(e);
        } finally {
            this.#writeLock = false;
            // 处理队列中的下一项。
            this.#processWriteQueue();
        }
    }

    /**
     * 处理会话存储的外部更改，以保持内存状态同步。
     */
    #handleStorageChange(changes, area) {
        if (area !== 'session') return;

        let stateChanged = false;
        if (changes.tabTranslationStates) {
            this.#state.tabTranslationStates = changes.tabTranslationStates.newValue || {};
            stateChanged = true;
        }
        if (changes.sessionTabTranslations) {
            this.#state.sessionTabTranslations = changes.sessionTabTranslations.newValue || {};
            stateChanged = true;
        }
        if (stateChanged) {
            console.log('[TabStateManager] In-memory state synced with storage changes.');
        }
    }

    // --- Public API ---

    /**
     * 获取所有当前具有活动翻译状态的标签页ID。
     * @returns {Promise<number[]>}
     */
    async getActiveTabIds() {
        await this.#ensureInitialized();
        // 活动标签页是指具有任何状态（'loading' 或 'translated'）的标签页。
        return Object.keys(this.#state.tabTranslationStates).map(Number);
    }
    /**
     * 设置给定标签页的翻译状态（例如，'loading', 'translated'）。
     * @param {number} tabId
     * @param {string} status - 'loading', 'translated', 或 'original' 用于清除状态。
     */
    async setTabStatus(tabId, status) {
        await this.#ensureInitialized();
        return this.#enqueueWrite(() => {
            if (status === 'original' || !status) {
                delete this.#state.tabTranslationStates[tabId];
            } else {
                this.#state.tabTranslationStates[tabId] = status;
            }
        });
    }

    /**
     * 注册一个标签页，以便在当前会话中自动翻译。
     * @param {number} tabId
     * @param {string} hostname
     */
    async registerTabForAutoTranslation(tabId, hostname) {
        await this.#ensureInitialized();
        return this.#enqueueWrite(() => {
            if (this.#state.sessionTabTranslations[tabId] !== hostname) {
                this.#state.sessionTabTranslations[tabId] = hostname;
                console.log(`[TabStateManager] Registered ${hostname} for auto-translation in tab ${tabId}.`);
            }
        });
    }

    /**
     * 从基于会话的自动翻译中注销一个标签页。
     * @param {number} tabId
     */
    async unregisterTabForAutoTranslation(tabId) {
        await this.#ensureInitialized();
        return this.#enqueueWrite(() => {
            if (this.#state.sessionTabTranslations[tabId]) {
                delete this.#state.sessionTabTranslations[tabId];
                console.log(`[TabStateManager] Unregistered auto-translation for tab ${tabId}.`);
            }
        });
    }

    /**
     * 检查一个标签页当前是否被标记为基于会话的自动翻译。
     * @param {number} tabId
     * @param {string} hostname
     * @returns {Promise<boolean>}
     */
    async isTabRegisteredForAutoTranslation(tabId, hostname) {
        await this.#ensureInitialized();
        return this.#state.sessionTabTranslations[tabId] === hostname;
    }

    /**
     * 移除与给定标签页ID关联的所有状态。
     * 通常在标签页关闭时调用。
     * @param {number} tabId
     */
    async removeTab(tabId) {
        await this.#ensureInitialized();
        return this.#enqueueWrite(() => {
            let changed = false;
            if (this.#state.tabTranslationStates[tabId]) {
                delete this.#state.tabTranslationStates[tabId];
                changed = true;
            }
            if (this.#state.sessionTabTranslations[tabId]) {
                delete this.#state.sessionTabTranslations[tabId];
                changed = true;
            }
            if (changed) {
                console.log(`[TabStateManager] Cleaned up state for closed tab ${tabId}.`);
            }
        });
    }
}

export default new TabStateManager();

