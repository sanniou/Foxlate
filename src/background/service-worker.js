
import browser from '../lib/browser-polyfill.js';
import { SettingsManager } from '../common/settings-manager.js';
import { shouldTranslate } from '../common/precheck.js';
import { TranslatorManager } from '../background/translator-manager.js';
import * as Constants from '../common/constants.js';
import TabStateManager from './tab-state-manager.js';
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
        // AbortError 是一个受控的中断，不是真正的错误。记录它用于调试，但不应视为错误。
        if (error.name === 'AbortError') {
            console.log(`[Foxlate] Task was interrupted in ${context}:`, error.message);
            return;
        }
        console.error(`[Foxlate Error] in ${context}:`, error.message, error.stack);
    } else {
        console.error(`[Foxlate Error] in ${context}:`, error || 'An unknown error occurred.');
    }
}

/**
 * 确保指定的资源（CSS 和 JS）被注入到标签页的特定框架中。
 * 此函数使用 `browser.storage.session` 来跟踪已注入的资源，以避免重复注入。
 * @param {number} tabId The ID of the tab.
 * @param {number} frameId The ID of the frame within the tab.
 * @param {string[]} filesToInject An array of file paths to inject (e.g., ['style.css', 'script.js']).
 * @returns {Promise<boolean>} True if scripts are ready or successfully injected, false otherwise.
 */
async function ensureScriptsInjected(tabId, frameId, filesToInject) {
    if (!filesToInject || filesToInject.length === 0) {
        return true;
    }

    try {
        // 将要注入的文件分为 CSS 和 JS
        const cssToInject = filesToInject.filter(file => file.endsWith('.css'));
        const jsToInject = filesToInject.filter(file => file.endsWith('.js'));

        // 按顺序注入：先 CSS，后 JS。
        // 内容脚本内部有自己的保护机制（window.foxlateContentScriptInitialized），
        // 可以防止在同一个页面上下文中重复执行初始化逻辑。
        if (cssToInject.length > 0) {
            await browser.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, files: cssToInject });
        }
        if (jsToInject.length > 0) {
            await browser.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: jsToInject });
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

        const settings = await SettingsManager.getValidatedSettings();
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
    const scriptsReady = await ensureScriptsInjected(tab.id, 0, [...CSS_FILES, ...CORE_SCRIPT_FILES]);
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
        const effectiveRule = await SettingsManager.getEffectiveSettings(hostname);

        // --- 新增：应用预校验规则 ---
        // 在使用前编译规则
        effectiveRule.precheckRules = SettingsManager.precompileRules(effectiveRule.precheckRules);
        const precheckResult = shouldTranslate(selectionText, effectiveRule);

        if (!precheckResult.result) {
            // 如果预校验失败，则不进行翻译。
            // 我们将发送一个“成功”的响应，但内容是附带提示的原文。
            console.log(`[Foxlate] Pre-check failed for selection: "${selectionText}". Reason:`, precheckResult.log?.join(' '));
            resultPayload = {
                success: true, // 操作本身是成功的，只是没有翻译。
                translatedText: selectionText,
                error: null,
            };
        } else {
            // 预校验通过，继续进行翻译。
            const result = await TranslatorManager.translateText(selectionText, effectiveRule.targetLanguage, 'auto', effectiveRule.translatorEngine);
            resultPayload = {
                success: !result.error,
                translatedText: result.text,
                error: result.error,
            };
        }
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
        // 此处理器现在只服务于内容脚本的页面翻译请求。
        const { text, targetLang, sourceLang, elementId, translatorEngine } = request.payload;
        const originTabId = sender.tab?.id;

        // 防御性检查，确保调用者是内容脚本
        if (!originTabId || !elementId) {
            const errorMsg = 'Invalid TRANSLATE_TEXT call: Missing originTabId or elementId. This handler is for content scripts only.';
            logError('TRANSLATE_TEXT', new Error(errorMsg));
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
                    payload: { elementId, success: false, translatedText: '', wasTranslated: false, error: error.message }
                });
            } catch (e) {
                if (!e.message.includes("Receiving end does not exist")) {
                    logError('TRANSLATE_TEXT (sending error)', e);
                }
            }
        }
    },

    // 新增：专门用于选项页测试翻译的处理器
    async TEST_TRANSLATE_TEXT(request) {
        const { text, targetLang, sourceLang, translatorEngine } = request.payload;
        const result = await TranslatorManager.translateText(text, targetLang, sourceLang, translatorEngine);
        return {
            success: !result.error,
            translatedText: { text: result.text, translated: result.translated },
            error: result.error || null,
            log: result.log || []
        };
    },

    async TRANSLATE_BATCH(request) {
        const { texts, targetLanguage, translatorEngine } = request.payload;
        if (!Array.isArray(texts)) {
            throw new Error("Invalid payload: 'texts' must be an array.");
        }

        // 如果调用方没有提供语言或引擎，则从全局设置中获取作为后备。
        // 这使得该处理器对新旧调用方式都兼容。
        let finalTargetLang = targetLanguage;
        let finalEngine = translatorEngine;

        if (!finalTargetLang || !finalEngine) {
            const settings = await SettingsManager.getValidatedSettings();
            finalTargetLang = finalTargetLang || settings.targetLanguage;
            finalEngine = finalEngine || settings.translatorEngine;
        }

        const promises = texts.map(text =>
            TranslatorManager.translateText(text, finalTargetLang, 'auto', finalEngine)
        );
        // TranslatorManager 内部的队列机制会自动处理并发
        const results = await Promise.all(promises);
        const translatedTexts = results.map(r => r.text);
        return { success: true, translatedTexts };
    },


    async TEST_CONNECTION(request) {
        const { engine, settings, text } = request.payload;
        if (engine !== 'ai') {
            return { success: false, error: `Connection test is only supported for AI engines, but got: ${engine}` };
        }
        const translator = new AITranslator();
        try {
            // 直接使用从 payload 传来的临时设置调用翻译器。
            const result = await translator.translate(text, 'EN', 'auto', settings);

            // 返回与 TRANSLATE_TEXT 处理器一致的数据结构，
            // 这是选项页面 UI 所期望的。
            return { success: true, translatedText: { text: result.text, translated: true } };
        } catch (error) {
            logError('TEST_CONNECTION handler', error);
            return { success: false, error: error.message };
        }
    },

    async GET_EFFECTIVE_SETTINGS(request) {
        const { hostname } = request.payload;
        return SettingsManager.getEffectiveSettings(hostname);
    },

    async GET_VALIDATED_SETTINGS() { // Still needed by options.js
        return SettingsManager.getValidatedSettings();
    },

    async TOGGLE_TRANSLATION_REQUEST(request) {
        console.log("[Foxlate] TOGGLE_TRANSLATION_REQUEST: Received from background script.", request.payload.tabId);
        const { tabId } = request.payload;
        const scriptsReady = await ensureScriptsInjected(tabId, 0, [...CSS_FILES, ...CORE_SCRIPT_FILES]);
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

        const effectiveSettings = await SettingsManager.getEffectiveSettings(hostname);
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
                        await TabStateManager.registerTabForAutoTranslation(tabId, hostname);
                    } else if (status === 'original') {
                        await TabStateManager.unregisterTabForAutoTranslation(tabId);
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
    },

    async GET_CACHE_INFO() {
        // 委托给 TranslatorManager 获取缓存信息
        return TranslatorManager.getCacheInfo();
    },

    async CLEAR_CACHE() {
        // 委托给 TranslatorManager 清空缓存
        await TranslatorManager.clearCache();
        return { success: true };
    },
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

