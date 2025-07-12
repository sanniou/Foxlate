
import '../lib/browser-polyfill.js';
import { getEffectiveSettings, getValidatedSettings } from '../common/settings-manager.js';
import { TranslatorManager } from '../background/translator-manager.js';
import * as Constants from '../common/constants.js';
import { AITranslator } from '../background/translators/ai-translator.js';
import { SUBTITLE_STRATEGIES, SUBTITLE_MANAGER_SCRIPT, DEFAULT_STRATEGY_MAP } from '../content/subtitle/strategy-manifest.js';
const CSS_FILES = ["content/style.css"];

const CORE_SCRIPT_FILES = ["content/content-script.js"];

// --- Dynamically build strategy maps from the manifest ---
// We create these Maps at startup for performance. Map lookups (O(1)) are much faster
// than searching an array (O(n)) on every navigation event.
const STRATEGY_FILE_MAP = new Map(
    SUBTITLE_STRATEGIES.map(strategy => [strategy.name, strategy.file])
);

/**
 * Centralized error logger.
 * @param {string} context - The context in which the error occurred.
 * @param {Error} error - The error object.
 */
function logError(context, error) {
    if (error instanceof Error) {
        if (error.message.includes("interrupted")) {
            console.log(`[Foxlate] Task interrupted in ${context}.`);
            return;
        }
        console.error(`[Foxlate Error] in ${context}:`, error.message, error.stack);
    } else {
        console.error(`[Foxlate Error] in ${context}:`, error || 'An unknown error occurred.');
    }
}

/**
 * Registers a hostname for automatic translation within a specific tab for the current session.
 * @param {number} tabId The ID of the tab.
 * @param {string} hostname The hostname to register for the tab.
 */
async function registerSessionTranslation(tabId, hostname) {
    if (!tabId || !hostname) return;
    const { sessionTabTranslations = {} } = await browser.storage.session.get('sessionTabTranslations');
    if (sessionTabTranslations[tabId] !== hostname) {
        sessionTabTranslations[tabId] = hostname;
        await browser.storage.session.set({ sessionTabTranslations });
        console.log(`[Foxlate Session] Registered ${hostname} for auto-translation in tab ${tabId}.`);
    }
}

/**
 * UnRegisters a tab from session-based automatic translation.
 * @param {number} tabId The ID of the tab to unregister.
 */
async function unregisterSessionTranslation(tabId) {
    if (!tabId) return;
    const { sessionTabTranslations = {} } = await browser.storage.session.get('sessionTabTranslations');
    if (sessionTabTranslations[tabId]) {
        delete sessionTabTranslations[tabId];
        await browser.storage.session.set({ sessionTabTranslations });
        console.log(`[Foxlate Session] Unregistered auto-translation for tab ${tabId}.`);
    }
}
/**
 * Ensures specific content scripts are injected and ready in a given frame of a tab.
 * Uses session storage to track injected scripts and prevent re-injection.
 * @param {number} tabId The ID of the tab.
 * @param {number} frameId The ID of the frame within the tab.
 * @param {string[]} scriptsToInject An array of script file paths to inject.
 * @returns {Promise<boolean>} True if scripts are ready or successfully injected, false otherwise.
 */
