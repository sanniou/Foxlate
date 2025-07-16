import browser from '../lib/browser-polyfill.js';
import { shouldTranslate } from '../common/precheck.js';
import { DisplayManager } from './display-manager.js';
import { SettingsManager } from '../common/settings-manager.js';
import { DOMWalker } from './dom-walker.js';

/**
 * 集中式错误记录器，用于内容脚本。
 * @param {string} context - 错误发生的上下文（例如，函数名）。
 * @param {Error} error - 错误对象。
 */
function logError(context, error) {
    // 过滤掉用户中断的“错误”，因为它不是一个真正的异常
    // AbortError 是一个受控的中断，不是真正的错误。记录它用于调试，但不应视为错误。
    if (error && error.name === 'AbortError') {
        console.log(`[Foxlate] Task was interrupted in ${context}:`, error.message);
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
 * 获取当前页面生效的设置。
 * 此函数从后台获取原始设置，然后在内容脚本的上下文中编译正则表达式。
 * 这避免了在通过消息传递API发送不可序列化的 RegExp 对象时出现的问题。
 * @returns {Promise<object>} - 合并后的有效配置对象。
 */
async function getEffectiveSettings() {
    // 1. 从后台获取原始（可序列化）的设置
    const rawSettings = await browser.runtime.sendMessage({
        type: 'GET_EFFECTIVE_SETTINGS',
        payload: { hostname: window.location.hostname }
    });

    // 2. 在内容脚本的上下文中预编译正则表达式
    if (rawSettings && rawSettings.precheckRules) {
        rawSettings.precheckRules = SettingsManager.precompileRules(rawSettings.precheckRules);
    }

    return rawSettings;
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

    // --- 步骤 1: 识别叶子节点和潜在的混合内容父节点 ---
    const potentialMixedParents = new Set();
    for (const el of allCandidates) {
        // 检查当前元素 'el' 是否包含任何其他也匹配选择器的子元素。
        if (!el.querySelector(allSelectors)) {
            // 如果没有，它就是一个“叶子”节点，直接添加到最终候选列表中。
            finalCandidates.add(el);
        } else {
            // 如果有，它就是一个父节点，可能包含需要翻译的“孤立”文本。
            potentialMixedParents.add(el);
        }
    }

    // --- 步骤 2: 从混合内容父节点中“拯救”孤立的文本节点 ---
    // 这一步是关键，用于处理像 `<div>Some text <p>More text</p></div>` 这样的结构，
    // 其中 "Some text" 会被遗漏，因为它不是叶子节点的一部分。
    for (const parent of potentialMixedParents) {
        // 遍历父节点的所有直接子节点。
        for (const child of Array.from(parent.childNodes)) {
            // 检查是否为文本节点或纯文本的 SPAN 且包含非空白字符。
            const isTextNode = child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '';
            const isPlainTextSpan = child.nodeName === 'SPAN' && child.children.length === 0 && child.textContent.trim() !== '';
            if (isTextNode || isPlainTextSpan) {
                const wrapperSpan = document.createElement('p');
                // (新) 添加一个临时标志，以便 MutationObserver 可以识别并忽略此更改。
                wrapperSpan.dataset.foxlateGenerated = 'true';
                parent.insertBefore(wrapperSpan, child);
                wrapperSpan.appendChild(child);
                // 将新创建的包裹元素添加到候选列表中进行翻译。
                finalCandidates.add(wrapperSpan);
            }
        }
    }

    // 进一步过滤，移除不可见或不应翻译的元素。
    return Array.from(finalCandidates).filter(el =>
        // 已经被处理或正在处理的元素
        !el.dataset.translationId &&
        // 预检查，确保元素内有实际内容需要翻译
        shouldTranslate(el.textContent, effectiveSettings).result
    );
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
        this.activeTranslations = 0; // 只跟踪当前在途的翻译任务数量

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
        console.log(`[Foxlate] Found ${elementsToObserve.length} initial elements to observe.`);
        if (elementsToObserve.length > 0) {
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
        // 添加状态守卫，确保 revert() 方法是幂等的。
        // 如果作业已经在还原中或已处于空闲状态，则忽略后续的还原请求。
        if (this.state === 'reverting' || this.state === 'idle') {
            console.warn(`[Foxlate] Job is already reverting or idle (state: ${this.state}). Ignoring revert request.`);
            return;
        }
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
        this.activeTranslations = 0;

        try {
            delete document.body.dataset.translationSession;
            DisplayManager.hideAllEphemeralUI();
            const wrappers = document.querySelectorAll('[data-translation-id]');
            wrappers.forEach(wrapper => DisplayManager.revert(wrapper));
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

    #handleIntersection(entries) {
        const intersectingElements = entries.filter(entry => entry.isIntersecting).map(entry => entry.target);
        if (intersectingElements.length === 0) return;

        // 元素已由 findTranslatableElements 预先过滤。
        // 我们可以直接翻译它们，无需再次检查CSS选择器。
        intersectingElements.forEach(element => {
            this.intersectionObserver.unobserve(element);
            // 直接委托给 translateElement，它将处理所有启动逻辑
            translateElement(element, this.settings);
        });
    }

    checkCompletion() {
        // 只有在翻译中状态，并且没有在途任务和待处理的DOM变动时，才算“完成”当前批次。
        if (this.state === 'translating' && this.activeTranslations === 0 && this.mutationQueue.size === 0) {
            this.state = 'translated';
            console.log(`[Foxlate] Page translation completed.`);
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'translated', tabId: this.tabId }
            }).catch(e => logError('checkCompletion (sending completed status)', e));
        }
    }
    #handleMutation(mutations) {
        let hasNewNodes = false;
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE && !node.closest('[data-translation-id], .foxlate-panel')) {
                        // (新) 检查此节点是否是由我们的脚本生成的。
                        if (node.dataset.foxlateGenerated === 'true') {
                            // 如果是，我们只移除标志，不将其添加到队列中，以防止重复翻译。
                            delete node.dataset.foxlateGenerated;
                            return;
                        }
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
            console.log(`[Foxlate] Found ${newElements.length} new dynamic elements to observe.`);
            this.#observeElements(newElements);
        }
        // 即使没有找到新的可翻译元素，也可能清空了 mutationQueue，
        // 这可能是完成翻译的最后一个条件，所以需要检查。
        this.checkCompletion();
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

    // --- 启动翻译的核心逻辑 ---
    // 只有在确定要翻译后，才更新状态和计数器
    if (currentPageJob) {
        // 如果作业已完成，但现在有一个新的元素开始翻译，
        // 我们必须将状态切换回“翻译中”，并通知UI再次显示加载状态。
        // 这确保了即使用户滚动到底部，进度状态也能正确更新。
        if (currentPageJob.state === 'translated') {
            currentPageJob.state = 'translating';
            browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'loading', tabId: currentPageJob.tabId }
            }).catch(e => logError('translateElement (sending loading status)', e));
        }
        currentPageJob.activeTranslations++;
    }

    const elementId = `ut-${generateUUID()}`;
    element.dataset.translationId = elementId;

    const targetLang = effectiveSettings.targetLanguage;
    const translatorEngine = effectiveSettings.translatorEngine;
    const initialState = { originalContent: element.innerHTML, translationUnit };
    DisplayManager.displayLoading(element, effectiveSettings.displayMode, initialState); // 设置加载状态

    console.log(`[Foxlate] Sending text to translate for ${elementId}`, { textToTranslate });
    browser.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        payload: { text: textToTranslate, targetLang, sourceLang: 'auto', elementId, translatorEngine }
    }).catch(e => {
        logError('translateElement (send message)', e);
        // 如果消息发送失败，我们需要手动回滚状态和计数器，
        // 因为 handleTranslationResult 将不会被调用。
        if (currentPageJob) {
            currentPageJob.activeTranslations--;
            currentPageJob.checkCompletion();
        }
        DisplayManager.revert(element);
    });
}


