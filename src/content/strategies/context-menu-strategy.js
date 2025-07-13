import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';
import TooltipManager from '../tooltip-manager.js';

class ContextMenuStrategy {
    /**
     * @private
     * 持有当前操作的状态目标对象。
     */
    #currentTarget = null;

    /**
     * 隐藏右键翻译的工具提示并清理其监听器。
     * @param {object} target - The state object for this translation.
     */
    revert(target) {
        TooltipManager.hide();
        // The cleanup of activeEphemeralTargets is now handled inside DisplayManager.revert
        this.#currentTarget = null;
    }

    /**
     * Implements the global cleanup interface for DisplayManager.
     * This ensures the context menu panel is hidden during a full page revert.
     * @param {object} displayManager - The DisplayManager class.
     */
    globalCleanup(displayManager) {
        TooltipManager.hide();
    }

    updateUI(element, state, displayManager) {
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

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // Revert is handled by DisplayManager calling revert(), which calls TooltipManager.hide().
                break;

            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                const loadingMessage = browser.i18n.getMessage('popupTranslating') || 'Translating...';
                TooltipManager.show(loadingMessage, {
                    coords, isLoading: true, source, type: 'context', onHide: onHideCallback
                });
                break;

            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                // 使用由 DisplayManager 提供的、已清理的 plainText。
                // 对于划词翻译，plainText 和 translatedText 的内容是相同的。
                if (data && data.plainText) {
                    TooltipManager.show(data.plainText, {
                        coords, source, type: 'context', onHide: onHideCallback
                    });
                } else {
                    this.revert(target);
                }
                break;

            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                const errorMessage = data?.errorMessage || 'Error';
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                const fullErrorMessage = `⚠️ ${errorPrefix}: ${errorMessage}`;
                TooltipManager.show(fullErrorMessage, {
                    coords, isError: true, source, type: 'context', onHide: onHideCallback
                });
                break;

            default:
                console.warn(`[ContextMenu Strategy] Unknown state: ${state}`);
        }
    }
}

// 导出该类的一个实例，以保持单例模式
export default new ContextMenuStrategy();