async function ensureScriptsInjected(tabId, frameId, scriptsToInject) {
    if (!scriptsToInject || scriptsToInject.length === 0) {
        return true; // Nothing to inject.
    }

    try {
        // 1. 检查 CSS 是否已注入 (假设 content_script 注入后会设置一个全局变量)
        let cssInjected = false;
        try {
            const result = await browser.scripting.executeScript({
                target: { tabId, frameIds: [frameId] },
                // 确保这个变量名与 content_script 中实际设置的全局变量名一致
                func: () => window.__foxlate_css_injected === true
            });
            cssInjected = result[0]?.result === true;
        } catch (e) { /* 忽略错误，说明 content script 可能未注入，或全局变量不存在 */ }

        if (!cssInjected) {
            await browser.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, files: CSS_FILES });
            // 如果你希望能够检查 CSS 注入状态，可以在 content_script 中设置一个全局变量
            await browser.scripting.executeScript({
                target: { tabId, frameIds: [frameId] },
                func: () => { window.__foxlate_css_injected = true; }
            });
        }

        // 2. 注入脚本 (无需检查是否已注入，直接注入，利用浏览器机制避免重复注入)
        await browser.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            files: scriptsToInject
        });

        // 如果 content-script.js 是此次注入的一部分，确保 tabId 已注入
        if (frameId === 0 && scriptsToInject.includes("content/content-script.js")) {
            await browser.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: (tabId) => { window.__foxlate_tabId = tabId; }, args: [tabId] });
        }
        return true;
    } catch (error) {
        logError(`ensureScriptsInjected for tab ${tabId}, frame ${frameId}`, new Error(`Failed to inject scripts. This can happen on special pages (e.g., chrome://). Error: ${error.message}`));
        return false;
    }
}

// --- Subtitle Strategy Injection Logic ---

/**
 * Handles the logic for injecting subtitle strategies based on user and default rules.
 * @param {number} tabId - The ID of the tab.
 * @param {object} changeInfo - Information about the tab update.
 * @param {object} tab - The tab object itself.
 */
async function handleSubtitleInjection(tabId, frameId, url) {
    // 只在主框架且有有效 URL 时执行
    if (frameId !== 0 || !url || !url.startsWith('http')) {
        return;
    }

    try {
        const currentUrl = new URL(url);
        const hostname = currentUrl.hostname;

        const settings = await getValidatedSettings();
        const userRules = settings.domainRules || {};

        let strategyToInject = null;

        // 1. 检查用户规则
        if (userRules[hostname] && userRules[hostname].subtitleStrategy) {
            const userChoice = userRules[hostname].subtitleStrategy;
            if (userChoice !== 'none') {
                strategyToInject = userChoice;
            } else {
                console.log(`[Subtitle Injector] User has disabled subtitle translation for ${hostname}.`);
                return; // 用户明确禁用了
            }
        } else {
            // 2. 检查默认规则
            if (DEFAULT_STRATEGY_MAP.has(hostname)) {
                strategyToInject = DEFAULT_STRATEGY_MAP.get(hostname);
            }
        }

        // 3. 如果找到策略，则注入
        if (strategyToInject) {
            const scriptFile = STRATEGY_FILE_MAP.get(strategyToInject);
            if (scriptFile) {
                console.log(`[Subtitle Injector] Rule matched. Attempting to inject strategy '${strategyToInject}' for ${hostname}.`);
                // 使用统一的注入函数
                await ensureScriptsInjected(tabId, frameId, [SUBTITLE_MANAGER_SCRIPT, scriptFile]);
            } else {
                logError('handleSubtitleInjection', new Error(`Strategy '${strategyToInject}' is defined but no script file was found.`));
            }
        }
    } catch (error) {
        logError('handleSubtitleInjection', error);
    }
}

// --- Context Menu Setup ---
browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
        id: "translate-selection",
        title: browser.i18n.getMessage("contextMenuTitle"),
        contexts: ["selection"],
    });
    console.log("Context menu created.");
});

/**
 * Injects a script into the tab to get the selected text and its position.
 * @param {number} tabId - The ID of the tab to inject the script into.
 * @returns {Promise<{text: string, coords: {clientX: number, clientY: number}}|null>}
 */
async function getSelectionDetailsFromTab(tabId) {
    try {
        const injectionResults = await browser.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    // Return the text and the coordinates to position the tooltip
                    return {
                        text: selection.toString(),
                        coords: {
                            // 使用纯粹的视口相对坐标。getBoundingClientRect() 返回的正是我们需要的。
                            // CSS 将使用 position:fixed，因此我们不再需要关心页面滚动。
                            clientX: rect.left + rect.width / 2,
                            clientY: rect.bottom + 10 // 在选区下方 10px
                        }
                    };
                }
                return null;
            },
        });
        // executeScript returns an array of results, one for each frame. We want the first one.
        if (injectionResults && injectionResults[0] && injectionResults[0].result) {
            return injectionResults[0].result;
        }
    } catch (e) {
        // This can happen on pages where content scripts are not allowed to run.
        logError('getSelectionDetailsFromTab', e);
    }
    return null;
}

