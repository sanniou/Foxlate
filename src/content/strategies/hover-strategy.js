import browser from '../../lib/browser-polyfill.js';
import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';
import { HoverTooltipSurface } from '../tooltip/hover-tooltip-surface.js';

class HoverStrategy {
    #surface;

    constructor({ surface = new HoverTooltipSurface() } = {}) {
        this.#surface = surface;
        // 页面卸载时清理资源
        window.addEventListener('beforeunload', () => {
            this.globalCleanup();
        });
    }

    /**
     * 为元素添加悬停事件，以显示包含译文的工具提示。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} originalText - 原始文本。
     * @param {string} translatedText - 翻译后的文本。
     * @param {boolean} isError - 指示文本是否为错误信息。
     */
    displayTranslation(element, originalText, translatedText, isError = false) {
        element.classList.add('foxlate-hover-highlight');

        const handleMouseEnter = () => {
            this.#surface.show({ text: translatedText, targetElement: element, isError });
        };

        const handleMouseLeave = () => {
            this.#surface.scheduleHide();
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
        element.classList.remove(
            'foxlate-hover-highlight',
            'foxlate-loading-highlight',
            'foxlate-state-loading',
            'foxlate-state-error',
            'foxlate-state-translated',
        );

        if (element._foxlateHoverHandlers) {
            element.removeEventListener('mouseenter', element._foxlateHoverHandlers.handleMouseEnter);
            element.removeEventListener('mouseleave', element._foxlateHoverHandlers.handleMouseLeave);
            delete element._foxlateHoverHandlers;
        }
        
        // 如果当前元素是活动元素，隐藏工具提示
        this.#surface.scheduleHide();
    }

    /**
     * Implements the global cleanup interface for DisplayManager.
     * This ensures any visible hover tooltip is hidden during a full page revert.
     */
    globalCleanup() {
        this.#surface.cleanup();
    }

    updateUI(element, state) {
        // 在应用新状态前，先清理旧状态，确保元素处于干净状态。
        this.revert(element);

        const data = DisplayManager.getElementData(element);

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // revert 已在 switch 外部调用，此处无需操作。
                break;
            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                element.classList.add('foxlate-loading-highlight', 'foxlate-state-loading');
                break;
            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                if (data && data.plainText && data.originalContent) {
                    element.classList.add('foxlate-state-translated');
                    this.displayTranslation(element, data.originalContent, data.plainText, false);
                } else {
                    this.revert(element);
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                const errorMessage = data?.errorMessage || 'Translation Error';
                const fullErrorMessage = `${errorPrefix}: ${errorMessage}`;
                element.classList.add('foxlate-state-error');
                this.displayTranslation(element, data.originalContent, fullErrorMessage, true);
                break;
            default:
                console.warn(`[Hover Strategy] Unknown state: ${state}`);
        }
    }
}

// 导出该类的一个实例，以保持单例模式
export default new HoverStrategy();
