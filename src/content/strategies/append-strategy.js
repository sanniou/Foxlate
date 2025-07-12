import * as Constants from '../../common/constants.js';

class AppendStrategy {
    /**
     * 在元素后面追加一个包含译文的节点。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation(element, translatedText) {
        // 查找已有的翻译 font 标签，有则更新，无则创建
        let translationNode = element.querySelector(".foxlate-appended-text");

        if (translationNode) {
            // Node exists, just update it.
            // 使用 innerHTML 来正确渲染包含 <br> 标签的换行文本。
            translationNode.innerHTML = translatedText;
        } else {
            // This path is a fallback for cases where the node wasn't created during the LOADING state.
            this.createTranslationNode(element, translatedText);
        }
    }

    createTranslationNode(element, htmlContent, initialClass = '') {
        const type = element.dataset.translationType;
        let finalClassName = 'foxlate-appended-text';

        if (type === 'block') {
            finalClassName += ' foxlate-appended-block';
        }
        if (initialClass) {
            finalClassName += ` ${initialClass}`;
        }

        const translationNode = document.createElement('span');
        translationNode.className = finalClassName; // 类名用于标识和还原
        translationNode.innerHTML = htmlContent;
        element.appendChild(translationNode);
    }

    updateUI(element, state) {
        let translationNode = element.querySelector('.foxlate-appended-text');

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                this.revertTranslation(element);
                break;
            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                if (translationNode) {
                    translationNode.innerHTML = '';
                    translationNode.classList.add('loading');
                } else {
                    this.createTranslationNode(element, '', 'loading');
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                const translatedText = element.dataset.translatedText;
                if (translatedText) {
                    this.displayTranslation(element, translatedText);
                    // 重新获取节点，因为它可能刚刚被 displayTranslation 创建
                    translationNode = element.querySelector('.foxlate-appended-text');
                    translationNode?.classList.remove('loading', 'error');
                } else {
                    this.revertTranslation(element);
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                // 不再直接移除，而是在追加的节点中显示错误信息
                if (!translationNode) {
                    // 如果节点不存在（例如，加载状态之前就出错了），则创建一个
                    this.createTranslationNode(element, '');
                    translationNode = element.querySelector('.foxlate-appended-text');
                }

                if (translationNode) {
                    const errorMessage = element.dataset.errorMessage || 'Unknown error';
                    const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';

                    translationNode.classList.remove('loading');
                    translationNode.classList.add('error'); // 添加 error 类以便 CSS 设置样式
                    translationNode.innerHTML = `${errorPrefix}: ${errorMessage}`;
                }
                break;
            default:
                console.warn(`[Append Strategy] Unknown state: ${state}`);
        }
    }

    /**
     * 移除追加的翻译节点。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation(element) {
        // 移除所有由这个策略添加的节点
        element.querySelectorAll('.foxlate-appended-text').forEach(node => {
            if (node) {
                node.remove();
            }
        });
    }
}

// 导出该类的一个实例，以保持单例模式
export default new AppendStrategy();