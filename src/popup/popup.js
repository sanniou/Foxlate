import browser from '../lib/browser-polyfill.js';
import * as Constants from '../common/constants.js';

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
        subtitleDisplayModeSelect: document.getElementById('subtitleDisplayModeSelect'), // 字幕显示模式选择
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
            case 'translated':
                // 对于“加载中”和“已翻译”两种状态，按钮都应显示“显示原文”。
                // 这是因为“显示原文”是这两种状态下用户的预期操作（中止或还原）。
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

        // (优化) 移除对 GET_VALIDATED_SETTINGS 的冗余调用。
        // getEffectiveSettings 返回的结果 (finalRule) 已经包含了完整的全局设置，
        // 包括 aiEngines 列表。通过消除这次不必要的跨进程通信，可以加快弹窗的加载速度。
        const allSupportedEngines = { ...Constants.SUPPORTED_ENGINES, ...(finalRule.aiEngines || []).reduce((acc, eng) => ({...acc, [`ai:${eng.id}`]: eng.name}), {}) };

        // 使用生效的规则 (finalRule) 填充UI元素
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
            const status = await browser.tabs.sendMessage(activeTabId, { type: 'REQUEST_SUBTITLE_TRANSLATION_STATUS' });
            
            // 如果页面支持字幕翻译，则显示控件。
            // `isSupported` 决定了控件的可见性。
            if (status?.isSupported && finalRule.subtitleSettings?.enabled) {
                elements.subtitleControlsSection.style.display = ''; // 显示控件
                // 使用设置中的显示模式，而不是从内容脚本读取，因为 popup 的显示状态应该由规则控制。
                const displayMode = finalRule.subtitleSettings.displayMode || 'off';
                elements.subtitleDisplayModeSelect.value = displayMode;
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

    /**
     * Helper function to enable or disable all controls related to page translation.
     * @param {boolean} enabled - Whether to enable or disable the controls.
     */
    const setPageControlsEnabled = (enabled) => {
        elements.translatePageBtn.disabled = !enabled;
        elements.displayModeSelect.disabled = !enabled;
        elements.sourceLanguageSelect.disabled = !enabled;
        elements.targetLanguageSelect.disabled = !enabled;
        elements.engineSelect.disabled = !enabled;
        // The auto-translate checkbox also depends on having a valid hostname.
        elements.autoTranslateCheckbox.disabled = !enabled || !currentHostname;
    };

    const updateButtonStateFromContentScript = async () => {
        if (!activeTabId) return;

        const errorDisplay = document.getElementById('error-display');
        
        // Start by assuming failure: disable controls, reset button, and hide error.
        setPageControlsEnabled(false);
        updateTranslateButtonState('original');
        errorDisplay.style.display = 'none';
        
        try {
            const response = await browser.tabs.sendMessage(activeTabId, { type: 'REQUEST_TRANSLATION_STATUS' });

            if (!response || !response.state) {
                throw new Error("Invalid response from content script.");
            }
           
            // Success: Enable controls and update the button with the real state.
            setPageControlsEnabled(true);
            updateTranslateButtonState(response.state);

        } catch (e) {
            // On failure, the controls are already disabled. We just need to show the error.
            if (e.message.includes("Receiving end does not exist")) {
                console.log(`[Popup] Content script not available on this page. Disabling translation controls.`);
                errorDisplay.textContent = browser.i18n.getMessage('popupTranslationNotAvailable') || "Translation is not available on this page.";
            } else {
                console.error(`[Popup] Failed to get translation status from content script for tab ${activeTabId}:`, e);
                errorDisplay.textContent = `Error: ${e.message}`;
            }
            errorDisplay.style.display = 'block';
        }
    };

    const saveChangeToRule = async (key, value) => {
        console.log(`[Popup] Saving rule change: ${key} = ${value}`);
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

        // 动态填充字幕显示模式下拉菜单
        populateSelect(elements.subtitleDisplayModeSelect, Constants.SUBTITLE_DISPLAY_MODES);
        
        // 从全局常量构建弹窗专用的显示模式，并填充下拉菜单
        const popupDisplayModes = Object.fromEntries(
            Object.entries(Constants.DISPLAY_MODES).map(([key, value]) => [key, value.popupKey])
        );
        populateSelect(elements.displayModeSelect, popupDisplayModes);

        await loadAndApplySettings();

        browser.runtime.onMessage.addListener((request) => {
            if (request.type === 'SETTINGS_UPDATED') {
               console.log("[Popup] Received settings update. Reloading.");
                loadAndApplySettings();
            }
       });

        elements.openOptionsBtn.addEventListener('click', () => browser.runtime.openOptionsPage());
        elements.translatePageBtn.addEventListener('click', handleTranslateButtonClick);
        elements.aboutBtn.addEventListener('click', () => browser.tabs.create({ url: 'https://github.com/sanniou/foxlate' }));

        elements.sourceLanguageSelect.addEventListener('change', (e) => saveChangeToRule('sourceLanguage', e.target.value));
        elements.autoTranslateCheckbox.addEventListener('change', async (e) => {
            const isEnabled = e.target.checked;
            const newValue = isEnabled ? 'always' : 'manual';

            // 1. 立即保存规则更改
            await saveChangeToRule('autoTranslate', newValue);

            // 2. 如果启用了自动翻译且页面尚未翻译，则自动开始翻译。
            //    此操作被视为用户手动触发，因此之后关闭此开关不会停止翻译。
            if (isEnabled && elements.translatePageBtn.dataset.state === 'original') {
                await handleTranslateButtonClick();
            }
        });
        elements.engineSelect.addEventListener('change', (e) => saveChangeToRule('translatorEngine', e.target.value));
        elements.targetLanguageSelect.addEventListener('change', (e) => saveChangeToRule('targetLanguage', e.target.value));
        elements.displayModeSelect.addEventListener('change', async (e) => {
            // 逻辑已简化。现在只负责保存设置。
            // 后台脚本将广播 SETTINGS_UPDATED，内容脚本将处理UI更新。
            await saveChangeToRule('displayMode', e.target.value);
        });

        elements.subtitleDisplayModeSelect.addEventListener('change', async (e) => {
            const displayMode = e.target.value;
            // 当用户更改显示模式时，我们只负责保存规则。
            // 保存后，SETTINGS_UPDATED 事件会触发 loadAndApplySettings，
            // 由该函数负责将最新的状态同步到内容脚本，从而避免重复发送消息。
            await saveChangeToRule('subtitleDisplayMode', displayMode);
        });
   };
    initialize();
});