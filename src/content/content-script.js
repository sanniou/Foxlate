import browser from '../lib/browser-polyfill.js';
import { shouldTranslate } from '../common/precheck.js';
import { marked } from '../lib/marked.esm.js';
import { DisplayManager } from './display-manager.js';
import { SettingsManager } from '../common/settings-manager.js';
import { DOMWalker } from './dom-walker.js';
import { SKIPPED_TAGS } from '../common/constants.js';
import { initializeSummary } from './summary/summary.js';

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


const CSS_FILE_PATH = browser.runtime.getURL("content/style.css");

/**
 * 向指定的根（通常是 Shadow Root）注入 CSS。
 * @param {ShadowRoot} root 要注入CSS的Shadow Root。
 * @param {HTMLElement} host 这个Shadow Root的宿主元素。
 */
function injectCSSIntoRoot(root, host) {
    // 关键检查：在宿主元素上检查标记
    if (!root || !host || host.dataset.foxlateCssInjected === 'true') {
        return;
    }

    try {
        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.type = 'text/css';
        styleLink.href = CSS_FILE_PATH;

        root.prepend(styleLink);

        // 在宿主元素上设置标记
        host.dataset.foxlateCssInjected = 'true';
        console.log('[Foxlate] Injected CSS and marked host element:', host);
    } catch (error) {
        console.error('[Foxlate] Failed to inject CSS into a Shadow Root:', error);
    }
}

/**
 * 递归查找并返回页面上所有的搜索根（主文档和所有开放的 Shadow Root）。
 * @param {Node} rootNode - 开始搜索的节点，通常是 document.body。
 * @returns {DocumentFragment[]} 一个包含所有搜索根的数组。
 */
/**
 * (优化版本) 递归查找并返回页面上所有的搜索根（包括初始节点和所有内部的 Shadow Root）。
 * 此函数通过以下优化提高性能：
 * 1. 使用更高效的元素遍历方法
 * 2. 减少不必要的函数调用
 * 3. 优化Shadow DOM查找逻辑
 * @param {Node} rootNode - 开始搜索的节点，例如 document.body 或一个 shadowRoot。
 * @returns {(Document|DocumentFragment|Element)[]} 一个包含所有搜索根的数组。
 */
function findAllSearchRoots(rootNode) {
    if (!rootNode) return [];

    const roots = [rootNode];
    // (优化) 使用 TreeWalker API 代替 querySelectorAll('*')。
    // TreeWalker 是一个高效的、低内存占用的 DOM 遍历迭代器，它避免了
    // 创建一个包含所有子节点的巨大 NodeList，从而在复杂的 DOM 结构中
    // 显著提升性能。
    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_ELEMENT, // 只访问元素节点
        null,
        false
    );

    let currentNode;
    while (currentNode = walker.nextNode()) {
        if (currentNode.shadowRoot) {
            // 找到了一个宿主元素和它的 shadowRoot
            injectCSSIntoRoot(currentNode.shadowRoot, currentNode);
            // 对新发现的 shadowRoot 进行递归搜索
            roots.push(...findAllSearchRoots(currentNode.shadowRoot));
        }
    }
    return roots;
}

/**
 * (新) 使用“自顶向下”的 CSS 选择器模型查找页面上所有可翻译的元素。
 * 此函数取代了旧的基于CSS选择器的方法。
 * @param {object} effectiveSettings - 设置对象（用于预检查）。
 * @param {Node[]} rootNodes - 要在其中搜索的根节点。
 * @returns {HTMLElement[]} 一个包含最适合翻译的容器元素的数组。
 */
