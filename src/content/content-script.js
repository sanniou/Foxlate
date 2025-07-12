import { DisplayManager } from './display-manager.js';
import { shouldTranslate } from '../common/precheck.js';

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
 * @param {object} effectiveSettings - 当前生效的配置，用于获取选择器。
 * @returns {Text[]} 文本节点数组。
 */
function findTextNodes(rootNode, effectiveSettings) {
    if (!rootNode || rootNode.nodeType !== Node.ELEMENT_NODE || rootNode.closest('[data-translated="true"], [data-translation-id]')) {
        return [];
    }

    const inlineSelector = effectiveSettings?.translationSelector?.inline?.trim();
    const blockSelector = effectiveSettings?.translationSelector?.block?.trim();
    const allSelectors = [inlineSelector, blockSelector].filter(Boolean).join(', ');

    const textNodes = [];
    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // 核心修改：如果一个元素节点本身就是另一个翻译目标，则直接拒绝它和它的整个子树。
                    if (allSelectors && node !== rootNode && node.matches(allSelectors)) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    if (IGNORED_TAGS.has(node.tagName.toLowerCase()) ||
                        node.isContentEditable ||
                        node.hasAttribute('data-translated') ||
                        node.hasAttribute('data-translation-id')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }

                if (node.nodeValue.trim() === '') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }
    return textNodes;
}


// --- Observers and Translation Logic ---

/**
 * 核心翻译函数：将元素内的文本节点分块并发送到后台进行翻译。
 * @param {HTMLElement[]} elements - 需要翻译的元素数组。
 * @param {string} type - 翻译类型 ('inline' 或 'block')，用于标记。
 * @param {object} effectiveSettings - 当前生效的配置。
 */
