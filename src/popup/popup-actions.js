import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { SettingsManager } from '../common/settings-manager.js';

export function getHostname(url) {
    try {
        if (!url || !url.startsWith('http')) {
            return null;
        }
        return new URL(url).hostname;
    } catch (error) {
        console.error(`[Popup] Could not parse hostname from URL: "${url}"`, error);
        return null;
    }
}

export class PopupActions {
    constructor({ elements, renderer, state, browserApi = browser, settingsManager = SettingsManager }) {
        this.elements = elements;
        this.renderer = renderer;
        this.state = state;
        this.browser = browserApi;
        this.settingsManager = settingsManager;
    }

    async loadAndApplySettings() {
        const [tab] = await this.browser.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;

        this.state.activeTabId = tab.id;
        this.state.currentHostname = getHostname(tab.url);

        const finalRule = await this.browser.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_EFFECTIVE_SETTINGS,
            payload: { hostname: this.state.currentHostname },
        });

        this.state.currentRuleSource = finalRule.source;
        this.renderer.renderEffectiveSettings(finalRule);
        this.renderer.renderRuleControls(finalRule, Boolean(this.state.currentHostname));
        await this.#loadSubtitleControls(finalRule);
        this.renderer.renderRuleIndicator(this.state.currentRuleSource);
        await this.updateButtonStateFromContentScript();
        this.renderer.applyLayout();
    }

    async updateButtonStateFromContentScript() {
        if (!this.state.activeTabId) return;

        this.renderer.setPageControlsEnabled(false, Boolean(this.state.currentHostname));
        this.renderer.renderTranslationButtonState('original');
        this.renderer.renderError(null);

        try {
            const response = await this.browser.tabs.sendMessage(this.state.activeTabId, {
                type: MESSAGE_TYPES.REQUEST_TRANSLATION_STATUS,
            });

            if (!response?.state) {
                throw new Error('Invalid response from content script.');
            }

            this.renderer.setPageControlsEnabled(true, Boolean(this.state.currentHostname));
            this.renderer.renderTranslationButtonState(response.state);

            // Soft notices when a job finished without useful output.
            if (response.state === 'translated' && response.emptyCandidates) {
                this.renderer.renderError(
                    this.browser.i18n.getMessage('popupEmptyCandidates')
                    || 'No translatable text found on this page. Adjust content selectors in Options if needed.',
                );
            } else if (response.state === 'translated' && response.allPrecheckSkipped) {
                this.renderer.renderError(
                    this.browser.i18n.getMessage('popupAllPrecheckSkipped')
                    || 'Found text, but built-in filters skipped all of it (same language, URLs, code, …).',
                );
            }
        } catch (error) {
            if (error.message.includes('Receiving end does not exist')) {
                this.renderer.renderError(
                    this.browser.i18n.getMessage('popupTranslationNotAvailable') ||
                    'Translation is not available on this page.'
                );
            } else {
                console.error(`[Popup] Failed to get translation status from content script for tab ${this.state.activeTabId}:`, error);
                this.renderer.renderError(`Error: ${error.message}`);
            }
        }
    }

    async saveChangeToRule(key, value) {
        if (!this.state.currentHostname) {
            console.warn('[Popup] Cannot save rule change, no active hostname.');
            return;
        }

        const domainToUpdate = this.state.currentRuleSource === 'default'
            ? this.state.currentHostname
            : this.state.currentRuleSource;

        await this.settingsManager.saveDomainRuleProperty(domainToUpdate, key, value);
        this.#markSiteRuleActive(domainToUpdate);
    }

    /** After any site-scoped write, surface the hostname as the active rule source. */
    #markSiteRuleActive(domain) {
        if (!domain) return;
        this.state.currentRuleSource = domain;
        this.renderer.renderRuleIndicator(domain);
    }

    async handleTranslateButtonClick() {
        if (!this.state.activeTabId) return;

        try {
            this.elements.translatePageBtn.disabled = true;
            await this.browser.runtime.sendMessage({
                type: MESSAGE_TYPES.TOGGLE_TRANSLATION_REQUEST,
                payload: { tabId: this.state.activeTabId },
            });
        } catch (error) {
            console.error('[Popup] Error during toggle translation request:', error);
            await this.updateButtonStateFromContentScript();
        }
    }

    async handleSwapLanguages() {
        const currentSource = this.elements.sourceLanguageSelect.value;
        const currentTarget = this.elements.targetLanguageSelect.value;

        this.elements.sourceLanguageSelect.value = currentTarget;
        this.elements.targetLanguageSelect.value = currentSource;

        await this.saveChangeToRule('sourceLanguage', currentTarget);
        await this.saveChangeToRule('targetLanguage', currentSource);
    }

    async handleAutoTranslateChange(isEnabled) {
        const newValue = isEnabled ? 'always' : 'manual';
        await this.saveChangeToRule('autoTranslate', newValue);

        if (isEnabled && this.elements.translatePageBtn.dataset.state === 'original') {
            await this.handleTranslateButtonClick();
        }
    }

    async handleDisplayModeChange(displayMode) {
        if (!displayMode) return;

        this.renderer.renderDisplayMode(displayMode);
        await this.saveChangeToRule('displayMode', displayMode);

        if (!this.state.activeTabId) return;

        try {
            await this.browser.tabs.sendMessage(this.state.activeTabId, {
                type: MESSAGE_TYPES.UPDATE_DISPLAY_MODE,
                payload: { displayMode },
            });
        } catch (error) {
            if (!error.message.includes('Receiving end does not exist')) {
                console.warn(`[Popup] Could not immediately update display mode on tab ${this.state.activeTabId}:`, error);
            }
        }
    }

    async handleRuntimeMessage(request) {
        if (request.type === MESSAGE_TYPES.SETTINGS_UPDATED || request.type === MESSAGE_TYPES.RELOAD_TRANSLATION_JOB) {
            await this.loadAndApplySettings();
            await this.updateButtonStateFromContentScript();
            return;
        }

        if (request.type === MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE && request.payload.tabId === this.state.activeTabId) {
            this.renderer.setPageControlsEnabled(true, Boolean(this.state.currentHostname));
            await this.updateButtonStateFromContentScript();
        }
    }

    async #loadSubtitleControls(finalRule) {
        this.renderer.hideSubtitleControls();

        try {
            const status = await this.browser.tabs.sendMessage(this.state.activeTabId, {
                type: MESSAGE_TYPES.REQUEST_SUBTITLE_TRANSLATION_STATUS,
            });
            this.renderer.renderSubtitleControls({
                isSupported: Boolean(status?.isSupported),
                settings: finalRule,
            });
        } catch (error) {
            if (!error.message.includes('Receiving end does not exist')) {
                console.warn('[Popup] Could not get subtitle translation status from content script. Keeping subtitle control hidden.', error);
            }
        }
    }
}
