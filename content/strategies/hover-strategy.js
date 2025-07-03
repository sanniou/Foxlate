window.hoverStrategy = {
    /**
     * @private
     * 持有单一的工具提示元素实例。
     * 使用下划线表示这是一个内部属性。
     */
    _tooltipEl: null,

    /**
     * @private
     * 如果工具提示元素不存在，则创建并附加到 body。
     * 这是一个惰性创建，只在第一次需要时执行。
     */
    _createTooltip: function() {
        if (this._tooltipEl) return;
        this._tooltipEl = document.createElement('div');
        this._tooltipEl.className = 'foxlate-panel hover-tooltip';
        document.body.appendChild(this._tooltipEl);
    },

    /**
     * @private
     * 显示工具提示，并将其定位在目标元素的上方或下方。
     * @param {HTMLElement} targetElement - 触发悬停的元素。
     * @param {string} text - 要在工具提示中显示的文本。
     */
    _showTooltip: function(targetElement, text) {
        this._createTooltip();
        if (!this._tooltipEl) return;

        this._tooltipEl.textContent = text;
        this._tooltipEl.classList.add('visible');

        const targetRect = targetElement.getBoundingClientRect();
        const tooltipRect = this._tooltipEl.getBoundingClientRect();

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

        this._tooltipEl.style.left = `${x}px`;
        this._tooltipEl.style.top = `${y}px`;
    },

    /**
     * @private
     * 隐藏工具提示。
     */
    _hideTooltip: function() {
        if (this._tooltipEl) {
            this._tooltipEl.classList.remove('visible');
        }
    },

    /**
     * 为元素添加悬停事件，以显示包含译文的工具提示。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation: function(element, translatedText) {
        // 译文已由 DisplayManager 存储在 element.dataset.translatedText 中。
        // 为元素添加高亮样式，以在视觉上表明它已被处理并可悬停。
        element.classList.add('foxlate-hover-highlight');

        // 此策略的核心职责是添加事件监听器，以响应用户交互。
        const handleMouseEnter = () => {
            const currentTranslatedText = element.dataset.translatedText;
            if (currentTranslatedText) {
                this._showTooltip(element, currentTranslatedText);
            }
        };

        const handleMouseLeave = () => {
            this._hideTooltip();
        };

        // 将处理函数附加到元素上，以便 revert 时可以精确移除
        element._foxlateHoverHandlers = { handleMouseEnter, handleMouseLeave };

        element.addEventListener('mouseenter', handleMouseEnter);
        element.addEventListener('mouseleave', handleMouseLeave);
    },

    /**
     * 移除元素的悬停事件监听器并清理状态。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation: function(element) {
        // 移除高亮样式。
        element.classList.remove('foxlate-hover-highlight');

        if (element._foxlateHoverHandlers) {
            element.removeEventListener('mouseenter', element._foxlateHoverHandlers.handleMouseEnter);
            element.removeEventListener('mouseleave', element._foxlateHoverHandlers.handleMouseLeave);
            delete element._foxlateHoverHandlers;
        }
        // 确保在恢复时，如果鼠标恰好还在元素上，工具提示也会被隐藏。
        this._hideTooltip();
    },

    displayLoading: function(element) {
        // 使用一个不同的高亮样式来表示正在加载
        element.classList.add('foxlate-loading-highlight');
    },

    hideLoading: function(element) {
        element.classList.remove('foxlate-loading-highlight');
    },    

    updateUI: function(element, state) {
        switch (state) {
            case window.DisplayManager.STATES.ORIGINAL:
                this.revertTranslation(element);
                break;
            case window.DisplayManager.STATES.LOADING:
                this.displayLoading(element);
                break;
            case window.DisplayManager.STATES.TRANSLATED:
                const translatedText = element.dataset.translatedText;
                if (translatedText) {
                    this.displayTranslation(element, translatedText);
                } else {
                    this.revertTranslation(element);
                }
                break;
            case window.DisplayManager.STATES.ERROR:
                // 出错时，可以考虑修改悬停文本，或添加错误图标
                const errorMessage = element.dataset.errorMessage || 'Translation Error';
                element.dataset.translatedText = `Error: ${errorMessage}`; // 更新悬停文本
                this.displayTranslation(element, `Error: ${errorMessage}`); // 立即更新悬停提示
                break;
            default:
                console.warn(`[Hover Strategy] Unknown state: ${state}`);
        }
    }
};