function findTranslatableElements(effectiveSettings, rootNodes = [document.body]) {
    const contentSelector = effectiveSettings?.translationSelector?.content?.trim();

    // 如果没有配置内容选择器，则不进行任何操作。
    if (!contentSelector) {
        return [];
    }

    const allCandidates = new Set();
    for (const root of rootNodes) {
        // 确保根节点是可以执行 querySelectorAll 的节点类型。
        // 这包括元素节点 (Element) 和文档片段节点 (DocumentFragment)，例如 Shadow Root。
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
            continue;
        }

        // 如果根节点本身匹配，也将其加入候选列表。
        // 注意：Shadow Root 本身没有 tagName，不能直接 matches，但它的 host 元素可能匹配。
        // 为简化逻辑，我们主要关注其内部的查询。
        if (root.nodeType === Node.ELEMENT_NODE && root.matches(contentSelector)) {
            allCandidates.add(root);
        }
        // 查询根节点下的所有匹配项。
        // Element 和 DocumentFragment 都支持 querySelectorAll。
        root.querySelectorAll(contentSelector).forEach(el => allCandidates.add(el));
    }

    // (新) 优化：如果根据选择器没有找到任何候选元素，则提前返回，
    // 避免执行后续更复杂的（且不必要的）孤立节点和父节点分析。
    if (allCandidates.size === 0) {
        return [];
    }

    const finalCandidates = new Set();
    const potentialMixedParents = new Set();

    // --- 步骤 1: 识别叶子节点和潜在的混合内容父节点 ---
    for (const el of allCandidates) {
        // 检查当前元素 'el' 是否包含任何其他也匹配选择器的子元素。
        // 使用原生 querySelector 性能远高于在 allCandidates 中循环。
        if (!el.querySelector(contentSelector)) {
            // 如果没有，它就是一个“叶子”节点，直接添加到最终候选列表中。
            finalCandidates.add(el);
        } else {
            // 如果有，它就是一个父节点，可能包含需要翻译的“孤立”文本。
            potentialMixedParents.add(el);
        }
    }

    // 这一步是关键，用于处理像 `<div>Some text <i>and italic</i> <p>More text</p></div>` 这样的结构，
    // 其中 "Some text <i>and italic</i>" 会被旧逻辑遗漏。
    for (const parent of potentialMixedParents) {
        let consecutiveOrphans = []; // 用于收集连续的孤立节点

        const wrapOrphans = () => {
            if (consecutiveOrphans.length === 0) return;

            // (新) 增强版的内容显著性检查。
            // 一个节点序列只有在满足以下条件时才被认为是“重要的”并被包裹：
            // - 包含至少一个包含非空白字符的文本节点。
            // - 或包含至少一个不是被跳过类型（如<script>, <hr>）且自身包含非空白文本的元素节点。
            const hasSignificantContent = consecutiveOrphans.some(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    return node.textContent.trim() !== '';
                }
                if (node.nodeType === Node.ELEMENT_NODE) {
                    return !SKIPPED_TAGS.has(node.tagName.toUpperCase()) && node.textContent.trim() !== '';
                }
                return false; // 忽略注释等其他节点类型
            });

            if (hasSignificantContent) {
                const wrapperElement = document.createElement('foxlate-wrapper');
                wrapperElement.dataset.foxlateGenerated = 'true';
                // 将包裹元素插入到第一个孤立节点之前。
                parent.insertBefore(wrapperElement, consecutiveOrphans[0]);

                // 将所有连续的孤立节点（包括空白文本节点）移动到包裹元素中，以保持原始间距。
                consecutiveOrphans.forEach(node => wrapperElement.appendChild(node));

                // 将新创建的包裹元素添加到候选列表中进行翻译。
                finalCandidates.add(wrapperElement);
            }
            consecutiveOrphans = []; // 重置收集器
        };

        // 遍历父节点的所有直接子节点。
        for (const child of Array.from(parent.childNodes)) {
            // (新) 关键修复：如果子节点本身就是一个由我们生成的包裹器，
            // 那么它就是一个明确的“边界”。我们应该立即处理之前收集的任何孤立节点，
            // 然后跳过这个包裹器，以防止递归包裹。
            if (child.nodeType === Node.ELEMENT_NODE && child.dataset.foxlateGenerated === 'true') {
                wrapOrphans(); // 处理在它之前的所有孤立节点
                continue;      // 跳过这个包裹器本身
            }

            // (新) 重新定义“边界”节点。一个节点如果满足以下任一条件，它就不是孤立的：
            // 1. 它本身匹配翻译选择器。
            // 2. 它已经被翻译或正在被翻译。
            // 3. 它的子孙节点中包含匹配翻译选择器的元素。
            // 这可以防止将包含其他待翻译内容的容器（如 <table>）错误地包裹起来。
            const isBoundary = child.nodeType === Node.ELEMENT_NODE && (
                allCandidates.has(child) || // 子节点本身匹配选择器
                child.dataset.translationId || // 子节点已翻译
                child.querySelector(contentSelector) // (优化) 子节点包含一个匹配的后代
            );

            if (isBoundary) {
                // 遇到一个已选择的元素，意味着之前的孤立节点序列结束了。
                wrapOrphans();
            } else {
                // 这是一个孤立节点（文本节点、未被选择的元素如<i>, <b>等），将它加入收集器。
                consecutiveOrphans.push(child);
            }
        }

        // 处理遍历结束后可能剩余在收集器中的最后一组孤立节点。
        wrapOrphans();
    }

    // 延迟预检查到实际翻译时执行，避免在元素收集阶段进行不必要的预检查
    return Array.from(finalCandidates).filter(el =>
        // 已经被处理或正在处理的元素
        !el.dataset.translationId
    );
}

