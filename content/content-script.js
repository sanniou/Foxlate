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
    // 优化 1: 增加前置检查。如果根节点本身无效或已在翻译容器内，则直接返回空数组，避免创建 TreeWalker。
    if (!rootNode || rootNode.nodeType !== Node.ELEMENT_NODE || rootNode.closest('[data-translated="true"], [data-translation-id]')) {
        return [];
    }

    const textNodes = [];
    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // 优化 2: 将廉价的检查前置。
                // 检查1: 忽略纯空白文本节点。
                if (node.nodeValue.trim() === '') {
                    return NodeFilter.FILTER_REJECT;
                }

                const parent = node.parentElement;

                // 检查2: 忽略特定标签或可编辑元素内的文本。
                // 优化 3: 使用 Set 替代 Array.includes() 以提高性能。
                if (IGNORED_TAGS.has(parent.tagName.toLowerCase()) || parent.isContentEditable) {
                    return NodeFilter.FILTER_REJECT;
                }

                // 检查3: 忽略已标记为翻译中或已翻译的容器内的文本。
                // 这个检查仍然是必要的，以处理嵌套的、可能已被独立处理的元素。
                if (parent.closest('[data-translated="true"], [data-translation-id]')) {
                    return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    while (walker.nextNode()) {
        const node = walker.currentNode;
        textNodes.push(node);
    }
    return textNodes;
}

// --- Observers and Translation Logic ---

