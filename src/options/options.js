import browser from '../lib/browser-polyfill.js';
import { SettingsManager } from '../common/settings-manager.js';
import { shouldTranslate } from '../common/precheck.js';
import * as Constants from '../common/constants.js';
import { FormValidator } from './validator.js';
import { SUBTITLE_STRATEGIES } from '../content/subtitle/strategy-manifest.js';

document.addEventListener('DOMContentLoaded', () => {

    // --- 全局验证器实例 ---
    let aiEngineValidator;
    let domainRuleValidator;

    // --- Element Cache ---
    const elements = {
        translatorEngine: document.getElementById('translatorEngine'),
        deeplxUrlGroup: document.getElementById('deeplxUrlGroup'),
        aiEngineManagementGroup: document.getElementById('aiEngineManagementGroup'), // New AI management group   
        addDomainRuleBtn: document.getElementById('addDomainRuleBtn'), // This is used
        domainRulesList: document.getElementById('domainRulesList'), // This is used
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
        importAiEngineModal: document.getElementById('importAiEngineModal'),
        openImportAiEngineModalBtn: document.getElementById('openImportAiEngineModalBtn'),
        confirmImportAiEngineBtn: document.getElementById('confirmImportAiEngineBtn'),
        cancelImportAiEngineBtn: document.getElementById('cancelImportAiEngineBtn'),
        importAiEngineConfigText: document.getElementById('importAiEngineConfigText'),
        importAiEngineErrorText: document.getElementById('importAiEngineErrorText'),
        aiEngineNameInput: document.getElementById('aiEngineName'),
        aiApiKeyInput: document.getElementById('aiApiKey'),
        aiApiUrlInput: document.getElementById('aiApiUrl'),
        aiModelNameInput: document.getElementById('aiModelName'),
        aiCustomPromptInput: document.getElementById('aiCustomPrompt'),
        aiShortTextThresholdInput: document.getElementById('aiShortTextThreshold'),
        aiShortTextEngineSelect: document.getElementById('aiShortTextEngine'),
        saveAiEngineBtn: document.getElementById('saveAiEngineBtn'),
        cancelAiEngineBtn: document.getElementById('cancelAiEngineBtn'),
        testAiEngineBtn: document.getElementById('testAiEngineBtn'),
        aiTestResult: document.getElementById('aiTestResult'),
        closeDomainRuleModalBtn: document.querySelector('#domainRuleModal .close-button'),
        domainRuleFormTitle: document.getElementById('domainRuleFormTitle'),
        editingDomainInput: document.getElementById('editingDomain'),
        ruleDomainInput: document.getElementById('ruleDomain'),
        ruleApplyToSubdomainsCheckbox: document.getElementById('ruleApplyToSubdomains'),
        ruleAutoTranslateSelect: document.getElementById('ruleAutoTranslate'),
        ruleTranslatorEngineSelect: document.getElementById('ruleTranslatorEngine'),
        ruleTargetLanguageSelect: document.getElementById('ruleTargetLanguage'),
        ruleSourceLanguageSelect: document.getElementById('ruleSourceLanguage'),
        ruleDisplayModeSelect: document.getElementById('ruleDisplayMode'),
        ruleInlineSelectorTextarea: document.getElementById('ruleInlineSelector'),
        ruleBlockSelectorTextarea: document.getElementById('ruleBlockSelector'),
        ruleExcludeSelectorTextarea: document.getElementById('ruleExcludeSelector'),
        ruleExcludeSelectorError: document.getElementById('ruleExcludeSelectorError'), // 新增
        ruleCssSelectorOverrideCheckbox: document.getElementById('ruleCssSelectorOverride'),
        cancelDomainRuleBtn: document.getElementById('cancelDomainRuleBtn'),
        ruleEnableSubtitleCheckbox: document.getElementById('ruleEnableSubtitle'),
        ruleSubtitleSettingsGroup: document.getElementById('ruleSubtitleSettingsGroup'),
        ruleSubtitleStrategySelect: document.getElementById('ruleSubtitleStrategy'),
        ruleSubtitleDisplayMode: document.getElementById('ruleSubtitleDisplayMode'),
        displayModeSelect: document.getElementById('displayModeSelect'),
        saveSettingsBtn: document.getElementById('saveSettingsBtn'),
        domainRuleModal: document.getElementById('domainRuleModal'),

        saveDomainRuleBtn: document.getElementById('saveDomainRuleBtn'),
        // Global Pre-check Test Elements
        runGlobalTestBtn: document.getElementById('runGlobalTestBtn'),
        testTextInput: document.getElementById('testTextInput'),
        testTextInputError: document.getElementById('testTextInputError'),
        // Cache Management Elements
        cacheSizeInput: document.getElementById('cacheSizeInput'),
        cacheInfoDisplay: document.getElementById('cacheInfoDisplay'),
        clearCacheBtn: document.getElementById('clearCacheBtn'),
        domainRuleForm: document.getElementById('domainRuleForm'),
    };
    elements.toggleLogBtn = document.getElementById('toggleLogBtn');
    elements.logContent = document.getElementById('log-content');
    // 为日志内容区域设置样式，以确保其能够正确换行
    if (elements.logContent) {
        elements.logContent.style.whiteSpace = 'pre-wrap'; // 保留换行符和空格，并自动换行
        elements.logContent.style.wordBreak = 'break-all';   // 允许在长单词或URL内部断开，防止溢出
    }

    /**
     * Validates a regular expression and its flags.
     * Adds/removes 'is-invalid' class and sets 'title' attribute for error messages.
     * @param {HTMLInputElement} regexInput - The input element containing the regex string.
     * @param {HTMLInputElement} flagsInput - The input element containing the regex flags.
     * @returns {boolean} True if the regex is valid, false otherwise.
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

    // --- 状态管理：快照机制 ---
    let initialSettingsSnapshot = ''; // 将存储初始设置的 JSON 字符串。
    /**
     * 从 UI 读取所有值并构建一个设置对象。
     * 这是选项页面当前状态的唯一真实来源。
     * @returns {object} 当前的设置对象。
     */
    const getSettingsFromUI = () => {
        const settings = {};
        settings.translatorEngine = elements.translatorEngine.value;
        settings.targetLanguage = elements.targetLanguage.value;
        settings.displayMode = elements.displayModeSelect.value;
        settings.deeplxApiUrl = elements.deeplxApiUrl.value;
        settings.translationSelector = {
            default: {
                inline: elements.defaultInlineSelector.value,
                block: elements.defaultBlockSelector.value
            }
        };
        settings.aiEngines = aiEngines; // 此数组在内存中保持同步
        settings.precheckRules = getPrecheckRulesFromUI(); // 此函数已从 UI 读取
        settings.domainRules = domainRules; // 此对象在内存中保持同步
        const size = parseInt(elements.cacheSizeInput.value, 10);
        settings.cacheSize = !isNaN(size) && size >= 0 ? size : Constants.DEFAULT_SETTINGS.cacheSize;
        return settings;
    };

    const updateSaveButtonState = () => {
        const currentSettingsString = JSON.stringify(getSettingsFromUI());
        const hasChanges = currentSettingsString !== initialSettingsSnapshot;
        elements.saveSettingsBtn.classList.toggle('visible', hasChanges);
    };

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

    // --- Core Logic Functions ---
    const loadSettings = async () => {
        try {
            const currentSettings = await SettingsManager.getValidatedSettings();

            // Load AI Engines and populate the dropdown BEFORE setting the value
            aiEngines = JSON.parse(JSON.stringify(currentSettings.aiEngines)); // Deep copy
            populateEngineSelect(elements.translatorEngine); // Populate the main dropdown

            // Now that all <option> elements exist, set the selected value.
            elements.translatorEngine.value = currentSettings.translatorEngine;
            elements.targetLanguage.value = currentSettings.targetLanguage;
            const defaultSelector = currentSettings.translationSelector.default || {};
            elements.defaultInlineSelector.value = defaultSelector.inline || '';
            elements.defaultBlockSelector.value = defaultSelector.block || '';
            elements.deeplxApiUrl.value = currentSettings.deeplxApiUrl;
            elements.displayModeSelect.value = currentSettings.displayMode;

            elements.cacheSizeInput.value = currentSettings.cacheSize ?? Constants.DEFAULT_SETTINGS.cacheSize;
            domainRules = JSON.parse(JSON.stringify(currentSettings.domainRules)); // Deep copy

            precheckRules = JSON.parse(JSON.stringify(currentSettings.precheckRules));

            updateApiFieldsVisibility();
            renderDomainRules();
            renderPrecheckRulesUI();
            await updateCacheInfo();
            // 创建初始快照并确保保存按钮被隐藏
            initialSettingsSnapshot = JSON.stringify(getSettingsFromUI());
            updateSaveButtonState();
        } catch (error) {
            console.error("Failed to load and validate settings:", error);
            showStatusMessage(browser.i18n.getMessage('loadSettingsError'), true);
        }
    };

    const saveSettings = async () => {
        // --- 1. 设置状态为 'loading'，CSS 将自动显示加载动画 ---
        elements.saveSettingsBtn.dataset.state = 'loading';

        // --- 2. 从UI获取设置并验证 ---
        const settingsToSave = getSettingsFromUI();
        const hasInvalidRegex = !!document.querySelector('.rule-item .m3-form-field.is-invalid');

        if (hasInvalidRegex) {
            // --- 3a. 处理验证错误，CSS 将自动触发抖动动画 ---
            elements.saveSettingsBtn.dataset.state = 'error';
            const firstInvalidField = document.querySelector('.rule-item .m3-form-field.is-invalid');
            if (firstInvalidField) {
                firstInvalidField.classList.add('error-shake');
                setTimeout(() => firstInvalidField.classList.remove('error-shake'), 500);
            }
            // 抖动动画结束后，重置 FAB 状态，以便用户可以再次点击
            setTimeout(() => {
                elements.saveSettingsBtn.dataset.state = '';
            }, 500);
            return; // 中止保存
        }

        try {
            // --- 3b. 保存设置 ---
            await browser.storage.sync.set({ settings: settingsToSave });
            initialSettingsSnapshot = JSON.stringify(settingsToSave); // 更新快照

            // --- 4. 处理成功 UI，CSS 将自动显示对勾图标和颜色 ---
            elements.saveSettingsBtn.dataset.state = 'success';

            // 成功状态显示 1.2 秒后，隐藏 FAB
            setTimeout(() => {
                updateSaveButtonState(); // 触发隐藏动画
                setTimeout(() => { elements.saveSettingsBtn.dataset.state = ''; }, 200); // 动画后重置状态
            }, 1200);
        } catch (error) {
            console.error('Error saving settings:', error);
            // --- 5. 处理保存错误 ---
            elements.saveSettingsBtn.dataset.state = 'error';
            setTimeout(() => { elements.saveSettingsBtn.dataset.state = ''; }, 500);
        }
    };

    const resetSettings = async () => {
        const confirmationMessage = browser.i18n.getMessage('resetSettingsConfirm') || 'Are you sure you want to reset all settings to their default values? This action cannot be undone.';
        if (window.confirm(confirmationMessage)) {
            try {
                const defaultSettings = JSON.parse(JSON.stringify(Constants.DEFAULT_SETTINGS));
                // Dynamically generate the default precheck rules with i18n names
                defaultSettings.precheckRules = SettingsManager.generateDefaultPrecheckRules();

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
            tabButton.dataset.category = category; // 数据集用于事件委托
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

    /**
     * Applies i18n translations to all elements with `i18n-text` within a given fragment.
     * @param {DocumentFragment|HTMLElement} fragment The fragment to translate.
     */
    function applyTranslationsToFragment(fragment) {
        fragment.querySelectorAll('[i18n-text]').forEach(el => {
            const key = el.getAttribute('i18n-text');
            const message = browser.i18n.getMessage(key);
            if (message) {
                el.textContent = message;
            }
        });
    }

    function createRuleItemElement(rule) {
        const template = document.getElementById('precheck-rule-template');
        if (!template) {
            console.error("Fatal: precheck-rule-template not found in DOM.");
            return document.createElement('div'); // Return empty div to prevent crash
        }

        const fragment = template.content.cloneNode(true);
        const item = fragment.querySelector('.rule-item');

        // --- 为可访问性生成唯一的 ID ---
        const randomId = `rule-${Math.random().toString(36).substr(2, 9)}`;

        // --- 查找元素并填充数据 ---
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

        // --- 应用国际化文本 ---
        applyTranslationsToFragment(item);
        return item;
    }

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
            updateSaveButtonState(); // 添加规则也算作更改
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
    };



    const removeDomainRule = (domainToRemove) => {
        const confirmationMessage = browser.i18n.getMessage('confirmDeleteRule') || 'Are you sure you want to delete this rule?';
        if (window.confirm(confirmationMessage)) {
            if (domainRules[domainToRemove]) {
                delete domainRules[domainToRemove];
                renderDomainRules(); // Re-render the list
                updateSaveButtonState(); // Update save button state
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
        // --- 1. 使用通用验证器进行验证 ---
        if (!domainRuleValidator.validate()) {
            return;
        }

        // (新) 手动验证排除选择器
        const excludeSelectorInput = elements.ruleExcludeSelectorTextarea;
        const excludeSelectorField = excludeSelectorInput.closest('.m3-form-field');
        const excludeSelectorErrorEl = elements.ruleExcludeSelectorError;
        const excludeSelector = excludeSelectorInput.value.trim();

        excludeSelectorField.classList.remove('is-invalid');
        if (excludeSelectorErrorEl) excludeSelectorErrorEl.textContent = '';

        if (excludeSelector) {
            // (新) 验证列表中的每一个选择器，而不仅仅是第一个。
            const selectors = excludeSelector.split(',').map(s => s.trim()).filter(s => s);
            let isInvalid = false;
            for (const selector of selectors) {
                try {
                    // 仅用于验证目的，如果选择器无效则会抛出异常。
                    document.querySelector(selector);
                } catch (e) {
                    isInvalid = true;
                    break; // 找到第一个无效的选择器后就停止
                }
            }
            if (isInvalid) {
                excludeSelectorField.classList.add('is-invalid');
                if (excludeSelectorErrorEl) excludeSelectorErrorEl.textContent = browser.i18n.getMessage('invalidCssSelector');
                return; // 停止保存
            }
        }
        // --- 2. 构造规则对象，为提高效率排除默认值 ---
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
        // (新) 保存排除选择器
        if (excludeSelector) {
            rule.excludeSelectors = excludeSelector;
        } else {
            delete rule.excludeSelectors; // 如果为空，则从规则中删除该属性，保持数据清洁
        }
        // --- 保存字幕设置 ---
        // 改进：在禁用时保留现有设置，以改善用户体验。
        const enabled = elements.ruleEnableSubtitleCheckbox.checked;
        const existingRule = domainRules[originalDomain] || {};
        const existingSubtitleSettings = existingRule.subtitleSettings || {};

        if (enabled) {
            rule.subtitleSettings = {
                ...existingSubtitleSettings, // 保留任何其他潜在的未知设置
                enabled: true,
                strategy: elements.ruleSubtitleStrategySelect.value,
                displayMode: elements.ruleSubtitleDisplayMode.value
            };
        } else {
            // 如果之前有设置，则在其基础上禁用。否则，创建一个新的已禁用设置。
            rule.subtitleSettings = {
                ...existingSubtitleSettings,
                enabled: false
            };
        }
        // --- 3. Save to local state and mark as changed ---
        if (originalDomain && originalDomain !== newDomain) {
            delete domainRules[originalDomain];
        }
        domainRules[newDomain] = rule;
        updateSaveButtonState();
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

    /**
     * A generic function to open a modal with the standard animation.
     * @param {HTMLElement} modalElement The modal's top-level element.
     */
    const openModal = (modalElement) => {
        if (!modalElement) return;
        document.body.classList.add('modal-open');
        modalElement.style.display = 'flex';
        // Force reflow to ensure the initial state is rendered before the transition starts.
        modalElement.offsetWidth;
        modalElement.classList.add('is-visible');
    };

    /**
     * A generic function to close a modal with the standard animation.
     * @param {HTMLElement} modalElement The modal's top-level element.
     * @param {Function} [onClosed] An optional callback to run after the closing animation completes.
     */
    const closeModal = (modalElement, onClosed) => {
        if (!modalElement) return;
        document.body.classList.remove('modal-open');
        modalElement.classList.remove('is-visible');

        const modalContent = modalElement.querySelector('.modal-content');
        if (!modalContent) {
            // Fallback for modals without a .modal-content wrapper
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
        openModal(elements.aiEngineModal);
        renderAiEngineList();
        elements.aiEngineForm.style.display = 'none'; // Hide form initially
    };

    const closeAiEngineModal = () => {
        closeModal(elements.aiEngineModal, () => {
            // Cleanup logic after modal is fully hidden
            elements.aiEngineForm.style.display = 'none';
            elements.aiTestResult.style.display = 'none';
            currentEditingAiEngineId = null;
        });
    };
    const openImportAiEngineModal = () => {
        elements.importAiEngineConfigText.value = ''; // 清除旧内容
        elements.importAiEngineErrorText.textContent = ''; // 清除旧错误
        elements.importAiEngineConfigText.closest('.m3-form-field').classList.remove('is-invalid');
        openModal(elements.importAiEngineModal);
        elements.importAiEngineConfigText.focus(); // 聚焦到文本区域
    };

    const closeImportAiEngineModal = () => {
        closeModal(elements.importAiEngineModal);
    };



    const hideAiEngineForm = () => {
        elements.aiEngineForm.style.display = 'none';
        elements.aiTestResult.style.display = 'none';
        aiEngineValidator.clearAllErrors();
        currentEditingAiEngineId = null;
    };

    // ** 添加 Esc 按键监听器 **
    const handleKeyDown = (event) => {
        if (event.key === "Escape") {
            if (elements.importAiEngineModal.classList.contains('is-visible')) {
                closeImportAiEngineModal();
                return;
            }
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
        openModal(elements.domainRuleModal);

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
        elements.ruleExcludeSelectorTextarea.value = ruleData.excludeSelectors || ''; // 新增：填充排除选择器
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
        // 使用验证器清除任何先前的验证状态
        domainRuleValidator.clearAllErrors();
    };

    const closeDomainRuleModal = () => {
        closeModal(elements.domainRuleModal);
    };

    const renderAiEngineList = () => {
        elements.aiEngineList.innerHTML = '';
        if (aiEngines.length === 0) {
            elements.aiEngineList.innerHTML = `<p>${browser.i18n.getMessage('noAiEnginesFound') || 'No AI engines configured.'}</p>`;
            return;
        }
        const ul = document.createElement('ul');
        aiEngines.forEach(engine => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${escapeHtml(engine.name)}</span>
                <div class="actions">
                    <button class="m3-button text copy-ai-engine-btn" data-id="${engine.id}">${browser.i18n.getMessage('copy') || 'Copy'}</button>
                    <button class="m3-button text edit-ai-engine-btn" data-id="${engine.id}">${browser.i18n.getMessage('edit') || 'Edit'}</button>
                    <button class="m3-button text danger remove-ai-engine-btn" data-id="${engine.id}">${browser.i18n.getMessage('removeAiEngine') || 'Remove'}</button>
                </div>
            `;
            ul.appendChild(li);
        });
        elements.aiEngineList.appendChild(ul);
    };

    // **  修改:  在showAiEngineForm 中填充  fallback engine **
    const showAiEngineForm = (engine = {}) => {
        // 每次显示表单时清除所有错误提示
        aiEngineValidator.clearAllErrors();

        // Show the form itself
        elements.aiEngineForm.style.display = 'block';
        populateEngineSelect(elements.aiShortTextEngineSelect, { includeDefault: true, excludeId: engine.id }); // 确保包含“使用默认”选项

        // Hide test result
        elements.aiTestResult.style.display = 'none';
        elements.aiFormTitle.textContent = engine.id ? (browser.i18n.getMessage('edit') || 'Edit') : (browser.i18n.getMessage('add') || 'Add');

        // ** 优化：统一处理所有表单字段的值设置 **
        const formFields = {
            aiEngineNameInput: 'name',
            aiApiKeyInput: 'apiKey',
            aiApiUrlInput: 'apiUrl',
            aiModelNameInput: 'model',
            aiCustomPromptInput: 'customPrompt',
            aiShortTextThresholdInput: 'wordCountThreshold',
            aiShortTextEngineSelect: 'fallbackEngine'
        };

        for (const [elementKey, engineKey] of Object.entries(formFields)) {
            const element = elements[elementKey];
            if (!element) continue;

            let defaultValue;
            switch (engineKey) {
                case 'wordCountThreshold':
                    defaultValue = 1;
                    break;
                case 'fallbackEngine':
                    defaultValue = 'default'; // 新增：为短文本引擎设置默认值
                    break;
                default:
                    defaultValue = '';
            }
            element.value = engine[engineKey] ?? defaultValue;
        }

        initializeSelectLabel(elements.aiShortTextEngineSelect); // 更新标签UI，防止重叠
        currentEditingAiEngineId = engine.id || null;
    };

    const addAiEngine = () => {
        showAiEngineForm();
    };

    const editAiEngine = (id) => {
        const engine = aiEngines.find(e => e.id === id);
        if (engine) {
            showAiEngineForm(engine);
        }
    };

    // --- Delegated Event Handlers ---

    const handleGlobalClick = async (e) => {
        let target = e.target;

        // * 修改：处理点击目标是 SVG 元素的情况 *
        if (target instanceof SVGElement && target.parentNode)
            target = target.parentNode

        // --- 弹窗关闭按钮 ---
        // 将其独立处理，因为它们可能不是 <button> 元素，或者没有统一的类名，
        // 以确保无论其标签如何（例如，<span>, <i>），它们都能正常工作。
        if (target.closest('#importAiEngineModal .close-button')) return closeImportAiEngineModal();
        if (target.closest('#aiEngineModal .close-button')) return closeAiEngineModal();
        if (target.closest('#domainRuleModal .close-button')) return closeDomainRuleModal();

        const closestButton = target.closest('button, [role="button"]');
        if (!closestButton) return;

        // --- Ripple Effect ---
        // 仅对具有视觉背景的按钮应用波纹效果（例如，非文本按钮）
        const isRippleButton = (closestButton.classList.contains('m3-button') && !closestButton.classList.contains('text') && closestButton.id !== 'saveSettingsBtn') || closestButton.classList.contains('tab-button');
        if (isRippleButton) {
            const ripple = document.createElement('span');
            ripple.classList.add('ripple');
            const rect = closestButton.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;
            closestButton.appendChild(ripple);
            ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
        }
        // --- Main Actions ---
        switch (closestButton.id) {
            case 'saveSettingsBtn': return saveSettings();
            case 'reset-settings-btn': return resetSettings();
            case 'export-btn': return exportSettings();
            case 'import-btn': return elements.importInput.click();
            case 'openImportAiEngineModalBtn': return openImportAiEngineModal();
            case 'confirmImportAiEngineBtn': return handleConfirmImportAiEngine();
            case 'cancelImportAiEngineBtn': return closeImportAiEngineModal();
            case 'clearCacheBtn': return clearCache();
            case 'manageAiEnginesBtn': return openAiEngineModal();
            case 'addAiEngineBtn': return addAiEngine();
            case 'saveAiEngineBtn': return saveAiEngine();
            case 'cancelAiEngineBtn': return hideAiEngineForm();
            case 'testAiEngineBtn': return testAiEngineConnection();
            case 'addDomainRuleBtn': return openDomainRuleModal();
            case 'cancelDomainRuleBtn': return closeDomainRuleModal();
            case 'saveDomainRuleBtn': return saveDomainRule();
            case 'runGlobalTestBtn': return runGlobalPrecheckTest();
            case 'testTranslationBtn': return toggleTestArea();
            case 'toggleLogBtn': return toggleLogArea();
            case 'manual-test-translate-btn': return performTestTranslation();
        }

        // ---  以下按钮依赖于 data- 属性来区分，不能直接用 id 判断  ---
        // 找到 Edit AI Engine 按钮并获取 data-id
        const editAiEngineBtn = target.closest('.edit-ai-engine-btn');
        if (editAiEngineBtn) {
            return editAiEngine(editAiEngineBtn.dataset.id);
        }
        // 找到 Remove AI Engine 按钮并获取 data-id

        // 找到 Copy AI Engine 按钮并获取 data-id
        const copyAiEngineBtn = target.closest('.copy-ai-engine-btn');
        if (copyAiEngineBtn) {
            const engineId = copyAiEngineBtn.dataset.id;
            const engine = aiEngines.find(e => e.id === engineId);
            if (engine) {
                try {
                    await navigator.clipboard.writeText(JSON.stringify(engine));
                    showStatusMessage(browser.i18n.getMessage('copiedAiEngineSuccess') || 'Copied AI Engine to clipboard.');
                } catch (err) {
                    showStatusMessage(browser.i18n.getMessage('copyAiEngineError') || 'Failed to copy AI Engine.', true);
                    console.error('Failed to copy AI Engine:', err);
                }
            }
            return;
        }

        const removeAiEngineBtn = target.closest('.remove-ai-engine-btn');
        if (removeAiEngineBtn) {
            return removeAiEngine(removeAiEngineBtn.dataset.id);
        }

        // 找到 Edit Domain Rule 按钮并获取 data-domain
        const editDomainRuleBtn = target.closest('.edit-rule-btn');
        if (editDomainRuleBtn) {
            return editDomainRule(editDomainRuleBtn.dataset.domain);
        }
        // 找到 Delete Domain Rule 按钮并获取 data-domain
        const deleteDomainRuleBtn = target.closest('.delete-rule-btn');
        if (deleteDomainRuleBtn) {
            return removeDomainRule(deleteDomainRuleBtn.dataset.domain);
        }
        // Precheck 规则 Tab 切换
        const tabButton = target.closest('.tab-button');
        if (tabButton) {
            return switchPrecheckTab(tabButton.dataset.category);
        }
        // Add Precheck 规则
        const addRuleBtn = target.closest('.add-rule-btn');
        if (addRuleBtn) {
            return addRuleToCategory(addRuleBtn.closest('.tab-panel').dataset.category);
        }
        // Remove Precheck 规则
        const removeRuleBtn = target.closest('.remove-rule-btn');
        if (removeRuleBtn) {
            removeRuleBtn.closest('.rule-item').remove();
            updateSaveButtonState();
            return;
        }
        // Test Precheck 规则
        const testRuleBtn = target.closest('.test-rule-btn');
        if (testRuleBtn) {
            const item = testRuleBtn.closest('.rule-item');
            const regexInput = item.querySelector('.rule-regex');
            const flagsInput = item.querySelector('.rule-flags');
            const resultElement = item.querySelector('.rule-test-result');
            testRegex(regexInput, flagsInput, resultElement);
            return;
        }
    };

    const handleGlobalInput = (e) => {
        const target = e.target;

        // --- Settings that trigger save button ---
        if (target.matches('#defaultInlineSelector, #defaultBlockSelector, #deeplxApiUrl, #cacheSizeInput')) {
            return updateSaveButtonState();
        }

        // --- Pre-check rule inputs ---
        const precheckItem = target.closest('.rule-item');
        if (precheckItem) {
            if (target.matches('.rule-name')) {
                updateSaveButtonState();
            } else if (target.matches('.rule-regex, .rule-flags')) {
                const testResultElement = precheckItem.querySelector('.rule-test-result');
                if (testResultElement) testResultElement.classList.remove('show');
                validateRegexInput(
                    precheckItem.querySelector('.rule-regex'),
                    precheckItem.querySelector('.rule-flags')
                );
                updateSaveButtonState();
            }
            return;
        }

        // --- AI Engine form ---
        if (target.closest('#aiEngineForm')) {
            if (aiEngineValidator) aiEngineValidator.clearAllErrors();
            return;
        }

        // --- Domain Rule form ---
        if (target.matches('#ruleDomain')) {
            domainRuleValidator.clearAllErrors();
            return;
        }

        // --- Global test input ---
        if (target.matches('#testTextInput')) {
            const fieldContainer = target.closest('.m3-form-field');
            if (fieldContainer.classList.contains('is-invalid')) {
                fieldContainer.classList.remove('is-invalid');
                elements.testTextInputError.textContent = '';
            }
            return;
        }
    };

    const handleGlobalChange = (e) => {
        const target = e.target;

        // --- Main translator engine & display mode ---
        if (target.matches('#translatorEngine, #displayModeSelect, #targetLanguage')) {
            updateSaveButtonState();
            if (target.id === 'translatorEngine') {
                updateApiFieldsVisibility();
            }
            return;
        }

        // --- Rule-specific changes ---
        const precheckItem = target.closest('.rule-item');
        if (precheckItem && target.matches('.rule-mode, .rule-enabled-checkbox')) {
            updateSaveButtonState();
            return;
        }

        // --- Domain Rule modal changes ---
        if (target.closest('#domainRuleModal') && target.matches('#ruleEnableSubtitle')) {
            const isChecked = target.checked;
            elements.ruleSubtitleSettingsGroup.style.display = isChecked ? 'block' : 'none';
            // 如果是开启，则平滑滚动到新出现的菜单，提升用户体验
            if (isChecked) {
                elements.ruleSubtitleSettingsGroup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            return;
        }

        // --- Import file change ---
        if (target.id === 'import-input') {
            importSettings(e);
            return;
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

    const handleConfirmImportAiEngine = () => {
        const formField = elements.importAiEngineConfigText.closest('.m3-form-field');
        const errorEl = elements.importAiEngineErrorText;
        const configText = elements.importAiEngineConfigText.value.trim();

        // 清除之前的错误
        formField.classList.remove('is-invalid');
        errorEl.textContent = '';

        if (!configText) {
            errorEl.textContent = browser.i18n.getMessage('pasteConfigRequired') || 'Configuration cannot be empty.';
            formField.classList.add('is-invalid');
            return;
        }

        try {
            const engineData = JSON.parse(configText);

            // 基本验证
            if (engineData && engineData.name && engineData.apiKey && engineData.apiUrl && engineData.model && engineData.customPrompt) {
                closeImportAiEngineModal();
                showAiEngineForm(engineData);
                showStatusMessage(browser.i18n.getMessage('importedAiEngineSuccess') || 'Imported AI Engine configuration.');
            } else {
                throw new Error(browser.i18n.getMessage('invalidAiEngineData') || 'Invalid or incomplete AI Engine data.');
            }
        } catch (err) {
            errorEl.textContent = err.message;
            formField.classList.add('is-invalid');
            console.error('Failed to import AI Engine:', err);
        }
    };

    const saveAiEngine = async () => {
        // 使用通用验证器
        if (!aiEngineValidator.validate()) {
            return;
        }

        const engineData = getAiEngineFormData();
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
        updateSaveButtonState(); // Mark settings as changed
        renderAiEngineList();
        populateEngineSelect(elements.translatorEngine); // Update main dropdown
        hideAiEngineForm(); // Hide form and test results, and clear state
        showStatusMessage(browser.i18n.getMessage('saveAiEngineSuccess'));
    };

    const removeAiEngine = (id) => {
        if (window.confirm(browser.i18n.getMessage('confirmDeleteAiEngine'))) {
            // 1. 检查被删除的引擎当前是否被选中
            const wasSelected = elements.translatorEngine.value === `ai:${id}`;

            // 2. 从数据中移除引擎
            aiEngines = aiEngines.filter(e => e.id !== id);

            // 3. 更新所有相关的UI
            renderAiEngineList(); // 更新弹窗中的列表
            populateEngineSelect(elements.translatorEngine); // 更新主设置中的下拉菜单

            // 4. 如果被删除的引擎是当前选中的，则选择一个新的有效引擎
            if (wasSelected) {
                // 因为 populateTranslatorEngineOptions 已经运行，下拉菜单现在只包含有效的选项。
                // 如果还有其他 AI 引擎，选择第一个。否则，选择第一个内置引擎。
                if (aiEngines.length > 0) {
                    elements.translatorEngine.value = `ai:${aiEngines[0].id}`;
                } else if (elements.translatorEngine.options.length > 0) {
                    // 如果没有 AI 引擎了，选择列表中的第一个（即第一个内置引擎）
                    elements.translatorEngine.value = elements.translatorEngine.options[0].value;
                }
            }
            updateApiFieldsVisibility();
            updateSaveButtonState();
            showStatusMessage(browser.i18n.getMessage('removeAiEngineSuccess'));
        }
    };

    const updateApiFieldsVisibility = () => {
        const engine = elements.translatorEngine.value;
        elements.deeplxUrlGroup.style.display = 'none'; // 默认隐藏 DeepLx API URL
        // elements.aiEngineManagementGroup.style.display is now always 'block' from HTML

        if (engine === 'deeplx') elements.deeplxUrlGroup.style.display = 'block'; // Show DeepLx if selected
        else if (engine.startsWith('ai:')) elements.aiEngineManagementGroup.style.display = 'block'; // Show AI management if any AI engine is selected
    };
    /**
     * (新) 通用函数，用于填充任何引擎选择器下拉菜单。
     * @param {HTMLSelectElement} selectElement - 要填充的 <select> 元素。
     * @param {object} [options={}] - 配置选项。
     * @param {boolean} [options.includeDefault=false] - 是否包含“使用默认设置”选项。
     * @param {string|null} [options.excludeId=null] - 要从列表中排除的 AI 引擎的 ID。
     */
    const populateEngineSelect = (selectElement, { includeDefault = false, excludeId = null } = {}) => {
        if (!selectElement) return;
        const currentValue = selectElement.value; // 保留当前值
        selectElement.innerHTML = '';

        // 如果需要，添加“使用默认”选项
        if (includeDefault) {
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.textContent = browser.i18n.getMessage('useDefaultSetting');
            selectElement.appendChild(defaultOption);
        }

        // 添加内置引擎
        for (const key in Constants.SUPPORTED_ENGINES) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = browser.i18n.getMessage(Constants.SUPPORTED_ENGINES[key]);
            selectElement.appendChild(option);
        }

        // 添加用户配置的 AI 引擎
        aiEngines.forEach(engine => {
            if (engine.id !== excludeId) {
                const option = document.createElement('option');
                option.value = `ai:${engine.id}`;
                option.textContent = engine.name;
                selectElement.appendChild(option);
            }
        });

        // 尝试恢复之前选中的值
        if (Array.from(selectElement.options).some(opt => opt.value === currentValue)) {
            selectElement.value = currentValue;
        } else if (selectElement.options.length > 0) {
            // 如果旧值不再有效，则选择第一个选项
            selectElement.value = selectElement.options[0].value;
        }
    };

    /**
     * Populates the dropdowns within the domain rule modal.
     * This includes translation engines, target languages, and display modes.
     */
    const populateModalDropdowns = () => {
        // Populate Translator Engine dropdown
        populateEngineSelect(elements.ruleTranslatorEngineSelect, { includeDefault: true });



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
        const compiledRules = SettingsManager.precompileRules(rawRules);

        const currentUiSettings = {
            targetLanguage: elements.targetLanguage.value,
            precheckRules: compiledRules
        };

        const precheck = shouldTranslate(sourceText, currentUiSettings, true);
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
            // Send message to background service worker for translation
            const response = await browser.runtime.sendMessage({
                type: 'TEST_TRANSLATE_TEXT',
                payload: {
                    text: sourceText,
                    targetLang: elements.targetLanguage.value,
                    sourceLang: 'auto',
                    // 关键修复：明确传递当前UI上选择的翻译引擎。
                    // 后台将负责处理此引擎的所有逻辑。
                    translatorEngine: elements.translatorEngine.value
                }
            });

            console.log('[Options Page Debug] Received response from service worker:', response); // Debug log

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
        // 使用通用验证器
        if (!aiEngineValidator.validate()) {
            return;
        }

        const engineData = getAiEngineFormData();
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

    // --- Cache Management Logic ---
    const updateCacheInfo = async () => {
        try {
            const info = await browser.runtime.sendMessage({ type: 'GET_CACHE_INFO' });
            if (info) {
                elements.cacheInfoDisplay.textContent = `${info.count} / ${info.limit}`;
            }
        } catch (error) {
            console.error("Failed to get cache info:", error);
            elements.cacheInfoDisplay.textContent = 'N/A';
        }
    };

    const clearCache = async () => {
        const confirmationMessage = browser.i18n.getMessage('clearCacheConfirm') || 'Are you sure you want to clear the entire translation cache? This action cannot be undone.';
        if (window.confirm(confirmationMessage)) {
            await browser.runtime.sendMessage({ type: 'CLEAR_CACHE' });
            await updateCacheInfo();
            showStatusMessage(browser.i18n.getMessage('clearCacheSuccess'));
        }
    };

    const handleGlobalFocusIn = (e) => {
        // 当全局测试输入框获得焦点时，隐藏所有单独规则的测试结果
        if (e.target.id === 'testTextInput') {
            document.querySelectorAll('.rule-test-result.show').forEach(resultEl => {
                resultEl.classList.remove('show');
            });
        }
    };

    // --- Initialization and Event Listeners ---
    const initialize = async () => {
        applyTranslations();
        populateLanguageOptions();
        populateDisplayModeOptions(elements.displayModeSelect);
        await loadSettings();
        manageSelectLabels(); // Ensure select labels are correctly positioned on load and on change
        populateModalDropdowns(); // Populate modal dropdowns on initialization

        // 初始化验证器
        aiEngineValidator = new FormValidator(elements.aiEngineForm, {
            'aiEngineName': { rules: 'required', labelKey: 'aiEngineName' },
            'aiApiKey': { rules: 'required', labelKey: 'aiApiKey' },
            'aiApiUrl': { rules: 'required', labelKey: 'aiApiUrl' },
            'aiModelName': { rules: 'required', labelKey: 'aiModelName' },
            'aiCustomPrompt': { rules: 'required', labelKey: 'aiCustomPrompt' },
            'aiShortTextEngine': { rules: 'required', labelKey: 'aiShortTextEngine' } // 新增：将短文本引擎设为必填项
        });

        domainRuleValidator = new FormValidator(elements.domainRuleForm, {
            'ruleDomain': { rules: 'required', labelKey: 'domain' }
        });
        // --- 全局事件监听器 ---
        document.addEventListener('click', handleGlobalClick);
        document.addEventListener('input', handleGlobalInput);
        document.addEventListener('change', handleGlobalChange);
        document.addEventListener('focusin', handleGlobalFocusIn);
        document.addEventListener('keydown', handleKeyDown); // Existing global listener
        // --- Before Unload Listener ---
        window.addEventListener('beforeunload', (e) => {
            const currentSettingsString = JSON.stringify(getSettingsFromUI());
            const hasChanges = currentSettingsString !== initialSettingsSnapshot;
            if (hasChanges) {
                // 现代浏览器通常会显示一个通用的提示信息，而不是自定义的字符串
                e.preventDefault(); // 阻止默认行为，触发提示
                e.returnValue = ''; // 某些浏览器需要设置此属性
                return ''; // 某些浏览器需要返回一个字符串
            }
        });
    };

    initialize();
});