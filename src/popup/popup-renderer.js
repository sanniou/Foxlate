import browser from '../lib/browser-polyfill.js';
import * as Constants from '../common/constants.js';
import { uiTextLayoutService } from '../common/ui-text-layout-service.js';

export class PopupRenderer {
    constructor(elements, { browserApi = browser, layoutService = uiTextLayoutService } = {}) {
        this.elements = elements;
        this.browser = browserApi;
        this.layoutService = layoutService;
    }

    applyTranslations(root = document) {
        root.documentElement.lang = this.browser.i18n.getUILanguage();
        const i18nElements = root.querySelectorAll('[i18n-text]');
        i18nElements.forEach(element => {
            const key = element.getAttribute('i18n-text');
            const message = this.browser.i18n.getMessage(key);
            if (!message) return;

            const textElement = element.matches('button') ? element.querySelector('.btn-text') : element;
            if (textElement) {
                textElement.textContent = message;
            }
        });
        this.layoutService.applyTree(root);
    }

    renderVersion(version) {
        this.elements.versionDisplay.textContent = `v${version}`;
    }

    populateSelect(selectElement, options, selectedValue) {
        selectElement.innerHTML = '';
        for (const [value, i18nKey] of Object.entries(options)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = this.browser.i18n.getMessage(i18nKey) || i18nKey;
            option.selected = value === selectedValue;
            selectElement.appendChild(option);
        }
        this.layoutService.applyElement(selectElement, { paddingX: 36 });
    }

    populateStaticSelects() {
        this.populateSelect(this.elements.subtitleDisplayModeSelect, Constants.SUBTITLE_DISPLAY_MODES);
        // Display modes use segmented control in the popup (see renderDisplayMode).
    }

    renderDisplayMode(displayMode) {
        const buttons = this.elements.displayModeButtons || [];
        for (const button of buttons) {
            const active = button.dataset.mode === displayMode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-checked', active ? 'true' : 'false');
        }
    }

    renderEffectiveSettings(settings) {
        const allSupportedEngines = {
            ...Constants.SUPPORTED_ENGINES,
            ...(settings.aiEngines || []).reduce((acc, engine) => ({
                ...acc,
                [`ai:${engine.id}`]: engine.name,
            }), {}),
        };

        this.populateSelect(this.elements.engineSelect, allSupportedEngines, settings.translatorEngine);
        this.populateSelect(this.elements.sourceLanguageSelect, Constants.SUPPORTED_LANGUAGES, settings.sourceLanguage);

        const targetLanguages = { ...Constants.SUPPORTED_LANGUAGES };
        delete targetLanguages.auto;
        this.populateSelect(this.elements.targetLanguageSelect, targetLanguages, settings.targetLanguage);

        this.renderDisplayMode(settings.displayMode || Constants.DEFAULT_SETTINGS.displayMode);
        this.renderGlossaryIndicator(settings);
    }

    renderRuleIndicator(ruleSource) {
        if (ruleSource === 'default' || !ruleSource) {
            this.elements.currentRuleIndicator.textContent =
                this.browser.i18n.getMessage('popupRuleDefault') || 'Using default settings';
            return;
        }
        const siteLabel = this.browser.i18n.getMessage('popupRuleSite') || 'Site';
        this.elements.currentRuleIndicator.textContent = `${siteLabel} · ${ruleSource}`;
    }

    renderGlossaryIndicator(settings = {}) {
        const el = this.elements.glossaryIndicator;
        if (!el) return;
        const glossary = settings.glossary || {};
        const entries = Array.isArray(glossary.entries) ? glossary.entries : [];
        const on = glossary.enabled !== false && entries.length > 0;
        el.hidden = !on;
        if (on) {
            el.textContent = this.browser.i18n.getMessage('popupGlossaryOn') || 'Glossary on';
        }
    }

    renderTranslationButtonState(state = 'original') {
        const button = this.elements.translatePageBtn;
        const buttonText = button.querySelector('.btn-text');
        if (!buttonText) return;

        button.classList.remove('loading', 'revert');
        button.dataset.state = state;

        switch (state) {
            case 'loading':
            case 'translated':
                buttonText.textContent = this.browser.i18n.getMessage('popupShowOriginal');
                button.classList.add('revert');
                break;
            default:
                buttonText.textContent = this.browser.i18n.getMessage('popupTranslatePage');
                break;
        }

        this.layoutService.applyElement(button, { minWidth: 160, paddingX: 40 });
    }

    setPageControlsEnabled(enabled, hasHostname) {
        this.elements.translatePageBtn.disabled = !enabled;
        for (const button of this.elements.displayModeButtons || []) {
            button.disabled = !enabled || !hasHostname;
        }
        this.elements.displayModeGroup?.classList.toggle('is-disabled', !enabled || !hasHostname);
        this.elements.sourceLanguageSelect.disabled = !enabled;
        this.elements.targetLanguageSelect.disabled = !enabled;
        this.elements.engineSelect.disabled = !enabled;
        this.elements.autoTranslateCheckbox.disabled = !enabled || !hasHostname;
        this.elements.scrollIdleTranslationCheckbox.disabled = !enabled || !hasHostname;
    }

    renderRuleControls(settings, hasHostname) {
        this.elements.autoTranslateCheckbox.disabled = !hasHostname;
        this.elements.autoTranslateCheckbox.checked = settings.autoTranslate === 'always';
        this.elements.scrollIdleTranslationCheckbox.disabled = !hasHostname;
        this.elements.scrollIdleTranslationCheckbox.checked = settings.translateAfterScrollIdle !== false;
    }

    hideSubtitleControls() {
        this.elements.subtitleControlsSection.style.display = 'none';
    }

    renderSubtitleControls({ isSupported, settings }) {
        if (isSupported && settings.subtitleSettings?.enabled) {
            this.elements.subtitleControlsSection.style.display = '';
            this.elements.subtitleDisplayModeSelect.value = settings.subtitleSettings.displayMode || 'off';
            return;
        }
        this.hideSubtitleControls();
    }

    renderError(message) {
        if (!message) {
            this.elements.errorDisplay.style.display = 'none';
            this.elements.errorDisplay.textContent = '';
            return;
        }
        this.elements.errorDisplay.textContent = message;
        this.elements.errorDisplay.style.display = 'block';
    }

    applyLayout(root = document) {
        this.layoutService.applyTree(root);
    }
}
