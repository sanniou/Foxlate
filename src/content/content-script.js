import browser from '../lib/browser-polyfill.js';
import { shouldTranslate } from '../common/precheck.js';
import { marked } from '../lib/marked.esm.js';
import { DisplayManager } from './display-manager.js';
import { SettingsManager } from '../common/settings-manager.js';
import { DOMWalker } from './dom-walker.js';
import { PageTranslationJob } from './page-translation-job.js';
import { initializeSummary } from './summary/summary.js';
import { initializeInputHandler } from './input-handler.js'; // 确保引入
import { TranslationPerformanceHud } from './performance/translation-performance-hud.js';

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

    return rawSettings;
}


const CSS_FILE_PATH = browser.runtime.getURL("content/style.css");
const AI_BATCH_MAX_ITEMS = 12;
const AI_BATCH_MAX_CHARS = 10000;
const AI_BATCH_DELAY_MS = 150;

// --- State Management Class ---

let currentPageJob = null;
let currentSelectionTranslationId = null;
let translationBatchQueue = [];
let translationBatchTimerId = null;
let inFlightBatchIds = new Set();
const performanceHud = new TranslationPerformanceHud();

function createPageTranslationJob(tabId, settings) {
    return new PageTranslationJob(tabId, settings, {
        browserApi: browser,
        cssFilePath: CSS_FILE_PATH,
        logError,
        onProgress: (snapshot) => {
            performanceHud.update({
                ...snapshot,
                batchQueued: translationBatchQueue.length,
                batchInFlight: inFlightBatchIds.size,
            });
        },
        onReverted: (job) => {
            if (currentPageJob === job) {
                currentPageJob = null;
            }
            clearTranslationBatchQueue();
            performanceHud.reset();
            performanceHud.hide({ immediate: true });
        },
        translateElement,
    });
}

function clearTranslationBatchQueue() {
    if (translationBatchTimerId) {
        clearTimeout(translationBatchTimerId);
        translationBatchTimerId = null;
    }
    translationBatchQueue = [];
    inFlightBatchIds.clear();
    performanceHud.updateBatch({ queued: 0, inFlight: 0 });
}

function shouldUseBatchTranslation(translatorEngine) {
    return typeof translatorEngine === 'string' && translatorEngine.startsWith('ai:');
}

function enqueueBatchTranslation(item) {
    translationBatchQueue.push(item);
    performanceHud.updateBatch({ queued: translationBatchQueue.length, inFlight: inFlightBatchIds.size });
    const totalChars = translationBatchQueue.reduce((sum, queued) => sum + queued.text.length, 0);

    if (translationBatchQueue.length >= AI_BATCH_MAX_ITEMS || totalChars >= AI_BATCH_MAX_CHARS) {
        flushTranslationBatchQueue();
        return;
    }

    if (!translationBatchTimerId) {
        translationBatchTimerId = setTimeout(() => {
            flushTranslationBatchQueue();
        }, AI_BATCH_DELAY_MS);
    }
}

function groupBatchItems(items) {
    const groups = new Map();
    for (const item of items) {
        const key = JSON.stringify({
            targetLang: item.targetLang,
            sourceLang: item.sourceLang,
            translatorEngine: item.translatorEngine,
        });
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(item);
    }
    return groups.values();
}

function flushTranslationBatchQueue() {
    if (translationBatchTimerId) {
        clearTimeout(translationBatchTimerId);
        translationBatchTimerId = null;
    }
    if (translationBatchQueue.length === 0) {
        return;
    }

    const itemsToFlush = translationBatchQueue;
    translationBatchQueue = [];

    browser.runtime.sendMessage({ type: 'GET_TAB_ID' }).then(response => {
        const tabId = response?.tabId;
        for (const group of groupBatchItems(itemsToFlush)) {
            const first = group[0];
            const batchId = `fb-${generateUUID()}`;
            inFlightBatchIds.add(batchId);
            performanceHud.updateBatch({ queued: translationBatchQueue.length, inFlight: inFlightBatchIds.size });
            browser.runtime.sendMessage({
                type: 'TRANSLATE_TEXT_BATCH',
                payload: {
                    batchId,
                    items: group.map(item => ({ elementId: item.elementId, text: item.text })),
                    targetLang: first.targetLang,
                    sourceLang: first.sourceLang,
                    translatorEngine: first.translatorEngine,
                    tabId,
                }
            }).catch(error => {
                logError('flushTranslationBatchQueue (send batch)', error);
                inFlightBatchIds.delete(batchId);
                performanceHud.updateBatch({ queued: translationBatchQueue.length, inFlight: inFlightBatchIds.size });
                for (const item of group) {
                    handleTranslationResult({
                        elementId: item.elementId,
                        success: false,
                        translatedText: '',
                        wasTranslated: false,
                        error: error.message,
                    });
                }
            });
        }
    }).catch(error => {
        logError('flushTranslationBatchQueue (get tab id)', error);
        for (const item of itemsToFlush) {
            handleTranslationResult({
                elementId: item.elementId,
                success: false,
                translatedText: '',
                wasTranslated: false,
                error: error.message,
            });
        }
        performanceHud.updateBatch({ queued: translationBatchQueue.length, inFlight: inFlightBatchIds.size });
    });
}

