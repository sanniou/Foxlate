import '/lib/browser-polyfill.js'; 
import * as Constants from '/common/constants.js';

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
        enableSubtitlesCheckbox: document.getElementById('enableSubtitles'), // 新增：字幕开关
        subtitleControlsSection: document.querySelector('.subtitle-controls'),
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

        // 移除所有可能的状态类，仅依赖 data-state
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

        currentHostname = getHostname(tab.url);
        const finalRule = await browser.runtime.sendMessage({
            type: 'GET_EFFECTIVE_SETTINGS',
            payload: { hostname: currentHostname }
        });

        // The 'source' property is now reliably provided by getEffectiveSettings.
        currentRuleSource = finalRule.source;

        // Populate UI elements using the effective rule (finalRule)
        const globalSettings = await browser.runtime.sendMessage({ type: 'GET_VALIDATED_SETTINGS' });
        const allSupportedEngines = { ...Constants.SUPPORTED_ENGINES, ...(globalSettings.aiEngines || []).reduce((acc, eng) => ({...acc, [`ai:${eng.id}`]: eng.name}), {}) };
        populateSelect(elements.engineSelect, allSupportedEngines, finalRule.translatorEngine);
        populateSelect(elements.sourceLanguageSelect, Constants.SUPPORTED_LANGUAGES, finalRule.sourceLanguage);
        const targetLangs = { ...Constants.SUPPORTED_LANGUAGES };
        delete targetLangs.auto;
        populateSelect(elements.targetLanguageSelect, targetLangs, finalRule.targetLanguage);
        elements.displayModeSelect.value = finalRule.displayMode;

        elements.autoTranslateCheckbox.disabled = !currentHostname;
        elements.autoTranslateCheckbox.checked = finalRule.autoTranslate === 'always';
        
        // --- 字幕控件可见性逻辑 ---
        // 默认隐藏。只有当内容脚本在一个支持的页面（YouTube）上确认
        // 它处于一个视频观看页面时，才会显示它。
        elements.subtitleControlsSection.style.display = 'none';

        // 无论域名如何，都尝试从内容脚本获取字幕状态。
        // 内容脚本中的 SubtitleManager 将知道当前页面是否支持字幕。
        try {
            const response = await browser.tabs.sendMessage(activeTabId, { type: 'REQUEST_SUBTITLE_TRANSLATION_STATUS' });
            // 仅当内容脚本确认它在一个支持的页面上时（!response.disabled），才显示控件。
            if (response && !response.disabled) {
                elements.subtitleControlsSection.style.display = ''; // 显示该部分

                // 加载已保存的设置为开关的默认状态。
                const { subtitleTranslationEnabled = true } = finalRule;
                elements.enableSubtitlesCheckbox.checked = subtitleTranslationEnabled;

                // 来自内容脚本的实时“启用”状态会覆盖已保存的设置以用于UI显示。
                if (response.enabled !== undefined) {
                    elements.enableSubtitlesCheckbox.checked = response.enabled;
                }
                
                // 因为我们已经检查了 !response.disabled，所以开关应该是可用的。
                elements.enableSubtitlesCheckbox.disabled = false;
            }
        } catch (e) {
            // 如果无法与内容脚本通信（例如，在 about:blank 或受限制的页面上），
            // 这很正常。保持控件隐藏即可。
            if (!e.message.includes("Receiving end does not exist")) {
                 console.warn("[Popup] Could not get subtitle translation status from content script. Keeping subtitle control hidden.", e);
            }
        }

        if (currentRuleSource === 'default') {
            elements.currentRuleIndicator.textContent = browser.i18n.getMessage('popupRuleDefault') || 'Using default settings';
        } else {
            // Keep the UI clean by only showing the domain.
            elements.currentRuleIndicator.textContent = currentRuleSource;
        }

        await updateButtonStateFromContentScript();
        manageSelectLabels();
    };

    const updateButtonStateFromContentScript = async () => {
        if (!activeTabId) return;

        const errorDisplay = document.getElementById('error-display');
        errorDisplay.style.display = 'none'; // Hide error by default

        try {
            const response = await browser.tabs.sendMessage(activeTabId, { type: 'REQUEST_TRANSLATION_STATUS' });

            // This check handles cases where the content script is present but sends a malformed response.
            if (!response || !response.state) {
                throw new Error("Invalid response from content script.");
            }
           
            // Success: update button and ensure controls are enabled.
            updateTranslateButtonState(response.state);
            elements.translatePageBtn.disabled = false;
            elements.displayModeSelect.disabled = false;
            elements.sourceLanguageSelect.disabled = false;
            elements.targetLanguageSelect.disabled = false;
            elements.engineSelect.disabled = false;
           // Re-enable the switch if a hostname is present (which it should be if content script exists)
            elements.autoTranslateCheckbox.disabled = !currentHostname;

        } catch (e) {
            // This catch block now handles all failures to communicate or get a valid response.

            // Default to original state visually.
            updateTranslateButtonState('original');
            // Disable controls that depend on the content script.
            elements.translatePageBtn.disabled = true;
            elements.displayModeSelect.disabled = true;
            elements.sourceLanguageSelect.disabled = true;
            elements.targetLanguageSelect.disabled = true;
            elements.engineSelect.disabled = true;
           elements.autoTranslateCheckbox.disabled = true;

            // Check for the specific, expected error on restricted pages.
            if (e.message.includes("Receiving end does not exist")) {
                console.log(`[Popup] Content script not available on this page. Disabling translation controls.`);
                errorDisplay.textContent = browser.i18n.getMessage('popupTranslationNotAvailable') || "Translation is not available on this page.";
            } else {
                // Handle other, unexpected errors.
                console.error(`[Popup] Failed to get translation status from content script for tab ${activeTabId}:`, e);
                errorDisplay.textContent = `Error: ${e.message}`;
            }
            errorDisplay.style.display = 'block';
        }
    }

    const saveChangeToRule = async (key, value) => {
        if (!currentHostname) {
            console.warn("[Popup] Cannot save rule change, no active hostname.");
            return;
        }
        await browser.runtime.sendMessage({
            type: 'SAVE_RULE_CHANGE',
            payload: { hostname: currentHostname, ruleSource: currentRuleSource, key, value }
        });
        // The settings will be reloaded automatically via the SETTINGS_UPDATED event listener.
    };

    async function handleTranslateButtonClick() {
        if (!activeTabId || elements.translatePageBtn.disabled) return;
        
        // 在处理期间禁用按钮，防止用户快速重复点击
        elements.translatePageBtn.disabled = true;

        // 为了更好的用户体验，对“原始”状态进行乐观的 UI 更新。
        if (elements.translatePageBtn.dataset.state === 'original') {
            updateTranslateButtonState('loading');
        }

        try {
            // 总是发送相同的切换请求。Service Worker 和 Content Script
            // 将根据页面的实际状态决定正确的操作。
            await browser.runtime.sendMessage({
                type: 'TOGGLE_TRANSLATION_REQUEST',
                payload: { tabId: activeTabId }
            });
            // 请求操作后，再次查询内容脚本以获取最新的、权威的状态。
            // 此函数还将处理按钮的启用/禁用状态。
            await updateButtonStateFromContentScript();
        } catch (error) {
            console.error("[Popup] Error during toggle translation request:", error);
            // 如果发生错误，尝试从内容脚本重新获取真实状态
            await updateButtonStateFromContentScript();
        }
    }

    const initialize = async () => {
        applyTranslations();
        elements.versionDisplay.textContent = `v${browser.runtime.getManifest().version}`;
        await loadAndApplySettings();

        browser.runtime.onMessage.addListener((request) => {
            if (request.type === 'SETTINGS_UPDATED') {
               console.log("[Popup] Received settings update. Reloading.");
                loadAndApplySettings();
            }
       });

        elements.openOptionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());
        elements.translatePageBtn.addEventListener('click', handleTranslateButtonClick);

        elements.sourceLanguageSelect.addEventListener('change', (e) => saveChangeToRule('sourceLanguage', e.target.value));
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

        // 初始化字幕开关事件监听
        elements.enableSubtitlesCheckbox.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            // 1.  通知 content script 更新状态
            try {
                await browser.tabs.sendMessage(activeTabId, {
                    type: 'TOGGLE_SUBTITLE_TRANSLATION',
                    payload: { enabled }
                });
            } catch (error) {
                console.error("[Popup] Error toggling subtitle translation in content script:", error);
                // 状态同步失败，可以考虑弹窗提示用户
                // alert("Failed to update subtitle translation status in the page.");
                // 或者回滚 UI 状态
                e.target.checked = !enabled;
            }
            // 2.  （可选）同时更新全局设置，这样新打开的 YouTube 页面会使用相同的状态
            await saveChangeToRule('subtitleTranslationEnabled', enabled);
        });

    };
    initialize();
});