import { BaseTranslator } from './base-translator.js';

export class GoogleTranslator extends BaseTranslator {
  constructor() {
    super('Google');
    // 使用谷歌翻译网页版使用的免费、非官方API端点
    this.apiUrl = 'https://translate.googleapis.com/translate_a/single';
  }

  async translate(text, targetLang, sourceLang = 'auto') {
    // 这个免费API不需要API Key
    const url = new URL(this.apiUrl);
    url.searchParams.append('client', 'gtx'); // 或者 't', 'webapp'
    url.searchParams.append('sl', sourceLang); // source language
    url.searchParams.append('tl', targetLang); // target language
    url.searchParams.append('dt', 't'); // return translation
    url.searchParams.append('q', text); // query text

    try {
      // 该API使用GET请求
      const response = await fetch(url.toString());

      if (!response.ok) {
        // 429 Too Many Requests 是一个常见的错误
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        throw new Error(`API Error: ${response.status} ${response.statusText}.`);
      }

      const data = await response.json();
      // 免费API的响应是一个复杂的嵌套数组
      // data[0] 是一个包含所有翻译片段的数组
      // 每个片段的第一个元素是翻译后的文本
      // 我们需要将所有片段连接起来
      return data[0]?.map(chunk => chunk[0]).join('') || '';
    } catch (error) {
      console.error(`Google Translation Error: ${error.message}`);
      throw new Error(`Google translation failed: ${error.message}`);
    }
  }
}