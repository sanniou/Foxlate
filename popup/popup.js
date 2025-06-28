document.addEventListener('DOMContentLoaded', () => {
    const elements = {
        sourceLanguageSelect: document.getElementById('sourceLanguageSelect'),
        targetLanguageSelect: document.getElementById('targetLanguageSelect'),
        engineSelect: document.getElementById('engineSelect'),
        displayModeSelect: document.getElementById('displayModeSelect'),
        translatePageBtn: document.getElementById('translatePageBtn'),
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

    const updateTranslateButtonState = (state = 'original') => {
        const btnText = elements.translatePageBtn.querySelector('.btn-text');
        if (!btnText) return;

        // 移除所有可能的状态类
        elements.translatePageBtn.classList.remove('loading', 'revert');
        elements.translatePageBtn.dataset.state = state;

        switch (state) {
            case 'loading':
                btnText.textContent = browser.i18n.getMessage('popupStopTranslation');
                elements.translatePageBtn.classList.add('loading');
                break;
            case 'translated':
                btnText.textContent = browser.i18n.getMessage('popupShowOriginal');
                elements.translatePageBtn.classList.add('revert');
                break;
            default: // 'original'
                btnText.textContent = browser.i18n.getMessage('popupTranslatePage');
                break;
        }
    };

    const getHostname = (url) => {
        try {
            // 确保 URL 是有效的、可以提取主机名的类型
            if (!url || !url.startsWith('http')) {
                return null;
            }
            return new URL(url).hostname;
        } catch (e) {
            console.error(`[Popup] Could not parse hostname from URL: "${url}"`, e);
            return null;
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
        await updateButtonStateFromContentScript();
        manageSelectLabels();
    };

    const updateButtonStateFromContentScript = async () => {
        if (!activeTabId) return;
        try {
            const response = await browser.tabs.sendMessage(activeTabId, { type: 'REQUEST_TRANSLATION_STATUS' });
            if (!response || !response.state) {
                throw new Error("Invalid response from content script.");
            }
            updateTranslateButtonState(response.state);
        } catch (e) {
            // 直接抛出错误，不再回退或重试
            console.error(`[Popup] Failed to get translation status from content script for tab ${activeTabId}:`, e);
            // 在popup中显示错误，而不是静默失败
            // 可以在 popup 中添加一个错误显示区域，并在那里显示错误信息
            // 这里只是一个示例，你需要根据 popup 的实际 UI 结构进行调整
            const errorDisplay = document.getElementById('error-display'); 
            if (errorDisplay) {
                errorDisplay.textContent = `Error: ${e.message}`;
                errorDisplay.style.display = 'block'; // 确保错误信息可见
            } else {
                // 如果没有错误显示区域，则在控制台显示更详细的错误
                console.error("[Popup] No error display area found in popup. Please add an element with id='error-display' to show error messages.");
            }
            throw e; 
        }
    }

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
        if (!activeTabId || elements.translatePageBtn.disabled) return;
        
        // 在处理期间禁用按钮，防止用户快速重复点击
        elements.translatePageBtn.disabled = true;

        const currentState = elements.translatePageBtn.dataset.state;

        try {
            switch (currentState) {
                case 'loading': // 按钮当前是“停止”状态
                    await browser.runtime.sendMessage({ type: 'STOP_TRANSLATION', payload: { tabId: activeTabId } });
                    updateTranslateButtonState('translated'); // 停止后，页面处于（部分）翻译状态
                    break;
                case 'translated': // 按钮当前是“显示原文”状态
                    await browser.runtime.sendMessage({ type: 'REVERT_PAGE_TRANSLATION_REQUEST', payload: { tabId: activeTabId } });
                    updateTranslateButtonState('original'); // 还原后，页面处于原始状态
                    break;
                default: // 'original'，按钮是“翻译此页”状态
                    updateTranslateButtonState('loading'); // 立即更新UI反馈，无需等待
                    browser.runtime.sendMessage({ type: 'INITIATE_PAGE_TRANSLATION', payload: { tabId: activeTabId } });
                    break;
            }
        } catch (error) {
            console.error("[Popup] Error during button click handling:", error);
            // 如果发生错误，尝试从内容脚本重新获取真实状态
            await updateButtonStateFromContentScript();
        } finally {
            // 无论成功与否，都重新启用按钮
            elements.translatePageBtn.disabled = false;
        }
    }

    const initialize = async () => {
        applyTranslations();
        elements.versionDisplay.textContent = `v${browser.runtime.getManifest().version}`;
        await loadAndApplySettings();

        elements.openOptionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());
        elements.translatePageBtn.addEventListener('click', handleTranslateButtonClick);

        elements.autoTranslateCheckbox.addEventListener('change', (e) => saveChangeToRule('autoTranslate', e.target.checked ? 'always' : 'manual'));
        elements.engineSelect.addEventListener('change', (e) => saveChangeToRule('translatorEngine', e.target.value));
        elements.targetLanguageSelect.addEventListener('change', (e) => saveChangeToRule('targetLanguage', e.target.value));
        elements.displayModeSelect.addEventListener('change', async (e) => {
            const newDisplayMode = e.target.value;
            await saveChangeToRule('displayMode', newDisplayMode);
            // 询问页面真实状态，以决定是否需要实时更新显示模式
            try {
                const response = await browser.tabs.sendMessage(activeTabId, { type: 'REQUEST_TRANSLATION_STATUS' });
                // 如果页面处于任何翻译会话中（正在加载或已完成），则发送更新消息
                if (response && (response.state === 'translated' || response.state === 'loading')) {
                    browser.tabs.sendMessage(activeTabId, { type: 'UPDATE_DISPLAY_MODE', payload: { displayMode: newDisplayMode } });
                }
            } catch (error) {
                console.warn(`[Popup] Could not send display mode update. Content script may not be active.`, error.message);
            }
        });

    };
    initialize();
});