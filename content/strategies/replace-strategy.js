window.replaceStrategy = {
    displayTranslation: function(element, translatedText) {
        // 保存原文，以便恢复或悬浮显示
        if (!element.dataset.originalText) {
            element.dataset.originalText = element.textContent;
        }
        element.textContent = translatedText;
    },

    revertTranslation: function(element) {
        if (element.dataset.originalText !== undefined) {
            element.textContent = element.dataset.originalText;
            delete element.dataset.originalText;
            delete element.dataset.translationStrategy;
        }
    }
};