// --- State Management Class ---

let currentPageJob = null;
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
        this.mutationDebounceTimerId = null; // 用于动态内容处理的防抖计时器
        this.DEBOUNCE_DELAY = 300; // 毫秒
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

        // 优化：使用requestIdleCallback延迟元素查找，避免阻塞主线程
        requestIdleCallback(() => {
            const allSearchRoots = findAllSearchRoots(document.body);
            const elementsToObserve = findTranslatableElements(this.settings, allSearchRoots);

            console.log(`[Foxlate] Found ${elementsToObserve.length} initial elements to observe across ${allSearchRoots.length} roots.`);
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
        }, { timeout: 2000 });
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
            // 不再使用 querySelectorAll，而是直接从 DisplayManager 获取所有已注册的元素
            // 注意：DisplayManager.elementRegistry.values() 返回的是一个迭代器
            const registeredWeakRefs = Array.from(DisplayManager.elementRegistry.values());
            let revertedCount = 0;

            for (const weakRef of registeredWeakRefs) {
                const element = weakRef.deref();
                if (element) {
                    // 调用 DisplayManager.revert 会处理所有事情，
                    // 包括从 elementRegistry 中删除自己
                    DisplayManager.revert(element);
                    revertedCount++;
                }
            }
            console.log(`[Foxlate] Reverted ${revertedCount} translated elements.`);

            // (新) 补充清理：查找并还原所有可能被遗漏的、由脚本生成的包裹器。
            // 这种情况可能在以下场景发生：
            // 1. 包裹器被创建，但在进入视口并被翻译之前，用户就点击了“显示原文”。
            // 2. 包裹器进入视口，但其内容未通过后续的翻译预检查，导致它从未被注册到 DisplayManager 中。
            // 此操作确保了无论何种情况，所有对 DOM 的修改都能被完全撤销。
            const leftoverWrappers = document.body.querySelectorAll('foxlate-wrapper[data-foxlate-generated="true"]');
            if (leftoverWrappers.length > 0) {
                console.log(`[Foxlate] Cleaning up ${leftoverWrappers.length} leftover generated wrappers.`);
                leftoverWrappers.forEach(wrapper => {
                    // 检查父节点是否存在，以避免在已分离的节点上操作
                    if (wrapper.parentNode) wrapper.replaceWith(...wrapper.childNodes);
                });
            }

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
        // (新) 清理所有挂起的计时器和回调，确保在停止时不会有残留的异步任务。
        if (this.mutationDebounceTimerId) {
            clearTimeout(this.mutationDebounceTimerId);
        }
        if (this.idleCallbackId) {
            cancelIdleCallback(this.idleCallbackId);
        }
        this.intersectionObserver = null;
        this.mutationObserver = null;
        console.log("[Foxlate] Observers stopped.");
    }

    #observeElements(elements) {
        if (!this.intersectionObserver) return;
        for (const element of elements) {
            if (element.dataset.translationId) {
                continue;
            }
            this.intersectionObserver.observe(element);
        }
    }

    #handleIntersection(entries) {
        // 优化：批量处理交叉观察条目
        const intersectingElements = [];
        for (const entry of entries) {
            if (entry.isIntersecting) {
                intersectingElements.push(entry.target);
                // 立即取消观察，避免重复处理
                this.intersectionObserver.unobserve(entry.target);
            }
        }

        if (intersectingElements.length === 0) return;

        // 元素已由 findTranslatableElements 预先过滤。
        // 我们可以直接翻译它们，无需再次检查CSS选择器。
        // 优化：使用requestIdleCallback批量处理翻译请求
        requestIdleCallback(() => {
            intersectingElements.forEach(element => {
                // 直接委托给 translateElement，它将处理所有启动逻辑
                translateElement(element, this.settings);
            });
        }, { timeout: 1000 });
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
        // (优化) 创建一个仅在本次函数调用中有效的本地缓存。
        // 在单次 MutationObserver 回调中，同一个节点可能出现在多个 mutation 记录里。
        // 这个缓存可以避免在同一次处理中对同一个节点重复调用高成本的 getComputedStyle。
        // 使用 Map 而不是 WeakMap，因为它的生命周期很短，不会造成内存泄漏。
        const localStyleCache = new Map();
        const getStyle = (element) => {
            if (localStyleCache.has(element)) {
                return localStyleCache.get(element);
            }
            const style = window.getComputedStyle(element);
            localStyleCache.set(element, style);
            return style;
        };

        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    // 忽略由本扩展自身UI（如 tooltip）或已翻译内容引起的突变。
                    if (node.closest('[data-translation-id], .foxlate-panel')) continue;

                    // (新) 修复：正确跳过由脚本自身生成的包裹元素。
                    if (node.dataset.foxlateGenerated === 'true') continue;

                    // (优化) 使用与 DOMWalker 中相同的、分层且高效的可见性检查模式。
                    // 这是一个快速的预过滤，只执行无重排（reflow）的检查，以避免在处理高频DOM变化时
                    // 引入性能瓶颈。最终的、更昂贵的可见性检查将在 DOMWalker.create 中进行。
                    const style = getStyle(node);
                    if (style.display === 'none' || style.visibility === 'hidden') {
                        continue;
                    }
                    // `offsetParent` 为 null 通常意味着元素是不可见的。
                    if (node.offsetParent === null) {
                        // 但我们需要处理那些 `offsetParent` 为 null 但元素仍然可见的例外情况，
                        // 例如固定/粘性定位的元素。
                        if (style.position !== 'fixed' && style.position !== 'sticky') {
                            continue;
                        }
                    }

                    this.mutationQueue.add(node);
                    hasNewNodes = true;
                }
            }
        }

        if (hasNewNodes) {
            // (新) 使用防抖机制来处理动态内容。
            // (优化) 在设置新的防抖计时器之前，统一取消所有已挂起的处理任务，
            // 包括上一个防抖计时器和任何已安排但尚未执行的空闲回调。
            // 这可以确保只有一个处理流程在等待执行，防止在某些边缘情况下（例如，
            // 在空闲回调等待期间发生新的突变）出现重复或不必要的处理。
            if (this.idleCallbackId) {
                cancelIdleCallback(this.idleCallbackId);
                this.idleCallbackId = null;
            }
            // 这可以防止在无限滚动等场景下，因 DOM 频繁变动而导致的高频处理，
            // 确保只在 DOM 变化暂停一小段时间后才执行处理，从而提升页面流畅性。
            clearTimeout(this.mutationDebounceTimerId);
            this.mutationDebounceTimerId = setTimeout(() => {
                // 使用 requestIdleCallback 进一步优化，确保处理在浏览器空闲时进行。
                // 这结合了防抖和空闲回调的优点。
                this.idleCallbackId = requestIdleCallback(() => this.#processMutationQueue(), { timeout: 1000 });
            }, this.DEBOUNCE_DELAY);
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

        // 优化：批量处理节点，减少重复查找
        const allSearchRoots = new Set();

        // 对每个新增的节点，也查找其内部可能存在的 Shadow Root
        for (const node of newNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // 使用扩展的findAllSearchRoots函数查找所有搜索根
                const roots = findAllSearchRoots(node);
                roots.forEach(root => allSearchRoots.add(root));
            }
        }

        // 转换为数组
        const searchRootsArray = Array.from(allSearchRoots);

        const newElements = findTranslatableElements(this.settings, searchRootsArray);
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
 * (优化版本) 启动对单个容器元素的翻译过程。
 *
 * 此函数通过以下优化提高性能：
 * 1. 在实际翻译时才执行预检查，避免在元素收集阶段进行不必要的预检查
 * 2. 保留原有的重复翻译防护机制
 * 3. 优化了状态更新逻辑
 */
function translateElement(element, effectiveSettings) {
    if (!element || !(element instanceof HTMLElement)) return;

    // (优化) 检查该元素是否包含任何已经翻译过的子元素。
    // 如果是，则跳过翻译，因为它应该由其子元素处理。
    // 这里假设翻译是"由内向外"进行的。
    if (element.querySelector('[data-translation-id]')) {
        console.log(`[Foxlate] 元素 ${element.tagName} 内部包含已翻译内容，跳过以避免重复。`);
        return;
    }

    // 1. 创建翻译单元并解构结果
    const domWalkerResult = DOMWalker.create(element, effectiveSettings.translationSelector);
    if (!domWalkerResult) {
        return; // 没有可翻译的内容
    }
    // (新) 解构出 sourceText, plainText 和 translationUnit
    const { sourceText, plainText, translationUnit } = domWalkerResult;

    // 3. (优化) 使用纯文本进行预检查
    const { result: shouldTranslateResult } = shouldTranslate(plainText, effectiveSettings);
    if (!shouldTranslateResult) {
        return; // 不翻译，跳过
    }

    // 4. (新) 使用带标签的 sourceText 进行翻译，以保留格式
    const textToTranslate = sourceText;

    // --- 启动翻译的核心逻辑 ---
    // 只有在确定要翻译后，才更新状态和计数器
    if (currentPageJob) {
        // 如果作业已完成，但现在有一个新的元素开始翻译，
        // 我们必须将状态切换回"翻译中"，并通知UI再次显示加载状态。
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
    // 调用 DisplayManager.displayLoading 之前或之后，进行注册
    DisplayManager.registerElement(elementId, element);
    DisplayManager.displayLoading(element, effectiveSettings.displayMode, initialState);

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

    // const wrapper = document.querySelector(`[data-translation-id="${elementId}"]`);
    // 不再使用 querySelector，而是从 DisplayManager 的注册表中查找
    const wrapper = DisplayManager.findElementById(elementId);

    if (!wrapper) {
        // 如果 wrapper 为空，意味着元素已经被垃圾回收了
        console.log(`[Foxlate] Element for translationId ${elementId} no longer exists. Skipping update.`);
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

    async SETTINGS_UPDATED(request) {
        console.log("[Content Script] Received settings update. Updating local cache.");
        const newSettings = request.payload.newValue;
        if (currentPageJob && newSettings) {
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
        // (新) 重新初始化总结功能以应用新设置
        initializeSummary(newSettings);

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

            // (新) 重新初始化总结功能，因为它也依赖于设置
            initializeSummary(newSettings);
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

        // 关键修复：检查当前框架是否是目标框架。
        // 由于后台脚本现在将消息发送到特定框架，这个检查可能不是必需的，
        // 但作为一道额外的防线，它可以防止非目标框架意外地创建UI。
        // 实际上，如果后台正确指定了 frameId，非目标框架根本不会收到此消息。

        if (isLoading) {
            currentSelectionTranslationId = translationId;
        } else if (translationId !== currentSelectionTranslationId) {
            console.log(`[Foxlate] 忽略了一个过时的划词翻译结果。ID: ${translationId}`);
            return { success: true, ignored: true };
        }
        DisplayManager.handleEphemeralTranslation(request.payload, window.frameId);
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
    if (__DEBUG__) {
        console.trace(`[Content Script] Received message from sender:`, request);
    }
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
        // (新) 始终返回一个解析后的 Promise，并带有错误信息，以避免在浏览器中出现“未捕获的 Promise 拒绝”错误。
        // 这也与消息传递API的预期行为更一致。
        return { success: false, error: error.message };
    }
}

// --- Initialization ---

/**
 * 初始化内容脚本。
 * 通过检查一个全局标志来确保所有初始化逻辑只运行一次，
 * 从而使脚本的注入变得幂等（即使被多次注入也不会产生副作用）。
 */
async function initializeContentScript() {
    if (window.foxlateContentScriptInitialized) {
        console.log("[Foxlate] Content script already initialized. Skipping re-initialization.");
        return;
    }
    window.foxlateContentScriptInitialized = true;
    console.log("[Foxlate] Initializing content script...");

    // (新) 独立初始化总结功能
    const settings = await getEffectiveSettings();
    if (settings.summarySettings?.enabled) {
        initializeSummary(settings);
    }


    browser.runtime.onMessage.addListener(handleMessage);
    window.getEffectiveSettings = getEffectiveSettings;
    window.__foxlate_css_injected = true; // 标记CSS注入状态
}

initializeContentScript();
