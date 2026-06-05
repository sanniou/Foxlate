import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { DisplayManager } from './display-manager.js';
import { DOMWalker } from './dom-walker.js';
import { findAllSearchRoots, findTranslatableElements } from './translatable-elements.js';

function defaultLogError(context, error) {
    if (error && error.name === 'AbortError') {
        return;
    }
    console.error(`[Foxlate Content Script Error] in ${context}:`, error.message, error.stack);
}

/**
 * 启动页面翻译作业。
 */
export class PageTranslationJob {
    constructor(tabId, settings, {
        browserApi = browser,
        cssFilePath = '',
        displayManager = DisplayManager,
        domWalker = DOMWalker,
        findAllSearchRootsFn = findAllSearchRoots,
        findTranslatableElementsFn = findTranslatableElements,
        logError = defaultLogError,
        onReverted = () => {},
        onProgress = () => {},
        translateElement = () => {},
    } = {}) {
        this.tabId = tabId;
        this.settings = settings;

        this.browser = browserApi;
        this.cssFilePath = cssFilePath;
        this.displayManager = displayManager;
        this.domWalker = domWalker;
        this.findAllSearchRoots = findAllSearchRootsFn;
        this.findTranslatableElements = findTranslatableElementsFn;
        this.logError = logError;
        this.onReverted = onReverted;
        this.onProgress = onProgress;
        this.translateElement = translateElement;

        this.mutationQueue = new Set();
        this.idleCallbackId = null;
        this.initialScanIdleCallbackId = null;
        this.initialScanQueue = [];
        this.initialScanInProgress = false;
        this.initialScanObservedCount = 0;
        this.mutationDebounceTimerId = null;
        this.DEBOUNCE_DELAY = 300;
        this.INITIAL_SCAN_CHUNK_SIZE = 12;
        this.intersectionObserver = null;
        this.mutationObserver = null;
        this.observedElements = new Set();
        this.pendingScrollTranslationElements = new Set();
        this.translationIdleCallbackIds = new Set();
        this.scrollIdleTimerId = null;
        this.isScrolling = false;
        this.scrollListenerOptions = { passive: true };
        this.boundHandleScrollActivity = this.#handleScrollActivity.bind(this);
        this.activeTranslations = 0;
        this.startedTranslations = 0;
        this.completedTranslations = 0;
        this.failedTranslations = 0;

        this.state = 'idle';
    }

    getProgressSnapshot(extra = {}) {
        return {
            state: this.state,
            observed: this.observedElements.size,
            initialScanRemaining: this.initialScanQueue.length,
            mutationQueue: this.mutationQueue.size,
            pendingScroll: this.pendingScrollTranslationElements.size,
            activeTranslations: this.activeTranslations,
            started: this.startedTranslations,
            completed: this.completedTranslations,
            failed: this.failedTranslations,
            isScrolling: this.isScrolling,
            ...extra,
        };
    }

    emitProgress(extra = {}) {
        this.onProgress(this.getProgressSnapshot(extra));
    }

    recordTranslationStarted() {
        this.activeTranslations++;
        this.startedTranslations++;
        this.emitProgress();
    }

    recordTranslationCompleted({ success = true } = {}) {
        this.activeTranslations = Math.max(0, this.activeTranslations - 1);
        if (success) {
            this.completedTranslations++;
        } else {
            this.failedTranslations++;
        }
        this.emitProgress();
    }

    async start() {
        if (this.state !== 'idle') {
            return;
        }

        this.state = 'starting';
        this.emitProgress();

        this.browser.runtime.sendMessage({
            type: MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE,
            payload: { status: 'loading', tabId: this.tabId }
        }).catch(e => this.logError('start (sending loading status)', e));

        document.body.dataset.translationSession = 'active';

        try {
            if (!this.settings.targetLanguage) {
                throw new Error(this.browser.i18n.getMessage('errorMissingTargetLanguage') || 'Target language is not configured.');
            }
            if (!this.settings.translatorEngine) {
                throw new Error(this.browser.i18n.getMessage('errorMissingEngine') || 'Translation engine is not configured.');
            }
        } catch (error) {
            this.logError('PageTranslationJob.start (settings validation)', error);
            this.state = 'idle';
            throw error;
        }

        this.#initializeObservers();
        this.#startMutationObserver();
        this.#startScrollObserver();
        this.#startInitialScan();
        this.emitProgress();
    }

