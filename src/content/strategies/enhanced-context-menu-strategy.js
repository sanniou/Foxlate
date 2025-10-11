import browser from '../../lib/browser-polyfill.js';
import * as Constants from '../../common/constants.js';
import { getSpeechCode } from '../../common/utils.js';
import { DisplayManager } from '../display-manager.js';
import EnhancedTooltipManager from '../enhanced-tooltip-manager.js';

class EnhancedContextMenuStrategy {
    /**
     * @private
     * 持有当前操作的状态目标对象。
     */
    #currentTarget = null;
    #sourceText = '';
    #translatedText = '';

    /**
     * 隐藏右键翻译的工具提示并清理其监听器。
     * @param {object} target - The state object for this translation.
     */
    revert(target) {
        EnhancedTooltipManager.hide();
        this.#currentTarget = null;
        this.#sourceText = '';
        this.#translatedText = '';
    }

    /**
     * Implements the global cleanup interface for DisplayManager.
     * This ensures the context menu panel is hidden during a full page revert.
     * @param {object} displayManager - The DisplayManager class.
     */
    globalCleanup(displayManager) {
        EnhancedTooltipManager.hide();
    }

    /**
     * 更新UI以响应状态变化。
     * @param {object} element - 状态对象，而非DOM元素。
     * @param {string} state - 当前状态 (e.g., 'LOADING', 'TRANSLATED')。
     * @param {object} displayManager - DisplayManager的实例。
     * @param {object} options - 包含额外配置的对象。
     * @param {object} options.langConfig - 语言配置 { sourceLang, targetLang }。
     */
    updateUI(element, state, displayManager, { langConfig }) {
        // For this strategy, 'element' is a plain state object, not a DOM element.
        const target = element;
        this.#currentTarget = target; // Keep track of the current target for event handlers.

        const data = DisplayManager.getElementData(target);
        const coords = {
            clientX: parseFloat(target.dataset.clientX),
            clientY: parseFloat(target.dataset.clientY),
        };
        const source = target.dataset.source;

        // The onHide callback ensures that when the user clicks outside or scrolls,
        // the DisplayManager reverts the state, which in turn calls this strategy's
        // revert() method, cleaning up the #currentTarget.
        const onHideCallback = () => displayManager.revert(this.#currentTarget);
        const { sourceLang, targetLang } = langConfig || {};

        // 如果无法从设置中获取有效的语言代码，则不显示工具提示，以避免传递无效参数
        if (!sourceLang || !targetLang) {
            console.error('[EnhancedContextMenuStrategy] Invalid langConfig provided.', langConfig);
            this.revert(target);
            return;
        }

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // Revert is handled by DisplayManager calling revert(), which calls EnhancedTooltipManager.hide().
                break;

            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                const loadingMessage = browser.i18n.getMessage('popupTranslating') || '正在翻译...';
                EnhancedTooltipManager.show('', '', {
                    coords, 
                    isLoading: true, 
                    source, 
                    type: 'context', 
                    onHide: onHideCallback,
                    sourceLang,
                    targetLang
                });
                break;

            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                // 使用由 DisplayManager 提供的、已清理的 plainText。
                // 对于划词翻译，plainText 和 translatedText 的内容是相同的。
                if (data && data.plainText) {
                    this.#sourceText = this.#extractOriginalText(target);
                    this.#translatedText = data.plainText;
                    
                    EnhancedTooltipManager.show(this.#sourceText, this.#translatedText, {
                        coords, 
                        source, 
                        type: 'context', 
                        onHide: onHideCallback,
                        sourceLang,
                        targetLang
                    });
                } else {
                    this.revert(target);
                }
                break;

            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                const errorMessage = data?.errorMessage || 'Error';
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || '翻译错误';
                const fullErrorMessage = `${errorPrefix}: ${errorMessage}`;
                
                EnhancedTooltipManager.show(fullErrorMessage, '', {
                    coords, 
                    isError: true, 
                    source, 
                    type: 'context', 
                    onHide: onHideCallback,
                    sourceLang,
                    targetLang
                });
                break;

            default:
                console.warn(`[Enhanced Context Menu Strategy] Unknown state: ${state}`);
        }
    }

    /**
     * 尝试从目标对象中提取原始文本
     * @param {object} target - 目标对象
     * @returns {string} 原始文本
     */
    #extractOriginalText(target) {
        // 尝试从不同的数据源获取原始文本
        if (target.dataset.originalText) {
            return target.dataset.originalText;
        }
        
        // 如果没有存储的原始文本，尝试从其他属性获取
        if (target.dataset.sourceText) {
            return target.dataset.sourceText;
        }
        
        // 如果都没有，返回一个占位符
        return '原文';
    }
}

// 导出该类的一个实例，以保持单例模式
export default new EnhancedContextMenuStrategy();