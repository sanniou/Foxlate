import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { DisplayManager } from './display-manager.js';
import { PageTranslationJob } from './page-translation-job.js';
import { initializeInputHandler } from './input-handler.js';
import { TranslationPerformanceHud } from './performance/translation-performance-hud.js';
import { createEffectiveSettingsGetter } from './content-settings-client.js';
import { logContentError } from './content-logger.js';
import { TranslationBatchQueue } from './translation-batch-queue.js';
import { ElementTranslationController } from './element-translation-controller.js';
import { createContentMessageHandlers } from './content-message-handlers.js';
import { QuickActionPanel } from './quick-action-panel.js';
import { translateSelectionPayload } from './selection-translate.js';
import { preloadLanguageDetector } from '../common/lang-detect.js';
import { registerPretextMeasurementEngine } from './layout/pretext-measurement-engine.js';
import { generateId as defaultGenerateId } from '../common/ids.js';

export class ContentRuntime {
    constructor({
        browserApi = browser,
        win = window,
        displayManager = DisplayManager,
        PageTranslationJobClass = PageTranslationJob,
        // 生产构建里 `__DEBUG__` 是编译期 false，esbuild 会把这个分支连同模块引用一起消除。
        performanceHud = globalThis.__DEBUG__ ? new TranslationPerformanceHud() : null,
        initializeInputHandlerFn = initializeInputHandler,
        QuickActionPanelClass = QuickActionPanel,
        getEffectiveSettings = createEffectiveSettingsGetter({ browserApi, win }),
        logError = logContentError,
        generateId = defaultGenerateId,
        registerMeasurementEngine = registerPretextMeasurementEngine,
        cssFilePath = browserApi.runtime.getURL('content/style.css'),
    } = {}) {
        this.browser = browserApi;
        this.window = win;
        this.registerMeasurementEngine = registerMeasurementEngine;
        this.displayManager = displayManager;
        this.PageTranslationJobClass = PageTranslationJobClass;
        this.performanceHud = performanceHud;
        // 入口串行化锁：见 startTranslationJob
        this.startPromise = null;
        this.initializeInputHandler = initializeInputHandlerFn;
        this.QuickActionPanelClass = QuickActionPanelClass;
        this.getEffectiveSettings = getEffectiveSettings;
        this.logError = logError;
        this.cssFilePath = cssFilePath;
        this.currentPageJob = null;
        this.currentSelectionTranslationId = null;
        this.quickActionPanel = null;

        this.batchQueue = new TranslationBatchQueue({
            browserApi,
            generateId,
            logError,
            onBatchStateChange: ({ queued, inFlight }) => {
                if (globalThis.__DEBUG__) this.performanceHud.updateBatch({ queued, inFlight });
            },
            onTranslationResult: (payload) => this.handleTranslationResult(payload),
        });

        this.elementTranslator = new ElementTranslationController({
            browserApi,
            displayManager,
            batchQueue: this.batchQueue,
            getCurrentPageJob: () => this.currentPageJob,
            generateId,
            logError,
        });

        this.messageHandlers = createContentMessageHandlers(this);
        this.handleMessage = this.handleMessage.bind(this);
    }

    createPageTranslationJob(tabId, settings) {
        return new this.PageTranslationJobClass(tabId, settings, {
            browserApi: this.browser,
            cssFilePath: this.cssFilePath,
            logError: this.logError,
            onProgress: (snapshot) => {
                if (!globalThis.__DEBUG__) return;
                this.performanceHud.update({
                    ...snapshot,
                    batchQueued: this.batchQueue.queuedCount,
                    batchInFlight: this.batchQueue.inFlightCount,
                });
            },
            onReverted: (job) => {
                if (this.currentPageJob === job) {
                    this.currentPageJob = null;
                }
                this.batchQueue.clear();
                if (globalThis.__DEBUG__) {
                    this.performanceHud.reset();
                    this.performanceHud.hide({ immediate: true });
                }
            },
            translateElement: (element, activeSettings) => {
                this.elementTranslator.translateElement(element, activeSettings);
            },
        });
    }

