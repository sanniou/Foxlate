document.addEventListener('DOMContentLoaded', () => {
    const elements = {
        sourceLanguageSelect: document.getElementById('sourceLanguageSelect'),
        targetLanguageSelect: document.getElementById('targetLanguageSelect'),
        engineSelect: document.getElementById('engineSelect'),
        displayModeSelect: document.getElementById('displayModeSelect'),
        translatePageBtn: document.getElementById('translatePageBtn'),
        stopTranslateBtn: document.getElementById('stopTranslateBtn'),
        autoTranslateCheckbox: document.getElementById('autoTranslate'),
        currentRuleIndicator: document.getElementById('currentRuleIndicator'),
        openOptionsBtn: document.getElementById('openOptionsBtn'),
        versionDisplay: document.getElementById('versionDisplay'),
        aboutBtn: document.getElementById('aboutBtn')
    };
    let activeTabId = null;
    let currentHostname = null;
    let currentRuleSource = 'default';

    const applyTranslations = () => {
        document.documentElement.lang = browser.i18n.getUILanguage();
        const i18nElements = document.querySelectorAll('[i18n-text]');
        i18nElements.forEach(el => {
            const key = el.getAttribute('i18n-text');
            const message = browser.i18n.getMessage(key);
            if (message) {
                const textElement = el.matches('button') ? el.querySelector('.btn-text') : el;
                if (textElement) textElement.textContent = message;
            }
        });
    };

    const manageSelectLabels = () => {
        document.querySelectorAll('.m3-form-field.outlined select').forEach(selectEl => {
            const parentField = selectEl.closest('.m3-form-field.outlined');
            if (!parentField) return;
            const updateState = () => parentField.classList.toggle('is-filled', !!selectEl.value);
            selectEl.addEventListener('change', updateState);
            updateState();
        });
    };

    const populateSelect = (selectElement, options, selectedValue) => {
        selectElement.innerHTML = '';
        for (const [value, i18nKey] of Object.entries(options)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = browser.i18n.getMessage(i18nKey) || i18nKey;
            option.selected = (value === selectedValue);
            selectElement.appendChild(option);
        }
    };

    const updateTranslateButtonState = (state = 'original', isJobRunning = false) => {
        const btnText = elements.translatePageBtn.querySelector('.btn-text');
        if (!btnText) return;

        elements.translatePageBtn.dataset.state = state;

        // ** (修复 #3) 核心逻辑更新 **
        if (isJobRunning) {
            elements.translatePageBtn.style.display = 'none';
            elements.stopTranslateBtn.style.display = 'inline-flex';
        } else {
            elements.translatePageBtn.style.display = 'inline-flex';
            elements.stopTranslateBtn.style.display = 'none';
            if (state === 'translated') {
                btnText.textContent = browser.i18n.getMessage('popupShowOriginal');
            } else {
                btnText.textContent = browser.i18n.getMessage('popupTranslatePage');
            }
        }
    };

    const loadAndApplySettings = async () => {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        activeTabId = tab.id;

        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};

        const allSupportedEngines = { ...window.Constants.SUPPORTED_ENGINES, ...(currentSettings.aiEngines || []).reduce((acc, eng) => ({...acc, [`ai:${eng.id}`]: eng.name}), {}) };
        populateSelect(elements.engineSelect, allSupportedEngines, currentSettings.translatorEngine || 'deeplx');
        populateSelect(elements.sourceLanguageSelect, window.Constants.SUPPORTED_LANGUAGES, 'auto');
        const targetLangs = { ...window.Constants.SUPPORTED_LANGUAGES };
        delete targetLangs.auto;
        populateSelect(elements.targetLanguageSelect, targetLangs, currentSettings.targetLanguage || 'ZH');
        elements.displayModeSelect.value = currentSettings.displayMode || 'replace';

        currentHostname = getHostname(tab.url);
        elements.autoTranslateCheckbox.disabled = !currentHostname;

        const defaultSettings = { autoTranslate: 'manual', ...currentSettings };
        let finalRule = { ...defaultSettings };
        currentRuleSource = 'default';

        if (currentHostname) {
            const domainRules = currentSettings.domainRules || {};
            const domainParts = currentHostname.split('.');
            let matchedDomain = Object.keys(domainRules).find(d => currentHostname.endsWith(d) && (domainRules[d].applyToSubdomains !== false || d === currentHostname)) || null;
            if (matchedDomain) {
                currentRuleSource = matchedDomain;
                finalRule = { ...defaultSettings, ...domainRules[matchedDomain] };
            }
        }

        elements.autoTranslateCheckbox.checked = finalRule.autoTranslate === 'always';
        elements.engineSelect.value = finalRule.translatorEngine;
        elements.targetLanguageSelect.value = finalRule.targetLanguage;
        elements.displayModeSelect.value = finalRule.displayMode;
        elements.currentRuleIndicator.textContent = `Rule: ${currentRuleSource}`;

        // ** (修复 #3) 状态管理重构：依赖 service-worker **
        const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
        const currentState = tabTranslationStates[activeTabId] || 'original';
        const isJobRunning = currentState === 'loading';
        updateTranslateButtonState(currentState, isJobRunning);
        
        manageSelectLabels();
    };

    const getHostname = (url) => {
        try {
            return new URL(url).hostname;
        } catch {
            return null;
        }
    };

    const saveChangeToRule = async (key, value) => {
        if (!currentHostname) return;
        const { settings } = await browser.storage.sync.get('settings');
        const s = settings || {};
        s.domainRules = s.domainRules || {};
        let domainToUpdate = (currentRuleSource === 'default') ? currentHostname : currentRuleSource;
        s.domainRules[domainToUpdate] = s.domainRules[domainToUpdate] || {};
        s.domainRules[domainToUpdate][key] = value;
        await browser.storage.sync.set({ settings: s });
        await loadAndApplySettings();
    };

    async function handleTranslateButtonClick() {
        if (!activeTabId) return;
        const currentState = elements.translatePageBtn.dataset.state;
        if (currentState === 'original') {
            updateTranslateButtonState('loading', true);
            browser.runtime.sendMessage({ type: 'INITIATE_PAGE_TRANSLATION', payload: { tabId: activeTabId } });
        } else {
            browser.runtime.sendMessage({ type: 'REVERT_PAGE_TRANSLATION_REQUEST', payload: { tabId: activeTabId } });
        }
    }

    async function handleStopButtonClick() {
        if (!activeTabId) return;
        browser.runtime.sendMessage({ type: 'INTERRUPT_TRANSLATION_REQUEST', payload: { tabId: activeTabId } });
        updateTranslateButtonState('translated', false);
    }

    const handleStatusBroadcast = (request) => {
        if (request.type === 'TRANSLATION_STATUS_BROADCAST' && request.payload.tabId === activeTabId) {
            updateTranslateButtonState(request.payload.status, request.payload.status === 'loading');
        }
    };

    const initialize = async () => {
        applyTranslations();
        elements.versionDisplay.textContent = `v${browser.runtime.getManifest().version}`;
        await loadAndApplySettings();

        elements.openOptionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());
        elements.translatePageBtn.addEventListener('click', handleTranslateButtonClick);
        elements.stopTranslateBtn.addEventListener('click', handleStopButtonClick);

        elements.autoTranslateCheckbox.addEventListener('change', (e) => saveChangeToRule('autoTranslate', e.target.checked ? 'always' : 'manual'));
        elements.engineSelect.addEventListener('change', (e) => saveChangeToRule('translatorEngine', e.target.value));
        elements.targetLanguageSelect.addEventListener('change', (e) => saveChangeToRule('targetLanguage', e.target.value));
        elements.displayModeSelect.addEventListener('change', async (e) => {
            const newDisplayMode = e.target.value;
            await saveChangeToRule('displayMode', newDisplayMode);
            const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
            if (tabTranslationStates[activeTabId] === 'translated') {
                browser.tabs.sendMessage(activeTabId, { type: 'UPDATE_DISPLAY_MODE', payload: { displayMode: newDisplayMode } });
            }
        });

        browser.runtime.onMessage.addListener(handleStatusBroadcast);
    };

    initialize();
});