import browser from '../../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../../common/message-types.js';
import { replaceTextContent } from './input-text-utils.js';

export class InputTranslationClient {
    // 每个输入框最近一次请求的代次。
    //
    // 用户连续敲完一句再改一个字，两个请求会同时在途；谁先回来谁就写，于是旧译文会盖掉
    // 新译文（尤其是 AI 引擎，响应时长跨度可达数秒）。代次比对把"结果是否还属于当前的
    // 输入状态"变成显式条件，而不是靠时间先后运气。
    #generations = new WeakMap();

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

        const generation = (this.#generations.get(target) || 0) + 1;
        this.#generations.set(target, generation);
        const isCurrent = () => this.#generations.get(target) === generation;

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

            // 期间用户又发起了一次翻译：这条结果已经过期，写入就是回退用户的新输入。
            if (!isCurrent()) return;

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
            if (isCurrent()) {
                console.error('[Foxlate] Input translation failed.', error);
            }
        } finally {
            // 只有最后一次请求才有权关闭指示器，否则旧请求先结束会把新请求的进度显示抹掉。
            if (isCurrent()) {
                indicator.hide();
            }
        }
    }
}
