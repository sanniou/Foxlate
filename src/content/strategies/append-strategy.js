import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';
import { escapeHtml } from '../../common/utils.js';
import { reconstructDOM } from '../dom-reconstructor.js';

class AppendStrategy {
    /**
     * 移除追加的翻译元素。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation(element) {
        element.querySelector('.foxlate-appended-text')?.remove();
    }

    updateUI(element, state) {
        // 在更新UI前，总是先清理掉旧的追加元素，以避免重复。
        this.revertTranslation(element);

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // revertTranslation 已在上面调用，无需额外操作。
                break;

            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                const loadingIndicator = document.createElement('span');
                loadingIndicator.className = `foxlate-appended-text foxlate-appended-${element.dataset.appendType} loading`;
                loadingIndicator.textContent = '...';
                element.appendChild(loadingIndicator);
                break;

            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                const data = DisplayManager.getElementData(element);
                if (!data || !data.translatedText) {
                    this.revertTranslation(element);
                    return;
                }

                const appendType = element.dataset.appendType === 'inline' ? 'span' : 'div';
                const appendedElement = document.createElement(appendType);
                appendedElement.className = `foxlate-appended-text foxlate-appended-${element.dataset.appendType}`;

                // 检查是否存在格式保留翻译所需的数据
                if (data.translationUnit?.nodeMap) {
                    try {
                        const fragment = reconstructDOM(data.translatedText, data.translationUnit.nodeMap);
                        appendedElement.appendChild(fragment);
                    } catch (e) {
                        console.error("[Append Strategy] 重建DOM失败，回退到纯文本追加。", e);
                        appendedElement.innerHTML = escapeHtml(data.translatedText).replace(/\n/g, '<br>');
                    }
                } else {
                    // 如果没有nodeMap，说明是简单文本，执行纯文本追加
                    appendedElement.innerHTML = escapeHtml(data.translatedText).replace(/\n/g, '<br>');
                }
                element.appendChild(appendedElement);
                break;

            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                const errorData = DisplayManager.getElementData(element);
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                const errorMessage = errorData?.errorMessage || 'Translation Error';
                const fullErrorMessage = `⚠️ ${escapeHtml(errorPrefix)}: ${escapeHtml(errorMessage)}`;

                const errorAppendType = element.dataset.appendType === 'inline' ? 'span' : 'div';
                const errorElement = document.createElement(errorAppendType);
                errorElement.className = `foxlate-appended-text foxlate-appended-${element.dataset.appendType} error`;
                errorElement.innerHTML = fullErrorMessage; // fullErrorMessage is already escaped
                element.appendChild(errorElement);
                break;

            default:
                console.warn(`[Append Strategy] Unknown state: ${state}`);
        }
    }
}

export default new AppendStrategy();