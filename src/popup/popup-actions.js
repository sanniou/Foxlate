import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { SettingsManager } from '../common/settings-manager.js';
import { getHostnameFromUrl } from '../common/url-utils.js';

/**
 * 取当前标签页的主机名。
 *
 * 策略上只认 http(s)：popup 用它展示当前站点规则，对 `chrome://`、`about:` 这类
 * 内部页说“主机名”没有意义（`new URL('chrome://extensions').hostname` 会得到
 * `extensions`，那是错的）。解析本身走共享实现。
 *
 * @param {string} url 标签页 URL
 * @returns {string | null} 主机名；非 http(s) 或无法解析时返回 null
 */
export function getHostname(url) {
    if (!url || !url.startsWith('http')) {
        return null;
    }
    return getHostnameFromUrl(url);
}

export class PopupActions {
    // 用户刚在 popup 里选的显示模式。
    //
    // 保存显示模式会触发 settingsChanged 广播，popup 收到后重新拉一次“服务端真相”并
    // 重绘。如果那次回包的规则还没包含刚保存的字段（或是上一个动作的回包），重绘就会
    // 把用户刚点的分段控件弹回旧值。本地意图在它被回读确认之前优先于迟到的快照。
    #pendingDisplayMode = null;

    // 刷新序号：loadAndApplySettings 会并发（打开 popup 时一次，每次 settingsChanged 再来一次）。
    // 只有最新的那次有权写 DOM，否则慢的旧刷新会把新结果盖掉。
    #refreshSeq = 0;

    constructor({ elements, renderer, state, browserApi = browser, settingsManager = SettingsManager }) {
        this.elements = elements;
        this.renderer = renderer;
        this.state = state;
        this.browser = browserApi;
        this.settingsManager = settingsManager;
    }

