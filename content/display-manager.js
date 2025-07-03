window.DisplayManager = class DisplayManager {
    static STATES = {
        ORIGINAL: 'original',
        LOADING: 'loading',
        TRANSLATED: 'translated',
        ERROR: 'error',
    };

    static _strategies = {
        replace: window.replaceStrategy,
        append: window.appendTranslationStrategy,
        contextMenu: window.contextMenuStrategy,
        hover: window.hoverStrategy,
    };

    static elementStates = new Map(); // 存储元素状态

    // 跟踪临时的、非 DOM 绑定的翻译任务，例如右键菜单。
    static activeEphemeralTargets = new Map();

    static getElementState(element) {
        return this.elementStates.get(element) || this.STATES.ORIGINAL;
    }

    static setElementState(element, newState) {
        this.elementStates.set(element, newState);

        // Manage a common class for translated elements, only for real DOM nodes
        if (element instanceof HTMLElement) {
            if (newState === this.STATES.TRANSLATED) {
                element.classList.add('universal-translator-translated');
            } else {
                element.classList.remove('universal-translator-translated');
            }
        }

        // 根据新状态更新 UI
        this.updateElementUI(element, newState);
    }

    static updateElementUI(element, state) {
        const displayMode = element.dataset.translationStrategy;
        if (!displayMode) {
            console.error("[DisplayManager] Cannot update UI. Element is missing 'data-translation-strategy'.", element);
            return;
        }

        const strategy = this.getStrategy(displayMode);
        if (strategy && strategy.updateUI) {
            strategy.updateUI(element, state);
        } else {
            console.error(`[DisplayManager] Strategy "${displayMode}" not found or does not have an updateUI method.`);
        }
    }

    static revert(element) {
        const displayMode = element.dataset.translationStrategy;
        const strategy = this.getStrategy(displayMode); // This will be undefined if displayMode is missing

        if (strategy && strategy.revertTranslation) {
            strategy.revertTranslation(element);
        }

        // Always perform cleanup, regardless of strategy success
        if (element instanceof HTMLElement) {
            element.classList.remove('universal-translator-translated');
        }
        this.elementStates.delete(element);
    }

    static getStrategy(displayMode) {
        return this._strategies[displayMode];
    }

    static updateDisplayMode(newDisplayMode) {
        // Find all elements that are currently translated.
        const translatedElements = document.querySelectorAll('.universal-translator-translated');

        for (const element of translatedElements) {
            // Get the old strategy before we change the dataset attribute
            const oldDisplayMode = element.dataset.translationStrategy;
            const oldStrategy = this.getStrategy(oldDisplayMode);

            // Revert the UI changes made by the old strategy.
            // This should restore the element's content/structure to its pre-translation state.
            if (oldStrategy && oldStrategy.revertTranslation) {
                oldStrategy.revertTranslation(element);
            }

            // Now, set the new strategy for the element.
            element.dataset.translationStrategy = newDisplayMode;
            // Re-apply the UI for the 'TRANSLATED' state using the new strategy.
            // The element's state is still 'TRANSLATED', we're just changing how it's displayed.
            this.updateElementUI(element, this.STATES.TRANSLATED);
        }
    }

    static displayLoading(element, displayMode) {
        if (!displayMode) {
            console.error("[DisplayManager] displayLoading requires a displayMode.", element);
            return;
        }
        // 在状态机生命周期的开始，将策略存储在元素上。
        element.dataset.translationStrategy = displayMode;
        this.setElementState(element, this.STATES.LOADING);
    }

    static displayTranslation(element, translatedText) {
        element.dataset.translatedText = translatedText;
        this.setElementState(element, this.STATES.TRANSLATED);
    }

    static displayError(element, errorMessage) {
        element.dataset.errorMessage = errorMessage;
        this.setElementState(element, this.STATES.ERROR);
    }

    /**
     * Triggers a global cleanup for all strategies.
     * This is used to hide any non-element-bound UI (like floating panels)
     * during a full page revert, ensuring no UI elements are left behind.
     */
    static hideAllEphemeralUI() {
        // Iterate through all known strategies and call their global cleanup method if it exists.
        // This is a clean, decoupled way to handle global state resets.
        for (const strategy of Object.values(this._strategies)) {
            strategy?.globalCleanup?.();
        }
    }

    /**
     * 处理临时的、非 DOM 绑定的翻译生命周期（例如右键菜单）。
     * @param {object} payload - 从后台脚本接收的事件负载。
     */
    static handleEphemeralTranslation(payload) {
        const { isLoading, success, translatedText, error, coords, source } = payload;
        const displayMode = 'contextMenu';

        let target;
        if (isLoading) {
            if (this.activeEphemeralTargets.has(displayMode)) {
                this.revert(this.activeEphemeralTargets.get(displayMode));
            }

            target = {
                dataset: {
                    clientX: coords.clientX,
                    clientY: coords.clientY,
                    source: source,
                }
            };
            this.activeEphemeralTargets.set(displayMode, target);
            this.displayLoading(target, displayMode);
        } else {
            target = this.activeEphemeralTargets.get(displayMode);
            if (!target) return;

            if (success) {
                this.displayTranslation(target, translatedText);
            } else if (error) {
                this.displayError(target, error);
            }
        }
    }
};
