// 定义所有翻译器都必须遵守的“契约”
export class BaseTranslator {
  constructor(name) {
    if (this.constructor === BaseTranslator) {
      throw new Error("Abstract classes can't be instantiated.");
    }
    this.name = name;
  }

  /**
   * 翻译文本
   * @param {string} text - 需要翻译的文本
   * @param {string} targetLang - 目标语言
   * @param {string} [sourceLang='auto'] - 源语言 (可选)
   * @param {object} [options] - 翻译器特定选项 (例如 AI 配置)
   * @param {AbortSignal} [signal] - 用于中止请求的信号
   * @returns {Promise<{text: string, log: string[]}>} - 包含翻译文本和日志的 Promise
   */
 // 翻译方法现在应该返回一个包含翻译文本和日志的 Promise
  async translate(text, targetLang, sourceLang = 'auto', options, signal) {
    throw new Error('Translate method must be implemented by subclass and return { text: string, log: string[] }');
  }
}
