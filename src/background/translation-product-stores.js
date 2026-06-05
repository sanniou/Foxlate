import browser from '../lib/browser-polyfill.js';

function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

class BoundedStorageList {
    #browser;
    #storageKey;
    #limit;

    constructor({ browserApi = browser, storageKey, limit = 100 }) {
        this.#browser = browserApi;
        this.#storageKey = storageKey;
        this.#limit = limit;
    }

    async list() {
        const data = await this.#browser.storage.local.get(this.#storageKey);
        return Array.isArray(data[this.#storageKey]) ? data[this.#storageKey] : [];
    }

    async set(items) {
        const boundedItems = items.slice(0, this.#limit);
        await this.#browser.storage.local.set({ [this.#storageKey]: boundedItems });
        return boundedItems;
    }

    async add(item) {
        const items = await this.list();
        return this.set([item, ...items]);
    }

    async clear() {
        await this.#browser.storage.local.set({ [this.#storageKey]: [] });
        return [];
    }

    async remove(id) {
        const items = await this.list();
        return this.set(items.filter(item => item.id !== id));
    }
}

export class TranslationHistoryStore {
    #records;

    constructor({ browserApi = browser, limit = 80 } = {}) {
        this.#records = new BoundedStorageList({
            browserApi,
            storageKey: 'translationHistory',
            limit,
        });
    }

    list() {
        return this.#records.list();
    }

    clear() {
        return this.#records.clear();
    }

    async recordSuccess({ sourceText, translatedText, targetLang, sourceLang, engine, hostname, surface }) {
        if (!sourceText || !translatedText) return this.list();
        return this.#records.add({
            id: createId('history'),
            sourceText: String(sourceText).slice(0, 1000),
            translatedText: String(translatedText).slice(0, 1000),
            targetLang,
            sourceLang,
            engine,
            hostname,
            surface,
            createdAt: Date.now(),
        });
    }
}

export class TranslationFailureQueue {
    #records;

    constructor({ browserApi = browser, limit = 80 } = {}) {
        this.#records = new BoundedStorageList({
            browserApi,
            storageKey: 'translationFailureQueue',
            limit,
        });
    }

    list() {
        return this.#records.list();
    }

    clear() {
        return this.#records.clear();
    }

    resolve(id) {
        return this.#records.remove(id);
    }

    async recordFailure({ sourceText, targetLang, sourceLang, engine, hostname, surface, error }) {
        if (!sourceText) return this.list();
        return this.#records.add({
            id: createId('failure'),
            sourceText: String(sourceText).slice(0, 1000),
            targetLang,
            sourceLang,
            engine,
            hostname,
            surface,
            error: error || 'Translation failed',
            createdAt: Date.now(),
            attempts: 1,
        });
    }
}

export class ProviderHealthStore {
    #browser;
    #storageKey;

    constructor({ browserApi = browser, storageKey = 'providerHealth' } = {}) {
        this.#browser = browserApi;
        this.#storageKey = storageKey;
    }

    async list() {
        const data = await this.#browser.storage.local.get(this.#storageKey);
        return data[this.#storageKey] || {};
    }

    async clear() {
        await this.#browser.storage.local.set({ [this.#storageKey]: {} });
        return {};
    }

    async record({ engine = 'default', success, error = null, latencyMs = null }) {
        const health = await this.list();
        const previous = health[engine] || {
            engine,
            successCount: 0,
            failureCount: 0,
        };
        const next = {
            ...previous,
            engine,
            status: success ? 'healthy' : 'degraded',
            successCount: previous.successCount + (success ? 1 : 0),
            failureCount: previous.failureCount + (success ? 0 : 1),
            lastError: success ? null : (error || 'Unknown error'),
            lastLatencyMs: latencyMs,
            lastCheckedAt: Date.now(),
        };
        const nextHealth = { ...health, [engine]: next };
        await this.#browser.storage.local.set({ [this.#storageKey]: nextHealth });
        return next;
    }
}

export const translationHistoryStore = new TranslationHistoryStore();
export const translationFailureQueue = new TranslationFailureQueue();
export const providerHealthStore = new ProviderHealthStore();
