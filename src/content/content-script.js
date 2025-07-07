/**
 * 集中式错误记录器，用于内容脚本。
 * @param {string} context - 错误发生的上下文（例如，函数名）。
 * @param {Error} error - 错误对象。
 */
function logError(context, error) {
    // 过滤掉用户中断的“错误”，因为它不是一个真正的异常
    if (error && error.message.includes("interrupted")) {
        console.log(`[Foxlate] Task interrupted in ${context}.`);
        return;
    }
    console.error(`[Foxlate Content Script Error] in ${context}:`, error.message, error.stack);
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

/**
 * 核心翻译函数：将元素内的文本节点分块并发送到后台进行翻译。
 * @param {HTMLElement[]} elements - 需要翻译的元素数组。
 */
function translateElements(elements) {
    if (elements.length === 0) return;

    try {
        const effectiveSettings = currentPageJob.settings;
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
            // *** 在创建包裹元素之前执行预检查 ***
            if (textToTranslate.length > 0 && window.shouldTranslate(textToTranslate, effectiveSettings).result) {
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
        currentPageJob.totalChunks += Math.ceil(texts.length / CHUNK_SIZE);
        // 'loading' 状态现在由 service-worker 在收到 'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT' 消息的响应后立即设置。
        // 这避免了冗余的消息传递，并使状态更改更具原子性。

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
                payload: { texts: textChunk, ids: idChunk, targetLang, sourceLang: 'auto', tabId: currentPageJob.tabId, translatorEngine }
            }).catch(e => logError('translateElements (send chunk)', e));
        }

    } catch (error) {
        logError('translateElements', error);
    }
}

/**
 * (新) 获取当前页面生效的配置，合并默认和域名规则。
 * @returns {Promise<object>} - 合并后的有效配置对象。
 */