function translateElements(elements, type, effectiveSettings) {
    if (elements.length === 0) return;

    try {
        if (!effectiveSettings) {
            logError('translateElements', new Error("Translation job settings are not available."));
            return;
        }
        const targetLang = effectiveSettings?.targetLanguage;
        const translatorEngine = effectiveSettings?.translatorEngine;

        if (!targetLang || !translatorEngine) {
            logError('translateElements', new Error("Cannot translate elements without targetLanguage or translatorEngine."));
            return;
        }

        // 从有效配置中获取并发请求数。
        // getEffectiveSettings 保证了这个值的存在，因此不再需要后备值。
        const CHUNK_SIZE = effectiveSettings.parallelRequests;

        const nodesToTranslate = new Set();
        elements.forEach(el => {
            findTextNodes(el, effectiveSettings).forEach(node => nodesToTranslate.add(node));
        });

        const validNodes = Array.from(nodesToTranslate).filter(node => node.parentElement && document.body.contains(node));
        if (validNodes.length === 0) return;

        const texts = [];
        const ids = [];
        const idToWrapperMap = new Map();

        validNodes.forEach(node => {
            const textToTranslate = node.nodeValue.trim();
            if (textToTranslate.length > 0) {
                const { result: shouldTranslateResult, reason } = shouldTranslate(textToTranslate, effectiveSettings);
                if (shouldTranslateResult) {
                    const wrapper = document.createElement('font');
                    const nodeId = `ut-${generateUUID()}`;
                    wrapper.dataset.translationId = nodeId;
                    wrapper.dataset.translationType = type;
                    wrapper.dataset.originalText = node.nodeValue;

                    wrapper.textContent = node.nodeValue;

                    node.parentNode.replaceChild(wrapper, node);
                    idToWrapperMap.set(nodeId, wrapper);

                    texts.push(textToTranslate);
                    ids.push(nodeId);
                } else {
                    // 可选：记录跳过翻译的原因，便于调试
                    console.log(`[Foxlate] Skipping text based on pre-check rule: ${reason}`, textToTranslate);
                }
            }
        });

        if (texts.length === 0) return;

        const job = currentPageJob;
        if (job.state !== 'translating') {
            job.state = 'translating';
        }
        job.totalChunks += texts.length;

        for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
            const textChunk = texts.slice(i, i + CHUNK_SIZE);
            const idChunk = ids.slice(i, i + CHUNK_SIZE);

            idChunk.forEach(id => {
                const wrapper = idToWrapperMap.get(id);
                if (wrapper) {
                    DisplayManager.displayLoading(wrapper, effectiveSettings.displayMode);
                }
            });

            browser.runtime.sendMessage({
                type: 'TRANSLATE_TEXT_CHUNK',
                payload: { texts: textChunk, ids: idChunk, targetLang, sourceLang: 'auto', tabId: job.tabId, translatorEngine }
            }).catch(e => {
                logError('translateElements (send chunk)', e);
                idChunk.forEach(id => {
                    const wrapper = idToWrapperMap.get(id);
                    if (wrapper) {
                        revertElement(wrapper);
                    }
                    updateTranslationProgress();
                });
            });
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
 * (重构) 根据指定的CSS选择器查找页面上所有可翻译的候选元素。
 * @param {object} effectiveSettings - 包含 translationSelector 的配置对象。
 * @param {Node[]} [rootNodes=[document.body]] - 在这些节点内进行搜索。
 * @returns {HTMLElement[]} - 候选元素数组。
 */
function findTranslatableElements(effectiveSettings, rootNodes = [document.body]) {
    const inlineSelector = effectiveSettings?.translationSelector?.inline?.trim();
    const blockSelector = effectiveSettings?.translationSelector?.block?.trim();

    const allSelectors = [inlineSelector, blockSelector].filter(Boolean).join(', ');
    if (!allSelectors) {
        return [];
    }
    
    const allCandidates = new Set();
    for (const root of rootNodes) {
        if (root.nodeType !== Node.ELEMENT_NODE) continue;

        if (root.matches(allSelectors)) {
            allCandidates.add(root);
        }
        root.querySelectorAll(allSelectors).forEach(el => allCandidates.add(el));
    }
    
    return Array.from(allCandidates);
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
    DisplayManager.revert(wrapper);

    // Restore the original DOM structure if the wrapper is still in the DOM.
    if (wrapper.parentNode) {
        const originalText = wrapper.dataset.originalText;
        if (typeof originalText === 'string') {
            wrapper.replaceWith(document.createTextNode(originalText));
        } else {
            // 这是一个不应发生的状态。originalText 应该始终存在。
            // 记录一个错误以便调试，然后移除损坏的包装器以防止UI问题。
            logError('revertElement', new Error("Cannot revert element: originalText dataset is missing. This indicates a state corruption."));
            console.error("Problematic wrapper:", wrapper);
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

    if (success && wasTranslated) {
        DisplayManager.displayTranslation(wrapper, translatedText);
    } else {
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

        this.state = 'idle'; // 'idle', 'starting', 'translating', 'translated', 'reverting'
    }

    async start() {
        if (this.state !== 'idle') {
            console.warn(`[Foxlate] Job is not idle (state: ${this.state}). Ignoring start request.`);
            return;
        }

        console.log("[Foxlate] Starting page translation process...");
        this.state = 'starting';

        document.body.dataset.translationSession = 'active';

        try {
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
            this.state = 'idle';
            throw error;
        }

        this.#initializeObservers();
        this.#startMutationObserver();

        const elementsToObserve = findTranslatableElements(this.settings);
        console.log(`[Foxlate] Found ${elementsToObserve.length} total elements to observe.`);

        if (elementsToObserve.length > 0) {
            this.#observeElements(elementsToObserve);
        } else {
            console.warn("[Foxlate] No translatable elements found to observe initially.");
        }
    }

    async revert() {
        try {
            await browser.runtime.sendMessage({ type: 'STOP_TRANSLATION', payload: { tabId: this.tabId } });
        } catch (e) {
            logError('revert (sending STOP_TRANSLATION)', e);
        }

        try {
            await browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'original', tabId: this.tabId }
            });
        } catch (e) {
            logError('revert (sending original status)', e);
        }

        console.log("[Foxlate] Reverting entire page translation...");
        this.state = 'reverting';

        this.#stopObservers();

        try {
            delete document.body.dataset.translationSession;
            DisplayManager.hideAllEphemeralUI();
            const wrappers = document.querySelectorAll('font[data-translation-id]');
            wrappers.forEach(revertElement);
            console.log(`[Foxlate] Reverted ${wrappers.length} translated elements.`);

            // 新增：清理所有残留的 data-translation-type 属性，确保DOM干净。
            const typedElements = document.querySelectorAll('[data-translation-type]');
            typedElements.forEach(el => delete el.dataset.translationType);
            console.log(`[Foxlate] Cleaned up ${typedElements.length} translation type attributes.`);

        } catch (error) {
            logError('revert (DOM cleanup)', error);
        }

        currentPageJob = null;
    }

    // --- Private Methods ---

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

    #translateElements(elements, type) {
        translateElements(elements, type, this.settings);
    }

    #handleIntersection(entries) {
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        if (visibleEntries.length === 0) return;

        const inlineSelector = this.settings?.translationSelector?.inline?.trim();
        const blockSelector = this.settings?.translationSelector?.block?.trim();

        const elementsToTranslate = {
            inline: [],
            block: []
        };

        for (const entry of visibleEntries) {
            const element = entry.target;
            let type = null;
            if (inlineSelector && element.matches(inlineSelector)) {
                type = 'inline';
            } else if (blockSelector && element.matches(blockSelector)) {
                type = 'block';
            }

            if (type) {
                element.dataset.translationType = type; 
                elementsToTranslate[type].push(element);
            }
            
            this.intersectionObserver.unobserve(element);
        }

        if (elementsToTranslate.inline.length > 0) {
            this.#translateElements(elementsToTranslate.inline, 'inline');
        }
        if (elementsToTranslate.block.length > 0) {
            this.#translateElements(elementsToTranslate.block, 'block');
        }
    }

    #handleMutation(mutations) {
        let hasNewNodes = false;
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE && !node.closest('[data-translation-id], #universal-translator-selection-panel')) {
                        this.mutationQueue.add(node);
                        hasNewNodes = true;
                    }
                });
            }
        }

        if (hasNewNodes && !this.idleCallbackId) {
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

        const newElements = findTranslatableElements(this.settings, newNodes);
        if (newElements.length > 0) {
            this.#observeElements(newElements);
        }
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
                if (currentPageJob) {
                    currentPageJob.settings = await getEffectiveSettings();
                    console.log("[Foxlate] Updated job settings:", currentPageJob.settings);
                }
                return { success: true };

            case 'TRANSLATE_PAGE_REQUEST':
                if (currentPageJob) {
                    console.warn("[Foxlate] Auto-translate request received, but a job is already active. Ignoring.");
                } else {
                    const settings = await getEffectiveSettings();
                    currentPageJob = new PageTranslationJob(request.payload.tabId, settings);
                    await currentPageJob.start();
                }
                return { success: true };

            case 'REVERT_PAGE_TRANSLATION':
                if (currentPageJob) {
                    await currentPageJob.revert();
                }
                return { success: true };
            
            case 'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT':
                {
                    const isSessionActiveForToggle = document.body.dataset.translationSession === 'active';
                    const action = isSessionActiveForToggle ? 'revert' : 'translate';
                    const { tabId } = request.payload;

                    if (action === 'translate') {
                        if (currentPageJob) {
                            console.warn("[Foxlate] State mismatch: job exists but session is not active. Reverting old job first.");
                            await currentPageJob.revert();
                        }
                        const settings = await getEffectiveSettings();
                        currentPageJob = new PageTranslationJob(tabId, settings);
                        await currentPageJob.start();
                    } else if (action === 'revert') {
                        if (!currentPageJob) {
                            console.warn("[Foxlate] State mismatch: session is active but no job exists. Attempting DOM cleanup.");
                            const cleanupJob = new PageTranslationJob(tabId, {});
                            await cleanupJob.revert();
                        } else {
                            await currentPageJob.revert();
                        }
                    }
                    return { success: true };
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
                DisplayManager.updateDisplayMode(displayMode);
                return { success: true };

            case 'REQUEST_TRANSLATION_STATUS':
                {
                    let status = 'original';
                    if (currentPageJob) {
                        switch (currentPageJob.state) {
                            case 'starting':
                            case 'translating':
                                status = 'loading';
                                break;
                            case 'translated':
                                status = 'translated';
                                break;
                        }
                    }
                    return Promise.resolve({ state: status });
                }

            case 'DISPLAY_SELECTION_TRANSLATION':
                {
                    const { translationId, isLoading } = request.payload;

                    if (isLoading) {
                        currentSelectionTranslationId = translationId;
                    } else {
                        if (translationId !== currentSelectionTranslationId) {
                            console.log(`[Foxlate] 忽略了一个过时的划词翻译结果。ID: ${translationId}`);
                            return { success: true, ignored: true };
                        }
                    }
                    DisplayManager.handleEphemeralTranslation(request.payload);
                }
                return { success: true };

            case 'TOGGLE_SUBTITLE_TRANSLATION':
                if (window.subtitleManager && typeof window.subtitleManager.toggle === 'function') {
                    window.subtitleManager.toggle(request.payload.enabled);
                } else {
                    console.warn("[Content Script] Subtitle manager not available to toggle. This is expected on non-supported pages.");
                }
                return { success: true };

            case 'REQUEST_SUBTITLE_TRANSLATION_STATUS':
                if (window.subtitleManager && typeof window.subtitleManager.getStatus === 'function') {
                    return Promise.resolve(window.subtitleManager.getStatus());
                }
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