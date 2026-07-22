import browser from '../../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../../common/message-types.js';
import { replaceTextContent } from './input-text-utils.js';

export class InputTranslationClient {
    constructor({ browserApi = browser, documentRef = document } = {}) {
        this.browser = browserApi;
        this.document = documentRef;
    }

    async translateAndReplace({ target, text, targetLangOverride = null, replaceRange = null, indicator }) {
        if (!text?.trim()) return;

        if (text.length > 5000) {
            console.warn('[Foxlate] Text too long for translation:', text.length);
            return;
        }

        indicator.show(target);

        try {
            const payload = {
                text,
                source: 'inputHandler',
                timestamp: Date.now(),
            };
            if (targetLangOverride) {
                payload.targetLang = targetLangOverride;
            }

            const result = await this.browser.runtime.sendMessage({
                type: MESSAGE_TYPES.TRANSLATE_INPUT_TEXT,
                payload,
            });

            if (result?.translatedText) {
                replaceTextContent(target, result.translatedText, replaceRange);
                // Prefer the document's own CustomEvent (jsdom-safe when global CustomEvent is wrong realm).
                const EventCtor = this.document.defaultView?.CustomEvent || globalThis.CustomEvent;
                if (typeof EventCtor === 'function') {
                    this.document.dispatchEvent(new EventCtor('foxlate:inputTranslated', {
                        detail: {
                            target,
                            originalText: text,
                            translatedText: result.translatedText,
                            targetLang: targetLangOverride,
                        },
                    }));
                }
            } else if (result?.error) {
                console.error('[Foxlate] Translation error:', result.error);
            }
        } catch (error) {
            console.error('[Foxlate] Input translation failed.', error);
        } finally {
            indicator.hide();
        }
    }
}
