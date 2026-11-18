import { MESSAGE_TYPES } from '../common/message-types.js';
import { SettingsManager } from '../common/settings-manager.js';

export function createNavigationHandler({
    browserApi,
    ensureScriptsInjected,
    handleSubtitleInjection,
    tabStateManager,
    logError,
    interruptTab = null,
    settingsManager = SettingsManager,
    cssFiles,
    coreScriptFiles,
}) {
    return async function handleNavigation(details, { documentReplaced = false } = {}) {
        const { tabId, url, frameId } = details;
        if (!url || !url.startsWith('http')) return;

        if (frameId === 0 && documentReplaced) {
            // 顶层文档被替换：上一份文档的注入记录与翻译状态全部失效（子框架同理）。
            // 不做这件事的话，同一标签页的第二次导航会一直落在「已注入」的陈旧记录上。
            //
            // 同时中断这个标签页上还在跑的翻译作业：旧文档已经消失，继续排队只会在
            // 发结果时撞上「Receiving end does not exist」，而 AI 引擎那边照样按量计费。
            interruptTab?.(tabId);
            await tabStateManager.resetTabDocumentState(tabId);
            try {
                await browserApi.action.setBadgeText({ tabId, text: '' });
            } catch (error) {
                logError(`handleNavigation (reset badge) for ${url}`, error);
            }
        }

        if (frameId === 0) {
            const coreScriptsReady = await ensureScriptsInjected(tabId, frameId, [...cssFiles, ...coreScriptFiles]);
            if (!coreScriptsReady) {
                logError(`handleNavigation for ${url}`, new Error('Failed to inject core scripts. Aborting further actions.'));
                return;
            }

            try {
                const hostname = new URL(url).hostname;
                const effectiveRule = await settingsManager.getEffectiveSettings(hostname);
                const isSessionTranslate = await tabStateManager.isTabRegisteredForAutoTranslation(tabId, hostname);

                if (effectiveRule.autoTranslate === 'always' || isSessionTranslate) {
                    console.log(`[Auto-Translate] Rule matched for '${hostname}'. Initiating translation for tab ${tabId}.`);
                    await browserApi.tabs.sendMessage(tabId, {
                        type: MESSAGE_TYPES.TRANSLATE_PAGE_REQUEST,
                        payload: { tabId },
                    });
                }
            } catch (error) {
                logError(`handleNavigation (auto-translate) for ${url}`, error);
            }
        }

        await handleSubtitleInjection(tabId, frameId, url);
    };
}
