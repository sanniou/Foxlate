import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';

class ContextMenuStrategy {
    /**
     * @private
     * 持有单一的工具提示元素实例。
     */
    #tooltipEl = null;

    /**
     * @private
     * 持有活动的点击处理器，以便移除。
     */
    #activeClickHandler = null;

    /**
     * @private
     * 持有活动的滚动处理器，以便移除。
     */
    #activeScrollHandler = null;

    /**
     * @private
     * 持有当前操作的状态目标对象。
     */
    #currentTarget = null;

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
     * 如果工具提示元素不存在，则创建它。
     */
    #createTooltip() {
        if (this.#tooltipEl) return;
        this.#tooltipEl = document.createElement('div');
        this.#tooltipEl.className = 'foxlate-panel context-menu-panel';
        document.body.appendChild(this.#tooltipEl);
    }

    /**
     * @private
     * 根据坐标计算并设置工具提示的位置。
     * @param {object} coords - 包含 clientX 和 clientY 的对象。
     */
    #updateTooltipPosition(coords) {
        if (!this.#tooltipEl) return;

        const tooltipRect = this.#tooltipEl.getBoundingClientRect();
        let x = coords.clientX - tooltipRect.width / 2;
        let y = coords.clientY;

        if (x + tooltipRect.width > window.innerWidth - 10) {
            x = window.innerWidth - tooltipRect.width - 10;
        }
        if (x < 10) {
            x = 10;
        }
        if (y + tooltipRect.height > window.innerHeight - 10) {
            y = window.innerHeight - tooltipRect.height - 10;
        }

        this.#tooltipEl.style.left = `${x}px`;
        this.#tooltipEl.style.top = `${y}px`;
    }

    /**
     * @private
     * 显示带有提供文本的工具提示并设置监听器。
     * @param {object} displayManager - The DisplayManager class to handle reverts.
     */
    #showTooltip(coords, text, isLoading, source, isError, displayManager) {
        this.#createTooltip();
        if (!this.#tooltipEl) return;

        // 使用 innerHTML 来正确渲染包含 <br> 标签的换行文本。
        this.#tooltipEl.innerHTML = text; // 文本由调用者 (updateUI) 预先转义
        this.#tooltipEl.classList.toggle('loading', !!isLoading);
        this.#tooltipEl.classList.toggle('error', !!isError);
        this.#tooltipEl.classList.toggle('from-shortcut', source === 'shortcut');

        this.#updateTooltipPosition(coords);
        this.#tooltipEl.classList.add('visible');

        this.#activeClickHandler = (e) => {
            if (this.#tooltipEl && this.#tooltipEl.contains(e.target)) {
                return;
            }
            // 当点击外部时，使用 DisplayManager 来恢复当前目标的翻译状态。
            displayManager.revert(this.#currentTarget);
        };

        this.#activeScrollHandler = () => {
            // 当页面滚动时，同样恢复翻译状态。
            displayManager.revert(this.#currentTarget);
        };

        setTimeout(() => {
            document.addEventListener('click', this.#activeClickHandler, true);
            window.addEventListener('scroll', this.#activeScrollHandler, true);
        }, 0);
    }

    /**
     * @private
     * 隐藏工具提示并清理所有相关的事件监听器。
     */
    #hideTooltip() {
        if (this.#tooltipEl) {
            this.#tooltipEl.classList.remove('visible');
        }

        if (this.#activeClickHandler) {
            document.removeEventListener('click', this.#activeClickHandler, true);
            this.#activeClickHandler = null;
        }

        if (this.#activeScrollHandler) {
            window.removeEventListener('scroll', this.#activeScrollHandler, true);
            this.#activeScrollHandler = null;
        }
    }

    /**
     * 隐藏右键翻译的工具提示并清理其监听器。
     * @param {object} target - The state object for this translation.
     */
    revertTranslation(target) {
        this.#hideTooltip();
        // The cleanup of activeEphemeralTargets is now handled inside DisplayManager.revert
        this.#currentTarget = null;
    }

    /**
     * Implements the global cleanup interface for DisplayManager.
     * This ensures the context menu panel is hidden during a full page revert.
     * @param {object} displayManager - The DisplayManager class.
     */
    globalCleanup(displayManager) {
        if (this.#currentTarget) {
            displayManager.revert(this.#currentTarget);
        }
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

        // Ensure tooltip exists and clear previous listeners before showing a new one.
        this.#hideTooltip();

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // Revert is handled by DisplayManager calling revertTranslation, which cleans up.
                // No UI to show for the original state.
                break;

            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                const loadingMessage = browser.i18n.getMessage('popupTranslating') || 'Translating...';
                this.#showTooltip(coords, loadingMessage, true, source, false, displayManager);
                break;

            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                if (data && data.translatedText) {
                    const processedText = this.#escapeHtml(data.translatedText).replace(/\n/g, '<br>');
                    this.#showTooltip(coords, processedText, false, source, false, displayManager);
                } else {
                    this.revertTranslation(target);
                }
                break;

            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                const errorMessage = data?.errorMessage || 'Translation Error';
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                const fullErrorMessage = `⚠️ ${this.#escapeHtml(errorPrefix)}: ${this.#escapeHtml(errorMessage)}`;
                this.#showTooltip(coords, fullErrorMessage, false, source, true, displayManager);
                break;

            default:
                console.warn(`[ContextMenu Strategy] Unknown state: ${state}`);
        }
    }
}

// 导出该类的一个实例，以保持单例模式
export default new ContextMenuStrategy();