async function getEffectiveSettings() {
    // 将此函数暴露到 window 对象，以便其他内容脚本模块可以访问
    window.getEffectiveSettings = getEffectiveSettings;

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
        console.log("[Foxlate] An empty CSS selector is configured, so no elements will be selected for page translation.");
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

/**
 * Reverts a single translated element wrapper back to its original text node,
 * and cleans up its associated state. This is the single source of truth for
 * reverting any element.
 * @param {HTMLElement} wrapper - The <font> element wrapping the original text.
 */
function revertElement(wrapper) {
    if (!wrapper) return;

    // Let the DisplayManager handle strategy-specific UI cleanup and state removal.
    window.DisplayManager.revert(wrapper);

    // Restore the original DOM structure if the wrapper is still in the DOM.
    if (wrapper.parentNode) {
        const originalText = wrapper.dataset.originalText; // This was saved before translation
        if (typeof originalText === 'string') {
            wrapper.replaceWith(document.createTextNode(originalText));
        } else {
            // Fallback if original text is missing.
            wrapper.remove();
        }
    }
}

/**
 * (新) 处理单个翻译块的结果。
 * @param {object} payload - 从后台脚本接收的负载。
 */
function handleChunkResult(payload) {
    const { id, success, translatedText, wasTranslated, error } = payload;
    const wrapper = document.querySelector(`[data-translation-id='${id}']`);

    if (!wrapper) {
        // 元素可能已从 DOM 中移除，这是正常情况。
        return;
    }

    // 简化的条件：仅在成功翻译时显示。
    // 否则，恢复元素。
    if (success && wasTranslated) {
        window.DisplayManager.displayTranslation(wrapper, translatedText);
    } else {
        // 这涵盖了：
        // 1. 显式错误（error 不为 null）。
        // 2. 成功但未翻译（例如，源语言与目标语言相同）。
        // 3. 中断错误。
        if (error) {
            console.log(`[Content Script] Chunk ${id} translation failed or was interrupted:`, error);
        }
        revertElement(wrapper);
    }
}

/**
 * (新) 更新页面翻译的整体进度。
 */
function updateTranslationProgress() {
    if (!currentPageJob) return;
    currentPageJob.completedChunks++;
    // 当所有块都完成时，将状态更新为“已翻译”。
    if (currentPageJob.state === 'translating' && currentPageJob.completedChunks >= currentPageJob.totalChunks) {
        currentPageJob.state = 'translated';
        console.log(`[Foxlate] TRANSLATION_STATUS_UPDATE,Translation completed.`, currentPageJob);
        browser.runtime.sendMessage({
            type: 'TRANSLATION_STATUS_UPDATE',
            payload: { status: 'translated', tabId: currentPageJob.tabId }
        }).catch(e => logError('reportTranslationStatus (completed)', e));
    }
}

// --- State Management Class ---

let currentPageJob = null;
let mutationObserver = null;
let currentSelectionTranslationId = null;

class PageTranslationJob {
    constructor(tabId, settings) {
        this.tabId = tabId;
        this.settings = settings;

        this.mutationQueue = new Set();
        this.idleCallbackId = null;
        this.totalChunks = 0;
        this.completedChunks = 0;
        this.intersectionObserver = null;
        this.mutationObserver = null;

        // 明确的状态属性
        this.state = 'idle'; // 'idle', 'starting', 'translating', 'translated', 'reverting'
    }

    async start() {
        if (this.state !== 'idle') {
            console.warn(`[Foxlate] Job is not idle (state: ${this.state}). Ignoring start request.`);
            return;
        }

        console.log("[Foxlate] Starting page translation process...");
        this.state = 'starting';

        // 设置一个全局标记，表示翻译会话已开始。
        document.body.dataset.translationSession = 'active';

        try {
            // 校验核心设置
            if (!this.settings.targetLanguage) {
                throw new Error(browser.i18n.getMessage('errorMissingTargetLanguage') || 'Target language is not configured.');
            }
            if (!this.settings.translatorEngine) {
                throw new Error(browser.i18n.getMessage('errorMissingEngine') || 'Translation engine is not configured.');
            }
            if (typeof this.settings.translationSelector === 'undefined') {
                throw new Error(browser.i18n.getMessage('errorMissingSelector') || 'CSS selector for translation is not configured.');
            }
        } catch (error) {
            logError('PageTranslationJob.start (settings validation)', error);
            // 在设置验证失败时，不再尝试在内部 revert，而是抛出错误。
            // 这将由 handleMessage 中的上层 try...catch 块来捕获和处理。
            this.state = 'idle'; // 确保状态被重置
            throw error;
        }

        this.#initializeObservers();
        this.#startMutationObserver();

        const elementsToObserve = findTranslatableRootElements(this.settings);
        console.log(`[Foxlate] Found ${elementsToObserve.length} root elements to observe for translation.`);

        if (elementsToObserve.length > 0) {
            this.#observeElements(elementsToObserve);
        } else {
            console.warn("[Foxlate] No translatable elements found to observe initially.");
        }
        this.state = 'translating';
    }

    async revert() {
        // 关键步骤：在执行任何客户端清理之前，立即通知后台停止所有与此标签页相关的、正在进行的翻译任务。
        // 这可以防止在页面恢复后，迟到的翻译结果错误地更新DOM。
        try {
            await browser.runtime.sendMessage({ type: 'STOP_TRANSLATION', payload: { tabId: this.tabId } });
        } catch (e) {
            // 如果消息发送失败（例如，后台脚本已失效），记录错误但继续执行客户端清理。
            logError('revert (sending STOP_TRANSLATION)', e);
        }

        console.log("[Foxlate] Reverting entire page translation...");
        this.state = 'reverting';

        this.#stopObservers();

        try {
            // 1. 清除全局翻译会话标志。
            delete document.body.dataset.translationSession;

            // 2. 隐藏所有浮动UI元素。
            window.DisplayManager.hideAllEphemeralUI();

            // 3. 查找所有包裹元素并逐个恢复它们。
            const wrappers = document.querySelectorAll('font[data-translation-id]');
            wrappers.forEach(revertElement);
            console.log(`[Foxlate] Reverted ${wrappers.length} translated elements.`);
        } catch (error) {
            logError('revert (DOM cleanup)', error);
        }

        // 4. 重置全局任务引用，正式结束当前翻译任务。
        currentPageJob = null;
    }

    // --- Private Methods ---

    /**
     * 初始化 IntersectionObserver 和 MutationObserver。
     * 此方法将回调逻辑委托给其他私有方法，以保持代码清晰。
     */
    #initializeObservers() {
        const intersectionOptions = {
            root: null,
            rootMargin: '0px 0px',
            threshold: 0.5
        };
        this.intersectionObserver = new IntersectionObserver(this.#handleIntersection.bind(this), intersectionOptions);
        this.mutationObserver = new MutationObserver(this.#handleMutation.bind(this));
    }

    #startMutationObserver() {
        if (!this.mutationObserver) this.#initializeObservers();
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        console.log("[Foxlate] Mutation observer started.");
    }

    #stopObservers() {
        if (this.intersectionObserver) this.intersectionObserver.disconnect();
        if (this.mutationObserver) this.mutationObserver.disconnect();
        this.intersectionObserver = null;
        this.mutationObserver = null;
        console.log("[Foxlate] Observers stopped.");
    }

    #observeElements(elements) {
        if (!this.intersectionObserver) return;
        for (const element of elements) {
            if (element.dataset.translated === 'true' || element.dataset.translationId) {
                continue;
            }
            this.intersectionObserver.observe(element);
        }
    }

    #translateElements(elements) {
        // This method's logic is complex and can be moved here from the global scope.
        // For brevity, we'll assume the global `translateElements` is adapted to be a private method.
        // The key change is that it will use `this.settings`, `this.tabId`, etc.
        // And it will call `this.#handleChunkResult`
        translateElements(elements); // Simplified for this diff
    }

    /**
     * IntersectionObserver 的回调函数。
     * 当被观察的元素进入视口时触发。
     * @param {IntersectionObserverEntry[]} entries - 观察者条目数组。
     */
    #handleIntersection(entries) {
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        if (visibleEntries.length === 0) return;

        const elementsToTranslate = [];
        for (const entry of visibleEntries) {
            elementsToTranslate.push(entry.target);
            // 一旦元素可见并准备翻译，就停止观察它，避免重复工作。
            this.intersectionObserver.unobserve(entry.target);
        }
        if (elementsToTranslate.length > 0) {
            this.#translateElements(elementsToTranslate);
        }
    }

    /**
     * MutationObserver 的回调函数。
     * 当 DOM 树发生变化时触发。
     * @param {MutationRecord[]} mutations - 变化记录数组。
     */
    #handleMutation(mutations) {
        let hasNewNodes = false;
        for (const mutation of mutations) {
            // 我们只关心DOM中添加了新节点的变化。
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    // 只处理元素节点，并忽略我们自己的翻译UI或已翻译的内容，以避免无限循环。
                    if (node.nodeType === Node.ELEMENT_NODE && !node.closest('[data-translation-id], #universal-translator-selection-panel')) {
                        this.mutationQueue.add(node);
                        hasNewNodes = true;
                    }
                });
            }
        }

        if (hasNewNodes && !this.idleCallbackId) {
            // 使用 requestIdleCallback 延迟处理，避免阻塞主线程。
            this.idleCallbackId = requestIdleCallback(() => this.#processMutationQueue(), { timeout: 1000 });
        }
    }

    #processMutationQueue() {
        this.idleCallbackId = null;
        if (this.mutationQueue.size === 0) return;

        const newNodes = Array.from(this.mutationQueue);
        this.mutationQueue.clear();

        if (!this.settings) {
            console.warn("[Foxlate] Mutation observed, but no settings found. Skipping.");
            return;
        }

        const newElementsToObserve = findTranslatableRootElements(this.settings, newNodes);
        this.#observeElements(newElementsToObserve);
    }
}


