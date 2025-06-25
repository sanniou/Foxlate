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
 * Ensures a content script is ready to receive messages in a tab.
 * This function is critical for programmatic injections on pages where the
 * content script might not have been automatically injected (e.g., after an
 * extension update or on special browser pages).
 *
 * It first tries to ping the script. If that fails, it injects the script
 * and then polls until the script responds to a ping.
 *
 * @param {number} tabId The ID of the tab to check/inject.
 * @returns {Promise<void>} A promise that resolves when the script is ready.
 * @throws {Error} Throws if injection or communication fails.
 */
async function ensureContentScript(tabId) {
  try {
    // First, try to ping the content script. If it responds, we're good.
    await browser.tabs.sendMessage(tabId, { type: 'PING' });
    console.log(`Content script already active in tab ${tabId}.`);
    return;
  } catch (e) {
    // Ping failed, which means the script is not there or not responding.
    console.log(`Content script not detected in tab ${tabId}. Injecting...`);

    try {
      // Inject the script and its CSS.
      await browser.scripting.executeScript({
        target: { tabId },
        // 按依赖顺序注入所有内容脚本：
        // 1. 策略脚本 (依赖项)
        // 2. 管理器 (使用策略)
        // 3. 主脚本 (使用管理器)
        files: [
          'lib/webextension-polyfill.js',
          'content/strategies/hover-strategy.js', // 提供 showTooltip, hideTooltip, hoverStrategy
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
      console.log(`Successfully injected scripts and CSS into tab ${tabId}.`);
    } catch (injectionError) {
      logError(`ensureContentScript (Injection Phase for tab ${tabId})`, injectionError);
      throw new Error(`Failed to inject content script into tab ${tabId}. This might be a permissions issue or a protected page.`);
    }

    // After injection, we need to wait for it to be ready. We poll with PING.
    // The error "Content script failed to respond after injection" means this part is timing out.
    // This usually indicates an error INSIDE the content script itself, which prevents it
    // from setting up its message listener. Check the DevTools console of the target page for errors.
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 20; // Increased timeout to 2 seconds
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(interval);
          // This is the error the user is seeing.
          const finalError = new Error("Content script failed to respond after injection. Check the target page's console for errors.");
          logError(`ensureContentScript (Polling Phase for tab ${tabId})`, finalError);
          reject(finalError);
          return;
        }

        try {
          await browser.tabs.sendMessage(tabId, { type: 'PING' });
          clearInterval(interval);
          console.log(`Content script is now responsive in tab ${tabId}.`);
          resolve();
        } catch (err) {
          // Script not ready yet, wait for the next interval.
        }
      }, 100);
    });
  }
}


// --- Message Handlers ---

/**
 * Handles translation requests for text selections from the context menu.
 * @param {object} info - Information about the context menu click.
 * @param {object} tab - The tab where the click occurred.
 */
async function handleContextMenuClick(info, tab) {
  if (info.menuItemId !== "translate-selection" || !info.selectionText) {
    return;
  }

  try {
    await ensureContentScript(tab.id);

    // Inform the content script that translation is starting.
    browser.tabs.sendMessage(tab.id, {
      type: 'DISPLAY_SELECTION_TRANSLATION',
      payload: { isLoading: true }
    });

    const { settings } = await browser.storage.sync.get('settings');
    const targetLang = settings?.targetLanguage || 'ZH';
    const translatedText = await TranslatorManager.translateText(info.selectionText, targetLang);

    // Send the successful result.
    browser.tabs.sendMessage(tab.id, {
      type: 'DISPLAY_SELECTION_TRANSLATION',
      payload: { success: true, translatedText }
    });
  } catch (error) {
    logError('handleContextMenuClick', error);
    // Attempt to send the error to the content script for display.
    if (tab && tab.id) {
      browser.tabs.sendMessage(tab.id, {
        type: 'DISPLAY_SELECTION_TRANSLATION',
        payload: { success: false, error: error.message },
      }).catch(e => logError('handleContextMenuClick (Send Error)', e));
    }
  }
}

/**
 * A map of message types to their corresponding handler functions.
 * This approach is cleaner and more scalable than a large if/else or switch block.
 */
const messageHandlers = {
  /**
   * Handles text translation requests from content scripts.
   */
  async TRANSLATE_TEXT(request) {
    const { text, targetLang, sourceLang } = request.payload;
    try {
      const translatedText = await TranslatorManager.translateText(text, targetLang, sourceLang);
      return { success: true, translatedText };
    } catch (error) {
      logError('TRANSLATE_TEXT handler', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Handles requests from the options page to test a translator's connection.
   * NOTE: This uses a temporary override (monkey-patching) of `browser.storage.sync.get`.
   * This is not ideal. A better long-term solution would be to refactor the Translator
   * classes to accept settings directly in their `translate` methods.
   */
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

    // Temporarily override storage.sync.get for this specific test.
    const originalGet = browser.storage.sync.get;
    try {
      const originalGet = browser.storage.sync.get;
      browser.storage.sync.get = async () => ({ settings });
      const translatedText = await translator.translate('test', 'EN', 'auto');
      return { success: true, translatedText };
    } catch (error) {
      logError('TEST_CONNECTION handler', error);
      return { success: false, error: error.message };
    } finally {
      // CRITICAL: Always restore the original function.
      browser.storage.sync.get = originalGet;
    }
  },

  /**
   * Handles the initial request from the popup to translate the entire page.
   * It ensures the content script is ready and then forwards the request.
   */
  async INITIATE_PAGE_TRANSLATION(request) {
    const { tabId } = request.payload;
    try {
      await ensureContentScript(tabId);
      // Forward the request to the now-ready content script and return its response.
      return await browser.tabs.sendMessage(tabId, { type: 'TRANSLATE_PAGE_REQUEST' });
    } catch (error) {
      logError('INITIATE_PAGE_TRANSLATION handler', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Handles pings from other parts of the extension to check if the service worker is active.
   */
  PING() {
    return { status: 'PONG' };
  }
};

// --- Main Event Listeners ---

browser.contextMenus.onClicked.addListener(handleContextMenuClick);

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = messageHandlers[request.type];
  if (handler) {
    // Using a promise-based approach for all handlers.
    handler(request, sender)
      .then(sendResponse)
      .catch(error => {
        logError(`onMessage Listener (request type: ${request.type})`, error);
        sendResponse({ success: false, error: "An unexpected error occurred in the service worker." });
      });
    return true; // Indicates an asynchronous response.
  }
  // If no handler is found, log it but don't send a response.
  console.warn(`No handler found for message type: ${request.type}`);
});

/**
 * 当标签页关闭时，清理其持久化的翻译状态，以防止存储无限增长。
 */
browser.tabs.onRemoved.addListener(async (tabId) => {
  const TRANSLATION_STATE_KEY = 'tabTranslationStates';
  try {
    const data = await browser.storage.session.get(TRANSLATION_STATE_KEY);
    const states = data[TRANSLATION_STATE_KEY];
    if (states && states[tabId] !== undefined) {
      delete states[tabId];
      await browser.storage.session.set({ [TRANSLATION_STATE_KEY]: states });
      console.log(`Cleaned up translation state for closed tab ${tabId}.`);
    }
  } catch (error) {
    logError('tabs.onRemoved listener', error);
  }
});