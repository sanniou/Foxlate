document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const elements = {
        sourceLanguageSelect: document.getElementById('sourceLanguageSelect'),
        targetLanguageSelect: document.getElementById('targetLanguageSelect'),
        engineSelect: document.getElementById('engineSelect'),
        translatePageBtn: document.getElementById('translatePageBtn'),
        alwaysTranslateToggle: document.getElementById('alwaysTranslateToggle'),
        openOptionsBtn: document.getElementById('openOptionsBtn'),
        versionDisplay: document.getElementById('versionDisplay'),
        aboutBtn: document.getElementById('aboutBtn')
    };

    /**
     * Applies localized strings to the popup UI.
     * It finds all elements with an `i18n-text` attribute and replaces their
     * text content with the corresponding message from the locale files.
     */
    const applyTranslations = () => {
        // Set the language of the document for better accessibility and styling.
        document.documentElement.lang = browser.i18n.getUILanguage();

        // Find all elements that need translation and apply the messages.
        const i18nElements = document.querySelectorAll('[i18n-text]');
        i18nElements.forEach(el => {
            const key = el.getAttribute('i18n-text');
            const message = browser.i18n.getMessage(key);
            if (message) {
                el.textContent = message;
            } else {
                console.warn(`Missing translation for key: ${key}`);
            }
        });
    };

    /**
     * Populates a <select> element with options.
     * @param {HTMLSelectElement} selectElement The <select> element to populate.
     * @param {Object} options An object where keys are option values and values are i18n message keys.
     * @param {string} selectedValue The value that should be pre-selected.
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
     * Loads settings from storage and updates the UI accordingly.
     */
    const loadAndApplySettings = async () => {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};

        // Populate and select the translation engine
        populateSelect(elements.engineSelect, window.Constants.SUPPORTED_ENGINES, currentSettings.translatorEngine || 'deeplx');

        // Populate and select languages
        const targetLangs = { ...window.Constants.SUPPORTED_LANGUAGES };
        delete targetLangs.auto; // Target language cannot be 'auto'
        populateSelect(elements.sourceLanguageSelect, window.Constants.SUPPORTED_LANGUAGES, 'auto'); // Default source to auto for now
        populateSelect(elements.targetLanguageSelect, targetLangs, currentSettings.targetLanguage || 'ZH');

        // Set the "Always Translate" toggle state if we have a valid tab URL
        if (tab && tab.url && !tab.url.startsWith('about:')) {
            const domain = new URL(tab.url).hostname;
            const domainRules = currentSettings.domainRules || {};
            elements.alwaysTranslateToggle.checked = domainRules[domain] === 'always';
        } else {
            // Disable the toggle for special pages
            elements.alwaysTranslateToggle.disabled = true;
            elements.alwaysTranslateToggle.parentElement.parentElement.style.opacity = '0.5';
        }
    };

    /**
     * Saves the current UI state for select dropdowns to storage.
     */
    const saveCurrentSettings = async () => {
        const { settings: oldSettings } = await browser.storage.sync.get('settings');
        const newSettings = {
            ...oldSettings,
            translatorEngine: elements.engineSelect.value,
            targetLanguage: elements.targetLanguageSelect.value,
        };
        await browser.storage.sync.set({ settings: newSettings });
    };

    /**
     * Initializes the popup, sets up event listeners, and loads initial state.
     */
    const initialize = async () => {
        // Apply translations as the first step.
        applyTranslations();

        // Load settings and populate UI elements.
        await loadAndApplySettings();

        // --- Event Listeners ---
        elements.openOptionsBtn.addEventListener('click', () => {
            browser.runtime.openOptionsPage();
        });

        elements.translatePageBtn.addEventListener('click', async () => {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id) {
                browser.runtime.sendMessage({ type: 'INITIATE_PAGE_TRANSLATION', payload: { tabId: tab.id } });
                window.close();
            }
        });

        // Save settings when the user changes a dropdown
        elements.engineSelect.addEventListener('change', saveCurrentSettings);
        elements.targetLanguageSelect.addEventListener('change', saveCurrentSettings);

        elements.alwaysTranslateToggle.addEventListener('change', async () => {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
            const domain = new URL(tab.url).hostname;
            const { settings } = await browser.storage.sync.get('settings');
            const currentSettings = settings || {};
            currentSettings.domainRules = currentSettings.domainRules || {};

            currentSettings.domainRules[domain] = elements.alwaysTranslateToggle.checked ? 'always' : 'manual';
            await browser.storage.sync.set({ settings: currentSettings });
        });

        // Display the extension version.
        elements.versionDisplay.textContent = `v${browser.runtime.getManifest().version}`;
    };

    // Run the initialization logic.
    initialize();
});