// 模块级变量，用于持有活动的点击处理器，以便移除。
let activeClickHandler = null;
let activeScrollHandler = null;

/**
 * 如果工具提示元素不存在，则创建它。
 */
function createTooltip() {
    if (document.querySelector('.universal-translator-context-menu-tooltip')) return;
    const tooltip = document.createElement('div');
    tooltip.className = 'universal-translator-context-menu-tooltip';
    document.body.appendChild(tooltip);
}

/**
 * 根据坐标计算并设置工具提示的位置。
 * 它能确保工具提示不会溢出窗口。
 * @param {object} coords - 包含 clientX 和 clientY 的对象。
 */
function updateTooltipPosition(coords) {
    const tooltipEl = document.querySelector('.universal-translator-context-menu-tooltip');
    if (!tooltipEl) return;

    // 获取工具提示的尺寸。我们需要先显示它才能测量。
    const wasHidden = tooltipEl.style.display === 'none';
    if (wasHidden) {
        tooltipEl.style.visibility = 'hidden';
        tooltipEl.style.display = 'block';
    }
    const tooltipRect = tooltipEl.getBoundingClientRect();
    if (wasHidden) {
        tooltipEl.style.display = 'none';
        tooltipEl.style.visibility = 'visible';
    }

    // 传入的 x 是工具提示期望的中心点。
    // 计算 left 位置以使工具提示居中。
    let x = coords.clientX - tooltipRect.width / 2;
    let y = coords.clientY; // 传入的 y 是期望的顶部位置。

    // 防止在窗口右边缘溢出。
    if (x + tooltipRect.width > window.innerWidth - 10) {
        x = window.innerWidth - tooltipRect.width - 10; // 10px 边距
    }

    // 防止在窗口左边缘溢出。
    if (x < 10) {
        x = 10; // 10px 边距
    }

    // 防止在窗口底部溢出。
    if (y + tooltipRect.height > window.innerHeight - 10) {
        y = window.innerHeight - tooltipRect.height - 10; // 10px 边距
    }

    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
}

/**
 * 显示带有提供文本的工具提示并设置监听器。
 * @param {object} coords - 用于定位的包含 clientX 和 clientY 的对象。
 * @param {string} text - 要在工具提示中显示的文本。
 * @param {boolean} [isLoading=false] - 是否显示为加载状态。
 * @param {string} [source='contextMenu'] - 触发来源 ('contextMenu' or 'shortcut').
 */
function showTooltip(coords, text, isLoading = false, source = 'contextMenu') {
    createTooltip();
    const tooltipEl = document.querySelector('.universal-translator-context-menu-tooltip');
    if (!tooltipEl) return;

    // 首先，隐藏任何现有的工具提示并清理其监听器以防止冲突。
    hideTooltip();

    // 根据来源添加/移除特定的类
    tooltipEl.classList.toggle('from-shortcut', source === 'shortcut');
    tooltipEl.textContent = text;
    tooltipEl.classList.toggle('loading', isLoading);
    
    // 在显示之前定位工具提示以避免闪烁。
    updateTooltipPosition(coords);
    tooltipEl.style.display = 'block';

    // 定义用于在点击外部时关闭工具提示的处理器。
    activeClickHandler = (e) => {
        // 如果点击在工具提示内部，则不执行任何操作。
        if (tooltipEl.contains(e.target)) {
            return;
        }
        // 否则，隐藏工具提示（这也会移除此监听器）。
        hideTooltip();
    };

    // 定义用于在滚动时关闭工具提示的处理器。
    activeScrollHandler = () => {
        hideTooltip();
    };

    // 添加监听器。使用 setTimeout 确保它在当前事件周期之后添加。
    // 这可以防止打开菜单的同一次点击立即关闭它。
    setTimeout(() => {
        document.addEventListener('click', activeClickHandler, true);
        window.addEventListener('scroll', activeScrollHandler, true);
    }, 0);
}

/**
 * 隐藏工具提示并清理所有相关的事件监听器。
 */
function hideTooltip() {
    const tooltipEl = document.querySelector('.universal-translator-context-menu-tooltip');
    if (tooltipEl) {
        tooltipEl.style.display = 'none';
    }

    // 如果存在，则始终移除活动的点击处理器。
    if (activeClickHandler) {
        document.removeEventListener('click', activeClickHandler, true);
        activeClickHandler = null; // 清理引用。
    }

    // 如果存在，则始终移除活动的滚动处理器。
    if (activeScrollHandler) {
        window.removeEventListener('scroll', activeScrollHandler, true);
        activeScrollHandler = null; // 清理引用。
    }
}

window.contextMenuStrategy = {
    /**
     * 显示右键翻译的工具提示。
     * 工具提示被定位在事件坐标附近并保持静止。
     * @param {object} coords - 用于定位的包含 clientX 和 clientY 的对象。
     * @param {string} translatedText - 要显示的翻译文本。
     * @param {boolean} [isLoading=false] - 是否显示为加载状态。
     * @param {string} [source='contextMenu'] - 触发来源。
     */
    displayTranslation: function(coords, translatedText, isLoading = false, source = 'contextMenu') {
        // 此函数现在只是 showTooltip 的一个简洁包装。
        showTooltip(coords, translatedText, isLoading, source);
    },

    /**
     * 隐藏右键翻译的工具提示并清理其监听器。
     */
    revertTranslation: function() {
        // 此函数现在只是 hideTooltip 的一个简洁包装。
        hideTooltip();
    }
};
