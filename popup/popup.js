document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const elements = {
        sourceLanguageSelect: document.getElementById('sourceLanguageSelect'),
        targetLanguageSelect: document.getElementById('targetLanguageSelect'),
        engineSelect: document.getElementById('engineSelect'),
        displayModeSelect: document.getElementById('displayModeSelect'),
        translatePageBtn: document.getElementById('translatePageBtn'),
        stopTranslateBtn: document.getElementById('stopTranslateBtn'), // ** 新增 **
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
                if (textElement) {
                    textElement.textContent = message;
                }
            }
        });
    };

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
            updateState();
        });
    };

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

        // ** 逻辑更新 **
        switch (state) {
            case 'translated':
                btnText.textContent = browser.i18n.getMessage('popupShowOriginal');
                elements.translatePageBtn.classList.remove('loading');
                elements.translatePageBtn.style.display = 'inline-flex';
                elements.stopTranslateBtn.style.display = 'none';
                break;
            case 'loading':
                // 显示停止按钮，隐藏翻译按钮
                elements.translatePageBtn.style.display = 'none';
                elements.stopTranslateBtn.style.display = 'inline-flex';
                break;
            default: // 'original'
                btnText.textContent = browser.i18n.getMessage('popupTranslatePage');
                elements.translatePageBtn.classList.remove('loading');
                elements.translatePageBtn.style.display = 'inline-flex';
                elements.stopTranslateBtn.style.display = 'none';
                break;
        }
    };

    const loadAndApplySettings = async () => {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        activeTabId = tab.id;

        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};

        const allSupportedEngines = { ...window.Constants.SUPPORTED_ENGINES };
        const aiEngines = currentSettings.aiEngines || [];
        aiEngines.forEach(engine => {
            allSupportedEngines[`ai:${engine.id}`] = engine.name;
        });
        populateSelect(elements.engineSelect, allSupportedEngines, currentSettings.translatorEngine || 'deeplx');
        populateSelect(elements.sourceLanguageSelect, window.Constants.SUPPORTED_LANGUAGES, 'auto');
        const targetLangs = { ...window.Constants.SUPPORTED_LANGUAGES };
        delete targetLangs.auto;
        populateSelect(elements.targetLanguageSelect, targetLangs, currentSettings.targetLanguage || 'ZH');
        elements.displayModeSelect.value = currentSettings.displayMode || 'replace';

        currentHostname = getHostname(tab.url);
        elements.autoTranslateCheckbox.disabled = !currentHostname;

        const defaultSettings = {
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
            if (domainRules[currentHostname]) {
                matchedDomain = currentHostname;
            } else {
                for (let i = 1; i < domainParts.length; i++) {
                    const parentDomain = domainParts.slice(i).join('.');
                    if (domainRules[parentDomain] && domainRules[parentDomain].applyToSubdomains !== false) {
                        matchedDomain = parentDomain;
                        break;
                    }
                }
            }
            if (matchedDomain) {
                currentRuleSource = matchedDomain;
                finalRule = { ...defaultSettings, ...domainRules[matchedDomain] };
            }
        }

        elements.autoTranslateCheckbox.checked = finalRule.autoTranslate === 'always';
        elements.engineSelect.value = finalRule.translatorEngine;
        elements.targetLanguageSelect.value = finalRule.targetLanguage;
        elements.displayModeSelect.value = finalRule.displayMode;

        elements.currentRuleIndicator.style.display = 'inline';
        elements.currentRuleIndicator.textContent = `Rule: ${currentRuleSource}`;
        const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
        updateTranslateButtonState(tabTranslationStates[activeTabId] || 'original');
        
        manageSelectLabels();
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

    const saveChangeToRule = async (key, value) => {
        if (!currentHostname) return;
        const { settings } = await browser.storage.sync.get('settings');
        const currentSettings = settings || {};
        currentSettings.domainRules = currentSettings.domainRules || {};
        let domainToUpdate = currentRuleSource;
        if (domainToUpdate === 'default') {
            domainToUpdate = currentHostname;
            if (!currentSettings.domainRules[domainToUpdate]) {
                currentSettings.domainRules[domainToUpdate] = {};
            }
        }
        currentSettings.domainRules[domainToUpdate][key] = value;
        await browser.storage.sync.set({ settings: currentSettings });
        await loadAndApplySettings();
    };

    async function handleTranslateButtonClick() {
        if (!activeTabId) return;
        const currentState = elements.translatePageBtn.dataset.state;
        if (currentState === 'original') {
            updateTranslateButtonState('loading');
            browser.runtime.sendMessage({ type: 'INITIATE_PAGE_TRANSLATION', payload: { tabId: activeTabId } });
        } else {
            // "显示原文" 按钮被点击
            browser.runtime.sendMessage({ type: 'REVERT_PAGE_TRANSLATION_REQUEST', payload: { tabId: activeTabId } });
        }
    }

    // ** 新增：停止按钮的处理器 **
    async function handleStopButtonClick() {
        if (!activeTabId) return;
        // 发送中断请求
        browser.runtime.sendMessage({ type: 'INTERRUPT_TRANSLATION_REQUEST', payload: { tabId: activeTabId } });
        // 立即将UI恢复到“已翻译”状态，让用户可以点击“显示原文”
        updateTranslateButtonState('translated');
    }

    const handleStatusBroadcast = (request) => {
        if (request.type === 'TRANSLATION_STATUS_BROADCAST' && request.payload.tabId === activeTabId) {
            updateTranslateButtonState(request.payload.status || 'original');
        }
    };

    const initialize = async () => {
        applyTranslations();
        manageSelectLabels();
        elements.versionDisplay.textContent = `v${browser.runtime.getManifest().version}`;
        await loadAndApplySettings();

        elements.openOptionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());
        elements.translatePageBtn.addEventListener('click', handleTranslateButtonClick);
        elements.stopTranslateBtn.addEventListener('click', handleStopButtonClick); // ** 新增 **

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
            const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
            const currentState = tabTranslationStates[activeTabId];
            if (currentState === 'translated') {
                browser.tabs.sendMessage(activeTabId, {
                    type: 'UPDATE_DISPLAY_MODE',
                    payload: { displayMode: newDisplayMode }
                }).catch(err => console.error("Failed to send display mode update:", err));
            }
        });

        browser.runtime.onMessage.addListener(handleStatusBroadcast);
    };



    initialize();
});