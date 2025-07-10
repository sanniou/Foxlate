import '../lib/browser-polyfill.js';
import { getValidatedSettings, generateDefaultPrecheckRules, precompileRules } from '../common/settings-manager.js';
import * as Constants from '../common/constants.js';
import { SUBTITLE_STRATEGIES } from '../content/subtitle/strategy-manifest.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const elements = {
        translatorEngine: document.getElementById('translatorEngine'),
        deeplxUrlGroup: document.getElementById('deeplxUrlGroup'),
        aiEngineManagementGroup: document.getElementById('aiEngineManagementGroup'), // New AI management group   
        addDomainRuleBtn: document.getElementById('addDomainRuleBtn'),
        domainRulesList: document.getElementById('domainRulesList'),
        newDomainInput: document.getElementById('newDomain'),
        newDomainRuleSelect: document.getElementById('newDomainRule'),
        exportBtn: document.getElementById('export-btn'),
        importBtn: document.getElementById('import-btn'),
        importInput: document.getElementById('import-input'),
        resetSettingsBtn: document.getElementById('reset-settings-btn'),
        statusMessage: document.getElementById('statusMessage'),
        targetLanguage: document.getElementById('targetLanguage'),
        defaultInlineSelector: document.getElementById('defaultInlineSelector'),
        defaultBlockSelector: document.getElementById('defaultBlockSelector'),
        deeplxApiUrl: document.getElementById('deeplxApiUrl'),
        // AI Engine Modal Elements
        aiEngineModal: document.getElementById('aiEngineModal'),
        closeAiEngineModalBtn: document.querySelector('#aiEngineModal .close-button'),
        manageAiEnginesBtn: document.getElementById('manageAiEnginesBtn'),
        aiEngineList: document.getElementById('aiEngineList'),
        addAiEngineBtn: document.getElementById('addAiEngineBtn'),
        aiEngineForm: document.getElementById('aiEngineForm'),
        aiFormTitle: document.getElementById('aiFormTitle'),
        aiEngineNameInput: document.getElementById('aiEngineName'),
        aiApiKeyInput: document.getElementById('aiApiKey'),
        aiApiUrlInput: document.getElementById('aiApiUrl'),
        aiModelNameInput: document.getElementById('aiModelName'),
        aiCustomPromptInput: document.getElementById('aiCustomPrompt'),
        aiShortTextThresholdInput: document.getElementById('aiShortTextThreshold'),
        aiShortTextEngineSelect: document.getElementById('aiShortTextEngine'),
        // AI Engine Form Error Elements
        aiEngineNameError: document.getElementById('aiEngineNameError'),
        aiApiKeyError: document.getElementById('aiApiKeyError'),
        aiApiUrlError: document.getElementById('aiApiUrlError'),
        aiModelNameError: document.getElementById('aiModelNameError'),
        aiCustomPromptError: document.getElementById('aiCustomPromptError'),
        saveAiEngineBtn: document.getElementById('saveAiEngineBtn'),
        cancelAiEngineBtn: document.getElementById('cancelAiEngineBtn'),
        testAiEngineBtn: document.getElementById('testAiEngineBtn'),
        aiTestResult: document.getElementById('aiTestResult'),
        displayModeSelect: document.getElementById('displayModeSelect'),
        mainTabButtons: document.querySelectorAll('.main-tab-button'),
        saveSettingsBtn: document.getElementById('saveSettingsBtn'),
        fabIconSave: document.getElementById('fab-icon-save'),
        fabIconLoading: document.getElementById('fab-icon-loading'),
        fabIconSuccess: document.getElementById('fab-icon-success'),
        // Domain Rule Modal Elements
        domainRuleModal: document.getElementById('domainRuleModal'),
        closeDomainRuleModalBtn: document.querySelector('#domainRuleModal .close-button'),
        domainRuleFormTitle: document.getElementById('domainRuleFormTitle'),
        editingDomainInput: document.getElementById('editingDomain'),
        ruleDomainInput: document.getElementById('ruleDomain'),
        ruleDomainError: document.getElementById('ruleDomainError'),
        ruleApplyToSubdomainsCheckbox: document.getElementById('ruleApplyToSubdomains'),
        ruleAutoTranslateSelect: document.getElementById('ruleAutoTranslate'),
        ruleTranslatorEngineSelect: document.getElementById('ruleTranslatorEngine'),
        ruleTargetLanguageSelect: document.getElementById('ruleTargetLanguage'),
        ruleSourceLanguageSelect: document.getElementById('ruleSourceLanguage'),
        ruleDisplayModeSelect: document.getElementById('ruleDisplayMode'),
        ruleInlineSelectorTextarea: document.getElementById('ruleInlineSelector'),
        ruleBlockSelectorTextarea: document.getElementById('ruleBlockSelector'),
        ruleCssSelectorOverrideCheckbox: document.getElementById('ruleCssSelectorOverride'),
        cancelDomainRuleBtn: document.getElementById('cancelDomainRuleBtn'),
        ruleEnableSubtitleCheckbox: document.getElementById('ruleEnableSubtitle'),
        ruleSubtitleSettingsGroup: document.getElementById('ruleSubtitleSettingsGroup'),
        ruleSubtitleStrategySelect: document.getElementById('ruleSubtitleStrategy'),
        ruleSubtitleDisplayMode: document.getElementById('ruleSubtitleDisplayMode'),

        saveDomainRuleBtn: document.getElementById('saveDomainRuleBtn'),
        // Global Pre-check Test Elements
        runGlobalTestBtn: document.getElementById('runGlobalTestBtn'),
        testTextInput: document.getElementById('testTextInput'),
        testTextInputError: document.getElementById('testTextInputError')
    };
    elements.toggleLogBtn = document.getElementById('toggleLogBtn');
    elements.logContent = document.getElementById('log-content');
    // 为日志内容区域设置样式，以确保其能够正确换行
    if (elements.logContent) {
        elements.logContent.style.whiteSpace = 'pre-wrap'; // 保留换行符和空格，并自动换行
        elements.logContent.style.wordBreak = 'break-all';   // 允许在长单词或URL内部断开，防止溢出
    }

    // --- Unsaved Changes Tracking ---
    let unsavedChanges = {}; // Track changes per setting

    const updateSaveButtonState = () => {
        const hasChanges = Object.values(unsavedChanges).some(Boolean);
        elements.saveSettingsBtn.classList.toggle('visible', hasChanges);
    };

    const markSettingAsChanged = (settingKey) => {
        if (!unsavedChanges[settingKey]) {
            unsavedChanges[settingKey] = true;
            updateSaveButtonState();
        }
    };

    const clearUnsavedChanges = () => {
        unsavedChanges = {};
        // Visibility is now handled by updateSaveButtonState
        updateSaveButtonState();
    };

    /**
     * Tests a regular expression against a given input and displays the result.
     * @param {HTMLInputElement} regexInput - The input element containing the regex.
     * @param {HTMLInputElement} flagsInput - The input element containing the regex flags.
     * @param {HTMLElement} resultElement - The element to display the test result.
     */
    function testRegex(regexInput, flagsInput, resultElement) {
        const regexValue = regexInput.value.trim();
        const flagsValue = flagsInput.value.trim();
        const testTextInputElement = document.getElementById('testTextInput');
        const testText = testTextInputElement ? testTextInputElement.value : ''; // Ensure testText is always a string

        resultElement.classList.remove('show'); // 隐藏之前的测试结果
        resultElement.innerHTML = ''; // 清空之前的 HTML 内容

        if (!regexValue) {
            resultElement.textContent = browser.i18n.getMessage('enterRegex') || '请输入正则表达式';
            resultElement.classList.add('show');
            return;
        }

        if (testText === '') {
            resultElement.textContent = browser.i18n.getMessage('enterTestText') || '请输入测试文本。'; // New message for empty test text
            resultElement.classList.add('show');
            return;
        }

        try {
            // 确保全局标志 'g' 被设置，以便 matchAll 返回所有匹配项。
            // 这不会修改用户实际保存的 flags。
            let effectiveFlags = flagsValue.includes('g') ? flagsValue : flagsValue + 'g';
            const regex = new RegExp(regexValue, effectiveFlags);

            const matches = [...testText.matchAll(regex)]; // 获取所有匹配项

            if (matches.length === 0) {
                resultElement.textContent = browser.i18n.getMessage('regexTestNoMatch') || 'No match';
                resultElement.classList.add('show');
            } else {
                let lastIndex = 0;
                let highlightedHtml = '';

                matches.forEach(match => {
                    const startIndex = match.index;
                    const endIndex = startIndex + match[0].length;

                    // 添加当前匹配项之前的部分，并进行 HTML 转义
                    highlightedHtml += escapeHtml(testText.substring(lastIndex, startIndex));
                    // 添加高亮显示的匹配项，并进行 HTML 转义
                    highlightedHtml += `<span class="regex-highlight">${escapeHtml(match[0])}</span>`;
                    lastIndex = endIndex;
                });

                // 添加最后一个匹配项之后的部分，并进行 HTML 转义
                highlightedHtml += escapeHtml(testText.substring(lastIndex));

                resultElement.innerHTML = highlightedHtml; // 使用 innerHTML 来渲染高亮
                resultElement.classList.add('show');
            }
        } catch (e) {
            // 捕获无效正则表达式的错误
            resultElement.textContent = `${browser.i18n.getMessage('invalidRegex') || '无效的正则表达式'}: ${e.message}`;
            resultElement.classList.add('show');
            // 重新验证输入框以显示错误状态
            validateRegexInput(regexInput, flagsInput);
        }
    }

    // 辅助函数：对 HTML 字符串进行转义，防止 XSS 攻击
    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function (m) { return map[m]; });
    }

    /**
     * Validates a regular expression and its flags.
     * Adds/removes 'is-invalid' class and sets 'title' attribute for error messages.
     * @param {HTMLInputElement} regexInput - The input element containing the regex string.
     * @param {HTMLInputElement} flagsInput - The input element containing the regex flags.
     * @returns {boolean} True if the regex is valid, false otherwise.
     */
    function validateRegexInput(regexInput, flagsInput) {
        const regexValue = regexInput.value.trim();
        const flagsValue = flagsInput.value.trim();
        const regexField = regexInput.closest('.m3-form-field');
        const flagsField = flagsInput.closest('.m3-form-field');
        const regexErrorEl = regexField ? regexField.querySelector('.error-message') : null;
        const flagsErrorEl = flagsField ? flagsField.querySelector('.error-message') : null;
        let isValid = true;

        // Clear previous errors first
        if (regexField) regexField.classList.remove('is-invalid');
        if (regexErrorEl) regexErrorEl.textContent = '';
        if (flagsField) flagsField.classList.remove('is-invalid');
        if (flagsErrorEl) flagsErrorEl.textContent = '';

        // An empty regex is technically valid (matches everything), so we don't need to show an error.
        if (regexValue === '') {
            return true;
        }

        try {
            new RegExp(regexValue, flagsValue); // Attempt to create a RegExp object
        } catch (e) {
            isValid = false;
            const errorMessage = e.message;

            // Try to pinpoint the error to either the regex or the flags
            if (errorMessage.toLowerCase().includes('flag')) {
                // Error is likely in the flags
                if (flagsField) flagsField.classList.add('is-invalid');
                if (flagsErrorEl) flagsErrorEl.textContent = errorMessage;
            } else {
                // Error is likely in the regex pattern
                if (regexField) regexField.classList.add('is-invalid');
                if (regexErrorEl) regexErrorEl.textContent = errorMessage;
            }
        }
        return isValid;
    }

    let precheckRules = {};
    let aiEngines = []; // Array to hold AI engine configurations
    let domainRules = {}; // Object to hold domain rule configurations

    // --- I18N Function ---
    const applyTranslations = () => {
        document.documentElement.lang = browser.i18n.getUILanguage();
        const i18nElements = document.querySelectorAll('[i18n-text]');
        i18nElements.forEach(el => {
            const key = el.getAttribute('i18n-text');
            const message = browser.i18n.getMessage(key);
            if (message) {
                el.textContent = message;
            }
        });

        const i18nPlaceholders = document.querySelectorAll('[i18n-placeholder]');
        i18nPlaceholders.forEach(el => {
            const key = el.getAttribute('i18n-placeholder');
            const message = browser.i18n.getMessage(key);
            if (message) {
                el.placeholder = message;
            }
        });
    };

    // --- Helper Functions ---
    let statusMessageTimeout; // To prevent multiple timeouts from overlapping

    const showStatusMessage = (message, isError = false) => {
        // Clear any existing timeout to ensure the new message gets its full display time
        if (statusMessageTimeout) {
            clearTimeout(statusMessageTimeout);
        }

        elements.statusMessage.textContent = message;
        // Set base class and then add modifiers
        elements.statusMessage.className = 'status-message';
        elements.statusMessage.classList.add(isError ? 'error' : 'success');

        // Make it visible, which triggers the CSS transition
        elements.statusMessage.classList.add('visible');

        // Set a timeout to hide it again
        statusMessageTimeout = setTimeout(() => {
            elements.statusMessage.classList.remove('visible');
        }, 3000);
    };

    /**
 * Adds a Material Design ripple effect to a given button element.
 * @param {HTMLElement} button The button element to apply the ripple effect to.
 */
    const addRippleEffect = (button) => {
        button.addEventListener('click', (e) => {
            const ripple = document.createElement('span');
            ripple.classList.add('ripple');

            // Calculate position and size of the ripple
            const rect = button.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - (size / 2);
            const y = e.clientY - rect.top - (size / 2);

            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;

            button.appendChild(ripple);
            ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
        });
    };

    /**
     * Initializes the floating label state for a single <select> element.
     * @param {HTMLSelectElement} selectEl The select element to initialize.
     */
    const initializeSelectLabel = (selectEl) => {
        const parentField = selectEl.closest('.m3-form-field.filled');
        if (!parentField) return;

        const updateState = () => {
            // A select is considered "filled" if it has a non-empty value.
            if (selectEl.value) {
                parentField.classList.add('is-filled');
            } else {
                parentField.classList.remove('is-filled');
            }
        };

        updateState(); // Run on initial load
        selectEl.addEventListener('change', updateState); // Run on every change
    };

    const manageSelectLabels = () => {
        document.querySelectorAll('.m3-form-field.filled select').forEach(initializeSelectLabel);
    };

    const toggleApiFields = () => {
        const engine = elements.translatorEngine.value;
        elements.deeplxUrlGroup.style.display = 'none'; // 默认隐藏 DeepLx API URL
        // elements.aiEngineManagementGroup.style.display is now always 'block' from HTML


        if (engine === 'deeplx') elements.deeplxUrlGroup.style.display = 'block'; // Show DeepLx if selected
        else if (engine.startsWith('ai:')) elements.aiEngineManagementGroup.style.display = 'block'; // Show AI management if any AI engine is selected
    };

    // --- Core Logic Functions ---


    const loadSettings = async () => {
        try {
            const currentSettings = await getValidatedSettings();

            // Load AI Engines and populate the dropdown BEFORE setting the value
            aiEngines = JSON.parse(JSON.stringify(currentSettings.aiEngines)); // Deep copy
            populateTranslatorEngineOptions(); // Populate the main dropdown

            // Now that all <option> elements exist, set the selected value.
            elements.translatorEngine.value = currentSettings.translatorEngine;
            elements.targetLanguage.value = currentSettings.targetLanguage;
            const defaultSelector = currentSettings.translationSelector.default || {};
            elements.defaultInlineSelector.value = defaultSelector.inline || '';
            elements.defaultBlockSelector.value = defaultSelector.block || '';
            elements.deeplxApiUrl.value = currentSettings.deeplxApiUrl;
            elements.displayModeSelect.value = currentSettings.displayMode;

            domainRules = JSON.parse(JSON.stringify(currentSettings.domainRules)); // Deep copy

            precheckRules = JSON.parse(JSON.stringify(currentSettings.precheckRules));

            toggleApiFields();
            renderDomainRules();
            renderPrecheckRulesUI();
            clearUnsavedChanges(); // Reset tracking on load
        } catch (error) {
            console.error("Failed to load and validate settings:", error);
            showStatusMessage(browser.i18n.getMessage('loadSettingsError'), true);
        }
    };

    const saveSettings = async () => {
        // First, validate all pre-check rules before attempting to save
        // This call also updates the UI with validation feedback
        const precheckRulesToSave = getPrecheckRulesFromUI();
        let hasInvalidRegex = false;
        document.querySelectorAll('.rule-item input.is-invalid').forEach(() => {
            hasInvalidRegex = true;
        });

        if (hasInvalidRegex) {
            elements.saveSettingsBtn.classList.add('error-shake');
            const firstInvalidField = document.querySelector('.rule-item .m3-form-field.is-invalid');
            if (firstInvalidField) {
                firstInvalidField.classList.add('error-shake');
                setTimeout(() => firstInvalidField.classList.remove('error-shake'), 500);
            }
            setTimeout(() => elements.saveSettingsBtn.classList.remove('error-shake'), 500);
        }
        // --- State: Saving ---
        elements.saveSettingsBtn.disabled = true;
        elements.fabIconSave.classList.remove('active');
        elements.fabIconLoading.classList.add('active');
        elements.fabIconSuccess.classList.remove('active');

        try {
            const { settings: existingSettings } = await browser.storage.sync.get('settings');
            const settingsToSave = { ...existingSettings };

            // Selectively build the settings object based on what has changed
            if (unsavedChanges.translatorEngine) settingsToSave.translatorEngine = elements.translatorEngine.value;
            if (unsavedChanges.targetLanguage) settingsToSave.targetLanguage = elements.targetLanguage.value;
            if (unsavedChanges.displayMode) settingsToSave.displayMode = elements.displayModeSelect.value;
            if (unsavedChanges.deeplxApiUrl) settingsToSave.deeplxApiUrl = elements.deeplxApiUrl.value;
            if (unsavedChanges.translationSelector) {
                settingsToSave.translationSelector = {
                    ...(settingsToSave.translationSelector || {}),
                    default: {
                        inline: elements.defaultInlineSelector.value,
                        block: elements.defaultBlockSelector.value
                    }
                };
            }
            if (unsavedChanges.aiEngines) {
                settingsToSave.aiEngines = aiEngines;
            }
            if (unsavedChanges.precheckRules) {
                settingsToSave.precheckRules = precheckRulesToSave;
            }
            if (unsavedChanges.domainRules) {
                settingsToSave.domainRules = domainRules;
            }

            await browser.storage.sync.set({ settings: settingsToSave });
            clearUnsavedChanges(); // Reset tracking after successful save

            // --- State: Success ---
            elements.saveSettingsBtn.classList.add('success');
            elements.fabIconLoading.classList.remove('active');
            elements.fabIconSuccess.classList.add('active');

            // --- State: Disappear and Reset ---
            setTimeout(() => {
                elements.saveSettingsBtn.classList.remove('visible'); // Start fade out animation

                // This function will be our event handler to robustly reset the FAB.
                const resetFabOnFadeOut = (event) => {
                    // We only care about the opacity transition ending to avoid firing multiple times.
                    if (event.propertyName === 'opacity') {
                        elements.saveSettingsBtn.disabled = false;
                        elements.saveSettingsBtn.classList.remove('success');
                        elements.fabIconSuccess.classList.remove('active');
                        elements.fabIconSave.classList.add('active');

                        // Clean up the listener to prevent it from firing again.
                        elements.saveSettingsBtn.removeEventListener('transitionend', resetFabOnFadeOut);
                    }
                };

                // Add the listener before triggering the transition.
                elements.saveSettingsBtn.addEventListener('transitionend', resetFabOnFadeOut);

            }, 1200); // Display success state for 1.2 seconds for a better feel.
        } catch (error) {
            console.error('Error saving settings:', error);
            // --- State: Error/Reset ---
            elements.saveSettingsBtn.disabled = false;
            elements.fabIconLoading.classList.remove('active');
            elements.fabIconSave.classList.add('active');
            elements.saveSettingsBtn.classList.add('error-shake');
            setTimeout(() => elements.saveSettingsBtn.classList.remove('error-shake'), 500);
        } finally {
            // In case of error, we don't clear changes, so the user can try again.
            // The FAB state is reset above.
        }
    };

    const resetSettings = async () => {
        const confirmationMessage = browser.i18n.getMessage('resetSettingsConfirm') || 'Are you sure you want to reset all settings to their default values? This action cannot be undone.';
        if (window.confirm(confirmationMessage)) {
            try {
                const defaultSettings = JSON.parse(JSON.stringify(Constants.DEFAULT_SETTINGS));
                // Dynamically generate the default precheck rules with i18n names
                defaultSettings.precheckRules = generateDefaultPrecheckRules();

                await browser.storage.sync.set({ settings: defaultSettings });

                // After resetting, reload the settings, which will apply defaults and reset UI.
                await loadSettings();
                showStatusMessage(browser.i18n.getMessage('resetSettingsSuccess'));
            } catch (error) {
                console.error('Error resetting settings:', error);
                showStatusMessage(browser.i18n.getMessage('resetSettingsError'), true);
            }
        }
    };


    // --- Pre-check Rules UI Logic ---

    /**
     * Generates the full set of default pre-check rules, including internationalized names.
     * This function is called when initializing settings for the first time.
     * It combines general rules from constants with dynamically generated language-specific rules.
     * @returns {object} The complete default pre-check rules object.
     */


    function renderPrecheckRulesUI() {
        const container = document.getElementById('precheck-rules-container');
        if (!container) return;
        container.innerHTML = ''; // Clear previous content

        const tabButtons = document.createElement('div');
        tabButtons.className = 'tab-buttons';

        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';

        const categories = Object.keys(precheckRules);
        const sortedCategories = ['general', ...categories.filter(c => c !== 'general').sort()];

        sortedCategories.forEach((category, index) => {
            // Create Tab Button
            const tabButton = document.createElement('button');
            tabButton.className = 'tab-button';
            const categoryKey = `precheckTab_${category}`;
            const categoryDisplayName = browser.i18n.getMessage(categoryKey) || category;
            tabButton.textContent = categoryDisplayName;
            tabButton.dataset.category = category;
            tabButton.addEventListener('click', () => switchPrecheckTab(category));
            tabButtons.appendChild(tabButton);

            // Create Tab Panel
            const panel = document.createElement('div');
            panel.className = 'tab-panel';
            panel.id = `panel-${category}`;
            panel.dataset.category = category;

            // Create Rule List
            const ruleList = document.createElement('div');
            ruleList.className = 'rule-list';
            if (precheckRules[category]) {
                precheckRules[category].forEach(rule => {
                    ruleList.appendChild(createRuleItemElement(rule));
                });
            }
            panel.appendChild(ruleList);

            // Create 'Add Rule' Button
            const addRuleBtn = document.createElement('button');
            addRuleBtn.textContent = browser.i18n.getMessage('addPrecheckRule');
            addRuleBtn.className = 'add-rule-btn m3-button filled-tonal';
            addRuleBtn.addEventListener('click', () => addRuleToCategory(category));
            panel.appendChild(addRuleBtn);

            tabContent.appendChild(panel);

            // Set first tab as active
            if (index === 0) {
                tabButton.classList.add('active');
                panel.classList.add('active');
            }
        });

        container.appendChild(tabButtons);
        container.appendChild(tabContent);
    }

    function createRuleItemElement(rule) {
        const item = document.createElement('div');
        item.className = 'rule-item';
        const ruleNamePlaceholder = browser.i18n.getMessage('ruleNamePlaceholder') || 'Rule Name';
        const regexPlaceholder = browser.i18n.getMessage('regexPlaceholder') || 'Regular Expression';
        const flagsPlaceholder = browser.i18n.getMessage('flagsPlaceholder') || 'flags';
        const blacklistText = browser.i18n.getMessage('blacklist') || 'Blacklist';
        const whitelistText = browser.i18n.getMessage('whitelist') || 'Whitelist';
        const enabledText = browser.i18n.getMessage('enabled') || 'Enabled';

        // Unique ID for connecting labels and inputs, crucial for accessibility
        const randomId = `rule-${Math.random().toString(36).substr(2, 9)}`;

        item.innerHTML = `
        <div class="m3-form-field filled rule-name-field">
            <input type="text" id="${randomId}-name" class="rule-name" value="${escapeHtml(rule.name || '')}" placeholder=" ">
            <label for="${randomId}-name">${ruleNamePlaceholder}</label>
        </div>
        <div class="m3-form-field filled rule-regex-field">
            <input type="text" id="${randomId}-regex" class="rule-regex" value="${escapeHtml(rule.regex || '')}" placeholder=" ">
            <label for="${randomId}-regex">${regexPlaceholder}</label>
            <div class="error-message"></div>
        </div>
        <div class="m3-form-field filled rule-flags-field">
            <input type="text" id="${randomId}-flags" class="rule-flags" value="${escapeHtml(rule.flags || '')}" placeholder=" ">
            <label for="${randomId}-flags">${flagsPlaceholder}</label>
            <div class="error-message"></div>
        </div>
        <div class="m3-form-field filled rule-mode-field">
            <select id="${randomId}-mode" class="rule-mode">
                <option value="blacklist" ${rule.mode === 'blacklist' ? 'selected' : ''}>${blacklistText}</option>
                <option value="whitelist" ${rule.mode === 'whitelist' ? 'selected' : ''}>${whitelistText}</option>
            </select>
            <label for="${randomId}-mode">${browser.i18n.getMessage('rule')}</label>
        </div>
        <div class="rule-item-controls">
            <div class="m3-switch">
                <input type="checkbox" id="${randomId}-enabled" class="rule-enabled-checkbox" ${rule.enabled ? 'checked' : ''}>
                <label for="${randomId}-enabled" class="switch-track">
                    <span class="switch-thumb"></span>
                </label>
                <label for="${randomId}-enabled" class="switch-label">${enabledText}</label>
            </div>
            <button class="test-rule-btn m3-button text">${browser.i18n.getMessage('test')}</button>
            <button class="remove-rule-btn m3-icon-button danger">
                <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
        </div>
        `;

        const regexInput = item.querySelector('.rule-regex');
        const flagsInput = item.querySelector('.rule-flags');

        // Add event listeners for real-time validation and marking as changed
        const validateAndMarkChanged = () => {
            // Hide the test result whenever the regex or flags are edited,
            // as the result is now stale.
            const testResultElement = item.querySelector('.rule-test-result');
            if (testResultElement) {
                testResultElement.classList.remove('show');
            }
            validateRegexInput(regexInput, flagsInput); // Perform validation
            markSettingAsChanged('precheckRules'); // Any change in rule content marks as unsaved
        };
        item.querySelector('.rule-name').addEventListener('input', () => markSettingAsChanged('precheckRules'));
        // Apply ripple effect to the test button
        regexInput.addEventListener('input', validateAndMarkChanged);
        flagsInput.addEventListener('input', validateAndMarkChanged);
        item.querySelector('.rule-mode').addEventListener('change', () => markSettingAsChanged('precheckRules'));
        item.querySelector('.rule-enabled-checkbox').addEventListener('change', () => markSettingAsChanged('precheckRules'));

        item.querySelector('.remove-rule-btn').addEventListener('click', (e) => {
            e.currentTarget.closest('.rule-item').remove();
            markSettingAsChanged('precheckRules'); // Removing a rule counts as a change.
        });

        // Add test result element (initially hidden)
        const testResultElement = document.createElement('div');
        testResultElement.className = 'rule-test-result';
        item.appendChild(testResultElement);
        // Apply ripple effect to the test button
        addRippleEffect(item.querySelector('.test-rule-btn'));


        // Add event listener for the "Test" button
        item.querySelector('.test-rule-btn').addEventListener('click', () => {
            const testResultElement = item.querySelector('.rule-test-result'); // Get the result display area
            testRegex(regexInput, flagsInput, testResultElement);
        });
        return item;
    }

    // Initial validation when the element is created (after it's appended to DOM)
    // This is handled by the call to createRuleItemElement inside renderPrecheckRulesUI

    function addRuleToCategory(category) {
        const newRule = { name: '', regex: '', mode: 'blacklist', enabled: true, flags: '' };
        const ruleList = document.querySelector(`#panel-${category} .rule-list`);
        if (ruleList) {
            const newRuleElement = createRuleItemElement(newRule);
            ruleList.appendChild(newRuleElement);

            // Find the newly created select element and initialize its label state to fix the overlap bug.
            const newSelect = newRuleElement.querySelector('.rule-mode');
            if (newSelect) {
                initializeSelectLabel(newSelect);
            }
            markSettingAsChanged('precheckRules'); // 添加规则也算作更改
        }
    }

    function switchPrecheckTab(category) {
        const container = document.getElementById('precheck-rules-container');
        if (!container) return;

        container.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === category);
        });
        container.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.category === category);
        });
    }

    function getPrecheckRulesFromUI() {
        const newRules = {};
        const container = document.getElementById('precheck-rules-container');
        if (!container) return precheckRules; // Return old rules if UI not found

        let allRulesValid = true; // Flag to track overall validity
        container.querySelectorAll('.tab-panel').forEach(panel => {
            const category = panel.dataset.category;
            if (!category) return;

            newRules[category] = [];
            panel.querySelectorAll('.rule-item').forEach(item => {
                const name = item.querySelector('.rule-name').value.trim();
                const regexInput = item.querySelector('.rule-regex');
                const flagsInput = item.querySelector('.rule-flags');

                // Validate each regex/flags pair when extracting from UI
                const isCurrentRuleValid = validateRegexInput(regexInput, flagsInput);
                if (!isCurrentRuleValid) {
                    allRulesValid = false; // Mark that at least one rule is invalid
                }
                const regex = regexInput.value.trim();
                if (name && regex) {
                    newRules[category].push({
                        name: name,
                        regex: regex, // Store potentially invalid regex for user to fix
                        flags: flagsInput.value.trim(),
                        mode: item.querySelector('.rule-mode').value,
                        enabled: item.querySelector('.rule-enabled-checkbox').checked,
                    });
                }
            });
        });
        return newRules;
        // Note: The `allRulesValid` flag is not returned here, but it's used by `saveSettings`
        // by querying the DOM for `.is-invalid` class. This ensures the UI state is the source of truth.
        // If you wanted to return it, you'd need to modify the return type of this function.
        // For now, the DOM query in saveSettings is sufficient.
    }

    // --- Main Tabs UI Logic ---
    function switchMainTab(tabName) {
        // Hide all panels
        document.querySelectorAll('.main-tab-panel').forEach(panel => panel.classList.remove('active'));
        // Deactivate all buttons
        elements.mainTabButtons.forEach(button => button.classList.remove('active'));
        // Activate the selected tab and panel
        document.getElementById(`tab-panel-${tabName}`).classList.add('active');
        document.querySelector(`.main-tab-button[data-tab="${tabName}"]`).classList.add('active');
    }
    const renderDomainRules = () => {
        elements.domainRulesList.innerHTML = ""; // Clear the <ul>
        const rulesArray = Object.entries(domainRules).map(([domain, rule]) => ({ domain, ...rule }));

        if (rulesArray.length === 0) {
            const li = document.createElement('li');
            li.className = 'no-rules-message'; // For specific styling
            li.textContent = browser.i18n.getMessage('noDomainRulesFound') || 'No domain rules configured.';
            elements.domainRulesList.appendChild(li);
            return;
        }

        rulesArray.forEach(rule => {
            const li = document.createElement('li');
            li.className = 'domain-rule-item';
            li.dataset.domain = rule.domain;

            li.innerHTML = `
            <span>${escapeHtml(rule.domain)}</span>
            <div class="rule-actions">
                <button class="edit-rule-btn m3-button text" data-domain="${rule.domain}">${browser.i18n.getMessage('edit') || 'Edit'}</button>
                <button class="delete-rule-btn m3-button text danger" data-domain="${rule.domain}">${browser.i18n.getMessage('removeRule') || 'Delete'}</button>
            </div>`;
            elements.domainRulesList.appendChild(li);
        });

        elements.domainRulesList.querySelectorAll('.edit-rule-btn').forEach(button => {
            button.addEventListener('click', (e) => editDomainRule(e.target.dataset.domain));
        });
        elements.domainRulesList.querySelectorAll('.delete-rule-btn').forEach(button => {
            button.addEventListener('click', (e) => removeDomainRule(e.target.dataset.domain));
        });
    };



    const removeDomainRule = (domainToRemove) => {
        const confirmationMessage = browser.i18n.getMessage('confirmDeleteRule') || 'Are you sure you want to delete this rule?';
        if (window.confirm(confirmationMessage)) {
            if (domainRules[domainToRemove]) {
                delete domainRules[domainToRemove];
                renderDomainRules();
                markSettingAsChanged('domainRules');
                showStatusMessage(browser.i18n.getMessage('removeRuleSuccess'));
            }
        }
    };

    const editDomainRule = (domain) => {
        const ruleData = domainRules[domain];
        if (ruleData) {
            openDomainRuleModal({ domain, ...ruleData });
        } else {
            console.error(`Rule for domain "${domain}" not found in local state.`);
        }
    };

    const saveDomainRule = async () => {
        const newDomain = elements.ruleDomainInput.value.trim();
        const originalDomain = elements.editingDomainInput.value;

        // --- 1. Validation ---
        if (!newDomain) {
            const field = elements.ruleDomainInput.closest('.m3-form-field');
            field.classList.add('is-invalid');
            elements.ruleDomainError.textContent = browser.i18n.getMessage('domainCannotBeEmpty') || 'Domain cannot be empty.';
            // Add shake animation for direct feedback
            field.classList.add('error-shake');
            setTimeout(() => field.classList.remove('error-shake'), 500);
            return;
        }
        // Error is cleared via an input event listener for better UX

        // --- 2. Construct rule object, excluding default values for efficiency ---
        const rule = {};
        // The default for applyToSubdomains is true, so only save the value if it's false.
        if (!elements.ruleApplyToSubdomainsCheckbox.checked) {
            rule.applyToSubdomains = false;
        }
        if (elements.ruleAutoTranslateSelect.value !== 'default') {
            rule.autoTranslate = elements.ruleAutoTranslateSelect.value;
        }
        if (elements.ruleTranslatorEngineSelect.value !== 'default') {
            rule.translatorEngine = elements.ruleTranslatorEngineSelect.value;
        }
        if (elements.ruleTargetLanguageSelect.value !== 'default') {
            rule.targetLanguage = elements.ruleTargetLanguageSelect.value;
        }
        if (elements.ruleSourceLanguageSelect.value !== 'default') { // 新增
            rule.sourceLanguage = elements.ruleSourceLanguageSelect.value;
        }
        if (elements.ruleDisplayModeSelect.value !== 'default') {
            rule.displayMode = elements.ruleDisplayModeSelect.value;
        }
        const inlineSelector = elements.ruleInlineSelectorTextarea.value.trim();
        const blockSelector = elements.ruleBlockSelectorTextarea.value.trim();

        rule.cssSelectorOverride = elements.ruleCssSelectorOverrideCheckbox.checked;
        // 仅当至少一个选择器有值时，才保存 cssSelector 对象。
        if (inlineSelector || blockSelector) {
            rule.cssSelector = {
                inline: inlineSelector,
                block: blockSelector
            };
        } else {
            // 如果两者都为空，则不保存 cssSelector 属性。
            // 这样，除非勾选了覆盖，否则它将继承全局规则。
            delete rule.cssSelector;
        }

        // 保存字幕设置
        const enabled = elements.ruleEnableSubtitleCheckbox.checked;
        if (enabled) {
            rule.subtitleSettings = {
                enabled: true,
                strategy: elements.ruleSubtitleStrategySelect.value,
                displayMode: elements.ruleSubtitleDisplayMode.value
            };
        } else {
            // 如果用户显式地为某个域禁用了该功能，我们应该记录下来。
            rule.subtitleSettings = {
                enabled: false
            };
        }
        // --- 3. Save to local state and mark as changed ---
        if (originalDomain && originalDomain !== newDomain) {
            delete domainRules[originalDomain];
        }
        domainRules[newDomain] = rule;
        markSettingAsChanged('domainRules');
        closeDomainRuleModal();
        renderDomainRules();
        showStatusMessage(browser.i18n.getMessage('saveRuleSuccess') || 'Rule saved successfully.');
    };

    const exportSettings = async () => {
        const { settings } = await browser.storage.sync.get('settings');
        const settingsJson = JSON.stringify(settings, null, 2);
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
                await browser.storage.sync.set({ settings });
                // loadSettings will call markAsSaved()
                showStatusMessage(browser.i18n.getMessage('importSuccess'));
                await loadSettings();
            } catch (error) {
                showStatusMessage(browser.i18n.getMessage('importError'), true);
                console.error(error);
            }
        };
        reader.readAsText(file);
    };

    // --- AI Engine Management Logic ---
    let currentEditingAiEngineId = null; // To track which engine is being edited

    const openAiEngineModal = () => {
        document.body.classList.add('modal-open');
        elements.aiEngineModal.style.display = 'flex'; // Show overlay with flex for centering
        // Force reflow to ensure CSS transition applies
        elements.aiEngineModal.offsetWidth;
        elements.aiEngineModal.classList.add('is-visible'); // Trigger content transition
        renderAiEngineList();
        populateFallbackEngineOptions();
        elements.aiEngineForm.style.display = 'none'; // Hide form initially
        elements.aiTestResult.style.display = 'none'; // Hide test result
        // Apply ripple to dynamically added buttons in the list
        elements.aiEngineList.querySelectorAll('.m3-button').forEach(addRippleEffect);
        // Apply ripple to the "Add New AI Engine" button
        addRippleEffect(elements.addAiEngineBtn);
    };

    const closeAiEngineModal = () => {
        document.body.classList.remove('modal-open');
        elements.aiEngineModal.classList.remove('is-visible'); // Trigger content transition back
        // Listen for the transition end on the modal-content
        const modalContent = elements.aiEngineModal.querySelector('.modal-content');
        const onTransitionEnd = (e) => {
            // Ensure it's the transition of the modal-content's transform/opacity
            if (e.propertyName === 'transform' || e.propertyName === 'opacity') {
                elements.aiEngineModal.style.display = 'none'; // Hide overlay after content transition
                modalContent.removeEventListener('transitionend', onTransitionEnd);
            }
        };
        modalContent.addEventListener('transitionend', onTransitionEnd);

        elements.aiEngineForm.style.display = 'none';
        elements.aiTestResult.style.display = 'none';
        currentEditingAiEngineId = null;
    };

    const hideAiEngineForm = () => {
        elements.aiEngineForm.style.display = 'none';
        elements.aiTestResult.style.display = 'none';
        clearAiFormErrors();
        currentEditingAiEngineId = null;
    };

    // ** 添加 Esc 按键监听器 **
    const handleKeyDown = (event) => {
        if (event.key === "Escape") {
            // 检查 AI 引擎弹窗是否可见
            if (elements.aiEngineModal.classList.contains('is-visible')) {
                // 如果编辑表单是可见的，则先关闭表单
                if (elements.aiEngineForm.style.display !== 'none') {
                    hideAiEngineForm();
                } else {
                    // 否则，关闭整个弹窗
                    closeAiEngineModal();
                }
            } else if (elements.domainRuleModal.classList.contains('is-visible')) {
                // 如果域名规则弹窗可见，则关闭它
                closeDomainRuleModal();
            }
        }
    };

    document.addEventListener('keydown', handleKeyDown);

    /**
     * Opens the domain rule modal, optionally populating it for editing.
     * @param {Object} [ruleData] - The rule data to populate the form with for editing.
     */
    const openDomainRuleModal = (ruleData = {}) => {
        document.body.classList.add('modal-open');
        elements.domainRuleModal.style.display = 'flex'; // Show overlay with flex for centering
        // Force reflow to ensure CSS transition applies
        elements.domainRuleModal.offsetWidth;
        elements.domainRuleModal.classList.add('is-visible'); // Trigger content transition

        // Populate dropdowns with options (including "Use Default")

        // Set form title and initial values
        elements.domainRuleFormTitle.textContent = ruleData.domain ? browser.i18n.getMessage('editDomainRule') || 'Edit Domain Rule' : browser.i18n.getMessage('addDomainRule') || 'Add Domain Rule';
        elements.editingDomainInput.value = ruleData.domain || ''; // Store the original domain for editing
        elements.ruleDomainInput.value = ruleData.domain || '';
        elements.ruleApplyToSubdomainsCheckbox.checked = ruleData.applyToSubdomains !== undefined ? ruleData.applyToSubdomains : true; // Default to true
        elements.ruleAutoTranslateSelect.value = ruleData.autoTranslate || 'default';
        elements.ruleTranslatorEngineSelect.value = ruleData.translatorEngine || 'default';
        elements.ruleTargetLanguageSelect.value = ruleData.targetLanguage || 'default';
        elements.ruleSourceLanguageSelect.value = ruleData.sourceLanguage || 'default';
        elements.ruleDisplayModeSelect.value = ruleData.displayMode || 'default';
        // 兼容处理旧的字符串格式和新的对象格式
        const selector = ruleData.cssSelector;
        if (typeof selector === 'string') {
            // 旧格式：假定它是块级选择器
            elements.ruleInlineSelectorTextarea.value = '';
            elements.ruleBlockSelectorTextarea.value = selector;
        } else {
            // 新格式（或未定义）
            const selectorObj = selector || {};
            elements.ruleInlineSelectorTextarea.value = selectorObj.inline || '';
            elements.ruleBlockSelectorTextarea.value = selectorObj.block || '';
        }
        // Default to false if not specified
        elements.ruleCssSelectorOverrideCheckbox.checked = ruleData.cssSelectorOverride || false;

        // 加载字幕设置
        const subtitleSettings = ruleData.subtitleSettings || {};
        elements.ruleEnableSubtitleCheckbox.checked = subtitleSettings.enabled || false;
        elements.ruleSubtitleStrategySelect.value = subtitleSettings.strategy || 'none';
        elements.ruleSubtitleDisplayMode.value = subtitleSettings.displayMode || 'off';

        // 根据复选框状态控制字幕设置组的可见性
        elements.ruleSubtitleSettingsGroup.style.display = elements.ruleEnableSubtitleCheckbox.checked ? 'block' : 'none';


        // Ensure all select labels are correctly positioned after populating values.
        elements.domainRuleModal.querySelectorAll('.m3-form-field.filled select').forEach(initializeSelectLabel);
        // Also clear any previous validation state
        elements.ruleDomainInput.closest('.m3-form-field').classList.remove('is-invalid');
        elements.ruleDomainError.textContent = '';
    };

    const closeDomainRuleModal = () => {
        document.body.classList.remove('modal-open');
        elements.domainRuleModal.classList.remove('is-visible'); // Trigger content transition back
        const modalContent = elements.domainRuleModal.querySelector('.modal-content');
        // Listen for the transition end on the modal-content
        const onTransitionEnd = (e) => {
            // Ensure it's the transition of the modal-content's transform/opacity
            if (e.propertyName === 'transform' || e.propertyName === 'opacity') {
                elements.domainRuleModal.style.display = 'none'; // Hide overlay after content transition
                modalContent.removeEventListener('transitionend', onTransitionEnd);
            }
        };
        modalContent.addEventListener('transitionend', onTransitionEnd);
    };

    const renderAiEngineList = () => {
        elements.aiEngineList.innerHTML = '';
        if (aiEngines.length === 0) {
            elements.aiEngineList.innerHTML = `<p>${browser.i18n.getMessage('noRulesFound') || 'No AI engines configured.'}</p>`; // Need a new i18n key
            return;
        }
        const ul = document.createElement('ul');
        aiEngines.forEach(engine => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${escapeHtml(engine.name)}</span>
                <div class="actions">
                    <button class="m3-button text edit-ai-engine-btn" data-id="${engine.id}">${browser.i18n.getMessage('edit') || 'Edit'}</button>
                    <button class="m3-button text danger remove-ai-engine-btn" data-id="${engine.id}">${browser.i18n.getMessage('removeRule') || 'Remove'}</button>
                </div>
            `;
            ul.appendChild(li);
        });
        elements.aiEngineList.appendChild(ul);

        ul.querySelectorAll('.edit-ai-engine-btn').forEach(button => {
            button.addEventListener('click', (e) => editAiEngine(e.target.dataset.id));
        });
        ul.querySelectorAll('.remove-ai-engine-btn').forEach(button => {
            button.addEventListener('click', (e) => removeAiEngine(e.target.dataset.id));
        });
    };

    const showAiEngineForm = (engine = {}) => {
        // Apply modal animation classes
        elements.aiEngineModal.style.display = 'flex'; // Show overlay with flex for centering
        // Force reflow to ensure CSS transition applies
        elements.aiEngineModal.offsetWidth;
        elements.aiEngineModal.classList.add('is-visible'); // Trigger content transition

        // Clear previous errors before populating form
        clearAiFormErrors(); // 每次显示表单时清除所有错误提示

        // Show the form itself
        elements.aiEngineForm.style.display = 'block'; // This should be controlled by the modal's visibility

        // Hide test result
        elements.aiTestResult.style.display = 'none';
        elements.aiFormTitle.textContent = engine.id ? (browser.i18n.getMessage('edit') || 'Edit') : (browser.i18n.getMessage('addAiEngine') || 'Add');
        elements.aiEngineNameInput.value = engine.name || '';
        elements.aiApiKeyInput.value = engine.apiKey || '';
        elements.aiApiUrlInput.value = engine.apiUrl || '';
        elements.aiModelNameInput.value = engine.model || '';
        elements.aiCustomPromptInput.value = engine.customPrompt || '';
        // 修复：加载已保存的短文本设置
        elements.aiShortTextThresholdInput.value = engine.wordCountThreshold ?? 1;
        elements.aiShortTextEngineSelect.value = engine.fallbackEngine ?? 'default';
        initializeSelectLabel(elements.aiShortTextEngineSelect); // 修复：更新标签UI，防止重叠
        currentEditingAiEngineId = engine.id || null;
    };

    /**
     * Clears all validation error messages and invalid states from the AI engine form.
     */
    const clearAiFormErrors = () => {
        const fields = ['aiEngineName', 'aiApiKey', 'aiApiUrl', 'aiModelName', 'aiCustomPrompt'];
        fields.forEach(field => {
            const input = elements[`${field}Input`];
            const errorDiv = elements[`${field}Error`];
            if (input && errorDiv) {
                input.closest('.m3-form-field').classList.remove('is-invalid');
                errorDiv.textContent = '';
            }
        });
    };

    /**
     * Validates a single AI form field.
     * @param {HTMLInputElement|HTMLTextAreaElement} inputElement The input or textarea element.
     * @param {HTMLElement} errorElement The div to display the error message.
     * @param {string} i18nKey The i18n key for the field's name.
     * @returns {boolean} True if valid, false otherwise.
     */
    const validateAiFormField = (inputElement, errorElement, i18nKey) => {
        if (inputElement.value.trim() === '') {
            inputElement.closest('.m3-form-field').classList.add('is-invalid');
            errorElement.textContent = `${browser.i18n.getMessage(i18nKey) || i18nKey} ${browser.i18n.getMessage('isRequired') || 'is required.'}`;
            return false;
        }
        inputElement.closest('.m3-form-field').classList.remove('is-invalid');
        errorElement.textContent = ''; // 修复：将 errorDiv 改为 errorElement
        return true;
    };

    const addAiEngine = () => {
        showAiEngineForm();
    };

    const editAiEngine = (id) => {
        const engine = aiEngines.find(e => e.id === id);
        if (engine) {
            populateFallbackEngineOptions(id);
            showAiEngineForm(engine);
        }
    };

    const getAiEngineFormData = () => {
        return {
            name: elements.aiEngineNameInput.value.trim(),
            apiKey: elements.aiApiKeyInput.value.trim(),
            apiUrl: elements.aiApiUrlInput.value.trim(),
            model: elements.aiModelNameInput.value.trim(),
            customPrompt: elements.aiCustomPromptInput.value.trim(),
            wordCountThreshold: parseInt(elements.aiShortTextThresholdInput.value, 10) || 0,
            fallbackEngine: elements.aiShortTextEngineSelect.value
        };
    };

    const saveAiEngine = async () => {
        clearAiFormErrors(); // Clear previous errors before validating

        const engineData = getAiEngineFormData();

        let isValid = true;
        isValid = validateAiFormField(elements.aiEngineNameInput, elements.aiEngineNameError, 'aiEngineName') && isValid;
        isValid = validateAiFormField(elements.aiApiKeyInput, elements.aiApiKeyError, 'aiApiKey') && isValid;
        isValid = validateAiFormField(elements.aiApiUrlInput, elements.aiApiUrlError, 'aiApiUrl') && isValid;
        isValid = validateAiFormField(elements.aiModelNameInput, elements.aiModelNameError, 'aiModelName') && isValid;
        isValid = validateAiFormField(elements.aiCustomPromptInput, elements.aiCustomPromptError, 'aiCustomPrompt') && isValid;

        if (!isValid) {
            // Find the first invalid field and shake it for better user feedback
            const firstInvalidField = elements.aiEngineForm.querySelector('.m3-form-field.is-invalid');
            if (firstInvalidField) {
                firstInvalidField.classList.add('error-shake');
                setTimeout(() => firstInvalidField.classList.remove('error-shake'), 500);
            }
            return;
        }

        if (currentEditingAiEngineId) {
            // Edit existing
            const index = aiEngines.findIndex(e => e.id === currentEditingAiEngineId);
            if (index !== -1) {
                aiEngines[index] = { id: currentEditingAiEngineId, ...engineData };
            }
        } else {
            // Add new
            const newId = `ai-${Date.now()}`; // Simple unique ID
            aiEngines.push({ id: newId, ...engineData });
        }
        markSettingAsChanged('aiEngines'); // Mark settings as changed
        renderAiEngineList();
        populateTranslatorEngineOptions(); // Update main dropdown
        hideAiEngineForm(); // Hide form and test results, and clear state
    };

    const removeAiEngine = (id) => {
        if (window.confirm(browser.i18n.getMessage('confirmDeleteRule') || 'Are you sure you want to remove this AI engine?')) { // Need new i18n key
            aiEngines = aiEngines.filter(e => e.id !== id);
            markSettingAsChanged('aiEngines'); // Mark settings as changed
            renderAiEngineList();
            populateTranslatorEngineOptions(); // Update main dropdown
            // If the removed engine was selected, reset the main dropdown
            if (elements.translatorEngine.value === `ai:${id}`) {
                // 这部分逻辑需要调整，确保在没有 AI 引擎时，下拉菜单显示正确的默认选项
                if (aiEngines.length > 0) {
                    // 如果还有其他 AI 引擎，则选择第一个
                    elements.translatorEngine.value = `ai:${aiEngines[0].id}`;
                } else {
                    elements.translatorEngine.value = 'deeplx';
                    toggleApiFields();
                }
            }
        }
    };

    const populateTranslatorEngineOptions = () => {
        // 1. 彻底清空，以防止任何重复
        elements.translatorEngine.innerHTML = '';

        // 2. 从常量添加内置翻译引擎
        for (const key in Constants.SUPPORTED_ENGINES) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = browser.i18n.getMessage(Constants.SUPPORTED_ENGINES[key]);
            elements.translatorEngine.appendChild(option);
        }

        // 3. 添加用户配置的 AI 引擎
        aiEngines.forEach(engine => {
            const option = document.createElement('option');
            option.value = `ai:${engine.id}`;
            option.textContent = engine.name; // Use the user-defined name directly.
            elements.translatorEngine.appendChild(option);
        });
    };

    const populateFallbackEngineOptions = (currentEngineId = null) => {
        const select = elements.aiShortTextEngineSelect;
        select.innerHTML = ''; // Clear existing options

        // Add "Use Default" option
        const defaultOption = document.createElement('option');
        defaultOption.value = 'default';
        defaultOption.textContent = browser.i18n.getMessage('useDefaultSetting');
        select.appendChild(defaultOption);

        // Add default translators
        for (const key in Constants.SUPPORTED_ENGINES) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = browser.i18n.getMessage(Constants.SUPPORTED_ENGINES[key]);
            select.appendChild(option);
        }

        // Add other AI engines
        aiEngines.forEach(engine => {
            if (engine.id !== currentEngineId) {
                const option = document.createElement('option');
                option.value = `ai:${engine.id}`;
                option.textContent = engine.name;
                select.appendChild(option);
            }
        });
        // 修复：在填充完选项后，强制更新标签UI以防止重叠
        initializeSelectLabel(select);
    };

    /**
     * Populates the dropdowns within the domain rule modal.
     * This includes translation engines, target languages, and display modes.
     */
    const populateModalDropdowns = () => {
        // Populate Translator Engine dropdown
        const engineSelect = elements.ruleTranslatorEngineSelect;
        engineSelect.innerHTML = ''; // 清空现有选项
        const defaultEngineOption = document.createElement('option');
        defaultEngineOption.value = 'default';
        defaultEngineOption.textContent = browser.i18n.getMessage('useDefaultSetting');
        engineSelect.appendChild(defaultEngineOption);
        for (const key in Constants.SUPPORTED_ENGINES) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = browser.i18n.getMessage(Constants.SUPPORTED_ENGINES[key]);
            engineSelect.appendChild(option);
        }
        aiEngines.forEach(engine => {
            const option = document.createElement('option');
            option.value = `ai:${engine.id}`;
            option.textContent = engine.name;
            engineSelect.appendChild(option);
        });

        // Populate Target Language dropdown
        const langSelect = elements.ruleTargetLanguageSelect;
        langSelect.innerHTML = ''; // 清空现有选项
        const defaultLangOption = document.createElement('option');
        defaultLangOption.value = 'default';
        defaultLangOption.textContent = browser.i18n.getMessage('useDefaultSetting');
        langSelect.appendChild(defaultLangOption);
        for (const code in Constants.SUPPORTED_LANGUAGES) {
            if (code === 'auto') continue; // 'auto' is not a target language
            const option = document.createElement('option');
            option.value = code;
            option.textContent = browser.i18n.getMessage(Constants.SUPPORTED_LANGUAGES[code]);
            langSelect.appendChild(option);
        }

        // Populate Source Language dropdown
        const sourceLangSelect = elements.ruleSourceLanguageSelect;
        sourceLangSelect.innerHTML = ''; // 清空现有选项
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

        // Populate Auto Translate dropdown
        populateAutoTranslateOptions(elements.ruleAutoTranslateSelect, true);

        // Populate Display Mode dropdown
        populateDisplayModeOptions(elements.ruleDisplayModeSelect, true);

        // 填充字幕策略下拉菜单
        const strategySelect = elements.ruleSubtitleStrategySelect;
        strategySelect.innerHTML = ''; // 清空现有选项
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

        // 填充字幕显示模式下拉菜单
        const displayModeSelect = elements.ruleSubtitleDisplayMode;
        if (displayModeSelect) {
            displayModeSelect.innerHTML = ''; // 清空现有选项
            for (const code in Constants.SUBTITLE_DISPLAY_MODES) {
                const option = document.createElement('option');
                option.value = code;
                const i18nKey = Constants.SUBTITLE_DISPLAY_MODES[code];
                option.textContent = browser.i18n.getMessage(i18nKey) || code;
                displayModeSelect.appendChild(option);
            }
        }
    };
    const populateLanguageOptions = () => {
        const select = elements.targetLanguage;
        if (!select) return;
        select.innerHTML = ''; // 清空现有选项

        for (const code in Constants.SUPPORTED_LANGUAGES) {
            // 'auto' is not a valid target language, only a source language option.
            if (code === 'auto') continue;
            const option = document.createElement('option');
            option.value = code;
            const langKey = Constants.SUPPORTED_LANGUAGES[code];
            option.textContent = browser.i18n.getMessage(langKey) || code;
            select.appendChild(option);
        }
    };

    /**
 * Populates a select element with auto-translate mode options.
 * @param {HTMLSelectElement} selectElement The <select> element to populate.
 * @param {boolean} includeDefault If true, adds a "Use Default" option at the beginning.
 */
    const populateAutoTranslateOptions = (selectElement, includeDefault = false) => {
        if (!selectElement) return;
        selectElement.innerHTML = ''; // Clear existing options

        if (includeDefault) {
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.textContent = browser.i18n.getMessage('useDefaultSetting');
            selectElement.appendChild(defaultOption);
        }

        for (const code in Constants.AUTO_TRANSLATE_MODES) {
            const option = document.createElement('option');
            option.value = code;
            const i18nKey = Constants.AUTO_TRANSLATE_MODES[code];
            option.textContent = browser.i18n.getMessage(i18nKey) || code;
            selectElement.appendChild(option);
        }
    };

    /**
     * Populates a select element with display mode options.
     * @param {HTMLSelectElement} selectElement The <select> element to populate.
     * @param {boolean} includeDefault If true, adds a "Use Default" option at the beginning.
     */
    const populateDisplayModeOptions = (selectElement, includeDefault = false) => {
        if (!selectElement) return;
        selectElement.innerHTML = ''; // Clear existing options

        if (includeDefault) {
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.textContent = browser.i18n.getMessage('useDefaultSetting');
            selectElement.appendChild(defaultOption);
        }

        for (const code in Constants.DISPLAY_MODES) {
            const option = document.createElement('option');
            option.value = code;
            const i18nKey = Constants.DISPLAY_MODES[code].optionsKey;
            option.textContent = browser.i18n.getMessage(i18nKey) || code;
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
            elements.logContent.textContent = ''; // Clear log when hidden
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

        // --- Pre-check Logic ---
        const rawRules = getPrecheckRulesFromUI();
        const compiledRules = precompileRules(rawRules);

        const currentUiSettings = {
            targetLanguage: elements.targetLanguage.value,
            precheckRules: compiledRules
        };

        const precheck = window.shouldTranslate(sourceText, currentUiSettings);
        // 始终首先显示预检查日志。
        elements.logContent.textContent = precheck.log.join('\n');
        document.getElementById('test-log-area').style.display = 'block';
        elements.toggleLogBtn.textContent = browser.i18n.getMessage('hideLogButton') || 'Hide Log';

        if (!precheck.result) {
            resultArea.textContent = `${browser.i18n.getMessage('testNotTranslated')} ${sourceText}`;
            resultArea.className = 'test-result-area success';
            return;
        }
        // --- End of Pre-check Logic ---

        resultArea.textContent = browser.i18n.getMessage('testing') || 'Translating...';
        resultArea.className = 'test-result-area';

        try {
            let aiConfigToTest = null;
            const selectedEngineValue = elements.translatorEngine.value;
            if (selectedEngineValue.startsWith('ai:')) {
                const selectedEngineId = selectedEngineValue.split(':')[1];
                aiConfigToTest = aiEngines.find(e => e.id === selectedEngineId);
                if (!aiConfigToTest) {
                    throw new Error(browser.i18n.getMessage('aiModelNameMissingError') || 'Selected AI engine configuration not found.');
                }
            }

            const payload = {
                text: sourceText,
                targetLang: elements.targetLanguage.value,
                sourceLang: 'auto',
                // Pass the specific AI config if an AI engine is selected
                aiConfig: aiConfigToTest
            };

            // If testing an AI engine, ensure the AI API Key, URL, Model, Prompt are available
            if (selectedEngineValue.startsWith('ai:') && (!aiConfigToTest.apiKey || !aiConfigToTest.apiUrl || !aiConfigToTest.model || !aiConfigToTest.customPrompt)) {
                throw new Error(browser.i18n.getMessage('aiApiUrlMissingError') || 'AI API Key, URL, Model, and Custom Prompt are required for the selected AI engine.');
            }

            // Send message to background service worker for translation
            const response = await browser.runtime.sendMessage({
                type: 'TRANSLATE_TEXT',
                payload: { // The payload structure for TRANSLATE_TEXT is handled by TranslatorManager
                    text: sourceText, // This is the text to translate
                    targetLang: elements.targetLanguage.value, // Target language
                    sourceLang: 'auto', // Source language
                }
            });

            console.log('[Options Page Debug] Received response from service worker:', JSON.parse(JSON.stringify(response))); // Debug log

            // 将翻译日志追加到现有的预检查日志之后。
            if (response.log && response.log.length > 0) {
                elements.logContent.textContent += '\n' + response.log.join('\n');
            }

            if (response.success) { // 处理翻译结果
                if (response.translatedText.translated) {
                    resultArea.textContent = response.translatedText.text; // 从嵌套对象中获取实际文本
                } else {
                    resultArea.textContent = `${browser.i18n.getMessage('testNotTranslated')} ${response.translatedText.text}`;
                }
                resultArea.className = 'test-result-area success';
            } else {
                resultArea.textContent = `Error: ${response.error}`;
                resultArea.className = 'test-result-area error';
            }
        } catch (error) {
            console.error('Translation test error:', error); // 捕获并显示测试翻译过程中的错误
            resultArea.textContent = `Error: ${error.message}`;
            resultArea.className = 'test-result-area error';
        }
    };

    const testAiEngineConnection = async () => {
        clearAiFormErrors(); // Clear previous errors before validating

        const engineData = getAiEngineFormData();

        let isValid = true;
        isValid = validateAiFormField(elements.aiEngineNameInput, elements.aiEngineNameError, 'aiEngineName') && isValid;
        isValid = validateAiFormField(elements.aiApiKeyInput, elements.aiApiKeyError, 'aiApiKey') && isValid;
        isValid = validateAiFormField(elements.aiApiUrlInput, elements.aiApiUrlError, 'aiApiUrl') && isValid;
        isValid = validateAiFormField(elements.aiModelNameInput, elements.aiModelNameError, 'aiModelName') && isValid;
        isValid = validateAiFormField(elements.aiCustomPromptInput, elements.aiCustomPromptError, 'aiCustomPrompt') && isValid;

        if (!isValid) {
            elements.aiTestResult.style.display = 'none'; // Hide test result if validation fails
            return;
        }

        elements.aiTestResult.textContent = browser.i18n.getMessage('testing') || 'Testing...';
        // Reset classes and make visible
        elements.aiTestResult.classList.remove('success', 'error');
        elements.aiTestResult.style.display = 'block';

        try {
            const response = await browser.runtime.sendMessage({
                type: 'TEST_CONNECTION',
                payload: {
                    engine: 'ai',
                    settings: { ...engineData } // Pass the specific AI config to test
                }
            });

            if (response.success) {
                elements.aiTestResult.textContent = `${browser.i18n.getMessage('testOriginal')}: test, ${browser.i18n.getMessage('testTranslated')}: ${response.translatedText.text}`;
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

    /**
     * Runs a global test of the pre-check rules against the text in the main test input.
     */
    const runGlobalPrecheckTest = () => {
        const testText = elements.testTextInput.value;
        const fieldContainer = elements.testTextInput.closest('.m3-form-field');

        // If the test text is empty, we can't run any tests.
        // Show an inline validation error instead of a global status message.
        if (!testText) {
            fieldContainer.classList.add('is-invalid');
            elements.testTextInputError.textContent = browser.i18n.getMessage('enterTestText') || 'Please enter test text.';
            elements.testTextInput.focus();
            fieldContainer?.classList.add('error-shake');
            setTimeout(() => fieldContainer?.classList.remove('error-shake'), 500);
            return;
        }

        // Clear any previous error state if the input is valid.
        fieldContainer.classList.remove('is-invalid');
        elements.testTextInputError.textContent = '';
        // Find all rule items currently in the DOM and trigger their individual test function.
        document.querySelectorAll('.rule-item').forEach(item => {
            const regexInput = item.querySelector('.rule-regex');
            const flagsInput = item.querySelector('.rule-flags');
            const resultElement = item.querySelector('.rule-test-result');

            // Directly call the test logic for each rule.
            if (regexInput && flagsInput && resultElement) {
                testRegex(regexInput, flagsInput, resultElement);
            }
        });
    };

    // --- Initialization and Event Listeners ---
    const initialize = async () => {
        applyTranslations();
        populateLanguageOptions();
        populateDisplayModeOptions(elements.displayModeSelect);
        await loadSettings();
        manageSelectLabels(); // Ensure select labels are correctly positioned on load and on change
        populateModalDropdowns(); // Populate modal dropdowns on initialization
        // Apply ripple effect to all static M3 buttons (excluding FAB for now)
        document.querySelectorAll('.m3-button:not(#saveSettingsBtn)').forEach(addRippleEffect);
        addRippleEffect(elements.addDomainRuleBtn); // Ensure this one gets it too (for opening the modal)


        // Main settings listeners
        elements.translatorEngine.addEventListener('change', () => {
            markSettingAsChanged('translatorEngine');
            toggleApiFields(); // 合并监听器，使逻辑更清晰
        });
        elements.targetLanguage.addEventListener('change', () => markSettingAsChanged('targetLanguage'));
        elements.defaultInlineSelector.addEventListener('input', () => markSettingAsChanged('translationSelector'));
        elements.defaultBlockSelector.addEventListener('input', () => markSettingAsChanged('translationSelector'));
        elements.deeplxApiUrl.addEventListener('input', () => markSettingAsChanged('deeplxApiUrl'));
        elements.displayModeSelect.addEventListener('change', () => markSettingAsChanged('displayMode'));
        elements.saveSettingsBtn.addEventListener('click', saveSettings);
        elements.resetSettingsBtn.addEventListener('click', resetSettings);
        elements.exportBtn.addEventListener('click', exportSettings);
        elements.importBtn.addEventListener('click', () => elements.importInput.click());

        // AI Engine Modal Listeners
        elements.manageAiEnginesBtn.addEventListener('click', openAiEngineModal);
        elements.closeAiEngineModalBtn.addEventListener('click', closeAiEngineModal);
        elements.addAiEngineBtn.addEventListener('click', addAiEngine);
        // Clear the specific field's error on input for better UX
        elements.aiEngineForm.addEventListener('input', (event) => {
            const field = event.target.closest('.m3-form-field');
            if (field && field.classList.contains('is-invalid')) {
                field.classList.remove('is-invalid');
                const errorDiv = field.querySelector('.error-message');
                if (errorDiv) errorDiv.textContent = '';
                field.classList.remove('error-shake'); // Also remove shake class if present
            }
        });
        elements.saveAiEngineBtn.addEventListener('click', saveAiEngine);
        elements.cancelAiEngineBtn.addEventListener('click', hideAiEngineForm);
        elements.testAiEngineBtn.addEventListener('click', testAiEngineConnection);

        // Domain Rule Modal Listeners
        elements.addDomainRuleBtn.addEventListener('click', () => openDomainRuleModal()); // Open modal for adding new rule
        elements.closeDomainRuleModalBtn.addEventListener('click', closeDomainRuleModal);
        elements.cancelDomainRuleBtn.addEventListener('click', closeDomainRuleModal);
        elements.saveDomainRuleBtn.addEventListener('click', saveDomainRule); // This function will be implemented next

        // 字幕启用复选框的监听器
        elements.ruleEnableSubtitleCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            elements.ruleSubtitleSettingsGroup.style.display = isChecked ? 'block' : 'none';
            // 如果是开启，则平滑滚动到新出现的菜单，提升用户体验
            if (isChecked) {
                elements.ruleSubtitleSettingsGroup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        // Clear domain rule validation error on input
        elements.ruleDomainInput.addEventListener('input', () => {
            const field = elements.ruleDomainInput.closest('.m3-form-field');
            if (field.classList.contains('is-invalid')) {
                field.classList.remove('is-invalid');
                elements.ruleDomainError.textContent = '';
                field.classList.remove('error-shake');
            }
        });

        // Other listeners
        elements.importInput.addEventListener('change', importSettings);

        elements.runGlobalTestBtn.addEventListener('click', runGlobalPrecheckTest);
        if (elements.testTextInput) {
            elements.testTextInput.addEventListener('focus', () => {
                // Hide all visible test results when the main test text input gets focus
                document.querySelectorAll('.rule-test-result.show').forEach(resultEl => {
                    resultEl.classList.remove('show');
                });
            });
            // Add an input listener to clear the validation error as the user types.
            elements.testTextInput.addEventListener('input', () => {
                const fieldContainer = elements.testTextInput.closest('.m3-form-field');
                if (fieldContainer.classList.contains('is-invalid')) {
                    fieldContainer.classList.remove('is-invalid');
                    elements.testTextInputError.textContent = '';
                }
            });
        }

        // 旧的、通用的“未保存更改”监听器已被移除。
        // 新的系统使用附加到特定元素或操作的精确监听器。

        const testTranslationBtn = document.getElementById('testTranslationBtn');
        if (testTranslationBtn) testTranslationBtn.addEventListener('click', toggleTestArea);
        elements.toggleLogBtn.addEventListener('click', toggleLogArea);

        const sourceTextArea = document.getElementById('test-source-text');
        const manualTranslateBtn = document.getElementById('manual-test-translate-btn');
        if (manualTranslateBtn) manualTranslateBtn.addEventListener('click', performTestTranslation);

        elements.mainTabButtons.forEach(button => {
            button.addEventListener('click', () => switchMainTab(button.dataset.tab));
        });
        // Apply ripple to tab buttons
        document.querySelectorAll('.tab-button').forEach(addRippleEffect);
        // Apply ripple to add rule button in precheck rules
        document.querySelectorAll('.add-rule-btn').forEach(addRippleEffect);

        // --- Before Unload Listener ---
        window.addEventListener('beforeunload', (event) => {
            const hasChanges = Object.values(unsavedChanges).some(Boolean);
            if (hasChanges) {
                // 现代浏览器通常会显示一个通用的提示信息，而不是自定义的字符串
                event.preventDefault(); // 阻止默认行为，触发提示
                event.returnValue = ''; // 某些浏览器需要设置此属性
                return ''; // 某些浏览器需要返回一个字符串
            }
        });
    };

    initialize();
});