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
let translationJob = {
    totalChunks: 0,
    completedChunks: 0,
    tabId: null,
};

/**
 * 执行整页翻译的新实现，采用分块并行处理。
 */
async function performPageTranslation(tabId) {
    // 1. 初始化/重置翻译任务状态
    translationJob = {
        totalChunks: 0,
        completedChunks: 0,
        tabId: tabId,
    };

    // 2. 立即向UI报告加载状态
    browser.runtime.sendMessage({
        type: 'TRANSLATION_STATUS_UPDATE',
        payload: { status: 'loading', tabId: tabId }
    }).catch(e => logError('reportTranslationStatus (loading)', e));

    try {
        const { settings } = await browser.storage.sync.get('settings');
        const targetLang = settings?.targetLanguage || 'ZH';
        const CHUNK_SIZE = settings?.parallelRequests || 2; // 从设置中读取并行数，默认为2

        // 3. 查找所有可见的文本节点
        const allTextNodes = findTextNodes(document.body);
        const visibleTextNodes = allTextNodes.filter(node =>
            isElementVisible(node.parentElement) && !node.parentElement.closest('[data-translated="true"]')
        );

        if (originalContent.size === 0) { // 首次翻译，保存原始文本
            visibleTextNodes.forEach(node => {
                originalContent.set(node, node.nodeValue);
            });
        }

        if (visibleTextNodes.length === 0) {
            // 如果没有需要翻译的文本，直接报告完成
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'translated', tabId: tabId }
            }).catch(e => logError('reportTranslationStatus (no text)', e));
            return;
        }

        // 4. 分块并发送翻译请求
        const chunks = [];
        for (let i = 0; i < visibleTextNodes.length; i += CHUNK_SIZE) {
            chunks.push(visibleTextNodes.slice(i, i + CHUNK_SIZE));
        }
        translationJob.totalChunks = chunks.length;

        chunks.forEach(chunk => {
            const texts = [];
            const ids = [];
            chunk.forEach(node => {
                const parent = node.parentElement;
                // 确保每个待翻译元素都有一个唯一的ID
                if (!parent.dataset.translationId) {
                    parent.dataset.translationId = `ut-${crypto.randomUUID()}`;
                }
                texts.push(node.nodeValue);
                ids.push(parent.dataset.translationId);
            });

            // 5. 发送块进行翻译 (Fire-and-forget)
            browser.runtime.sendMessage({
                type: 'TRANSLATE_TEXT_CHUNK',
                payload: {
                    texts,
                    ids,
                    targetLang,
                    sourceLang: 'auto',
                    tabId: tabId
                }
            }).catch(e => logError('performPageTranslation (send chunk)', e));
        });

        startObserver(); // 启动 MutationObserver 以处理动态内容

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
async function revertPageTranslation(tabId) {
    stopObserver(); // 停止观察DOM变化
    const elements = document.querySelectorAll('[data-translation-strategy]');
    elements.forEach(element => {
        window.DisplayManager.revert(element);
        // 清理所有与翻译相关的标记
        delete element.dataset.translated;
        delete element.dataset.translationStrategy;
        delete element.dataset.translationId; // 新增：移除唯一ID
        // 如果有错误提示，也一并移除
        element.classList.remove('universal-translator-error');
        delete element.dataset.errorMessage;
    });
    originalContent.clear(); // 清空原始文本缓存

    // 报告还原完成状态
    try {
        await browser.runtime.sendMessage({
            type: 'TRANSLATION_STATUS_UPDATE',
            payload: { status: 'original', tabId: tabId }
        });
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
    try {
        switch (request.type) {
            case 'PING':
                sendResponse({ status: 'PONG' });
                break;

            case 'DISPLAY_SELECTION_TRANSLATION':
                const { success, translatedText, error, isLoading } = request.payload;
                if (isLoading) {
                    showSelectionTranslationPanel("", false, true);
                } else if (success) {
                    showSelectionTranslationPanel(translatedText);
                } else {
                    showSelectionTranslationPanel(`翻译失败: ${error || 'Unknown error'}`, true);
                }
                break;

            case 'TRANSLATE_PAGE_REQUEST':
                const translateTabId = request.payload?.tabId;
                if (!translateTabId) {
                    throw new Error("tabId not provided in TRANSLATE_PAGE_REQUEST payload.");
                }
                await performPageTranslation(translateTabId);
                sendResponse({ success: true });
                break;

            case 'REVERT_PAGE_TRANSLATION':
                const revertTabId = request.payload?.tabId;
                if (!revertTabId) {
                    throw new Error("tabId not provided in REVERT_PAGE_TRANSLATION payload.");
                }
                await revertPageTranslation(revertTabId);
                break;

            case 'TRANSLATION_CHUNK_RESULT':
                const { id, success: chunkSuccess, translatedText: chunkText, error: chunkError } = request.payload;
                const element = document.querySelector(`[data-translation-id='${id}']`);
                if (element) {
                    if (chunkSuccess) {
                        window.DisplayManager.apply(element, chunkText);
                    } else {
                        window.DisplayManager.showError(element, chunkError);
                    }
                }

                // 检查是否所有块都已完成
                translationJob.completedChunks++;
                if (translationJob.completedChunks >= translationJob.totalChunks) {
                    browser.runtime.sendMessage({
                        type: 'TRANSLATION_STATUS_UPDATE',
                        payload: { status: 'translated', tabId: translationJob.tabId }
                    }).catch(e => logError('reportTranslationStatus (all chunks done)', e));
                }
                break;

            default:
                console.warn(`[Universal Translator] Unknown message type: ${request.type}`);
        }
    } catch (error) {
        logError(`handleMessage (type: ${request.type})`, error);
        // 对于异步消息，我们不能在这里安全地调用 sendResponse
    }
    // 始终返回 true，因为许多处理程序是异步的，并且不会立即调用 sendResponse。
    return true;
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
        if (mutation.type !== 'childList') continue;

        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE || node.closest('[data-translated="true"]')) {
                continue;
            }
            // 只处理元素节点，并从中查找文本节点
            nodesToTranslate.push(...findTextNodes(node));
        }
    }

    if (nodesToTranslate.length === 0) {
        return;
    }

    const visibleTextNodes = nodesToTranslate.filter(node => isElementVisible(node.parentElement));
    if (visibleTextNodes.length === 0) {
        return;
    }

    try {
        const { settings } = await browser.storage.sync.get('settings');
        const targetLang = settings?.targetLanguage || 'ZH';
        const CHUNK_SIZE = settings?.parallelRequests || 2;
        const tabId = translationJob.tabId; // 从全局任务对象获取 tabId

        if (!tabId) return; // 如果没有 tabId，则无法继续

        // 使用与 performPageTranslation 相同的分块逻辑
        const chunks = [];
        for (let i = 0; i < visibleTextNodes.length; i += CHUNK_SIZE) {
            chunks.push(visibleTextNodes.slice(i, i + CHUNK_SIZE));
        }

        // 为动态内容增加总块数
        translationJob.totalChunks += chunks.length;

        chunks.forEach(chunk => {
            const texts = [];
            const ids = [];
            chunk.forEach(node => {
                const parent = node.parentElement;
                if (!parent.dataset.translationId) {
                    parent.dataset.translationId = `ut-${crypto.randomUUID()}`;
                }
                // 保存原始文本以供还原
                if (!originalContent.has(node)) {
                    originalContent.set(node, node.nodeValue);
                }
                texts.push(node.nodeValue);
                ids.push(parent.dataset.translationId);
            });

            browser.runtime.sendMessage({
                type: 'TRANSLATE_TEXT_CHUNK',
                payload: { texts, ids, targetLang, sourceLang: 'auto', tabId }
            }).catch(e => logError('debouncedTranslateMutations (send chunk)', e));
        });

    } catch (error) {
        logError('debouncedTranslateMutations', error);
    }
}, 500);

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

