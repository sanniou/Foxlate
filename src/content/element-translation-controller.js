import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { shouldTranslate } from '../common/precheck.js';
import { DOMWalker } from './dom-walker.js';
import { DisplayManager } from './display-manager.js';
import { logContentError } from './content-logger.js';
import { TranslationBatchQueue } from './translation-batch-queue.js';

function defaultGenerateId() {
    return self.crypto.randomUUID();
}

export class ElementTranslationController {
    constructor({
        browserApi = browser,
        displayManager = DisplayManager,
        domWalker = DOMWalker,
        batchQueue,
        getCurrentPageJob = () => null,
        generateId = defaultGenerateId,
        logError = logContentError,
    } = {}) {
        this.browser = browserApi;
        this.displayManager = displayManager;
        this.domWalker = domWalker;
        this.batchQueue = batchQueue;
        this.getCurrentPageJob = getCurrentPageJob;
        this.generateId = generateId;
        this.logError = logError;
    }

    translateElement(element, effectiveSettings) {
        if (!element || !(element instanceof HTMLElement)) return;
        if (element.querySelector('[data-translation-id]')) {
            console.log(`[Foxlate] Element ${element.tagName} already contains translated content. Skipping.`);
            return;
        }

        const domWalkerResult = this.domWalker.create(element, effectiveSettings.translationSelector);
        if (!domWalkerResult) return;

        const { sourceText, plainText, translationUnit } = domWalkerResult;
        const { result: shouldTranslateResult } = shouldTranslate(plainText, effectiveSettings);
        if (!shouldTranslateResult) return;

        const currentPageJob = this.getCurrentPageJob();
        if (currentPageJob) {
            this.#ensureJobIsTranslating(currentPageJob);
            currentPageJob.recordTranslationStarted();
        }

        const elementId = `ut-${this.generateId()}`;
        element.dataset.translationId = elementId;

        this.displayManager.registerElement(elementId, element);
        this.displayManager.displayLoading(element, effectiveSettings.displayMode, {
            originalContent: element.innerHTML,
            translationUnit,
        });

        const translationRequest = {
            elementId,
            text: sourceText,
            targetLang: effectiveSettings.targetLanguage,
            sourceLang: 'auto',
            translatorEngine: effectiveSettings.translatorEngine,
        };

        if (TranslationBatchQueue.shouldUseBatchTranslation(translationRequest.translatorEngine)) {
            this.batchQueue.enqueue(translationRequest);
            return;
        }

        this.#sendSingleTranslation(translationRequest);
    }

    handleTranslationResult(payload) {
        const { elementId, success, translatedText, wasTranslated, error } = payload;
        const currentPageJob = this.getCurrentPageJob();
        if (!currentPageJob) return;

        currentPageJob.recordTranslationCompleted({ success: !!success && !!wasTranslated });

        const element = this.displayManager.findElementById(elementId);
        if (!element) {
            console.log(`[Foxlate] Element for translationId ${elementId} no longer exists. Skipping update.`);
            currentPageJob.checkCompletion();
            return;
        }

        if (success && wasTranslated) {
            const plainText = translatedText.replace(/<(\/)?t\d+>/g, '');
            this.displayManager.displayTranslation(element, { translatedText, plainText });
        } else {
            this.displayManager.displayError(
                element,
                error || 'An unknown error occurred during translation.'
            );
        }

        currentPageJob.checkCompletion();
    }

    #ensureJobIsTranslating(currentPageJob) {
        if (currentPageJob.state !== 'translated') return;

        currentPageJob.state = 'translating';
        this.browser.runtime.sendMessage({
            type: MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE,
            payload: { status: 'loading', tabId: currentPageJob.tabId },
        }).catch(error => this.logError('ElementTranslationController (sending loading status)', error));
    }

    #sendSingleTranslation({ elementId, text, targetLang, sourceLang, translatorEngine }) {
        this.browser.runtime.sendMessage({ type: MESSAGE_TYPES.GET_TAB_ID })
            .then(response => this.browser.runtime.sendMessage({
                type: MESSAGE_TYPES.TRANSLATE_TEXT,
                payload: {
                    text,
                    targetLang,
                    sourceLang,
                    elementId,
                    translatorEngine,
                    tabId: response?.tabId,
                },
            }))
            .catch(error => {
                this.logError('ElementTranslationController.sendSingleTranslation', error);
                const currentPageJob = this.getCurrentPageJob();
                if (currentPageJob) {
                    currentPageJob.recordTranslationCompleted({ success: false });
                    currentPageJob.checkCompletion();
                }
                const element = this.displayManager.findElementById(elementId);
                if (element) {
                    this.displayManager.displayError(element, error.message || 'Translation request failed.');
                }
            });
    }
}
