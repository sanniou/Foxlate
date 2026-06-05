import { MESSAGE_TYPES } from '../common/message-types.js';
import { SettingsManager } from '../common/settings-manager.js';

export function createNavigationHandler({
    browserApi,
    ensureScriptsInjected,
    handleSubtitleInjection,
    tabStateManager,
    logError,
    settingsManager = SettingsManager,
    cssFiles,
    coreScriptFiles,
}) {
    return async function handleNavigation(details) {
        const { tabId, url, frameId } = details;
        if (!url || !url.startsWith('http')) return;

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
