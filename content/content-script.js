/**
 * 集中式错误记录器，用于内容脚本。
 * @param {string} context - 错误发生的上下文（例如，函数名）。
 * @param {Error} error - 错误对象。
 */
function logError(context, error) {
    console.error(`[Universal Translator Content Script Error] in ${context}:`, error.message, error.stack);
}

/**
 * 检查一个元素在页面上是否对用户可见。
 * @param {HTMLElement} el - 要检查的元素。
 * @returns {boolean} 如果元素可见则返回 true，否则返回 false。
 */
function isElementVisible(element) {
    if (!element) return false;

    // 递归检查祖先元素的可见性
    // 如果元素的 offsetParent 是 null，且 position 是 fixed，则它仍然可能是可见的。
    // 但一个更简单的递归检查是：如果任何一个父元素是 display: none，则子元素一定不可见。
    let current = element;
    while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        if (style.display === 'none') {
            return false;
        }
        current = current.parentElement;
    }
    
    const style = window.getComputedStyle(element);
    // 检查 display 和 visibility
    if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
    }
    // 检查透明度
    if (parseFloat(style.opacity) < 0.01) {
        return false;
    }
    // 检查尺寸 (getBoundingClientRect 更可靠)
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        // 例外：某些SVG元素或没有内容的内联元素可能尺寸为0但其后代可见，
        // 但对于文本节点的父元素，这个判断通常是准确的。
        return false;
    }

    return true;
}

/**
 * 使用 TreeWalker 查找并返回一个元素下的所有非空文本节点。
 * @param {Node} rootNode - 开始遍历的根节点。
 * @returns {Text[]} 文本节点数组。
 */
function findTextNodes(rootNode) {
    const textNodes = [];
    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT, // 只接受文本节点
        {
            acceptNode: function(node) {
                // 排除 <script>, <style>, 和 <textarea> 的内容
                const parentTag = node.parentElement.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'textarea'].includes(parentTag)) {
                    return NodeFilter.FILTER_REJECT;
                }
                // 排除只包含空白的文本节点
                if (node.nodeValue.trim() === '') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        },
        false
    );

    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    return textNodes;
}

/**
 * 初始化内容脚本，设置消息监听器。
 */
function initializeContentScript() {
    console.log("[Universal Translator] Content script loaded and initializing...");
    // 由于 display-manager.js 在 content-script.js 之前注入，
    // window.DisplayManager 应该已经可用。
    if (!window.DisplayManager) {
        logError('initializeContentScript', new Error("DisplayManager is not available. This indicates an injection order issue."));
        return; // 阻止后续可能依赖 DisplayManager 的操作
    }
    try {
        browser.runtime.onMessage.addListener(handleMessage);
        console.log("[Universal Translator] Message listener set up successfully.");
    } catch (error) {
        logError('initializeContentScript', new Error("Failed to set up message listener: " + error.message));
    }
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
async function performPageTranslation(tabId) {
    browser.runtime.sendMessage({
        type: 'TRANSLATION_STATUS_UPDATE',
        payload: { status: 'loading', tabId: tabId }
    }).catch(e => logError('reportTranslationStatus (loading)', e));

    try {
        const { settings } = await browser.storage.sync.get('settings');
        const targetLang = settings?.targetLanguage || 'ZH';

        const allTextNodes = findTextNodes(document.body);
        const visibleTextNodes = allTextNodes.filter(node => isElementVisible(node.parentElement));

        if (originalContent.size === 0) { // 首次翻译，保存原始文本
            visibleTextNodes.forEach(node => {
                originalContent.set(node, node.nodeValue);
            });
        }

        const textsToTranslate = visibleTextNodes.map(node => node.nodeValue);

        if (textsToTranslate.length === 0) {
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'translated', tabId: tabId }
            }).catch(e => logError('reportTranslationStatus (no text)', e));
            return;
        }

        const translationResults = await browser.runtime.sendMessage({
            type: 'TRANSLATE_TEXT_BATCH',
            payload: { texts: textsToTranslate, targetLang, sourceLang: 'auto' } // Assuming auto-detection for sourceLang in batch mode
        });

        if (translationResults.success) {
            translationResults.translatedTexts.forEach((translatedText, index) => {
                const node = visibleTextNodes[index];
                if (node) {
                    window.DisplayManager.apply(node.parentElement, translatedText);
                }
            });
        } else {
            logError('performPageTranslation', new Error(translationResults.error));
        }

        browser.runtime.sendMessage({
            type: 'TRANSLATION_STATUS_UPDATE',
            payload: { status: 'translated', tabId: tabId }
        }).catch(e => logError('reportTranslationStatus (translated)', e));

        startObserver(); // Start observing for dynamic content

    } catch (error) {
        logError('performPageTranslation', error);
        browser.runtime.sendMessage({
            type: 'TRANSLATION_STATUS_UPDATE',
            payload: { status: 'original', tabId: tabId }
        }).catch(e => logError('reportTranslationStatus (failed)', e));
        throw error;
    }
}

