import { shouldTranslate } from '../common/precheck.js';
import { DisplayManager } from './display-manager.js';
import { DOMWalker } from './dom-walker.js';

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

/**
 * A map to temporarily store TranslationUnit objects during the async translation process.
 * The key is the element's `data-translation-id`.
 * This avoids polluting the DOM element object itself.
 */
const translationUnitMap = new Map();

const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'INPUT', 'BUTTON']);
const LAYOUT_REGEX = /container|wrapper|grid|row|col|sidebar|header|footer|nav|menu|toolbar/i;

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
 * 检查一个元素是否可能是非内容的、纯粹的结构性容器。
 * @param {HTMLElement} element
 * @returns {boolean}
 */
function isLikelyLayoutContainer(element) {
    if (!element || !element.tagName) return true;

    // 规则 1: 忽略的标签
    if (IGNORED_TAGS.has(element.tagName)) {
        return true;
    }

    // 规则 2: 常见的布局类名
    if (element.className && typeof element.className === 'string' && LAYOUT_REGEX.test(element.className)) {
        return true;
    }

    // 规则 3: 带有点击处理器但文本很少的元素通常是自定义按钮/控件。
    if (element.hasAttribute('onclick') || element.hasAttribute('data-onclick')) {
        if ((element.textContent || '').trim().length < 25) {
            return true;
        }
    }

    return false;
}


/**
 * 从一个包含文本的元素开始，向上遍历DOM树以找到最合适的内容块。
 * @param {HTMLElement} startElement - 直接包含文本节点的元素。
 * @returns {HTMLElement} 聚合后的内容块。
 */
function findBestContainer(startElement) {
    let currentBest = startElement;
    let parent = startElement.parentElement;

    while (parent && parent.tagName !== 'BODY' && !isLikelyLayoutContainer(parent)) {
        const parentText = parent.textContent || '';
        const childText = currentBest.textContent || '';

        // 启发式规则：如果父元素的文本不比子元素的文本长很多，
        // 并且父元素没有太多其他元素子节点，那么它可能只是一个包装器。
        const otherChildren = Array.from(parent.children).filter(child => child !== currentBest);

        // 如果父元素的文本与子元素的文本几乎相同，这是一个强烈的上升信号。
        if (Math.abs(parentText.length - childText.length) < 10 && otherChildren.length <= 1) {
             currentBest = parent;
             parent = parent.parentElement;
        } else {
            // 父元素包含重要的其他内容，所以在这里停止。
            break;
        }
    }
    return currentBest;
}


/**
 * 使用“自底向上”的内容聚合模型查找页面上所有可翻译的元素。
 * 此函数取代了旧的基于CSS选择器的方法。
 * @param {object} effectiveSettings - 设置对象（用于预检查）。
 * @param {Node[]} rootNodes - 要在其中搜索的根节点。
 * @returns {HTMLElement[]} 一个包含最适合翻译的容器元素的数组。
 */
