import browser from '../../lib/browser-polyfill.js';
import { BaseTranslator } from './base-translator.js';

export class AITranslator extends BaseTranslator {
  constructor() {
    super('AI');
  }

  async translate(text, targetLang, sourceLang = 'auto', aiConfig = {}, signal) {
    const log = []; // 为当前翻译操作创建本地日志
    const { apiKey, apiUrl, model, customPrompt: customPromptTemplate, context } = aiConfig;
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(browser.i18n.getMessage('aiApiKeyMissingError'));
    }

    if (!customPromptTemplate || customPromptTemplate.trim() === '') {
      throw new Error(browser.i18n.getMessage('aiCustomPromptMissingError'));
    }
    
    if (!apiUrl || apiUrl.trim() === '') {
      throw new Error(browser.i18n.getMessage('aiApiUrlMissingError'));
    }

    if (!model || model.trim() === '') {
      throw new Error(browser.i18n.getMessage('aiModelNameMissingError'));
    }

    log.push(browser.i18n.getMessage('logEntryApiRequest', this.name));
    log.push(`[API URL] ${apiUrl}`); // 记录实际调用的 URL

    // 构建占位符替换映射
    const placeholderMap = {
      '{targetLang}': targetLang,
      '{sourceLang}': sourceLang,
      '{context}': context || ''
    };

    // 替换所有支持的占位符
    let systemPrompt = customPromptTemplate;
    for (const [placeholder, value] of Object.entries(placeholderMap)) {
      systemPrompt = systemPrompt.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    // 根据输入类型构建消息
    let userMessages;
    if (Array.isArray(text)) {
        // 如果输入是数组（对话历史），直接使用
        userMessages = text;
    } else {
        // 如果输入是字符串（简单翻译或总结），包装成标准的用户消息
        userMessages = [{ role: 'user', content: text }];
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          // (已修改) 将系统提示和用户消息（或历史记录）合并
          messages: [{ role: 'system', content: systemPrompt }, ...userMessages],
          temperature: 0.1, // Lower temperature for more deterministic translations
        }),
        signal, // 将 AbortSignal 传递给 fetch
      });

      if (!response.ok) {
        log.push(browser.i18n.getMessage('logEntryApiResponseError', [response.status, response.statusText]));
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData?.error?.message || `${response.status} ${response.statusText}`;
        throw new Error(`API Error: ${errorMessage}`);
      }

      const data = await response.json();
      log.push(browser.i18n.getMessage('logEntryApiResponseSuccess', JSON.stringify(data).substring(0, 200) + (JSON.stringify(data).length > 200 ? '...' : '')));
      
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        const translatedText = data.choices[0].message.content.trim();
        return { text: translatedText, log: log }; // 返回翻译文本和日志
      } else {
        throw new Error('Invalid response structure from AI API');
      }

    } catch (error) {
      // 如果是中止错误，直接重新抛出，以便上游可以正确处理
      if (error.name === 'AbortError') {
        throw error;
      }
      log.push(browser.i18n.getMessage('logEntryTranslationError', error.message));
      console.error(`AI Translation Error: ${error.message}`); // 仍然保留控制台错误
      throw new Error(`AI translation failed: ${error.message}`);
    }
  }
}