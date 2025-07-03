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
            translationNode.textContent = translatedText;
        } else {
            this.createTranslationNode(element, translatedText);
        }
    },
    createTranslationNode: function(element, textContent, className = 'foxlate-appended-text') {
        let translationNode = document.createElement('span');
        translationNode.className = className; // 类名用于标识和还原
        translationNode.textContent = textContent;
        element.appendChild(translationNode);
    },

    updateUI: function(element, state) {
        let translationNode = element.querySelector('.foxlate-appended-text');

        switch (state) {
            case window.DisplayManager.STATES.ORIGINAL:
                this.revertTranslation(element);
                break;
            case window.DisplayManager.STATES.LOADING:
                if (translationNode) {
                    translationNode.textContent = '';
                    translationNode.classList.add('loading');
                } else {
                    this.createTranslationNode(element,  '', 'foxlate-appended-text loading');
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
                // 不再直接移除，而是在追加的节点中显示错误信息
                if (!translationNode) {
                    // 如果节点不存在（例如，加载状态之前就出错了），则创建一个
                    this.createTranslationNode(element, '', 'foxlate-appended-text');
                    translationNode = element.querySelector('.foxlate-appended-text');
                }

                if (translationNode) {
                    const errorMessage = element.dataset.errorMessage || 'Unknown error';
                    const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';

                    translationNode.classList.remove('loading');
                    translationNode.classList.add('error'); // 添加 error 类以便 CSS 设置样式
                    translationNode.textContent = `${errorPrefix}: ${errorMessage}`;
                }
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