function findTranslatableElements(effectiveSettings, rootNodes = [document.body]) {
    const finalCandidates = new Set();
    const processedElements = new WeakSet();

    for (const root of rootNodes) {
        if (root.nodeType !== Node.ELEMENT_NODE) continue;

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    // 过滤掉空的、在忽略标签内的或已处理的文本节点。
                    if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    const parent = node.parentElement;
                    if (!parent || processedElements.has(parent) || isLikelyLayoutContainer(parent)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let node;
        while (node = walker.nextNode()) {
            const parentElement = node.parentElement;
            if (parentElement && !processedElements.has(parentElement)) {
                const bestContainer = findBestContainer(parentElement);

                // 在添加之前预检查最佳容器的内容。
                const { result: shouldTranslateResult } = shouldTranslate(bestContainer.textContent, effectiveSettings);
                if (shouldTranslateResult) {
                    finalCandidates.add(bestContainer);
                    // 将容器及其所有子元素标记为已处理，以避免重复工作。
                    processedElements.add(bestContainer);
                    bestContainer.querySelectorAll('*').forEach(child => processedElements.add(child));
                }
            }
        }
    }

    return Array.from(finalCandidates);
}

// --- State Management Class ---

let currentPageJob = null;
let mutationObserver = null;
let currentSelectionTranslationId = null;


/**
 * 启动页面翻译作业。
 */
class PageTranslationJob {
    constructor(tabId, settings) {
        this.tabId = tabId;
        this.settings = settings;

        this.mutationQueue = new Set();
        this.idleCallbackId = null;
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
        this.state = 'starting'; // 初始状态，防止重复启动

        // 立即通知后台，UI可以显示加载状态
        browser.runtime.sendMessage({
            type: 'TRANSLATION_STATUS_UPDATE',
            payload: { status: 'loading', tabId: this.tabId }
        }).catch(e => logError('start (sending loading status)', e));

        document.body.dataset.translationSession = 'active';

        try {
            if (!this.settings.targetLanguage) {
                throw new Error(browser.i18n.getMessage('errorMissingTargetLanguage') || 'Target language is not configured.');
            }
            if (!this.settings.translatorEngine) {
                throw new Error(browser.i18n.getMessage('errorMissingEngine') || 'Translation engine is not configured.');
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

        this.state = 'translating'; // 正式进入翻译中状态
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
            const wrappers = document.querySelectorAll('[data-translation-id]');
            wrappers.forEach(revertElement);
            console.log(`[Foxlate] Reverted ${wrappers.length} translated elements.`);

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

    #translateElement(element) {
        translateElement(element, this.settings);
    }

    #handleIntersection(entries) {
        const intersectingElements = entries.filter(entry => entry.isIntersecting).map(entry => entry.target);
        if (intersectingElements.length === 0) return;

        // 元素已由 findTranslatableElements 预先过滤。
        // 我们可以直接翻译它们，无需再次检查CSS选择器。
        intersectingElements.forEach(element => {
            // 为容器元素生成唯一的 ID
            element.dataset.translationId = `ut-${generateUUID()}`;
            this.#translateElement(element);
            // 取消 IntersectionObserver 的观察，防止重复触发
            this.intersectionObserver.unobserve(element);
        });
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

/**
 * (新) 启动对单个容器元素的翻译过程。
 * 创建翻译单元，保存原始 innerHTML，发送文本内容到后台翻译，并更新元素状态。
 */
function translateElement(element, effectiveSettings) {
    if (!element || !(element instanceof HTMLElement)) return;

    // 1. 创建翻译单元并解构结果
    const domWalkerResult = DOMWalker.create(element);
    if (!domWalkerResult) {
        return; // 没有可翻译的内容
    }
    const { sourceText, translationUnit } = domWalkerResult;

    // 2. 保存原始 innerHTML 以便还原
    element.dataset.originalContent = element.innerHTML;

    // 3. 提取文本内容
    const textToTranslate = sourceText.trim();

    // 4. 前置检查
    const { result: shouldTranslateResult } = shouldTranslate(textToTranslate, effectiveSettings);
    if (!shouldTranslateResult) {
        return; // 不翻译，跳过
    }

    // 5. 存储正确的翻译单元以备后用
    translationUnitMap.set(element.dataset.translationId, translationUnit);
    console.log(`[Foxlate] Storing translation unit for ${element.dataset.translationId}`, { translationUnit });

    // 6. 发送到后台翻译
    const targetLang = effectiveSettings.targetLanguage;
    const translatorEngine = effectiveSettings.translatorEngine;
    DisplayManager.displayLoading(element, effectiveSettings.displayMode); // 设置加载状态

    console.log(`[Foxlate] Sending text to translate for ${element.dataset.translationId}`, { textToTranslate });
    browser.runtime.sendMessage({
        type: 'TRANSLATE_TEXT', // 使用新的消息类型
        payload: { text: textToTranslate, targetLang, sourceLang: 'auto', elementId: element.dataset.translationId, translatorEngine }
    }).catch(e => {
        logError('translateElement (send message)', e);
        revertElement(element);
    });
}


/**
 * Reverts a single translated element wrapper back to its original text node,
 * and cleans up its associated state. This is the single source of truth for
 * reverting any element.
 * @param {HTMLElement} wrapper - The <font> element wrapping the original text.
 */
function revertElement(wrapper) {
    if (!wrapper || !(wrapper instanceof HTMLElement)) return;

    // 新增：在还原前从映射中移除翻译单元
    const elementId = wrapper.dataset.translationId;
    if (elementId) {
        translationUnitMap.delete(elementId);
    }

    // Let the DisplayManager handle strategy-specific UI cleanup and state removal.
    DisplayManager.revert(wrapper);

    // After the strategy has had a chance to use its data (e.g., to restore originalContent),
    // and after DisplayManager has cleaned its internal state, we clean up all framework-related
    // dataset attributes from the DOM element to leave it in a pristine state.
    // The strategy itself is responsible for cleaning up attributes it exclusively owns,
    // like 'originalContent' in the replace-strategy.
    if (wrapper.dataset) {
        delete wrapper.dataset.translationId;
        delete wrapper.dataset.translationStrategy;
    }
}

/**
 * (新) 处理单个元素翻译的结果。
 * @param {object} payload - 从后台脚本接收的负载。
 */
function handleTranslationResult(payload) {
    const { elementId, success, translatedText, wasTranslated, error } = payload;
    const wrapper = document.querySelector(`[data-translation-id="${elementId}"]`);

    if (!wrapper) {
        translationUnitMap.delete(elementId);
        return;
    }

    if (success && wasTranslated) {
        const translationUnit = translationUnitMap.get(elementId);
        console.log(`[Foxlate] Retrieved translation unit for ${elementId}`, { translationUnit, translatedText });
        DisplayManager.displayTranslation(wrapper, { translatedText, translationUnit });
        translationUnitMap.delete(elementId);
    } else {
        if (error) {
            console.log(`[Content Script] Element ${elementId} translation failed or was interrupted:`, error);
        }
        revertElement(wrapper);
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

            case 'TRANSLATE_TEXT_RESULT':
                handleTranslationResult(request.payload);
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