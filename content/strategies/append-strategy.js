window.appendTranslationStrategy = {
    /**
     * 在元素后面追加一个包含译文的节点。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation: function(element, translatedText) {
        // 查找已有的翻译 font 标签，有则更新，无则创建
        let translationNode = element.querySelector('.foxlate-appended-text');
        if (translationNode) {
            translationNode.textContent = ` ( ${translatedText} )`;
        } else {
            translationNode = document.createElement('span');
            translationNode.className = 'foxlate-appended-text'; // 类名用于标识和还原
            translationNode.textContent = ` ( ${translatedText} )`;
            element.appendChild(translationNode);
        }
    },
   displayLoading: function(element) {
       let translationNode = element.querySelector('.foxlate-appended-text');
       if (translationNode) {
           translationNode.textContent = ` (翻译中...)`; // 你可以自定义加载文本
       } else {
           translationNode = document.createElement('span');
           translationNode.className = 'foxlate-appended-text loading'; // 添加 loading 类
           translationNode.textContent = ` (翻译中...)`;
           element.appendChild(translationNode);
       }
    },

    hideLoading: function(element) {
        // 移除 loading 类，以便区分正常翻译和加载状态
        element.querySelector('.foxlate-appended-text')?.classList.remove('loading');
    },
    /**
     * 移除追加的翻译节点。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation: function(element) {
        // 移除所有由这个策略添加的节点
        element.querySelectorAll('.foxlate-appended-text').forEach(node => {
            if (node) {
                node.remove();
            }
        });
    }
};