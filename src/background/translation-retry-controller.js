import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';

export class TranslationRetryController {
    #browser;
    #maxAttempts;
    #baseDelayMs;
    #maxDelayMs;
    #engineBackoffState = new Map();

    constructor({
        browserApi = browser,
        maxAttempts = 2,
        baseDelayMs = 1200,
        maxDelayMs = 12000,
    } = {}) {
        this.#browser = browserApi;
        this.#maxAttempts = maxAttempts;
        this.#baseDelayMs = baseDelayMs;
        this.#maxDelayMs = maxDelayMs;
    }

    async execute({ engine, tabId, signal, log, operation }) {
        for (let attempt = 0; attempt <= this.#maxAttempts; attempt++) {
            const preDelay = this.#getEngineBackoffDelay(engine);
            if (preDelay > 0) {
                log.push(`Engine cooldown before retry: ${Math.ceil(preDelay)}ms`);
                await this.#notifyRetry(tabId, { engine, delayMs: preDelay, attempt, error: null });
                await this.#sleep(preDelay, signal);
            }

            try {
                const result = await operation();
                this.#clearBackoff(engine);
                await this.#notifyRetry(tabId, { engine, delayMs: 0, attempt, error: null });
                return result;
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                if (!this.#isRetryableError(error) || attempt >= this.#maxAttempts) {
                    throw error;
                }

                const delayMs = this.#recordBackoff(engine, attempt, error);
                log.push(`Retryable translation error. Attempt ${attempt + 1}/${this.#maxAttempts}. Backing off ${delayMs}ms.`);
                await this.#notifyRetry(tabId, { engine, delayMs, attempt: attempt + 1, error });
                await this.#sleep(delayMs, signal);
            }
        }

        throw new Error('Retry loop exited unexpectedly.');
    }

    #isRetryableError(error) {
        const message = String(error?.message || '').toLowerCase();
        return message.includes('429') ||
            message.includes('rate limit') ||
            message.includes('too many requests') ||
            message.includes('timeout') ||
            message.includes('network') ||
            message.includes('temporarily') ||
            message.includes('503') ||
            message.includes('502');
    }

    #getEngineBackoffDelay(engine) {
        const state = this.#engineBackoffState.get(engine);
        if (!state) return 0;
        return Math.max(0, state.until - Date.now());
    }

    async #sleep(ms, signal) {
        if (ms <= 0) return;
        if (signal?.aborted) {
            throw new DOMException('Translation was interrupted by the user.', 'AbortError');
        }

        await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            const handleAbort = () => {
                clearTimeout(timer);
                reject(new DOMException('Translation was interrupted by the user.', 'AbortError'));
            };
            signal?.addEventListener?.('abort', handleAbort, { once: true });
        });
    }

    #recordBackoff(engine, attempt, error) {
        const previous = this.#engineBackoffState.get(engine);
        const failures = previous?.failures ?? 0;
        const jitter = Math.floor(Math.random() * 250);
        const delayMs = Math.min(
            this.#maxDelayMs,
            this.#baseDelayMs * Math.pow(2, Math.max(failures, attempt)) + jitter
        );
        this.#engineBackoffState.set(engine, {
            failures: failures + 1,
            until: Date.now() + delayMs,
            lastError: error?.message || String(error),
        });
        return delayMs;
    }

    #clearBackoff(engine) {
        this.#engineBackoffState.delete(engine);
    }

    async #notifyRetry(tabId, { engine, delayMs, attempt, error }) {
        if (!tabId || !this.#browser.tabs?.sendMessage) return;

        try {
            await this.#browser.tabs.sendMessage(tabId, {
                type: MESSAGE_TYPES.TRANSLATION_RETRY_SCHEDULED,
                payload: {
                    engine,
                    delayMs,
                    attempt,
                    error: error?.message || null,
                },
            });
        } catch (notifyError) {
            if (!notifyError.message?.includes('Receiving end does not exist')) {
                console.warn('[TranslatorManager] Failed to notify retry state:', notifyError);
            }
        }
    }
}