browser.runtime.onMessage.addListener((request, sender) => {
    if (__DEBUG__) {
        console.log(`[Service Worker] Received message: ${JSON.stringify(request)}`);
    }
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
        const coreScriptsReady = await ensureScriptsInjected(tabId, frameId, [...CSS_FILES, ...CORE_SCRIPT_FILES]);
        if (!coreScriptsReady) {
            logError(`handleNavigation for ${url}`, new Error("Failed to inject core scripts. Aborting further actions."));
            return; // 如果核心脚本注入失败，后续操作无法进行，直接返回。
        }

        // 2. 处理自动翻译
        try {
            const hostname = new URL(url).hostname;
            const effectiveRule = await SettingsManager.getEffectiveSettings(hostname);
            const isSessionTranslate = await TabStateManager.isTabRegisteredForAutoTranslation(tabId, hostname);

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

/**
 * (已重构) 设置标签页的徽章和状态。
 * 此函数现在将状态持久化委托给 TabStateManager，并只负责更新 UI（徽章）。
 * @param {number} tabId
 * @param {string} state - 'loading', 'translated', 或 'original'
 */
async function setBadgeAndState(tabId, state) {
    // 1. 将状态持久化委托给管理器。
    await TabStateManager.setTabStatus(tabId, state);

    // 2. 处理 UI（徽章）更新。
    if (state === 'original' || !state) {
        await browser.action.setBadgeText({ tabId, text: '' });
    } else {
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
}

// --- (新) 统一的设置变更监听器 ---
SettingsManager.on('settingsChanged', async ({ newValue, oldValue }) => {
    // 定义哪些设置的更改需要完全重新翻译页面
    const criticalKeys = [
        'targetLanguage',
        'translatorEngine',
        'precheckRules',
        'translationSelector',
        'deeplxApiUrl', // 影响 deeplx 引擎
        'aiEngines'     // 影响 AI 引擎
    ];

    let needsReTranslation = false;
    // 仅当新旧值都存在时才进行比较
    if (oldValue && newValue) {
        for (const key of criticalKeys) {
            // 使用 JSON.stringify 进行深比较，适用于对象和数组
            if (JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key])) {
                needsReTranslation = true;
                if (__DEBUG__) {
                    console.log(`[Foxlate] Critical setting '${key}' changed. Page re-translation required.`);
                }
                break;
            }
        }
    } else {
        // 如果没有旧值（例如，首次安装或重置后），则假定需要重新翻译
        needsReTranslation = true;
    }

    const messageType = needsReTranslation ? 'RELOAD_TRANSLATION_JOB' : 'SETTINGS_UPDATED';
    if (__DEBUG__) {
        console.log(`[Service Worker] Settings changed. Notifying content scripts with '${messageType}'.`);
    }

    // (优化) 只通知那些当前有活动翻译的标签页
    const activeTabIds = await TabStateManager.getActiveTabIds();
    for (const tabId of activeTabIds) {
        browser.tabs.sendMessage(tabId, { type: messageType }).catch(e => {
            if (!e.message.includes("Receiving end does not exist")) {
                logError('settingsChanged listener (notify tab)', e);
            }
        });
    }

    // (新) 同时，向扩展的其余部分（如 popup）广播一个通用更新消息。
    // 这确保了即使弹窗是打开的，它也能收到设置更新的通知。
    browser.runtime.sendMessage({ type: messageType, payload: { newValue, oldValue } }).catch(e => {
        // 忽略错误，因为可能没有其他监听器（例如，弹窗未打开）。
    });

    // 更新依赖于设置的后台服务
    TranslatorManager.updateConcurrencyLimit();
    TranslatorManager.updateCacheSize();
});