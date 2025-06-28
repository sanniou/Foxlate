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

// --- Message Handlers ---

async function handleContextMenuClick(info, tab) {
  if (info.menuItemId !== "translate-selection" || !info.selectionText) {
    return;
  }
  try {
    browser.tabs.sendMessage(tab.id, {
      type: 'DISPLAY_SELECTION_TRANSLATION',
      payload: { isLoading: true }
    });
    const { settings } = await browser.storage.sync.get('settings');
    const targetLang = settings?.targetLanguage || 'ZH';
    const result = await TranslatorManager.translateText(info.selectionText, targetLang);
    browser.tabs.sendMessage(tab.id, {
      type: 'DISPLAY_SELECTION_TRANSLATION',
      payload: { success: true, translatedText: result.text }
    });
  } catch (error) {
    logError('handleContextMenuClick', error);
    if (tab && tab.id) {
      browser.tabs.sendMessage(tab.id, {
        type: 'DISPLAY_SELECTION_TRANSLATION',
        payload: { success: false, error: error.message },
      }).catch(e => logError('handleContextMenuClick (Send Error)', e));
    }
  }
}

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
    const { texts, ids, targetLang, sourceLang, tabId } = request.payload;
    if (!texts || !ids || !tabId || texts.length !== ids.length) {
        logError('TRANSLATE_TEXT_CHUNK', new Error('Invalid payload for chunk translation.'));
        return;
    }

    const translationPromises = texts.map(text =>
        TranslatorManager.translateText(text, targetLang, sourceLang)
    );

    const results = await Promise.allSettled(translationPromises);

    results.forEach((result, index) => {
        const wasFulfilled = result.status === 'fulfilled';
        const translationResult = wasFulfilled ? result.value : null;
        // ** (修复 #4) 确保传递中断错误 **
        const error = wasFulfilled ? translationResult?.error : (result.reason?.message || 'Unknown error');

        const payload = {
            id: ids[index],
            success: wasFulfilled && !translationResult?.error,
            translatedText: wasFulfilled ? translationResult.text : null,
            wasTranslated: wasFulfilled ? translationResult.translated : false,
            error: error,
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
    const translators = {
      deeplx: new DeepLxTranslator(),
      google: new GoogleTranslator(),
      ai: new AITranslator(),
    };
    const translator = translators[engine];
    if (!translator) {
      return { success: false, error: `Unknown engine: ${engine}` };
    }
    const originalGet = browser.storage.sync.get;
    try {
      browser.storage.sync.get = async () => ({ settings });
      let result;
      if (engine === 'ai') {
        result = await translator.translate('test', 'EN', 'auto', settings);
      } else {
        result = await translator.translate('test', 'EN', 'auto');
      }
      return { success: true, translatedText: result.text };
    } catch (error) {
      logError('TEST_CONNECTION handler', error);
      return { success: false, error: error.message };
    } finally {
      browser.storage.sync.get = originalGet;
    }
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
        const { settings } = await browser.storage.sync.get('settings');
        const domainRules = settings?.domainRules;

        if (!domainRules || Object.keys(domainRules).length === 0) {
            return { shouldTranslate: false };
        }

        const matchingDomainKey = Object.keys(domainRules)
            .filter(d => hostname.endsWith(d))
            .sort((a, b) => b.length - a.length)[0];

        if (matchingDomainKey) {
            const rule = domainRules[matchingDomainKey];
            const isDomainMatch = rule.applyToSubdomains !== false || hostname === matchingDomainKey;
            if (isDomainMatch && rule.autoTranslate === 'always') {
                console.log(`[Auto-Translate] Rule for '${matchingDomainKey}' matched on ${hostname}. Approving translation.`);
                await setBadgeAndState(tabId, 'loading'); // Set loading state and badge
                return { shouldTranslate: true, tabId: tabId };
            }
        }
    } catch (error) {
        logError('SHOULD_AUTO_TRANSLATE handler', error);
    }
    return { shouldTranslate: false };
  }
};

// --- Main Event Listeners ---

browser.contextMenus.onClicked.addListener(handleContextMenuClick);

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
    await setBadgeAndState(tabId, 'original');
    console.log(`Cleaned up translation state for closed tab ${tabId}.`);
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