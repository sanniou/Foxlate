import browser from '../../lib/browser-polyfill.js';
import { BaseTranslator } from './base-translator.js';
import { createRequestSignal } from './request-timeout.js';

export class DeepLxTranslator extends BaseTranslator {
  constructor() {
    super('DeepLx');
    // The API URL will now be fetched from settings in the translate method.
  }

  async translate(text, targetLang, sourceLang = 'auto', options, signal) {
    const log = []; // 为当前翻译操作创建本地日志
    const apiUrl = options?.apiUrl;

    if (!apiUrl) {
      throw new Error('DeepLx API URL not provided in options');
    }

    const requestBody = {
      text,
      target_lang: targetLang,
    };
    // DeepL/DeepLx 的 source_lang 是可选字段，省略即自动检测；
    // 传 "auto" 不是合法语言码，部分自建/代理实例会直接 400。
    if (sourceLang && sourceLang !== 'auto') {
      requestBody.source_lang = sourceLang;
    }

    const request = createRequestSignal(signal, options?.timeoutMs);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: request.signal, // 用户中止与超时合成的信号
      });
      log.push(browser.i18n.getMessage('logEntryApiRequest', this.name));
      log.push(`[API URL] ${apiUrl}`); // 记录实际调用的 URL

      if (!response.ok) {
        log.push(browser.i18n.getMessage('logEntryApiResponseError', [response.status, response.statusText]));
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      log.push(browser.i18n.getMessage('logEntryApiResponseSuccess', JSON.stringify(data).substring(0, 200) + (JSON.stringify(data).length > 200 ? '...' : '')));

      // DeepLx 的响应格式由具体部署决定，但译文一定在 data.data 上。
      // 不校验就会把 undefined 当成译文交给上层，最后在页面上渲染出 "undefined"。
      if (!data || typeof data.data !== 'string') {
        const detail = data?.message || data?.code || 'missing "data" field';
        throw new Error(`Unexpected DeepLx response: ${detail}`);
      }

      return { text: data.data, log: log }; // 返回翻译文本和日志
    } catch (error) {
      // 如果是中止错误，直接重新抛出，以便上游可以正确处理
      if (error.name === 'AbortError') {
        throw error;
      }
      log.push(browser.i18n.getMessage('logEntryTranslationError', error.message));
      console.error(`DeepLx Translation Error: ${error.message}`); // 仍然保留控制台错误
      throw new Error(`DeepLx translation failed: ${error.message}`);
    } finally {
      request.dispose();
    }
  }
}