/**
 * Handles the translation for selected text from any source (context menu, shortcut).
 * @param {object} tab - The tab where the selection was made.
 * @param {string} source - The source of the trigger ('contextMenu' or 'shortcut').
 */
async function handleSelectionTranslation(tab, source) {
    // First, ensure the core content scripts are ready in the main frame to display the result.
    // frameId 0 is the main document frame.
    const scriptsReady = await ensureScriptsInjected(tab.id, 0, CORE_SCRIPT_FILES);
    if (!scriptsReady) {
        logError('handleSelectionTranslation', new Error(`Could not inject scripts into tab ${tab.id}.`));
        return;
    }

    const selectionDetails = await getSelectionDetailsFromTab(tab.id);

    if (!selectionDetails || !selectionDetails.text.trim()) {
        console.log("No text selected or could not retrieve selection.");
        return;
    }

    const { text: selectionText, coords } = selectionDetails;
    // Create a unique ID to prevent race conditions with multiple quick selections.
    const translationId = `sel-${Date.now()}`;

    // Create a base payload to reduce repetition.
    const basePayload = { coords, source, translationId };

    // Immediately send "loading" state for better UX.
    browser.tabs.sendMessage(tab.id, {
        type: 'DISPLAY_SELECTION_TRANSLATION',
        payload: { ...basePayload, isLoading: true }
    }).catch((e) => logError('handleSelectionTranslation (Send Loading)', e));

    // Perform translation and prepare the result part of the payload.
    let resultPayload;
    try {
        const hostname = new URL(tab.url).hostname;
        const effectiveRule = await getEffectiveSettings(hostname);
        const result = await TranslatorManager.translateText(selectionText, effectiveRule.targetLanguage, 'auto', effectiveRule.translatorEngine);

        resultPayload = {
            success: !result.error,
            translatedText: result.text,
            error: result.error,
        };
    } catch (error) {
        logError('handleSelectionTranslation (Translation Process)', error);
        resultPayload = {
            success: false,
            error: error.message,
        };
    }

    // Send the final result, combining the base and result payloads.
    browser.tabs.sendMessage(tab.id, {
        type: 'DISPLAY_SELECTION_TRANSLATION',
        payload: { ...basePayload, ...resultPayload }
    }).catch(e => logError('handleSelectionTranslation (Send Result)', e));
}

// --- Message Handlers ---

