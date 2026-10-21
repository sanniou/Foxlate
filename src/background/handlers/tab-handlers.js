import { MESSAGE_TYPES } from '../../common/message-types.js';
import * as Constants from '../../common/constants.js';

/**
 * 标签页 / 界面状态类消息处理器。
 * 这一组同时面向 content script（状态上报、注入）与 popup（切换翻译、切换显示模式）。
 */
export function createTabHandlers({
    browserApi,
    settingsManager,
    translatorManager,
    tabStateManager,
    ensureScriptsInjected,
    setBadgeAndState,
    logError,
    cssFiles,
    coreScriptFiles,
}) {
    return {
        async [MESSAGE_TYPES.TOGGLE_TRANSLATION_REQUEST](request) {
            const { tabId } = request.payload;
            const scriptsReady = await ensureScriptsInjected(tabId, 0, [...cssFiles, ...coreScriptFiles]);
            if (!scriptsReady) {
                await setBadgeAndState(tabId, 'original');
                throw new Error(`Failed to inject scripts into tab ${tabId}.`);
            }
            await browserApi.tabs.sendMessage(tabId, {
                type: MESSAGE_TYPES.TOGGLE_TRANSLATION_REQUEST_AT_CONTENT,
                payload: { tabId },
            });
            return { success: true };
        },

        async [MESSAGE_TYPES.TOGGLE_DISPLAY_MODE](request) {
            const { tabId, hostname } = request.payload;
            if (!tabId || !hostname) throw new Error('Missing tabId or hostname for TOGGLE_DISPLAY_MODE');

            const displayModes = Object.keys(Constants.DISPLAY_MODES);
            const effectiveSettings = await settingsManager.getEffectiveSettings(hostname);
            const currentIndex = displayModes.indexOf(effectiveSettings.displayMode);
            const newMode = displayModes[(currentIndex + 1) % displayModes.length];

            await settingsManager.saveDomainRuleProperty(
                effectiveSettings.source === 'default' ? hostname : effectiveSettings.source,
                'displayMode',
                newMode
            );

            try {
                await browserApi.tabs.sendMessage(tabId, {
                    type: MESSAGE_TYPES.UPDATE_DISPLAY_MODE,
                    payload: { displayMode: newMode },
                });
            } catch (error) {
                if (!error.message.includes('Receiving end does not exist')) {
                    logError('TOGGLE_DISPLAY_MODE (sending update)', error);
                }
            }

            return { success: true, newMode };
        },

        async [MESSAGE_TYPES.UPDATE_SUBTITLE_TRANSLATION_STATUS](request) {
            const { tabId, enabled } = request.payload;
            try {
                await browserApi.action.setIcon({ tabId, path: enabled ? 'icons/icon48.png' : 'icons/icon48-disabled.png' });
                // 工具栏提示是用户可见文案，必须走本地化；写死英文会让 zh_CN 用户看到英文。
                await browserApi.action.setTitle({
                    tabId,
                    title: browserApi.i18n.getMessage(enabled ? 'subtitleToolbarTitleEnabled' : 'subtitleToolbarTitleDisabled'),
                });
            } catch (error) {
                logError('UPDATE_SUBTITLE_TRANSLATION_STATUS', error);
            }
            return { success: true };
        },

        async [MESSAGE_TYPES.STOP_TRANSLATION]() {
            await translatorManager.interruptAll();
            return { success: true };
        },

        async [MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE](request, sender) {
            const { status, tabId, emptyCandidates = false } = request.payload || {};
            if (!tabId) {
                logError('TRANSLATION_STATUS_UPDATE', new Error('Missing tabId in status update payload.'));
                return { success: true };
            }

            await setBadgeAndState(tabId, status, { emptyCandidates: Boolean(emptyCandidates) });
            if (sender.tab?.url) {
                try {
                    const hostname = new URL(sender.tab.url).hostname;
                    if (status === 'translated' || status === 'loading') {
                        await tabStateManager.registerTabForAutoTranslation(tabId, hostname);
                    } else if (status === 'original') {
                        await tabStateManager.unregisterTabForAutoTranslation(tabId);
                    }
                } catch (error) {
                    logError('TRANSLATION_STATUS_UPDATE (session management)', error);
                }
            }
            return { success: true };
        },

        [MESSAGE_TYPES.PING]() {
            return { status: 'PONG' };
        },

        [MESSAGE_TYPES.GET_TAB_ID](_request, sender) {
            if (sender.tab) {
                return Promise.resolve({ tabId: sender.tab.id });
            }
            return browserApi.tabs.query({ active: true, currentWindow: true }).then(([tab]) => ({ tabId: tab?.id }));
        },
    };
}
