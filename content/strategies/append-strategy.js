window.appendTranslationStrategy = {
    /**
     * @private
     * Determines the correct CSS class for the appended node based on the parent's display style.
     * @param {HTMLElement} element - The wrapper element (`<font>`) to check against.
     * @returns {string} The base class name ('foxlate-appended-text' or 'foxlate-appended-text foxlate-appended-block').
     */
    _getAppendClassName: function(element) {
        const parentStyle = element.parentElement ? window.getComputedStyle(element.parentElement) : null;
        // A list of display values that imply a block-level context for our purpose.
        const blockContextDisplays = ['block', 'flex', 'grid', 'list-item', 'table', 'flow-root'];
        const isBlockContext = parentStyle && blockContextDisplays.some(d => parentStyle.display.startsWith(d));

        return isBlockContext
            ? 'foxlate-appended-text foxlate-appended-block'
            : 'foxlate-appended-text';
    },

    /**
     * 在元素后面追加一个包含译文的节点。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation: function(element, translatedText) {
        // 查找已有的翻译 font 标签，有则更新，无则创建
        let translationNode = element.querySelector(".foxlate-appended-text");

        if (translationNode) {
            // Node exists, just update it.
            translationNode.textContent = translatedText;
        } else {
            // This path is a fallback for cases where the node wasn't created during the LOADING state.
            const className = this._getAppendClassName(element);
            this.createTranslationNode(element, translatedText, className);
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
                    const className = this._getAppendClassName(element) + ' loading';
                    this.createTranslationNode(element,  '', className);
                }
                break;
            case window.DisplayManager.STATES.TRANSLATED:
                const translatedText = element.dataset.translatedText;
                if (translatedText) {
                    this.displayTranslation(element, translatedText);
                    element.querySelector('.foxlate-appended-text')?.classList.remove('loading', 'error');
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