    async revert() {
        if (this.state === 'reverting' || this.state === 'idle') {
            return;
        }
        try {
            await this.browser.runtime.sendMessage({ type: MESSAGE_TYPES.STOP_TRANSLATION, payload: { tabId: this.tabId } });
        } catch (e) {
            this.logError('revert (sending STOP_TRANSLATION)', e);
        }

        try {
            await this.browser.runtime.sendMessage({
                type: MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE,
                payload: { status: 'original', tabId: this.tabId }
            });
        } catch (e) {
            this.logError('revert (sending original status)', e);
        }

        this.state = 'reverting';

        this.#stopObservers();
        this.activeTranslations = 0;
        this.emitProgress();
        this.#clearPendingScrollTranslations();

        try {
            delete document.body.dataset.translationSession;
            this.displayManager.hideAllEphemeralUI();
            const registeredWeakRefs = Array.from(this.displayManager.elementRegistry.values());
            let revertedCount = 0;

            for (const weakRef of registeredWeakRefs) {
                const element = weakRef.deref();
                if (element) {
                    this.displayManager.revert(element);
                    revertedCount++;
                }
            }
            const leftoverWrappers = document.body.querySelectorAll('foxlate-wrapper[data-foxlate-generated="true"]');
            if (leftoverWrappers.length > 0) {
                leftoverWrappers.forEach(wrapper => {
                    if (wrapper.parentNode) wrapper.replaceWith(...wrapper.childNodes);
                });
            }
        } catch (error) {
            this.logError('revert (DOM cleanup)', error);
        }

        this.onReverted(this);
    }

