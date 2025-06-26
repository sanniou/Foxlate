import { BaseTranslator } from './base-translator.js';

export class DeepLxTranslator extends BaseTranslator {
  constructor() {
    super('DeepLx');
    // The API URL will now be fetched from settings in the translate method.
  }

  async translate(text, targetLang, sourceLang = 'auto') { // 不再接收 log 参数，而是内部创建
    const { settings } = await browser.storage.sync.get('settings');
    const log = []; // 为当前翻译操作创建本地日志
    const apiUrl = settings?.deeplxApiUrl;

    if (!apiUrl) {
      throw new Error('API URL not set in options');
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          source_lang: sourceLang,
          target_lang: targetLang,
        }),
      });
      log.push(browser.i18n.getMessage('logEntryApiRequest', this.name));
      log.push(`[API URL] ${apiUrl}`); // 记录实际调用的 URL

      if (!response.ok) {
        log.push(browser.i18n.getMessage('logEntryApiResponseError', [response.status, response.statusText]));
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      log.push(browser.i18n.getMessage('logEntryApiResponseSuccess', JSON.stringify(data).substring(0, 200) + (JSON.stringify(data).length > 200 ? '...' : '')));

      // Note: The structure of data.data depends on the DeepLx API implementation you use.
      return { text: data.data, log: log }; // 返回翻译文本和日志
    } catch (error) {
      log.push(browser.i18n.getMessage('logEntryTranslationError', error.message));
      console.error(`DeepLx Translation Error: ${error.message}`); // 仍然保留控制台错误
      throw new Error(`DeepLx translation failed: ${error.message}`);
    }
  }
}
