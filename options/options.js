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
        defaultTranslationSelector: document.getElementById('defaultTranslationSelector'),
        deeplxApiUrl: document.getElementById('deeplxApiUrl'),
        domainTranslationSelector: document.getElementById('domainTranslationSelector'), // This seems to be a typo in the original HTML, it should be for domain-specific selectors, not rules.
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
    };
    elements.toggleLogBtn = document.getElementById('toggleLogBtn');
    elements.logContent = document.getElementById('log-content');
    // 为日志内容区域设置样式，以确保其能够正确换行
    if (elements.logContent) {
        elements.logContent.style.whiteSpace = 'pre-wrap'; // 保留换行符和空格，并自动换行
        elements.logContent.style.wordBreak = 'break-all';   // 允许在长单词或URL内部断开，防止溢出
    }

    // --- Unsaved Changes Tracking ---
    let hasUnsavedChanges = false;

    const markAsChanged = () => {
        if (!hasUnsavedChanges) {
            hasUnsavedChanges = true;
            elements.saveSettingsBtn.classList.add('visible');
        }
    };

    const markAsSaved = () => {
        hasUnsavedChanges = false;
        // Visibility is now handled by the saveSettings function
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
            resultElement.textContent = '请输入正则表达式'; // Please enter a regex
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
                resultElement.textContent = '不匹配';
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
            resultElement.textContent = `无效的正则表达式: ${e.message}`; // Invalid Regex
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
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
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
        let isValid = true;
        let errorMessage = '';

        // An empty regex is technically valid (matches everything), but we should clear any error state.
        if (regexValue === '') {
            regexInput.classList.remove('is-invalid');
            regexInput.removeAttribute('title');
            flagsInput.classList.remove('is-invalid');
            flagsInput.removeAttribute('title');
            return true;
        }

        try {
            new RegExp(regexValue, flagsValue); // Attempt to create a RegExp object
            regexInput.classList.remove('is-invalid');
            regexInput.removeAttribute('title');
            flagsInput.classList.remove('is-invalid');
            flagsInput.removeAttribute('title');
        } catch (e) {
            isValid = false;
            errorMessage = e.message;
            regexInput.classList.add('is-invalid');
            regexInput.title = `无效的正则表达式: ${errorMessage}`; // Tooltip for error
            flagsInput.classList.add('is-invalid'); // Mark flags input as invalid too, as the error might be a combination or related.
            flagsInput.title = `无效的正则表达式标志: ${errorMessage}`;
        }
        return isValid;
    }

    let precheckRules = {};

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
    const showStatusMessage = (message, isError = false) => {
        elements.statusMessage.textContent = message;
        elements.statusMessage.style.display = 'block';
        elements.statusMessage.className = `status-message ${isError ? 'error' : 'success'}`;
        setTimeout(() => {
            elements.statusMessage.style.display = 'none';
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
     * Handles the floating label state for <select> elements, which don't
     * support the :placeholder-shown pseudo-class. It adds/removes an 'is-filled'
     * class to the parent container based on whether the select has a value.
     */
    const manageSelectLabels = () => {
        document.querySelectorAll('.m3-form-field.filled select').forEach(selectEl => {
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
        });
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
        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};

        elements.translatorEngine.value = currentSettings.translatorEngine || 'deeplx';
        elements.targetLanguage.value = currentSettings.targetLanguage || 'ZH';
        // Default translation selector
        elements.defaultTranslationSelector.value = currentSettings.translationSelector?.default || window.Constants.DEFAULT_TRANSLATION_SELECTOR;
         // Domain-specific translation selector (Note: This field is currently not used in the logic for domain rules)
        elements.domainTranslationSelector.value = currentSettings.domainTranslationSelector || ''; // Assuming a new setting for this
        elements.deeplxApiUrl.value = currentSettings.deeplxApiUrl || '';

        elements.displayModeSelect.value = currentSettings.displayMode || 'replace';

        // Load AI Engines
        aiEngines = currentSettings.aiEngines || [];
        populateAiEngineOptions(); // Populate the main dropdown

        toggleApiFields();
        renderDomainRules(currentSettings.domainRules || {});
        const defaultPrecheckRules = generateDefaultPrecheckRules();
        const storedRules = currentSettings.precheckRules;
        precheckRules = storedRules && Object.keys(storedRules).length > 0 ? storedRules : JSON.parse(JSON.stringify(defaultPrecheckRules));
        renderPrecheckRulesUI();
        hasUnsavedChanges = false;
        elements.saveSettingsBtn.classList.remove('visible'); // Ensure FAB is hidden on initial load
    };

    const getDomainRulesFromList = () => {
        const rules = {};    

        const alwaysTranslateText = browser.i18n.getMessage('alwaysTranslate');
        elements.domainRulesList.querySelectorAll('li').forEach(item => {
            const domain = item.querySelector('strong').textContent;
            const ruleText = item.querySelector('span').textContent;
            rules[domain] = ruleText.includes(alwaysTranslateText) ? 'always' : 'manual';
        });
        return rules;
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
            showStatusMessage(browser.i18n.getMessage('invalidRegexWarning'), true);
            elements.saveSettingsBtn.classList.add('error-shake');
            setTimeout(() => elements.saveSettingsBtn.classList.remove('error-shake'), 500);
            return; // Prevent saving if there are invalid regexes
        }
        // --- State: Saving ---
        elements.saveSettingsBtn.disabled = true;
        elements.fabIconSave.classList.remove('active');
        elements.fabIconLoading.classList.add('active');
        elements.fabIconSuccess.classList.remove('active');

        const settings = {
            translatorEngine: elements.translatorEngine.value,
            targetLanguage: elements.targetLanguage.value,
            displayMode: elements.displayModeSelect.value,
            deeplxApiUrl: elements.deeplxApiUrl.value,
            // The aiEngines array is the source of truth for all AI configurations.
            aiEngines: aiEngines,
            translationSelector: {
                default: elements.defaultTranslationSelector.value,
                rules: getDomainRulesFromList(), // 确保这里获取的是最新的规则
            }, // Use the already validated rules
            precheckRules: precheckRulesToSave,
        };

        try {
            await browser.storage.sync.set({ settings });
            showStatusMessage(browser.i18n.getMessage('saveSettingsSuccess'));
            markAsSaved(); // Set the flag

            // --- State: Success ---
            elements.saveSettingsBtn.classList.add('success');
            elements.fabIconLoading.classList.remove('active');
            elements.fabIconSuccess.classList.add('active');

            // --- State: Disappear and Reset ---
            setTimeout(() => {
                elements.saveSettingsBtn.classList.remove('visible'); // Start fade out animation

                // Wait for animation to finish before resetting the button's internal state
                setTimeout(() => {
                    elements.saveSettingsBtn.disabled = false;
                    elements.saveSettingsBtn.classList.remove('success');
                    elements.fabIconSuccess.classList.remove('active');
                    elements.fabIconSave.classList.add('active');
                }, 300); // This timeout should match the CSS transition duration
            }, 1000); // 1-second success display
        } catch (error) {
            console.error('Error saving settings:', error);
            showStatusMessage(browser.i18n.getMessage('saveSettingsError'), true);
            // --- State: Error/Reset ---
            elements.saveSettingsBtn.disabled = false;
            elements.fabIconLoading.classList.remove('active');
            elements.fabIconSave.classList.add('active');
            elements.saveSettingsBtn.classList.add('error-shake');
            setTimeout(() => elements.saveSettingsBtn.classList.remove('error-shake'), 500);
            markAsChanged(); // 保存失败，仍然有未保存的更改
        }
    };

    const resetSettings = async () => {
        const confirmationMessage = browser.i18n.getMessage('resetSettingsConfirm') || 'Are you sure you want to reset all settings to their default values? This action cannot be undone.';
        if (window.confirm(confirmationMessage)) {
            try {
                await browser.storage.sync.remove('settings');
                // After removing, reload the settings, which will apply the defaults.
                // loadSettings will call markAsSaved()
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
    function generateDefaultPrecheckRules() { 
        // Start with a deep copy of the general rules from constants.
        const defaultRules = JSON.parse(JSON.stringify(window.Constants.DEFAULT_PRECHECK_RULES));

        // 1. Internationalize the names of the general rules using the stable `nameKey`.
        if (defaultRules.general) {
            defaultRules.general.forEach(rule => {
                rule.name = browser.i18n.getMessage(rule.nameKey) || rule.name; // Use nameKey for i18n
                delete rule.nameKey; // Clean up the temporary key
            });
        }

        // 2. Dynamically generate and add language-specific whitelist rules.
        for (const langCode in window.Constants.LANG_REGEX_MAP) {
            if (window.Constants.SUPPORTED_LANGUAGES[langCode]) {
                const langName = browser.i18n.getMessage(window.Constants.SUPPORTED_LANGUAGES[langCode]) || langCode;
                defaultRules[langCode] = [{
                    name: `${browser.i18n.getMessage('precheckRuleContains') || 'Contains '} ${langName}`,
                    regex: window.Constants.LANG_REGEX_MAP[langCode].regex,
                    mode: 'whitelist',
                    enabled: true,
                    flags: window.Constants.LANG_REGEX_MAP[langCode].flags,
                }];
            }
        }
        return defaultRules;
    }

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
            if(precheckRules[category]) {
                precheckRules[category].forEach(rule => {
                    ruleList.appendChild(createRuleItemElement(rule));
                });
            }
            panel.appendChild(ruleList);

            // Create 'Add Rule' Button
            const addRuleBtn = document.createElement('button');
            addRuleBtn.textContent = browser.i18n.getMessage('addRule');
            addRuleBtn.className = 'add-rule-btn';
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
        </div>
        <div class="m3-form-field filled rule-flags-field">
            <input type="text" id="${randomId}-flags" class="rule-flags" value="${escapeHtml(rule.flags || '')}" placeholder=" ">
            <label for="${randomId}-flags">${flagsPlaceholder}</label>
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
            markAsChanged(); // Any change in rule content marks as unsaved
        };
    item.querySelector('.rule-name').addEventListener('input', markAsChanged);
        // Apply ripple effect to the test button
        regexInput.addEventListener('input', validateAndMarkChanged);
        flagsInput.addEventListener('input', validateAndMarkChanged);
        item.querySelector('.rule-mode').addEventListener('change', markAsChanged);
    item.querySelector('.rule-enabled-checkbox').addEventListener('change', markAsChanged);

        item.querySelector('.remove-rule-btn').addEventListener('click', (e) => {
            e.currentTarget.closest('.rule-item').remove();
            markAsChanged(); // Removing a rule counts as a change.
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
            // Apply ripple effect to the newly created rule item's buttons
            ruleList.appendChild(createRuleItemElement(newRule));
            markAsChanged(); // 添加规则也算作更改
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
    const renderDomainRules = (rules) => {
      elements.domainRulesList.innerHTML = "";
      const alwaysTranslateText = browser.i18n.getMessage("alwaysTranslate");
      const removeText = browser.i18n.getMessage("removeRule");
  
      for (const [domain, value] of Object.entries(rules)) {
        const listItem = document.createElement("li"); // Each li will be an M3 list item/card
        listItem.className = 'm3-list-item'; // Add class for styling

        const isAlways = value === "always";
        const selectorText = isAlways
          ? alwaysTranslateText
          : value; // Use the actual selector string if not "always"
  
        listItem.innerHTML = `
          <div class="m3-list-item-content">
            <span class="m3-list-item-headline">${escapeHtml(domain)}</span>
            <span class="m3-list-item-supporting-text">${escapeHtml(selectorText)}</span>
          </div>
          <button class="remove-domain-rule-btn m3-icon-button danger" data-domain="${domain}">
            <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        `;
        listItem.querySelector(".remove-domain-rule-btn").addEventListener("click", (event) => {
          removeDomainRule(event.target.dataset.domain);
        });
        elements.domainRulesList.appendChild(listItem);
      }
    };

    const addDomainRule = async () => {
        const domain = elements.newDomainInput.value.trim();
        const rule = elements.newDomainRuleSelect.value;

        if (domain) {
            const { settings } = await browser.storage.sync.get('settings');
            const currentSettings = settings || {};
            currentSettings.domainRules = currentSettings.domainRules || {};
            currentSettings.domainRules[domain] = rule;
            await browser.storage.sync.set({ settings: currentSettings });
            renderDomainRules(currentSettings.domainRules);
            elements.newDomainInput.value = '';
            showStatusMessage(browser.i18n.getMessage('addRuleSuccess'));
        } else {
            showStatusMessage(browser.i18n.getMessage('addRuleErrorNoDomain'), true);
        }
    };

    const removeDomainRule = async (domainToRemove) => {
        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};
        if (currentSettings.domainRules) {
            delete currentSettings.domainRules[domainToRemove];
            await browser.storage.sync.set({ settings: currentSettings });
            renderDomainRules(currentSettings.domainRules);
            showStatusMessage(browser.i18n.getMessage('removeRuleSuccess'));
        }
    };

    const exportSettings = async () => {
        const { settings } = await browser.storage.sync.get('settings');
        const settingsJson = JSON.stringify(settings, null, 2);
        const blob = new Blob([settingsJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'translator-settings.json';
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
    let aiEngines = []; // Array to hold AI engine configurations
    let currentEditingAiEngineId = null; // To track which engine is being edited

    const openAiEngineModal = () => {
        elements.aiEngineModal.style.display = 'flex'; // Show overlay with flex for centering
        // Force reflow to ensure CSS transition applies
        elements.aiEngineModal.offsetWidth;
        elements.aiEngineModal.classList.add('is-visible'); // Trigger content transition
        renderAiEngineList();
        elements.aiEngineForm.style.display = 'none'; // Hide form initially
        elements.aiTestResult.style.display = 'none'; // Hide test result
        // Apply ripple to dynamically added buttons in the list
        elements.aiEngineList.querySelectorAll('.m3-button').forEach(addRippleEffect);
        // Apply ripple to the "Add New AI Engine" button
        addRippleEffect(elements.addAiEngineBtn);
    };

    const closeAiEngineModal = () => {
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
        elements.aiFormTitle.textContent = engine.id ? (browser.i18n.getMessage('edit') || 'Edit') : (browser.i18n.getMessage('addRule') || 'Add');
        elements.aiEngineNameInput.value = engine.name || '';
        elements.aiApiKeyInput.value = engine.apiKey || '';
        elements.aiApiUrlInput.value = engine.apiUrl || '';
        elements.aiModelNameInput.value = engine.model || '';
        elements.aiCustomPromptInput.value = engine.customPrompt || '';
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
            showAiEngineForm(engine);
        }
    };

    const saveAiEngine = async () => {
        clearAiFormErrors(); // Clear previous errors before validating

        const name = elements.aiEngineNameInput.value.trim();
        const apiKey = elements.aiApiKeyInput.value.trim();
        const apiUrl = elements.aiApiUrlInput.value.trim();
        const model = elements.aiModelNameInput.value.trim();
        const customPrompt = elements.aiCustomPromptInput.value.trim();

        let isValid = true;
        isValid = validateAiFormField(elements.aiEngineNameInput, elements.aiEngineNameError, 'aiEngineName') && isValid;
        isValid = validateAiFormField(elements.aiApiKeyInput, elements.aiApiKeyError, 'aiApiKey') && isValid;
        isValid = validateAiFormField(elements.aiApiUrlInput, elements.aiApiUrlError, 'aiApiUrl') && isValid;
        isValid = validateAiFormField(elements.aiModelNameInput, elements.aiModelNameError, 'aiModelName') && isValid;
        isValid = validateAiFormField(elements.aiCustomPromptInput, elements.aiCustomPromptError, 'aiCustomPrompt') && isValid;

        if (!isValid) {
            showStatusMessage(browser.i18n.getMessage('fillAllRequiredFields') || 'Please fill in all required fields.', true);
            return;
        }

        if (currentEditingAiEngineId) {
            // Edit existing
            const index = aiEngines.findIndex(e => e.id === currentEditingAiEngineId);
            if (index !== -1) {
                aiEngines[index] = { id: currentEditingAiEngineId, name, apiKey, apiUrl, model, customPrompt };
            }
        } else {
            // Add new
            const newId = `ai-${Date.now()}`; // Simple unique ID
            aiEngines.push({ id: newId, name, apiKey, apiUrl, model, customPrompt });
        }
        markAsChanged(); // Mark settings as changed
        renderAiEngineList();
        populateAiEngineOptions(); // Update main dropdown
        elements.aiEngineForm.style.display = 'none';
        clearAiFormErrors(); // Clear errors after successful save
        currentEditingAiEngineId = null;
    };

    const removeAiEngine = (id) => {
        if (window.confirm(browser.i18n.getMessage('confirmDeleteRule') || 'Are you sure you want to remove this AI engine?')) { // Need new i18n key
            aiEngines = aiEngines.filter(e => e.id !== id);
            markAsChanged(); // Mark settings as changed
            renderAiEngineList();
            populateAiEngineOptions(); // Update main dropdown
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

    const populateAiEngineOptions = () => {
        // Add new AI options
        aiEngines.forEach(engine => {
            const option = document.createElement('option');
            option.value = `ai:${engine.id}`;
            option.textContent = engine.name; // Use the user-defined name directly.
            elements.translatorEngine.appendChild(option);
        });
    };


    const populateLanguageOptions = () => {
        const select = elements.targetLanguage;
        if (!select) return;

        for (const code in window.Constants.SUPPORTED_LANGUAGES) {
            const option = document.createElement('option');
            option.value = code;
            const langKey = window.Constants.SUPPORTED_LANGUAGES[code];
            option.textContent = browser.i18n.getMessage(langKey) || code;
            select.appendChild(option);
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
        
        elements.aiTestResult.style.display = 'none'; // Hide AI test result if testing from main area
        if (!sourceText) {
            resultArea.textContent = browser.i18n.getMessage('testSourceEmpty') || 'Please enter text to translate.';
            resultArea.className = 'test-result-area error';
            return;
        }

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

            // 显示日志
            if (response.log && response.log.length > 0) {
                elements.logContent.textContent = response.log.join('\n');
                document.getElementById('test-log-area').style.display = 'block'; // 确保日志区域可见
                elements.toggleLogBtn.textContent = browser.i18n.getMessage('hideLogButton') || 'Hide Log';
            } else {
                elements.logContent.textContent = 'No detailed logs available.';
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

        const name = elements.aiEngineNameInput.value.trim();
        const apiKey = elements.aiApiKeyInput.value.trim();
        const apiUrl = elements.aiApiUrlInput.value.trim();
        const model = elements.aiModelNameInput.value.trim();
        const customPrompt = elements.aiCustomPromptInput.value.trim();

        let isValid = true;
        isValid = validateAiFormField(elements.aiEngineNameInput, elements.aiEngineNameError, 'aiEngineName') && isValid;
        isValid = validateAiFormField(elements.aiApiKeyInput, elements.aiApiKeyError, 'aiApiKey') && isValid;
        isValid = validateAiFormField(elements.aiApiUrlInput, elements.aiApiUrlError, 'aiApiUrl') && isValid;
        isValid = validateAiFormField(elements.aiModelNameInput, elements.aiModelNameError, 'aiModelName') && isValid;
        isValid = validateAiFormField(elements.aiCustomPromptInput, elements.aiCustomPromptError, 'aiCustomPrompt') && isValid;

        if (!isValid) {
            elements.aiTestResult.style.display = 'none'; // Hide test result if validation fails
            showStatusMessage(browser.i18n.getMessage('fillAllRequiredFields') || 'Please fill in all required fields for testing.', true);
            return;
        }

        elements.aiTestResult.textContent = browser.i18n.getMessage('testing') || 'Testing...';
        elements.aiTestResult.className = 'status-message';
        elements.aiTestResult.style.display = 'block';

        try {
            const response = await browser.runtime.sendMessage({
                type: 'TEST_CONNECTION',
                payload: {
                    engine: 'ai',
                    settings: { apiKey, apiUrl, model, customPrompt } // Pass the specific AI config to test
                }
            });

            if (response.success) {
                elements.aiTestResult.textContent = `${browser.i18n.getMessage('testOriginal')}: test, ${browser.i18n.getMessage('testTranslated')}: ${response.translatedText.text}`;
                elements.aiTestResult.className = 'status-message success';
            } else {
                elements.aiTestResult.textContent = `${browser.i18n.getMessage('testError')}: ${response.error}`;
                elements.aiTestResult.className = 'status-message error';
            }
        } catch (error) {
            console.error('AI connection test error:', error);
            elements.aiTestResult.textContent = `${browser.i18n.getMessage('testError')}: ${error.message}`;
            elements.aiTestResult.className = 'status-message error';
        }
    };


    // --- Initialization and Event Listeners ---
    const initialize = async () => {
        applyTranslations();
        populateLanguageOptions();
        await loadSettings();
        manageSelectLabels(); // Ensure select labels are correctly positioned on load and on change
        // Apply ripple effect to all static M3 buttons (excluding FAB for now)
        document.querySelectorAll('.m3-button:not(#saveSettingsBtn)').forEach(addRippleEffect);
        addRippleEffect(elements.addDomainRuleBtn); // Ensure this one gets it too


         // Main settings listeners
        elements.translatorEngine.addEventListener('change', markAsChanged);
        elements.translatorEngine.addEventListener('change', toggleApiFields); // Keep separate from unsaved changes
        elements.saveSettingsBtn.addEventListener('click', saveSettings);
        elements.resetSettingsBtn.addEventListener('click', resetSettings);
        elements.addDomainRuleBtn.addEventListener('click', addDomainRule);
        elements.exportBtn.addEventListener('click', exportSettings);
        elements.importBtn.addEventListener('click', () => elements.importInput.click());

        // AI Engine Modal Listeners
        elements.manageAiEnginesBtn.addEventListener('click', openAiEngineModal);
        elements.closeAiEngineModalBtn.addEventListener('click', closeAiEngineModal);
        elements.addAiEngineBtn.addEventListener('click', addAiEngine);
        elements.aiEngineForm.addEventListener('input', clearAiFormErrors); // Clear errors on input
        elements.saveAiEngineBtn.addEventListener('click', saveAiEngine);
        elements.cancelAiEngineBtn.addEventListener('click', () => elements.aiEngineForm.style.display = 'none');
        elements.testAiEngineBtn.addEventListener('click', testAiEngineConnection);

        // Other listeners
        elements.importInput.addEventListener('change', importSettings);
        
        const testTextInput = document.getElementById('testTextInput');
        if (testTextInput) {
            testTextInput.addEventListener('focus', () => {
                // Hide all visible test results when the main test text input gets focus
                document.querySelectorAll('.rule-test-result.show').forEach(resultEl => {
                    resultEl.classList.remove('show');
                });
            });
        }
        
        // --- Event Listeners for Unsaved Changes ---
        // 监听所有输入框、选择框和文本域的变化
        document.querySelector('.container').addEventListener('input', (event) => {
            const target = event.target;
            // 排除按钮、文件输入和AI模态框内的输入，因为它们触发的是动作而不是设置值更改
            if (target.matches('input:not([type="button"]):not([type="submit"]):not([type="file"]), textarea, select')) {
                markAsChanged();
            }
        });
        // 监听复选框和选择框的change事件
        document.querySelector('.container').addEventListener('change', (event) => {
            const target = event.target;
            if (target.matches('input[type="checkbox"], select')) {
                markAsChanged();
            }
        });

        // Listen for changes within the AI engine form to mark as changed
        elements.aiEngineForm.addEventListener('input', (event) => {
            const target = event.target;
            if (target.matches('input:not([type="button"]):not([type="submit"]), textarea')) {
                markAsChanged();
            }
            if (target.matches('select')) {
                markAsChanged();
            }
        });
        
        const testTranslationBtn = document.getElementById('testTranslationBtn');
        if(testTranslationBtn) testTranslationBtn.addEventListener('click', toggleTestArea);
        elements.toggleLogBtn.addEventListener('click', toggleLogArea);

        const sourceTextArea = document.getElementById('test-source-text');
        const manualTranslateBtn = document.getElementById('manual-test-translate-btn');
        if(manualTranslateBtn) manualTranslateBtn.addEventListener('click', performTestTranslation);

        elements.mainTabButtons.forEach(button => {
            button.addEventListener('click', () => switchMainTab(button.dataset.tab));
        });
        // Apply ripple to tab buttons
        document.querySelectorAll('.tab-button').forEach(addRippleEffect);
        // Apply ripple to add rule button in precheck rules
        document.querySelectorAll('.add-rule-btn').forEach(addRippleEffect);

        // --- Before Unload Listener ---
        window.addEventListener('beforeunload', (event) => {
            if (hasUnsavedChanges) {
                // 现代浏览器通常会显示一个通用的提示信息，而不是自定义的字符串
                event.preventDefault(); // 阻止默认行为，触发提示
                event.returnValue = ''; // 某些浏览器需要设置此属性
                return ''; // 某些浏览器需要返回一个字符串
            }
        });
    };

    initialize();
});