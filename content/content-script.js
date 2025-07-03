/**
 * 集中式错误记录器，用于内容脚本。
 * @param {string} context - 错误发生的上下文（例如，函数名）。
 * @param {Error} error - 错误对象。
 */
function logError(context, error) {
    // 过滤掉用户中断的“错误”，因为它不是一个真正的异常
    if (error && error.message.includes("interrupted")) {
        console.log(`[SanReader] Task interrupted in ${context}.`);
        return;
    }
    console.error(`[SanReader Content Script Error] in ${context}:`, error.message, error.stack);
}

/**
 * 生成一个 v4 UUID。
 * @returns {string} A UUID.
 */
function generateUUID() {
    // crypto.randomUUID() is supported in all modern browsers that support Manifest V3.
    // The fallback is unnecessary and has been removed for clarity and security.
    return self.crypto.randomUUID();
}

// 优化：将忽略的标签列表定义为 Set，以获得更快的查找性能。
// 将其置于函数外部，避免在每次函数调用时重复创建。
const IGNORED_TAGS = new Set(['script', 'style', 'noscript', 'textarea', 'code']);

/**
 * 使用 TreeWalker 查找并返回一个元素下的所有非空文本节点。
 * @param {Node} rootNode - 开始遍历的根节点。
 * @returns {Text[]} 文本节点数组。
 */
function findTextNodes(rootNode) {
    // 前置检查：如果根节点本身无效或已在翻译容器内，则直接返回空数组，避免创建 TreeWalker。
    if (!rootNode || rootNode.nodeType !== Node.ELEMENT_NODE || rootNode.closest('[data-translated="true"], [data-translation-id]')) {
        return [];
    }

    const textNodes = [];
    // 优化：TreeWalker 同时访问元素和文本节点。
    // 这允许我们通过在元素级别上拒绝节点来“修剪”DOM树的整个分支，
    // 从而避免对被忽略的子树（如 <script> 或已翻译的容器）进行不必要的遍历。
    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // 性能关键点：如果元素应该被忽略，则拒绝它。
                    // TreeWalker 将自动跳过该元素及其所有后代。
                    // 这比在每个文本节点上调用 .closest() 要快得多。
                    if (IGNORED_TAGS.has(node.tagName.toLowerCase()) ||
                        node.isContentEditable ||
                        node.hasAttribute('data-translated') ||
                        node.hasAttribute('data-translation-id')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    // 如果元素本身没问题，我们对它的子节点感兴趣，但不对元素本身感兴趣。
                    return NodeFilter.FILTER_SKIP;
                }

                // 对于文本节点，只进行最后的检查。
                if (node.nodeValue.trim() === '') {
                    return NodeFilter.FILTER_REJECT; // 忽略纯空白文本节点。
                }

                // 这是一个我们想要翻译的有效文本节点。
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    while (walker.nextNode()) {
        textNodes.push(walker.currentNode); // walker.currentNode 现在总是被接受的文本节点
    }
    return textNodes;
}

// --- Observers and Translation Logic ---

let intersectionObserver = null;
let mutationObserver = null;
let translationJob = {
    mutationQueue: new Set(),
    idleCallbackId: null,
    totalChunks: 0,
    completedChunks: 0,
    tabId: null,
    isTranslating: false,
};

/**
 * 处理由 MutationObserver 收集的节点队列。
 * 此函数由 requestIdleCallback 调用，以确保它在浏览器空闲时运行，
 * 从而不影响关键的渲染或用户交互。
 */
function processMutationQueue() {
    translationJob.idleCallbackId = null; // 重置调度ID，允许下一次调度

    if (translationJob.mutationQueue.size === 0) return;

    const newNodes = Array.from(translationJob.mutationQueue);
    translationJob.mutationQueue.clear();

    if (!translationJob.settings) {
        console.warn("[SanReader] Mutation observed, but no translation job settings found. Skipping auto-translation of new content.");
        return;
    }

    // 对新节点执行与初始加载时相同的逻辑
    const newElementsToObserve = findTranslatableRootElements(translationJob.settings, newNodes);
    observeElements(newElementsToObserve);
}

