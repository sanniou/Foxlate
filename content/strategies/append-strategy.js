window.appendTranslationStrategy = {
    /**
     * 在元素后面追加一个包含译文的节点。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation: function(element, translatedText) {
        // DisplayManager 负责保存原始状态。此函数只关心显示。

        // 查找已有的翻译 font 标签，有则更新，无则创建
        let translationNode = element.querySelector('.translator-appended-text');
        if (translationNode) {
            translationNode.textContent = ` ( ${translatedText} )`;
        } else {
            translationNode = document.createElement('span');
            translationNode.className = 'translator-appended-text'; // 类名用于标识和还原
            translationNode.style.color = 'gray';
            translationNode.style.marginLeft = '8px';
            translationNode.textContent = ` ( ${translatedText} )`;
            element.appendChild(translationNode);
        }
    },

    /**
     * 移除追加的翻译节点。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} originalHTML - 由 DisplayManager 提供的原始内部HTML。
     */
    revertTranslation: function(element, originalHTML) {
        // 恢复到原始HTML，这比仅仅移除追加的节点更可靠和一致。
        if (originalHTML !== undefined) {
            element.innerHTML = originalHTML;
        }
    }
};