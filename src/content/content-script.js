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
 * (新) 使用“自顶向下”的 CSS 选择器模型查找页面上所有可翻译的元素。
 * 此函数取代了旧的基于CSS选择器的方法。
 * @param {object} effectiveSettings - 设置对象（用于预检查）。
 * @param {Node[]} rootNodes - 要在其中搜索的根节点。
 * @returns {HTMLElement[]} 一个包含最适合翻译的容器元素的数组。
 */
function findTranslatableElements(effectiveSettings, rootNodes = [document.body]) {
    const inlineSelector = effectiveSettings?.translationSelector?.inline?.trim();
    const blockSelector = effectiveSettings?.translationSelector?.block?.trim();

    // 如果没有配置选择器，则不进行任何操作。
    const allSelectors = [inlineSelector, blockSelector].filter(Boolean).join(', ');
    if (!allSelectors) {
        return [];
    }

    const allCandidates = new Set();
    for (const root of rootNodes) {
        // 确保根节点是元素节点，可以进行查询。
        if (root.nodeType !== Node.ELEMENT_NODE) continue;

        // 如果根节点本身匹配，也将其加入候选列表。
        if (root.matches(allSelectors)) {
            allCandidates.add(root);
        }
        // 查询根节点下的所有匹配项。
        root.querySelectorAll(allSelectors).forEach(el => allCandidates.add(el));
    }

    const finalCandidates = new Set();

    // 关键过滤步骤：只选择“最深”的匹配元素（叶子节点）。
    // 这种方法可以防止因宽泛的选择器（如 'div'）导致整个页面被作为一个单元进行翻译。
    // 它确保我们翻译的是包含实际文本的最小单元，而不是它们的父容器。
    for (const el of allCandidates) {
        // 检查当前元素 'el' 是否包含任何其他也匹配选择器的子元素。
        if (!el.querySelector(allSelectors)) {
            // 如果 'el' 内部没有其他匹配项，那么它就是一个“叶子”节点，我们选择它进行翻译。
            finalCandidates.add(el);
        }
    }

    // 进一步过滤，移除不可见或不应翻译的元素。
    return Array.from(finalCandidates).filter(el => {
        // 已经被处理或正在处理的元素
        if (el.dataset.translationId) {
            return false;
        }
        // 预检查，确保元素内有实际内容需要翻译
        const { result: shouldTranslateResult } = shouldTranslate(el.textContent, effectiveSettings);
        return shouldTranslateResult;
    });
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
        this.totalElements = 0;
        this.completedElements = 0;

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
        this.totalElements = elementsToObserve.length;
        console.log(`[Foxlate] Found ${this.totalElements} total elements to observe.`);

        if (this.totalElements > 0) {
            this.#observeElements(elementsToObserve);
            this.state = 'translating'; // 正式进入翻译中状态
        } else {
            console.warn("[Foxlate] No translatable elements found to observe initially.");
            this.state = 'translated'; // 没有需要翻译的元素，任务直接完成
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'translated', tabId: this.tabId }
            }).catch(e => logError('start (sending translated status)', e));
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

    updateProgress() {
        this.completedElements++;
        // 只有在翻译中状态才检查是否完成
        if (this.state === 'translating' && this.completedElements >= this.totalElements) {
            this.state = 'translated';
            console.log(`[Foxlate] Page translation completed. Processed ${this.completedElements}/${this.totalElements} elements.`);
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'translated', tabId: this.tabId }
            }).catch(e => logError('updateProgress (sending completed status)', e));
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

    // 2. 提取文本内容
    const textToTranslate = sourceText.trim();

    // 3. 前置检查
    const { result: shouldTranslateResult } = shouldTranslate(textToTranslate, effectiveSettings);
    if (!shouldTranslateResult) {
        return; // 不翻译，跳过
    }

    // 4. 存储正确的翻译单元以备后用
    translationUnitMap.set(element.dataset.translationId, translationUnit);
    console.log(`[Foxlate] Storing translation unit for ${element.dataset.translationId}`, { translationUnit });

    // 5. 发送到后台翻译
    const targetLang = effectiveSettings.targetLanguage;
    const translatorEngine = effectiveSettings.translatorEngine;
    // 将原始 innerHTML 传递给 DisplayManager，由其统一管理状态，而不是存储在 DOM 的 dataset 中。
    DisplayManager.displayLoading(element, effectiveSettings.displayMode, element.innerHTML); // 设置加载状态

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
        // 即使元素已从DOM中消失，这个翻译任务也算“完成”了。
        currentPageJob?.updateProgress();
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
    // 无论成功与否，都更新进度。
    currentPageJob?.updateProgress();
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

            case 'RELOAD_TRANSLATION_JOB':
                if (currentPageJob) {
                    console.log("[Foxlate] Critical settings changed. Reverting and restarting translation job.");
                    const tabId = currentPageJob.tabId; // 在还原前保存 tabId
                    await currentPageJob.revert(); // 这会将 currentPageJob 设置为 null

                    // 使用新设置启动一个新作业
                    const newSettings = await getEffectiveSettings();
                    currentPageJob = new PageTranslationJob(tabId, newSettings);
                    await currentPageJob.start();
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