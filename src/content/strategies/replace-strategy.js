import * as Constants from '../../common/constants.js';

class ReplaceStrategy {
    /**
     * @private
     * 仅在需要时保存元素的原始内容，以避免重复保存或覆盖。
     * @param {HTMLElement} element - 目标元素。
     */
    #saveOriginalContent(element) {
        // 仅当尚未保存时，才保存原始 HTML。
        // 这可以防止在显示模式切换时，已翻译的内容被错误地当成原始内容保存。
        if (element.dataset.originalContent === undefined) {
            element.dataset.originalContent = element.innerHTML;
        }
    }

    /**
     * 直接用译文替换元素的可见内容。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation(element, translatedText) {
        this.#saveOriginalContent(element);
        element.innerHTML = translatedText;
    }

    /**
     * 将元素的内容恢复为原始状态。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation(element) {
        if (element.dataset.originalContent !== undefined) {
            element.innerHTML = element.dataset.originalContent;
            delete element.dataset.originalContent; // 清理属性
        }
        // 确保移除所有此策略可能添加的视觉效果
        element.classList.remove('foxlate-replacing', 'foxlate-error-underline');
        element.querySelector('.foxlate-inline-loading')?.remove();
    }

    updateUI(element, state) {
        // 在应用新状态前，先清理掉旧状态的视觉效果（但不恢复内容）。
        // 这样可以避免在状态切换时残留旧的样式。
        element.classList.remove('foxlate-replacing', 'foxlate-error-underline');
        element.querySelector('.foxlate-inline-loading')?.remove();

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                this.revertTranslation(element);
                break;
            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                this.#saveOriginalContent(element);
                // 添加一个 class 来改变文本样式（例如，变暗），而不是替换它。
                element.classList.add('foxlate-replacing');
                // 附加一个加载指示器，而不是替换全部内容
                if (!element.querySelector('.foxlate-inline-loading')) {
                    const spinner = document.createElement('span');
                    spinner.className = 'foxlate-inline-loading';
                    element.appendChild(spinner);
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                const translatedText = element.dataset.translatedText;
                if (translatedText) {
                    this.displayTranslation(element, translatedText);
                } else {
                    // 如果没有译文，则恢复原状
                    this.revertTranslation(element);
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                this.#saveOriginalContent(element); // 确保我们可以从错误状态恢复
                const errorMessage = element.dataset.errorMessage || 'Translation Error';
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                // 直接替换内容为带图标的错误信息
                element.innerHTML = `⚠️ ${errorPrefix}: ${errorMessage}`;
                element.classList.add('foxlate-error-underline');
                break;
            default:
                console.warn(`[Replace Strategy] Unknown state: ${state}`);
        }
    }
}

// 导出该类的一个实例，以保持单例模式
export default new ReplaceStrategy();