    async loadAndApplySettings() {
        const seq = ++this.#refreshSeq;
        const [tab] = await this.browser.tabs.query({ active: true, currentWindow: true });
        if (!tab || seq !== this.#refreshSeq) return;

        this.state.activeTabId = tab.id;
        this.state.currentHostname = getHostname(tab.url);

        const finalRule = await this.browser.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_EFFECTIVE_SETTINGS,
            payload: { hostname: this.state.currentHostname },
        });
        if (seq !== this.#refreshSeq) return;

        this.state.currentRuleSource = finalRule.source;
        this.renderer.renderEffectiveSettings(finalRule);
        this.renderer.renderRuleControls(finalRule, Boolean(this.state.currentHostname));
        await this.#loadSubtitleControls(finalRule);
        if (seq !== this.#refreshSeq) return;
        // 回读到的规则已经包含本地选择时，意图达成，交还控制权给存储。
        if (this.#pendingDisplayMode) {
            if (finalRule.displayMode === this.#pendingDisplayMode) {
                this.#pendingDisplayMode = null;
            } else {
                this.renderer.renderDisplayMode(this.#pendingDisplayMode);
            }
        }
        this.renderer.renderRuleIndicator(this.state.currentRuleSource);
        await this.updateButtonStateFromContentScript();
        if (seq !== this.#refreshSeq) return;
        this.renderer.applyLayout();
    }

    async updateButtonStateFromContentScript() {
        if (!this.state.activeTabId) return;

        this.renderer.setPageControlsEnabled(false, Boolean(this.state.currentHostname));
        this.renderer.renderTranslationButtonState('original');
        this.renderer.renderError(null);

        try {
            const response = await this.browser.tabs.sendMessage(this.state.activeTabId, {
                type: MESSAGE_TYPES.REQUEST_TRANSLATION_STATUS,
            });

            if (!response?.state) {
                throw new Error('Invalid response from content script.');
            }

            this.renderer.setPageControlsEnabled(true, Boolean(this.state.currentHostname));
            this.renderer.renderTranslationButtonState(response.state);

            // Soft notices when a job finished without useful output.
            if (response.state === 'translated' && response.emptyCandidates) {
                this.renderer.renderError(
                    this.browser.i18n.getMessage('popupEmptyCandidates')
                    || 'No translatable text found on this page. Adjust content selectors in Options if needed.',
                );
            } else if (response.state === 'translated' && response.failedCount > 0 && !response.completedCount) {
                // 全部失败：徽标已经变成「!」，这里必须说清「为什么」以及「怎么办」，
                // 否则用户只看到满页红色下划线，会以为是页面本身出了问题。
                this.renderer.renderError(
                    (this.browser.i18n.getMessage('popupTranslationFailed') || 'Every translation failed ({count}). Check the engine configuration.')
                        .replace('{count}', String(response.failedCount)),
                );
            } else if (response.state === 'translated' && response.allPrecheckSkipped) {
                this.renderer.renderError(
                    this.browser.i18n.getMessage('popupAllPrecheckSkipped')
                    || 'Found text, but built-in filters skipped all of it (same language, URLs, code, …).',
                );
            }
        } catch (error) {
            if (error.message.includes('Receiving end does not exist')) {
                // 内容脚本尚未注入，不等于此页不可翻译：后台的 TOGGLE_TRANSLATION_REQUEST
                // 本来就会先补注入再翻译。所以主按钮保持可点，文案说明「点一下即可激活」。
                this.renderer.setTranslateButtonEnabled(true);
                this.renderer.renderError(
                    this.browser.i18n.getMessage('popupNeedsInjection') ||
                    'This page is not active yet — press Translate to activate Foxlate here.',
                );
            } else {
                console.error(`[Popup] Failed to get translation status from content script for tab ${this.state.activeTabId}:`, error);
                this.renderer.renderError(`Error: ${error.message}`);
            }
        }
    }

    async saveChangeToRule(key, value) {
        if (!this.state.currentHostname) {
            console.warn('[Popup] Cannot save rule change, no active hostname.');
            return;
        }

        const domainToUpdate = this.state.currentRuleSource === 'default'
            ? this.state.currentHostname
            : this.state.currentRuleSource;

        await this.settingsManager.saveDomainRuleProperty(domainToUpdate, key, value);
        this.#markSiteRuleActive(domainToUpdate);
    }

    /** After any site-scoped write, surface the hostname as the active rule source. */
    #markSiteRuleActive(domain) {
        if (!domain) return;
        this.state.currentRuleSource = domain;
        this.renderer.renderRuleIndicator(domain);
    }

    async handleTranslateButtonClick() {
        if (!this.state.activeTabId) return;

        try {
            this.elements.translatePageBtn.disabled = true;
            await this.browser.runtime.sendMessage({
                type: MESSAGE_TYPES.TOGGLE_TRANSLATION_REQUEST,
                payload: { tabId: this.state.activeTabId },
            });
        } catch (error) {
            console.error('[Popup] Error during toggle translation request:', error);
            await this.updateButtonStateFromContentScript();
        }
    }

    async handleSwapLanguages() {
        const currentSource = this.elements.sourceLanguageSelect.value;
        const currentTarget = this.elements.targetLanguageSelect.value;

        this.elements.sourceLanguageSelect.value = currentTarget;
        this.elements.targetLanguageSelect.value = currentSource;

        await this.saveChangeToRule('sourceLanguage', currentTarget);
        await this.saveChangeToRule('targetLanguage', currentSource);
    }

    async handleAutoTranslateChange(isEnabled) {
        const newValue = isEnabled ? 'always' : 'manual';
        await this.saveChangeToRule('autoTranslate', newValue);

        if (isEnabled && this.elements.translatePageBtn.dataset.state === 'original') {
            await this.handleTranslateButtonClick();
        }
    }

    async handleDisplayModeChange(displayMode) {
        if (!displayMode) return;

        this.#pendingDisplayMode = displayMode;
        this.renderer.renderDisplayMode(displayMode);
        await this.saveChangeToRule('displayMode', displayMode);

        if (!this.state.activeTabId) return;

        try {
            await this.browser.tabs.sendMessage(this.state.activeTabId, {
                type: MESSAGE_TYPES.UPDATE_DISPLAY_MODE,
                payload: { displayMode },
            });
        } catch (error) {
            if (!error.message.includes('Receiving end does not exist')) {
                console.warn(`[Popup] Could not immediately update display mode on tab ${this.state.activeTabId}:`, error);
            }
        }
    }

    async handleRuntimeMessage(request) {
        if (request.type === MESSAGE_TYPES.SETTINGS_UPDATED || request.type === MESSAGE_TYPES.RELOAD_TRANSLATION_JOB) {
            await this.loadAndApplySettings();
            await this.updateButtonStateFromContentScript();
            return;
        }

        if (request.type === MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE && request.payload.tabId === this.state.activeTabId) {
            this.renderer.setPageControlsEnabled(true, Boolean(this.state.currentHostname));
            await this.updateButtonStateFromContentScript();
        }
    }

    async #loadSubtitleControls(finalRule) {
        this.renderer.hideSubtitleControls();

        try {
            const status = await this.browser.tabs.sendMessage(this.state.activeTabId, {
                type: MESSAGE_TYPES.REQUEST_SUBTITLE_TRANSLATION_STATUS,
            });
            this.renderer.renderSubtitleControls({
                isSupported: Boolean(status?.isSupported),
                settings: finalRule,
            });
        } catch (error) {
            if (!error.message.includes('Receiving end does not exist')) {
                console.warn('[Popup] Could not get subtitle translation status from content script. Keeping subtitle control hidden.', error);
            }
        }
    }
}
