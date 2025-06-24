import { TranslatorManager } from './translator-manager.js';
import { DeepLxTranslator } from './translators/deeplx-translator.js';
import { GoogleTranslator } from './translators/google-translator.js';
import { AITranslator } from './translators/ai-translator.js';

// --- 右键菜单功能 ---

// 插件安装时创建右键菜单项
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "translate-selection",
    title: "使用通用翻译翻译 '%s'", // %s 会被选中的文本替换
    contexts: ["selection"],
  });
});

/**
 * 确保内容脚本已加载并准备好在特定选项卡中接收消息。
 * 它首先尝试 ping 脚本。如果失败，它会注入脚本和 CSS，
 * 然后通过 ping 轮询，直到脚本响应。
 * @param {number} tabId 要检查/注入的选项卡的 ID。
 */
async function ensureContentScript(tabId) {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'PING' });
    return; // 已加载并准备就绪。
  } catch (e) {
    // Ping 失败，意味着内容脚本不可用。
    console.log("Content script not ready, injecting...");
    await browser.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/webextension-polyfill.js', 'content/content-script.js'],
    });
    await browser.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['content/style.css'],
    });

    // 轮询直到内容脚本准备好响应
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const interval = setInterval(async () => {
        if (++attempts > 10) { // 1 秒后超时 (10 * 100ms)
          clearInterval(interval);
          reject(new Error("Content script failed to respond after injection."));
          return;
        }
        try {
          await browser.tabs.sendMessage(tabId, { type: 'PING' });
          clearInterval(interval);
          resolve();
        } catch (err) { /* 尚未准备好，忽略并重试 */ }
      }, 100);
    });
  }
}

// 监听右键菜单点击事件
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "translate-selection" || !info.selectionText) {
    return;
  }

  try {
    // 1. 确保内容脚本已准备就绪。
    await ensureContentScript(tab.id);

    // 2. 向内容脚本发送“加载中”状态。
    browser.tabs.sendMessage(tab.id, { type: 'DISPLAY_SELECTION_TRANSLATION', payload: { isLoading: true } });

    // 3. 执行翻译。
    const { settings } = await browser.storage.sync.get('settings');
    const targetLang = settings?.targetLanguage || 'ZH';
    const translatedText = await TranslatorManager.translateText(info.selectionText, targetLang);

    // 4. 发送成功的结果。
    browser.tabs.sendMessage(tab.id, { type: 'DISPLAY_SELECTION_TRANSLATION', payload: { success: true, translatedText } });
  } catch (error) {
    console.error("[Background] Error during context menu translation:", error);
    // 5. 如果有任何失败，尝试向内容脚本发送错误消息。
    if (tab && tab.id) {
      browser.tabs.sendMessage(tab.id, {
        type: 'DISPLAY_SELECTION_TRANSLATION',
        payload: { success: false, error: error.message },
      }).catch(e => console.error("Could not send error to content script:", e));
    }
  }
});

// 监听来自 content-script 的消息
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TRANSLATE_TEXT') {
    const { text, targetLang, sourceLang } = request.payload;

    TranslatorManager.translateText(text, targetLang, sourceLang)
      .then(translatedText => {
        sendResponse({ success: true, translatedText });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });

    // 返回 true 表示我们将异步地发送响应
    return true;
  }

  if (request.type === 'TEST_CONNECTION') {
    const { engine, settings } = request.payload;
    let translator;

    // Manually create an instance for testing, so we don't rely on saved settings
    if (engine === 'deeplx') {
      translator = new DeepLxTranslator();
    } else if (engine === 'google') {
      translator = new GoogleTranslator();
    } else if (engine === 'ai') {
      translator = new AITranslator();
    }

    if (translator) {
      // We need to temporarily override the settings for the translator to use
      // This is a bit of a hack, but effective for testing.
      // A more robust solution might involve passing settings directly to translate method.
      const originalGet = browser.storage.sync.get;
      browser.storage.sync.get = async () => ({ settings });

      translator.translate('test', 'EN', 'auto')
        .then(translatedText => sendResponse({ success: true, translatedText }))
        .catch(error => sendResponse({ success: false, error: error.message }))
        .finally(() => { browser.storage.sync.get = originalGet; }); // Restore original function
    }
    return true; // Indicate async response
  }

  // PING handler for readiness check
  if (request.type === 'PING') {
    sendResponse({ status: 'PONG' });
    return true;
  }

  // 处理来自 popup 的页面翻译请求 (目前仅为占位符)
  if (request.type === 'TRANSLATE_PAGE_REQUEST') {
    console.log("[Background] Received page translation request from popup for tab:", sender.tab.id);
    // 这里可以添加逻辑来向 content-script 发送实际的页面翻译指令
    // 例如: browser.tabs.sendMessage(sender.tab.id, { type: 'PERFORM_PAGE_TRANSLATION' });
    // 但目前 content-script 中没有实现复杂的页面翻译逻辑，所以暂时只打印日志。
    return false; // 不需要异步响应
  }
});