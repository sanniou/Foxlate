/**
 * 集中式错误记录器，用于内容脚本。
 * @param {string} context - 错误发生的上下文（例如，函数名）。
 * @param {Error} error - 错误对象。
 */
function logError(context, error) {
    console.error(`[SanReader Content Script Error] in ${context}:`, error.message, error.stack);
}

/**
 * 生成一个 v4 UUID。
 * @returns {string} A UUID.
 */
function generateUUID() {
    if (self.crypto && self.crypto.randomUUID) {
        return self.crypto.randomUUID();
    }
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

/**
 * 使用 TreeWalker 查找并返回一个元素下的所有非空文本节点。
 * @param {Node} rootNode - 开始遍历的根节点。
 * @returns {Text[]} 文本节点数组。
 */
function findTextNodes(rootNode) {
    const textNodes = [];
    // 检查 rootNode 是否存在且为元素节点
    if (!rootNode || rootNode.nodeType !== Node.ELEMENT_NODE) {
        return textNodes;
    }
    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                const parentTag = node.parentElement.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'textarea', 'code'].includes(parentTag) || node.parentElement.isContentEditable) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (node.nodeValue.trim() === '') {
                    return NodeFilter.FILTER_REJECT;
                }
                // 检查父元素是否已经标记为被翻译或正在处理中
                if (node.parentElement.closest('[data-translated="true"], [data-translation-id]')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    return textNodes;
}

// --- Observers and Translation Logic ---

let intersectionObserver = null;
let mutationObserver = null;
let originalContent = new Map(); // 用于存储原始文本的映射
let translationJob = {
    totalChunks: 0,
    completedChunks: 0,
    tabId: null,
    isTranslating: false,
};

/**
 * 初始化所有观察者。
 */
function initializeObservers() {
    // 1. IntersectionObserver: 当元素进入视口时触发翻译
    const intersectionCallback = (entries) => {
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        if (visibleEntries.length === 0) return;

        const nodesToTranslate = [];
        for (const entry of visibleEntries) {
            const element = entry.target;
            // 找到与此元素关联的所有文本节点
            const childTextNodes = findTextNodes(element);
            if (childTextNodes.length > 0) {
                nodesToTranslate.push(...childTextNodes);
            }
            // 停止观察，避免重复翻译
            intersectionObserver.unobserve(element);
        }

        if (nodesToTranslate.length > 0) {
            translateNodes(nodesToTranslate);
        }
    };
    intersectionObserver = new IntersectionObserver(intersectionCallback, {
        root: null, // 使用视口作为根
        rootMargin: '200px 0px', // 预加载视口下方200px的内容
        threshold: 0.01 // 元素有1%可见时就触发
    });

    // 2. MutationObserver: 监听DOM变化以翻译新内容
    const mutationCallback = debounce((mutations) => {
        let newNodes = [];
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    // 只处理元素节点，并确保它不是翻译插件自己添加的
                    if (node.nodeType === Node.ELEMENT_NODE && !node.closest('#universal-translator-selection-panel')) {
                        newNodes.push(node);
                    }
                });
            }
        }

        if (newNodes.length > 0) {
            observeElements(newNodes);
        }
    }, 500); // 防抖处理，避免频繁触发

    mutationObserver = new MutationObserver(mutationCallback);
}

/**
 * 观察一组元素，等待它们进入视口。
 * @param {HTMLElement[]} elements - 要观察的元素数组。
 */
function observeElements(elements) {
    if (!intersectionObserver) return;
    for (const element of elements) {
        // 过滤掉脚本、样式等不需要翻译的标签
        const tagName = element.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'textarea', 'code'].includes(tagName)) {
            continue;
        }
        // 检查元素是否已经处理过
        if (element.dataset.translated === 'true' || element.dataset.translationId) {
            continue;
        }
        intersectionObserver.observe(element);
    }
}

/**
 * 核心翻译函数：将文本节点分块并发送到后台进行翻译。
 * @param {Text[]} nodes - 需要翻译的文本节点数组。
 */
async function translateNodes(nodes) {
    if (nodes.length === 0) return;

    try {
        const { settings } = await browser.storage.sync.get('settings');
        const targetLang = settings?.targetLanguage || 'ZH';
        const CHUNK_SIZE = settings?.parallelRequests || 5; // 增加默认并行数

        // 过滤掉无效节点
        const validNodes = nodes.filter(node => node.parentElement && document.body.contains(node));
        if (validNodes.length === 0) return;

        // 保存原始文本
        validNodes.forEach(node => {
            if (!originalContent.has(node)) {
                originalContent.set(node, node.nodeValue);
            }
        });

        const chunks = [];
        for (let i = 0; i < validNodes.length; i += CHUNK_SIZE) {
            chunks.push(validNodes.slice(i, i + CHUNK_SIZE));
        }

        translationJob.totalChunks += chunks.length;
        if (translationJob.totalChunks > 0 && !translationJob.isTranslating) {
            translationJob.isTranslating = true;
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'loading', tabId: translationJob.tabId }
            }).catch(e => logError('reportTranslationStatus (loading)', e));
        }


        chunks.forEach(chunk => {
            const texts = [];
            const ids = [];
            chunk.forEach(node => {
                const parent = node.parentElement;
                if (!parent.dataset.translationId) {
                    parent.dataset.translationId = `ut-${generateUUID()}`;
                }
                texts.push(node.nodeValue);
                ids.push(parent.dataset.translationId);
            });

            browser.runtime.sendMessage({
                type: 'TRANSLATE_TEXT_CHUNK',
                payload: { texts, ids, targetLang, sourceLang: 'auto', tabId: translationJob.tabId }
            }).catch(e => logError('translateNodes (send chunk)', e));
        });

    } catch (error) {
        logError('translateNodes', error);
    }
}