function sendSingleTranslation({ elementId, text, targetLang, sourceLang, translatorEngine }) {
    browser.runtime.sendMessage({ type: 'GET_TAB_ID' }).then(response => {
        const tabId = response?.tabId;
        return browser.runtime.sendMessage({
            type: 'TRANSLATE_TEXT',
            payload: { text, targetLang, sourceLang, elementId, translatorEngine, tabId }
        });
    }).catch(e => {
        logError('sendSingleTranslation', e);
        if (currentPageJob) {
            currentPageJob.recordTranslationCompleted({ success: false });
            currentPageJob.checkCompletion();
        }
        const element = DisplayManager.findElementById(elementId);
        if (element) {
            DisplayManager.displayError(element, e.message || 'Translation request failed.');
        }
    });
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
        currentPageJob.recordTranslationStarted();
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
    const translationRequest = {
        elementId,
        text: textToTranslate,
        targetLang,
        sourceLang: 'auto',
        translatorEngine,
    };

    if (shouldUseBatchTranslation(translatorEngine)) {
        enqueueBatchTranslation(translationRequest);
    } else {
        sendSingleTranslation(translationRequest);
    }
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

    currentPageJob.recordTranslationCompleted({ success: !!success && !!wasTranslated });

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
            currentPageJob = createPageTranslationJob(tabId, newSettings);
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
            currentPageJob = createPageTranslationJob(request.payload.tabId, settings);
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
            currentPageJob = createPageTranslationJob(tabId, settings);
            await currentPageJob.start();
        }
        return { success: true };
    },

    TRANSLATE_TEXT_RESULT(request) {
        handleTranslationResult(request.payload);
        return { success: true };
    },

    TRANSLATE_TEXT_BATCH_RESULT(request) {
        const batchId = request.payload?.batchId;
        if (batchId) {
            inFlightBatchIds.delete(batchId);
            performanceHud.updateBatch({ queued: translationBatchQueue.length, inFlight: inFlightBatchIds.size });
        }
        const items = request.payload?.items || [];
        for (const item of items) {
            handleTranslationResult(item);
        }
        return { success: true };
    },

    TRANSLATION_RETRY_SCHEDULED(request) {
        performanceHud.updateRetry({ retryDelayMs: request.payload?.delayMs || 0 });
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
        
        // 使用增强版的上下文菜单策略处理翻译
        DisplayManager.handleEphemeralTranslation({
            ...request.payload,
            // 确保使用增强版的显示模式
            displayMode: 'enhancedContextMenu'
        }, window.frameId);
        
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
    },

    async TOGGLE_SUMMARY_REQUEST() {
        // 获取当前设置
        const settings = await getEffectiveSettings();
        
        // 如果 summary 功能未启用，临时启用它并使用默认设置
        let tempSettings = settings;
        if (!settings.summarySettings?.enabled) {
            console.log("[Foxlate] Summary feature is not enabled in settings, temporarily enabling for shortcut.");
            tempSettings = {
                ...settings,
                summarySettings: {
                    enabled: true,
                    aiModel: settings.aiEngines && settings.aiEngines.length > 0
                        ? settings.aiEngines[0].id
                        : null,
                    mainBodySelector: settings.summarySettings?.mainBodySelector || 'article, .content, .post, main'
                }
            };
        }

        // 如果 summary 模块实例不存在，先初始化
        if (!window.summaryModuleInstance) {
            initializeSummary(tempSettings);
        }

        // 如果 summary 模块实例仍然不存在，说明初始化失败
        if (!window.summaryModuleInstance) {
            console.log("[Foxlate] Failed to initialize summary module.");
            return { success: false, error: "Failed to initialize summary module" };
        }

        // 触发 summary 功能
        try {
            // 如果有选中的文本，先清除选区上下文
            if (window.getSelection().toString().trim()) {
                window.summaryModuleInstance.selectionContext = null;
            }
            
            // 切换页面总结对话框
            await window.summaryModuleInstance.togglePageSummaryDialog();
            return { success: true };
        } catch (error) {
            logError('TOGGLE_SUMMARY_REQUEST', error);
            return { success: false, error: error.message };
        }
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

    // 关键修复：必须先将 getEffectiveSettings 暴露到 window 对象，
    // 因为后续的初始化函数（如 initializeInputHandler）依赖于它。
    window.getEffectiveSettings = getEffectiveSettings;

    console.log('[Foxlate] Content script: getEffectiveSettings exposed to window');

    // (新) 独立初始化总结功能
    const settings = await getEffectiveSettings();
    if (settings.summarySettings?.enabled) {
        initializeSummary(settings);
    }

    // (新) 初始化输入框翻译功能
    console.log('[Foxlate] Content script: About to initialize input handler');
    initializeInputHandler(); // 确保调用

    browser.runtime.onMessage.addListener(handleMessage);
    window.__foxlate_css_injected = true; // 标记CSS注入状态
}

initializeContentScript();
