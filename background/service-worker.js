import '/lib/browser-polyfill.js'; 
import { getEffectiveSettings, getValidatedSettings } from '/common/settings-manager.js';
import { TranslatorManager } from '/background/translator-manager.js';
import { AITranslator } from '/background/translators/ai-translator.js';

const CONTENT_SCRIPT_FILES = [
    "lib/browser-polyfill.js",
    "content/strategies/replace-strategy.js",
    "content/strategies/append-strategy.js",
    "content/strategies/hover-strategy.js",
    "content/strategies/context-menu-strategy.js",
    "content/display-manager.js",
    "content/content-script.js"
];
const CSS_FILES = ["content/style.css"];

/**
 * Centralized error logger.
 * @param {string} context - The context in which the error occurred (e.g., "Context Menu").
 * @param {Error} error - The error object.
 */
function logError(context, error) {
  console.error(`[Foxlate Error] in ${context}:`, error.message, error.stack);
}

/**
 * Ensures content scripts are injected and ready in a tab.
 * Prevents re-injection and handles errors on restricted pages.
 * @param {number} tabId The ID of the tab.
 * @returns {Promise<boolean>} True if scripts are ready, false otherwise.
 */
async function ensureScriptsInjected(tabId) {
    try {
        // Ping the content script to see if it's already there.
        const response = await browser.tabs.sendMessage(tabId, { type: 'PING' });
        if (response?.status === 'PONG') {
            return true; // Already injected and ready.
        }
    } catch (e) {
        // Error means content script is not there. This is expected.
    }
    try {
        await browser.scripting.insertCSS({ target: { tabId }, files: CSS_FILES });
        await browser.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
        return true;
    } catch (error) {
        logError(`ensureScriptsInjected for tab ${tabId}`, new Error(`Failed to inject scripts. This can happen on special pages (e.g., chrome://). Error: ${error.message}`));
        return false;
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
  // First, ensure the content scripts are ready to display the result.
  const scriptsReady = await ensureScriptsInjected(tab.id);
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

  try {
    // Send a "loading" message immediately. No need to check for script readiness again.
    browser.tabs
      .sendMessage(tab.id, {
        type: 'DISPLAY_SELECTION_TRANSLATION',
        payload: { isLoading: true, coords, source },
      })
      .catch((e) => logError('handleSelectionTranslation (Send Loading)', e));

    const hostname = new URL(tab.url).hostname;
    const effectiveRule = await getEffectiveSettings(hostname);

    const result = await TranslatorManager.translateText(selectionText, effectiveRule.targetLanguage, 'auto', effectiveRule.translatorEngine);

    browser.tabs.sendMessage(tab.id, {
      type: 'DISPLAY_SELECTION_TRANSLATION',
      payload: { success: !result.error, translatedText: result.text, error: result.error, coords, source }
    });
  } catch (error) {
    logError('handleSelectionTranslation', error);
    browser.tabs.sendMessage(tab.id, {
      type: 'DISPLAY_SELECTION_TRANSLATION',
      payload: { success: false, error: error.message, coords, source },
    }).catch(e => logError('handleSelectionTranslation (Send Error)', e));
  }
}

// --- Message Handlers ---

const messageHandlers = {
  async TRANSLATE_TEXT(request) {
    const { text, targetLang, sourceLang } = request.payload;
    const result = await TranslatorManager.translateText(text, targetLang, sourceLang);
    if (result.error) {
      logError('TRANSLATE_TEXT handler', new Error(result.error));
      return { success: false, error: result.error, translatedText: { text: result.text, translated: result.translated }, log: result.log };
    } else {
      return { success: true, translatedText: { text: result.text, translated: result.translated }, log: result.log };
    }
  },

  async TRANSLATE_TEXT_CHUNK(request, sender) {
    const { texts, ids, targetLang, sourceLang, tabId, translatorEngine } = request.payload;
    if (!texts || !ids || !tabId || texts.length !== ids.length) {
        logError('TRANSLATE_TEXT_CHUNK', new Error('Invalid payload for chunk translation.'));
        return;
    }

    const translationPromises = texts.map(text =>
        TranslatorManager.translateText(text, targetLang, sourceLang, translatorEngine)
    );

    const results = await Promise.allSettled(translationPromises);

    results.forEach((result, index) => {
        const wasFulfilled = result.status === 'fulfilled';
        const translationResult = wasFulfilled ? result.value : null;
        
        let finalError = null;
        if (!wasFulfilled) {
            // 如果任务被拒绝，检查是否是中断错误
            if (result.reason?.name === 'AbortError') {
                finalError = "Translation was interrupted by the user.";
            } else {
                finalError = result.reason?.message || 'Unknown error';
            }
        } else if (translationResult?.error) {
            // 如果任务成功，但翻译流程内部返回了一个错误
            finalError = translationResult.error;
        }

        const payload = {
            id: ids[index],
            success: wasFulfilled && !translationResult?.error,
            translatedText: wasFulfilled ? translationResult.text : null,
            wasTranslated: wasFulfilled ? translationResult.translated : false,
            error: finalError,
        };

        browser.tabs.sendMessage(tabId, {
            type: 'TRANSLATION_CHUNK_RESULT',
            payload: payload
        }).catch(e => {
            if (!e.message.includes("Receiving end does not exist")) {
                 logError('TRANSLATE_TEXT_CHUNK (sending result)', e);
            }
        });
    });
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
    const rule = settings.domainRules[domainToUpdate] || {};
    rule[key] = value;
    settings.domainRules[domainToUpdate] = rule;

    await browser.storage.sync.set({ settings });
    return { success: true };
  },

  async GET_EFFECTIVE_SETTINGS(request) {
    const { hostname } = request.payload;
    return getEffectiveSettings(hostname);
  },

  async GET_VALIDATED_SETTINGS() {
    return getValidatedSettings();
  },

  async INITIATE_PAGE_TRANSLATION(request) {
    const { tabId } = request.payload;
    try {
      // Ensure scripts are ready before sending the request.
      const scriptsReady = await ensureScriptsInjected(tabId);
      if (!scriptsReady) {
          throw new Error("Failed to inject scripts into the page.");
      }

      // 立即设置加载状态和角标
      await setBadgeAndState(tabId, 'loading');
      await browser.tabs.sendMessage(tabId, { type: 'TRANSLATE_PAGE_REQUEST', payload: { tabId } });
      return { success: true };
    } catch (error) {
      logError('INITIATE_PAGE_TRANSLATION handler', error);
      await setBadgeAndState(tabId, 'original');
      return { success: false, error: error.message };
    }
  },

  async REVERT_PAGE_TRANSLATION_REQUEST(request) {
    const { tabId } = request.payload;
    // Ensure scripts are present to handle the revert command.
    const scriptsReady = await ensureScriptsInjected(tabId);
    if (!scriptsReady) {
        // If scripts can't be injected, there's nothing to revert.
        // Just clear the state from the background.
        await setBadgeAndState(tabId, 'original');
        return { success: true };
    }
    // ** 调用中断功能 **
    await TranslatorManager.interruptAll();
    await setBadgeAndState(tabId, 'original');
    try {
      await browser.tabs.sendMessage(tabId, { type: 'REVERT_PAGE_TRANSLATION', payload: { tabId } });
      return { success: true };
    } catch (error) {
      logError('REVERT_PAGE_TRANSLATION_REQUEST handler', error);
      return { success: false, error: error.message };
    } 
  },

    // ** 新增中断处理器 **
    async STOP_TRANSLATION(request) {
        const { tabId } = request.payload;
        await TranslatorManager.interruptAll();

        // **(修复 #5)  不再在此处设置状态 **
        // 状态应该由 content-script 在中断操作完成后设置。
        // 我们只需要确保中断请求已处理。

        // 可选：发送一个通用的“中断已完成”消息，如果 content-script 需要知道的话。
        // await browser.tabs.sendMessage(tabId, { type: 'TRANSLATION_INTERRUPTED' });
        return { success: true };
    },

    // ** 移除无用的广播消息 **
    //  TRANSLATION_STATUS_BROADCAST 消息不再需要
    //  所有的状态更新都通过 content-script 发起，并由 popup 监听

  async TRANSLATION_STATUS_UPDATE(request) {
    const { status, tabId } = request.payload;
    if (tabId) {
      await setBadgeAndState(tabId, status);
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

  const scriptsReady = await ensureScriptsInjected(tab.id);
  if (!scriptsReady) return;

  if (command === "toggle-translation") {
    browser.tabs.sendMessage(tab.id, {
      type: "TOGGLE_TRANSLATION_REQUEST",
      payload: { tabId: tab.id }
    }).catch(e => {
        if (!e.message.includes("Receiving end does not exist")) {
            logError('onCommand (toggle-translation)', e);
        }
    });
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
 * This is triggered by both full page loads and SPA navigations.
 * @param {object} details - The event details from webNavigation.
 * @param {number} details.tabId - The ID of the tab.
 * @param {string} details.url - The new URL of the frame.
 * @param {number} details.frameId - The ID of the frame.
 */
async function handleNavigation(details) {
    // Only act on the main frame of the page.
    if (details.frameId !== 0) {
        return;
    }
    try {
        const { tabId, url } = details;
        const hostname = new URL(url).hostname;
        const effectiveRule = await getEffectiveSettings(hostname);

        // 1. 无论是否自动翻译，先注入脚本
        const scriptsReady = await ensureScriptsInjected(tabId);
        if (!scriptsReady) {
            logError(`handleNavigation for ${details.url}`, new Error("Failed to inject scripts."));
            return;
        }

        // 2. 然后，根据规则判断是否触发自动翻译
        if (effectiveRule.autoTranslate === 'always') {
            console.log(`[Auto-Translate] Rule for '${hostname}' matched on navigation. Initiating translation for tab ${tabId}.`);
            await browser.tabs.sendMessage(tabId, { type: 'TRANSLATE_PAGE_REQUEST', payload: { tabId } });
        }
    } catch (error) {
        logError(`handleNavigation for ${details.url}`, error);
    }
}

// Listen for both full page loads and history state updates (for SPAs).
browser.webNavigation.onCompleted.addListener(handleNavigation, { url: [{ schemes: ["http", "https"] }] });
browser.webNavigation.onHistoryStateUpdated.addListener(handleNavigation, { url: [{ schemes: ["http", "https"] }] });

browser.tabs.onRemoved.addListener(async (tabId) => {
  try {
    // 当标签页被移除时，我们只需要清理其在会话存储中的状态。
    // 调用 setBadgeAndState 会尝试更新一个不存在的标签页的角标，从而导致错误。
    const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
    if (tabTranslationStates[tabId]) {
      delete tabTranslationStates[tabId];
      await browser.storage.session.set({ tabTranslationStates });
      console.log(`Cleaned up translation state for closed tab ${tabId}.`);
    }
  } catch (error) {
    logError('tabs.onRemoved listener', error);
  }
});

async function setBadgeAndState(tabId, state) {
    const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
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
    // **(修复 #5)  移除广播消息 **
}