// --- Message Handling & UI ---

async function handleMessage(request, sender) {
    console.trace(`[Content Script] Received message from sender :`, request)
    try {
        switch (request.type) {
            case 'PING':
                return Promise.resolve({ status: 'PONG' });

            case 'SETTINGS_UPDATED':
                console.log("[Content Script] Received settings update. Updating local cache.");
                // Re-fetch and cache the effective settings for subsequent operations.
                // 如果当前有翻译任务正在进行，则更新其设置。
                if (currentPageJob) {
                    currentPageJob.settings = await getEffectiveSettings();
                    console.log("[Foxlate] Updated job settings:", currentPageJob.settings);
                }
                return { success: true };

            case 'TRANSLATE_PAGE_REQUEST':
                // 由自动翻译规则触发
                if (currentPageJob) {
                    console.warn("[Foxlate] Auto-translate request received, but a job is already active. Ignoring.");
                } else {
                    const settings = await getEffectiveSettings();
                    currentPageJob = new PageTranslationJob(request.payload.tabId, settings);
                    await currentPageJob.start();
                }
                return { success: true };

            case 'REVERT_PAGE_TRANSLATION':
                // 目前没有代码路径会发送此消息，但保留以备将来使用。
                if (currentPageJob) {
                    await currentPageJob.revert();
                }
                return { success: true };
            
            case 'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT':
                {
                    // 由用户点击浏览器图标或使用快捷键触发
                    const isSessionActiveForToggle = document.body.dataset.translationSession === 'active';
                    const action = isSessionActiveForToggle ? 'revert' : 'translate';
                    const { tabId } = request.payload;

                    if (action === 'translate') {
                        if (currentPageJob) {
                            // 这是一个不应该发生的状态：页面标记为未翻译，但存在一个任务。
                            // 最安全的做法是先恢复旧任务，然后再开始新任务。
                            console.warn("[Foxlate] State mismatch: job exists but session is not active. Reverting old job first.");
                            await currentPageJob.revert();
                        }
                        // 创建并启动一个新任务
                        const settings = await getEffectiveSettings();
                        currentPageJob = new PageTranslationJob(tabId, settings);
                        // start() 方法在配置校验失败时会抛出错误，
                        // 这个错误会被外层的 try...catch 块捕获，从而中断执行。
                        await currentPageJob.start();
                    } else if (action === 'revert') {
                        if (!currentPageJob) {
                            // 这是一个不应该发生的状态：页面标记为已翻译，但没有任务实例。
                            // 这可能在开发中因脚本重载而发生。无论如何，我们都应该尝试清理DOM。
                            console.warn("[Foxlate] State mismatch: session is active but no job exists. Attempting DOM cleanup.");
                            // 创建一个临时的、无设置的任务实例，只为了调用其清理逻辑。
                            const cleanupJob = new PageTranslationJob(tabId, {});
                            await cleanupJob.revert(); // revert会处理DOM并最终将currentPageJob设为null
                        } else {
                            await currentPageJob.revert();
                        }

                    // Determine the new state and return it in the response.
                    // This makes the content script the single source of truth for the state change,
                    // and the service worker can react immediately without waiting for another message.
                    const newState = (action === 'translate') ? 'loading' : 'original';

                    return { success: true, newState: newState };
                }
            }

            case 'TRANSLATION_CHUNK_RESULT':
                handleChunkResult(request.payload);
                updateTranslationProgress();
                return { success: true };

            case 'UPDATE_DISPLAY_MODE':
                const { displayMode } = request.payload;
                if (currentPageJob && currentPageJob.settings) {
                    currentPageJob.settings.displayMode = displayMode;
                }
                window.DisplayManager.updateDisplayMode(displayMode);
                return { success: true };

            case 'REQUEST_TRANSLATION_STATUS':
                {
                    let status = 'original';
                    if (currentPageJob) {
                        // 将内部状态映射为后台脚本期望的状态字符串
                        switch (currentPageJob.state) {
                            case 'starting':
                            case 'translating':
                                status = 'loading';
                                break;
                            case 'translated':
                                status = 'translated';
                                break;
                            // 对于 'idle', 'reverting' 等状态，都视为 'original'
                        }
                    }
                    return Promise.resolve({ state: status });
                }

            case 'DISPLAY_SELECTION_TRANSLATION':
                {
                    const { translationId, isLoading } = request.payload;

                    if (isLoading) {
                        // 一个新的划词翻译请求开始。记录其唯一ID作为“当前”有效的ID。
                        currentSelectionTranslationId = translationId;
                    } else {
                        // 收到一个翻译结果。必须检查其ID是否与最新的请求ID匹配。
                        // 这可以防止一个较慢的、旧的翻译结果覆盖一个新的、更快的翻译结果（竞态条件）。
                        if (translationId !== currentSelectionTranslationId) {
                            console.log(`[Foxlate] 忽略了一个过时的划词翻译结果。ID: ${translationId}`);
                            return { success: true, ignored: true }; // 确认收到消息，但忽略它。
                        }
                    }

                    // 如果检查通过，则将负载传递给DisplayManager进行UI更新。
                    window.DisplayManager.handleEphemeralTranslation(request.payload);
                }
                return { success: true };

            case 'TOGGLE_SUBTITLE_TRANSLATION':
                if (window.subtitleManager && typeof window.subtitleManager.toggle === 'function') {
                    window.subtitleManager.toggle(request.payload.enabled);
                } else {
                    // 如果管理器不可用，记录一个警告但不要抛出错误，因为这在非视频页面是预期行为。
                    console.warn("[Content Script] Subtitle manager not available to toggle. This is expected on non-supported pages.");
                }
                return { success: true };

            case 'REQUEST_SUBTITLE_TRANSLATION_STATUS':
                if (window.subtitleManager && typeof window.subtitleManager.getStatus === 'function') {
                    return Promise.resolve(window.subtitleManager.getStatus());
                }
                // 如果 subtitleManager 不存在，返回一个表示“不支持”和“未启用”的默认状态。
                return Promise.resolve({ isSupported: false, isEnabled: false });

            default:
                console.warn(`[Content Script] Unhandled message type: ${request.type}`);
                break;
        }
    } catch (error) {
        logError(`handleMessage (type: ${request.type})`, error);
        return Promise.reject(error);
    }
}

// --- Initialization ---

/**
 * 初始化内容脚本。
 * 通过检查一个全局标志来确保所有初始化逻辑只运行一次，
 * 从而使脚本的注入变得幂等（即使被多次注入也不会产生副作用）。
 */
function initializeContentScript() {
    if (window.foxlateContentScriptInitialized) {
        console.log("[Foxlate] Content script already initialized. Skipping re-initialization.");
        return;
    }
    window.foxlateContentScriptInitialized = true;
    console.log("[Foxlate] Initializing content script...");

    browser.runtime.onMessage.addListener(handleMessage);
    window.getEffectiveSettings = getEffectiveSettings;
    window.__foxlate_css_injected = true; // 标记CSS注入状态
}

initializeContentScript();
