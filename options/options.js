document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const elements = {
        translatorEngine: document.getElementById('translatorEngine'),
        deeplxUrlGroup: document.getElementById('deeplxUrlGroup'),
        googleApiKeyGroup: document.getElementById('googleApiKeyGroup'),
        aiApiGroup: document.getElementById('aiApiGroup'),
        saveSettingsBtn: document.getElementById('saveSettingsBtn'),
        addDomainRuleBtn: document.getElementById('addDomainRuleBtn'),
        domainRulesList: document.getElementById('domainRulesList'),
        newDomainInput: document.getElementById('newDomain'),
        newDomainRuleSelect: document.getElementById('newDomainRule'),
        exportBtn: document.getElementById('export-btn'),
        importInput: document.getElementById('import-input'),
        statusMessage: document.getElementById('statusMessage'),
        testDeepLxBtn: document.getElementById('testDeepLxBtn'),
        testGoogleBtn: document.getElementById('testGoogleBtn'),
        testAiBtn: document.getElementById('testAiBtn'), // Cache all form inputs for consistency and performance
        targetLanguage: document.getElementById('targetLanguage'),
        defaultTranslationSelector: document.getElementById('defaultTranslationSelector'),
        deeplxApiUrl: document.getElementById('deeplxApiUrl'),
        domainTranslationSelector: document.getElementById('domainTranslationSelector'),
        googleApiKey: document.getElementById('googleApiKey'),
        aiApiKey: document.getElementById('aiApiKey'),
        aiApiUrl: document.getElementById('aiApiUrl'),
        aiModelName: document.getElementById('aiModelName'),
        displayModeRadios: document.querySelectorAll('input[name="displayMode"]'), // Cache all display mode radios
        precheckRuleTabs: document.getElementById('precheckRuleTabs'),
        precheckRuleContent: document.getElementById('precheckRuleContent'),
        mainTabButtons: document.querySelectorAll('.main-tab-button'),
    };

    let testPopover = null;
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
        elements.googleApiKeyGroup.style.display = 'none';
        elements.aiApiGroup.style.display = 'none';

        if (engine === 'deeplx') elements.deeplxUrlGroup.style.display = 'block';
        else if (engine === 'google') elements.googleApiKeyGroup.style.display = 'block';
        else if (engine === 'ai') elements.aiApiGroup.style.display = 'block';
    };

    // --- Test Connection UI ---
    const removeTestPopover = () => {
        if (testPopover) {
            testPopover.remove();
            testPopover = null;
        }
        document.removeEventListener('click', closePopoverOnClickOutside, true);
    };

    const closePopoverOnClickOutside = (event) => {
        if (testPopover && !testPopover.contains(event.target) && !event.target.classList.contains('test-btn')) {
            removeTestPopover();
        }
    };

    const showTestPopover = (buttonElement, content) => {
        removeTestPopover();
        testPopover = document.createElement('div');
        testPopover.className = 'test-result-popover';
        testPopover.innerHTML = content;
        document.body.appendChild(testPopover);

        const btnRect = buttonElement.getBoundingClientRect();
        const popoverRect = testPopover.getBoundingClientRect();
        let left = btnRect.left;
        if (left + popoverRect.width > window.innerWidth - 10) {
            left = window.innerWidth - popoverRect.width - 10;
        }
        testPopover.style.left = `${left}px`;
        testPopover.style.top = `${window.scrollY + btnRect.top - popoverRect.height - 8}px`;
        setTimeout(() => document.addEventListener('click', closePopoverOnClickOutside, true), 0);
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
        elements.googleApiKey.value = currentSettings.googleApiKey || '';
        elements.aiApiKey.value = currentSettings.aiApiKey || '';
        elements.aiApiUrl.value = currentSettings.aiApiUrl || '';
        elements.aiModelName.value = currentSettings.aiModelName || '';

        const displayMode = currentSettings.displayMode || 'replace';
        elements.displayModeRadios.forEach(radio => {
            if (radio.value === displayMode) {
                radio.checked = true;
            }
        });

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
            displayMode: document.querySelector('input[name="displayMode"]:checked').value,
            deeplxApiUrl: elements.deeplxApiUrl.value,
            googleApiKey: elements.googleApiKey.value,
            aiApiKey: elements.aiApiKey.value,
            aiApiUrl: elements.aiApiUrl.value,
            aiModelName: elements.aiModelName.value,
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

    // --- Pre-check Rules UI Logic ---

    const generateDefaultPrecheckRules = () => {
        const rules = {
            general: [
                { name: 'Whitespace only', regex: '^\\s*$', mode: 'blacklist', enabled: true, flags: '' },
                { name: 'Numbers, Punctuation, Symbols', regex: '^[\\d.,\\s\\p{P}\\p{S}]+$', mode: 'blacklist', enabled: true, flags: 'u' },
                { name: 'Single Emoji', regex: '^\\p{Emoji}$', mode: 'blacklist', enabled: true, flags: 'u' },
            ],
        };
        for (const langCode in window.Constants.LANG_REGEX_MAP) {
            if (window.Constants.SUPPORTED_LANGUAGES[langCode]) {
                rules[langCode] = [{
                    name: `Contains ${browser.i18n.getMessage(window.Constants.SUPPORTED_LANGUAGES[langCode]) || langCode}`,
                    regex: window.Constants.LANG_REGEX_MAP[langCode].regex,
                    mode: 'whitelist',
                    enabled: true,
                    flags: window.Constants.LANG_REGEX_MAP[langCode].flags,
                }];
            }
        }
        return rules;
    };

    function renderPrecheckRulesUI() {
        elements.precheckRuleTabs.innerHTML = '';
        elements.precheckRuleContent.innerHTML = '';

        Object.keys(precheckRules).forEach((category, index) => {
            const tabButton = document.createElement('button');
            tabButton.className = 'tab-button' + (index === 0 ? ' active' : '');
            tabButton.textContent = category;
            tabButton.dataset.category = category;
            tabButton.addEventListener('click', () => switchPrecheckTab(category));
            elements.precheckRuleTabs.appendChild(tabButton);

            const panel = document.createElement('div');
            panel.className = 'tab-panel' + (index === 0 ? ' active' : '');
            panel.id = `panel-${category}`;

            const ruleList = document.createElement('div');
            ruleList.className = 'rule-list';
            precheckRules[category].forEach(rule => {
                ruleList.appendChild(createRuleItemElement(rule));
            });
            panel.appendChild(ruleList);

            const addRuleBtn = document.createElement('button');
            addRuleBtn.textContent = browser.i18n.getMessage('addRule');
            addRuleBtn.className = 'add-rule-btn';
            addRuleBtn.addEventListener('click', () => addRuleToCategory(category));
            panel.appendChild(addRuleBtn);

            elements.precheckRuleContent.appendChild(panel);
        });
    }

    function createRuleItemElement(rule) {
        const item = document.createElement('div');
        item.className = 'rule-item';
        item.innerHTML = `
            <input type="text" class="rule-name" placeholder="Rule Name" value="${rule.name || ''}">
            <input type="text" class="rule-regex" placeholder="Regular Expression" value="${rule.regex || ''}">
            <input type="text" class="rule-flags" placeholder="flags" value="${rule.flags || ''}">
            <select class="rule-mode">
                <option value="blacklist" ${rule.mode === 'blacklist' ? 'selected' : ''}>Blacklist</option>
                <option value="whitelist" ${rule.mode === 'whitelist' ? 'selected' : ''}>Whitelist</option>
            </select>
            <label class="rule-enabled"><input type="checkbox" ${rule.enabled ? 'checked' : ''}> Enabled</label>
            <button class="remove-rule-btn">×</button>
        `;
        item.querySelector('.remove-rule-btn').addEventListener('click', (e) => e.currentTarget.closest('.rule-item').remove());
        return item;
    }

    function addRuleToCategory(category) {
        const newRule = { name: '', regex: '', mode: 'blacklist', enabled: true, flags: '' };
        const ruleList = document.querySelector(`#panel-${category} .rule-list`);
        ruleList.appendChild(createRuleItemElement(newRule));
    }

    function switchPrecheckTab(category) {
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`.tab-button[data-category="${category}"]`).classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
        document.getElementById(`panel-${category}`).classList.add('active');
    }

    function getPrecheckRulesFromUI() {
        const newRules = {};
        document.querySelectorAll('.tab-panel').forEach(panel => {
            const category = panel.id.replace('panel-', '');
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

    const testConnection = async (engine, buttonElement) => {
        let settingsPayload = {};
        if (engine === 'deeplx') {
            settingsPayload = { deeplxApiUrl: elements.deeplxApiUrl.value };
        } else if (engine === 'google') {
            settingsPayload = { googleApiKey: elements.googleApiKey.value };
        } else if (engine === 'ai') {
            settingsPayload = {
                aiApiKey: elements.aiApiKey.value,
                aiApiUrl: elements.aiApiUrl.value,
                aiModelName: elements.aiModelName.value,
            };
        }

        const originalButtonText = buttonElement.textContent;
        buttonElement.disabled = true;
        buttonElement.textContent = browser.i18n.getMessage('testing');
        removeTestPopover();

        try {
            const response = await browser.runtime.sendMessage({
                type: 'TEST_CONNECTION',
                payload: { engine, settings: settingsPayload }
            });
            const originalTitle = browser.i18n.getMessage('testOriginal');
            const translatedTitle = browser.i18n.getMessage('testTranslated');
            const errorTitle = browser.i18n.getMessage('testError');

            if (response.success) {
                showTestPopover(buttonElement, `<div class="result-item"><span class="result-title">${originalTitle}:</span><code class="result-text">test</code></div><div class="result-item"><span class="result-title">${translatedTitle}:</span><code class="result-text success">${response.translatedText}</code></div>`);
            } else {
                showTestPopover(buttonElement, `<div class="result-item"><span class="result-title">${errorTitle}:</span><code class="result-text error">${response.error}</code></div>`);
            }
        } catch (error) {
            showTestPopover(buttonElement, `<div class="result-item"><span class="result-title">${browser.i18n.getMessage('testError')}:</span><code class="result-text error">${error.message}</code></div>`);
        } finally {
            buttonElement.disabled = false;
            buttonElement.textContent = originalButtonText;
        }
    };

    // --- Initialization and Event Listeners ---
    const initialize = async () => {
        applyTranslations();
        await loadSettings();

        elements.translatorEngine.addEventListener('change', toggleApiFields);
        elements.saveSettingsBtn.addEventListener('click', saveSettings);
        elements.addDomainRuleBtn.addEventListener('click', addDomainRule);
        elements.exportBtn.addEventListener('click', exportSettings);
        elements.importInput.addEventListener('change', importSettings);
        elements.testDeepLxBtn.addEventListener('click', (e) => testConnection('deeplx', e.target));
        elements.testGoogleBtn.addEventListener('click', (e) => testConnection('google', e.target));
        elements.testAiBtn.addEventListener('click', (e) => testConnection('ai', e.target));
        elements.mainTabButtons.forEach(button => {
            button.addEventListener('click', () => switchMainTab(button.dataset.tab));
        });

    };

    initialize();
});
