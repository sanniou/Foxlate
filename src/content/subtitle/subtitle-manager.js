import browser from '../../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../../common/message-types.js';
import { logContentError } from '../content-logger.js';
import { SubtitleRenderer } from './subtitle-renderer.js';
import { SubtitleTranslationClient } from './subtitle-translation-client.js';
import { waitForEffectiveSettings } from './subtitle-settings-readiness.js';

export class SubtitleManager {
    constructor({
        browserApi = browser,
        windowRef = window,
        renderer = new SubtitleRenderer(),
        translationClient = new SubtitleTranslationClient({ browserApi, windowRef }),
        logError = logContentError,
    } = {}) {
        this.browser = browserApi;
        this.window = windowRef;
        this.renderer = renderer;
        this.translationClient = translationClient;
        this.logError = logError;
        this.strategy = null;
        this.isEnabled = false;
        this.#addMessageListener();
    }

    async registerStrategy(StrategyClass) {
        if (this.strategy) {
            console.warn(`[SubtitleManager] A strategy is already registered. Ignoring new registration for ${StrategyClass.name}.`);
            return;
        }

        this.strategy = new StrategyClass(this.onSubtitleChange.bind(this));
        await this.#checkAndAutoEnable();
    }

    async onSubtitleChange(text, element) {
        try {
            const response = await this.translationClient.translate(text);
            if (response.success && response.translatedText.translated) {
                this.renderer.displayTranslatedSubtitle(element, response.translatedText.text);
            } else if (response.error) {
                const errorPrefix = this.browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                this.renderer.displayTranslatedSubtitle(element, `${errorPrefix}: ${response.error}`, true);
            }
        } catch (error) {
            this.logError('subtitleTranslationCallback', error);
            this.renderer.displayTranslatedSubtitle(element, this.translationClient.getErrorText(error), true);
        }
    }

    updateSettings(newSettings) {
        if (this.strategy && typeof this.strategy.updateSettings === 'function') {
            this.strategy.updateSettings(newSettings);
        }
    }

    toggle(enabled) {
        this.isEnabled = enabled;
        if (!this.strategy) return;

        if (enabled) {
            this.strategy.initialize();
        } else {
            this.strategy.cleanup();
        }
    }

    getStatus() {
        return {
            isSupported: Boolean(this.strategy),
            isEnabled: this.isEnabled,
        };
    }

    cleanup() {
        if (this.strategy) {
            this.strategy.cleanup();
            this.isEnabled = false;
        }
    }

    async #checkAndAutoEnable() {
        const isReady = await waitForEffectiveSettings(this.window);
        if (!isReady) {
            this.logError('SubtitleManager.checkAndAutoEnable', new Error('getEffectiveSettings did not become available.'));
            return;
        }

        try {
            const settings = await this.window.getEffectiveSettings();
            if (settings?.subtitleSettings?.enabled) {
                this.toggle(true);
            }
        } catch (error) {
            this.logError('SubtitleManager.checkAndAutoEnable', error);
        }
    }

    #addMessageListener() {
        this.browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === MESSAGE_TYPES.REQUEST_SUBTITLE_TRANSLATION_STATUS) {
                sendResponse(this.getStatus());
                return true;
            }
            return false;
        });
    }
}

export function initializeSubtitleManager() {
    window.subtitleManager = new SubtitleManager();
    return window.subtitleManager;
}

initializeSubtitleManager();
