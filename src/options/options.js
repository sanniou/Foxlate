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
        // Synchronization Management elements
        syncEnabled: document.getElementById(ELEMENT_IDS.SYNC_ENABLED),
        syncManagementControls: document.getElementById(ELEMENT_IDS.SYNC_MANAGEMENT_CONTROLS),
        uploadSettingsBtn: document.getElementById(ELEMENT_IDS.UPLOAD_SETTINGS_BTN),
        cloudSettingsInfo: document.getElementById(ELEMENT_IDS.CLOUD_SETTINGS_INFO),
        cloudDataListSection: document.getElementById(ELEMENT_IDS.CLOUD_DATA_LIST_SECTION),
        refreshCloudDataBtn: document.getElementById(ELEMENT_IDS.REFRESH_CLOUD_DATA_BTN),
        cloudDataList: document.getElementById(ELEMENT_IDS.CLOUD_DATA_LIST),
        // Navigation
        settingsNav: document.getElementById('settings-nav'),
    };
    elements.toggleLogBtn = document.getElementById('toggleLogBtn');
    elements.logContent = document.getElementById('log-content');
    if (elements.logContent) {
        elements.logContent.style.whiteSpace = 'pre-wrap';
        elements.logContent.style.wordBreak = 'break-all';
    }

    // --- 状态管理 ---
    let state = {}; // 整个选项页的唯一状态源
    let initialSettingsSnapshot;

    // --- (新) 状态管理与渲染引擎 ---

    /**
     * (新) 状态更新分发器。所有状态变更都必须通过此函数。
     * @param {object} action - 描述状态变更的动作对象，例如 { type: 'SET_TRANSLATOR_ENGINE', payload: 'google' }
     */
    const dispatch = (action) => {
        // 1. 计算新状态 (不可变更新)
        const newState = rootReducer(state, action);

        // 2. 比较新旧状态，找出需要更新的部分
        const changes = diffState(state, newState);

        // 3. 更新全局状态
        state = newState;

        // 4. 执行局部渲染
        render(changes);

        // 5. 更新保存按钮状态
        updateSaveButtonState();
    };

    /**
     * (新) 根 Reducer，根据动作计算新状态。
     * @param {object} currentState - 当前状态。
     * @param {object} action - 动作对象。
     * @returns {object} 新的状态对象。
     */
    const rootReducer = (currentState, action) => {
        switch (action.type) {
            case 'SET_FULL_STATE':
                return action.payload;
            case 'SET_TRANSLATOR_ENGINE':
                return { ...currentState, translatorEngine: action.payload };
            case 'SET_TARGET_LANGUAGE':
                return { ...currentState, targetLanguage: action.payload };
            case 'SET_DISPLAY_MODE':
                return { ...currentState, displayMode: action.payload };
            case 'SET_DEEPLX_URL':
                return { ...currentState, deeplxApiUrl: action.payload };
            case 'SET_CACHE_SIZE':
                const size = parseInt(action.payload, 10);
                return { ...currentState, cacheSize: !isNaN(size) && size >= 0 ? size : Constants.DEFAULT_SETTINGS.cacheSize };
            case 'SET_SYNC_ENABLED':
                return { ...currentState, syncEnabled: action.payload };
            case 'SET_DEFAULT_SELECTOR':
                return {
                    ...currentState,
                    translationSelector: {
                        ...currentState.translationSelector,
                        default: { ...currentState.translationSelector.default, [action.payload.key]: action.payload.value }
                    }
                };
            case 'UPDATE_PRECHECK_RULE':
                const { category, index, key, value } = action.payload;
                const newPrecheckRules = JSON.parse(JSON.stringify(currentState.precheckRules));
                if (newPrecheckRules[category]?.[index]) {
                    newPrecheckRules[category][index][key] = value;
                }
                return { ...currentState, precheckRules: newPrecheckRules };
            case 'ADD_PRECHECK_RULE': {
                const newRules = JSON.parse(JSON.stringify(currentState.precheckRules));
                if (!newRules[action.payload.category]) newRules[action.payload.category] = [];
                newRules[action.payload.category].push({ name: '', regex: '', mode: 'blacklist', enabled: true, flags: '' });
                return { ...currentState, precheckRules: newRules };
            }
            case 'REMOVE_PRECHECK_RULE': {
                const newRules = JSON.parse(JSON.stringify(currentState.precheckRules));
                newRules[action.payload.category].splice(action.payload.index, 1);
                return { ...currentState, precheckRules: newRules };
            }
            case 'SET_DOMAIN_RULES':
                return { ...currentState, domainRules: action.payload };
            default:
                return currentState;
        }
    };

    /**
     * (新) 比较新旧状态，返回发生变化的顶级键。
     * @param {object} oldState
     * @param {object} newState
     * @returns {Set<string>} 包含已更改键的 Set。
     */
    const diffState = (oldState, newState) => {
        const changes = new Set();
        const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);
        for (const key of allKeys) {
            // 使用 JSON.stringify 进行深比较，简单有效
            if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
                changes.add(key);
            }
        }
        return changes;
    };

    /**
     * (重构) 局部渲染引擎。
     * @param {Set<string>} changes - 一个包含已更改状态键的 Set。如果为空，则为初始渲染。
     */
    const render = (changes = new Set()) => {
        console.log('[Options] Rendering UI from state.');

        const isInitialRender = changes.size === 0;

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
        elements.syncEnabled.checked = !!state.syncEnabled;

        if (isInitialRender || changes.has('translatorEngine') || changes.has('aiEngines')) {
            updateApiFieldsVisibility();
            checkDefaultEngineAvailability();
        }

        if (isInitialRender || changes.has('syncEnabled')) {
            updateSyncControlsVisibility();
        }

        if (isInitialRender || changes.has('domainRules')) {
            renderDomainRules();
        }

        if (isInitialRender || changes.has('precheckRules')) {
            renderPrecheckRulesUI();
        }

        if (isInitialRender || changes.has('aiEngines')) {
            if (aiEngineModal?.isOpen()) aiEngineModal.updateEngines(state.aiEngines);
            if (domainRuleModal?.isOpen()) domainRuleModal.updateEngines(state.aiEngines);
        }
    };

    /**
     * (重构) 从 state 获取设置。这是获取当前设置的唯一来源。
     * @returns {object} 当前的设置对象。
     */
    const getCurrentSettingsState = () => {
        // 从 state 中解构，移除任何不应被保存或比较的瞬时 UI 状态
        const { ...settingsToSave } = state;
        return settingsToSave;
    };

    const updateSaveButtonState = () => {
        const currentSettingsString = JSON.stringify(getCurrentSettingsState());
        const hasChanges = currentSettingsString !== initialSettingsSnapshot;
        elements.saveSettingsBtn.classList.toggle('visible', hasChanges);
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

    const initializeNavigation = () => {
        const nav = elements.settingsNav;
        if (!nav) return;

        const switchTab = (hash) => {
            const targetHash = hash || '#general';
            const targetPanelId = targetHash.substring(1);
            const targetPanel = document.getElementById(targetPanelId);
            const targetLink = nav.querySelector(`a[href="${targetHash}"]`);

            // Deactivate all
            nav.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
            document.querySelectorAll('.content-panel').forEach(panel => panel.classList.remove('active'));

            // Activate target
            if (targetPanel && targetLink) {
                targetPanel.classList.add('active');
                targetLink.classList.add('active');
            } else {
                // Fallback to general if hash is invalid
                document.getElementById('general').classList.add('active');
                nav.querySelector('a[href="#general"]').classList.add('active');
            }
        };

        nav.addEventListener('click', (e) => {
            const link = e.target.closest('.nav-link');
            if (link) {
                e.preventDefault();
                const hash = link.getAttribute('href');
                if (location.hash !== hash) {
                    location.hash = hash;
                }
            }
        });

        window.addEventListener('hashchange', () => switchTab(location.hash));

        // Initial load
        switchTab(location.hash);
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
            // 1. 首先，为加载的设置创建一个独立的、序列化的快照。
            //    这确保了 `initialSettingsSnapshot` 是一个在任何状态更新之前的、真正的“初始”记录。
            initialSettingsSnapshot = JSON.stringify(initialSettings);
            // 2. 然后，使用一个深拷贝的副本去更新应用的状态。
            //    这可以防止因对象引用而意外修改 `initialSettingsSnapshot`。
            dispatch({ type: 'SET_FULL_STATE', payload: JSON.parse(initialSettingsSnapshot) });
            await updateCacheInfo();
        } catch (error) {
            console.error("Failed to load and validate settings:", error);
            showStatusMessage(browser.i18n.getMessage('loadSettingsError'), true);
        }
    };

    const saveSettings = async () => {
        elements.saveSettingsBtn.dataset.state = 'loading';
        const settingsToSave = getCurrentSettingsState();
        const hasInvalidRegex = !!document.querySelector('.rule-item .m3-form-field.is-invalid');
        const isContentValid = validateCssSelectorInput(elements.defaultContentSelector);
        const isExcludeValid = validateCssSelectorInput(elements.defaultExcludeSelector);

        if (hasInvalidRegex || !isContentValid || !isExcludeValid) {
            elements.saveSettingsBtn.dataset.state = 'error';
            const firstInvalidField = document.querySelector('.content-panel.active .m3-form-field.is-invalid');
            if (firstInvalidField) {
                firstInvalidField.classList.add('error-shake');
                setTimeout(() => firstInvalidField.classList.remove('error-shake'), 500);
            }
            setTimeout(() => { elements.saveSettingsBtn.dataset.state = ''; }, 500);
            return;
        }

        try {
            await SettingsManager.saveLocalSettings(settingsToSave);
            initialSettingsSnapshot = JSON.stringify(getCurrentSettingsState());
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
                // (已重构) 重置后，将默认设置设为新的快照基线，
                // 然后通过保存和随后的 'settingsChanged' 事件来更新 UI 状态。
                initialSettingsSnapshot = JSON.stringify(defaultSettings);
                await SettingsManager.saveLocalSettings(defaultSettings);
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
        dispatch({ type: 'ADD_PRECHECK_RULE', payload: { category } });
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
                await SettingsManager.saveLocalSettings(getCurrentSettingsState());
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
        const settingsJson = JSON.stringify(getCurrentSettingsState(), null, 2);
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
                // (已重构) 导入新设置后，立即将其设为新的快照基线，
                // 然后通过保存和随后的 'settingsChanged' 事件来更新 UI 状态。
                initialSettingsSnapshot = JSON.stringify(settings);
                await SettingsManager.saveLocalSettings(settings);
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

    const renderCloudDataList = async () => {
        elements.cloudDataList.innerHTML = '';
        elements.cloudSettingsInfo.textContent = browser.i18n.getMessage('cloudSettingsStatus');

        try {
            const response = await browser.runtime.sendMessage({ type: 'GET_CLOUD_BACKUPS' });
            if (response && response.success && response.backups && response.backups.length > 0) {
                response.backups.forEach(backup => {
                    const li = document.createElement('li');
                    li.className = 'cloud-data-item';
                    const date = new Date(backup.timestamp);
                    const formattedDate = date.toLocaleString(); // Adjust format as needed
                    li.innerHTML = `
                        <span>${formattedDate}</span>
                        <div class="item-actions">
                            <button class="download-cloud-backup-btn m3-button text" data-backup-id="${backup.id}">${browser.i18n.getMessage('downloadSettings')}</button>
                            <button class="delete-cloud-backup-btn m3-button text danger" data-backup-id="${backup.id}">${browser.i18n.getMessage('removeRule')}</button>
                        </div>
                    `;
                    elements.cloudDataList.appendChild(li);
                });
                elements.cloudSettingsInfo.textContent = browser.i18n.getMessage("lastSynced", new Date(response.backups[0].timestamp).toLocaleString());
            } else {
                elements.cloudSettingsInfo.textContent = browser.i18n.getMessage('cloudSettingsStatusNoData');
                const li = document.createElement('li');
                li.className = 'no-rules-message'; // Reuse class for styling
                li.textContent = browser.i18n.getMessage('noCloudBackupsFound');
                elements.cloudDataList.appendChild(li);
            }
        } catch (error) {
            console.error("Failed to fetch cloud backups:", error);
            elements.cloudSettingsInfo.textContent = `Error: ${error.message}`;
            showStatusMessage(browser.i18n.getMessage("loadCloudDataFailed"), true);
        }
    };

    const uploadSettingsToCloud = async () => {
        const confirmed = await confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('confirmUploadSettings')
        );
        if (confirmed) {
            try {
                const settingsToUpload = getCurrentSettingsState();
                await browser.runtime.sendMessage({ type: 'UPLOAD_SETTINGS_TO_CLOUD', payload: settingsToUpload });
                showStatusMessage(browser.i18n.getMessage("settingsUploadedSuccess"));
                renderCloudDataList();
            } catch (error) {
                console.error("Failed to upload settings to cloud:", error);
                showStatusMessage(browser.i18n.getMessage("uploadSettingsToCloudFailed"), true);
            }
        }
    };

    const downloadSettingsFromCloud = async (backupId) => {
        const confirmed = await confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('confirmDownloadSettings')
        );
        if (confirmed) {
            try {
                const response = await browser.runtime.sendMessage({ type: 'DOWNLOAD_SETTINGS_FROM_CLOUD', payload: { backupId } });
                if (response && response.success) {
                    await SettingsManager.saveLocalSettings(response.settings);
                    showStatusMessage(browser.i18n.getMessage("settingsDownloadedSuccess"));
                    // Re-render the entire UI to reflect new settings
                    const newSettings = await SettingsManager.getValidatedSettings();
                    updateStateAndRender(newSettings);
                } else {
                    showStatusMessage(`Failed to download settings: ${response.error}`, true);
                }
            } catch (error) {
                console.error("Failed to download settings from cloud:", error);
                showStatusMessage(browser.i18n.getMessage("downloadSettingsFromCloudFailed"), true);
            }
        }
    };

    const deleteCloudBackup = async (backupId) => {
        const confirmed = await confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('confirmDeleteBackup')
        );
        if (confirmed) {
            try {
                await browser.runtime.sendMessage({ type: 'DELETE_CLOUD_BACKUP', payload: { backupId } });
                showStatusMessage(browser.i18n.getMessage("deleteBackupSuccess"));
                renderCloudDataList();
            } catch (error) {
                console.error("Failed to delete cloud backup:", error);
                showStatusMessage(browser.i18n.getMessage("deleteBackupFailed"), true);
            }
        }
    };

    const refreshCloudData = async () => {
        showStatusMessage(browser.i18n.getMessage("refreshingCloudData"));
        await renderCloudDataList();
        showStatusMessage(browser.i18n.getMessage("cloudDataRefreshed"));
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
            [ELEMENT_IDS.ADD_DOMAIN_RULE_BTN]: () => domainRuleModal.open(null, {}, state),
            [ELEMENT_IDS.RUN_GLOBAL_TEST_BTN]: runGlobalPrecheckTest,
            [ELEMENT_IDS.TEST_TRANSLATION_BTN]: toggleTestArea,
            [ELEMENT_IDS.TOGGLE_LOG_BTN]: toggleLogArea,
            [ELEMENT_IDS.MANUAL_TEST_TRANSLATE_BTN]: performTestTranslation,
            [ELEMENT_IDS.UPLOAD_SETTINGS_BTN]: uploadSettingsToCloud,
            [ELEMENT_IDS.REFRESH_CLOUD_DATA_BTN]: refreshCloudData,
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
                const { category, index } = item.dataset;
                dispatch({ type: 'REMOVE_PRECHECK_RULE', payload: { category, index } });
                render({ changes: new Set(['precheckRules']) }); // 局部渲染
            },
            'test-rule-btn': (btn) => {
                const item = btn.closest('.rule-item');
                testRegex(item.querySelector('.rule-regex'), item.querySelector('.rule-flags'), item.querySelector('.rule-test-result'));
            },
            'download-cloud-backup-btn': (btn) => downloadSettingsFromCloud(btn.dataset.backupId),
            'delete-cloud-backup-btn': (btn) => deleteCloudBackup(btn.dataset.backupId),
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
            [ELEMENT_IDS.DEFAULT_CONTENT_SELECTOR]: (val) => dispatch({ type: 'SET_DEFAULT_SELECTOR', payload: { key: 'content', value: val } }),
            [ELEMENT_IDS.DEFAULT_EXCLUDE_SELECTOR]: (val) => dispatch({ type: 'SET_DEFAULT_SELECTOR', payload: { key: 'exclude', value: val } }),
            [ELEMENT_IDS.DEEPLX_API_URL]: (val) => dispatch({ type: 'SET_DEEPLX_URL', payload: val }),
            [ELEMENT_IDS.CACHE_SIZE_INPUT]: (val) => dispatch({ type: 'SET_CACHE_SIZE', payload: val }),
        };
        if (simpleStateUpdaters[id]) {
            simpleStateUpdaters[id](target.value);
            return;
        }

        // --- 动态前置检查规则 ---
        const precheckItem = target.closest('.rule-item[data-category][data-index]');
        if (precheckItem) {
            const payload = {
                category: precheckItem.dataset.category,
                index: parseInt(precheckItem.dataset.index, 10),
                key: target.dataset.key,
                value: target.value
            };
            dispatch({ type: 'UPDATE_PRECHECK_RULE', payload });
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
            [ELEMENT_IDS.TRANSLATOR_ENGINE]: (val) => dispatch({ type: 'SET_TRANSLATOR_ENGINE', payload: val }),
            [ELEMENT_IDS.DISPLAY_MODE_SELECT]: (val) => dispatch({ type: 'SET_DISPLAY_MODE', payload: val }),
            [ELEMENT_IDS.TARGET_LANGUAGE]: (val) => dispatch({ type: 'SET_TARGET_LANGUAGE', payload: val }),
            [ELEMENT_IDS.SYNC_ENABLED]: (val) => dispatch({ type: 'SET_SYNC_ENABLED', payload: val }),
        };
        if (stateUpdaters[id]) {
            stateUpdaters[id](value);
            return;
        }

        // --- 动态前置检查规则 ---
        const precheckItem = target.closest('.rule-item[data-category][data-index]');
        if (precheckItem) {
            const payload = { category: precheckItem.dataset.category, index: parseInt(precheckItem.dataset.index, 10), key: target.dataset.key, value };
            dispatch({ type: 'UPDATE_PRECHECK_RULE', payload });
            return;
        }
        
        if (id === 'import-input') importSettings(e);
    };

    const checkDefaultEngineAvailability = () => {
        const settings = getCurrentSettingsState();
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

    const updateSyncControlsVisibility = () => {
        const isEnabled = state.syncEnabled;
        elements.syncManagementControls.style.display = isEnabled ? 'block' : 'none';
        if (isEnabled) {
            renderCloudDataList();
        }
    };

    const initialize = async () => {
        applyTranslations();
        initializeNavigation(); // <-- Add this call
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

        aiEngineModal.on('showStatus', (message, isError) => {
            showStatusMessage(message, isError);
        });

        domainRuleModal.on('save', async ({ rule, originalDomain }) => {
            try {
                const newDomainRules = { ...state.domainRules };
                if (originalDomain) {
                    delete newDomainRules[originalDomain];
                }
                newDomainRules[rule.domain] = rule;
                // 直接保存，让 settingsChanged 事件来更新 state 和 UI
                await SettingsManager.saveLocalSettings({ ...state, domainRules: newDomainRules });
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
        // (已重构) 监听设置变更，并使用 dispatch 更新状态
        SettingsManager.on('settingsChanged', ({ newValue }) => {
            // (已重构) 当设置从外部（如后台同步、其他标签页）更改时：
            // 1. 首先，将这个新的外部状态设置为我们的“未修改”基线快照。
            initialSettingsSnapshot = JSON.stringify(newValue);
            // 2. 然后，使用一个深拷贝的副本更新 UI 状态。
            //    这样可以确保 `updateSaveButtonState` 在比较时，两者是相同的，从而正确地隐藏保存按钮。
            dispatch({ type: 'SET_FULL_STATE', payload: JSON.parse(initialSettingsSnapshot) });
        });

        window.addEventListener('beforeunload', (e) => {
            const currentSettingsString = JSON.stringify(getCurrentSettingsState());
            if (currentSettingsString !== initialSettingsSnapshot) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        });
    };

    initialize();
});