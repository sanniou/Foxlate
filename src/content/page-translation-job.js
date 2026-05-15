import browser from '../lib/browser-polyfill.js';
import { DisplayManager } from './display-manager.js';
import { DOMWalker } from './dom-walker.js';
import { findAllSearchRoots, findTranslatableElements } from './translatable-elements.js';

function defaultLogError(context, error) {
    if (error && error.name === 'AbortError') {
        console.log(`[Foxlate] Task was interrupted in ${context}:`, error.message);
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
        this.translateElement = translateElement;

        this.mutationQueue = new Set();
        this.idleCallbackId = null;
        this.mutationDebounceTimerId = null;
        this.DEBOUNCE_DELAY = 300;
        this.intersectionObserver = null;
        this.mutationObserver = null;
        this.pendingScrollTranslationElements = new Set();
        this.translationIdleCallbackIds = new Set();
        this.scrollIdleTimerId = null;
        this.isScrolling = false;
        this.scrollListenerOptions = { passive: true };
        this.boundHandleScrollActivity = this.#handleScrollActivity.bind(this);
        this.activeTranslations = 0;

        this.state = 'idle';
    }

    async start() {
        if (this.state !== 'idle') {
            console.warn(`[Foxlate] Job is not idle (state: ${this.state}). Ignoring start request.`);
            return;
        }

        console.log("[Foxlate] Starting page translation process...");
        this.state = 'starting';

        this.browser.runtime.sendMessage({
            type: 'TRANSLATION_STATUS_UPDATE',
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

        requestIdleCallback(() => {
            const allSearchRoots = this.findAllSearchRoots(document.body, { cssFilePath: this.cssFilePath });
            const elementsToObserve = this.findTranslatableElements(this.settings, allSearchRoots);

            console.log(`[Foxlate] Found ${elementsToObserve.length} initial elements to observe across ${allSearchRoots.length} roots.`);
            if (elementsToObserve.length > 0) {
                this.#observeElements(elementsToObserve);
                this.state = 'translating';
            } else {
                console.warn("[Foxlate] No translatable elements found to observe initially.");
                this.state = 'translated';
                this.browser.runtime.sendMessage({
                    type: 'TRANSLATION_STATUS_UPDATE',
                    payload: { status: 'translated', tabId: this.tabId }
                }).catch(e => this.logError('start (sending translated status)', e));
            }
        }, { timeout: 2000 });
    }

    async revert() {
        if (this.state === 'reverting' || this.state === 'idle') {
            console.warn(`[Foxlate] Job is already reverting or idle (state: ${this.state}). Ignoring revert request.`);
            return;
        }
        try {
            await this.browser.runtime.sendMessage({ type: 'STOP_TRANSLATION', payload: { tabId: this.tabId } });
        } catch (e) {
            this.logError('revert (sending STOP_TRANSLATION)', e);
        }

        try {
            await this.browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
                payload: { status: 'original', tabId: this.tabId }
            });
        } catch (e) {
            this.logError('revert (sending original status)', e);
        }

        console.log("[Foxlate] Reverting entire page translation...");
        this.state = 'reverting';

        this.#stopObservers();
        this.activeTranslations = 0;
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
            console.log(`[Foxlate] Reverted ${revertedCount} translated elements.`);

            const leftoverWrappers = document.body.querySelectorAll('foxlate-wrapper[data-foxlate-generated="true"]');
            if (leftoverWrappers.length > 0) {
                console.log(`[Foxlate] Cleaning up ${leftoverWrappers.length} leftover generated wrappers.`);
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
            this.activeTranslations === 0 &&
            this.mutationQueue.size === 0 &&
            this.pendingScrollTranslationElements.size === 0 &&
            !this.isScrolling
        ) {
            this.state = 'translated';
            console.log(`[Foxlate] Page translation completed.`);
            this.browser.runtime.sendMessage({
                type: 'TRANSLATION_STATUS_UPDATE',
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
        console.log("[Foxlate] Mutation observer started.");
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
        }
        this.#stopScrollObserver();
        for (const callbackId of this.translationIdleCallbackIds) {
            cancelIdleCallback(callbackId);
        }
        this.translationIdleCallbackIds.clear();
        this.intersectionObserver = null;
        this.mutationObserver = null;
        console.log("[Foxlate] Observers stopped.");
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
    }

    #clearPendingScrollTranslations() {
        this.pendingScrollTranslationElements.clear();
        if (this.scrollIdleTimerId) {
            clearTimeout(this.scrollIdleTimerId);
            this.scrollIdleTimerId = null;
        }
        this.isScrolling = false;
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

    #queueOrTranslateIntersectingElements(elements) {
        if (this.#isScrollIdleTranslationEnabled() && this.isScrolling) {
            elements.forEach(element => {
                if (!element.dataset.translationId) {
                    this.pendingScrollTranslationElements.add(element);
                }
            });
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
        return true;
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
        const intersectingElements = [];
        for (const entry of entries) {
            if (entry.isIntersecting) {
                intersectingElements.push(entry.target);
                this.intersectionObserver.unobserve(entry.target);
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

                    if (node.closest('[data-translation-id], .foxlate-panel, .foxlate-summary-dialog, .foxlate-summary-button')) continue;

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
            console.log(`[Foxlate] Found ${newElements.length} new dynamic elements to observe.`);
            this.#observeElements(newElements);
        }
        this.checkCompletion();
    }
}