    checkCompletion() {
        if (
            this.state === 'translating' &&
            !this.initialScanInProgress &&
            this.activeTranslations === 0 &&
            this.mutationQueue.size === 0 &&
            this.pendingScrollTranslationElements.size === 0 &&
            !this.isScrolling
        ) {
            this.state = 'translated';
            this.emitProgress();
            this.browser.runtime.sendMessage({
                type: MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE,
                payload: { status: 'translated', tabId: this.tabId }
            }).catch(e => this.logError('checkCompletion (sending completed status)', e));
        }
    }

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
    }

    #startScrollObserver() {
        window.addEventListener('scroll', this.boundHandleScrollActivity, this.scrollListenerOptions);
        window.addEventListener('wheel', this.boundHandleScrollActivity, this.scrollListenerOptions);
        window.addEventListener('touchmove', this.boundHandleScrollActivity, this.scrollListenerOptions);
    }

    #stopObservers() {
        if (this.intersectionObserver) this.intersectionObserver.disconnect();
        if (this.mutationObserver) this.mutationObserver.disconnect();
        if (this.mutationDebounceTimerId) {
            clearTimeout(this.mutationDebounceTimerId);
        }
        if (this.idleCallbackId) {
            cancelIdleCallback(this.idleCallbackId);
            this.idleCallbackId = null;
        }
        if (this.initialScanIdleCallbackId) {
            cancelIdleCallback(this.initialScanIdleCallbackId);
            this.initialScanIdleCallbackId = null;
        }
        this.initialScanQueue = [];
        this.initialScanInProgress = false;
        this.#stopScrollObserver();
        for (const callbackId of this.translationIdleCallbackIds) {
            cancelIdleCallback(callbackId);
        }
        this.translationIdleCallbackIds.clear();
        this.observedElements.clear();
        this.intersectionObserver = null;
        this.mutationObserver = null;
    }

    #stopScrollObserver() {
        window.removeEventListener('scroll', this.boundHandleScrollActivity);
        window.removeEventListener('wheel', this.boundHandleScrollActivity);
        window.removeEventListener('touchmove', this.boundHandleScrollActivity);
        if (this.scrollIdleTimerId) {
            clearTimeout(this.scrollIdleTimerId);
            this.scrollIdleTimerId = null;
        }
        this.isScrolling = false;
        this.emitProgress();
    }

    #clearPendingScrollTranslations() {
        this.pendingScrollTranslationElements.clear();
        if (this.scrollIdleTimerId) {
            clearTimeout(this.scrollIdleTimerId);
            this.scrollIdleTimerId = null;
        }
        this.isScrolling = false;
        this.emitProgress();
    }

    #isScrollIdleTranslationEnabled() {
        return this.settings?.translateAfterScrollIdle !== false;
    }

    #getScrollIdleDelay() {
        const delay = Number(this.settings?.scrollIdleDelayMs);
        return Number.isFinite(delay) && delay >= 0 ? delay : 300;
    }

    #handleScrollActivity() {
        if (!this.#isScrollIdleTranslationEnabled()) {
            return;
        }

        this.isScrolling = true;
        this.emitProgress();
        if (this.scrollIdleTimerId) {
            clearTimeout(this.scrollIdleTimerId);
        }
        this.scrollIdleTimerId = setTimeout(() => {
            this.scrollIdleTimerId = null;
            this.isScrolling = false;
            const hadPendingTranslations = this.#flushPendingScrollTranslations();
            if (!hadPendingTranslations) {
                this.checkCompletion();
            }
            this.emitProgress();
        }, this.#getScrollIdleDelay());
    }

    #requestTranslationIdleCallback(callback, timeout = 1000) {
        let callbackId = null;
        let callbackRanSynchronously = false;

        const wrappedCallback = () => {
            callbackRanSynchronously = true;
            if (callbackId !== null) {
                this.translationIdleCallbackIds.delete(callbackId);
            }
            callback();
        };

        callbackId = requestIdleCallback(wrappedCallback, { timeout });
        if (!callbackRanSynchronously) {
            this.translationIdleCallbackIds.add(callbackId);
        }
    }

    #isElementInViewport(element) {
        if (!element || !element.isConnected || typeof element.getBoundingClientRect !== 'function') {
            return false;
        }

        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        return rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < viewportHeight &&
            rect.left < viewportWidth;
    }

    #getViewportDistance(element) {
        if (!element || typeof element.getBoundingClientRect !== 'function') {
            return Number.POSITIVE_INFINITY;
        }

        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        if (rect.bottom >= 0 && rect.top <= viewportHeight) {
            return 0;
        }
        if (rect.bottom < 0) {
            return Math.abs(rect.bottom);
        }
        return rect.top - viewportHeight;
    }

    #getInitialScanRoots() {
        const roots = Array.from(document.body.children)
            .filter(element => !this.#isExtensionElement(element));
        return roots.length > 0 ? roots : [document.body];
    }

    #isExtensionElement(node) {
        return Boolean(node?.closest?.([
            '[data-translation-id]',
            '.foxlate-panel',
            '.foxlate-enhanced-panel',
            '.foxlate-summary-dialog',
            '.foxlate-summary-button',
            '.foxlate-summary-button-tooltip',
            '.foxlate-performance-hud',
        ].join(',')));
    }

    #startInitialScan() {
        this.initialScanQueue = this.#getInitialScanRoots()
            .sort((a, b) => this.#getViewportDistance(a) - this.#getViewportDistance(b));
        this.initialScanObservedCount = 0;
        this.initialScanInProgress = true;

        if (this.initialScanQueue.length === 0) {
            this.#finishInitialScan();
            return;
        }

        this.#scheduleInitialScan();
    }

    #scheduleInitialScan() {
        if (this.initialScanIdleCallbackId !== null) return;

        let callbackId = null;
        let callbackRanSynchronously = false;
        const wrappedCallback = (deadline) => {
            callbackRanSynchronously = true;
            if (callbackId !== null) {
                this.initialScanIdleCallbackId = null;
            }
            this.#processInitialScan(deadline);
        };

        callbackId = requestIdleCallback(wrappedCallback, { timeout: 1000 });
        if (!callbackRanSynchronously) {
            this.initialScanIdleCallbackId = callbackId;
        }
    }

    #processInitialScan(deadline = { didTimeout: true, timeRemaining: () => 0 }) {
        if (this.state === 'idle' || this.state === 'reverting') {
            return;
        }

        this.initialScanIdleCallbackId = null;
        let processedChunks = 0;
        const hasIdleTime = () => {
            if (deadline.didTimeout) return true;
            if (typeof deadline.timeRemaining !== 'function') return processedChunks === 0;
            return deadline.timeRemaining() > 4;
        };

        while (
            this.initialScanQueue.length > 0 &&
            processedChunks < this.INITIAL_SCAN_CHUNK_SIZE &&
            (processedChunks === 0 || hasIdleTime())
        ) {
            const root = this.initialScanQueue.shift();
            const searchRoots = this.findAllSearchRoots(root, { cssFilePath: this.cssFilePath });
            const elementsToObserve = this.findTranslatableElements(this.settings, searchRoots);

            if (elementsToObserve.length > 0) {
                this.initialScanObservedCount += this.#observeElements(elementsToObserve);
                this.state = 'translating';
                this.emitProgress();
            }
            processedChunks++;
        }

        if (this.initialScanQueue.length > 0) {
            this.#scheduleInitialScan();
            return;
        }

        this.#finishInitialScan();
    }

    #finishInitialScan() {
        this.initialScanInProgress = false;
        this.emitProgress();

        if (this.initialScanObservedCount > 0) {
            if (this.state === 'starting') {
                this.state = 'translating';
            }
            return;
        }

        this.state = 'translated';
        this.browser.runtime.sendMessage({
            type: MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE,
            payload: { status: 'translated', tabId: this.tabId }
        }).catch(e => this.logError('initial scan (sending translated status)', e));
    }

    #queueOrTranslateIntersectingElements(elements) {
        if (this.#isScrollIdleTranslationEnabled() && this.isScrolling) {
            elements.forEach(element => {
                if (!element.dataset.translationId) {
                    this.pendingScrollTranslationElements.add(element);
                }
            });
            this.emitProgress();
            return;
        }

        this.#scheduleTranslations(elements);
    }

    #scheduleTranslations(elements) {
        this.#requestTranslationIdleCallback(() => {
            if (this.state === 'idle' || this.state === 'reverting') {
                return;
            }

            if (this.#isScrollIdleTranslationEnabled() && this.isScrolling) {
                elements.forEach(element => {
                    if (!element.dataset.translationId) {
                        this.pendingScrollTranslationElements.add(element);
                    }
                });
                this.emitProgress();
                return;
            }

            elements.forEach(element => {
                if (!element.dataset.translationId) {
                    this.translateElement(element, this.settings);
                }
            });
        }, 1000);
    }

    #flushPendingScrollTranslations() {
        if (this.pendingScrollTranslationElements.size === 0) {
            return false;
        }

        const elements = Array.from(this.pendingScrollTranslationElements);
        this.pendingScrollTranslationElements.clear();
        const visibleElements = [];
        const deferredElements = [];

        for (const element of elements) {
            if (element.dataset.translationId) {
                continue;
            }
            if (this.#isElementInViewport(element)) {
                visibleElements.push(element);
            } else {
                deferredElements.push(element);
            }
        }

        this.#observeElements(deferredElements);
        if (visibleElements.length > 0) {
            this.#scheduleTranslations(visibleElements);
        }
        this.emitProgress();
        return true;
    }

    #observeElements(elements) {
        if (!this.intersectionObserver) return 0;
        let observedCount = 0;
        for (const element of elements) {
            if (element.dataset.translationId || this.observedElements.has(element)) {
                continue;
            }
            this.observedElements.add(element);
            this.intersectionObserver.observe(element);
            observedCount++;
        }
        if (observedCount > 0) {
            this.emitProgress();
        }
        return observedCount;
    }

    #handleIntersection(entries) {
        const intersectingElements = [];
        for (const entry of entries) {
            if (entry.isIntersecting) {
                intersectingElements.push(entry.target);
                this.intersectionObserver.unobserve(entry.target);
                this.observedElements.delete(entry.target);
            }
        }

        if (intersectingElements.length === 0) return;

        this.#queueOrTranslateIntersectingElements(intersectingElements);
    }

    #handleMutation(mutations) {
        let hasNewNodes = false;
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

                    if (this.#isExtensionElement(node)) continue;

                    if (node.dataset.foxlateGenerated === 'true') continue;

                    if (!this.domWalker.isPotentiallyVisible(node, getStyle)) {
                        continue;
                    }

                    this.mutationQueue.add(node);
                    hasNewNodes = true;
                }
            }
        }

        if (hasNewNodes) {
            if (this.idleCallbackId) {
                cancelIdleCallback(this.idleCallbackId);
                this.idleCallbackId = null;
            }
            clearTimeout(this.mutationDebounceTimerId);
            this.mutationDebounceTimerId = setTimeout(() => {
                this.idleCallbackId = requestIdleCallback(() => this.#processMutationQueue(), { timeout: 1000 });
            }, this.DEBOUNCE_DELAY);
            this.emitProgress();
        }
    }

    #processMutationQueue() {
        this.idleCallbackId = null;
        if (this.mutationQueue.size === 0) return;

        const newNodes = Array.from(this.mutationQueue);
        this.mutationQueue.clear();

        if (!this.settings) {
            return;
        }

        const allSearchRoots = new Set();

        for (const node of newNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const roots = this.findAllSearchRoots(node, { cssFilePath: this.cssFilePath });
                roots.forEach(root => allSearchRoots.add(root));
            }
        }

        const searchRootsArray = Array.from(allSearchRoots);

        const newElements = this.findTranslatableElements(this.settings, searchRootsArray);
        if (newElements.length > 0) {
            this.#observeElements(newElements);
        }
        this.emitProgress();
        this.checkCompletion();
    }
}
