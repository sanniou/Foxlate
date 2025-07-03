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
    },

    displayLoading: function(element) {
        // 仅当尚未保存时，才保存原始 HTML。
        if (element.dataset.originalContent === undefined) {
            element.dataset.originalContent = element.innerHTML;
        }
        // 添加一个 class 来改变文本样式（例如，变暗），而不是替换它。
        element.classList.add('foxlate-replacing');
        // 附加一个加载指示器，而不是替换全部内容
        if (!element.querySelector('.foxlate-inline-loading')) {
            const spinner = document.createElement('span');
            spinner.className = 'foxlate-inline-loading';
            element.appendChild(spinner);
        }
    },

    hideLoading: function(element) {
        // 移除加载状态的样式和指示器
        element.classList.remove('foxlate-replacing');
        element.querySelector('.foxlate-inline-loading')?.remove();
    }
    ,
    updateUI: function(element, state) {
        switch (state) {
            case window.DisplayManager.STATES.ORIGINAL:
                this.revertTranslation(element);
                break;
            case window.DisplayManager.STATES.LOADING:
                this.displayLoading(element);
                break;
            case window.DisplayManager.STATES.TRANSLATED:
                this.hideLoading(element); // 确保在处理此状态前移除加载状态
                const translatedText = element.dataset.translatedText;
                if (translatedText) {
                    this.displayTranslation(element, translatedText);
                } else {
                    this.revertTranslation(element);
                }
                break;
            case window.DisplayManager.STATES.ERROR:
                this.hideLoading(element); // 确保在显示错误前移除加载状态
                // 错误状态：显示错误信息，并添加错误样式
                const errorMessage = element.dataset.errorMessage || 'Translation Error';
                element.innerHTML = `<span class="foxlate-error">${errorMessage}</span>`;
                element.classList.add('foxlate-error-underline');
                break;
            default:
                console.warn(`[Replace Strategy] Unknown state: ${state}`);
                break;
        }
    }
};