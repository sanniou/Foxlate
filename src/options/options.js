import browser from '../lib/browser-polyfill.js';
import { SettingsManager } from '../common/settings-manager.js';
import { shouldTranslate } from '../common/precheck.js';
import { escapeHtml } from '../common/utils.js';
import * as Constants from '../common/constants.js';
import { FormValidator } from './validator.js';
import { SUBTITLE_STRATEGIES } from '../content/subtitle/strategy-manifest.js';
import { ELEMENT_IDS } from './ui-constants.js';

document.addEventListener('DOMContentLoaded', () => {

    // --- 全局验证器实例 ---
    let aiEngineValidator;
    let domainRuleValidator;

    // --- Element Cache ---
    const elements = {
        translatorEngine: document.getElementById(ELEMENT_IDS.TRANSLATOR_ENGINE),
        deeplxUrlGroup: document.getElementById(ELEMENT_IDS.DEEPLX_URL_GROUP),
        aiEngineManagementGroup: document.getElementById(ELEMENT_IDS.AI_ENGINE_MANAGEMENT_GROUP),
        addDomainRuleBtn: document.getElementById(ELEMENT_IDS.ADD_DOMAIN_RULE_BTN),
        domainRulesList: document.getElementById(ELEMENT_IDS.DOMAIN_RULES_LIST),
        exportBtn: document.getElementById(ELEMENT_IDS.EXPORT_BTN),
        importBtn: document.getElementById(ELEMENT_IDS.IMPORT_BTN),
        importInput: document.getElementById(ELEMENT_IDS.IMPORT_INPUT),
        resetSettingsBtn: document.getElementById(ELEMENT_IDS.RESET_SETTINGS_BTN),
        statusMessage: document.getElementById(ELEMENT_IDS.STATUS_MESSAGE),
        targetLanguage: document.getElementById(ELEMENT_IDS.TARGET_LANGUAGE),
        defaultContentSelector: document.getElementById(ELEMENT_IDS.DEFAULT_CONTENT_SELECTOR),
        defaultExcludeSelector: document.getElementById(ELEMENT_IDS.DEFAULT_EXCLUDE_SELECTOR),
        deeplxApiUrl: document.getElementById(ELEMENT_IDS.DEEPLX_API_URL),
        aiEngineModal: document.getElementById(ELEMENT_IDS.AI_ENGINE_MODAL),
        closeAiEngineModalBtn: document.querySelector(ELEMENT_IDS.CLOSE_AI_ENGINE_MODAL_BTN_SELECTOR),
        manageAiEnginesBtn: document.getElementById(ELEMENT_IDS.MANAGE_AI_ENGINES_BTN),
        aiEngineList: document.getElementById(ELEMENT_IDS.AI_ENGINE_LIST),
        addAiEngineBtn: document.getElementById(ELEMENT_IDS.ADD_AI_ENGINE_BTN),
        aiEngineForm: document.getElementById(ELEMENT_IDS.AI_ENGINE_FORM),
        aiFormTitle: document.getElementById(ELEMENT_IDS.AI_FORM_TITLE),
        importAiEngineModal: document.getElementById(ELEMENT_IDS.IMPORT_AI_ENGINE_MODAL),
        openImportAiEngineModalBtn: document.getElementById(ELEMENT_IDS.OPEN_IMPORT_AI_ENGINE_MODAL_BTN),
        confirmImportAiEngineBtn: document.getElementById(ELEMENT_IDS.CONFIRM_IMPORT_AI_ENGINE_BTN),
        cancelImportAiEngineBtn: document.getElementById(ELEMENT_IDS.CANCEL_IMPORT_AI_ENGINE_BTN),
        importAiEngineConfigText: document.getElementById(ELEMENT_IDS.IMPORT_AI_ENGINE_CONFIG_TEXT),
        importAiEngineErrorText: document.getElementById(ELEMENT_IDS.IMPORT_AI_ENGINE_ERROR_TEXT),
        aiEngineNameInput: document.getElementById(ELEMENT_IDS.AI_ENGINE_NAME_INPUT),
        aiApiKeyInput: document.getElementById(ELEMENT_IDS.AI_API_KEY_INPUT),
        aiApiUrlInput: document.getElementById(ELEMENT_IDS.AI_API_URL_INPUT),
        aiModelNameInput: document.getElementById(ELEMENT_IDS.AI_MODEL_NAME_INPUT),
        aiCustomPromptInput: document.getElementById(ELEMENT_IDS.AI_CUSTOM_PROMPT_INPUT),
        aiShortTextThresholdInput: document.getElementById(ELEMENT_IDS.AI_SHORT_TEXT_THRESHOLD_INPUT),
        aiTestText: document.getElementById(ELEMENT_IDS.AI_TEST_TEXT),
        aiShortTextEngineSelect: document.getElementById(ELEMENT_IDS.AI_SHORT_TEXT_ENGINE_SELECT),
        aiTestSection: document.getElementById(ELEMENT_IDS.AI_TEST_SECTION),
        saveAiEngineBtn: document.getElementById(ELEMENT_IDS.SAVE_AI_ENGINE_BTN),
        cancelAiEngineBtn: document.getElementById(ELEMENT_IDS.CANCEL_AI_ENGINE_BTN),
        testAiEngineBtn: document.getElementById(ELEMENT_IDS.TEST_AI_ENGINE_BTN),
        aiTestResult: document.getElementById(ELEMENT_IDS.AI_TEST_RESULT),
        closeDomainRuleModalBtn: document.querySelector(ELEMENT_IDS.CLOSE_DOMAIN_RULE_MODAL_BTN_SELECTOR),
        domainRuleFormTitle: document.getElementById(ELEMENT_IDS.DOMAIN_RULE_FORM_TITLE),
        editingDomainInput: document.getElementById(ELEMENT_IDS.EDITING_DOMAIN_INPUT),
        ruleDomainInput: document.getElementById(ELEMENT_IDS.RULE_DOMAIN_INPUT),
        ruleApplyToSubdomainsCheckbox: document.getElementById(ELEMENT_IDS.RULE_APPLY_TO_SUBDOMAINS_CHECKBOX),
        ruleAutoTranslateSelect: document.getElementById(ELEMENT_IDS.RULE_AUTO_TRANSLATE_SELECT),
        ruleTranslatorEngineSelect: document.getElementById(ELEMENT_IDS.RULE_TRANSLATOR_ENGINE_SELECT),
        ruleTargetLanguageSelect: document.getElementById(ELEMENT_IDS.RULE_TARGET_LANGUAGE_SELECT),
        ruleSourceLanguageSelect: document.getElementById(ELEMENT_IDS.RULE_SOURCE_LANGUAGE_SELECT),
        ruleDisplayModeSelect: document.getElementById(ELEMENT_IDS.RULE_DISPLAY_MODE_SELECT),
        ruleContentSelector: document.getElementById(ELEMENT_IDS.RULE_CONTENT_SELECTOR),
        ruleExcludeSelectorTextarea: document.getElementById(ELEMENT_IDS.RULE_EXCLUDE_SELECTOR_TEXTAREA),
        ruleCssSelectorOverrideCheckbox: document.getElementById(ELEMENT_IDS.RULE_CSS_SELECTOR_OVERRIDE_CHECKBOX),
        cancelDomainRuleBtn: document.getElementById(ELEMENT_IDS.CANCEL_DOMAIN_RULE_BTN),
        ruleEnableSubtitleCheckbox: document.getElementById(ELEMENT_IDS.RULE_ENABLE_SUBTITLE_CHECKBOX),
        ruleSubtitleSettingsGroup: document.getElementById(ELEMENT_IDS.RULE_SUBTITLE_SETTINGS_GROUP),
        ruleSubtitleStrategySelect: document.getElementById(ELEMENT_IDS.RULE_SUBTITLE_STRATEGY_SELECT),
        ruleSubtitleDisplayMode: document.getElementById(ELEMENT_IDS.RULE_SUBTITLE_DISPLAY_MODE),
        ruleMainBodySelector: document.getElementById(ELEMENT_IDS.RULE_MAIN_BODY_SELECTOR),
        ruleEnableSummary: document.getElementById(ELEMENT_IDS.RULE_ENABLE_SUMMARY),
        ruleSummarySettingsGroup: document.getElementById(ELEMENT_IDS.RULE_SUMMARY_SETTINGS_GROUP),
        ruleSummaryAiModel: document.getElementById(ELEMENT_IDS.RULE_SUMMARY_AI_MODEL),
        displayModeSelect: document.getElementById(ELEMENT_IDS.DISPLAY_MODE_SELECT),
        saveSettingsBtn: document.getElementById(ELEMENT_IDS.SAVE_SETTINGS_BTN),
        domainRuleModal: document.getElementById(ELEMENT_IDS.DOMAIN_RULE_MODAL),
        saveDomainRuleBtn: document.getElementById(ELEMENT_IDS.SAVE_DOMAIN_RULE_BTN),
        runGlobalTestBtn: document.getElementById(ELEMENT_IDS.RUN_GLOBAL_TEST_BTN),
        testTextInput: document.getElementById(ELEMENT_IDS.TEST_TEXT_INPUT),
        testTextInputError: document.getElementById(ELEMENT_IDS.TEST_TEXT_INPUT_ERROR),
        cacheSizeInput: document.getElementById(ELEMENT_IDS.CACHE_SIZE_INPUT),
        cacheInfoDisplay: document.getElementById(ELEMENT_IDS.CACHE_INFO_DISPLAY),
        clearCacheBtn: document.getElementById(ELEMENT_IDS.CLEAR_CACHE_BTN),
        domainRuleForm: document.getElementById(ELEMENT_IDS.DOMAIN_RULE_FORM),
    };
    elements.toggleLogBtn = document.getElementById('toggleLogBtn');
    elements.logContent = document.getElementById('log-content');
    if (elements.logContent) {
        elements.logContent.style.whiteSpace = 'pre-wrap';
        elements.logContent.style.wordBreak = 'break-all';
    }

    // --- 状态管理 ---
    let state = {}; // 整个选项页的唯一状态源
    let initialSettingsSnapshot = ''; // 用于比较变化的快照

    /**
     * (重构) 使用给定的设置对象更新全局状态并重新渲染UI。
     * @param {object} newSettings - 最新的设置对象。
     */
    const updateStateAndRender = (newSettings) => {
        console.log('[Options] Settings changed, updating state and re-rendering.', newSettings);
        
        // 1. 保留当前的 UI 状态
        const currentUiState = state.ui || { 
            isDomainRuleModalOpen: false, 
            editingRule: null, 
            originalDomain: null,
            isAiEngineModalOpen: false,
            editingAiEngine: null,
            isAiEngineFormVisible: false
        };

        // 2. 将从存储中加载的新设置与现有的 UI 状态合并
        state = JSON.parse(JSON.stringify(newSettings));
        state.ui = currentUiState;
        
        // 3. 从合并后的新状态渲染UI
        render();
    }

    /**
     * (重构) 从 state 对象渲染整个 UI。这是唯一的 UI 更新入口。
     */
    const render = () => {
        console.log('[Options] Rendering UI from state.');

        // 1. 更新主表单字段
        populateEngineSelect(elements.translatorEngine);
        elements.translatorEngine.value = state.translatorEngine;
        elements.targetLanguage.value = state.targetLanguage;
        const defaultSelector = state.translationSelector.default || {};
        elements.defaultContentSelector.value = defaultSelector.content || '';
        elements.defaultExcludeSelector.value = defaultSelector.exclude || '';
        elements.deeplxApiUrl.value = state.deeplxApiUrl;
        elements.displayModeSelect.value = state.displayMode;
        elements.cacheSizeInput.value = state.cacheSize ?? Constants.DEFAULT_SETTINGS.cacheSize;

        // 2. 重新渲染动态列表和模态框
        updateApiFieldsVisibility();
        renderDomainRules();
        renderPrecheckRulesUI();
        renderAiEngineList();
        renderDomainRuleModal();
        renderAiEngineModal();
        checkDefaultEngineAvailability();

        // 3. 更新快照并重置保存按钮状态
        initialSettingsSnapshot = JSON.stringify(getSettingsFromUI());
        updateSaveButtonState();
    };

    /**
     * (重构) 从 state 获取设置。这是获取当前设置的唯一来源。
     * @returns {object} 当前的设置对象。
     */
    const getSettingsFromUI = () => {
        const settingsToSave = JSON.parse(JSON.stringify(state));
        delete settingsToSave.ui; // 从要保存的设置中移除 UI 状态
        return settingsToSave;
    };

    const updateSaveButtonState = () => {
        const currentSettingsString = JSON.stringify(getSettingsFromUI());
        const hasChanges = currentSettingsString !== initialSettingsSnapshot;
        elements.saveSettingsBtn.classList.toggle('visible', hasChanges);
    };

    const updateSnapshotAndHideSaveButton = () => {
        initialSettingsSnapshot = JSON.stringify(getSettingsFromUI());
        updateSaveButtonState();
    };

    function testRegex(regexInput, flagsInput, resultElement) {
        const regexValue = regexInput.value.trim();
        const flagsValue = flagsInput.value.trim();
        const testTextInputElement = document.getElementById('testTextInput');
        const testText = testTextInputElement ? testTextInputElement.value : '';

        resultElement.classList.remove('show');
        resultElement.innerHTML = '';

        if (!regexValue) {
            resultElement.textContent = browser.i18n.getMessage('enterRegex') || '请输入正则表达式';
            resultElement.classList.add('show');
            return;
        }

        if (testText === '') {
            resultElement.textContent = browser.i18n.getMessage('enterTestText') || '请输入测试文本。';
            resultElement.classList.add('show');
            return;
        }

        try {
            let effectiveFlags = flagsValue.includes('g') ? flagsValue : flagsValue + 'g';
            const regex = new RegExp(regexValue, effectiveFlags);

            const matches = [...testText.matchAll(regex)];

            if (matches.length === 0) {
                resultElement.textContent = browser.i18n.getMessage('regexTestNoMatch') || 'No match';
                resultElement.classList.add('show');
            } else {
                let lastIndex = 0;
                let highlightedHtml = '';

                matches.forEach(match => {
                    const startIndex = match.index;
                    const endIndex = startIndex + match[0].length;

                    highlightedHtml += escapeHtml(testText.substring(lastIndex, startIndex));
                    highlightedHtml += `<span class="regex-highlight">${escapeHtml(match[0])}</span>`;
                    lastIndex = endIndex;
                });

                highlightedHtml += escapeHtml(testText.substring(lastIndex));

                resultElement.innerHTML = highlightedHtml;
                resultElement.classList.add('show');
            }
        } catch (e) {
            resultElement.textContent = `${browser.i18n.getMessage('invalidRegex') || '无效的正则表达式'}: ${e.message}`;
            resultElement.classList.add('show');
            validateRegexInput(regexInput, flagsInput);
        }
    }

    function validateCssSelectorInput(inputElement) {
        const field = inputElement.closest('.m3-form-field');
        if (!field) return true;

        const errorEl = field.querySelector('.error-message');
        const selectorValue = inputElement.value.trim();

        field.classList.remove('is-invalid');
        if (errorEl) errorEl.textContent = '';

        if (selectorValue) {
            const selectors = selectorValue.split(',').map(s => s.trim()).filter(s => s);
            for (const selector of selectors) {
                try {
                    document.querySelector(selector);
                } catch (e) {
                    field.classList.add('is-invalid');
                    if (errorEl) errorEl.textContent = browser.i18n.getMessage('invalidCssSelector');
                    return false;
                }
            }
        }
        return true;
    }

    function validateRegexInput(regexInput, flagsInput) {
        const regexValue = regexInput.value.trim();
        const flagsValue = flagsInput.value.trim();
        const regexField = regexInput.closest('.m3-form-field');
        const flagsField = flagsInput.closest('.m3-form-field');
        const regexErrorEl = regexField ? regexField.querySelector('.error-message') : null;
        const flagsErrorEl = flagsField ? flagsField.querySelector('.error-message') : null;
        let isValid = true;

        if (regexField) regexField.classList.remove('is-invalid');
        if (regexErrorEl) regexErrorEl.textContent = '';
        if (flagsField) flagsField.classList.remove('is-invalid');
        if (flagsErrorEl) flagsErrorEl.textContent = '';

        if (regexValue === '') {
            return true;
        }

        try {
            new RegExp(regexValue, flagsValue);
        } catch (e) {
            isValid = false;
            const errorMessage = e.message;

            if (errorMessage.toLowerCase().includes('flag')) {
                if (flagsField) flagsField.classList.add('is-invalid');
                if (flagsErrorEl) flagsErrorEl.textContent = errorMessage;
            } else {
                if (regexField) regexField.classList.add('is-invalid');
                if (regexErrorEl) regexErrorEl.textContent = errorMessage;
            }
        }
        return isValid;
    }

    const applyTranslations = () => {
        document.documentElement.lang = browser.i18n.getUILanguage();
        document.querySelectorAll('[i18n-text]').forEach(el => {
            const key = el.getAttribute('i18n-text');
            const message = browser.i18n.getMessage(key);
            if (message) el.textContent = message;
        });
        document.querySelectorAll('[i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('i18n-placeholder');
            const message = browser.i18n.getMessage(key);
            if (message) el.placeholder = message;
        });
    };

    let statusMessageTimeout;

    const showStatusMessage = (message, isError = false) => {
        if (statusMessageTimeout) clearTimeout(statusMessageTimeout);
        elements.statusMessage.textContent = message;
        elements.statusMessage.className = 'status-message';
        elements.statusMessage.classList.add(isError ? 'error' : 'success', 'visible');
        statusMessageTimeout = setTimeout(() => {
            elements.statusMessage.classList.remove('visible');
        }, 3000);
    };

    const initializeSelectLabel = (selectEl) => {
        const parentField = selectEl.closest('.m3-form-field.filled');
        if (!parentField) return;
        const update = () => parentField.classList.toggle('is-filled', !!selectEl.value);
        update();
        selectEl.addEventListener('change', update);
    };

    const manageSelectLabels = () => {
        document.querySelectorAll('.m3-form-field.filled select').forEach(initializeSelectLabel);
    };

    const loadSettings = async () => {
        try {
            const initialSettings = await SettingsManager.getValidatedSettings();
            updateStateAndRender(initialSettings);
            await updateCacheInfo();
        } catch (error) {
            console.error("Failed to load and validate settings:", error);
            showStatusMessage(browser.i18n.getMessage('loadSettingsError'), true);
        }
    };

    const saveSettings = async () => {
        elements.saveSettingsBtn.dataset.state = 'loading';
        const settingsToSave = getSettingsFromUI();
        const hasInvalidRegex = !!document.querySelector('.rule-item .m3-form-field.is-invalid');
        const isContentValid = validateCssSelectorInput(elements.defaultContentSelector);
        const isExcludeValid = validateCssSelectorInput(elements.defaultExcludeSelector);

        if (hasInvalidRegex || !isContentValid || !isExcludeValid) {
            elements.saveSettingsBtn.dataset.state = 'error';
            const firstInvalidField = document.querySelector('.settings-section .m3-form-field.is-invalid');
            if (firstInvalidField) {
                firstInvalidField.classList.add('error-shake');
                setTimeout(() => firstInvalidField.classList.remove('error-shake'), 500);
            }
            setTimeout(() => { elements.saveSettingsBtn.dataset.state = ''; }, 500);
            return;
        }

        try {
            await SettingsManager.saveSettings(settingsToSave);
            elements.saveSettingsBtn.dataset.state = 'success';
            setTimeout(() => {
                updateSaveButtonState();
                setTimeout(() => { elements.saveSettingsBtn.dataset.state = ''; }, 200);
            }, 1200);
        } catch (error) {
            console.error('Error saving settings:', error);
            elements.saveSettingsBtn.dataset.state = 'error';
            setTimeout(() => { elements.saveSettingsBtn.dataset.state = ''; }, 500);
        }
    };

    const resetSettings = async () => {
        if (window.confirm(browser.i18n.getMessage('resetSettingsConfirm'))) {
            try {
                const defaultSettings = SettingsManager.generateDefaultSettings();
                await SettingsManager.saveSettings(defaultSettings);
                showStatusMessage(browser.i18n.getMessage('resetSettingsSuccess'));
            } catch (error) {
                console.error('Error resetting settings:', error);
                showStatusMessage(browser.i18n.getMessage('resetSettingsError'), true);
            }
        }
    };

    function renderPrecheckRulesUI() {
        const container = document.getElementById('precheck-rules-container');
        if (!container) return;
        container.innerHTML = '';

        const tabButtons = document.createElement('div');
        tabButtons.className = 'tab-buttons';
        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';

        const categories = Object.keys(state.precheckRules || {});
        const sortedCategories = ['general', ...categories.filter(c => c !== 'general').sort()];

        sortedCategories.forEach((category, index) => {
            const tabButton = document.createElement('button');
            tabButton.className = 'tab-button';
            tabButton.textContent = browser.i18n.getMessage(`precheckTab_${category}`) || category;
            tabButton.dataset.category = category;
            tabButtons.appendChild(tabButton);

            const panel = document.createElement('div');
            panel.className = 'tab-panel';
            panel.id = `panel-${category}`;
            panel.dataset.category = category;

            const ruleList = document.createElement('div');
            ruleList.className = 'rule-list';
            if (state.precheckRules[category]) {
                state.precheckRules[category].forEach((rule, ruleIndex) => {
                    ruleList.appendChild(createRuleItemElement(rule, category, ruleIndex));
                });
            }
            panel.appendChild(ruleList);

            const addRuleBtn = document.createElement('button');
            addRuleBtn.textContent = browser.i18n.getMessage('addPrecheckRule');
            addRuleBtn.className = 'add-rule-btn m3-button filled-tonal';
            panel.appendChild(addRuleBtn);

            tabContent.appendChild(panel);

            if (index === 0) {
                tabButton.classList.add('active');
                panel.classList.add('active');
            }
        });

        container.appendChild(tabButtons);
        container.appendChild(tabContent);
    }

    function applyTranslationsToFragment(fragment) {
        fragment.querySelectorAll('[i18n-text]').forEach(el => {
            const key = el.getAttribute('i18n-text');
            if (key) el.textContent = browser.i18n.getMessage(key);
        });
    }

    function createRuleItemElement(rule, category, index) {
        const template = document.getElementById('precheck-rule-template');
        if (!template) return document.createElement('div');

        const fragment = template.content.cloneNode(true);
        const item = fragment.querySelector('.rule-item');
        item.dataset.category = category;
        item.dataset.index = index;

        const randomId = `rule-${category}-${index}`;

        const nameInput = item.querySelector('.rule-name');
        nameInput.id = `${randomId}-name`;
        nameInput.value = rule.name || '';
        item.querySelector('.rule-name-field label').htmlFor = nameInput.id;

        const regexInput = item.querySelector('.rule-regex');
        regexInput.id = `${randomId}-regex`;
        regexInput.value = rule.regex || '';
        item.querySelector('.rule-regex-field label').htmlFor = regexInput.id;

        const flagsInput = item.querySelector('.rule-flags');
        flagsInput.id = `${randomId}-flags`;
        flagsInput.value = rule.flags || '';
        item.querySelector('.rule-flags-field label').htmlFor = flagsInput.id;

        const modeSelect = item.querySelector('.rule-mode');
        modeSelect.id = `${randomId}-mode`;
        modeSelect.value = rule.mode;
        item.querySelector('.rule-mode-field label').htmlFor = modeSelect.id;

        const enabledCheckbox = item.querySelector('.rule-enabled-checkbox');
        enabledCheckbox.id = `${randomId}-enabled`;
        enabledCheckbox.checked = rule.enabled;
        item.querySelector('.m3-switch .switch-track').htmlFor = enabledCheckbox.id;
        item.querySelector('.m3-switch .switch-label').htmlFor = enabledCheckbox.id;

        applyTranslationsToFragment(item);
        return item;
    }

    function addRuleToCategory(category) {
        const newRule = { name: '', regex: '', mode: 'blacklist', enabled: true, flags: '' };
        if (!state.precheckRules[category]) {
            state.precheckRules[category] = [];
        }
        state.precheckRules[category].push(newRule);
        render();
        const newRulePanel = document.querySelector(`#panel-${category} .rule-item:last-child`);
        if (newRulePanel) newRulePanel.querySelector('.rule-name').focus();
    }

    function switchPrecheckTab(category) {
        const container = document.getElementById('precheck-rules-container');
        if (!container) return;
        container.querySelectorAll('.tab-button').forEach(btn => btn.classList.toggle('active', btn.dataset.category === category));
        container.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.category === category));
    }

    const renderDomainRules = () => {
        elements.domainRulesList.innerHTML = "";
        const rulesArray = Object.entries(state.domainRules || {}).map(([domain, rule]) => ({ domain, ...rule }));

        if (rulesArray.length === 0) {
            const li = document.createElement('li');
            li.className = 'no-rules-message';
            li.textContent = browser.i18n.getMessage('noDomainRulesFound') || 'No domain rules configured.';
            elements.domainRulesList.appendChild(li);
            return;
        }

        rulesArray.forEach(rule => {
            const li = document.createElement('li');
            li.className = 'domain-rule-item';
            li.dataset.domain = rule.domain;
            li.innerHTML = `<span>${escapeHtml(rule.domain)}</span><div class="rule-actions"><button class="edit-rule-btn m3-button text" data-domain="${rule.domain}">${browser.i18n.getMessage('edit') || 'Edit'}</button><button class="delete-rule-btn m3-button text danger" data-domain="${rule.domain}">${browser.i18n.getMessage('removeRule') || 'Delete'}</button></div>`;
            elements.domainRulesList.appendChild(li);
        });
    };

    const removeDomainRule = async (domainToRemove) => {
        if (window.confirm(browser.i18n.getMessage('confirmDeleteRule'))) {
            try {
                delete state.domainRules[domainToRemove];
                await SettingsManager.saveSettings(getSettingsFromUI());
                showStatusMessage(browser.i18n.getMessage('removeRuleSuccess'));
            } catch (error) {
                console.error("Failed to remove domain rule:", error);
                showStatusMessage("Failed to remove domain rule.", true);
            }
        }
    };

    const editDomainRule = (domain) => {
        const ruleData = state.domainRules[domain] || {};
        openDomainRuleModal(domain, ruleData);
    };

    const saveDomainRule = async () => {
        const isDomainValid = domainRuleValidator.validate();
        const isContentValid = validateCssSelectorInput(elements.ruleContentSelector);
        const isExcludeValid = validateCssSelectorInput(elements.ruleExcludeSelectorTextarea);
        const isMainBodyValid = validateCssSelectorInput(elements.ruleMainBodySelector);

        if (!isDomainValid || !isContentValid || !isExcludeValid || !isMainBodyValid) {
            const firstInvalidField = elements.domainRuleModal.querySelector('.m3-form-field.is-invalid');
            if (firstInvalidField) {
                firstInvalidField.classList.add('error-shake');
                setTimeout(() => firstInvalidField.classList.remove('error-shake'), 500);
            }
            return;
        }

        try {
            const newDomain = state.ui.editingRule.domain;
            const originalDomain = state.ui.originalDomain;
            const rule = state.ui.editingRule;

            delete state.domainRules[originalDomain];
            state.domainRules[newDomain] = rule;

            await SettingsManager.saveSettings(getSettingsFromUI());

            closeDomainRuleModal();
            showStatusMessage(browser.i18n.getMessage('saveRuleSuccess') || 'Rule saved successfully.');
        } catch (error) {
            console.error("Failed to save domain rule:", error);
            showStatusMessage("Failed to save domain rule.", true);
        }
    };

    const exportSettings = async () => {
        const settingsJson = JSON.stringify(getSettingsFromUI(), null, 2);
        const blob = new Blob([settingsJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'foxlate-settings.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showStatusMessage(browser.i18n.getMessage('exportSuccess'));
    };

    const importSettings = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const settings = JSON.parse(e.target.result);
                await SettingsManager.saveSettings(settings);
                showStatusMessage(browser.i18n.getMessage('importSuccess'));
            } catch (error) {
                showStatusMessage(browser.i18n.getMessage('importError'), true);
                console.error(error);
            }
        };
        reader.readAsText(file);
    };

    const openModal = (modalElement) => {
        if (!modalElement) return;
        document.body.classList.add('modal-open');
        modalElement.style.display = 'flex';
        modalElement.offsetWidth;
        modalElement.classList.add('is-visible');
        const scrollableContent = modalElement.querySelector('#domainRuleForm, .modal-scroll-content');
        if (scrollableContent) scrollableContent.scrollTop = 0;
        else modalElement.scrollTop = 0;
    };

    const closeModal = (modalElement, onClosed) => {
        if (!modalElement) return;
        if (!modalElement.classList.contains('is-visible')) return;
        modalElement.classList.remove('is-visible');
        if (document.querySelectorAll('.modal.is-visible').length === 0) {
            document.body.classList.remove('modal-open');
        }
        const modalContent = modalElement.querySelector('.modal-content');
        if (!modalContent) {
            modalElement.style.display = 'none';
            if (onClosed) onClosed();
            return;
        }
        const onTransitionEnd = (e) => {
            if (e.target === modalContent && (e.propertyName === 'transform' || e.propertyName === 'opacity')) {
                modalElement.style.display = 'none';
                modalContent.removeEventListener('transitionend', onTransitionEnd);
                if (onClosed) onClosed();
            }
        };
        modalContent.addEventListener('transitionend', onTransitionEnd);
    };

    const openAiEngineModal = () => {
        state.ui.isAiEngineModalOpen = true;
        render();
    };

    const closeAiEngineModal = () => {
        state.ui.isAiEngineModalOpen = false;
        state.ui.editingAiEngine = null;
        state.ui.isAiEngineFormVisible = false;
        render();
    };

    const openImportAiEngineModal = () => {
        elements.importAiEngineConfigText.value = '';
        elements.importAiEngineErrorText.textContent = '';
        elements.importAiEngineConfigText.closest('.m3-form-field').classList.remove('is-invalid');
        openModal(elements.importAiEngineModal);
        elements.importAiEngineConfigText.focus();
    };

    const closeImportAiEngineModal = () => {
        closeModal(elements.importAiEngineModal);
    };

    const hideAiEngineForm = () => {
        state.ui.isAiEngineFormVisible = false;
        state.ui.editingAiEngine = null;
        render();
    };

    const handleKeyDown = (event) => {
        if (event.key === "Escape") {
            if (elements.importAiEngineModal.classList.contains('is-visible')) {
                closeImportAiEngineModal();
            } else if (state.ui.isAiEngineModalOpen) {
                if (state.ui.isAiEngineFormVisible) hideAiEngineForm();
                else closeAiEngineModal();
            } else if (state.ui.isDomainRuleModalOpen) {
                closeDomainRuleModal();
            }
        }
    };

    document.addEventListener('keydown', handleKeyDown);

    const openDomainRuleModal = (domain, ruleData = {}) => {
        state.ui.originalDomain = domain || null;
        state.ui.editingRule = JSON.parse(JSON.stringify(ruleData));
        if (!state.ui.editingRule.domain) state.ui.editingRule.domain = domain || '';
        state.ui.isDomainRuleModalOpen = true;
        render();
    };

    const closeDomainRuleModal = () => {
        state.ui.isDomainRuleModalOpen = false;
        render();
    };

    const renderDomainRuleModal = () => {
        const { isDomainRuleModalOpen, editingRule } = state.ui;
        if (!elements.domainRuleModal) return;

        if (isDomainRuleModalOpen && editingRule) {
            elements.domainRuleFormTitle.textContent = state.ui.originalDomain ? browser.i18n.getMessage('editDomainRule') : browser.i18n.getMessage('addDomainRule');
            elements.ruleDomainInput.value = editingRule.domain || '';
            elements.ruleApplyToSubdomainsCheckbox.checked = editingRule.applyToSubdomains !== false;
            elements.ruleAutoTranslateSelect.value = editingRule.autoTranslate || 'default';
            elements.ruleTranslatorEngineSelect.value = editingRule.translatorEngine || 'default';
            elements.ruleTargetLanguageSelect.value = editingRule.targetLanguage || 'default';
            elements.ruleSourceLanguageSelect.value = editingRule.sourceLanguage || 'default';
            elements.ruleDisplayModeSelect.value = editingRule.displayMode || 'default';
            const selector = editingRule.cssSelector || {};
            elements.ruleContentSelector.value = selector.content || [selector.inline, selector.block].filter(Boolean).join(', ');
            elements.ruleExcludeSelectorTextarea.value = selector.exclude || '';
            elements.ruleCssSelectorOverrideCheckbox.checked = editingRule.cssSelectorOverride || false;
            const subtitleSettings = editingRule.subtitleSettings || {};
            elements.ruleEnableSubtitleCheckbox.checked = subtitleSettings.enabled || false;
            elements.ruleSubtitleStrategySelect.value = subtitleSettings.strategy || 'none';
            elements.ruleSubtitleDisplayMode.value = subtitleSettings.displayMode || 'off';
            elements.ruleSubtitleSettingsGroup.style.display = elements.ruleEnableSubtitleCheckbox.checked ? 'block' : 'none';
            const summarySettings = editingRule.summarySettings || {};
            elements.ruleEnableSummary.checked = summarySettings.enabled || false;
            elements.ruleMainBodySelector.value = summarySettings.mainBodySelector || '';
            elements.ruleSummaryAiModel.value = summarySettings.aiModel || '';
            elements.ruleSummarySettingsGroup.style.display = elements.ruleEnableSummary.checked ? 'block' : 'none';
            
            openModal(elements.domainRuleModal);
            elements.domainRuleModal.querySelectorAll('.m3-form-field.filled select').forEach(initializeSelectLabel);
            domainRuleValidator.clearAllErrors();
        } else {
            closeModal(elements.domainRuleModal);
        }
    };

    const renderAiEngineModal = () => {
        const { isAiEngineModalOpen, isAiEngineFormVisible, editingAiEngine } = state.ui;
        if (!elements.aiEngineModal) return;

        if (isAiEngineModalOpen) {
            renderAiEngineList();
            elements.aiEngineForm.style.display = isAiEngineFormVisible ? 'block' : 'none';
            if (isAiEngineFormVisible && editingAiEngine) {
                aiEngineValidator.clearAllErrors();
                populateEngineSelect(elements.aiShortTextEngineSelect, { includeDefault: true, excludeId: editingAiEngine.id });
                elements.aiFormTitle.textContent = editingAiEngine.id ? browser.i18n.getMessage('edit') : browser.i18n.getMessage('add');
                elements.aiTestText.value = 'Hello, world!';
                const formFields = { aiEngineNameInput: 'name', aiApiKeyInput: 'apiKey', aiApiUrlInput: 'apiUrl', aiModelNameInput: 'model', aiCustomPromptInput: 'customPrompt', aiShortTextThresholdInput: 'wordCountThreshold', aiShortTextEngineSelect: 'fallbackEngine' };
                for (const [elementKey, engineKey] of Object.entries(formFields)) {
                    const element = elements[elementKey];
                    if (!element) continue;
                    const defaultValue = engineKey === 'wordCountThreshold' ? 1 : (engineKey === 'fallbackEngine' ? 'default' : '');
                    element.value = editingAiEngine[engineKey] ?? defaultValue;
                }
                initializeSelectLabel(elements.aiShortTextEngineSelect);
            }
            openModal(elements.aiEngineModal);
        } else {
            closeModal(elements.aiEngineModal);
        }
    };

    const renderAiEngineList = () => {
        elements.aiEngineList.innerHTML = '';
        if (!state.aiEngines || state.aiEngines.length === 0) {
            elements.aiEngineList.innerHTML = `<p>${browser.i18n.getMessage('noAiEnginesFound') || 'No AI engines configured.'}</p>`;
            return;
        }
        const ul = document.createElement('ul');
        state.aiEngines.forEach(engine => {
            const syncStatus = engine.syncStatus || 'local';
            const statusIcon = getSyncStatusIcon(syncStatus);
            const statusText = getSyncStatusText(syncStatus);
            const li = document.createElement('li');
            li.innerHTML = `<div class="engine-info"><span class="engine-name">${escapeHtml(engine.name)}</span><span class="sync-status ${syncStatus}" title="${statusText}">${statusIcon} ${statusText}</span></div><div class="actions">${syncStatus === 'local' ? `<button class="m3-button text retry-sync-btn" data-id="${engine.id}">${browser.i18n.getMessage('retrySync')}</button>` : ''}<button class="m3-button text copy-ai-engine-btn" data-id="${engine.id}">${browser.i18n.getMessage('copy')}</button><button class="m3-button text edit-ai-engine-btn" data-id="${engine.id}">${browser.i18n.getMessage('edit')}</button><button class="m3-button text danger remove-ai-engine-btn" data-id="${engine.id}">${browser.i18n.getMessage('removeAiEngine')}</button></div>`;
            ul.appendChild(li);
        });
        elements.aiEngineList.appendChild(ul);
    };

    const getSyncStatusIcon = (status) => ({ synced: '☁️', local: '💾', syncing: '⏳' })[status] || '❓';
    const getSyncStatusText = (status) => browser.i18n.getMessage(`syncStatus${status.charAt(0).toUpperCase() + status.slice(1)}`) || 'Unknown';

    const addAiEngine = () => {
        state.ui.editingAiEngine = {};
        state.ui.isAiEngineFormVisible = true;
        render();
    };

    const editAiEngine = (id) => {
        const engine = state.aiEngines.find(e => e.id === id);
        if (engine) {
            state.ui.editingAiEngine = JSON.parse(JSON.stringify(engine));
            state.ui.isAiEngineFormVisible = true;
            render();
        }
    };

    const handleGlobalClick = async (e) => {
        let target = e.target;
        if (target instanceof SVGElement && target.parentNode) target = target.parentNode;

        if (target.closest('#importAiEngineModal .close-button')) return closeImportAiEngineModal();
        if (target.closest('#aiEngineModal .close-button')) return closeAiEngineModal();
        if (target.closest('#domainRuleModal .close-button')) return closeDomainRuleModal();

        const closestButton = target.closest('button, [role="button"]');
        if (!closestButton) return;

        if (closestButton.matches('.m3-button:not(.text), .tab-button') && closestButton.id !== 'saveSettingsBtn') {
            const ripple = document.createElement('span');
            ripple.className = 'ripple';
            const rect = closestButton.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
            ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
            closestButton.appendChild(ripple);
            ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
        }

        const buttonActions = {
            [ELEMENT_IDS.SAVE_SETTINGS_BTN]: saveSettings,
            [ELEMENT_IDS.RESET_SETTINGS_BTN]: resetSettings,
            [ELEMENT_IDS.EXPORT_BTN]: exportSettings,
            [ELEMENT_IDS.IMPORT_BTN]: () => elements.importInput.click(),
            [ELEMENT_IDS.OPEN_IMPORT_AI_ENGINE_MODAL_BTN]: openImportAiEngineModal,
            [ELEMENT_IDS.CONFIRM_IMPORT_AI_ENGINE_BTN]: handleConfirmImportAiEngine,
            [ELEMENT_IDS.CANCEL_IMPORT_AI_ENGINE_BTN]: closeImportAiEngineModal,
            [ELEMENT_IDS.RETRY_ALL_SYNC_BTN]: retryAllLocalEnginesSync,
            [ELEMENT_IDS.CLEAR_CACHE_BTN]: clearCache,
            [ELEMENT_IDS.MANAGE_AI_ENGINES_BTN]: openAiEngineModal,
            [ELEMENT_IDS.ADD_AI_ENGINE_BTN]: addAiEngine,
            [ELEMENT_IDS.SAVE_AI_ENGINE_BTN]: saveAiEngine,
            [ELEMENT_IDS.CANCEL_AI_ENGINE_BTN]: hideAiEngineForm,
            [ELEMENT_IDS.TEST_AI_ENGINE_BTN]: testAiEngineConnection,
            [ELEMENT_IDS.ADD_DOMAIN_RULE_BTN]: () => openDomainRuleModal(),
            [ELEMENT_IDS.CANCEL_DOMAIN_RULE_BTN]: closeDomainRuleModal,
            [ELEMENT_IDS.SAVE_DOMAIN_RULE_BTN]: saveDomainRule,
            [ELEMENT_IDS.RUN_GLOBAL_TEST_BTN]: runGlobalPrecheckTest,
            [ELEMENT_IDS.TEST_TRANSLATION_BTN]: toggleTestArea,
            [ELEMENT_IDS.TOGGLE_LOG_BTN]: toggleLogArea,
            [ELEMENT_IDS.MANUAL_TEST_TRANSLATE_BTN]: performTestTranslation
        };
        if (buttonActions[closestButton.id]) return buttonActions[closestButton.id]();

        const classActions = {
            'retry-sync-btn': (btn) => retryEngineSync(btn.dataset.id),
            'edit-ai-engine-btn': (btn) => editAiEngine(btn.dataset.id),
            'copy-ai-engine-btn': async (btn) => {
                const engine = state.aiEngines.find(e => e.id === btn.dataset.id);
                if (engine) {
                    try {
                        const cleanEngine = { ...engine };
                        delete cleanEngine.id; delete cleanEngine.syncStatus;
                        await navigator.clipboard.writeText(JSON.stringify(cleanEngine, null, 2));
                        showStatusMessage(browser.i18n.getMessage('copiedAiEngineSuccess'));
                    } catch (err) {
                        showStatusMessage(browser.i18n.getMessage('copyAiEngineError'), true);
                        console.error('Failed to copy AI Engine:', err);
                    }
                }
            },
            'remove-ai-engine-btn': (btn) => removeAiEngine(btn.dataset.id),
            'edit-rule-btn': (btn) => editDomainRule(btn.dataset.domain),
            'delete-rule-btn': (btn) => removeDomainRule(btn.dataset.domain),
            'tab-button': (btn) => switchPrecheckTab(btn.dataset.category),
            'add-rule-btn': (btn) => addRuleToCategory(btn.closest('.tab-panel').dataset.category),
            'remove-rule-btn': (btn) => {
                const item = btn.closest('.rule-item');
                state.precheckRules[item.dataset.category].splice(item.dataset.index, 1);
                render();
            },
            'test-rule-btn': (btn) => {
                const item = btn.closest('.rule-item');
                testRegex(item.querySelector('.rule-regex'), item.querySelector('.rule-flags'), item.querySelector('.rule-test-result'));
            }
        };
        for (const className in classActions) {
            if (closestButton.classList.contains(className)) return classActions[className](closestButton);
        }
    };

    const handleGlobalInput = (e) => {
        const target = e.target;
        const id = target.id;

        // --- 主设置表单 ---
        const simpleStateUpdaters = {
            [ELEMENT_IDS.DEFAULT_CONTENT_SELECTOR]: (val) => state.translationSelector.default.content = val,
            [ELEMENT_IDS.DEFAULT_EXCLUDE_SELECTOR]: (val) => state.translationSelector.default.exclude = val,
            [ELEMENT_IDS.DEEPLX_API_URL]: (val) => state.deeplxApiUrl = val,
            [ELEMENT_IDS.CACHE_SIZE_INPUT]: (val) => {
                const size = parseInt(val, 10);
                state.cacheSize = !isNaN(size) && size >= 0 ? size : Constants.DEFAULT_SETTINGS.cacheSize;
            }
        };
        if (simpleStateUpdaters[id]) {
            simpleStateUpdaters[id](target.value);
            updateSaveButtonState();
            return;
        }

        // --- 动态前置检查规则 ---
        const precheckItem = target.closest('.rule-item[data-category][data-index]');
        if (precheckItem) {
            const { category, index } = precheckItem.dataset;
            const rule = state.precheckRules[category]?.[index];
            if (rule) {
                const inputClass = target.className;
                if (inputClass.includes('rule-name')) rule.name = target.value;
                else if (inputClass.includes('rule-regex')) rule.regex = target.value;
                else if (inputClass.includes('rule-flags')) rule.flags = target.value;
                updateSaveButtonState();
            }
            return;
        }
        
        // --- 域名规则弹窗 ---
        if (target.closest(`#${ELEMENT_IDS.DOMAIN_RULE_MODAL}`)) {
            if (!state.ui.editingRule) return;
            const updater = {
                [ELEMENT_IDS.RULE_DOMAIN_INPUT]: (val) => state.ui.editingRule.domain = val,
                [ELEMENT_IDS.RULE_CONTENT_SELECTOR]: (val) => {
                    if (!state.ui.editingRule.cssSelector) state.ui.editingRule.cssSelector = {};
                    state.ui.editingRule.cssSelector.content = val;
                },
                [ELEMENT_IDS.RULE_EXCLUDE_SELECTOR_TEXTAREA]: (val) => {
                    if (!state.ui.editingRule.cssSelector) state.ui.editingRule.cssSelector = {};
                    state.ui.editingRule.cssSelector.exclude = val;
                },
                [ELEMENT_IDS.RULE_MAIN_BODY_SELECTOR]: (val) => {
                    if (!state.ui.editingRule.summarySettings) state.ui.editingRule.summarySettings = {};
                    state.ui.editingRule.summarySettings.mainBodySelector = val;
                }
            }[id];
            if (updater) updater(target.value);
            return;
        }

        // --- AI 引擎弹窗 ---
        if (target.closest(`#${ELEMENT_IDS.AI_ENGINE_MODAL}`)) {
            if (!state.ui.editingAiEngine) return;
            const updater = {
                [ELEMENT_IDS.AI_ENGINE_NAME_INPUT]: (val) => state.ui.editingAiEngine.name = val,
                [ELEMENT_IDS.AI_API_KEY_INPUT]: (val) => state.ui.editingAiEngine.apiKey = val,
                [ELEMENT_IDS.AI_API_URL_INPUT]: (val) => state.ui.editingAiEngine.apiUrl = val,
                [ELEMENT_IDS.AI_MODEL_NAME_INPUT]: (val) => state.ui.editingAiEngine.model = val,
                [ELEMENT_IDS.AI_CUSTOM_PROMPT_INPUT]: (val) => state.ui.editingAiEngine.customPrompt = val,
                [ELEMENT_IDS.AI_SHORT_TEXT_THRESHOLD_INPUT]: (val) => state.ui.editingAiEngine.wordCountThreshold = parseInt(val, 10) || 0
            }[id];
            if (updater) updater(target.value);
            return;
        }

        // --- 其他输入框 ---
        if (target.id === 'testTextInput') {
            const fieldContainer = target.closest('.m3-form-field');
            if (fieldContainer.classList.contains('is-invalid')) {
                fieldContainer.classList.remove('is-invalid');
                elements.testTextInputError.textContent = '';
            }
        }
    };

    const handleGlobalChange = (e) => {
        const target = e.target;
        const id = target.id;
        const value = target.type === 'checkbox' ? target.checked : target.value;

        // --- 主设置表单 ---
        const stateUpdaters = {
            [ELEMENT_IDS.TRANSLATOR_ENGINE]: (val) => { state.translatorEngine = val; updateApiFieldsVisibility(); },
            [ELEMENT_IDS.DISPLAY_MODE_SELECT]: (val) => state.displayMode = val,
            [ELEMENT_IDS.TARGET_LANGUAGE]: (val) => state.targetLanguage = val
        };
        if (stateUpdaters[id]) {
            stateUpdaters[id](value);
            updateSaveButtonState();
            return;
        }

        // --- 动态前置检查规则 ---
        const precheckItem = target.closest('.rule-item[data-category][data-index]');
        if (precheckItem) {
            const { category, index } = precheckItem.dataset;
            const rule = state.precheckRules[category]?.[index];
            if (rule) {
                if (target.matches('.rule-mode')) rule.mode = value;
                else if (target.matches('.rule-enabled-checkbox')) rule.enabled = value;
                updateSaveButtonState();
            }
            return;
        }
        
        // --- 域名规则弹窗 ---
        if (target.closest(`#${ELEMENT_IDS.DOMAIN_RULE_MODAL}`)) {
            if (!state.ui.editingRule) return;
            const updater = {
                [ELEMENT_IDS.RULE_APPLY_TO_SUBDOMAINS_CHECKBOX]: (val) => state.ui.editingRule.applyToSubdomains = val,
                [ELEMENT_IDS.RULE_AUTO_TRANSLATE_SELECT]: (val) => state.ui.editingRule.autoTranslate = val,
                [ELEMENT_IDS.RULE_TRANSLATOR_ENGINE_SELECT]: (val) => state.ui.editingRule.translatorEngine = val,
                [ELEMENT_IDS.RULE_TARGET_LANGUAGE_SELECT]: (val) => state.ui.editingRule.targetLanguage = val,
                [ELEMENT_IDS.RULE_SOURCE_LANGUAGE_SELECT]: (val) => state.ui.editingRule.sourceLanguage = val,
                [ELEMENT_IDS.RULE_DISPLAY_MODE_SELECT]: (val) => state.ui.editingRule.displayMode = val,
                [ELEMENT_IDS.RULE_CSS_SELECTOR_OVERRIDE_CHECKBOX]: (val) => state.ui.editingRule.cssSelectorOverride = val,
                [ELEMENT_IDS.RULE_ENABLE_SUBTITLE_CHECKBOX]: (val) => {
                    if (!state.ui.editingRule.subtitleSettings) state.ui.editingRule.subtitleSettings = {};
                    state.ui.editingRule.subtitleSettings.enabled = val;
                    elements.ruleSubtitleSettingsGroup.style.display = val ? 'block' : 'none';
                },
                [ELEMENT_IDS.RULE_SUBTITLE_STRATEGY_SELECT]: (val) => {
                    if (!state.ui.editingRule.subtitleSettings) state.ui.editingRule.subtitleSettings = {};
                    state.ui.editingRule.subtitleSettings.strategy = val;
                },
                [ELEMENT_IDS.RULE_SUBTITLE_DISPLAY_MODE]: (val) => {
                    if (!state.ui.editingRule.subtitleSettings) state.ui.editingRule.subtitleSettings = {};
                    state.ui.editingRule.subtitleSettings.displayMode = val;
                },
                [ELEMENT_IDS.RULE_ENABLE_SUMMARY]: (val) => {
                    if (!state.ui.editingRule.summarySettings) state.ui.editingRule.summarySettings = {};
                    state.ui.editingRule.summarySettings.enabled = val;
                    elements.ruleSummarySettingsGroup.style.display = val ? 'block' : 'none';
                },
                [ELEMENT_IDS.RULE_SUMMARY_AI_MODEL]: (val) => {
                    if (!state.ui.editingRule.summarySettings) state.ui.editingRule.summarySettings = {};
                    state.ui.editingRule.summarySettings.aiModel = val;
                }
            }[id];
            if (updater) updater(value);
            return;
        }

        // --- AI 引擎弹窗 ---
        if (target.closest(`#${ELEMENT_IDS.AI_ENGINE_MODAL}`)) {
            if (!state.ui.editingAiEngine) return;
            const updater = {
                [ELEMENT_IDS.AI_SHORT_TEXT_ENGINE_SELECT]: (val) => state.ui.editingAiEngine.fallbackEngine = val
            }[id];
            if (updater) updater(value);
            return;
        }

        if (id === 'import-input') importSettings(e);
    };

    const handleConfirmImportAiEngine = () => {
        const formField = elements.importAiEngineConfigText.closest('.m3-form-field');
        const errorEl = elements.importAiEngineErrorText;
        const configText = elements.importAiEngineConfigText.value.trim();

        formField.classList.remove('is-invalid');
        errorEl.textContent = '';

        if (!configText) {
            errorEl.textContent = browser.i18n.getMessage('pasteConfigRequired');
            formField.classList.add('is-invalid');
            return;
        }

        try {
            const importedData = JSON.parse(configText);
            const engineData = Array.isArray(importedData) ? importedData[0] : importedData;

            if (!engineData || !engineData.name || !engineData.apiKey || !engineData.apiUrl || !engineData.model || !engineData.customPrompt) {
                throw new Error(browser.i18n.getMessage('invalidAiEngineData'));
            }

            const cleanEngineData = { ...engineData };
            delete cleanEngineData.id; delete cleanEngineData.syncStatus;

            closeImportAiEngineModal();
            state.ui.editingAiEngine = cleanEngineData;
            state.ui.isAiEngineFormVisible = true;
            render();
            showStatusMessage(browser.i18n.getMessage('importedAiEngineSuccess'));
        } catch (err) {
            errorEl.textContent = err.message;
            formField.classList.add('is-invalid');
            console.error('Failed to import AI Engine:', err);
        }
    };

    const saveAiEngine = async () => {
        if (!aiEngineValidator.validate()) return;
        try {
            const engineData = state.ui.editingAiEngine;
            const engineId = engineData.id || null;
            await SettingsManager.saveAiEngine(engineData, engineId);
            hideAiEngineForm();
            showStatusMessage(browser.i18n.getMessage('saveAiEngineSuccess'));
        } catch (error) {
            console.error("Failed to save AI engine:", error);
            showStatusMessage("Failed to save AI engine.", true);
        }
    };

    const retryEngineSync = async (engineId) => {
        const engine = state.aiEngines.find(e => e.id === engineId);
        if (!engine) return console.error('Engine not found:', engineId);
        try {
            await SettingsManager.saveAiEngine(engine, engineId);
            showStatusMessage(browser.i18n.getMessage('retrySyncSuccess'));
        } catch (error) {
            console.error('Retry sync failed for engine:', engineId, error);
            showStatusMessage(browser.i18n.getMessage('retrySyncFailed'), true);
        }
    };

    const checkDefaultEngineAvailability = () => {
        const settings = getSettingsFromUI();
        if (!settings.translatorEngine || !settings.translatorEngine.startsWith('ai:')) return true;
        const engineId = settings.translatorEngine.substring(3);
        const engineExists = state.aiEngines.some(e => e.id === engineId);
        if (!engineExists) showDefaultEngineWarning();
        return engineExists;
    };

    const showDefaultEngineWarning = () => {
        const warningElement = document.getElementById('defaultEngineWarning');
        if (warningElement) {
            warningElement.style.display = 'block';
            warningElement.innerHTML = `<div class="warning-message">⚠️ ${browser.i18n.getMessage('defaultEngineNotFound')}</div>`;
        }
    };

    const hideDefaultEngineWarning = () => {
        const warningElement = document.getElementById('defaultEngineWarning');
        if (warningElement) warningElement.style.display = 'none';
    };

    const retryAllLocalEnginesSync = async () => {
        const localEngineIds = state.aiEngines.filter(e => e.syncStatus === 'local').map(e => e.id);
        if (localEngineIds.length === 0) return showStatusMessage(browser.i18n.getMessage('noLocalEngines'));

        let successCount = 0, failCount = 0;
        for (const engineId of localEngineIds) {
            try {
                await retryEngineSync(engineId);
                successCount++;
            } catch (error) {
                failCount++;
            }
        }
        const message = browser.i18n.getMessage('batchSyncResult', [successCount, failCount]);
        showStatusMessage(message, failCount > 0);
    };

    const removeAiEngine = async (id) => {
        if (window.confirm(browser.i18n.getMessage('confirmDeleteAiEngine'))) {
            try {
                await SettingsManager.removeAiEngine(id);
                showStatusMessage(browser.i18n.getMessage('removeAiEngineSuccess'));
            } catch (error) {
                console.error("Failed to remove AI engine:", error);
                showStatusMessage("Failed to remove AI engine.", true);
            }
        }
    };

    const updateApiFieldsVisibility = () => {
        const engine = elements.translatorEngine.value;
        elements.deeplxUrlGroup.style.display = 'none';
        if (engine === 'deeplx') elements.deeplxUrlGroup.style.display = 'block';
        else if (engine.startsWith('ai:')) elements.aiEngineManagementGroup.style.display = 'block';
    };

    const populateEngineSelect = (selectElement, { includeDefault = false, excludeId = null, onlyAi = false } = {}) => {
        if (!selectElement) return;
        const currentValue = selectElement.value;
        selectElement.innerHTML = '';

        if (includeDefault) {
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.textContent = browser.i18n.getMessage('useDefaultSetting');
            selectElement.appendChild(defaultOption);
        }

        if (!onlyAi) {
            for (const key in Constants.SUPPORTED_ENGINES) {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = browser.i18n.getMessage(Constants.SUPPORTED_ENGINES[key]);
                selectElement.appendChild(option);
            }
        }

        if (state.aiEngines) {
            state.aiEngines.forEach(engine => {
                if (engine.id !== excludeId) {
                    const option = document.createElement('option');
                    option.value = `ai:${engine.id}`;
                    option.textContent = engine.name;
                    selectElement.appendChild(option);
                }
            });
        }

        if (Array.from(selectElement.options).some(opt => opt.value === currentValue)) {
            selectElement.value = currentValue;
        } else if (selectElement.options.length > 0) {
            selectElement.value = selectElement.options[0].value;
        }
    };

    const populateModalDropdowns = () => {
        populateEngineSelect(elements.ruleTranslatorEngineSelect, { includeDefault: true });
        const summaryAiSelect = elements.ruleSummaryAiModel;
        summaryAiSelect.innerHTML = '';
        populateEngineSelect(summaryAiSelect, { includeDefault: false, onlyAi: true });

        const langSelect = elements.ruleTargetLanguageSelect;
        langSelect.innerHTML = '';
        const defaultLangOption = document.createElement('option');
        defaultLangOption.value = 'default';
        defaultLangOption.textContent = browser.i18n.getMessage('useDefaultSetting');
        langSelect.appendChild(defaultLangOption);
        for (const code in Constants.SUPPORTED_LANGUAGES) {
            if (code === 'auto') continue;
            const option = document.createElement('option');
            option.value = code;
            option.textContent = browser.i18n.getMessage(Constants.SUPPORTED_LANGUAGES[code]);
            langSelect.appendChild(option);
        }

        const sourceLangSelect = elements.ruleSourceLanguageSelect;
        sourceLangSelect.innerHTML = '';
        const defaultSourceLangOption = document.createElement('option');
        defaultSourceLangOption.value = 'default';
        defaultSourceLangOption.textContent = browser.i18n.getMessage('useDefaultSetting');
        sourceLangSelect.appendChild(defaultSourceLangOption);
        for (const code in Constants.SUPPORTED_LANGUAGES) {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = browser.i18n.getMessage(Constants.SUPPORTED_LANGUAGES[code]);
            sourceLangSelect.appendChild(option);
        }

        populateAutoTranslateOptions(elements.ruleAutoTranslateSelect, true);
        populateDisplayModeOptions(elements.ruleDisplayModeSelect, true);

        const strategySelect = elements.ruleSubtitleStrategySelect;
        strategySelect.innerHTML = '';
        const noStrategyOption = document.createElement('option');
        noStrategyOption.value = 'none';
        noStrategyOption.textContent = browser.i18n.getMessage('subtitleStrategyNone') || '不使用';
        strategySelect.appendChild(noStrategyOption);
        SUBTITLE_STRATEGIES.forEach(strategy => {
            const option = document.createElement('option');
            option.value = strategy.name;
            option.textContent = strategy.displayName || (strategy.name.charAt(0).toUpperCase() + strategy.name.slice(1));
            strategySelect.appendChild(option);
        });

        const displayModeSelect = elements.ruleSubtitleDisplayMode;
        if (displayModeSelect) {
            displayModeSelect.innerHTML = '';
            for (const code in Constants.SUBTITLE_DISPLAY_MODES) {
                const option = document.createElement('option');
                option.value = code;
                option.textContent = browser.i18n.getMessage(Constants.SUBTITLE_DISPLAY_MODES[code]) || code;
                displayModeSelect.appendChild(option);
            }
        }
    };

    const populateLanguageOptions = () => {
        const select = elements.targetLanguage;
        if (!select) return;
        select.innerHTML = '';
        for (const code in Constants.SUPPORTED_LANGUAGES) {
            if (code === 'auto') continue;
            const option = document.createElement('option');
            option.value = code;
            option.textContent = browser.i18n.getMessage(Constants.SUPPORTED_LANGUAGES[code]) || code;
            select.appendChild(option);
        }
    };

    const populateAutoTranslateOptions = (selectElement, includeDefault = false) => {
        if (!selectElement) return;
        selectElement.innerHTML = '';
        if (includeDefault) {
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.textContent = browser.i18n.getMessage('useDefaultSetting');
            selectElement.appendChild(defaultOption);
        }
        for (const code in Constants.AUTO_TRANSLATE_MODES) {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = browser.i18n.getMessage(Constants.AUTO_TRANSLATE_MODES[code]) || code;
            selectElement.appendChild(option);
        }
    };

    const populateDisplayModeOptions = (selectElement, includeDefault = false) => {
        if (!selectElement) return;
        selectElement.innerHTML = '';
        if (includeDefault) {
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.textContent = browser.i18n.getMessage('useDefaultSetting');
            selectElement.appendChild(defaultOption);
        }
        for (const code in Constants.DISPLAY_MODES) {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = browser.i18n.getMessage(Constants.DISPLAY_MODES[code].optionsKey) || code;
            selectElement.appendChild(option);
        }
    };

    const toggleTestArea = async () => {
        const container = document.getElementById('test-translation-container');
        const button = document.getElementById('testTranslationBtn');
        const sourceTextArea = document.getElementById('test-source-text');
        const resultArea = document.getElementById('test-result-area');
        const isHidden = container.style.display === 'none';
        if (isHidden) {
            container.style.display = 'block';
            button.textContent = browser.i18n.getMessage('collapseTest') || 'Collapse';
            sourceTextArea.focus();
        } else {
            container.style.display = 'none';
            button.textContent = browser.i18n.getMessage('test') || 'Test';
            sourceTextArea.value = '';
            resultArea.innerHTML = '';
        }
    };

    const toggleLogArea = () => {
        const logArea = document.getElementById('test-log-area');
        const button = document.getElementById('toggleLogBtn');
        const isHidden = logArea.style.display === 'none';
        if (isHidden) {
            logArea.style.display = 'block';
            button.textContent = browser.i18n.getMessage('hideLogButton') || 'Hide Log';
        } else {
            logArea.style.display = 'none';
            button.textContent = browser.i18n.getMessage('testLogButton') || 'Show Log';
            elements.logContent.textContent = '';
        }
    };

    const performTestTranslation = async () => {
        const sourceText = document.getElementById('test-source-text').value.trim();
        const resultArea = document.getElementById('test-result-area');
        elements.aiTestResult.style.display = 'none';
        if (!sourceText) {
            resultArea.textContent = browser.i18n.getMessage('testSourceEmpty') || 'Please enter text to translate.';
            resultArea.className = 'test-result-area error';
            return;
        }

        const compiledRules = SettingsManager.precompileRules(state.precheckRules);
        const currentUiSettings = { targetLanguage: elements.targetLanguage.value, precheckRules: compiledRules };
        const precheck = shouldTranslate(sourceText, currentUiSettings, true);
        elements.logContent.textContent = precheck.log.join('\n');
        document.getElementById('test-log-area').style.display = 'block';
        elements.toggleLogBtn.textContent = browser.i18n.getMessage('hideLogButton') || 'Hide Log';

        if (!precheck.result) {
            resultArea.textContent = `${browser.i18n.getMessage('testNotTranslated')} ${sourceText}`;
            resultArea.className = 'test-result-area success';
            return;
        }

        resultArea.textContent = browser.i18n.getMessage('testing') || 'Translating...';
        resultArea.className = 'test-result-area';

        try {
            const response = await browser.runtime.sendMessage({ type: 'TEST_TRANSLATE_TEXT', payload: { text: sourceText, targetLang: elements.targetLanguage.value, sourceLang: 'auto', translatorEngine: elements.translatorEngine.value } });

            if (response.log && response.log.length > 0) {
                elements.logContent.textContent += '\n' + response.log.join('\n');
            }

            if (response.success) {
                resultArea.textContent = response.translatedText.translated ? response.translatedText.text : `${browser.i18n.getMessage('testNotTranslated')} ${response.translatedText.text}`;
                resultArea.className = 'test-result-area success';
            } else {
                resultArea.textContent = `Error: ${response.error}`;
                resultArea.className = 'test-result-area error';
            }
        } catch (error) {
            console.error('Translation test error:', error);
            resultArea.textContent = `Error: ${error.message}`;
            resultArea.className = 'test-result-area error';
        }
    };

    const testAiEngineConnection = async () => {
        if (!aiEngineValidator.validate()) return;

        elements.aiTestSection.style.display = 'block';
        const engineData = state.ui.editingAiEngine;
        const testText = elements.aiTestText.value.trim() || 'Hello, world!';

        elements.aiTestResult.textContent = browser.i18n.getMessage('testing') || 'Testing...';
        elements.aiTestResult.classList.remove('success', 'error');
        elements.aiTestResult.style.display = 'block';
        elements.aiTestResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        try {
            const response = await browser.runtime.sendMessage({ type: 'TEST_CONNECTION', payload: { engine: 'ai', settings: { ...engineData }, text: testText } });
            if (response.success) {
                elements.aiTestResult.innerHTML = `<strong>${browser.i18n.getMessage('testOriginal')}:</strong> ${escapeHtml(testText)}<br><strong>${browser.i18n.getMessage('testTranslated')}:</strong> ${escapeHtml(response.translatedText.text)}`;
                elements.aiTestResult.classList.add('success');
            } else {
                elements.aiTestResult.textContent = `${browser.i18n.getMessage('testError')}: ${response.error}`;
                elements.aiTestResult.classList.add('error');
            }
        } catch (error) {
            console.error('AI connection test error:', error);
            elements.aiTestResult.textContent = `${browser.i18n.getMessage('testError')}: ${error.message}`;
            elements.aiTestResult.classList.add('error');
        }
    };

    const runGlobalPrecheckTest = () => {
        const testText = elements.testTextInput.value;
        const fieldContainer = elements.testTextInput.closest('.m3-form-field');

        if (!testText) {
            fieldContainer.classList.add('is-invalid');
            elements.testTextInputError.textContent = browser.i18n.getMessage('enterTestText');
            elements.testTextInput.focus();
            fieldContainer?.classList.add('error-shake');
            setTimeout(() => fieldContainer?.classList.remove('error-shake'), 500);
            return;
        }

        fieldContainer.classList.remove('is-invalid');
        elements.testTextInputError.textContent = '';
        document.querySelectorAll('.rule-item').forEach(item => {
            const regexInput = item.querySelector('.rule-regex');
            const flagsInput = item.querySelector('.rule-flags');
            const resultElement = item.querySelector('.rule-test-result');
            if (regexInput && flagsInput && resultElement) {
                testRegex(regexInput, flagsInput, resultElement);
            }
        });
    };

    const updateCacheInfo = async () => {
        try {
            const info = await browser.runtime.sendMessage({ type: 'GET_CACHE_INFO' });
            if (info) elements.cacheInfoDisplay.textContent = `${info.count} / ${info.limit}`;
        } catch (error) {
            console.error("Failed to get cache info:", error);
            elements.cacheInfoDisplay.textContent = 'N/A';
        }
    };

    const clearCache = async () => {
        if (window.confirm(browser.i18n.getMessage('clearCacheConfirm'))) {
            await browser.runtime.sendMessage({ type: 'CLEAR_CACHE' });
            await updateCacheInfo();
            showStatusMessage(browser.i18n.getMessage('clearCacheSuccess'));
        }
    };

    const handleGlobalFocusIn = (e) => {
        if (e.target.id === 'testTextInput') {
            document.querySelectorAll('.rule-test-result.show').forEach(resultEl => resultEl.classList.remove('show'));
        }
    };

    const initialize = async () => {
        applyTranslations();
        populateLanguageOptions();
        populateDisplayModeOptions(elements.displayModeSelect);
        await loadSettings();
        manageSelectLabels();
        populateModalDropdowns();

        aiEngineValidator = new FormValidator(elements.aiEngineForm, {
            'aiEngineName': { rules: 'required', labelKey: 'aiEngineName' },
            'aiApiKey': { rules: 'required', labelKey: 'aiApiKey' },
            'aiApiUrl': { rules: 'required', labelKey: 'aiApiUrl' },
            'aiModelName': { rules: 'required', labelKey: 'aiModelName' },
            'aiCustomPrompt': { rules: 'required', labelKey: 'aiCustomPrompt' },
            'aiShortTextEngine': { rules: 'required', labelKey: 'aiShortTextEngine' }
        });

        domainRuleValidator = new FormValidator(elements.domainRuleForm, {
            'ruleDomain': { rules: 'required', labelKey: 'domain' }
        });

        document.addEventListener('click', handleGlobalClick);
        document.addEventListener('input', handleGlobalInput);
        document.addEventListener('change', handleGlobalChange);
        document.addEventListener('focusin', handleGlobalFocusIn);
        document.addEventListener('keydown', handleKeyDown);

        SettingsManager.on('settingsChanged', ({ newValue }) => updateStateAndRender(newValue));

        window.addEventListener('beforeunload', (e) => {
            const currentSettingsString = JSON.stringify(getSettingsFromUI());
            if (currentSettingsString !== initialSettingsSnapshot) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        });
    };

    initialize();
});
