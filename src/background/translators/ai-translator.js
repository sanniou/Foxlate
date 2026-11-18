import browser from '../../lib/browser-polyfill.js';
import { BaseTranslator } from './base-translator.js';
import { createRequestSignal } from './request-timeout.js';
import { formatContextString } from '../../common/context-extractor.js';

export class AITranslator extends BaseTranslator {
  constructor() {
    super('AI');
  }

  #createSystemPrompt(text, targetLang, sourceLang, aiConfig) {
    const { customPrompt: customPromptTemplate, context } = aiConfig;
    const placeholderMap = {
      '{targetLang}': targetLang,
      '{sourceLang}': sourceLang,
      '{context}': context ? (typeof context === 'string' ? context : formatContextString(context)) : '',
      '{textToTranslate}': Array.isArray(text) ? JSON.stringify(text) : text
    };

    let systemPrompt = customPromptTemplate;
    for (const [placeholder, value] of Object.entries(placeholderMap)) {
      const pattern = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
      // 函数式替换：value 是用户/页面数据，可能包含 `$&`、`$'`、`$1`。字符串形式的
      // 替换值会被当作替换模式解析，把用户文本折叠成别的字符。
      systemPrompt = systemPrompt.replace(pattern, () => value);
    }
    return systemPrompt;
  }

  #validateConfig(aiConfig = {}) {
    const { apiKey, apiUrl, model, customPrompt } = aiConfig;
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(browser.i18n.getMessage('aiApiKeyMissingError'));
    }

    if (!customPrompt || customPrompt.trim() === '') {
      throw new Error(browser.i18n.getMessage('aiCustomPromptMissingError'));
    }
    
    if (!apiUrl || apiUrl.trim() === '') {
      throw new Error(browser.i18n.getMessage('aiApiUrlMissingError'));
    }

    if (!model || model.trim() === '') {
      throw new Error(browser.i18n.getMessage('aiModelNameMissingError'));
    }
  }

  #parseBatchResponse(rawText, expectedCount) {
    let jsonText = rawText.trim();
    const fencedMatch = jsonText.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (fencedMatch) {
      jsonText = fencedMatch[1].trim();
    }

    const parsed = JSON.parse(this.#extractJsonArray(jsonText) ?? jsonText);
    if (!Array.isArray(parsed)) {
      throw new Error('AI batch response must be a JSON array.');
    }
    if (parsed.length !== expectedCount) {
      throw new Error(`AI batch response length mismatch: expected ${expectedCount}, got ${parsed.length}.`);
    }
    return parsed.map((item, index) => {
      if (typeof item !== 'string') {
        throw new Error(`AI batch response item ${index} must be a string.`);
      }
      return item;
    });
  }

  /**
   * 从“外面裹了一层话”的回复里抠出 JSON 数组。
   *
   * 模型经常回 `Here you go:\n[...]\nHope this helps`。整段 JSON.parse 会直接抛错，
   * 上游再把整批（最多十几条）判为失败。这里按括号配对找第一个完整数组，
   * 字符串里的括号不算（译文可能含 `>`、`[` 等字符）。
   */
  #extractJsonArray(text) {
    const start = text.indexOf('[');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '[') {
        depth += 1;
      } else if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, index + 1);
        }
      }
    }
    return null;
  }

  async translate(text, targetLang, sourceLang = 'auto', aiConfig = {}, signal) {
    const log = []; // 为当前翻译操作创建本地日志
    const { apiKey, apiUrl, model } = aiConfig;
    this.#validateConfig(aiConfig);

    log.push(browser.i18n.getMessage('logEntryApiRequest', this.name));
    log.push(`[API URL] ${apiUrl}`); // 记录实际调用的 URL

    const systemPrompt = this.#createSystemPrompt(text, targetLang, sourceLang, aiConfig);

    // 根据输入类型构建消息
    let userMessages;
    if (Array.isArray(text)) {
        // 如果输入是数组（对话历史），直接使用
        userMessages = text;
    } else {
        // 如果输入是字符串（简单翻译或总结），包装成标准的用户消息
        userMessages = [{ role: 'user', content: text }];
    }

    const request = createRequestSignal(signal, aiConfig?.timeoutMs);

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
        signal: request.signal, // 用户中止与超时合成的信号
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
    } finally {
      request.dispose();
    }
  }

  async translateBatch(texts, targetLang, sourceLang = 'auto', aiConfig = {}, signal) {
    if (!Array.isArray(texts)) {
      throw new Error('AI batch translation input must be an array.');
    }
    if (texts.length === 0) {
      return { texts: [], log: [] };
    }

    const log = [];
    const { apiKey, apiUrl, model } = aiConfig;
    this.#validateConfig(aiConfig);

    log.push(browser.i18n.getMessage('logEntryApiRequest', this.name));
    log.push(`[API URL] ${apiUrl}`);

    const baseSystemPrompt = this.#createSystemPrompt(texts, targetLang, sourceLang, aiConfig);
    const systemPrompt = `${baseSystemPrompt}

You are translating a JSON array of independent text segments. Return only a valid JSON array of strings.
Rules:
- Preserve input order and item count exactly.
- Do not add explanations, markdown, numbering, or keys.
- Preserve any XML-like placeholder tags such as <t0> and </t0>.`;

    const request = createRequestSignal(signal, aiConfig?.timeoutMs);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(texts) }
          ],
          temperature: 0.1,
        }),
        signal: request.signal,
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
        return { texts: this.#parseBatchResponse(translatedText, texts.length), log };
      }
      throw new Error('Invalid response structure from AI API');
    } catch (error) {
      if (error.name === 'AbortError') {
        throw error;
      }
      log.push(browser.i18n.getMessage('logEntryTranslationError', error.message));
      console.error(`AI Batch Translation Error: ${error.message}`);
      throw new Error(`AI batch translation failed: ${error.message}`);
    } finally {
      request.dispose();
    }
  }
}
