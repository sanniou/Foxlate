window.replaceStrategy = {
    /**
     * 直接用译文替换元素的可见内容。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation: function(element, translatedText) {
        // 仅当尚未保存时，才保存原始 HTML。
        // 这可以防止在显示模式切换时，已翻译的内容被错误地当成原始内容保存。
        if (element.dataset.originalContent === undefined) {
            element.dataset.originalContent = element.innerHTML;
        }
        element.innerHTML = translatedText;
    },
    /**
     * 将元素的内容恢复为原始状态。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation: function(element) {
        if (element.dataset.originalContent !== undefined) {
            element.innerHTML = element.dataset.originalContent;
            delete element.dataset.originalContent; // 清理属性
        }
    }
};