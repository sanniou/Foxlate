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
        globalSettings: {}, // (新) 存储全局设置以显示默认值
    };

    constructor(elements) {
        super();
        this.#elements = elements;
        this.#validator = new FormValidator(this.#elements.domainRuleForm, {
            'ruleDomain': { rules: 'required', labelKey: 'domain' }
        });
        this.#bindEvents();
    }

    isOpen() {
        return this.#state.isOpen;
    }

    open(domain, ruleData = {}, globalSettings = {}) {
        this.#state.originalDomain = domain || null;
        this.#state.editingRule = JSON.parse(JSON.stringify(ruleData));
        if (!this.#state.editingRule.domain) this.#state.editingRule.domain = domain || '';
        this.#state.allAiEngines = globalSettings.aiEngines || [];
        this.#state.globalSettings = globalSettings;
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
            // (修复) 步骤 1: 首先填充所有下拉列表的选项。
            this.#populateDropdowns();

            this.#elements.domainRuleFormTitle.textContent = this.#state.originalDomain ? browser.i18n.getMessage('editDomainRule') : browser.i18n.getMessage('addDomainRule');
            this.#elements.ruleDomainInput.value = editingRule.domain || '';
            this.#elements.ruleApplyToSubdomainsCheckbox.checked = editingRule.applyToSubdomains ?? true;
            this.#elements.ruleAutoTranslateSelect.value = editingRule.autoTranslate ?? 'default';
            this.#elements.ruleTranslatorEngineSelect.value = editingRule.translatorEngine ?? 'default';
            this.#elements.ruleTargetLanguageSelect.value = editingRule.targetLanguage ?? 'default';
            this.#elements.ruleSourceLanguageSelect.value = editingRule.sourceLanguage ?? 'default';
            this.#elements.ruleDisplayModeSelect.value = editingRule.displayMode ?? 'default';
            const selector = editingRule.cssSelector || {};
            this.#elements.ruleContentSelector.value = selector.content || '';
            this.#elements.ruleExcludeSelectorTextarea.value = selector.exclude || '';
            this.#elements.ruleCssSelectorOverrideCheckbox.checked = editingRule.cssSelectorOverride ?? false;
            const subtitleSettings = editingRule.subtitleSettings || {};
            this.#elements.ruleEnableSubtitleCheckbox.checked = subtitleSettings.enabled || false;
            this.#elements.ruleSubtitleStrategySelect.value = subtitleSettings.strategy || 'none';
            this.#elements.ruleSubtitleDisplayMode.value = subtitleSettings.displayMode || 'off';
            this.#elements.ruleSubtitleSettingsGroup.style.display = this.#elements.ruleEnableSubtitleCheckbox.checked ? 'block' : 'none';
            const summarySettings = editingRule.summarySettings || {};
            this.#elements.ruleEnableSummary.checked = summarySettings.enabled ?? false;
            this.#elements.ruleMainBodySelector.value = summarySettings.mainBodySelector || '';
            // (修复) 步骤 2: 在选项填充后，安全地设置选中值。
            this.#elements.ruleSummaryAiModel.value = summarySettings.aiModel ?? '';
            this.#elements.ruleSummarySettingsGroup.style.display = this.#elements.ruleEnableSummary.checked ? 'block' : 'none';

            this.#openModal(modal);
            this.#elements.domainRuleModal.querySelectorAll('.m3-form-field.filled select').forEach(this.#initializeSelectLabel);
            this.#validator.clearAllErrors();
        } else {
            this.#closeModal(modal);
        }
    }

    /**
     * (新) 为“使用默认”选项生成带提示的文本。
     * @param {string} defaultValue - 全局默认值。
     * @param {string} defaultLabel - “使用默认设置”的 i18n 文本。
     * @returns {string} 格式化后的选项文本。
     */
    #getDefaultOptionText(defaultValue, defaultLabel) {
        return `${defaultLabel} (${defaultValue})`;
    }

    /**
     * (新) 获取 AI 引擎的显示名称。
     * @param {string} engineValue - 引擎值 (例如 'google', 'ai:some-id')。
     * @returns {string} 引擎的显示名称。
     */
    #getEngineDisplayName(engineValue) {
        console.log(`[DomainRuleModal] getEngineDisplayName 输入:`, engineValue);
        
        if (!engineValue) {
            console.log(`[DomainRuleModal] 引擎值为空，返回"未设置"`);
            return '未设置';
        }
        
        if (engineValue.startsWith('ai:')) {
            const engineId = engineValue.substring(3);
            console.log(`[DomainRuleModal] AI引擎ID:`, engineId);
            console.log(`[DomainRuleModal] 可用AI引擎:`, this.#state.allAiEngines);
            const engine = this.#state.allAiEngines.find(e => e.id === engineId);
            const displayName = engine ? engine.name : engineValue;
            console.log(`[DomainRuleModal] AI引擎显示名称:`, displayName);
            return displayName;
        }
        
        const messageKey = Constants.SUPPORTED_ENGINES[engineValue];
        console.log(`[DomainRuleModal] 内置引擎消息键:`, messageKey);
        const displayName = messageKey ? browser.i18n.getMessage(messageKey) : engineValue;
        console.log(`[DomainRuleModal] 内置引擎显示名称:`, displayName);
        return displayName;
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

        // (新) 更新"使用默认"选项的提示文本
        const { globalSettings } = this.#state;
        
        console.log(`[DomainRuleModal] populateDropdowns 全局设置:`, globalSettings);
        console.log(`[DomainRuleModal] populateDropdowns AI引擎列表:`, this.#state.allAiEngines);
        
        const defaultLabel = browser.i18n.getMessage('useDefaultSetting');

        const updateHint = (selectElement, globalValue, valueMap = {}) => {
            const defaultOption = selectElement.querySelector('option[value="default"]');
            if (defaultOption) {
                // 如果 globalSettings 不存在或对应的值为 undefined，使用默认设置
                const settingKey = selectElement.id.replace('rule', '').toLowerCase();
                // 特殊处理各个设置项的键名映射
                let defaultKey =settingKey;
                // 调试日志
                console.log(`[DomainRuleModal] updateHint for ${selectElement.id}:`, {
                    settingKey,
                    defaultKey,
                    globalValue,
                    defaultValue: Constants.DEFAULT_SETTINGS[defaultKey],
                    allAiEngines: this.#state.allAiEngines
                });
                
                const effectiveValue = globalValue !== undefined ? globalValue : Constants.DEFAULT_SETTINGS[defaultKey];
                let displayValue;
                
                if (effectiveValue !== undefined && effectiveValue !== null && effectiveValue !== '') {
                    // 对于翻译引擎，使用特殊处理逻辑
                    if (selectElement.id === 'ruleTranslatorEngine') {
                        displayValue = this.#getEngineDisplayName(effectiveValue);
                        console.log(`[DomainRuleModal] 翻译引擎显示值:`, {
                            effectiveValue,
                            displayValue,
                            allEngines: this.#state.allAiEngines
                        });
                    } else {
                        // 对于其他选项，使用 valueMap 查找对应的显示名称
                        displayValue = valueMap[effectiveValue] ? browser.i18n.getMessage(valueMap[effectiveValue]) : effectiveValue;
                    }
                } else {
                    displayValue = '未设置';
                    // 调试：当文本空白时，显示原始数值
                    console.log(`[DomainRuleModal] ${selectElement.id} 未设置，原始值:`, effectiveValue);
                }
                
                // 如果 displayValue 仍然为空或未定义，使用原始值作为后备
                if (!displayValue || displayValue.trim() === '') {
                    displayValue = effectiveValue || '未设置';
                    console.log(`[DomainRuleModal] ${selectElement.id} 显示值为空，使用原始值:`, displayValue);
                }
                
                const finalText = this.#getDefaultOptionText(displayValue, defaultLabel);
                console.log(`[DomainRuleModal] ${selectElement.id} 最终文本:`, finalText);
                defaultOption.textContent = finalText;
            }
        };

        // 翻译引擎使用特殊处理，不需要传递valueMap
        updateHint(this.#elements.ruleTranslatorEngineSelect, globalSettings?.translatorEngine, {});
        updateHint(this.#elements.ruleTargetLanguageSelect, globalSettings?.targetLanguage, Constants.SUPPORTED_LANGUAGES);
        // (修复) 统一使用 optionsKey，与全局设置的下拉菜单保持一致
        const displayModeValueMap = Object.fromEntries(
            Object.entries(Constants.DISPLAY_MODES).map(([key, value]) => [key, value.optionsKey])
        );
        updateHint(this.#elements.ruleDisplayModeSelect, globalSettings?.displayMode, displayModeValueMap);
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

        if (!isDomainValid || !isContentValid || !isExcludeValid || !isMainBodyValid) {
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
        this._addEscKeyHandler();
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
                this._removeEscKeyHandler();
            }
        };
        modalElement.addEventListener('transitionend', onTransitionEnd);
    }

    /**
     * 处理 ESC 键按下事件
     * @protected
     */
    _handleEscKey() {
        if (this.#state.isOpen) {
            this.close();
        }
    }

    #initializeSelectLabel(selectEl) {
        const parentField = selectEl.closest('.m3-form-field.filled');
        if (!parentField) return;
        const update = () => parentField.classList.toggle('is-filled', !!selectEl.value);
        update();
        selectEl.addEventListener('change', update);
    }
}