/**
 * 集中式错误记录器，用于内容脚本。
 * @param {string} context - 错误发生的上下文（例如，函数名）。
 * @param {Error} error - 错误对象。
 */
function logError(context, error) {
    console.error(`[Universal Translator Content Script Error] in ${context}:`, error.message, error.stack);
}

/**
 * 初始化内容脚本，设置消息监听器。
 */
function initializeContentScript() {
    // 等待 DisplayManagerReady 事件
    window.addEventListener('DisplayManagerReady', () => {
        console.log("[Universal Translator] Content script loaded and initializing...");

        // 使用 try-catch 块确保即使监听器设置失败，也能记录错误
        try {
            browser.runtime.onMessage.addListener(handleMessage);
            console.log("[Universal Translator] Message listener set up successfully.");
        } catch (error) {
            logError('initializeContentScript', new Error("Failed to set up message listener: " + error.message));
        }
    }, { once: true }); // 使用 once: true 确保监听器只执行一次

    // 如果 DisplayManager 未能及时加载，添加一个超时处理
    setTimeout(() => {
        if (!window.DisplayManager) {
            logError('initializeContentScript', new Error("DisplayManagerReady event not received in time. Potential loading issue."));
        }
    }, 5000); // 5秒超时
}

/**
 * 模块级变量，用于跟踪当前活动的“点击外部关闭”事件处理器。
 * 这是为了确保在创建新面板或通过其他方式关闭面板时，能够正确地移除旧的事件监听器。
 */
let activePanelClickHandler = null;

let originalContent = new Map(); // 用于存储原始文本的映射

/**
 * 执行整页翻译。
 */
async function performPageTranslation() {
    try {
        const { settings } = await browser.storage.sync.get('settings');
        const targetLang = settings?.targetLanguage || 'ZH';
        
        // 获取当前页面的域名
        const currentDomain = window.location.hostname;

        // 确定要使用的选择器
        let selector = settings?.translationSelector?.default || 'p, h1, h2, h3, h4, li, a'; // 默认选择器
        if (settings?.translationSelector?.rules) {
            // 查找域名规则，精确匹配或根域名匹配
            const domainRules = settings.translationSelector.rules;
            if (domainRules[currentDomain]) {
                // 优先使用完全匹配的域名规则
                selector = domainRules[currentDomain];
            } else {
                // 尝试匹配根域名（去除子域名）
                const rootDomain = currentDomain.split('.').slice(-2).join('.');
                if (domainRules[rootDomain]) {
                    selector = domainRules[rootDomain];
                }
            }
        }

        const elements = document.querySelectorAll(selector);

        if (originalContent.size === 0) { // 首次翻译，保存原始文本
            elements.forEach(el => {
                originalContent.set(el, el.textContent);
            });
        }

        for (const element of elements) {
            const text = element.textContent.trim();
            if (text) {
                try {
                    const translatedText = await browser.runtime.sendMessage({
                        type: 'TRANSLATE_TEXT',
                        payload: { text, targetLang }
                    });
                    if (translatedText.success) {
                        await window.DisplayManager.apply(element, translatedText.translatedText);
                    } else {
                        window.DisplayManager.showError(element, translatedText.error);
                    }
                } catch (error) {
                    window.DisplayManager.showError(element, error.message);
                }
            }
        }
    } catch (error) {
        logError('performPageTranslation', error);
        throw error; // 重新抛出错误，让调用者处理
    }
}

/**
 * 还原整页翻译，显示原始文本。
 */
function revertPageTranslation() {
    originalContent.forEach((text, element) => element.textContent = text);
    originalContent.clear();
}

/**
 * 创建并显示一个用于展示选中文字翻译结果的浮动面板。
 * @param {string} content - 要显示在面板中的内容。
 * @param {boolean} isError - 是否为错误消息。
 * @param {boolean} isLoading - 是否为加载状态。
 */
function showSelectionTranslationPanel(content, isError = false, isLoading = false) {
    // 首先，确保移除任何已存在的面板及其关联的事件监听器。
    hideSelectionTranslationPanel();

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
        // 点击关闭按钮时，调用统一的隐藏函数以确保所有清理工作都已完成。
        panel.querySelector('.panel-close-btn').addEventListener('click', hideSelectionTranslationPanel);
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

    // 定义一个处理器，用于处理面板外部的点击事件。
    const clickOutsideHandler = (event) => {
        // 如果点击事件的目标不在面板内部，则隐藏面板。
        if (panel && !panel.contains(event.target)) {
            hideSelectionTranslationPanel();
        }
    };

    // 将新的处理器保存到模块级变量中。
    activePanelClickHandler = clickOutsideHandler;

    // 使用 setTimeout 延迟绑定事件，以防止触发面板显示的本次点击立即关闭面板。
    setTimeout(() => {
        // 在 document 上添加事件监听器，使用捕获阶段以确保可靠性。
        document.addEventListener('click', activePanelClickHandler, { capture: true });
    }, 0);
}

function hideSelectionTranslationPanel() {
    // 如果存在活动的点击处理器，先从 document 上移除它。
    if (activePanelClickHandler) {
        document.removeEventListener('click', activePanelClickHandler, { capture: true });
        activePanelClickHandler = null; // 清理变量。
    }

    // 移除面板 DOM 元素。
    const existingPanel = document.getElementById('universal-translator-selection-panel');
    if (existingPanel) {
        existingPanel.remove();
    }
}

/**
 * 处理来自 background 或 popup 的消息。
 */
async function handleMessage(request, sender, sendResponse) {
    // 推荐的做法是明确处理异步和同步消息。
    // 对于异步操作，返回 true 以保持 sendResponse 通道打开。
    // 对于同步操作，可以不返回任何内容（即 undefined）。

    try {
        switch (request.type) {
            case 'PING':
                sendResponse({ status: 'PONG' });
                return; // 同步响应，不需要返回 true

            case 'DISPLAY_SELECTION_TRANSLATION':
                const { success, translatedText, error, isLoading } = request.payload;
                if (isLoading) {
                    showSelectionTranslationPanel("", false, true);
                } else if (success) {
                    showSelectionTranslationPanel(translatedText);
                } else {
                    showSelectionTranslationPanel(`翻译失败: ${error || 'Unknown error'}`, true);
                }
                return; // UI 操作，同步完成，不需要响应，也不需要返回 true

            case 'TRANSLATE_PAGE_REQUEST':
                await performPageTranslation();
                sendResponse({ success: true });
                // 这是唯一的异步情况，但由于我们已经 await 了，sendResponse 也是同步调用的。
                // 不过，为了代码清晰和未来扩展，明确返回 true 仍然是好的。
                // 但更标准的做法是将 sendResponse 逻辑放在一个 .then() 中，或者像现在这样 await 之后调用。
                // 在这种 await 模式下，返回 true 严格来说不是必须的，但无害。
                return;

            case 'REVERT_PAGE_TRANSLATION':
                revertPageTranslation();
                return; // UI 操作，同步完成

            default:
                console.warn(`[Universal Translator] Unknown message type: ${request.type}`);
        }
    } catch (error) {
        logError(`handleMessage (type: ${request.type})`, error);
        sendResponse({ success: false, error: error.message });
        // 发生错误时，我们已经同步调用了 sendResponse，所以不需要返回 true。
        return;
    }
    // 注意：Chrome V3 manifest 中，onMessage 的返回值被忽略。
    // 但为了兼容性和良好实践，我们仍然遵循 Firefox 的规则：异步操作返回 true。
    // 在这个重构后的版本中，没有分支会到达这里，所有路径都已明确返回。
}

// 启动脚本
initializeContentScript();
