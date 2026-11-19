import { MESSAGE_TYPES } from '../../common/message-types.js';
import * as Constants from '../../common/constants.js';
import { sendMessageToContent } from '../tab-messaging.js';

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
    ensureSummaryInjected,
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
            await sendMessageToContent({
                browserApi,
                tabId,
                message: {
                    type: MESSAGE_TYPES.TOGGLE_TRANSLATION_REQUEST_AT_CONTENT,
                    payload: { tabId },
                },
            });
            return { success: true };
        },

        /**
         * 摘要模块按需注入。
         *
         * 内容运行时在页面翻译开始/设置更新时发这条消息，但**是否真的注入**由后台
         * 按该站点的 `summarySettings.enabled` 判定——判据留在后台，内容侧不需要
         * 再解释一遍布局规则。tabId 取 sender 而不是 payload：请求方永远是自己所属
         * 的那个标签页，让内容侧自报 tabId 只是给伪造留缝。
         */
        async [MESSAGE_TYPES.ENSURE_SUMMARY_MODULE](request, sender) {
            const tabId = sender?.tab?.id;
            if (!tabId) {
                return { success: false, error: 'missing-sender-tab' };
            }
            const injected = await ensureSummaryInjected(tabId, {
                hostname: request.payload?.hostname,
                enabled: request.payload?.enabled,
            });
            return { success: true, injected };
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
                await sendMessageToContent({
                    browserApi,
                    tabId,
                    message: {
                        type: MESSAGE_TYPES.UPDATE_DISPLAY_MODE,
                        payload: { displayMode: newMode },
                    },
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

        async [MESSAGE_TYPES.STOP_TRANSLATION](request) {
            const tabId = request?.payload?.tabId;
            if (tabId === undefined || tabId === null) {
                // 没有作用域信息时宁可不中断任何一个，也不越权停掉全部。
                logError('STOP_TRANSLATION', new Error('Missing tabId in STOP_TRANSLATION payload.'));
                return { success: false, error: 'missing-tab-id' };
            }
            translatorManager.interruptTab(tabId);
            return { success: true };
        },

        async [MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE](request, sender) {
            const {
                status,
                tabId,
                emptyCandidates = false,
                failedCount = 0,
                completedCount = 0,
            } = request.payload || {};
            if (!tabId) {
                logError('TRANSLATION_STATUS_UPDATE', new Error('Missing tabId in status update payload.'));
                return { success: true };
            }

            await setBadgeAndState(tabId, status, {
                emptyCandidates: Boolean(emptyCandidates),
                failedCount: Number(failedCount) || 0,
                completedCount: Number(completedCount) || 0,
            });
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
