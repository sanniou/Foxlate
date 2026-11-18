import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { shouldReloadTranslationJob } from './settings-reload-policy.js';
import { SettingsManager } from '../common/settings-manager.js';
import { TranslatorManager } from '../background/translator-manager.js';
import TabStateManager from './tab-state-manager.js';
import { createEnsureScriptsInjected } from './script-injector.js';
import { CORE_SCRIPT_FILES, CSS_FILES } from './background-constants.js';
import { logBackgroundError } from './background-logger.js';
import { setBadgeAndState } from './badge-state.js';
import { createBackgroundMessageHandlers } from './background-message-handlers.js';
import { CloudBackupStore } from './cloud-backup-store.js';
import { createNavigationHandler } from './navigation-handler.js';
import { createSelectionTranslationHandler } from './selection-translation.js';
import { createSubtitleInjector } from './subtitle-injection.js';
import { createSummaryInjector } from './summary-injection.js';

const ensureScriptsInjected = createEnsureScriptsInjected({
    browserApi: browser,
    tabStateManager: TabStateManager,
    logError: logBackgroundError,
});

const updateBadgeAndState = (tabId, state, options) => setBadgeAndState({
    browserApi: browser,
    tabStateManager: TabStateManager,
}, tabId, state, options);

const cloudBackups = new CloudBackupStore({
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

const ensureSummaryInjected = createSummaryInjector({
    ensureScriptsInjected,
    logError: logBackgroundError,
});

const messageHandlers = createBackgroundMessageHandlers({
    browserApi: browser,
    settingsManager: SettingsManager,
    translatorManager: TranslatorManager,
    tabStateManager: TabStateManager,
    ensureScriptsInjected,
    ensureSummaryInjected,
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
    interruptTab: tabId => TranslatorManager.interruptTab(tabId),
    cssFiles: CSS_FILES,
    coreScriptFiles: CORE_SCRIPT_FILES,
});

// 标签页关闭：这个标签页上排队/在跑的翻译作业再也没有接收方，
// 不中断的话它们会继续消耗 AI 配额，然后死在 sendMessage 上。
browser.tabs.onRemoved.addListener(tabId => {
    TranslatorManager.interruptTab(tabId);
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
            // 只要摘要包：快捷键就是「现在就要摘要」，所以 force，不看站点开关。
            // 核心内容脚本不必注入——摘要包自己注册监听，它不依赖页面翻译。
            const scriptsReady = await ensureSummaryInjected(tab.id, { force: true });
            if (!scriptsReady) {
                logBackgroundError('onCommand (toggle-summary)', new Error(`Failed to inject summary module into tab ${tab.id}.`));
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

// `onCompleted` 意味着顶层文档已被替换（旧记录必须失效）；
// `onHistoryStateUpdated` 是 SPA 路由，仍是同一个文档与同一份注入记录。
browser.webNavigation.onCompleted.addListener(
    details => handleNavigation(details, { documentReplaced: true }),
    { url: [{ schemes: ['http', 'https'] }] },
);
browser.webNavigation.onHistoryStateUpdated.addListener(
    details => handleNavigation(details),
    { url: [{ schemes: ['http', 'https'] }] },
);

SettingsManager.on('settingsChanged', async ({ newValue, oldValue }) => {
    const criticalKeys = [
        'targetLanguage',
        'translatorEngine',
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
            if (!error?.message?.includes('Receiving end does not exist')) {
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
