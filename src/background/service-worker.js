import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { SettingsManager } from '../common/settings-manager.js';
import { TranslatorManager } from '../background/translator-manager.js';
import TabStateManager from './tab-state-manager.js';
import { createEnsureScriptsInjected } from './script-injector.js';
import { CORE_SCRIPT_FILES, CSS_FILES } from './background-constants.js';
import { logBackgroundError } from './background-logger.js';
import { setBadgeAndState } from './badge-state.js';
import { createBackgroundMessageHandlers } from './background-message-handlers.js';
import { createCloudBackupStore } from './cloud-backup-store.js';
import { createNavigationHandler } from './navigation-handler.js';
import { createSelectionTranslationHandler } from './selection-translation.js';
import { createSubtitleInjector } from './subtitle-injection.js';

const ensureScriptsInjected = createEnsureScriptsInjected({
    browserApi: browser,
    tabStateManager: TabStateManager,
    logError: logBackgroundError,
});

const updateBadgeAndState = (tabId, state, options) => setBadgeAndState({
    browserApi: browser,
    tabStateManager: TabStateManager,
}, tabId, state, options);

const cloudBackups = createCloudBackupStore({
    browserApi: browser,
    logError: logBackgroundError,
});

const handleSubtitleInjection = createSubtitleInjector({
    ensureScriptsInjected,
    logError: logBackgroundError,
});

const handleSelectionTranslation = createSelectionTranslationHandler({
    browserApi: browser,
    ensureScriptsInjected,
    logError: logBackgroundError,
    cssFiles: CSS_FILES,
    coreScriptFiles: CORE_SCRIPT_FILES,
});

const messageHandlers = createBackgroundMessageHandlers({
    browserApi: browser,
    settingsManager: SettingsManager,
    translatorManager: TranslatorManager,
    tabStateManager: TabStateManager,
    ensureScriptsInjected,
    setBadgeAndState: updateBadgeAndState,
    cloudBackups,
    logError: logBackgroundError,
    cssFiles: CSS_FILES,
    coreScriptFiles: CORE_SCRIPT_FILES,
});

const handleNavigation = createNavigationHandler({
    browserApi: browser,
    ensureScriptsInjected,
    handleSubtitleInjection,
    tabStateManager: TabStateManager,
    logError: logBackgroundError,
    cssFiles: CSS_FILES,
    coreScriptFiles: CORE_SCRIPT_FILES,
});

browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
        id: 'translate-selection',
        title: browser.i18n.getMessage('contextMenuTitle'),
        contexts: ['selection'],
    });
    console.log('Context menu created.');
});

browser.commands.onCommand.addListener(async (command, tab) => {
    if (!tab?.id) return;

    if (command === 'translate-selection') {
        handleSelectionTranslation(tab, 'shortcut');
        return;
    }

    if (command === 'toggle-translation') {
        if (isProtectedTab(tab)) {
            console.log(`[Foxlate] Command '${command}' ignored on protected page: ${tab?.url}`);
            return;
        }

        try {
            await messageHandlers[MESSAGE_TYPES.TOGGLE_TRANSLATION_REQUEST]({ payload: { tabId: tab.id } });
        } catch (error) {
            logBackgroundError('onCommand (toggle-translation)', error);
        }
        return;
    }

    if (command === 'toggle-display-mode') {
        if (isProtectedTab(tab)) {
            console.log(`[Foxlate] Command '${command}' ignored on protected page: ${tab?.url}`);
            return;
        }

        try {
            await messageHandlers[MESSAGE_TYPES.TOGGLE_DISPLAY_MODE]({
                payload: { tabId: tab.id, hostname: new URL(tab.url).hostname },
            });
        } catch (error) {
            logBackgroundError('onCommand (toggle-display-mode)', error);
        }
        return;
    }

    if (command === 'toggle-summary') {
        if (isProtectedTab(tab)) {
            console.log(`[Foxlate] Command '${command}' ignored on protected page: ${tab?.url}`);
            return;
        }

        try {
            const scriptsReady = await ensureScriptsInjected(tab.id, 0, [...CSS_FILES, ...CORE_SCRIPT_FILES]);
            if (!scriptsReady) {
                logBackgroundError('onCommand (toggle-summary)', new Error(`Failed to inject scripts into tab ${tab.id}.`));
                return;
            }

            await browser.tabs.sendMessage(tab.id, {
                type: MESSAGE_TYPES.TOGGLE_SUMMARY_REQUEST,
                payload: { tabId: tab.id },
            });
        } catch (error) {
            logBackgroundError('onCommand (toggle-summary)', error);
        }
    }
});

browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'translate-selection') {
        handleSelectionTranslation(tab, 'contextMenu', info.frameId);
    }
});

browser.runtime.onMessage.addListener((request, sender) => {
    if (globalThis.__DEBUG__) {
        console.log(`[Service Worker] Received message: ${JSON.stringify(request)}`);
    }

    const handler = messageHandlers[request.type];
    if (!handler) {
        console.warn(`No handler found for message type: ${request.type}`);
        return Promise.resolve();
    }

    return handler(request, sender).catch(error => {
        logBackgroundError(`onMessage Listener (request type: ${request.type})`, error);
        return { success: false, error: 'An unexpected error occurred in the service worker.' };
    });
});

browser.webNavigation.onCompleted.addListener(handleNavigation, { url: [{ schemes: ['http', 'https'] }] });
browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation, { url: [{ schemes: ['http', 'https'] }] });

SettingsManager.on('settingsChanged', async ({ newValue, oldValue }) => {
    const criticalKeys = [
        'targetLanguage',
        'translatorEngine',
        'precheckRules',
        'translationSelector',
        'deeplxApiUrl',
        'aiEngines',
    ];

    const needsReTranslation = shouldReloadTranslationJob({ oldValue, newValue, criticalKeys });
    const messageType = needsReTranslation ? MESSAGE_TYPES.RELOAD_TRANSLATION_JOB : MESSAGE_TYPES.SETTINGS_UPDATED;
    if (globalThis.__DEBUG__) {
        console.log(`[Service Worker] Settings changed. Notifying content scripts with '${messageType}'.`);
    }

    const activeTabIds = await TabStateManager.getActiveTabIds();
    for (const tabId of activeTabIds) {
        browser.tabs.sendMessage(tabId, { type: messageType, payload: { newValue } }).catch(error => {
            if (!error.message.includes('Receiving end does not exist')) {
                logBackgroundError('settingsChanged listener (notify tab)', error);
            }
        });
    }

    browser.runtime.sendMessage({ type: messageType, payload: { newValue, oldValue } }).catch(() => {});
    TranslatorManager.updateConcurrencyLimit();
    TranslatorManager.updateCacheSize();
});

function isProtectedTab(tab) {
    return !tab?.id ||
        !tab.url ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('moz-extension:') ||
        tab.url.startsWith('chrome:');
}

function shouldReloadTranslationJob({ oldValue, newValue, criticalKeys }) {
    if (!oldValue || !newValue) return true;

    return criticalKeys.some(key => {
        const hasChanged = JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key]);
        if (hasChanged && globalThis.__DEBUG__) {
            console.log(`[Foxlate] Critical setting '${key}' changed. Page re-translation required.`);
        }
        return hasChanged;
    });
}
