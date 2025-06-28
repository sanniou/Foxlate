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
let originalContent = new Map();
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
        rootMargin: '200px 0px',
        threshold: 0.01
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
            const newElementsToObserve = findTranslatableRootElements(newNodes);
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
async function translateElements(elements) {
    if (elements.length === 0) return;

    try {
        const { settings } = await browser.storage.sync.get('settings');
        const targetLang = settings?.targetLanguage || 'ZH';
        const CHUNK_SIZE = settings?.parallelRequests || 5;

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
            if (!parent.dataset.translationId) {
                parent.dataset.translationId = `ut-${generateUUID()}`;
            }
            if (!parentElements.has(parent.dataset.translationId)) {
                parentElements.set(parent.dataset.translationId, parent);
                texts.push(parent.textContent); // 发送整个元素的 textContent
                ids.push(parent.dataset.translationId);
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
                payload: { texts: textChunk, ids: idChunk, targetLang, sourceLang: 'auto', tabId: translationJob.tabId }
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
    if (!settings) {
        // 如果用户没有设置，则提醒用户更新配置
        console.warn("[SanReader] No settings found. Please update your configuration in the extension options.");
        // 返回一个空的配置对象，以防止程序崩溃。
        // 后续需要根据这个空配置进行特殊处理，例如不翻译任何内容。
        return {};
    };

    const hostname = window.location.hostname;
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

    const finalSettings = {
        ...settings, // 首先使用用户的所有设置
        ...effectiveRule
    };

    // 如果域名规则中没有指定 cssSelectorOverride，且 settings 中没有 defaultSelector，则使用一个 fallbackSelector
    const fallbackSelector = 'p, h1, h2, h3, h4, h5, h6, li, dd, dt, blockquote, summary, article, td';

    if (effectiveRule.cssSelector && effectiveRule.cssSelectorOverride) {
        finalSettings.translationSelector = effectiveRule.cssSelector; // 强制使用域名规则的选择器
    } else if (effectiveRule.cssSelector && !effectiveRule.cssSelectorOverride) {
      // 合并 域名规则 css 选择器 和 settings.translationSelector.default
      finalSettings.translationSelector = `${finalSettings.translationSelector?.default || fallbackSelector}, ${effectiveRule.cssSelector}`;
    } else if (finalSettings.translationSelector?.default) {
      finalSettings.translationSelector = finalSettings.translationSelector.default; // 使用settings中的默认选择器
    } else {
      finalSettings.translationSelector = fallbackSelector
    }

    return finalSettings;
}

/**
 * (重构) 根据指定的CSS选择器查找页面上所有可翻译的根元素。
 * @param {string} selector - 用于查找元素的CSS选择器。
 * @returns {HTMLElement[]} - 找到的顶层元素数组。
 */
function findTranslatableRootElements(effectiveSettings) {
    const selector = effectiveSettings?.translationSelector;
    if (!selector) {
        console.warn("[SanReader] No CSS selector provided. Cannot find translatable elements.");
        return [];
    }
    const elements = new Set(document.querySelectorAll(selector));
    const finalElements = Array.from(elements);

    // 过滤掉嵌套的元素，只保留最顶层的容器
    return finalElements.filter(el => {
        if (!el.parentElement) return true;
        let parent = el.parentElement;
        while (parent) {
            if (elements.has(parent)) {
                return false; // 它是另一个候选元素的后代，跳过
            }
            parent = parent.parentElement;
        }
        return true;
    });
}


async function performPageTranslation(tabId) {
    if (translationJob.isTranslating) {
        console.log("[SanReader] Translation job already in progress. Ignoring request.");
        return;
    }

    console.log("[SanReader] Starting page translation process...");
    stopObservers();
    originalContent.clear();
    
    let effectiveSettings;
    try {
        effectiveSettings = await getEffectiveSettings();
        console.log("[SanReader] Effective settings for this page:", effectiveSettings);
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
                const element = document.querySelector(`[data-translation-id='${id}']`);
                if (element) {
                    if (success && wasTranslated) {
                        window.DisplayManager.apply(element, translatedText);
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

            case 'UPDATE_DISPLAY_MODE':
                window.DisplayManager.updateDisplayMode(request.payload.displayMode);
                break;
            
            case 'REQUEST_TRANSLATION_STATUS':
                sendResponse({ isTranslating: translationJob.isTranslating });
                break;
        }
    } catch (error) {
        logError(`handleMessage (type: ${request.type})`, error);
    }
    return true;
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