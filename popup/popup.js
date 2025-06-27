document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const elements = {
        sourceLanguageSelect: document.getElementById('sourceLanguageSelect'),
        targetLanguageSelect: document.getElementById('targetLanguageSelect'),
        engineSelect: document.getElementById('engineSelect'),
        displayModeSelect: document.getElementById('displayModeSelect'),
        translatePageBtn: document.getElementById('translatePageBtn'),
        alwaysTranslateToggle: document.getElementById('alwaysTranslateToggle'),
        openOptionsBtn: document.getElementById('openOptionsBtn'),
        versionDisplay: document.getElementById('versionDisplay'),
        aboutBtn: document.getElementById('aboutBtn')
    };
    let activeTabId = null;

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
        // Start with all supported engines from Constants
        const allSupportedEngines = { ...window.Constants.SUPPORTED_ENGINES };
        const aiEngines = currentSettings.aiEngines || [];
        // Add custom AI engines to the list
        aiEngines.forEach(engine => {
            // The value is 'ai:engineId', and the text is the user-defined engine name.
            allSupportedEngines[`ai:${engine.id}`] = engine.name;
        });
        populateSelect(elements.engineSelect, allSupportedEngines, currentSettings.translatorEngine || 'deeplx');
        populateSelect(elements.sourceLanguageSelect, window.Constants.SUPPORTED_LANGUAGES, 'auto');
        const targetLangs = { ...window.Constants.SUPPORTED_LANGUAGES };
        delete targetLangs.auto; // Target language cannot be 'auto'
        populateSelect(elements.targetLanguageSelect, targetLangs, currentSettings.targetLanguage || 'ZH');
        elements.displayModeSelect.value = currentSettings.displayMode || 'replace';

        if (tab.url && !tab.url.startsWith('about:')) {
            const domain = new URL(tab.url).hostname;
            const domainRules = currentSettings.domainRules || {};
            elements.alwaysTranslateToggle.checked = domainRules[domain] === 'always';
        } else {
            elements.alwaysTranslateToggle.disabled = true;
            elements.alwaysTranslateToggle.parentElement.parentElement.style.opacity = '0.5';
        }

        const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
        updateTranslateButtonState(tabTranslationStates[activeTabId] || 'original');

        // After populating and setting values, manage the labels
        manageSelectLabels();
    };

    /**
     * Saves all relevant settings from the popup UI to storage.
     */
    const saveCurrentSettings = async () => {
        const { settings: oldSettings } = await browser.storage.sync.get('settings');
        const newSettings = {
            ...oldSettings,
            translatorEngine: elements.engineSelect.value,
            targetLanguage: elements.targetLanguageSelect.value,
            displayMode: elements.displayModeSelect.value,
        };
        await browser.storage.sync.set({ settings: newSettings });
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
     * Handles changes to the display mode dropdown.
     */
    async function handleDisplayModeChange() {
        await saveCurrentSettings();

        const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
        const currentState = tabTranslationStates[activeTabId];

        if (currentState === 'translated') {
            browser.tabs.sendMessage(activeTabId, {
                type: 'UPDATE_DISPLAY_MODE',
                payload: { displayMode: elements.displayModeSelect.value }
            }).catch(e => console.error("Failed to send display mode update:", e));
        }
    }

    /**
     * Handles changes to the "Always Translate" toggle.
     */
    async function handleAlwaysTranslateToggleChange() {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || tab.url.startsWith('about:')) return;

        const domain = new URL(tab.url).hostname;
        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};
        currentSettings.domainRules = currentSettings.domainRules || {};
        currentSettings.domainRules[domain] = elements.alwaysTranslateToggle.checked ? 'always' : 'manual';
        await browser.storage.sync.set({ settings: currentSettings });
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
        applyTranslations();
        await loadAndApplySettings();

        // --- Event Listeners ---
        elements.openOptionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());
        elements.translatePageBtn.addEventListener('click', handleTranslateButtonClick);
        
        // Listen for changes on dropdowns
        elements.engineSelect.addEventListener('change', saveCurrentSettings);
        elements.targetLanguageSelect.addEventListener('change', saveCurrentSettings);
        elements.displayModeSelect.addEventListener('change', handleDisplayModeChange);

        elements.alwaysTranslateToggle.addEventListener('change', handleAlwaysTranslateToggleChange);
        browser.runtime.onMessage.addListener(handleStatusBroadcast);

        elements.versionDisplay.textContent = `v${browser.runtime.getManifest().version}`;
    };

    initialize();
});