    async startTranslationJob(tabId, { ignoreIfActive = false } = {}) {
        // 入口可能同时来自 popup、快捷键、右键菜单和标签页状态恢复。并发进入时两个调用
        // 都会看到 currentPageJob 为空，各自 await getEffectiveSettings，然后各建一个 job：
        // 后一个覆盖 currentPageJob，前一个变成仍在观察 DOM 的孤儿（同一段文本被翻两次）。
        // 把创建流程串起来，第二个调用在执行时才能看到第一个的结果。
        const previous = this.startPromise ?? Promise.resolve();
        const current = previous
            .catch(() => {})
            .then(() => this.#runStartTranslationJob(tabId, { ignoreIfActive }));
        this.startPromise = current;
        try {
            return await current;
        } finally {
            if (this.startPromise === current) {
                this.startPromise = null;
            }
        }
    }

    async #runStartTranslationJob(tabId, { ignoreIfActive }) {
        if (this.currentPageJob) {
            if (ignoreIfActive) {
                console.warn('[Foxlate] Translation request received, but a job is already active. Ignoring.');
                return { success: true };
            }
            await this.currentPageJob.revert();
        }

        const settings = await this.getEffectiveSettings();
        this.currentPageJob = this.createPageTranslationJob(tabId, settings);
        await this.currentPageJob.start();
        return { success: true };
    }

    async toggleTranslationJob(tabId) {
        if (this.currentPageJob) {
            await this.currentPageJob.revert();
            return { success: true };
        }

        return this.startTranslationJob(tabId);
    }

    async revertTranslationJob() {
        if (this.currentPageJob) {
            await this.currentPageJob.revert();
        }
        return { success: true };
    }

    async reloadTranslationJob() {
        if (!this.currentPageJob) {
            return { success: true };
        }

        const tabId = this.currentPageJob.tabId;
        await this.currentPageJob.revert();

        const settings = await this.getEffectiveSettings();
        this.currentPageJob = this.createPageTranslationJob(tabId, settings);
        await this.currentPageJob.start();
        this.requestSummaryModule(settings);
        return { success: true };
    }

    async handleSettingsUpdated(_newSettings) {
        // Always re-resolve *effective* settings for this hostname.
        // Raw storage payloads are global-shaped (nested translationSelector.default,
        // no domain overlays) and must not replace the page job settings or drive
        // display-mode switches — that caused append→replace/hover to no-op after
        // SETTINGS_UPDATED overwrote a correct UPDATE_DISPLAY_MODE.
        const effective = await this.getEffectiveSettings();

        if (this.currentPageJob && effective) {
            this.currentPageJob.settings = effective;
        }

        if (
            this.currentPageJob
            && effective?.displayMode
            && ['translated', 'translating'].includes(this.currentPageJob.state)
        ) {
            await this.displayManager.updateDisplayMode(effective.displayMode);
        }

        if (this.window.subtitleManager?.updateSettings) {
            this.window.subtitleManager.updateSettings(effective);
        }

        this.requestSummaryModule(effective);
        this.quickActionPanel?.updateSettings(effective);
        return { success: true };
    }

    handleTranslationResult(payload) {
        this.elementTranslator.handleTranslationResult(payload);
    }

    handleBatchTranslationResult(payload = {}) {
        this.batchQueue.markBatchCompleted(payload.batchId);
        for (const item of payload.items || []) {
            this.handleTranslationResult(item);
        }
    }

    handleTranslationRetryScheduled(payload = {}) {
        if (!globalThis.__DEBUG__) return;
        this.performanceHud.updateRetry({ retryDelayMs: payload.delayMs || 0 });
    }

    async updateDisplayMode(displayMode) {
        // 不要回写 currentPageJob.settings：设置对象现在是全局共享且深冻结的，
        // 而 page-translation-job 从不读取 settings.displayMode（原赋值是只写状态）。
        await this.displayManager.updateDisplayMode(displayMode);
        return { success: true };
    }

    getTranslationStatus() {
        if (!this.currentPageJob) {
            return {
                state: 'original',
                emptyCandidates: false,
                allPrecheckSkipped: false,
                failedCount: 0,
                completedCount: 0,
            };
        }

        let state = 'original';
        if (['starting', 'translating'].includes(this.currentPageJob.state)) {
            state = 'loading';
        } else if (this.currentPageJob.state === 'translated') {
            state = 'translated';
        }

        const snap = this.currentPageJob.getProgressSnapshot?.() || {};
        return {
            state,
            emptyCandidates: Boolean(snap.emptyCandidates),
            allPrecheckSkipped: Boolean(snap.allPrecheckSkipped),
            // popup 用它区分「翻好了」和「每一段都失败」——后者徽标是「!」，
            // 需要一句能照着做的提示，而不是让用户对着满屏红下划线猜。
            failedCount: Number(snap.failed) || 0,
            completedCount: Number(snap.completed) || 0,
        };
    }

