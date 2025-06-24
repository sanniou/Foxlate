// 注意：为了修复右键菜单翻译功能，我们暂时移除了与整页翻译相关的功能。
// 这些功能依赖于一个名为 'DisplayManager' 的模块，该模块很可能是导致
// 整个内容脚本无法加载的根本原因。
// 我们首先确保核心功能稳定，之后可以再安全地重新引入整页翻译。

console.log("[Universal Translator] Content script loaded and ready.");

// 页面翻译的占位符函数
function performPageTranslation() {
    console.log("[Content Script] Page translation requested. (Actual translation logic is currently a placeholder)");
    // 在这里可以实现遍历DOM元素并发送翻译请求的逻辑
}
// 监听来自 popup 或 background 的手动翻译指令
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'PING') {
      sendResponse({ status: 'PONG' });
      return true; // Keep channel open for response
    }

    if (request.type === 'DISPLAY_SELECTION_TRANSLATION') {
      const { success, translatedText, error, isLoading } = request.payload;
      if (isLoading) {
          showSelectionTranslationPanel("", false, true); // Show loading state
      } else if (success) {
          showSelectionTranslationPanel(translatedText);
      } else {
          showSelectionTranslationPanel(`翻译失败: ${error || 'Unknown error'}`, true);
      }
      // 此消息类型不需要响应
    }

    if (request.type === 'TRANSLATE_PAGE_REQUEST') {
        performPageTranslation();
        // 不需要响应
    }
});

/**
 * 创建并显示一个用于展示选中文字翻译结果的浮动面板
 * @param {string} content - 要显示在面板中的内容
 * @param {boolean} isError - 是否为错误消息
 * @param {boolean} isLoading - 是否为加载状态
 */
function showSelectionTranslationPanel(content, isError = false, isLoading = false) {
    // 移除任何已存在的面板
    const existingPanel = document.getElementById('universal-translator-selection-panel');
    if (existingPanel) {
        existingPanel.remove();
    }

    const panel = document.createElement('div');
    panel.id = 'universal-translator-selection-panel';
    
    if (isLoading) {
        panel.innerHTML = '<div class="panel-content">Loading...</div>';
    } else {
        panel.className = isError ? 'error' : '';
        panel.innerHTML = `
            <button class="panel-close-btn">&times;</button>
            <div class="panel-content">${content.replace(/\n/g, '<br>')}</div>
        `;
        panel.querySelector('.panel-close-btn').addEventListener('click', () => panel.remove());
    }

    document.body.appendChild(panel);

    // 将面板定位到选区附近
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        panel.style.top = `${window.scrollY + rect.bottom + 8}px`;
        panel.style.left = `${window.scrollX + rect.left}px`;

        // 防止面板溢出视口
        const panelRect = panel.getBoundingClientRect();
        if (panelRect.right > window.innerWidth) {
            panel.style.left = `${window.scrollX + window.innerWidth - panelRect.width - 15}px`;
        }
    }
}
