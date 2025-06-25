window.appendTranslationStrategy = {
    displayTranslation: function(element, translatedText) {
        if (!element.dataset.originalText) {
            element.dataset.originalText = element.textContent;
        }

        // 查找已有的翻译 font 标签，有则更新，无则创建
        let translationNode = element.querySelector('.translator-appended-text');
        if (translationNode) {
            translationNode.textContent = ` (${translatedText})`;
        } else {
            translationNode = document.createElement('font');
            translationNode.className = 'translator-appended-text'; // 类名用于标识和还原
            translationNode.style.marginLeft = '8px';
            translationNode.textContent = ` (${translatedText})`;
            element.appendChild(translationNode);
        }
    },

    revertTranslation: function(element) {
        const translationNode = element.querySelector('.translator-appended-text');
        if (translationNode) {
            translationNode.remove();
            delete element.dataset.originalText;
            delete element.dataset.translationStrategy;
        }
    }
};