let intersectionObserver = null;
let mutationObserver = null;
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

    const mutationCallback = debounce((mutations) => {
        let newNodes = [];
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE && !node.closest('#universal-translator-selection-panel')) {
                        newNodes.push(node);
                    }
                });
            }
        }
        if (newNodes.length > 0) {
            // 对于动态添加的节点，也使用智能查找，而不是直接观察
            if (!translationJob.settings) {
                console.warn("[SanReader] Mutation observed, but no translation job settings found. Skipping auto-translation of new content.");
                return;
            }
            const newElementsToObserve = findTranslatableRootElements(translationJob.settings, newNodes);
            observeElements(newElementsToObserve);
        }
    }, 500);

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

        let nodesToTranslate = [];
        elements.forEach(el => {
            nodesToTranslate.push(...findTextNodes(el));
        });

        const validNodes = nodesToTranslate.filter(node => node.parentElement && document.body.contains(node));
        if (validNodes.length === 0) return;

        // 给父元素打上ID，并收集文本
        const texts = [];
        const ids = [];
        const parentElements = new Map();

        validNodes.forEach(node => {
            const parent = node.parentElement;
            // 为每个文本节点生成唯一ID，而不是父元素
            const nodeId = `ut-${generateUUID()}`;
            // 使用自定义属性存储节点的原始内容
            node.parentElement.dataset.translationId = nodeId;
            
            // 只收集当前文本节点的内容
            const textContent = node.textContent.trim();
            if (textContent) {
                parentElements.set(nodeId, parent);
                texts.push(textContent);
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
    const { settings } = await browser.storage.sync.get('settings') || {};
    // If no settings exist at all, return an empty object.
    if (!settings) {
        return {};
    };

    const hostname = window.location.hostname;
    // Start with global settings as the base.
    const defaultRule = { ...settings };

    const domainRules = settings.domainRules || {};
    let effectiveRule = {};

    const matchingDomain = Object.keys(domainRules)
        .filter(d => hostname.endsWith(d))
        .sort((a, b) => b.length - a.length)[0];

    if (matchingDomain) {
        const rule = domainRules[matchingDomain];
        if (rule.applyToSubdomains !== false || hostname === matchingDomain) {
            effectiveRule = rule;
        }
    }

    // Merge global settings with the specific rule.
    const finalSettings = {
        ...defaultRule,
        ...effectiveRule
    };

    // Logic for determining the final selector based on overrides.
    if (effectiveRule.cssSelector && effectiveRule.cssSelectorOverride) {
        finalSettings.translationSelector = effectiveRule.cssSelector; // 强制使用域名规则的选择器
    } else if (effectiveRule.cssSelector && !effectiveRule.cssSelectorOverride) {
      // 合并 域名规则 css 选择器 和 settings.translationSelector.default
      finalSettings.translationSelector = `${finalSettings.translationSelector?.default || ''}, ${effectiveRule.cssSelector}`.replace(/^, /, '');
    } else if (finalSettings.translationSelector?.default) {
      finalSettings.translationSelector = finalSettings.translationSelector.default; // 使用settings中的默认选择器
    } else {
      // If no selector is defined anywhere, it will be undefined.
      delete finalSettings.translationSelector;
    }

    return finalSettings;
}

/**
 * (重构) 根据指定的CSS选择器查找页面上所有可翻译的根元素。
 * @param {object} effectiveSettings - 包含 translationSelector 的配置对象。
 * @param {Node[]} [rootNodes=[document.body]] - 在这些节点内进行搜索。
 * @returns {HTMLElement[]} - 找到的顶层元素数组。
 */
function findTranslatableRootElements(effectiveSettings, rootNodes = [document.body]) {
    const selector = effectiveSettings?.translationSelector;
    if (!selector) {
        console.warn("[SanReader] No CSS selector provided. Cannot find translatable elements.");
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
    if (translationJob.isTranslating) {
        console.log("[SanReader] Translation job already in progress. Ignoring request.");
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
        if (!effectiveSettings.translationSelector) {
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

    const elements = document.querySelectorAll('[data-translation-strategy]');
    elements.forEach(element => {
        window.DisplayManager.revert(element);
        // 清理所有状态，以便可以重新翻译
        delete element.dataset.translated;
        delete element.dataset.translationStrategy;
        delete element.dataset.translationId;
        delete element.dataset.translatedText;
        element.classList.remove('universal-translator-error');
        delete element.dataset.errorMessage;
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
                return { status: 'PONG' };

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
                    const element = document.querySelector(`[data-translation-id='${id}']`);
                    if (element) {
                        if (success && wasTranslated) {
                            // 使用当前任务的显示模式来应用翻译
                            const displayMode = translationJob.settings?.displayMode || 'replace';
                            window.DisplayManager.apply(element, translatedText, displayMode);
                        } else if (error) {
                            if (error.includes("interrupted")) {
                                delete element.dataset.translationId;
                                console.log(`Translation interrupted for element #${id}. Original content preserved.`);
                            } else {
                                window.DisplayManager.showError(element, error);
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
                    const { isLoading, success, translatedText, error } = request.payload;
                    const selection = window.getSelection();
                    if (selection && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        const rect = range.getBoundingClientRect();
                        // 计算 Tooltip 位置，使其出现在选区下方
                        const x = rect.left + rect.width / 2;
                        const y = rect.bottom + 10; // 选区下方 10px
                        const coords = { clientX: x, clientY: y };

                        if (isLoading) {
                            const loadingMessage = browser.i18n.getMessage('popupTranslating') || 'Translating...';
                            window.contextMenuStrategy.displayTranslation(coords, loadingMessage, true);
                        } else if (success && translatedText) {
                            window.contextMenuStrategy.displayTranslation(coords, translatedText, false);
                        } else if (error) {
                            const errorMessage = browser.i18n.getMessage('testError') || 'Error';
                            window.contextMenuStrategy.displayTranslation(coords, `${errorMessage}: ${error}`, false);
                        }
                    }
                    break; // 修复：防止 fall-through 到下一个 case
                }
                
            case 'REQUEST_TRANSLATION_STATUS': {
                const sessionActive = document.body.dataset.translationSession === 'active';
                let state = 'original';

                if (sessionActive) {
                    // 页面处于翻译会话中，根据是否在忙碌来决定是“加载中”还是“已翻译”
                    state = translationJob.isTranslating ? 'loading' : 'translated'; // 修正：先判断是否正在翻译
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
    try {
        const response = await browser.runtime.sendMessage({
            type: 'SHOULD_AUTO_TRANSLATE',
            payload: { hostname: window.location.hostname, url: window.location.href }
        });
        if (response && response.shouldTranslate) {
            // **(调试) 输出调用栈**
            console.log("[SanReader] Auto-translation triggered:", new Error().stack);
            await performPageTranslation(response.tabId);
        }
    } catch (error) {
        logError('triggerAutoTranslationCheck', error);
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
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
        
        // 主动发起自动翻译检查
        triggerAutoTranslationCheck();
    } catch (error) {
        logError('initializeContentScript', new Error("Failed to set up message listener: " + error.message));
    }
}

initializeContentScript();