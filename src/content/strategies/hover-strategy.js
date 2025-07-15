import browser from '../../lib/browser-polyfill.js';
import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';
import TooltipManager from '../tooltip-manager.js';

class HoverStrategy {
    /**
     * 为元素添加悬停事件，以显示包含译文的工具提示。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} text - 要显示的文本（可以是译文或错误信息）。
     * @param {boolean} isError - 指示文本是否为错误信息。
     */
    displayTranslation(element, text, isError = false) {
        element.classList.add('foxlate-hover-highlight');

        const handleMouseEnter = () => {
            TooltipManager.show(text, { targetElement: element, isError, type: 'hover' });
        };

        const handleMouseLeave = () => {
            TooltipManager.hide();
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
    revert(element) {
        // 移除所有可能由该策略添加的样式。
        element.classList.remove('foxlate-hover-highlight', 'foxlate-loading-highlight');

        if (element._foxlateHoverHandlers) {
            element.removeEventListener('mouseenter', element._foxlateHoverHandlers.handleMouseEnter);
            element.removeEventListener('mouseleave', element._foxlateHoverHandlers.handleMouseLeave);
            delete element._foxlateHoverHandlers;
        }
        // 确保在恢复时，如果鼠标恰好还在元素上，工具提示也会被隐藏。
        TooltipManager.hide();
    }

    /**
     * Implements the global cleanup interface for DisplayManager.
     * This ensures any visible hover tooltip is hidden during a full page revert.
     */
    globalCleanup() {
        TooltipManager.hide();
    }

    updateUI(element, state) {
        // 在应用新状态前，先清理旧状态，确保元素处于干净状态。
        this.revert(element);

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // revert 已在 switch 外部调用，此处无需操作。
                break;
            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                // 使用一个不同的高亮样式来表示正在加载
                element.classList.add('foxlate-loading-highlight');
                break;
            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                const data = DisplayManager.getElementData(element);
                // 使用由 DisplayManager 提供的、已清理的 plainText，
                // 以避免显示内部的 <t_id> 格式标签。
                if (data && data.plainText) {
                    // TooltipManager 会处理 HTML 转义和换行符
                    this.displayTranslation(element, data.plainText, false);
                } else {
                    this.revert(element);
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                const errorData = DisplayManager.getElementData(element);
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                const errorMessage = errorData?.errorMessage || 'Translation Error';
                // TooltipManager 会处理 HTML 转义
                const fullErrorMessage = `⚠️ ${errorPrefix}: ${errorMessage}`;
                this.displayTranslation(element, fullErrorMessage, true);
                break;
            default:
                console.warn(`[Hover Strategy] Unknown state: ${state}`);
        }
    }
}

// 导出该类的一个实例，以保持单例模式
export default new HoverStrategy();