const messageHandlers = {
    async TRANSLATE_TEXT(request, sender) {
        const { text, targetLang, sourceLang, elementId, translatorEngine } = request.payload;
        const originTabId = sender.tab?.id;

        if (!originTabId) {
            logError('TRANSLATE_TEXT', new Error('Received translation request without a valid tab ID.'));
            return;
        }

        try {
            const result = await TranslatorManager.translateText(text, targetLang, sourceLang, translatorEngine);
            await browser.tabs.sendMessage(originTabId, {
                type: 'TRANSLATE_TEXT_RESULT',
                payload: {
                    elementId: elementId,
                    success: !result.error,
                    translatedText: result.text,
                    wasTranslated: result.translated,
                    error: result.error || null
                }
            });
        } catch (error) {
            logError('TRANSLATE_TEXT (execution)', error);
            try {
                await browser.tabs.sendMessage(originTabId, {
                    type: 'TRANSLATE_TEXT_RESULT',
                    payload: {
                        elementId: elementId,
                        success: false,
                        translatedText: '',
                        wasTranslated: false,
                        error: error.message
                    }
                });
            } catch (e) {
                if (!e.message.includes("Receiving end does not exist")) {
                    logError('TRANSLATE_TEXT (sending error)', e);
                }
            }
        }
    },

    async TRANSLATE_BATCH(request) {
        const { texts } = request.payload;
        if (!Array.isArray(texts)) {
            throw new Error("Invalid payload: 'texts' must be an array.");
        }
        // 从全局配置中获取翻译设置
        const settings = await getValidatedSettings();
        const promises = texts.map(text =>
            TranslatorManager.translateText(text, settings.targetLanguage, settings.sourceLanguage, settings.translatorEngine)
        );
        // TranslatorManager 内部的队列机制会自动处理并发
        const results = await Promise.all(promises);
        const translatedTexts = results.map(r => r.text);
        return { success: true, translatedTexts };
    },


    async TEST_CONNECTION(request) {
        const { engine, settings } = request.payload;
        if (engine !== 'ai') {
            return { success: false, error: `Connection test is only supported for AI engines, but got: ${engine}` };
        }
        const translator = new AITranslator();
        try {
            // 直接使用从 payload 传来的临时设置调用翻译器。
            const result = await translator.translate('test', 'EN', 'auto', settings);

            // 返回与 TRANSLATE_TEXT 处理器一致的数据结构，
            // 这是选项页面 UI 所期望的。
            return { success: true, translatedText: { text: result.text, translated: true } };
        } catch (error) {
            logError('TEST_CONNECTION handler', error);
            return { success: false, error: error.message };
        }
    },

    async SAVE_RULE_CHANGE(request) {
        const { hostname, ruleSource, key, value } = request.payload;
        const settings = await getValidatedSettings();

        const domainToUpdate = (ruleSource === 'default') ? hostname : ruleSource;
        let rule = settings.domainRules[domainToUpdate];

        // 如果我们正在为一个没有规则的域名创建一个新规则...
        if (!rule) {
            rule = {};
            // ...并且该域名有一个默认的字幕策略...
            if (DEFAULT_STRATEGY_MAP.has(hostname)) {
                // ...那么在创建新规则时，预先填充字幕设置。
                // 这可以确保当用户首次更改字幕设置（如显示模式）时，
                // `enabled` 和 `strategy` 字段被正确地预设为 true 和对应的策略。
                rule.subtitleSettings = {
                    enabled: true,
                    strategy: DEFAULT_STRATEGY_MAP.get(hostname),
                    displayMode: 'off' // 从默认的“关闭”状态开始
                };
            }
        }

        // 为嵌套的字幕设置提供特殊处理
        if (key === 'subtitleDisplayMode') {
            // 确保 subtitleSettings 对象存在
            if (!rule.subtitleSettings) rule.subtitleSettings = {};
            // 如果用户正在与字幕控件交互，我们可以安全地假设他们希望启用该功能。
            rule.subtitleSettings.enabled = true;
            rule.subtitleSettings.displayMode = value;
        } else {
            rule[key] = value;
        }
        settings.domainRules[domainToUpdate] = rule;

        await browser.storage.sync.set({ settings });
        return { success: true };
    },

    async GET_EFFECTIVE_SETTINGS(request) {
        const { hostname } = request.payload;
        return getEffectiveSettings(hostname);
    },

    async GET_VALIDATED_SETTINGS() { // Still needed by options.js
        return getValidatedSettings();
    },

    async TOGGLE_TRANSLATION_REQUEST(request) {
        console.log("[Foxlate] TOGGLE_TRANSLATION_REQUEST: Received from background script.", request.payload.tabId);
        const { tabId } = request.payload;
        const scriptsReady = await ensureScriptsInjected(tabId, 0, CORE_SCRIPT_FILES);
        if (!scriptsReady) {
            // If scripts can't be injected, we can't do anything.
            // We should also clear any lingering state for this tab.
            await setBadgeAndState(tabId, 'original');
            throw new Error(`Failed to inject scripts into tab ${tabId}.`);
        }
        // 委托内容脚本处理切换。
        // 内容脚本现在将通过 TRANSLATION_STATUS_UPDATE 消息异步报告状态变化（例如，'loading', 'original'），
        // 这提供了一个更准确的状态更新时间点。
        await browser.tabs.sendMessage(tabId, { type: 'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT', payload: { tabId } });
        return { success: true };
    },

    async TOGGLE_DISPLAY_MODE(request) {
        const { tabId, hostname } = request.payload;
        if (!tabId || !hostname) {
            throw new Error("Missing tabId or hostname for TOGGLE_DISPLAY_MODE");
        }

        const displayModes = Object.keys(Constants.DISPLAY_MODES);

        const effectiveSettings = await getEffectiveSettings(hostname);
        const { displayMode: currentMode, source: currentRuleSource } = effectiveSettings;

        const currentIndex = displayModes.indexOf(currentMode);
        const nextIndex = (currentIndex + 1) % displayModes.length;
        const newMode = displayModes[nextIndex];

        // 重用现有的 SAVE_RULE_CHANGE 处理器来保存更改，从而将保存逻辑集中化，
        // 避免代码重复。
        await messageHandlers.SAVE_RULE_CHANGE({ payload: { hostname, ruleSource: currentRuleSource, key: 'displayMode', value: newMode } });

        // 通知内容脚本更新其 UI
        try {
            await browser.tabs.sendMessage(tabId, {
                type: 'UPDATE_DISPLAY_MODE',
                payload: { displayMode: newMode }
            });
        } catch (e) {
            if (!e.message.includes("Receiving end does not exist")) {
                logError('TOGGLE_DISPLAY_MODE (sending update)', e);
            }
        }

        return { success: true, newMode: newMode };
    },

    // 新增：处理字幕翻译开关状态更新
    async UPDATE_SUBTITLE_TRANSLATION_STATUS(request, sender) {
        const { tabId, enabled, disabled } = request.payload;
        try {
            await browser.action.setIcon({ tabId, path: enabled ? "icons/icon48.png" : "icons/icon48-disabled.png" });
            await browser.action.setTitle({ tabId, title: enabled ? "Foxlate (Subtitles Enabled)" : "Foxlate (Subtitles Disabled)" });
            // 你还可以选择存储这个状态，以便在标签页重新加载时保持状态一致。
            // 例如，使用 browser.storage.session.set({ [`subtitle_${tabId}`]: enabled });
        } catch (error) {
            logError('UPDATE_SUBTITLE_TRANSLATION_STATUS', error);
        }
        return { success: true };
    },
    // ** 新增中断处理器 **
    async STOP_TRANSLATION(request) {
        const { tabId } = request.payload;
        await TranslatorManager.interruptAll();

        // 可选：发送一个通用的“中断已完成”消息，如果 content-script 需要知道的话。
        // await browser.tabs.sendMessage(tabId, { type: 'TRANSLATION_INTERRUPTED' });
        return { success: true };
    },

    async TRANSLATION_STATUS_UPDATE(request, sender) {
        const { status, tabId } = request.payload;
        if (tabId) {
            await setBadgeAndState(tabId, status);
            // When the content script reports its state, update the session-based auto-translate list.
            if (sender.tab?.url) {
                try {
                    const hostname = new URL(sender.tab.url).hostname;
                    if (status === 'translated' || status === 'loading') {
                        await registerSessionTranslation(tabId, hostname);
                    } else if (status === 'original') {
                        await unregisterSessionTranslation(tabId);
                    }
                } catch (e) {
                    logError('TRANSLATION_STATUS_UPDATE (session management)', e);
                }
            }
        } else {
            logError('TRANSLATION_STATUS_UPDATE', new Error('Missing tabId in status update payload.'));
        }
        return { success: true };
    },

    PING() {
        return { status: 'PONG' };
    },

    GET_TAB_ID(request, sender) {
        if (sender.tab) {
            return Promise.resolve({ tabId: sender.tab.id });
        }
        // 如果发送方不是tab（例如popup），则需要查询活动tab
        return browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
            return { tabId: tab?.id };
        });
    }
    ,
};