/**
 * 初始化所有观察者。
 */
function initializeObservers() {
    const intersectionCallback = (entries) => {
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        if (visibleEntries.length === 0) return;

        const elementsToTranslate = [];
        for (const entry of visibleEntries) {
            elementsToTranslate.push(entry.target);
            intersectionObserver.unobserve(entry.target);
        }
        if (elementsToTranslate.length > 0) {
            translateElements(elementsToTranslate);
        }
    };
    intersectionObserver = new IntersectionObserver(intersectionCallback, {
        root: null,
        rootMargin: '0px 0px', // 移除预加载区域，确保只翻译严格进入视口的元素
        threshold: 0.5 // 确保元素至少有50%进入视口才触发翻译
    });

    const mutationCallback = (mutations) => {
        let hasNewNodes = false;
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE && !node.closest('#universal-translator-selection-panel')) {
                        translationJob.mutationQueue.add(node);
                        hasNewNodes = true;
                    }
                });
            }
        }

        if (hasNewNodes && !translationJob.idleCallbackId) {
            translationJob.idleCallbackId = requestIdleCallback(processMutationQueue, { timeout: 1000 });
        }
    };

    mutationObserver = new MutationObserver(mutationCallback);
}

/**
 * 观察一组元素，等待它们进入视口。
 * @param {HTMLElement[]} elements - 要观察的元素数组。
 */
function observeElements(elements) {
    if (!intersectionObserver) return;
    for (const element of elements) {
        if (element.dataset.translated === 'true' || element.dataset.translationId) {
            continue;
        }
        intersectionObserver.observe(element);
    }
}

/**
 * 核心翻译函数：将元素内的文本节点分块并发送到后台进行翻译。
 * @param {HTMLElement[]} elements - 需要翻译的元素数组。
 */
function translateElements(elements) {
    if (elements.length === 0) return;

    try {
        const effectiveSettings = translationJob.settings;
        if (!effectiveSettings) {
            logError('translateElements', new Error("Translation job settings are not available."));
            return;
        }
        const targetLang = effectiveSettings?.targetLanguage;
        const translatorEngine = effectiveSettings?.translatorEngine;

        // The validation for these settings should have happened in performPageTranslation.
        // This is a final safeguard.
        if (!targetLang || !translatorEngine) {
            logError('translateElements', new Error("Cannot translate elements without targetLanguage or translatorEngine."));
            return;
        }

        const CHUNK_SIZE = effectiveSettings?.parallelRequests || 5;

        // 使用 Set 来防止因处理重叠元素（例如，一个元素是另一个元素的子元素）而导致的重复文本节点。
        const nodesToTranslate = new Set();
        elements.forEach(el => {
            // 将找到的节点添加到 Set 中，Set 会自动处理重复项。
            findTextNodes(el).forEach(node => nodesToTranslate.add(node));
        });

        const validNodes = Array.from(nodesToTranslate).filter(node => node.parentElement && document.body.contains(node));
        if (validNodes.length === 0) return;

        // 为每个文本节点创建包裹元素，并收集文本进行翻译
        const texts = [];
        const ids = [];
        const idToWrapperMap = new Map();

        validNodes.forEach(node => {
            const textToTranslate = node.nodeValue.trim();
            if (textToTranslate.length > 0) {
                // 创建一个包裹元素来持有文本节点和翻译ID。
                // 使用 <font> 标签可以减少对页面样式的干扰，因为它通常没有附加样式。
                const wrapper = document.createElement('font');
                const nodeId = `ut-${generateUUID()}`;
                wrapper.dataset.translationId = nodeId;
                wrapper.dataset.originalText = node.nodeValue; // 保存原始文本节点内容

                // 将原始文本节点的内容移动到包裹元素中，保留原始的空白字符。
                wrapper.textContent = node.nodeValue;

                // 在DOM中用包裹元素替换原始文本节点。
                node.parentNode.replaceChild(wrapper, node);
                idToWrapperMap.set(nodeId, wrapper);

                // 收集ID和要翻译的文本
                texts.push(textToTranslate);
                ids.push(nodeId);
            }
        });

        if (texts.length === 0) return;

        // 更新任务状态
        translationJob.totalChunks += Math.ceil(texts.length / CHUNK_SIZE);
        if (!translationJob.isTranslating) {
            translationJob.isTranslating = true;
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'loading', tabId: translationJob.tabId }
            }).catch(e => logError('reportTranslationStatus (loading)', e));
        }

        // 分块发送
        for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
            const textChunk = texts.slice(i, i + CHUNK_SIZE);
            const idChunk = ids.slice(i, i + CHUNK_SIZE);

            // 在发送请求前，为当前批次的元素显示加载状态
            idChunk.forEach(id => {
                const wrapper = idToWrapperMap.get(id);
                if (wrapper) {
                    window.DisplayManager.displayLoading(wrapper, effectiveSettings.displayMode);
                }
            });

            browser.runtime.sendMessage({
                type: 'TRANSLATE_TEXT_CHUNK',
                payload: { texts: textChunk, ids: idChunk, targetLang, sourceLang: 'auto', tabId: translationJob.tabId, translatorEngine }
            }).catch(e => logError('translateElements (send chunk)', e));
        }

    } catch (error) {
        logError('translateElements', error);
    }
}

