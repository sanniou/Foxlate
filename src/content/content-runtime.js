import browser from '../lib/browser-polyfill.js';
import { DisplayManager } from './display-manager.js';
import { PageTranslationJob } from './page-translation-job.js';
import { initializeSummary } from './summary/summary.js';
import { initializeInputHandler } from './input-handler.js';
import { TranslationPerformanceHud } from './performance/translation-performance-hud.js';
import { createEffectiveSettingsGetter } from './content-settings-client.js';
import { logContentError } from './content-logger.js';
import { TranslationBatchQueue } from './translation-batch-queue.js';
import { ElementTranslationController } from './element-translation-controller.js';
import { createContentMessageHandlers } from './content-message-handlers.js';
import { QuickActionPanel } from './quick-action-panel.js';
import { translateSelectionPayload } from './selection-translate.js';

function defaultGenerateId() {
    return self.crypto.randomUUID();
}

export class ContentRuntime {
    constructor({
        browserApi = browser,
        win = window,
        displayManager = DisplayManager,
        PageTranslationJobClass = PageTranslationJob,
        performanceHud = new TranslationPerformanceHud(),
        initializeSummaryFn = initializeSummary,
        initializeInputHandlerFn = initializeInputHandler,
        QuickActionPanelClass = QuickActionPanel,
        getEffectiveSettings = createEffectiveSettingsGetter({ browserApi, win }),
        logError = logContentError,
        generateId = defaultGenerateId,
        cssFilePath = browserApi.runtime.getURL('content/style.css'),
    } = {}) {
        this.browser = browserApi;
        this.window = win;
        this.displayManager = displayManager;
        this.PageTranslationJobClass = PageTranslationJobClass;
        this.performanceHud = performanceHud;
        this.initializeSummary = initializeSummaryFn;
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
                this.performanceHud.updateBatch({ queued, inFlight });
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
                this.performanceHud.reset();
                this.performanceHud.hide({ immediate: true });
            },
            translateElement: (element, activeSettings) => {
                this.elementTranslator.translateElement(element, activeSettings);
            },
        });
    }

    async startTranslationJob(tabId, { ignoreIfActive = false } = {}) {
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
        this.initializeSummary(settings);
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

        this.initializeSummary(effective);
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
        this.performanceHud.updateRetry({ retryDelayMs: payload.delayMs || 0 });
    }

    async updateDisplayMode(displayMode) {
        if (this.currentPageJob?.settings) {
            this.currentPageJob.settings.displayMode = displayMode;
        }
        await this.displayManager.updateDisplayMode(displayMode);
        return { success: true };
    }

    getTranslationStatus() {
        if (!this.currentPageJob) {
            return { state: 'original', emptyCandidates: false, allPrecheckSkipped: false };
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

    async toggleSummary() {
        const settings = await this.getEffectiveSettings();
        let summarySettings = settings;

        if (!settings.summarySettings?.enabled) {
            summarySettings = {
                ...settings,
                summarySettings: {
                    enabled: true,
                    aiModel: settings.aiEngines?.length > 0 ? settings.aiEngines[0].id : null,
                    mainBodySelector: settings.summarySettings?.mainBodySelector || 'article, .content, .post, main',
                },
            };
        }

        if (!this.window.summaryModuleInstance) {
            this.initializeSummary(summarySettings);
        }

        if (!this.window.summaryModuleInstance) {
            return { success: false, error: 'Failed to initialize summary module' };
        }

        try {
            if (this.window.getSelection().toString().trim()) {
                this.window.summaryModuleInstance.selectionContext = null;
            }
            await this.window.summaryModuleInstance.togglePageSummaryDialog();
            return { success: true };
        } catch (error) {
            this.logError('TOGGLE_SUMMARY_REQUEST', error);
            return { success: false, error: error.message };
        }
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

        this.window.getEffectiveSettings = this.getEffectiveSettings;

        const settings = await this.getEffectiveSettings();
        if (settings.summarySettings?.enabled) {
            this.initializeSummary(settings);
        }

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

        this.browser.runtime.onMessage.addListener(this.handleMessage);
        this.window.__foxlate_css_injected = true;
    }
}

export async function initializeContentRuntime(options = {}) {
    const runtime = new ContentRuntime(options);
    await runtime.initialize();
    return runtime;
}
