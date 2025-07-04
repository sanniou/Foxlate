window.contextMenuStrategy = {
    /**
     * @private
     * 持有单一的工具提示元素实例。
     */
    _tooltipEl: null,

    /**
     * @private
     * 持有活动的点击处理器，以便移除。
     */
    _activeClickHandler: null,

    /**
     * @private
     * 持有活动的滚动处理器，以便移除。
     */
    _activeScrollHandler: null,

    /**
     * @private
     * 持有当前操作的状态目标对象。
     */
    _currentTarget: null,

    /**
     * @private
     * 如果工具提示元素不存在，则创建它。
     */
    _createTooltip: function() {
        if (this._tooltipEl) return;
        this._tooltipEl = document.createElement('div');
        this._tooltipEl.className = 'foxlate-panel context-menu-panel';
        document.body.appendChild(this._tooltipEl);
    },

    /**
     * @private
     * 根据坐标计算并设置工具提示的位置。
     * @param {object} coords - 包含 clientX 和 clientY 的对象。
     */
    _updateTooltipPosition: function(coords) {
        if (!this._tooltipEl) return;

        const tooltipRect = this._tooltipEl.getBoundingClientRect();
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

        this._tooltipEl.style.left = `${x}px`;
        this._tooltipEl.style.top = `${y}px`;
    },

    /**
     * @private
     * 显示带有提供文本的工具提示并设置监听器。
     */
    _showTooltip: function(coords, text, isLoading = false, source, isError = false) {
        this._createTooltip();
        if (!this._tooltipEl) return;

        // Don't hide here, as it clears listeners that might be needed.
        // The logic in updateUI will handle showing/hiding.

        this._tooltipEl.textContent = text;
        this._tooltipEl.classList.toggle('loading', isLoading);
        this._tooltipEl.classList.toggle('error', isError);
        this._tooltipEl.classList.toggle('from-shortcut', source === 'shortcut');

        this._updateTooltipPosition(coords);
        this._tooltipEl.classList.add('visible');

        this._activeClickHandler = (e) => {
            if (this._tooltipEl && this._tooltipEl.contains(e.target)) {
                return;
            }
            window.DisplayManager.revert(this._currentTarget);
        };

        this._activeScrollHandler = () => {
            window.DisplayManager.revert(this._currentTarget);
        };

        setTimeout(() => {
            document.addEventListener('click', this._activeClickHandler, true);
            window.addEventListener('scroll', this._activeScrollHandler, true);
        }, 0);
    },

    /**
     * @private
     * 隐藏工具提示并清理所有相关的事件监听器。
     */
    _hideTooltip: function() {
        if (this._tooltipEl) {
            this._tooltipEl.classList.remove('visible');
        }

        if (this._activeClickHandler) {
            document.removeEventListener('click', this._activeClickHandler, true);
            this._activeClickHandler = null;
        }

        if (this._activeScrollHandler) {
            window.removeEventListener('scroll', this._activeScrollHandler, true);
            this._activeScrollHandler = null;
        }
    },

    /**
     * 隐藏右键翻译的工具提示并清理其监听器。
     * @param {object} target - The state object for this translation.
     */
    revertTranslation: function(target) {
        this._hideTooltip();
        // The cleanup of activeEphemeralTargets is now handled inside DisplayManager.revert
        this._currentTarget = null;
    },

    /**
     * Implements the global cleanup interface for DisplayManager.
     * This ensures the context menu panel is hidden during a full page revert.
     */
    globalCleanup: function() {
        if (this._currentTarget) {
            window.DisplayManager.revert(this._currentTarget);
        }
    },

    updateUI: function(element, state) {
        // For this strategy, 'element' is a plain state object, not a DOM element.
        const target = element;
        this._currentTarget = target; // Keep track of the current target for event handlers.

        const coords = {
            clientX: parseFloat(target.dataset.clientX),
            clientY: parseFloat(target.dataset.clientY),
        };
        const source = target.dataset.source;

        // Ensure tooltip exists and clear previous listeners before showing a new one.
        this._hideTooltip();

        switch (state) {
            case window.DisplayManager.STATES.ORIGINAL:
                // Revert is handled by DisplayManager calling revertTranslation, which cleans up.
                // No UI to show for the original state.
                break;

            case window.DisplayManager.STATES.LOADING:
                const loadingMessage = browser.i18n.getMessage('popupTranslating') || 'Translating...';
                this._showTooltip(coords, loadingMessage, true, source);
                break;

            case window.DisplayManager.STATES.TRANSLATED:
                const translatedText = target.dataset.translatedText;
                if (translatedText) {
                    this._showTooltip(coords, translatedText, false, source, false);
                }
                break;

            case window.DisplayManager.STATES.ERROR:
                const errorMessage = target.dataset.errorMessage || 'Translation Error';
                const fullErrorMessage = `${browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error'}: ${errorMessage}`;
                this._showTooltip(coords, fullErrorMessage, false, source, true);
                break;

            default:
                console.warn(`[ContextMenu Strategy] Unknown state: ${state}`);
        }
    }
};