function startObservers() {
    if (!mutationObserver) {
        initializeObservers();
    }
    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
    console.log("[SanReader] Observers started.");
}

function stopObservers() {
    if (intersectionObserver) intersectionObserver.disconnect();
    if (mutationObserver) mutationObserver.disconnect();
    intersectionObserver = null;
    mutationObserver = null;
    console.log("[SanReader] Observers stopped.");
}

/**
 * (新) 获取当前页面生效的配置，合并默认和域名规则。
 * @returns {Promise<object>} - 合并后的有效配置对象。
 */
async function getEffectiveSettings() {
    return browser.runtime.sendMessage({
        type: 'GET_EFFECTIVE_SETTINGS',
        payload: { hostname: window.location.hostname }
    });
}

/**
 * (重构) 根据指定的CSS选择器查找页面上所有可翻译的根元素。
 * @param {object} effectiveSettings - 包含 translationSelector 的配置对象。
 * @param {Node[]} [rootNodes=[document.body]] - 在这些节点内进行搜索。
 * @returns {HTMLElement[]} - 找到的顶层元素数组。
 */
function findTranslatableRootElements(effectiveSettings, rootNodes = [document.body]) {
    // performPageTranslation ensures the selector is not undefined.
    // An empty string is a valid configuration meaning "translate nothing".
    // It must be handled to prevent `querySelectorAll` from throwing an error.
    const selector = effectiveSettings?.translationSelector ?? '';
    if (selector.trim() === '') {
        console.log("[SanReader] An empty CSS selector is configured, so no elements will be selected for page translation.");
        return [];
    }

    const elements = new Set();
    for (const root of rootNodes) {
        // 确保 root 是 Element 节点，可以执行查询
        if (root.nodeType !== Node.ELEMENT_NODE) continue;

        // 检查 root 节点本身是否匹配
        if (root.matches(selector)) {
            elements.add(root);
        }
        // 查找 root 节点下的所有匹配项
        root.querySelectorAll(selector).forEach(el => elements.add(el));
    }
    return Array.from(elements);
}


