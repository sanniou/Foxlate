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
   * @param {string} sourceLang - 源语言 (可选)
   * @returns {Promise<string>} - 翻译后的文本
   */
  async translate(text, targetLang, sourceLang = 'auto') {
    throw new Error("Method 'translate()' must be implemented.");
  }
}
