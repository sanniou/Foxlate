import browser from '../../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../../common/message-types.js';

export class SubtitleTranslationClient {
    constructor({
        browserApi = browser,
        windowRef = window,
    } = {}) {
        this.browser = browserApi;
        this.window = windowRef;
    }

    async translate(text) {
        const effectiveSettings = await this.window.getEffectiveSettings?.();
        if (!effectiveSettings) {
            throw new Error('Could not get effective settings.');
        }

        return this.browser.runtime.sendMessage({
            type: MESSAGE_TYPES.TRANSLATE_TEXT,
            payload: {
                text,
                targetLang: effectiveSettings.targetLanguage,
                sourceLang: 'auto',
                translatorEngine: effectiveSettings.translatorEngine,
            },
        });
    }

    getErrorText(error) {
        const errorPrefix = this.browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
        return `${errorPrefix}: ${error.message}`;
    }
}
