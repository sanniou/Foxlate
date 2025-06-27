document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const elements = {
        sourceLanguageSelect: document.getElementById('sourceLanguageSelect'),
        targetLanguageSelect: document.getElementById('targetLanguageSelect'),
        engineSelect: document.getElementById('engineSelect'),
        displayModeSelect: document.getElementById('displayModeSelect'),
        translatePageBtn: document.getElementById('translatePageBtn'),
        autoTranslateCheckbox: document.getElementById('autoTranslate'),
        currentRuleIndicator: document.getElementById('currentRuleIndicator'), // 新增元素
        openOptionsBtn: document.getElementById('openOptionsBtn'),
        versionDisplay: document.getElementById('versionDisplay'),
        aboutBtn: document.getElementById('aboutBtn')
    };
    let activeTabId = null;
    let currentHostname = null;
    let currentRuleSource = 'default';

    /**
     * Applies localized strings to the popup UI.
     */
    const applyTranslations = () => {
        document.documentElement.lang = browser.i18n.getUILanguage();
        const i18nElements = document.querySelectorAll('[i18n-text]');
        i18nElements.forEach(el => {
            const key = el.getAttribute('i18n-text');
            const message = browser.i18n.getMessage(key);
            if (message) {
                const textElement = el.matches('button') ? el.querySelector('.btn-text') : el;
                if (textElement) {
                    textElement.textContent = message;
                }
            }
        });
    };

    /**
     * Handles the floating label state for <select> elements by adding/removing
     * an 'is-filled' class to the parent container.
     */
    const manageSelectLabels = () => {
        document.querySelectorAll('.m3-form-field.outlined select').forEach(selectEl => {
            const parentField = selectEl.closest('.m3-form-field.outlined');
            if (!parentField) return;

            const updateState = () => {
                if (selectEl.value) {
                    parentField.classList.add('is-filled');
                } else {
                    parentField.classList.remove('is-filled');
                }
            };

            selectEl.addEventListener('change', updateState);
            updateState(); // Run on initial load
        });
    };
    /**
     * Populates a <select> element with options.
     */
    const populateSelect = (selectElement, options, selectedValue) => {
        selectElement.innerHTML = '';
        for (const [value, i18nKey] of Object.entries(options)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = browser.i18n.getMessage(i18nKey) || i18nKey;
            if (value === selectedValue) {
                option.selected = true;
            }
            selectElement.appendChild(option);
        }
    };

    /**
     * Updates the main action button's text and state.
     */
    const updateTranslateButtonState = (state = 'original') => {
        const btnText = elements.translatePageBtn.querySelector('.btn-text');
        if (!btnText) return;

        elements.translatePageBtn.disabled = false;
        elements.translatePageBtn.dataset.state = state;

        switch (state) {
            case 'translated':
                btnText.textContent = browser.i18n.getMessage('popupShowOriginal');
                elements.translatePageBtn.classList.remove('loading');
                break;
            case 'loading':
                btnText.textContent = browser.i18n.getMessage('popupShowOriginal');
                elements.translatePageBtn.classList.add('loading');
                break;
            default: // 'original'
                btnText.textContent = browser.i18n.getMessage('popupTranslatePage');
                elements.translatePageBtn.classList.remove('loading');
                break;
        }
    };

    /**
     * Loads settings and updates the UI.
     */
    const loadAndApplySettings = async () => {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        activeTabId = tab.id;

        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};

        // Populate all select elements
        const allSupportedEngines = { ...window.Constants.SUPPORTED_ENGINES };
        const aiEngines = currentSettings.aiEngines || [];

        aiEngines.forEach(engine => {
            allSupportedEngines[`ai:${engine.id}`] = engine.name;
        });
        populateSelect(elements.engineSelect, allSupportedEngines, currentSettings.translatorEngine || 'deeplx');
        populateSelect(elements.sourceLanguageSelect, window.Constants.SUPPORTED_LANGUAGES, 'auto');
        const targetLangs = { ...window.Constants.SUPPORTED_LANGUAGES };
        delete targetLangs.auto; // Target language cannot be 'auto'

        populateSelect(elements.targetLanguageSelect, targetLangs, currentSettings.targetLanguage || 'ZH');
        elements.displayModeSelect.value = currentSettings.displayMode || 'replace';

        // --- Rule Application Logic ---
        currentHostname = getHostname(tab.url);
        elements.autoTranslateCheckbox.disabled = !currentHostname;

        const defaultSettings = { // Define the global settings as the base
            autoTranslate: currentSettings.autoTranslate ? 'always' : 'manual',
            translatorEngine: currentSettings.translatorEngine || 'deeplx',
            targetLanguage: currentSettings.targetLanguage || 'ZH',
            displayMode: currentSettings.displayMode || 'replace',
        };

        let finalRule = { ...defaultSettings };
        currentRuleSource = 'default';

        if (currentHostname) {
            const domainRules = currentSettings.domainRules || {};
            const domainParts = currentHostname.split('.');
            let matchedDomain = null;

            // 1. Check for exact hostname match (e.g., 'sub.example.com')
            if (domainRules[currentHostname]) {
                matchedDomain = currentHostname;
            } else {
                // 2. Check for parent domains (e.g., 'example.com' for 'sub.example.com')
                for (let i = 1; i < domainParts.length; i++) {
                    const parentDomain = domainParts.slice(i).join('.');
                    if (domainRules[parentDomain] && domainRules[parentDomain].applyToSubdomains !== false) {
                        matchedDomain = parentDomain;
                        break; // Found the most specific applicable parent rule
                    }
                }
            }

            if (matchedDomain) {
                currentRuleSource = matchedDomain;
                finalRule = { ...defaultSettings, ...domainRules[matchedDomain] };
            }
        }

        // Apply the final, merged rule to the UI
        elements.autoTranslateCheckbox.checked = finalRule.autoTranslate === 'always';
        elements.engineSelect.value = finalRule.translatorEngine;
        elements.targetLanguageSelect.value = finalRule.targetLanguage;
        elements.displayModeSelect.value = finalRule.displayMode;

        // Update UI indicators
        elements.currentRuleIndicator.style.display = 'inline';
        elements.currentRuleIndicator.textContent = `Rule: ${currentRuleSource}`;
        const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
        updateTranslateButtonState(tabTranslationStates[activeTabId] || 'original');
        
        // After populating and setting values, manage the labels
        manageSelectLabels();
    };

    const getCurrentTab = async () => {
        let queryOptions = { active: true, currentWindow: true };
        let [tab] = await browser.tabs.query(queryOptions);
        return tab;
    };

    const getHostname = (url) => {
        try {
            if (!url || url.startsWith('about:') || url.startsWith('moz-extension:')) return null;
            return new URL(url).hostname;
        } catch (e) {
            console.error("Invalid URL:", url);
            return null;
        }
    };

    /**
     * Saves a specific setting change to the correct rule (domain or global).
     * @param {string} key The setting key to change (e.g., 'targetLanguage').
     * @param {any} value The new value for the setting.
     */
    const saveChangeToRule = async (key, value) => {
        if (!currentHostname) return;

        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};
        currentSettings.domainRules = currentSettings.domainRules || {};

        let domainToUpdate = currentRuleSource;

        // If the current rule is the default, create a new rule for the specific hostname.
        if (domainToUpdate === 'default') {
            domainToUpdate = currentHostname;
            if (!currentSettings.domainRules[domainToUpdate]) {
                currentSettings.domainRules[domainToUpdate] = {};
            }
        }

        currentSettings.domainRules[domainToUpdate][key] = value;

        await browser.storage.sync.set({ settings: currentSettings });
        await loadAndApplySettings(); // Reload to reflect the change
    };

    /**
     * Handles clicks on the main translate button.
     */
    async function handleTranslateButtonClick() {
        if (!activeTabId) return;

        const currentState = elements.translatePageBtn.dataset.state;
        if (currentState === 'original') {
            updateTranslateButtonState('loading');
            browser.runtime.sendMessage({ type: 'INITIATE_PAGE_TRANSLATION', payload: { tabId: activeTabId } });
        } else {
            updateTranslateButtonState('original');
            browser.runtime.sendMessage({ type: 'REVERT_PAGE_TRANSLATION_REQUEST', payload: { tabId: activeTabId } });
        }
    }

    /**
     * Handles status broadcasts from the service worker.
     */
    const handleStatusBroadcast = (request) => {
        if (request.type === 'TRANSLATION_STATUS_BROADCAST' && request.payload.tabId === activeTabId) {
            updateTranslateButtonState(request.payload.status || 'original');
        }
    };

    /**
     * Initializes the popup.
     */
    const initialize = async () => {
        // 1. Initial UI setup
        applyTranslations();
        manageSelectLabels();
        elements.versionDisplay.textContent = `v${browser.runtime.getManifest().version}`;

        // 2. Load settings and apply rules to UI
        await loadAndApplySettings();

        // 3. Add event listeners
        elements.openOptionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());
        elements.translatePageBtn.addEventListener('click', handleTranslateButtonClick);

        // Listeners for settings changes that save to rules
        elements.autoTranslateCheckbox.addEventListener('change', (e) => {
            saveChangeToRule('autoTranslate', e.target.checked ? 'always' : 'manual');
        });
        elements.engineSelect.addEventListener('change', (e) => {
            saveChangeToRule('translatorEngine', e.target.value);
        });
        elements.targetLanguageSelect.addEventListener('change', (e) => {
            saveChangeToRule('targetLanguage', e.target.value);
        });
        elements.displayModeSelect.addEventListener('change', async (e) => {
            const newDisplayMode = e.target.value;
            await saveChangeToRule('displayMode', newDisplayMode);

            // Handle live update on the page if it's already translated
            const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
            const currentState = tabTranslationStates[activeTabId];

            if (currentState === 'translated') {
                browser.tabs.sendMessage(activeTabId, {
                    type: 'UPDATE_DISPLAY_MODE',
                    payload: { displayMode: newDisplayMode }
                }).catch(err => console.error("Failed to send display mode update:", err));
            }
        });

        // Listener for broadcasts from service worker
        browser.runtime.onMessage.addListener(handleStatusBroadcast);
    };

    initialize();
});
