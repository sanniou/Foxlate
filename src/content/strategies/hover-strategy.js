import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';

class HoverStrategy {
    /**
     * @private
     * 持有单一的工具提示元素实例。
     */
    #tooltipEl = null;

    /**
     * @private
     * Escapes a string for safe insertion into HTML.
     * @param {string} unsafe - The string to escape.
     * @returns {string} The escaped string.
     */
    #escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * @private
     * 如果工具提示元素不存在，则创建并附加到 body。
     * 这是一个惰性创建，只在第一次需要时执行。
     */
    #createTooltip() {
        if (this.#tooltipEl) return;
        this.#tooltipEl = document.createElement('div');
        this.#tooltipEl.className = 'foxlate-panel hover-tooltip';
        document.body.appendChild(this.#tooltipEl);
    }

    /**
     * @private
     * 显示工具提示，并将其定位在目标元素的上方或下方。
     * @param {HTMLElement} targetElement - 触发悬停的元素。
     * @param {string} text - 要在工具提示中显示的文本。
     * @param {boolean} isError - 是否为错误提示。
     */
    #showTooltip(targetElement, text, isError = false) {
        this.#createTooltip();
        if (!this.#tooltipEl) return;

        // 使用 innerHTML 来正确渲染包含 <br> 标签的换行文本。
        // display-manager 已经对文本进行了 HTML 转义，因此这里是安全的。
        this.#tooltipEl.innerHTML = text;
        // 根据 isError 标志切换错误样式
        this.#tooltipEl.classList.toggle('error', isError);
        this.#tooltipEl.classList.add('visible');

        const targetRect = targetElement.getBoundingClientRect();
        const tooltipRect = this.#tooltipEl.getBoundingClientRect();

        // 默认水平居中于目标元素
        let x = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        // 默认定位在目标元素上方，并留出 8px 间隙
        let y = targetRect.top - tooltipRect.height - 8;

        // 如果上方空间不足，则移动到下方
        if (y < 10) { // 10px 顶部安全边距
            y = targetRect.bottom + 8;
        }

        // 确保不会超出窗口左右边缘
        if (x < 10) {
            x = 10;
        } else if (x + tooltipRect.width > window.innerWidth - 10) {
            x = window.innerWidth - tooltipRect.width - 10;
        }

        this.#tooltipEl.style.left = `${x}px`;
        this.#tooltipEl.style.top = `${y}px`;
    }

    /**
     * @private
     * 隐藏工具提示。
     */
    #hideTooltip() {
        if (this.#tooltipEl) {
            this.#tooltipEl.classList.remove('visible');
        }
    }

    /**
     * 为元素添加悬停事件，以显示包含译文的工具提示。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} text - 要显示的文本（可以是译文或错误信息）。
     * @param {boolean} isError - 指示文本是否为错误信息。
     */
    displayTranslation(element, text, isError = false) {
        // 为元素添加高亮样式，以在视觉上表明它已被处理并可悬停。
        element.classList.add('foxlate-hover-highlight');

        const handleMouseEnter = () => {
            // 文本和错误状态由闭包捕获，无需再次查询状态。
            this.#showTooltip(element, text, isError);
        };

        const handleMouseLeave = () => {
            this.#hideTooltip();
        };

        // 将处理函数附加到元素上，以便 revert 时可以精确移除
        element._foxlateHoverHandlers = { handleMouseEnter, handleMouseLeave };

        element.addEventListener('mouseenter', handleMouseEnter);
        element.addEventListener('mouseleave', handleMouseLeave);
    }

    /**
     * 移除元素的悬停事件监听器并清理状态。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation(element) {
        // 移除所有可能由该策略添加的样式。
        element.classList.remove('foxlate-hover-highlight', 'foxlate-loading-highlight');

        if (element._foxlateHoverHandlers) {
            element.removeEventListener('mouseenter', element._foxlateHoverHandlers.handleMouseEnter);
            element.removeEventListener('mouseleave', element._foxlateHoverHandlers.handleMouseLeave);
            delete element._foxlateHoverHandlers;
        }
        // 确保在恢复时，如果鼠标恰好还在元素上，工具提示也会被隐藏。
        this.#hideTooltip();
    }

    /**
     * Implements the global cleanup interface for DisplayManager.
     * This ensures any visible hover tooltip is hidden during a full page revert.
     */
    globalCleanup() {
        this.#hideTooltip();
    }

    updateUI(element, state) {
        // 在应用新状态前，先清理旧状态，确保元素处于干净状态。
        this.revertTranslation(element);

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // revertTranslation 已在 switch 外部调用，此处无需操作。
                break;
            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                // 使用一个不同的高亮样式来表示正在加载
                element.classList.add('foxlate-loading-highlight');
                break;
            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                const data = DisplayManager.getElementData(element);
                if (data && data.translatedText) {
                    const processedText = this.#escapeHtml(data.translatedText).replace(/\n/g, '<br>');
                    this.displayTranslation(element, processedText, false);
                } else {
                    this.revertTranslation(element);
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                const errorData = DisplayManager.getElementData(element);
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                const errorMessage = errorData?.errorMessage || 'Translation Error';
                const fullErrorMessage = `⚠️ ${this.#escapeHtml(errorPrefix)}: ${this.#escapeHtml(errorMessage)}`;
                this.displayTranslation(element, fullErrorMessage, true);
                break;
            default:
                console.warn(`[Hover Strategy] Unknown state: ${state}`);
        }
    }
}

// 导出该类的一个实例，以保持单例模式
export default new HoverStrategy();