    async translateSelectionRequest(payload = {}) {
        const text = payload.text?.trim();
        if (!text) {
            return { success: false, error: 'No selection' };
        }
        return translateSelectionPayload({
            browserApi: this.browser,
            win: this.window,
            selectionPayload: {
                text,
                coords: payload.coords || { clientX: 0, clientY: 0 },
            },
            source: payload.source || 'selection',
            displaySelectionTranslation: (p) => this.displaySelectionTranslation(p),
            getEffectiveSettings: this.getEffectiveSettings,
        });
    }

    displaySelectionTranslation(payload = {}) {
        const { translationId, isLoading } = payload;

        if (isLoading) {
            this.currentSelectionTranslationId = translationId;
        } else if (translationId !== this.currentSelectionTranslationId) {
            return { success: true, ignored: true };
        }

        this.displayManager.handleEphemeralTranslation({
            ...payload,
            displayMode: 'enhancedContextMenu',
        }, this.window.frameId);

        return { success: true };
    }

    toggleSubtitleTranslation(enabled) {
        if (this.window.subtitleManager?.toggle) {
            this.window.subtitleManager.toggle(enabled);
        }
        return { success: true };
    }

    getSubtitleTranslationStatus() {
        if (this.window.subtitleManager?.getStatus) {
            return this.window.subtitleManager.getStatus();
        }
        return { isSupported: false, isEnabled: false };
    }

    /**
     * 请求后台注入摘要模块。
     *
     * 摘要（readability 正文抽取 + marked 渲染 + 面板 UI）不再打进内容包，所以这里只能
     * 「请后台代拿」。注入失败只影响摘要入口，不该打断页面翻译，因此只记日志。
     *
     * **开关判断由内容侧给出**：`settings` 就是本页面刚刚用来决定要不要建面板的那份
     * 生效设置。早期版本让后台自己再读一次，结果撞上后台设置缓存的陈旧窗口——实测
     * 「在设置页打开摘要 → 立即翻译当前页面」时后台还读得到 `enabled: false`，于是面板
     * 按钮根本不出现。同一份判断只该有一个来源。
     *
     * @param {object} [settings] 生效设置；未开启摘要时不发请求
     */
    requestSummaryModule(settings) {
        if (!settings?.summarySettings?.enabled) {
            return;
        }
        this.browser.runtime.sendMessage({
            type: MESSAGE_TYPES.ENSURE_SUMMARY_MODULE,
            payload: {
                hostname: this.window.location?.hostname,
                enabled: true,
            },
        }).catch(error => this.logError('requestSummaryModule', error));
    }


    async handleMessage(request, sender) {
        if (globalThis.__DEBUG__) {
            console.trace('[Content Script] Received message from sender:', request, sender);
        }

        const handler = this.messageHandlers[request.type];
        if (!handler) {
            return { success: false, error: `Unhandled message type: ${request.type}` };
        }

        try {
            return await handler(request, sender);
        } catch (error) {
            this.logError(`handleMessage (type: ${request.type})`, error);
            return { success: false, error: error.message };
        }
    }

    async initialize() {
        if (this.window.foxlateContentScriptInitialized) {
            return;
        }

        this.window.foxlateContentScriptInitialized = true;

        // 必须在任何测量发生前完成：让 content 侧用上精确排版引擎。
        this.registerMeasurementEngine();

        this.window.getEffectiveSettings = this.getEffectiveSettings;

        // 必须先于任何 await 注册：背景在注入返回后立即发第一条消息，而脚本求值到
        // 这里之间隔着一次 settings 往返。把这个监听器留到最后会让首次点击翻译
        // 掉进「Receiving end does not exist」的真空期。
        this.browser.runtime.onMessage.addListener(this.handleMessage);

        const settings = await this.getEffectiveSettings();
        this.requestSummaryModule(settings);
        this.initializeInputHandler();
        this.quickActionPanel = new this.QuickActionPanelClass({
            browserApi: this.browser,
            win: this.window,
            settings,
            onTranslate: (selectionPayload) => translateSelectionPayload({
                browserApi: this.browser,
                win: this.window,
                selectionPayload,
                source: 'quick-action',
                displaySelectionTranslation: (payload) => this.displaySelectionTranslation(payload),
                getEffectiveSettings: this.getEffectiveSettings,
            }),
        });
        this.quickActionPanel.initialize(settings);

        this.window.__foxlate_css_injected = true;
    }
}

export async function initializeContentRuntime(options = {}) {
    // franc（约 240 KB）是按需加载资源：在用户真正触发翻译/朗读前预热，
    // 使热路径（shouldTranslate / 朗读语种判定）拿到完整准确的检测能力。
    preloadLanguageDetector();
    const runtime = new ContentRuntime(options);
    await runtime.initialize();
    return runtime;
}
