import { BaseTranslator } from './base-translator.js';

export class GoogleTranslator extends BaseTranslator {
  constructor() {
    super('Google');
    // 使用谷歌翻译网页版使用的免费、非官方API端点
    this.apiUrl = 'https://translate.googleapis.com/translate_a/single';
  }

  async translate(text, targetLang, sourceLang = 'auto', options, signal) {
    const log = []; // 为当前翻译操作创建本地日志

    const url = new URL(this.apiUrl);
    url.searchParams.append('client', 'gtx'); // 或者 't', 'webapp'
    url.searchParams.append('sl', sourceLang); // source language
    url.searchParams.append('tl', targetLang); // target language
    url.searchParams.append('dt', 't'); // return translation
    url.searchParams.append('q', text); // query text

    log.push(browser.i18n.getMessage('logEntryApiRequest', this.name));
    log.push(`[API URL] ${url.toString()}`); // 记录实际调用的 URL

    try {
      // 该API使用GET请求
      const response = await fetch(url.toString(), { signal });

      if (!response.ok) {
        log.push(browser.i18n.getMessage('logEntryApiResponseError', [response.status, response.statusText]));
        // 429 Too Many Requests 是一个常见的错误
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        throw new Error(`API Error: ${response.status} ${response.statusText}.`);
      }
      const data = await response.json();
      log.push(browser.i18n.getMessage('logEntryApiResponseSuccess', JSON.stringify(data).substring(0, 200) + (JSON.stringify(data).length > 200 ? '...' : '')));

      // 免费API的响应是一个复杂的嵌套数组
      // data[0] 是一个包含所有翻译片段的数组
      // 每个片段的第一个元素是翻译后的文本
      // 我们需要将所有片段连接起来
      const translatedText = data[0]?.map(chunk => chunk[0]).join('') || '';
      return { text: translatedText, log: log }; // 返回翻译文本和日志
    } catch (error) {
      // 如果是中止错误，直接重新抛出，以便上游可以正确处理
      if (error.name === 'AbortError') {
        throw error;
      }
      log.push(browser.i18n.getMessage('logEntryTranslationError', error.message));
      console.error(`Google Translation Error: ${error.message}`); // 仍然保留控制台错误
      throw new Error(`Google translation failed: ${error.message}`);
    }
  }
}