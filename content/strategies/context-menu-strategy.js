function createTooltip() {
    if (document.querySelector('.universal-translator-context-menu-tooltip')) return;
    const tooltip = document.createElement('div');
    tooltip.className = 'universal-translator-context-menu-tooltip';
    document.body.appendChild(tooltip);
}

function updateTooltipPosition(event) {
    const tooltipEl = document.querySelector('.universal-translator-context-menu-tooltip');
    if (!tooltipEl) return;

    let x = event.clientX + 15;
    let y = event.clientY + 15;

    // 考虑 Tooltip 宽度，防止右侧溢出
    const tooltipRect = tooltipEl.getBoundingClientRect();
    if (x + tooltipRect.width > window.innerWidth) {
        x = event.clientX - tooltipRect.width - 15;
    }

    // 考虑 Tooltip 高度，防止底部溢出
    if (y + tooltipRect.height > window.innerHeight) {
        y = event.clientY - tooltipRect.height - 15;
    }

    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
}

function showTooltip(event, text) {
    createTooltip();
    const tooltipEl = document.querySelector('.universal-translator-context-menu-tooltip');
    if (!tooltipEl) return;
    tooltipEl.textContent = text;
    tooltipEl.style.display = 'block';
    updateTooltipPosition(event); // 初始显示时定位
}

function hideTooltip() {
    const tooltipEl = document.querySelector('.universal-translator-context-menu-tooltip');
    if (tooltipEl) {
        tooltipEl.style.display = 'none';
    }
}

window.contextMenuStrategy = {
    /**
     * 显示右键翻译的 M3 风格 Tooltip。
     * Tooltip 的内容直接从 translatedText 获取，不再依赖元素的 dataset。
     * 鼠标移动时更新 Tooltip 位置。
     * @param {MouseEvent} event - 触发右键菜单的事件
     * @param {string} translatedText - 翻译后的文本
     */
    displayTranslation: function(event, translatedText) {
        showTooltip(event, translatedText);
        // 监听鼠标移动，实时更新 Tooltip 位置
        document.addEventListener('mousemove', updateTooltipPosition);
    },

    /**
     * 隐藏右键翻译的 Tooltip 并移除事件监听。
     */
    revertTranslation: function() {
        hideTooltip();
        // 移除鼠标移动监听
        document.removeEventListener('mousemove', updateTooltipPosition);
    }
};