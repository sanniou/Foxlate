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
                // For the main button, we have a nested span
                const textElement = el.querySelector('.btn-text') || el;
                textElement.textContent = message;
            }
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

        populateSelect(elements.engineSelect, window.Constants.SUPPORTED_ENGINES, currentSettings.translatorEngine || 'deeplx');
        const targetLangs = { ...window.Constants.SUPPORTED_LANGUAGES };
        delete targetLangs.auto;
        populateSelect(elements.sourceLanguageSelect, window.Constants.SUPPORTED_LANGUAGES, 'auto');
        populateSelect(elements.targetLanguageSelect, targetLangs, currentSettings.targetLanguage || 'ZH');

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
    };

    /**
     * Saves dropdown settings.
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
     * Handles clicks on the main translate button.
     */
    async function handleTranslateButtonClick() {
        if (!activeTabId) return;

        const currentState = elements.translatePageBtn.dataset.state;
        if (currentState === 'original') {
            updateTranslateButtonState('loading'); // Optimistic UI update
            browser.runtime.sendMessage({ type: 'INITIATE_PAGE_TRANSLATION', payload: { tabId: activeTabId } });
        } else {
            updateTranslateButtonState('original'); // Optimistic UI update
            browser.runtime.sendMessage({ type: 'REVERT_PAGE_TRANSLATION_REQUEST', payload: { tabId: activeTabId } });
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
        elements.engineSelect.addEventListener('change', saveCurrentSettings);
        elements.targetLanguageSelect.addEventListener('change', saveCurrentSettings);
        elements.alwaysTranslateToggle.addEventListener('change', handleAlwaysTranslateToggleChange);
        browser.runtime.onMessage.addListener(handleStatusBroadcast);

        elements.versionDisplay.textContent = `v${browser.runtime.getManifest().version}`;
    };

    initialize();
});