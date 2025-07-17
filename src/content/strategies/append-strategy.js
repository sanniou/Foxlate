import browser from '../../lib/browser-polyfill.js';
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
        const blockSelectors = 'p, div, h1, h2, h3, h4, h5, h6, li, tr, td, th, blockquote, pre, section, article, header, footer, nav, aside, form, hr, table';
        const hasBlockChildren = element.querySelector(blockSelectors);
        const textLength = (element.textContent || '').trim().length;

        if (hasBlockChildren || textLength > 80) {
            return 'block';
        }
        // 规则 2: 优先检查计算样式，做出更明确的判断
        const style = window.getComputedStyle(element);
        const display = style.display;
        const floating = style.float;

        // 明确的块级行为：如果 display 是 block, flex, grid 等，或者元素是浮动的，都应视为块级追加。
        // 这些 display 类型在文档流中都会表现为“块”。
        if (display === 'block' || display === 'flex' || display === 'grid' || display === 'table' || display === 'list-item' || floating !== 'none') {
            return 'block';
        }
        
        // 如果是明确的内联元素，则追加为内联。
        if (display.startsWith('inline')) { // 涵盖 'inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table' 等
            return 'inline';
        }

        // 规则 3: 安全回退。对于其他情况，默认追加为 'inline'，以避免不必要的强制换行。
        return 'inline';
    }

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

        // 关键：追加策略现在自己决定其追加类型，而不是依赖 DisplayManager。
        const appendType = this.#classifyAppendType(element);

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // revertTranslation 已在上面调用，无需额外操作。
                break;

            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                const loadingIndicator = this.#createAppendWrapper(appendType, ['loading']);
                element.appendChild(loadingIndicator);
                break;

            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                const data = DisplayManager.getElementData(element);
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