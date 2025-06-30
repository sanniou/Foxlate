// 全局的 tooltip 创建和显示逻辑保持不变
function createTooltip() {
    if (document.querySelector('.universal-translator-tooltip')) return;
    const tooltip = document.createElement('div');
    tooltip.className = 'universal-translator-tooltip';
    document.body.appendChild(tooltip);
}

window.showTooltip = function(event, text) {
    createTooltip();
    const tooltipEl = document.querySelector('.universal-translator-tooltip');
    if (!tooltipEl) return;
    tooltipEl.textContent = text;
    tooltipEl.style.display = 'block';
    let x = event.pageX + 15;
    let y = event.pageY + 15;
    const tooltipRect = tooltipEl.getBoundingClientRect();
    if (event.clientX + 15 + tooltipRect.width > window.innerWidth) {
        x = event.pageX - tooltipRect.width - 15;
    }
    if (event.clientY + 15 + tooltipRect.height > window.innerHeight) {
        y = event.pageY - tooltipRect.height - 15;
    }
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
}

window.hideTooltip = function() {
    const tooltipEl = document.querySelector('.universal-translator-tooltip');
    if (tooltipEl) {
        tooltipEl.style.display = 'none';
    }
}

window.hoverStrategy = {
    /**
     * 为元素添加悬停事件，以显示包含译文的工具提示。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本 (由 DisplayManager 存储在 dataset.translatedText)。
     */
    displayTranslation: function(element, translatedText) {
        // 译文已经由 DisplayManager 存储在 element.dataset.translatedText 中。
        // 我们只需要添加事件监听器。

        // 创建具名函数以便后续可以移除它们
        const handleMouseEnter = (event) => {
            // 从 dataset 中读取最新的译文
            const currentTranslatedText = element.dataset.translatedText;
            if (currentTranslatedText) {
                window.showTooltip(event, currentTranslatedText);
            }
        };

        const handleMouseLeave = () => {
            window.hideTooltip();
        };

        // 将处理函数附加到元素上，以便 revert 时可以访问
        element._hoverHandlers = { handleMouseEnter, handleMouseLeave };

        element.addEventListener('mouseenter', handleMouseEnter);
        element.addEventListener('mouseleave', handleMouseLeave);
    },

    /**
     * 移除元素的悬停事件监听器。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation: function(element) {
        // 检查是否存在已保存的事件处理器
        if (element._hoverHandlers) {
            element.removeEventListener('mouseenter', element._hoverHandlers.handleMouseEnter);
            element.removeEventListener('mouseleave', element._hoverHandlers.handleMouseLeave);
            // 清理附加在元素上的属性
            delete element._hoverHandlers;
        }
    }
};