/**
 * 启动所有观察者。
 */
function startObservers() {
    if (!mutationObserver) {
        initializeObservers();
    }
    // 启动MutationObserver来监听后续的DOM变化
    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
    console.log("[SanReader] Observers started.");
}

/**
 * 停止并断开所有观察者。
 */
function stopObservers() {
    if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
    }
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
    console.log("[SanReader] Observers stopped.");
}


/**
 * 执行整页翻译。
 */
async function performPageTranslation(tabId) {
    if (translationJob.isTranslating) return; // 防止重复执行

    // 1. 重置状态
    stopObservers(); // 先停止旧的
    originalContent.clear();
    translationJob = {
        totalChunks: 0,
        completedChunks: 0,
        tabId: tabId,
        isTranslating: false,
    };

    // 2. 初始化并启动观察者
    initializeObservers();
    startObservers();

    // 3. 初始观察：观察当前页面上所有顶层块级元素
    const rootElements = Array.from(document.body.children);
    observeElements(rootElements);
}


/**
 * 还原整页翻译，显示原始文本。
 */
async function revertPageTranslation(tabId) {
    stopObservers();
    const elements = document.querySelectorAll('[data-translation-strategy]');
    elements.forEach(element => {
        window.DisplayManager.revert(element);
        // 清理所有与翻译相关的标记
        delete element.dataset.translated;
        delete element.dataset.translationStrategy;
        delete element.dataset.translationId;
        delete element.dataset.translatedText;
        element.classList.remove('universal-translator-error');
        delete element.dataset.errorMessage;
    });
    originalContent.clear();
    translationJob.isTranslating = false;

    try {
        await browser.runtime.sendMessage({
            type: 'TRANSLATION_STATUS_UPDATE',
            payload: { status: 'original', tabId: tabId }
        });
    } catch (e) {
        logError('revertPageTranslation', e);
    }
}


// --- Message Handling & UI ---

/**
 * 处理来自 background 或 popup 的消息。
 */
async function handleMessage(request, sender, sendResponse) {
    try {
        switch (request.type) {
            case 'PING':
                sendResponse({ status: 'PONG' });
                break;

            case 'TRANSLATE_PAGE_REQUEST':
                await performPageTranslation(request.payload?.tabId);
                sendResponse({ success: true });
                break;

            case 'REVERT_PAGE_TRANSLATION':
                await revertPageTranslation(request.payload?.tabId);
                break;

            case 'TRANSLATION_CHUNK_RESULT':
                const { id, success, translatedText, wasTranslated, error } = request.payload;
                // 注意：一个ID可能对应多个文本节点，但它们共享同一个父元素
                const element = document.querySelector(`[data-translation-id='${id}']`);
                if (element) {
                    if (success && wasTranslated) {
                        // DisplayManager需要能处理整个元素，而不是单个文本节点
                        window.DisplayManager.apply(element, translatedText);
                    } else if (!success) {
                        window.DisplayManager.showError(element, error);
                    }
                }

                translationJob.completedChunks++;
                if (translationJob.completedChunks >= translationJob.totalChunks) {
                    translationJob.isTranslating = false;
                    browser.runtime.sendMessage({
                        type: 'TRANSLATION_STATUS_UPDATE',
                        payload: { status: 'translated', tabId: translationJob.tabId }
                    }).catch(e => logError('reportTranslationStatus (all chunks done)', e));
                }
                break;

            case 'UPDATE_DISPLAY_MODE':
                window.DisplayManager.updateDisplayMode(request.payload.displayMode);
                break;

            // ... (选择翻译部分的功能保持不变)
        }
    } catch (error) {
        logError(`handleMessage (type: ${request.type})`, error);
    }
    return true; // 保持异步消息通道开放
}

/**
 * Simple debounce function.
 */
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * 初始化内容脚本。
 */
function initializeContentScript() {
    if (window.hasInitialized) return;
    window.hasInitialized = true;

    console.log("[SanReader] Content script initializing...");
    if (!window.DisplayManager) {
        logError('initializeContentScript', new Error("DisplayManager is not available."));
        return;
    }
    try {
        browser.runtime.onMessage.addListener(handleMessage);
        console.log("[SanReader] Message listener set up successfully.");
    } catch (error) {
        logError('initializeContentScript', new Error("Failed to set up message listener: " + error.message));
    }
}

initializeContentScript();