async function performPageTranslation(tabId) {
    // 幂等性检查：如果翻译会话已经激活，则不执行任何操作。
    // 这是最可靠的单一事实来源，可以防止在已翻译或正在翻译的页面上重新启动该过程。
    if (document.body.dataset.translationSession === 'active') {
        console.log("[SanReader] Translation session is already active. Ignoring request.");
        return;
    }
    // 这个检查作为第二层防护，以处理可能的竞争条件。
    if (translationJob.isTranslating) {
        console.warn("[SanReader] Translation job already in progress despite session not being active. Ignoring request.");
        return;
    }

    // 设置一个全局标记，表示翻译会话已开始。
    document.body.dataset.translationSession = 'active';

    console.log("[SanReader] Starting page translation process...");
    stopObservers();
    
    let effectiveSettings;
    try {
        effectiveSettings = await getEffectiveSettings();
        console.log("[SanReader] Effective settings for this page:", effectiveSettings);

        // 校验核心设置
        if (!effectiveSettings.targetLanguage) {
            logError('performPageTranslation', new Error(browser.i18n.getMessage('errorMissingTargetLanguage') || 'Target language is not configured.'));
            revertPageTranslation(tabId); // Clean up UI
            return;
        }
        if (!effectiveSettings.translatorEngine) {
            logError('performPageTranslation', new Error(browser.i18n.getMessage('errorMissingEngine') || 'Translation engine is not configured.'));
            revertPageTranslation(tabId); // Clean up UI
            return;
        }
        // 检查 translationSelector 是否为 undefined，允许其为空字符串 ""
        if (typeof effectiveSettings.translationSelector === 'undefined') {
            logError('performPageTranslation', new Error(browser.i18n.getMessage('errorMissingSelector') || 'CSS selector for translation is not configured.'));
            revertPageTranslation(tabId); // Clean up UI
            return;
        }
    } catch (error) {
        logError('performPageTranslation', error);
        console.error("[SanReader] Failed to retrieve effective settings. Please check your configuration.");
        return; // 停止执行，不再进行翻译
    }

   translationJob = {
        totalChunks: 0, completedChunks: 0, tabId: tabId, isTranslating: false, settings: effectiveSettings
    };

    initializeObservers();

    const elementsToObserve = findTranslatableRootElements(effectiveSettings);
    console.log(`[SanReader] Found ${elementsToObserve.length} root elements to observe for translation.`);

    if (elementsToObserve.length > 0) {
        observeElements(elementsToObserve);
    } else {
        console.warn("[SanReader] No translatable elements found to observe initially.");
    }
    
    startObservers();
}

