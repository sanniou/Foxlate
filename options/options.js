document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const elements = {
        translatorEngine: document.getElementById('translatorEngine'),
        deeplxUrlGroup: document.getElementById('deeplxUrlGroup'),
        aiApiGroup: document.getElementById('aiApiGroup'),
        saveSettingsBtn: document.getElementById('saveSettingsBtn'),
        addDomainRuleBtn: document.getElementById('addDomainRuleBtn'),
        domainRulesList: document.getElementById('domainRulesList'),
        newDomainInput: document.getElementById('newDomain'),
        newDomainRuleSelect: document.getElementById('newDomainRule'),
        exportBtn: document.getElementById('export-btn'),
        importInput: document.getElementById('import-input'),
        resetSettingsBtn: document.getElementById('reset-settings-btn'),
        statusMessage: document.getElementById('statusMessage'),
        targetLanguage: document.getElementById('targetLanguage'),
        defaultTranslationSelector: document.getElementById('defaultTranslationSelector'),
        deeplxApiUrl: document.getElementById('deeplxApiUrl'),
        domainTranslationSelector: document.getElementById('domainTranslationSelector'),
        aiApiKey: document.getElementById('aiApiKey'),
        aiApiUrl: document.getElementById('aiApiUrl'),
        aiModelName: document.getElementById('aiModelName'),
        aiCustomPrompt: document.getElementById('aiCustomPrompt'),
        displayModeSelect: document.getElementById('displayModeSelect'),
        mainTabButtons: document.querySelectorAll('.main-tab-button'),
    };
    elements.toggleLogBtn = document.getElementById('toggleLogBtn');
    elements.logContent = document.getElementById('log-content');

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

    const toggleApiFields = () => {
        const engine = elements.translatorEngine.value;
        elements.deeplxUrlGroup.style.display = 'none';
        elements.aiApiGroup.style.display = 'none';

        if (engine === 'deeplx') elements.deeplxUrlGroup.style.display = 'block';
        else if (engine === 'ai') elements.aiApiGroup.style.display = 'block';
    };

    // --- Core Logic Functions ---
    const loadSettings = async () => {
        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};

        elements.translatorEngine.value = currentSettings.translatorEngine || 'deeplx';
        elements.targetLanguage.value = currentSettings.targetLanguage || 'ZH';
        elements.defaultTranslationSelector.value = currentSettings.translationSelector?.default || window.Constants.DEFAULT_TRANSLATION_SELECTOR;
        elements.domainTranslationSelector.value = currentSettings.translationSelector?.rules || '';
        elements.deeplxApiUrl.value = currentSettings.deeplxApiUrl || '';
        elements.aiApiKey.value = currentSettings.aiApiKey || '';
        elements.aiApiUrl.value = currentSettings.aiApiUrl || '';
        elements.aiModelName.value = currentSettings.aiModelName || '';
        elements.aiCustomPrompt.value = currentSettings.aiCustomPrompt || '';

        elements.displayModeSelect.value = currentSettings.displayMode || 'replace';

        toggleApiFields();
        renderDomainRules(currentSettings.domainRules || {});
        const defaultPrecheckRules = generateDefaultPrecheckRules();
        const storedRules = currentSettings.precheckRules;
        precheckRules = storedRules && Object.keys(storedRules).length > 0 ? storedRules : JSON.parse(JSON.stringify(defaultPrecheckRules));
        renderPrecheckRulesUI();
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
        const settings = {
            translatorEngine: elements.translatorEngine.value,
            targetLanguage: elements.targetLanguage.value,
            displayMode: elements.displayModeSelect.value,
            deeplxApiUrl: elements.deeplxApiUrl.value,
            aiApiKey: elements.aiApiKey.value,
            aiApiUrl: elements.aiApiUrl.value,
            aiModelName: elements.aiModelName.value,
            aiCustomPrompt: elements.aiCustomPrompt.value,
            translationSelector: {
                default: elements.defaultTranslationSelector.value,
                rules: getDomainRulesFromList(),
            },
            precheckRules: getPrecheckRulesFromUI(),
        };

        try {
            await browser.storage.sync.set({ settings });
            showStatusMessage(browser.i18n.getMessage('saveSettingsSuccess'));
        } catch (error) {
            console.error('Error saving settings:', error);
            showStatusMessage(browser.i18n.getMessage('saveSettingsError'), true);
        }
    };

    const resetSettings = async () => {
        const confirmationMessage = browser.i18n.getMessage('resetSettingsConfirm') || 'Are you sure you want to reset all settings to their default values? This action cannot be undone.';
        if (window.confirm(confirmationMessage)) {
            try {
                await browser.storage.sync.remove('settings');
                // After removing, reload the settings, which will apply the defaults.
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

        item.innerHTML = `
            <input type="text" class="rule-name" placeholder="${ruleNamePlaceholder}" value="${rule.name || ''}">
            <input type="text" class="rule-regex" placeholder="${regexPlaceholder}" value="${rule.regex || ''}">
            <input type="text" class="rule-flags" placeholder="${flagsPlaceholder}" value="${rule.flags || ''}">
            <select class="rule-mode">
                <option value="blacklist" ${rule.mode === 'blacklist' ? 'selected' : ''}>${blacklistText}</option>
                <option value="whitelist" ${rule.mode === 'whitelist' ? 'selected' : ''}>${whitelistText}</option>
            </select>
            <label class="rule-enabled"><input type="checkbox" ${rule.enabled ? 'checked' : ''}> ${enabledText}</label>
            <button class="remove-rule-btn">×</button>
        `;
        item.querySelector('.remove-rule-btn').addEventListener('click', (e) => e.currentTarget.closest('.rule-item').remove());
        return item;
    }

    function addRuleToCategory(category) {
        const newRule = { name: '', regex: '', mode: 'blacklist', enabled: true, flags: '' };
        const ruleList = document.querySelector(`#panel-${category} .rule-list`);
        if (ruleList) {
            ruleList.appendChild(createRuleItemElement(newRule));
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

        container.querySelectorAll('.tab-panel').forEach(panel => {
            const category = panel.dataset.category;
            if (!category) return;

            newRules[category] = [];
            panel.querySelectorAll('.rule-item').forEach(item => {
                const name = item.querySelector('.rule-name').value.trim();
                const regex = item.querySelector('.rule-regex').value.trim();
                if (name && regex) {
                    newRules[category].push({
                        name: name,
                        regex: regex,
                        flags: item.querySelector('.rule-flags').value.trim(),
                        mode: item.querySelector('.rule-mode').value,
                        enabled: item.querySelector('.rule-enabled input').checked,
                    });
                }
            });
        });
        return newRules;
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
        const listItem = document.createElement("li");
        const isAlways = value === "always";
        const selectorText = isAlways
          ? alwaysTranslateText
          : value; // Directly use the selector string if not "always"
  
        listItem.innerHTML = `
          <span><strong>${domain}</strong>: ${selectorText}</span>
          <button data-domain="${domain}">${removeText}</button>
        `;
        listItem.querySelector("button").addEventListener("click", (event) => {
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
                showStatusMessage(browser.i18n.getMessage('importSuccess'));
                await loadSettings();
            } catch (error) {
                showStatusMessage(browser.i18n.getMessage('importError'), true);
                console.error(error);
            }
        };
        reader.readAsText(file);
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
        
        if (!sourceText) {
            resultArea.textContent = browser.i18n.getMessage('testSourceEmpty') || 'Please enter text to translate.';
            resultArea.className = 'test-result-area error';
            return;
        }

        resultArea.textContent = browser.i18n.getMessage('testing') || 'Translating...';
        resultArea.className = 'test-result-area';

        try {
            // 发送消息到后台服务工作线程进行翻译，并请求返回日志
            const response = await browser.runtime.sendMessage({
                type: 'TRANSLATE_TEXT',
                payload: {
                    text: sourceText,
                    targetLang: elements.targetLanguage.value,
                    sourceLang: 'auto'
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

    // --- Initialization and Event Listeners ---
    const initialize = async () => {
        applyTranslations();
        populateLanguageOptions();
        await loadSettings();

        elements.translatorEngine.addEventListener('change', toggleApiFields);
        elements.saveSettingsBtn.addEventListener('click', saveSettings);
        elements.addDomainRuleBtn.addEventListener('click', addDomainRule);
        elements.exportBtn.addEventListener('click', exportSettings);
        elements.importInput.addEventListener('change', importSettings);
        elements.resetSettingsBtn.addEventListener('click', resetSettings);
        
        const testTranslationBtn = document.getElementById('testTranslationBtn');
        if(testTranslationBtn) testTranslationBtn.addEventListener('click', toggleTestArea);
        elements.toggleLogBtn.addEventListener('click', toggleLogArea);

        const sourceTextArea = document.getElementById('test-source-text');
        const manualTranslateBtn = document.getElementById('manual-test-translate-btn');
        if(manualTranslateBtn) manualTranslateBtn.addEventListener('click', performTestTranslation);

        elements.mainTabButtons.forEach(button => {
            button.addEventListener('click', () => switchMainTab(button.dataset.tab));
        });
    };

    initialize();
});