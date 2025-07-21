import browser from '../../lib/browser-polyfill.js';
import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';
import { escapeHtml } from '../../common/utils.js';
import { reconstructDOM } from '../dom-reconstructor.js';

class AppendStrategy {
    /**
     * 移除追加的翻译元素。
     * 此方法是策略接口的一部分，由 DisplayManager 调用以将元素恢复到其原始状态。
     * @param {HTMLElement} element - 目标元素。
     */
    revert(element) {
        element.querySelector('.foxlate-appended-text')?.remove();
    }

    /**
 * @private
 * 创建用于追加的包装元素
 * @param {'inline' | 'block'} appendType 
 * @param {string[]} additionalClasses - 额外的 CSS 类名，如 'loading', 'error'
 * @returns {HTMLElement}
 */
    #createAppendWrapper(appendType, additionalClasses = []) {
        const tag = appendType === 'inline' ? 'span' : 'div';
        const wrapper = document.createElement(tag);
        const classNames = ['foxlate-appended-text', `foxlate-appended-${appendType}`, ...additionalClasses];
        wrapper.className = classNames.join(' ');
        // (新) 添加一个明确的标记，以便 DOMWalker 可以在源头识别并忽略此元素，
        // 防止对已追加的译文进行重复翻译。
        wrapper.dataset.foxlateAppendedText = 'true';
        return wrapper;
    }

    updateUI(element, state) {
        // 在更新UI前，总是先清理掉旧的追加元素，以避免重复。
        this.revert(element);

        // 从 DisplayManager 获取包括 appendType 在内的所有数据。
        // appendType 由 DOMWalker 在初始阶段根据用户配置和启发式算法决定，确保了配置的权威性。
        const data = DisplayManager.getElementData(element);
        const appendType = data?.translationUnit?.appendType || 'inline'; // 安全回退到 'inline'

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // revertTranslation 已在上面调用，无需额外操作。
                break;

            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                const loadingIndicator = this.#createAppendWrapper(appendType, ['loading']);
                element.appendChild(loadingIndicator);
                break;

            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                if (!data || !data.translatedText) {
                    this.revert(element);
                    return;
                }

                const appendedElement = this.#createAppendWrapper(appendType);
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

                const errorElement = this.#createAppendWrapper(appendType, ['error']);
                errorElement.textContent = `⚠️ ${errorPrefix}: ${errorMessage}`; // 使用 textContent 更安全，因为前缀是固定的，错误信息已在前面处理过，或者假设其为纯文本。
                element.appendChild(errorElement);
                break;

            default:
                console.warn(`[Append Strategy] Unknown state: ${state}`);
        }
    }
}

export default new AppendStrategy();