/**
 * 还原整页翻译，显示原始文本。
 */
async function revertPageTranslation(tabId) { // 接受 tabId 参数
  stopObserver(); // Stop observing before reverting changes
  const elements = document.querySelectorAll('[data-translation-strategy]');
  elements.forEach(element => {
    window.DisplayManager.revert(element);
    delete element.dataset.translated;
  });
    originalContent.clear();
    // 报告还原完成状态
    try {
        browser.runtime.sendMessage({ type: 'TRANSLATION_STATUS_UPDATE', payload: { status: 'original', tabId: tabId } }) // 使用传入的 tabId
            .catch(e => logError('reportTranslationStatus (reverted)', e));
    } catch (e) {
        logError('revertPageTranslation', e);
    }
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
                const translateTabId = request.payload?.tabId; // 从 payload 获取 tabId
                if (!translateTabId) {
                    throw new Error("tabId not provided in TRANSLATE_PAGE_REQUEST payload.");
                }
                // 仅触发翻译，状态更新由 performPageTranslation 内部报告
                await performPageTranslation(translateTabId); // 传递 tabId
                sendResponse({ success: true });
                return;

            case 'REVERT_PAGE_TRANSLATION':
                const revertTabId = request.payload?.tabId; // 从 payload 获取 tabId
                if (!revertTabId) {
                    throw new Error("tabId not provided in REVERT_PAGE_TRANSLATION payload.");
                }
                await revertPageTranslation(revertTabId); // 传递 tabId
                return; // UI 操作，现在是异步完成

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

// --- MutationObserver for Dynamic Content ---

let observer = null;

/**
 * Debounced function to handle incremental translation of new nodes.
 */
const debouncedTranslateMutations = debounce(async (mutations) => {
    let nodesToTranslate = [];
    for (const mutation of mutations) {
        if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
                // Ignore nodes that are already translated or are part of a translated element.
                if (node.nodeType === Node.ELEMENT_NODE && node.closest('[data-translated="true"]')) {
                    continue;
                }

                // We only care about element nodes, as text nodes can't have children.
                if (node.nodeType === Node.ELEMENT_NODE) {
                    nodesToTranslate.push(...findTextNodes(node));
                }
            }
        }
    }

    if (nodesToTranslate.length > 0) {
        const visibleTextNodes = nodesToTranslate.filter(node => isElementVisible(node.parentElement));
        const textsToTranslate = visibleTextNodes.map(node => node.nodeValue);

        if (textsToTranslate.length > 0) {
            const { settings } = await browser.storage.sync.get('settings');
            const targetLang = settings?.targetLanguage || 'ZH';

            const translationResults = await browser.runtime.sendMessage({
                type: 'TRANSLATE_TEXT_BATCH',
                payload: { texts: textsToTranslate, targetLang, sourceLang: 'auto' }
            });

            if (translationResults.success) {
                translationResults.translatedTexts.forEach((translatedText, index) => {
                    const node = visibleTextNodes[index];
                    if (node) {
                        // Using DisplayManager to apply translation, assuming it handles node-level or element-level application.
                        window.DisplayManager.apply(node.parentElement, translatedText);
                    }
                });
            }
        }
    }
}, 500); // 500ms debounce interval

function startObserver() {
    if (observer) return; // Already running

    observer = new MutationObserver(debouncedTranslateMutations);

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log("[Universal Translator] MutationObserver started.");
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
        console.log("[Universal Translator] MutationObserver stopped.");
    }
}

/**
 * Simple debounce function.
 * @param {Function} func The function to debounce.
 * @param {number} wait The debounce interval in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

