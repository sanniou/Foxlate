import { BaseTranslator } from './base-translator.js';

export class GoogleTranslator extends BaseTranslator {
  constructor() {
    super('Google');
    // 使用谷歌翻译网页版使用的免费、非官方API端点
    this.apiUrl = 'https://translate.googleapis.com/translate_a/single';
  }

  async translate(text, targetLang, sourceLang = 'auto', options, signal) {
    const log = []; // 为当前翻译操作创建本地日志

    // 1. 按换行符分割原始文本，以保留空行信息
    // 使用正则表达式来分割，以兼容不同操作系统下的换行符（\n 和 \r\n）
    const originalLines = text.split(/\r?\n/);
    const resultLines2 = originalLines.map(originalLine => {
        if (originalLine.trim() !== '') {
          return originalLine; // 保护措施：如果翻译片段用完，则返回原始行
        } else {
          // 如果原始行是空的（或只包含空格），则保留为空行
          return '';
        }
      }).join('\n');
    // 增加日志记录，查看分割结果
    log.push(`原始文本按换行符分割后的数组：${JSON.stringify(originalLines)}, 测试${JSON.stringify(resultLines2)}`);

    // 2. 准备要发送给 API 的文本：过滤掉空行，然后用单个换行符连接
    //    这模拟了API对多个换行符的处理方式，但我们保留了原始结构以便后续重建
    const textToSend = originalLines.filter(line => line.trim() !== '').join('\n');

    // 如果过滤后没有文本（例如，只有空格和换行符），则直接返回原始文本，避免不必要的API调用
    if (!textToSend) {
      return { text: text, log: log };
    }

    const url = new URL(this.apiUrl);
    url.searchParams.append('client', 'gtx'); // 或者 't', 'webapp'
    url.searchParams.append('sl', sourceLang); // source language
    url.searchParams.append('tl', targetLang); // target language
    url.searchParams.append('dt', 't'); // return translation
    url.searchParams.append('q', textToSend); // query text

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

      // 3. API 返回的 data[0] 是一个片段数组，每个片段是 [translated_text, original_text, ...]
      const translatedSegments = data[0]?.map(chunk => chunk[0]) || [];

      // 4. 基于原始文本的行结构，重建翻译结果，以保留空行
      let translatedSegmentIndex = 0;
      const resultLines = originalLines.map(originalLine => {
        if (originalLine.trim() !== '') {
          // 如果原始行有内容，就用一个翻译好的片段替换它
          if (translatedSegmentIndex < translatedSegments.length) { // 检查翻译片段是否用完
            return translatedSegments[translatedSegmentIndex++];
          }
          return originalLine; // 保护措施：如果翻译片段用完，则返回原始行
        } else {
          // 如果原始行是空的（或只包含空格），则保留为空行
          return '';
        }
      });
      const translatedText = resultLines.filter(line => line !== '').join('\n');
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