window.replaceStrategy = {
    /**
     * 直接用译文替换元素的可见内容。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation: function(element, translatedText) {
        // DisplayManager 已经将原始内容保存在 data-original-content 属性中。
        // 此函数仅负责更新元素的 innerHTML 以显示译文。
        element.innerHTML = translatedText;
    },
    /**
     * 将元素的内容恢复为原始状态。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} originalHTML - 由 DisplayManager 提供的原始内部HTML。
     */
    revertTranslation: function(element, originalHTML) {
        if (originalHTML !== undefined) {
            element.innerHTML = originalHTML;
        }
    }
};