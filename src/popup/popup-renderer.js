import browser from '../lib/browser-polyfill.js';
import * as Constants from '../common/constants.js';
import { applyI18nAttributes } from '../common/i18n-dom.js';
import { uiTextLayoutService } from '../common/ui-text-layout-service.js';

export class PopupRenderer {
    constructor(elements, { browserApi = browser, layoutService = uiTextLayoutService } = {}) {
        this.elements = elements;
        this.browser = browserApi;
        this.layoutService = layoutService;
    }

    applyTranslations(root = document) {
        root.documentElement.lang = this.browser.i18n.getUILanguage();
        // 主按钮的可见文字被图标/加载态挤在 .btn-text 里，只能改那个 span，
        // 否则 textContent 会把 spinner 一起清掉。没有 .btn-text 的元素
        // （例如分段按钮）直接改自己——旧实现写死了 `matches('button')`，
        // 于是分段按钮找不到 .btn-text 就被静默跳过，永远不会本地化。
        applyI18nAttributes(root, {
            browserApi: this.browser,
            resolveTextTarget: element => element.querySelector('.btn-text') ?? element,
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

        // Map page-job states → CTA chrome states.
        const chromeState = state === 'translating' ? 'loading'
            : state === 'translated' ? 'translated'
            : 'original';

        button.classList.remove('loading', 'revert');
        button.dataset.state = chromeState;

        switch (chromeState) {
            case 'loading':
                buttonText.textContent = this.browser.i18n.getMessage('popupTranslating')
                    || 'Translating…';
                button.classList.add('loading');
                break;
            case 'translated':
                buttonText.textContent = this.browser.i18n.getMessage('popupShowOriginal')
                    || 'Show original';
                button.classList.add('revert');
                break;
            default:
                buttonText.textContent = this.browser.i18n.getMessage('popupTranslatePage');
                break;
        }

        // Dense CTA: avoid inflating measured min-width past the popup column.
        this.layoutService.applyElement(button, { minWidth: 140, paddingX: 28 });
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

    /**
     * 只启用「翻译此页」主按钮。
     *
     * 内容脚本还没注入时（刚安装/刚更新/Chrome 站点访问=点击时），其它控件都无处可用，
     * 但主按钮必须能点：后台的 TOGGLE_TRANSLATION_REQUEST 会先补注入再开始翻译。
     * 之前这里把按钮一起禁掉，用户装完扩展后每次打开 popup 只能看到「此页不可翻译」，
     * 而且没有任何下一步。
     */
    setTranslateButtonEnabled(enabled) {
        this.elements.translatePageBtn.disabled = !enabled;
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