// --- Main Event Listeners ---

browser.commands.onCommand.addListener(async (command, tab) => {
    if (!tab?.id) return;

    if (command === "translate-selection") {
        handleSelectionTranslation(tab, 'shortcut');
        return;
    }

    if (command === "toggle-translation") {
        // Pre-flight check: Do not attempt to message tabs where content scripts cannot run.
        if (!tab || !tab.id || tab.url?.startsWith('about:') || tab.url?.startsWith('moz-extension:') || tab.url?.startsWith('chrome:')) {
            console.log(`[Foxlate] Command '${command}' ignored on protected page: ${tab?.url}`);
            return;
        }

        // Send the request to the service worker itself to use the unified handler.
        try {
            // Instead of sending a message to self (which can be a bit unreliable),
            // we directly call the handler function. This is more robust and avoids race conditions.
            const request = { payload: { tabId: tab.id } };
            await messageHandlers.TOGGLE_TRANSLATION_REQUEST(request);
        } catch (e) {
            logError('onCommand (toggle-translation)', e);
        }
    }

    if (command === "toggle-display-mode") {
        // Pre-flight check
        if (!tab || !tab.id || !tab.url || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:') || tab.url.startsWith('chrome:')) {
            console.log(`[Foxlate] Command '${command}' ignored on protected page: ${tab?.url}`);
            return;
        }
        try {
            const hostname = new URL(tab.url).hostname;
            await messageHandlers.TOGGLE_DISPLAY_MODE({ payload: { tabId: tab.id, hostname: hostname } });
        } catch (e) {
            logError('onCommand (toggle-display-mode)', e);
        }
    }
});

browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "translate-selection") {
        handleSelectionTranslation(tab, 'contextMenu');
    }
});

browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
        console.log("[Service Worker] Settings changed. Notifying content scripts and popup.");
        // Notify all active tabs
        browser.tabs.query({}).then(tabs => {
            for (const tab of tabs) {
                if (tab.id) {
                    browser.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED' }).catch(e => {
                        // Ignore errors, as content script might not be injected in all tabs
                        if (!e.message.includes("Receiving end does not exist")) {
                            logError('storage.onChanged (notify tab)', e);
                        }
                    });
                }
            }
        });

        // Notify the popup (if open)
        browser.runtime.sendMessage({ type: 'SETTINGS_UPDATED' }).catch(e => {
            // Ignore errors, as popup might not be open
            if (!e.message.includes("Could not establish connection. Receiving end does not exist.")) {
                logError('storage.onChanged (notify popup)', e);
            }
        });

        // Also, update any service-worker-specific variables that depend on settings
        TranslatorManager.updateConcurrencyLimit();
    }
});

browser.runtime.onMessage.addListener((request, sender) => {
    console.log(`[Service Worker] Received message: ${JSON.stringify(request)}`);
    const handler = messageHandlers[request.type];
    if (handler) {
        // Return the promise from the handler directly. The polyfill handles the asynchronicity.
        // This is a cleaner, more modern pattern than using `sendResponse` and `return true`.
        // A final .catch is added as a safety net in case a handler throws an unexpected error.
        return handler(request, sender).catch(error => {
            logError(`onMessage Listener (request type: ${request.type})`, error);
            return { success: false, error: "An unexpected error occurred in the service worker." };
        });
    }
    console.warn(`No handler found for message type: ${request.type}`);
    return Promise.resolve(); // Explicitly resolve for unhandled messages.
});

/**
 * A unified handler for navigation events to check for auto-translation.
 * Handles both full page loads and SPA navigation.
 */