/**
 * (新) 处理单个元素翻译的结果。
 * @param {object} payload - 从后台脚本接收的负载。
 */
function handleTranslationResult(payload) {
    const { elementId, success, translatedText, wasTranslated, error } = payload;

    if (!currentPageJob) {
        // 如果没有当前作业，则无需执行任何操作。
        return;
    }

    // 收到结果后减少计数器
    currentPageJob.activeTranslations--;

    const wrapper = document.querySelector(`[data-translation-id="${elementId}"]`);

    if (!wrapper) {
        currentPageJob.checkCompletion();
        return;
    }

    if (success && wasTranslated) {
        // 为不使用 DOM 重建的策略（如悬浮提示）准备一个纯文本版本。
        // 这可以防止将内部的 <t_id> 标签泄露到 UI 中。
        const plainText = translatedText.replace(/<(\/)?t\d+>/g, '');
        DisplayManager.displayTranslation(wrapper, { translatedText, plainText });
    } else {
        // 如果翻译失败，显示错误状态而不是直接还原。
        // 这为用户提供了关于翻译失败的明确反馈。
        const errorMessage = error || 'An unknown error occurred during translation.';
        DisplayManager.displayError(wrapper, errorMessage);
    }
    // 无论成功与否，都检查作业是否已完成。
    currentPageJob.checkCompletion();
}
// --- Message Handling & UI ---

