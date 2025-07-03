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

    updateUI: function(element, state) {
        let translationNode = element.querySelector('.foxlate-appended-text');

        switch (state) {
            case window.DisplayManager.STATES.ORIGINAL:
                this.revertTranslation(element);
                break;
            case window.DisplayManager.STATES.LOADING:
                if (translationNode) {
                    translationNode.textContent = ` (翻译中...)`;
                    translationNode.classList.add('loading');
                } else {
                    translationNode = document.createElement('span');
                    translationNode.className = 'foxlate-appended-text loading';
                    translationNode.textContent = ` (翻译中...)`;
                    element.appendChild(translationNode);
                }
                break;
            case window.DisplayManager.STATES.TRANSLATED:
                const translatedText = element.dataset.translatedText;
                if (translatedText) {
                    this.displayTranslation(element, translatedText);
                    translationNode?.classList.remove('loading');
                } else {
                    this.revertTranslation(element);
                }
                break;
            case window.DisplayManager.STATES.ERROR:
                this.revertTranslation(element); // 出错时移除翻译标记
                break;
            default:
                console.warn(`[Append Strategy] Unknown state: ${state}`);
        }
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