async function handleNavigation(details) {
    const { tabId, url, frameId } = details;

    // 防御性检查：确保我们只在有效的、可注入脚本的页面上操作。
    // 虽然监听器已经过滤了协议，但这是一个额外的安全层。
    if (!url || !url.startsWith('http')) {
        return;
    }

    // --- 主框架专属逻辑 ---
    // 所有只应在页面顶层文档执行一次的操作都应放在这里。
    if (frameId === 0) {
        // 1. 注入核心内容脚本
        const coreScriptsReady = await ensureScriptsInjected(tabId, frameId, CORE_SCRIPT_FILES);
        if (!coreScriptsReady) {
            logError(`handleNavigation for ${url}`, new Error("Failed to inject core scripts. Aborting further actions."));
            return; // 如果核心脚本注入失败，后续操作无法进行，直接返回。
        }

        // 2. 处理自动翻译
        try {
            const hostname = new URL(url).hostname;
            const effectiveRule = await getEffectiveSettings(hostname);
            const { sessionTabTranslations = {} } = await browser.storage.session.get('sessionTabTranslations');
            const isSessionTranslate = sessionTabTranslations[tabId] === hostname;

            if (effectiveRule.autoTranslate === 'always' || isSessionTranslate) {
                console.log(`[Auto-Translate] Rule matched for '${hostname}'. Initiating translation for tab ${tabId}.`);
                // 委托内容脚本处理翻译请求。
                // 内容脚本将在翻译实际开始时发送一个 'loading' 状态更新。
                await browser.tabs.sendMessage(tabId, { type: 'TRANSLATE_PAGE_REQUEST', payload: { tabId } });
            }
        } catch (error) {
            // 只记录错误，不中断流程，因为自动翻译失败不应影响其他功能。
            logError(`handleNavigation (auto-translate) for ${url}`, error);
        }
    }

    // --- 所有框架通用逻辑 ---
    // 这个逻辑需要在每个框架（包括 iframe）中运行。
    // 3. 按需注入字幕策略脚本
    // handleSubtitleInjection 内部有自己的 frameId 检查，所以在这里调用是安全的。
    await handleSubtitleInjection(tabId, frameId, url);
}

// Listen for both full page loads and history state updates (for SPAs).
browser.webNavigation.onCompleted.addListener(handleNavigation, { url: [{ schemes: ["http", "https"] }] });
browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation, { url: [{ schemes: ["http", "https"] }] });

browser.tabs.onRemoved.addListener(async (tabId) => {
    try {
        // Get all session data at once
        const sessionData = await browser.storage.session.get(['tabTranslationStates', 'sessionTabTranslations']);
        const { tabTranslationStates = {}, sessionTabTranslations = {} } = sessionData;
        let needsUpdate = false;

        // Clean up translation state
        if (tabTranslationStates[tabId]) {
            delete tabTranslationStates[tabId];
            needsUpdate = true;
            console.log(`Cleaned up translation state for closed tab ${tabId}.`);
        }

        // Clean up session auto-translation rule
        if (sessionTabTranslations[tabId]) {
            delete sessionTabTranslations[tabId];
            needsUpdate = true;
            console.log(`Cleaned up session auto-translation rule for closed tab ${tabId}.`);
        }

        // Write back to storage only if something changed
        if (needsUpdate) {
            await browser.storage.session.set({ tabTranslationStates, sessionTabTranslations });
        }

    } catch (error) {
        logError('tabs.onRemoved listener', error);
    }
});

async function setBadgeAndState(tabId, state, currentStates) {
    // 不再自己获取，而是使用传入的 currentStates
    const tabTranslationStates = currentStates || (await browser.storage.session.get('tabTranslationStates')).tabTranslationStates || {};
    if (state === 'original' || !state) {
        delete tabTranslationStates[tabId];
        await browser.action.setBadgeText({ tabId, text: '' });
    } else {
        tabTranslationStates[tabId] = state;
        let badgeText = '';
        let badgeColor = '';
        switch (state) {
            case 'loading':
                badgeText = '...';
                badgeColor = '#F57C00'; // Orange - Loading
                break;
            case 'translated':
                badgeText = '✓';
                badgeColor = '#388E3C'; // Green - Translated
                break;
            default:
                break;
        }
        await browser.action.setBadgeText({ tabId, text: badgeText });
        if (badgeText) {
            await browser.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
        }
    }
    await browser.storage.session.set({ tabTranslationStates });
}