const messageHandlers = {
    PING() {
        return Promise.resolve({ status: 'PONG' });
    },

    async SETTINGS_UPDATED() {
        console.log("[Content Script] Received settings update. Updating local cache.");
        const newSettings = await getEffectiveSettings();
        if (currentPageJob) {
            currentPageJob.settings = newSettings;
            console.log("[Foxlate] Updated page translation job settings:", newSettings);
        }
        // 新增：如果页面已翻译，则根据新设置更新显示模式
        if (currentPageJob && (currentPageJob.state === 'translated' || currentPageJob.state === 'translating')) {
            DisplayManager.updateDisplayMode(newSettings.displayMode);
        }

        // 新增：通知字幕管理器设置已更新
        if (window.subtitleManager && typeof window.subtitleManager.updateSettings === 'function') {
            window.subtitleManager.updateSettings(newSettings);
        }
        return { success: true };
    },


    async RELOAD_TRANSLATION_JOB() {
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
    },

    async TRANSLATE_PAGE_REQUEST(request) {
        if (currentPageJob) {
            console.warn("[Foxlate] Auto-translate request received, but a job is already active. Ignoring.");
        } else {
            const settings = await getEffectiveSettings();
            currentPageJob = new PageTranslationJob(request.payload.tabId, settings);
            await currentPageJob.start();
        }
        return { success: true };
    },

    async REVERT_PAGE_TRANSLATION() {
        if (currentPageJob) {
            await currentPageJob.revert();
        }
        return { success: true };
    },

    async TOGGLE_TRANSLATION_REQUEST_AT_CONTENT(request) {
        // 使用 currentPageJob 的存在作为判断翻译是否活动的唯一真实来源。
        // 这比依赖 DOM 属性（如 dataset）更健壮，并简化了逻辑。
        const isJobActive = !!currentPageJob;
        const { tabId } = request.payload;

        if (isJobActive) {
            // 如果作业已激活，则执行“还原”操作。
            await currentPageJob.revert();
        } else {
            // 如果没有激活的作业，则执行“翻译”操作。
            // 这也优雅地处理了任何可能由先前崩溃的作业留下的不一致的 DOM 状态。
            const settings = await getEffectiveSettings();
            currentPageJob = new PageTranslationJob(tabId, settings);
            await currentPageJob.start();
        }
        return { success: true };
    },

    TRANSLATE_TEXT_RESULT(request) {
        handleTranslationResult(request.payload);
        return { success: true };
    },

    UPDATE_DISPLAY_MODE(request) {
        const { displayMode } = request.payload;
        if (currentPageJob && currentPageJob.settings) {
            currentPageJob.settings.displayMode = displayMode;
        }
        DisplayManager.updateDisplayMode(displayMode);
        return { success: true };
    },

    REQUEST_TRANSLATION_STATUS() {
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
    },

    DISPLAY_SELECTION_TRANSLATION(request) {
        const { translationId, isLoading } = request.payload;
        if (isLoading) {
            currentSelectionTranslationId = translationId;
        } else if (translationId !== currentSelectionTranslationId) {
            console.log(`[Foxlate] 忽略了一个过时的划词翻译结果。ID: ${translationId}`);
            return { success: true, ignored: true };
        }
        DisplayManager.handleEphemeralTranslation(request.payload);
        return { success: true };
    },

    TOGGLE_SUBTITLE_TRANSLATION(request) {
        if (window.subtitleManager?.toggle) {
            window.subtitleManager.toggle(request.payload.enabled);
        } else {
            console.warn("[Content Script] Subtitle manager not available to toggle. This is expected on non-supported pages.");
        }
        return { success: true };
    },

    REQUEST_SUBTITLE_TRANSLATION_STATUS() {
        if (window.subtitleManager?.getStatus) {
            return Promise.resolve(window.subtitleManager.getStatus());
        }
        return Promise.resolve({ isSupported: false, isEnabled: false });
    }
};

async function handleMessage(request, sender) {
    console.trace(`[Content Script] Received message from sender:`, request);
    const handler = messageHandlers[request.type];

    if (!handler) {
        console.warn(`[Content Script] Unhandled message type: ${request.type}`);
        return Promise.resolve({ success: false, error: `Unhandled message type: ${request.type}` });
    }

    try {
        // The handler itself can be sync or async, await handles both.
        return await handler(request, sender);
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