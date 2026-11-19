import browser from '../lib/browser-polyfill.js';

function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const FLUSH_DELAY_MS = 400;
const FLUSH_MAX_DELAY_MS = 2000;

/**
 * 有界的历史/失败队列。
 *
 * 关键在「写」的粒度：页面翻译的批量结果是一条一条回报的，而每条都 `get` 整表 +
 * `set` 整表的话，一个 500 段的页面就是 1000 次全表读写（单表最多 80 条 × 2×1000 字符），
 * 而且这些 `await` 排在译文上屏之前，直接变成用户能感觉到的卡顿。
 *
 * 现在：第一次用到时读一次进内存，之后所有读取走内存，写入合并成一次延迟 flush
 * （`flush()` 可显式调用，批处理结束后立刻落盘，不必等定时器）。
 */
class BoundedStorageList {
    #browser;
    #storageKey;
    #limit;
    #items = null;
    #loadPromise = null;
    #flushTimer = null;
    #flushDeadline = 0;

    constructor({ browserApi = browser, storageKey, limit = 100 }) {
        this.#browser = browserApi;
        this.#storageKey = storageKey;
        this.#limit = limit;
    }

    async #ensureLoaded() {
        if (this.#items) return this.#items;
        if (!this.#loadPromise) {
            this.#loadPromise = this.#browser.storage.local.get(this.#storageKey).then((data) => {
                if (!this.#items) {
                    this.#items = Array.isArray(data?.[this.#storageKey]) ? data[this.#storageKey] : [];
                }
                return this.#items;
            });
        }
        return this.#loadPromise;
    }

    async list() {
        const items = await this.#ensureLoaded();
        return [...items];
    }

    async set(items) {
        await this.#ensureLoaded();
        this.#items = items.slice(0, this.#limit);
        await this.flush();
        return [...this.#items];
    }

    async add(item) {
        const items = await this.#ensureLoaded();
        this.#items = [item, ...items].slice(0, this.#limit);
        this.#scheduleFlush();
        return [...this.#items];
    }

    async clear() {
        this.#items = [];
        await this.flush();
        return [];
    }

    async remove(id) {
        const items = await this.#ensureLoaded();
        this.#items = items.filter(item => item.id !== id);
        this.#scheduleFlush();
        return [...this.#items];
    }

    #scheduleFlush() {
        const now = Date.now();
        if (!this.#flushDeadline) this.#flushDeadline = now + FLUSH_MAX_DELAY_MS;
        // 长会话里持续有新增时，定时器会被不断重置 —— 用 deadline 兜住，最多等 2s。
        const delay = Math.max(0, Math.min(FLUSH_DELAY_MS, this.#flushDeadline - now));
        if (this.#flushTimer) clearTimeout(this.#flushTimer);
        this.#flushTimer = setTimeout(() => {
            this.flush().catch((error) => console.error('[Foxlate] Failed to persist records:', error));
        }, delay);
    }

    /** 立刻把内存里的记录写回 storage（批处理结束时调用，避免依赖定时器）。 */
    async flush() {
        if (this.#flushTimer) {
            clearTimeout(this.#flushTimer);
            this.#flushTimer = null;
        }
        this.#flushDeadline = 0;
        if (!this.#items) return;
        await this.#browser.storage.local.set({ [this.#storageKey]: this.#items });
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

    flush() {
        return this.#records.flush();
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

    flush() {
        return this.#records.flush();
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
