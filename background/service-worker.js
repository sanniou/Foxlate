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

async function ensureContentScript(tabId) {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'PING' });
    return;
  } catch (e) {
    console.log(`Content script not detected in tab ${tabId}. Injecting...`);
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        files: [
          'lib/webextension-polyfill.js',
          'content/strategies/hover-strategy.js',
          'content/strategies/append-strategy.js',
          'content/strategies/replace-strategy.js',
          'content/display-manager.js',
          'content/content-script.js'
        ],
      });
      await browser.scripting.insertCSS({
        target: { tabId },
        files: ['content/style.css'],
      });
    } catch (injectionError) {
      logError(`ensureContentScript (Injection Phase for tab ${tabId})`, injectionError);
      throw new Error(`Failed to inject content script into tab ${tabId}.`);
    }

    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 20;
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(interval);
          const finalError = new Error("Content script failed to respond after injection.");
          logError(`ensureContentScript (Polling Phase for tab ${tabId})`, finalError);
          reject(finalError);
          return;
        }
        try {
          await browser.tabs.sendMessage(tabId, { type: 'PING' });
          clearInterval(interval);
          resolve();
        } catch (err) {
          // Not ready yet
        }
      }, 100);
    });
  }
}

const setTabTranslationState = async (tabId, state) => {
    const { tabTranslationStates = {} } = await browser.storage.session.get('tabTranslationStates');
    if (state === 'original' || !state) {
        delete tabTranslationStates[tabId];
    } else {
        tabTranslationStates[tabId] = state;
    }
    await browser.storage.session.set({ tabTranslationStates });
    browser.runtime.sendMessage({
        type: 'TRANSLATION_STATUS_BROADCAST',
        payload: { tabId, status: state }
    }).catch(e => {
        if (!e.message.includes("Could not establish connection. Receiving end does not exist.")) {
            console.warn(`[Service Worker] Error broadcasting status for tab ${tabId}:`, e);
        }
    });
};

// --- Message Handlers ---

async function handleContextMenuClick(info, tab) {
  if (info.menuItemId !== "translate-selection" || !info.selectionText) {
    return;
  }
  try {
    await ensureContentScript(tab.id);
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
        const error = wasFulfilled ? translationResult?.error : result.reason.message;

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
      await ensureContentScript(tabId);
      await browser.tabs.sendMessage(tabId, { type: 'TRANSLATE_PAGE_REQUEST', payload: { tabId } });
      return { success: true };
    } catch (error) {
      logError('INITIATE_PAGE_TRANSLATION handler', error);
      await setTabTranslationState(tabId, 'original');
      return { success: false, error: error.message };
    }
  },

  async REVERT_PAGE_TRANSLATION_REQUEST(request) {
    const { tabId } = request.payload;
    // ** 调用中断功能 **
    TranslatorManager.interruptAll();
    await setTabTranslationState(tabId, 'original');
    try {
      await ensureContentScript(tabId);
      await browser.tabs.sendMessage(tabId, { type: 'REVERT_PAGE_TRANSLATION', payload: { tabId } });
      return { success: true };
    } catch (error) {
      logError('REVERT_PAGE_TRANSLATION_REQUEST handler', error);
      return { success: false, error: error.message };
    } 
  },

  // ** 新增中断处理器 **
  async INTERRUPT_TRANSLATION_REQUEST(request) {
      TranslatorManager.interruptAll();
      const { tabId } = request.payload;
      if (tabId) {
          // 将状态更新为“已翻译”，但这实际上是一个中间状态，
          // 用户可能希望看到部分已完成的翻译，而不是完全还原。
          // 更好的做法是让 content-script 自己决定最终状态。
          // 我们在这里只负责中断。
          await setTabTranslationState(tabId, 'translated');
      }
      return { success: true };
  },

  async TRANSLATION_STATUS_UPDATE(request) {
    const { status, tabId } = request.payload;
    if (tabId) {
      await setTabTranslationState(tabId, status);
    } else {
      logError('TRANSLATION_STATUS_UPDATE', new Error('Missing tabId in status update payload.'));
    }
    return { success: true };
  },

  PING() {
    return { status: 'PONG' };
  }
};

// --- Main Event Listeners ---

browser.contextMenus.onClicked.addListener(handleContextMenuClick);

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = messageHandlers[request.type];
  if (handler) {
    Promise.resolve(handler(request, sender))
      .then(sendResponse)
      .catch(error => {
        logError(`onMessage Listener (request type: ${request.type})`, error);
        sendResponse({ success: false, error: "An unexpected error occurred in the service worker." });
      });
    return true;
  }
  console.warn(`No handler found for message type: ${request.type}`);
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  try {
    await setTabTranslationState(tabId, 'original');
    console.log(`Cleaned up translation state for closed tab ${tabId}.`);
  } catch (error) {
    logError('tabs.onRemoved listener', error);
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url || !tab.url.startsWith('http')) {
        return;
    }
    try {
        const { settings } = await browser.storage.sync.get('settings');
        const domain = new URL(tab.url).hostname;
        const domainRules = settings?.domainRules || {};
        if (domainRules[domain] === 'always') {
            console.log(`[Auto-Translate] Domain ${domain} is marked for automatic translation. Initiating...`);
            await ensureContentScript(tabId);
            await browser.tabs.sendMessage(tabId, { type: 'TRANSLATE_PAGE_REQUEST', payload: { tabId } });
        }
    } catch (error) {
        logError('tabs.onUpdated listener (Auto-Translate)', error);
    }
});