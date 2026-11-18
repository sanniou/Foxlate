import browser from '../lib/browser-polyfill.js';

/**
 * 翻译缓存的键。
 *
 * 必须覆盖决定「最终用户可见文本」的全部输入，否则会出现同一个键在不同设置下
 * 命中到用别的引擎/词汇表算出来的结果：
 * - engine     同一段文本可能被不同引擎翻译（甚至同一个引擎 ID 也可能因短文本回退而变）
 * - 语向       同上
 * - text       使用源侧词汇表改写后的文本（即引擎实际收到的文本）
 * - 词汇表指纹 缓存值已经过词汇表替换，词汇表一变就必须失效
 */
export function createTranslationCacheKey(engine, sourceLang, targetLang, text, glossaryFingerprint = 'none', promptFingerprint = 'none') {
    return `${engine}\u0000${sourceLang}\u0000${targetLang}\u0000${glossaryFingerprint}\u0000${promptFingerprint}\u0000${text}`;
}

export class TranslationCacheStore {
    #cache = new Map();
    #browser;
    #storageKey;
    #saveDelayMs;
    #maxSaveDelayMs;
    #pendingSince = null;
    #saveTimer = null;
    #maxSize;

    constructor({
        browserApi = browser,
        storageKey = 'translationCache',
        saveDelayMs = 2000,
        maxSaveDelayMs = 15000,
        maxSize = 5000,
    } = {}) {
        this.#browser = browserApi;
        this.#storageKey = storageKey;
        this.#saveDelayMs = saveDelayMs;
        this.#maxSaveDelayMs = maxSaveDelayMs;
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
                // 用户可能把 cacheSize 调小了然后重启。不在这里收敛的话，超限缓存会
                // 被全量载入内存并一直保留到下一次 set()，等于设置形同虚设。
                this.#enforceLimit();
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
        // 纯 debounce 在长任务里等于永不落盘：翻译过程中每批都会调本方法，
        // 每次 clearTimeout 都把计时器推后，一次持续几十秒的整页翻译结束时
        // 缓存可能一条都没进 storage——service worker 被回收时全部付费结果丢失。
        // 因此戴上「首次待写的时刻」：最早写入不晚于 maxSaveDelayMs。
        if (this.#pendingSince === null) {
            this.#pendingSince = Date.now();
        }
        if (this.#saveTimer) {
            clearTimeout(this.#saveTimer);
        }
        const elapsed = Date.now() - this.#pendingSince;
        const delay = Math.max(0, Math.min(this.#saveDelayMs, this.#maxSaveDelayMs - elapsed));
        this.#saveTimer = setTimeout(() => {
            this.#saveTimer = null;
            this.#pendingSince = null;
            this.save();
        }, delay);
    }

    async clear() {
        if (this.#saveTimer) {
            clearTimeout(this.#saveTimer);
            this.#saveTimer = null;
        }
        this.#pendingSince = null;
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