async function revertPageTranslation(tabId) {
    stopObservers();
    // 清除全局的翻译会话标记。
    delete document.body.dataset.translationSession;
    
    // 查找所有由我们创建的包裹元素，无论它们是否已翻译、正在翻译或出错。
    // 'font[data-translation-id]' 是最可靠的选择器。
    const wrappers = document.querySelectorAll('font[data-translation-id]');

    wrappers.forEach(wrapper => {
        // 检查是否有保存的原始文本
        const originalText = wrapper.dataset.originalText;
        if (typeof originalText === 'string' && wrapper.parentNode) {
            // 创建原始的文本节点
            const textNode = document.createTextNode(originalText);
            // 用原始文本节点替换包裹元素，彻底恢复DOM
            wrapper.parentNode.replaceChild(textNode, wrapper);
        } else if (wrapper.parentNode) {
            // 如果没有原始文本（异常情况），为避免留下空标签，直接移除
            wrapper.parentNode.removeChild(wrapper);
        }
    });

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

/**
 * (新) 根据当前页面的翻译状态，切换翻译或恢复原文。
 * @param {number} tabId - 当前标签页的 ID。
 */
async function togglePageTranslation(tabId) {
    // 页面翻译状态的唯一真实来源是 body 上的 `data-translation-session` 属性。
    const isSessionActive = document.body.dataset.translationSession === 'active';

    if (isSessionActive) {
        // 如果会话已激活，意味着页面已翻译或正在加载。正确的操作是恢复原文。
        console.log("[SanReader] 快捷键切换：恢复页面原文。");
        await revertPageTranslation(tabId);
    } else {
        // 如果会话未激活，页面处于原始状态。正确的操作是开始翻译。
        console.log("[SanReader] 快捷键切换：开始页面翻译。");
        await performPageTranslation(tabId);
    }
}

// --- Message Handling & UI ---

async function handleMessage(request, sender) {
    try {
        switch (request.type) {
            case 'PING':
                return Promise.resolve({ status: 'PONG' });

            case 'PING':
                return { status: 'PONG' };

            case 'SETTINGS_UPDATED':
                console.log("[Content Script] Received settings update. Updating local cache.");
                // Re-fetch and cache the effective settings for subsequent operations.
                translationJob.settings = await getEffectiveSettings();
                return; // No response needed

            case 'TRANSLATE_PAGE_REQUEST':
                await performPageTranslation(request.payload?.tabId);
                // **(调试) 输出调用栈**
                console.log("[SanReader] performPageTranslation called:", new Error().stack);
                return { success: true };

            case 'REVERT_PAGE_TRANSLATION':
                await revertPageTranslation(request.payload?.tabId);
                break;

            case 'TOGGLE_TRANSLATION_REQUEST':
                await togglePageTranslation(request.payload?.tabId);
                return { success: true };

            case 'TRANSLATION_CHUNK_RESULT':
                {
                    const { id, success, translatedText, wasTranslated, error } = request.payload;
                    const wrapper = document.querySelector(`[data-translation-id='${id}']`);

                    if (wrapper) {
                        const displayMode = translationJob.settings?.displayMode || 'replace';
                        // 1. 首先，隐藏加载状态
                        window.DisplayManager.hideLoading(wrapper, displayMode);

                        // 2. 然后，根据结果应用最终状态
                        if (error) {
                            // 优先处理错误情况。
                            if (error.includes("interrupted")) {
                                // 用户主动中断，静默地将包裹元素恢复为原始文本节点。
                                const originalText = wrapper.dataset.originalText;
                                if (typeof originalText === 'string' && wrapper.parentNode) {
                                    wrapper.parentNode.replaceChild(document.createTextNode(originalText), wrapper);
                                }
                            } else {
                                // 其他技术错误，向用户显示视觉提示。
                                window.DisplayManager.showError(wrapper, error);
                            }
                        } else if (success && wasTranslated) {
                            // 成功翻译，应用显示策略。
                            window.DisplayManager.apply(wrapper, translatedText, displayMode);
                        } else if (success && !wasTranslated) {
                            // 成功但无需翻译（例如源语言与目标语言相同），恢复DOM以移除包裹元素。
                            const originalText = wrapper.dataset.originalText;
                            if (typeof originalText === 'string' && wrapper.parentNode) {
                                wrapper.parentNode.replaceChild(document.createTextNode(originalText), wrapper);
                            }
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
                }

            case 'UPDATE_DISPLAY_MODE':
                window.DisplayManager.updateDisplayMode(request.payload.displayMode);
                break;

            case 'DISPLAY_SELECTION_TRANSLATION': //  处理右键翻译结果
                {
                    // 后台脚本现在会提供所有必要的细节，包括坐标。
                    const { isLoading, success, translatedText, error, coords, source } = request.payload;

                    // 'coords' 对象对于此消息类型是必需的。
                    if (coords) {
                        if (isLoading) {                            
                            window.DisplayManager.displayLoading(coords,'contextMenu');
                        } else {
                            window.contextMenuStrategy.displayTranslation(coords, success?translatedText:error, false, source);
                        }
                    }
                    break;
                }
                
            case 'REQUEST_TRANSLATION_STATUS': {
                const sessionActive = document.body.dataset.translationSession === 'active';
                let state = 'original';

                if (sessionActive) {
                    // 页面处于翻译会话中，根据是否在忙碌来决定是“加载中”还是“已翻译”
                    state = translationJob.isTranslating ? 'loading' : 'translated';
                }
                // 如果会话未激活，状态保持 'original'
                return { state: state };
            }
        }
    } catch (error) {
        logError(`handleMessage (type: ${request.type})`, error);
        // 将错误传播给发送方，以便 popup 中的 promise 可以 reject。
        throw error;
    }
}

/**
 * (新) 检查是否需要自动翻译。
 * 在内容脚本加载后，主动向后台查询当前页面是否应根据规则自动翻译。
 */
async function triggerAutoTranslationCheck() {
}

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

        // 在动态注入模型中，不再需要内容脚本主动发起检查。
        // 后台脚本将在需要时注入此脚本并发送命令。
    } catch (error) {
        logError('initializeContentScript', new Error("Failed to set up message listener: " + error.message));
    }
}

initializeContentScript();