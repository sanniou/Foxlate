import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';
import { escapeHtml } from '../../common/utils.js';
import { reconstructDOM } from '../dom-reconstructor.js';

class AppendStrategy {
    /**
     * @private
     * (新) 通过启发式算法对元素进行分类，以确定最佳的追加样式。
     * 此逻辑已从 DisplayManager 移至此处，以实现更好的内聚性。
     * @param {HTMLElement} element
     * @returns {'inline' | 'block'}
     */
    #classifyAppendType(element) {
        // 规则 1: 结构性内容优先。如果元素内包含块级子元素，或者文本量很大，
        // 那么它自身就应被视为一个块级容器，追加的内容应该换行。
        const hasBlockChildren = element.querySelector('p, div, h1, h2, h3, li, tr, blockquote');
        const textLength = (element.textContent || '').trim().length;

        if (hasBlockChildren || textLength > 80) {
            return 'block';
        }

        // 规则 2: 检查元素的计算样式。
        const display = window.getComputedStyle(element).display;

        // 如果是明确的内联元素，则追加为内联。
        if (display === 'inline' || display === 'inline-block') {
            return 'inline';
        }

        // 规则 3: 安全回退。对于其他情况，默认追加为 'inline'，以避免不必要的强制换行。
        return 'inline';
    }

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

        // 关键：追加策略现在自己决定其追加类型，而不是依赖 DisplayManager。
        const appendType = this.#classifyAppendType(element);

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // revertTranslation 已在上面调用，无需额外操作。
                break;

            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                const loadingIndicator = document.createElement('span');
                loadingIndicator.className = `foxlate-appended-text foxlate-appended-${appendType} loading`;
                loadingIndicator.textContent = '...';
                element.appendChild(loadingIndicator);
                break;

            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                const data = DisplayManager.getElementData(element);
                if (!data || !data.translatedText) {
                    this.revertTranslation(element);
                    return;
                }

                const appendTag = appendType === 'inline' ? 'span' : 'div';
                const appendedElement = document.createElement(appendTag);
                appendedElement.className = `foxlate-appended-text foxlate-appended-${appendType}`;

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

                const errorAppendTag = appendType === 'inline' ? 'span' : 'div';
                const errorElement = document.createElement(errorAppendTag);
                errorElement.className = `foxlate-appended-text foxlate-appended-${appendType} error`;
                errorElement.innerHTML = fullErrorMessage; // fullErrorMessage is already escaped
                element.appendChild(errorElement);
                break;

            default:
                console.warn(`[Append Strategy] Unknown state: ${state}`);
        }
    }
}

export default new AppendStrategy();