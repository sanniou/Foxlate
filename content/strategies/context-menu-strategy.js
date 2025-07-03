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
    _showTooltip: function(coords, text, isLoading = false, source = 'contextMenu') {
        this._createTooltip();
        if (!this._tooltipEl) return;

        this._hideTooltip(); // 先隐藏任何现有的，并清理监听器

        this._tooltipEl.classList.toggle('from-shortcut', source === 'shortcut');
        this._tooltipEl.textContent = text;
        this._tooltipEl.classList.toggle('loading', isLoading);

        this._updateTooltipPosition(coords);
        this._tooltipEl.classList.add('visible');

        this._activeClickHandler = (e) => {
            if (this._tooltipEl && this._tooltipEl.contains(e.target)) {
                return;
            }
            this._hideTooltip();
        };

        this._activeScrollHandler = () => {
            this._hideTooltip();
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
     * 显示右键翻译的工具提示。
     */
    displayTranslation: function(coords, translatedText, isLoading = false, source = 'contextMenu') {
        this._showTooltip(coords, translatedText, isLoading, source);
    },

    /**
     * 隐藏右键翻译的工具提示并清理其监听器。
     */
    revertTranslation: function() {
        this._hideTooltip();
    },

    displayLoading: function(coords, source = 'contextMenu') {
        const loadingMessage = browser.i18n.getMessage('popupTranslating') || 'Translating...';
        this._showTooltip(coords, loadingMessage, true, source);
    },

    hideLoading: function() {
        this._hideTooltip();
    }
};
