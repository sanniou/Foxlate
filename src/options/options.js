import browser from '../lib/browser-polyfill.js';
import { SettingsManager } from '../common/settings-manager.js';
import { shouldTranslate } from '../common/precheck.js';
import { escapeHtml } from '../common/utils.js';
import * as Constants from '../common/constants.js';
import { FormValidator } from './validator.js';
import { ELEMENT_IDS } from './ui-constants.js';
import { AIEngineModal } from './components/AIEngineModal.js';
import { DomainRuleModal } from './components/DomainRuleModal.js';
import { ConfirmModal } from './components/ConfirmModal.js';
import {
    populateEngineSelect,
    populateLanguageOptions,
    populateAutoTranslateOptions,
    populateDisplayModeOptions,
    populateSubtitleDisplayModeOptions,
    populateSubtitleStrategyOptions
} from './ui-helpers.js';

document.addEventListener('DOMContentLoaded', () => {

    // --- Components ---
    let aiEngineModal;
    let domainRuleModal;
    let confirmModal;

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
        manageAiEnginesBtn: document.getElementById(ELEMENT_IDS.MANAGE_AI_ENGINES_BTN),
        displayModeSelect: document.getElementById(ELEMENT_IDS.DISPLAY_MODE_SELECT),
        saveSettingsBtn: document.getElementById(ELEMENT_IDS.SAVE_SETTINGS_BTN),
        runGlobalTestBtn: document.getElementById(ELEMENT_IDS.RUN_GLOBAL_TEST_BTN),
        testTextInput: document.getElementById(ELEMENT_IDS.TEST_TEXT_INPUT),
        testTextInputError: document.getElementById(ELEMENT_IDS.TEST_TEXT_INPUT_ERROR),
        cacheSizeInput: document.getElementById(ELEMENT_IDS.CACHE_SIZE_INPUT),
        cacheInfoDisplay: document.getElementById(ELEMENT_IDS.CACHE_INFO_DISPLAY),
        clearCacheBtn: document.getElementById(ELEMENT_IDS.CLEAR_CACHE_BTN),
        // Component-related elements for AIEngineModal
        aiEngineModal: document.getElementById(ELEMENT_IDS.AI_ENGINE_MODAL),
        closeAiEngineModalBtn: document.querySelector(ELEMENT_IDS.CLOSE_AI_ENGINE_MODAL_BTN_SELECTOR),
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
        // Component-related elements for DomainRuleModal
        domainRuleModal: document.getElementById(ELEMENT_IDS.DOMAIN_RULE_MODAL),
        saveDomainRuleBtn: document.getElementById(ELEMENT_IDS.SAVE_DOMAIN_RULE_BTN),
        cancelDomainRuleBtn: document.getElementById(ELEMENT_IDS.CANCEL_DOMAIN_RULE_BTN),
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
        ruleEnableSubtitleCheckbox: document.getElementById(ELEMENT_IDS.RULE_ENABLE_SUBTITLE_CHECKBOX),
        ruleSubtitleSettingsGroup: document.getElementById(ELEMENT_IDS.RULE_SUBTITLE_SETTINGS_GROUP),
        ruleSubtitleStrategySelect: document.getElementById(ELEMENT_IDS.RULE_SUBTITLE_STRATEGY_SELECT),
        ruleSubtitleDisplayMode: document.getElementById(ELEMENT_IDS.RULE_SUBTITLE_DISPLAY_MODE),
        ruleMainBodySelector: document.getElementById(ELEMENT_IDS.RULE_MAIN_BODY_SELECTOR),
        ruleEnableSummary: document.getElementById(ELEMENT_IDS.RULE_ENABLE_SUMMARY),
        ruleSummarySettingsGroup: document.getElementById(ELEMENT_IDS.RULE_SUMMARY_SETTINGS_GROUP),
        ruleSummaryAiModel: document.getElementById(ELEMENT_IDS.RULE_SUMMARY_AI_MODEL),
        domainRuleForm: document.getElementById(ELEMENT_IDS.DOMAIN_RULE_FORM),
        // Component-related elements for ConfirmModal
        confirmModal: document.getElementById(ELEMENT_IDS.CONFIRM_MODAL),
        confirmModalTitle: document.getElementById(ELEMENT_IDS.CONFIRM_MODAL_TITLE),
        confirmModalMessage: document.getElementById(ELEMENT_IDS.CONFIRM_MODAL_MESSAGE),
        confirmModalConfirmBtn: document.getElementById(ELEMENT_IDS.CONFIRM_MODAL_CONFIRM_BTN),
        confirmModalCancelBtn: document.getElementById(ELEMENT_IDS.CONFIRM_MODAL_CANCEL_BTN),
        closeConfirmModalBtn: document.getElementById(ELEMENT_IDS.CLOSE_CONFIRM_MODAL_BTN),
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
        
        const currentUiState = state.ui || { 
            // isDomainRuleModalOpen: false, // Managed by DomainRuleModal
            // editingRule: null, // Managed by DomainRuleModal
            // originalDomain: null, // Managed by DomainRuleModal
        };

        state = JSON.parse(JSON.stringify(newSettings));
        state.ui = currentUiState;
        
        render();
    }

    /**
     * (重构) 从 state 对象渲染整个 UI。这是唯一的 UI 更新入口。
     */
    const render = () => {
        console.log('[Options] Rendering UI from state.');

        // 1. 更新主表单字段
        populateEngineSelect(elements.translatorEngine, { allEngines: state.aiEngines });
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
        checkDefaultEngineAvailability();

        // Update components if they are open
        if (aiEngineModal && aiEngineModal.isOpen()) {
            aiEngineModal.updateEngines(state.aiEngines);
        }
        if (domainRuleModal && domainRuleModal.isOpen()) {
            domainRuleModal.updateEngines(state.aiEngines); // Pass updated engines to domain rule modal too
        }

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
    };

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
        const confirmed = await confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('clearCacheConfirm')
        );
        if (confirmed) {
            await browser.runtime.sendMessage({ type: 'CLEAR_CACHE' });
            await updateCacheInfo();
            showStatusMessage(browser.i18n.getMessage('clearCacheSuccess'));
        }
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
        const confirmed = await confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('resetSettingsConfirm')
        );
        if (confirmed) {
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
        const confirmed = await confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('confirmDeleteRule')
        );
        if (confirmed) {
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
        domainRuleModal.open(domain, ruleData, state.aiEngines);
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

    const handleGlobalFocusIn = (e) => {
        if (e.target.id === 'testTextInput') {
            document.querySelectorAll('.rule-test-result.show').forEach(resultEl => resultEl.classList.remove('show'));
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === "Escape") {
            // Components handle their own escape key logic now
        }
    };

    document.addEventListener('keydown', handleKeyDown);

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
            resultArea.classList.add('error');
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

    const handleGlobalClick = async (e) => {
        // console.log('Global click event:', e.target); // Log the initial target
        let target = e.target;
        if (target instanceof SVGElement && target.parentNode) {
            target = target.parentNode;
            // console.log('Target adjusted to parentNode:', target);
        }

        const closestButton = target.closest('button, [role="button"]');
        // console.log('Closest button found:', closestButton); // Log the closest button
        if (!closestButton) {
            // console.log('No closest button found, returning.');
            return;
        }

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
            [ELEMENT_IDS.CLEAR_CACHE_BTN]: clearCache,
            [ELEMENT_IDS.MANAGE_AI_ENGINES_BTN]: () => aiEngineModal.open(state.aiEngines),
            [ELEMENT_IDS.ADD_DOMAIN_RULE_BTN]: () => domainRuleModal.open(null, {}, state.aiEngines),
            [ELEMENT_IDS.RUN_GLOBAL_TEST_BTN]: runGlobalPrecheckTest,
            [ELEMENT_IDS.TEST_TRANSLATION_BTN]: toggleTestArea,
            [ELEMENT_IDS.TOGGLE_LOG_BTN]: toggleLogArea,
            [ELEMENT_IDS.MANUAL_TEST_TRANSLATE_BTN]: performTestTranslation
        };
        // console.log('Checking buttonActions for ID:', closestButton.id);
        if (buttonActions[closestButton.id]) {
            // console.log('Executing action for ID:', closestButton.id);
            return buttonActions[closestButton.id]();
        }

        const classActions = {
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
        // console.log('Checking classActions for classes:', closestButton.classList);
        for (const className in classActions) {
            if (closestButton.classList.contains(className)) {
                // console.log('Executing action for class:', className);
                return classActions[className](closestButton);
            }
        }
        // console.log('No action found for button:', closestButton);
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
        
        if (id === 'import-input') importSettings(e);
    };

    const retryAllLocalEnginesSync = async () => {
        const localEngineIds = state.aiEngines.filter(e => e.syncStatus === 'local').map(e => e.id);
        if (localEngineIds.length === 0) return showStatusMessage(browser.i18n.getMessage('noLocalEngines'));

        let successCount = 0, failCount = 0;
        for (const engineId of localEngineIds) {
            try {
                await SettingsManager.saveAiEngine(state.aiEngines.find(e => e.id === engineId), engineId);
                successCount++;
            } catch (error) {
                failCount++;
            }
        }
        const message = browser.i18n.getMessage('batchSyncResult', [successCount, failCount]);
        showStatusMessage(message, failCount > 0);
    };

    const checkDefaultEngineAvailability = () => {
        const settings = getSettingsFromUI();
        if (!settings.translatorEngine || !settings.translatorEngine.startsWith('ai:')) {
            hideDefaultEngineWarning();
            return true;
        }
        const engineId = settings.translatorEngine.substring(3);
        const engineExists = state.aiEngines.some(e => e.id === engineId);
        if (!engineExists) {
            showDefaultEngineWarning();
        } else {
            hideDefaultEngineWarning();
        }
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
        if (warningElement) {
            warningElement.style.display = 'none';
        }
    };

    const updateApiFieldsVisibility = () => {
        const engine = elements.translatorEngine.value;
        elements.deeplxUrlGroup.style.display = 'none';
        elements.aiEngineManagementGroup.style.display = 'none';
        if (engine === 'deeplx') {
            elements.deeplxUrlGroup.style.display = 'block';
        } else if (engine.startsWith('ai:') || state.aiEngines?.length > 0) {
            elements.aiEngineManagementGroup.style.display = 'block';
        }
    };

    const initialize = async () => {
        applyTranslations();
        populateLanguageOptions(elements.targetLanguage);
        populateDisplayModeOptions(elements.displayModeSelect);
        await loadSettings();
        manageSelectLabels();

        // Initialize Components
        confirmModal = new ConfirmModal(elements);
        aiEngineModal = new AIEngineModal(elements, confirmModal);
        domainRuleModal = new DomainRuleModal(elements);

        // Bind Component Events
        aiEngineModal.on('save', async (engineData) => {
            try {
                await SettingsManager.saveAiEngine(engineData, engineData.id || null);
                showStatusMessage(browser.i18n.getMessage('saveAiEngineSuccess'));
            } catch (error) {
                console.error("Failed to save AI engine:", error);
                showStatusMessage("Failed to save AI engine.", true);
            }
        });

        aiEngineModal.on('remove', async (engineId) => {
            try {
                await SettingsManager.removeAiEngine(engineId);
                showStatusMessage(browser.i18n.getMessage('removeAiEngineSuccess'));
            } catch (error) {
                console.error("Failed to remove AI engine:", error);
                showStatusMessage("Failed to remove AI engine.", true);
            }
        });

        aiEngineModal.on('retrySync', async (engineId) => {
            try {
                const engine = state.aiEngines.find(e => e.id === engineId);
                if (engine) {
                    await SettingsManager.saveAiEngine(engine, engineId);
                    showStatusMessage(browser.i18n.getMessage('retrySyncSuccess'));
                }
            } catch (error) {
                console.error('Retry sync failed for engine:', engineId, error);
                showStatusMessage(browser.i18n.getMessage('retrySyncFailed'), true);
            }
        });

        aiEngineModal.on('showStatus', (message, isError) => {
            showStatusMessage(message, isError);
        });

        domainRuleModal.on('save', async ({ rule, originalDomain }) => {
            try {
                if (originalDomain) {
                    delete state.domainRules[originalDomain];
                }
                state.domainRules[rule.domain] = rule;
                await SettingsManager.saveSettings(getSettingsFromUI());
                showStatusMessage(browser.i18n.getMessage('saveRuleSuccess') || 'Rule saved successfully.');
            } catch (error) {
                console.error("Failed to save domain rule:", error);
                showStatusMessage("Failed to save domain rule.", true);
            }
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