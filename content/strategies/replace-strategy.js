window.replaceStrategy = {
    /**
     * 直接用译文替换元素的内容。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation: function(element, translatedText) {
        // 在应用翻译前，由 DisplayManager 负责保存原始状态。
        // 这个函数现在只关心如何“显示”翻译。
        // 为了保留原始的HTML结构（例如，<b>, <i> 标签），我们使用 innerHTML。
        // 注意：如果 translatedText 包含不安全的HTML，这可能是一个风险。
        // 但由于我们的翻译源是可信的API，并且我们不希望破坏内部格式，因此这是一个合理的折衷。
        element.innerHTML = translatedText;
    },

    /**
     * 将元素的内容恢复为原始状态。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} originalHTML - 由 DisplayManager 提供的原始内部HTML。
     */
    revertTranslation: function(element, originalHTML) {
        // 如果 DisplayManager 提供了原始HTML，就用它来恢复。
        if (originalHTML !== undefined) {
            element.innerHTML = originalHTML;
        }
        // 此策略不需要清理 dataset，因为状态由 DisplayManager 管理。
    }
};