import browser from '../lib/browser-polyfill.js';

export function createTranslationCacheKey(sourceLang, targetLang, text) {
    return `${sourceLang}:${targetLang}:${text}`;
}

export class TranslationCacheStore {
    #cache = new Map();
    #browser;
    #storageKey;
    #saveDelayMs;
    #saveTimer = null;
    #maxSize;

    constructor({
        browserApi = browser,
        storageKey = 'translationCache',
        saveDelayMs = 2000,
        maxSize = 5000,
    } = {}) {
        this.#browser = browserApi;
        this.#storageKey = storageKey;
        this.#saveDelayMs = saveDelayMs;
        this.#maxSize = maxSize;
    }

    get size() {
        return this.#cache.size;
    }

    get limit() {
        return this.#maxSize;
    }

    has(key) {
        return this.#cache.has(key);
    }

    touch(key) {
        if (!this.#cache.has(key)) {
            return undefined;
        }

        const value = this.#cache.get(key);
        this.#cache.delete(key);
        this.#cache.set(key, value);
        return value;
    }

    set(key, value) {
        this.#cache.set(key, value);
        this.#enforceLimit();
    }

    updateLimit(maxSize) {
        if (maxSize && typeof maxSize === 'number' && maxSize >= 0) {
            this.#maxSize = maxSize;
            this.#enforceLimit();
        }
        return this.#maxSize;
    }

    async load() {
        try {
            const result = await this.#browser.storage.local.get(this.#storageKey);
            if (result[this.#storageKey]) {
                this.#cache = new Map(Object.entries(result[this.#storageKey]));
            }
            return this.#cache.size;
        } catch (error) {
            console.error('[TranslatorManager] Failed to load cache from storage.', error);
            return 0;
        }
    }

    async save() {
        try {
            const plainObject = Object.fromEntries(this.#cache);
            await this.#browser.storage.local.set({ [this.#storageKey]: plainObject });
        } catch (error) {
            console.error('[TranslatorManager] Failed to save cache to storage.', error);
        }
    }

    scheduleSave() {
        if (this.#saveTimer) {
            clearTimeout(this.#saveTimer);
        }
        this.#saveTimer = setTimeout(() => {
            this.save();
            this.#saveTimer = null;
        }, this.#saveDelayMs);
    }

    async clear() {
        this.#cache.clear();
        await this.save();
    }

    #enforceLimit() {
        while (this.#cache.size > this.#maxSize) {
            const oldestKey = this.#cache.keys().next().value;
            this.#cache.delete(oldestKey);
        }
    }
}
