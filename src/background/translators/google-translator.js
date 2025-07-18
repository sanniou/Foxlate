import browser from '../../lib/browser-polyfill.js';
import { BaseTranslator } from './base-translator.js';

export class GoogleTranslator extends BaseTranslator {
  constructor() {
    super('Google');
    // 使用谷歌翻译网页版使用的免费、非官方API端点
    this.apiUrl = 'https://translate.googleapis.com/translate_a/single';
  }

  async translate(text, targetLang, sourceLang = 'auto', options, signal) {
    const log = []; // 为当前翻译操作创建本地日志

    // 对于结构化翻译，我们直接发送由DOMWalker生成的带标签的文本。
    // 不再需要进行基于换行符的分割和重组。
    const textToSend = text;

    // 如果过滤后没有文本（例如，只有空格和换行符），则直接返回原始文本，避免不必要的API调用
    if (!textToSend) {
      return { text: '', log: log };
    }

    // 切换到 POST 请求以支持更长的文本，并避免 URL 长度限制问题。
    const requestUrl = new URL(this.apiUrl);
    requestUrl.searchParams.append('client', 'gtx');
    requestUrl.searchParams.append('sl', sourceLang);
    requestUrl.searchParams.append('tl', targetLang);
    requestUrl.searchParams.append('dt', 't'); // dt=t 表示返回翻译结果

    log.push(browser.i18n.getMessage('logEntryApiRequest', this.name));
    log.push(`[API URL] ${requestUrl.toString()}`); // 记录实际调用的 URL

    try {
      const response = await fetch(requestUrl.toString(), {
        method: 'POST',
        headers: {
          // Google 的这个非官方端点需要这个 Content-Type
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        // 将要翻译的文本放在请求体中
        body: `q=${encodeURIComponent(textToSend)}`,
        signal });

      if (!response.ok) {
        log.push(browser.i18n.getMessage('logEntryApiResponseError', [response.status, response.statusText]));
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        throw new Error(`API Error: ${response.status} ${response.statusText}.`);
      }
      const data = await response.json();
      log.push(browser.i18n.getMessage('logEntryApiResponseSuccess', JSON.stringify(data).substring(0, 200) + (JSON.stringify(data).length > 200 ? '...' : '')));

      // API 返回的 data[0] 是一个片段数组，每个片段是 [translated_text, ...]。
      // 我们需要将所有片段连接起来，以重建完整的翻译文本块。
      if (!data || !Array.isArray(data[0])) {
        throw new Error('Invalid response structure from Google API');
      }

      const translatedText = data[0].map(chunk => chunk[0]).join('');

      return { text: translatedText, log: log };
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