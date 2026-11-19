import browser from '../../lib/browser-polyfill.js';
import * as Constants from '../../common/constants.js';
import { getElementData } from '../display/element-state-map.js';
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

        // 键盘也要能看到译文。hover 模式此前只有 mouseenter，用 Tab 在链接间移动的人
        // 在整个模式下拿不到任何译文——「用键盘浏览」是这个模式唯一没被照顾到的入口。
        const handleFocus = () => {
            this.#surface.show({ text: translatedText, targetElement: element, isError });
        };

        const handleBlur = () => {
            this.#surface.scheduleHide();
        };

        // 将处理函数附加到元素上，以便 revert 时可以精确移除
        element._foxlateHoverHandlers = {
            handleMouseEnter,
            handleMouseLeave,
            handleFocus,
            handleBlur,
        };

        element.addEventListener('mouseenter', handleMouseEnter);
        element.addEventListener('mouseleave', handleMouseLeave);
        element.addEventListener('focus', handleFocus);
        element.addEventListener('blur', handleBlur);
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
            const handlers = element._foxlateHoverHandlers;
            element.removeEventListener('mouseenter', handlers.handleMouseEnter);
            element.removeEventListener('mouseleave', handlers.handleMouseLeave);
            element.removeEventListener('focus', handlers.handleFocus);
            element.removeEventListener('blur', handlers.handleBlur);
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

        const data = getElementData(element);

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
                // 错误提示也是给用户看的文案，跟界面同一种语言；此前写死英文 'Translation Error'。
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                const errorMessage = data?.errorMessage
                    || browser.i18n.getMessage('translationFailedFallback')
                    || 'Translation failed';
                const fullErrorMessage = `${errorPrefix}: ${errorMessage}`;
                element.classList.add('foxlate-state-error');
                this.displayTranslation(element, data?.originalContent ?? '', fullErrorMessage, true);
                break;
            default:
                console.warn(`[Hover Strategy] Unknown state: ${state}`);
        }
    }
}

// 导出该类的一个实例，以保持单例模式。类本身也导出：键盘/焦点这类行为只能在
// 注入假浮层的前提下测量，否则测试只能断言"实例存在"。
export { HoverStrategy };
export default new HoverStrategy();
