import { getEffectiveSettings, getValidatedSettings } from '../common/settings-manager.js';
import { TranslatorManager } from './translator-manager.js';
// The test connection logic needs direct access to translator classes.
import { DeepLxTranslator } from './translators/deeplx-translator.js';
import { GoogleTranslator } from './translators/google-translator.js';
import { AITranslator } from './translators/ai-translator.js';

/**
 * Centralized error logger.
 * @param {string} context - The context in which the error occurred (e.g., "Context Menu").
 * @param {Error} error - The error object.
 */
function logError(context, error) {
  console.error(`[Universal Translator Error] in ${context}:`, error.message, error.stack);
}

// --- Context Menu Setup ---
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "translate-selection",
    title: "使用通用翻译翻译 '%s'",
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
              // 使用视口相对坐标，因为工具提示是相对于视口定位的。
              // getBoundingClientRect() 返回的已经是我们需要的视口坐标。
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
  const selectionDetails = await getSelectionDetailsFromTab(tab.id);

  if (!selectionDetails || !selectionDetails.text.trim()) {
    console.log("No text selected or could not retrieve selection.");
    return;
  }

  const { text: selectionText, coords } = selectionDetails;

  try {
    // Send a "loading" message immediately to provide fast feedback to the user.
    browser.tabs.sendMessage(tab.id, {
      type: 'DISPLAY_SELECTION_TRANSLATION',
      payload: { isLoading: true, coords, source }
    }).catch(e => logError('handleSelectionTranslation (Send Loading)', e));

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

 async SHOULD_AUTO_TRANSLATE(request, sender) {
    const { hostname, url } = request.payload;
    const tabId = sender.tab?.id;

    if (!tabId || !url || !url.startsWith('http')) {
        return { shouldTranslate: false };
    }

    try {
        // Use the new centralized function to get settings
        const effectiveRule = await getEffectiveSettings(hostname);

        if (effectiveRule.autoTranslate === 'always') {
            console.log(`[Auto-Translate] Rule for '${hostname}' matched. Approving translation.`);
            await setBadgeAndState(tabId, 'loading'); // Set loading state and badge
            return { shouldTranslate: true, tabId: tabId };
        }
    } catch (error) {
        logError('SHOULD_AUTO_TRANSLATE handler', error);
    }
    return { shouldTranslate: false };
 }
};

// --- Main Event Listeners ---

browser.commands.onCommand.addListener(async (command, tab) => {
  switch (command) {
    case "toggle-translation":
      if (tab && tab.id) {
        browser.tabs.sendMessage(tab.id, {
          type: "TOGGLE_TRANSLATION_REQUEST",
          payload: { tabId: tab.id }
        }).catch(e => {
            if (!e.message.includes("Receiving end does not exist")) {
                logError('onCommand (toggle-translation)', e);
            }
        });
      }
      break;
    case "translate-selection":
      if (tab && tab.id) {
        handleSelectionTranslation(tab, 'shortcut');
      }
      break;
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