window.appendTranslationStrategy = {
    /**
     * 在元素后面追加一个包含译文的节点。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation: function(element, translatedText) {
        // 查找已有的翻译 font 标签，有则更新，无则创建
        let translationNode = element.querySelector('.translator-appended-text');
        if (translationNode) {
            translationNode.textContent = ` ( ${translatedText} )`;
        } else {
            translationNode = document.createElement('span');
            translationNode.className = 'translator-appended-text'; // 类名用于标识和还原
            translationNode.textContent = ` ( ${translatedText} )`;
            element.appendChild(translationNode);
        }
    },

    /**
     * 移除追加的翻译节点。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation: function(element) {
        // 只移除由这个策略添加的节点，这是更精确和高效的做法。
        const translationNode = element.querySelector('.translator-appended-text');
        if (translationNode) {
            translationNode.remove();
        }
    }
};