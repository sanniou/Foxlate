import browser from '../../lib/browser-polyfill.js';
import { BaseComponent } from './BaseComponent.js';
import { FormValidator } from '../validator.js';
import { escapeHtml } from '../../common/utils.js';
import * as Constants from '../../common/constants.js';
import { ELEMENT_IDS } from '../ui-constants.js';
import {
    populateEngineSelect,
    populateLanguageOptions,
    populateAutoTranslateOptions,
    populateDisplayModeOptions,
    populateSubtitleDisplayModeOptions,
    populateSubtitleStrategyOptions
} from '../ui-helpers.js';

export class DomainRuleModal extends BaseComponent {
    #elements;
    #validator;
    #state = {
        isOpen: false,
        editingRule: null,
        originalDomain: null,
        allAiEngines: [], // 需要从外部传入，用于填充下拉框
    };

    constructor(elements) {
        super();
        this.#elements = elements;
        this.#validator = new FormValidator(this.#elements.domainRuleForm, {
            'ruleDomain': { rules: 'required', labelKey: 'domain' },
            'ruleCharThreshold': { rules: 'required', labelKey: 'charThresholdLabel' }
        });
        this.#bindEvents();
    }

    isOpen() {
        return this.#state.isOpen;
    }

    open(domain, ruleData = {}, allAiEngines = []) {
        this.#state.originalDomain = domain || null;
        this.#state.editingRule = JSON.parse(JSON.stringify(ruleData));
        if (!this.#state.editingRule.domain) this.#state.editingRule.domain = domain || '';
        this.#state.allAiEngines = allAiEngines;
        this.#state.isOpen = true;
        this.#render();
    }

    updateEngines(newEngines) {
        this.#state.allAiEngines = newEngines;
        if (this.#state.isOpen) {
            // Re-populate dropdowns that depend on AI engines if the modal is open
            this.#populateDropdowns();
        }
    }

    close() {
        this.#state.isOpen = false;
        this.#state.editingRule = null;
        this.#state.originalDomain = null;
        this.#render();
    }

    #render() {
        const { isOpen, editingRule } = this.#state;
        const modal = this.#elements.domainRuleModal;

        if (isOpen && editingRule) {
            this.#elements.domainRuleFormTitle.textContent = this.#state.originalDomain ? browser.i18n.getMessage('editDomainRule') : browser.i18n.getMessage('addDomainRule');
            this.#elements.ruleDomainInput.value = editingRule.domain || '';
            this.#elements.ruleApplyToSubdomainsCheckbox.checked = editingRule.applyToSubdomains !== false;
            this.#elements.ruleAutoTranslateSelect.value = editingRule.autoTranslate || 'default';
            this.#elements.ruleTranslatorEngineSelect.value = editingRule.translatorEngine || 'default';
            this.#elements.ruleTargetLanguageSelect.value = editingRule.targetLanguage || 'default';
            this.#elements.ruleSourceLanguageSelect.value = editingRule.sourceLanguage || 'default';
            this.#elements.ruleDisplayModeSelect.value = editingRule.displayMode || 'default';
            const selector = editingRule.cssSelector || {};
            this.#elements.ruleContentSelector.value = selector.content || '';
            this.#elements.ruleExcludeSelectorTextarea.value = selector.exclude || '';
            this.#elements.ruleCssSelectorOverrideCheckbox.checked = editingRule.cssSelectorOverride || false;
            const subtitleSettings = editingRule.subtitleSettings || {};
            this.#elements.ruleEnableSubtitleCheckbox.checked = subtitleSettings.enabled || false;
            this.#elements.ruleSubtitleStrategySelect.value = subtitleSettings.strategy || 'none';
            this.#elements.ruleSubtitleDisplayMode.value = subtitleSettings.displayMode || 'off';
            this.#elements.ruleSubtitleSettingsGroup.style.display = this.#elements.ruleEnableSubtitleCheckbox.checked ? 'block' : 'none';
            const summarySettings = editingRule.summarySettings || {};
            this.#elements.ruleEnableSummary.checked = summarySettings.enabled || false;
            this.#elements.ruleMainBodySelector.value = summarySettings.mainBodySelector || '';
            this.#elements.ruleSummaryAiModel.value = summarySettings.aiModel || '';
            this.#elements.ruleCharThreshold.value = summarySettings.charThreshold !== undefined ? summarySettings.charThreshold : Constants.DEFAULT_SETTINGS.summarySettings.charThreshold;
            this.#elements.ruleSummarySettingsGroup.style.display = this.#elements.ruleEnableSummary.checked ? 'block' : 'none';

            this.#populateDropdowns();
            this.#openModal(modal);
            this.#elements.domainRuleModal.querySelectorAll('.m3-form-field.filled select').forEach(this.#initializeSelectLabel);
            this.#validator.clearAllErrors();
        } else {
            this.#closeModal(modal);
        }
    }

    #populateDropdowns() {
        populateEngineSelect(this.#elements.ruleTranslatorEngineSelect, { includeDefault: true, allEngines: this.#state.allAiEngines });
        populateEngineSelect(this.#elements.ruleSummaryAiModel, { includeDefault: false, onlyAi: true, allEngines: this.#state.allAiEngines });

        populateLanguageOptions(this.#elements.ruleTargetLanguageSelect, { includeDefault: true });
        populateLanguageOptions(this.#elements.ruleSourceLanguageSelect, { includeDefault: true, includeAuto: true });

        populateAutoTranslateOptions(this.#elements.ruleAutoTranslateSelect, true);
        populateDisplayModeOptions(this.#elements.ruleDisplayModeSelect, true);

        populateSubtitleStrategyOptions(this.#elements.ruleSubtitleStrategySelect);
        populateSubtitleDisplayModeOptions(this.#elements.ruleSubtitleDisplayMode);
    }

    #handleInputChange(e) {
        if (!this.#state.editingRule) return;
        const target = e.target;
        const id = target.id;
        const value = target.type === 'checkbox' ? target.checked : target.value;

        const updater = {
            [ELEMENT_IDS.RULE_DOMAIN_INPUT]: (val) => this.#state.editingRule.domain = val,
            [ELEMENT_IDS.RULE_APPLY_TO_SUBDOMAINS_CHECKBOX]: (val) => this.#state.editingRule.applyToSubdomains = val,
            [ELEMENT_IDS.RULE_AUTO_TRANSLATE_SELECT]: (val) => this.#state.editingRule.autoTranslate = val,
            [ELEMENT_IDS.RULE_TRANSLATOR_ENGINE_SELECT]: (val) => this.#state.editingRule.translatorEngine = val,
            [ELEMENT_IDS.RULE_TARGET_LANGUAGE_SELECT]: (val) => this.#state.editingRule.targetLanguage = val,
            [ELEMENT_IDS.RULE_SOURCE_LANGUAGE_SELECT]: (val) => this.#state.editingRule.sourceLanguage = val,
            [ELEMENT_IDS.RULE_DISPLAY_MODE_SELECT]: (val) => this.#state.editingRule.displayMode = val,
            [ELEMENT_IDS.RULE_CSS_SELECTOR_OVERRIDE_CHECKBOX]: (val) => this.#state.editingRule.cssSelectorOverride = val,
            [ELEMENT_IDS.RULE_CONTENT_SELECTOR]: (val) => {
                if (!this.#state.editingRule.cssSelector) this.#state.editingRule.cssSelector = {};
                this.#state.editingRule.cssSelector.content = val;
            },
            [ELEMENT_IDS.RULE_EXCLUDE_SELECTOR_TEXTAREA]: (val) => {
                if (!this.#state.editingRule.cssSelector) this.#state.editingRule.cssSelector = {};
                this.#state.editingRule.cssSelector.exclude = val;
            },
            [ELEMENT_IDS.RULE_ENABLE_SUBTITLE_CHECKBOX]: (val) => {
                if (!this.#state.editingRule.subtitleSettings) this.#state.editingRule.subtitleSettings = {};
                this.#state.editingRule.subtitleSettings.enabled = val;
                this.#elements.ruleSubtitleSettingsGroup.style.display = val ? 'block' : 'none';
            },
            [ELEMENT_IDS.RULE_SUBTITLE_STRATEGY_SELECT]: (val) => {
                if (!this.#state.editingRule.subtitleSettings) this.#state.editingRule.subtitleSettings = {};
                this.#state.editingRule.subtitleSettings.strategy = val;
            },
            [ELEMENT_IDS.RULE_SUBTITLE_DISPLAY_MODE]: (val) => {
                if (!this.#state.editingRule.subtitleSettings) this.#state.editingRule.subtitleSettings = {};
                this.#state.editingRule.subtitleSettings.displayMode = val;
            },
            [ELEMENT_IDS.RULE_ENABLE_SUMMARY]: (val) => {
                if (!this.#state.editingRule.summarySettings) this.#state.editingRule.summarySettings = {};
                this.#state.editingRule.summarySettings.enabled = val;
                this.#elements.ruleSummarySettingsGroup.style.display = val ? 'block' : 'none';

                // If summary is being enabled and no AI model is set,
                // set it to the current value of the dropdown (which defaults to the first option).
                if (val && !this.#state.editingRule.summarySettings.aiModel) {
                    const aiModelSelect = this.#elements.ruleSummaryAiModel;
                    if (aiModelSelect.value) {
                        this.#state.editingRule.summarySettings.aiModel = aiModelSelect.value;
                    }
                }
            },
            [ELEMENT_IDS.RULE_MAIN_BODY_SELECTOR]: (val) => {
                if (!this.#state.editingRule.summarySettings) this.#state.editingRule.summarySettings = {};
                this.#state.editingRule.summarySettings.mainBodySelector = val;
            },
            [ELEMENT_IDS.RULE_SUMMARY_AI_MODEL]: (val) => {
                if (!this.#state.editingRule.summarySettings) this.#state.editingRule.summarySettings = {};
                this.#state.editingRule.summarySettings.aiModel = val;
            },
            [ELEMENT_IDS.RULE_CHAR_THRESHOLD]: (val) => {
                if (!this.#state.editingRule.summarySettings) this.#state.editingRule.summarySettings = {};
                const threshold = parseInt(val, 10);
                this.#state.editingRule.summarySettings.charThreshold = !isNaN(threshold) && threshold >= 0 ? threshold : Constants.DEFAULT_SETTINGS.summarySettings.charThreshold;
            }
        }[id];
        if (updater) updater(value);
    }

    #validateCssSelectorInput(inputElement) {
        const field = inputElement.closest('.m3-form-field');
        if (!field) return true;

        const errorEl = field.querySelector('.error-message');
        const selectorValue = inputElement.value.trim();

        field.classList.remove('is-invalid');
        if (errorEl) errorEl.textContent = '';

        if (selectorValue) {
            try {
                document.querySelector(selectorValue);
            } catch (e) {
                field.classList.add('is-invalid');
                if (errorEl) errorEl.textContent = browser.i18n.getMessage('invalidCssSelector');
                return false;
            }
        }
        return true;
    }

    #saveRule() {
        const isDomainValid = this.#validator.validate();
        const isContentValid = this.#validateCssSelectorInput(this.#elements.ruleContentSelector);
        const isExcludeValid = this.#validateCssSelectorInput(this.#elements.ruleExcludeSelectorTextarea);
        const isMainBodyValid = this.#validateCssSelectorInput(this.#elements.ruleMainBodySelector);

        // Add charThreshold validation
        let isCharThresholdValid = true;
        const charThresholdElement = this.#elements.ruleCharThreshold;
        const charThresholdValue = charThresholdElement.value.trim();
        const parsedThreshold = parseInt(charThresholdValue, 10);

        if (charThresholdValue === '' || isNaN(parsedThreshold) || parsedThreshold < 0) {
            this.#validator.setError(charThresholdElement, browser.i18n.getMessage('charThresholdInvalid') || 'Character threshold must be a non-negative number.');
            isCharThresholdValid = false;
        } else {
            // Clear any previous error for charThreshold if it's now valid
            const field = charThresholdElement.closest('.m3-form-field');
            if (field) {
                field.classList.remove('is-invalid');
                const errorDiv = field.querySelector('.error-message');
                if (errorDiv) errorDiv.textContent = '';
            }
        }


        if (!isDomainValid || !isContentValid || !isExcludeValid || !isMainBodyValid || !isCharThresholdValid) {
            const firstInvalidField = this.#elements.domainRuleModal.querySelector('.m3-form-field.is-invalid');
            if (firstInvalidField) {
                firstInvalidField.classList.add('error-shake');
                setTimeout(() => firstInvalidField.classList.remove('error-shake'), 500);
            }
            return;
        }

        this.emit('save', { rule: this.#state.editingRule, originalDomain: this.#state.originalDomain });
        this.close();
    }

    #bindEvents() {
        this.#elements.domainRuleModal.addEventListener('click', (e) => {
            const target = e.target;
            if (target.id === this.#elements.saveDomainRuleBtn.id) {
                this.#saveRule();
            } else if (target.id === this.#elements.cancelDomainRuleBtn.id || target.closest('.close-button')) {
                this.close();
            }
        });

        this.#elements.domainRuleModal.addEventListener('input', (e) => this.#handleInputChange(e));
        this.#elements.domainRuleModal.addEventListener('change', (e) => this.#handleInputChange(e));
    }

    #openModal(modalElement) {
        document.body.classList.add('modal-open');
        modalElement.style.display = 'flex';
        modalElement.offsetWidth; // Trigger reflow
        modalElement.classList.add('is-visible');
        const scrollableContent = modalElement.querySelector('#domainRuleForm, .modal-scroll-content');
        if (scrollableContent) scrollableContent.scrollTop = 0;
        else modalElement.scrollTop = 0;
    }

    #closeModal(modalElement) {
        if (!modalElement.classList.contains('is-visible')) return;

        modalElement.classList.remove('is-visible');
        const onTransitionEnd = () => {
            modalElement.style.display = 'none';
            modalElement.removeEventListener('transitionend', onTransitionEnd);
            if (document.querySelectorAll('.modal.is-visible').length === 0) {
                document.body.classList.remove('modal-open');
            }
        };
        modalElement.addEventListener('transitionend', onTransitionEnd);
    }

    #initializeSelectLabel(selectEl) {
        const parentField = selectEl.closest('.m3-form-field.filled');
        if (!parentField) return;
        const update = () => parentField.classList.toggle('is-filled', !!selectEl.value);
        update();
        selectEl.addEventListener('change', update);
    }
}