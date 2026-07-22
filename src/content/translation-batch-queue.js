import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { logContentError } from './content-logger.js';

const DEFAULT_MAX_ITEMS = 12;
const DEFAULT_MAX_CHARS = 10000;
const DEFAULT_DELAY_MS = 150;

function defaultGenerateId() {
    return self.crypto.randomUUID();
}

function shouldUseBatchTranslation(translatorEngine) {
    return typeof translatorEngine === 'string' && translatorEngine.startsWith('ai:');
}

function groupBatchItems(items) {
    const groups = new Map();
    for (const item of items) {
        const key = JSON.stringify({
            targetLang: item.targetLang,
            sourceLang: item.sourceLang,
            translatorEngine: item.translatorEngine,
        });
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(item);
    }
    return groups.values();
}

export class TranslationBatchQueue {
    constructor({
        browserApi = browser,
        generateId = defaultGenerateId,
        logError = logContentError,
        onBatchStateChange = () => {},
        onTranslationResult = () => {},
        maxItems = DEFAULT_MAX_ITEMS,
        maxChars = DEFAULT_MAX_CHARS,
        delayMs = DEFAULT_DELAY_MS,
    } = {}) {
        this.browser = browserApi;
        this.generateId = generateId;
        this.logError = logError;
        this.onBatchStateChange = onBatchStateChange;
        this.onTranslationResult = onTranslationResult;
        this.maxItems = maxItems;
        this.maxChars = maxChars;
        this.delayMs = delayMs;
        this.queue = [];
        this.timerId = null;
        this.inFlightBatchIds = new Set();
    }

    get queuedCount() {
        return this.queue.length;
    }

    get inFlightCount() {
        return this.inFlightBatchIds.size;
    }

    static shouldUseBatchTranslation(translatorEngine) {
        return shouldUseBatchTranslation(translatorEngine);
    }

    updateBatchState() {
        this.onBatchStateChange({
            queued: this.queuedCount,
            inFlight: this.inFlightCount,
        });
    }

    clear() {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.queue = [];
        this.inFlightBatchIds.clear();
        this.updateBatchState();
    }

    enqueue(item) {
        this.queue.push(item);
        this.updateBatchState();

        const totalChars = this.queue.reduce((sum, queued) => sum + queued.text.length, 0);
        if (this.queue.length >= this.maxItems || totalChars >= this.maxChars) {
            this.flush();
            return;
        }

        if (!this.timerId) {
            this.timerId = setTimeout(() => this.flush(), this.delayMs);
        }
    }

    markBatchCompleted(batchId) {
        if (!batchId) return;
        this.inFlightBatchIds.delete(batchId);
        this.updateBatchState();
    }

    flush() {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        if (this.queue.length === 0) return;

        const itemsToFlush = this.queue;
        this.queue = [];

        // tabId optional: SW prefers sender.tab.id for content-script batches.
        try {
            for (const group of groupBatchItems(itemsToFlush)) {
                this.#sendGroup(group, undefined);
            }
        } catch (error) {
            this.logError('TranslationBatchQueue.flush', error);
            for (const item of itemsToFlush) {
                this.#emitFailure(item, error);
            }
            this.updateBatchState();
        }
    }

    #sendGroup(group, tabId) {
        const first = group[0];
        const batchId = `fb-${this.generateId()}`;
        this.inFlightBatchIds.add(batchId);
        this.updateBatchState();

        this.browser.runtime.sendMessage({
            type: MESSAGE_TYPES.TRANSLATE_TEXT_BATCH,
            payload: {
                batchId,
                items: group.map(item => ({ elementId: item.elementId, text: item.text })),
                targetLang: first.targetLang,
                sourceLang: first.sourceLang,
                translatorEngine: first.translatorEngine,
                tabId,
            },
        }).catch(error => {
            this.logError('TranslationBatchQueue.flush (send batch)', error);
            this.inFlightBatchIds.delete(batchId);
            this.updateBatchState();
            for (const item of group) {
                this.#emitFailure(item, error);
            }
        });
    }

    #emitFailure(item, error) {
        this.onTranslationResult({
            elementId: item.elementId,
            success: false,
            translatedText: '',
            wasTranslated: false,
            error: error.message,
        });
    }
}
