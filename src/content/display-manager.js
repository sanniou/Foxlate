import * as Constants from '../common/constants.js';
import replaceStrategy from './strategies/replace-strategy.js';
import appendStrategy from './strategies/append-strategy.js';
import contextMenuStrategy from './strategies/context-menu-strategy.js';
import hoverStrategy from './strategies/hover-strategy.js';


export class DisplayManager {

    static STATES = Constants.DISPLAY_MANAGER_STATES;

    static _strategies = {
        replace: replaceStrategy,
        append: appendStrategy,
        contextMenu: contextMenuStrategy,
        hover: hoverStrategy,
    };

    // 使用 WeakMap 来存储元素状态。
    // WeakMap 对键（DOM 元素）使用弱引用，当元素从 DOM 中被移除且没有其他引用时，
    // 垃圾回收器可以自动清理它，从而防止在动态页面上发生内存泄漏。
    static elementStates = new WeakMap();

    /**
     * @private
     * Escapes a string for safe insertion into HTML.
     * @param {string} unsafe - The string to escape.
     * @returns {string} The escaped string.
     */
    static #escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    // 跟踪临时的、非 DOM 绑定的翻译任务，例如右键菜单。
    static activeEphemeralTargets = new Map();

    static getElementState(element) {
        return this.elementStates.get(element) || this.STATES.ORIGINAL;
    }

    static getElementData(element) {
        return this.elementStates.get(element);
    }

    static setElementState(element, newState, data = null) {
        const currentState = this.elementStates.get(element) || {};
        const newData = data ? { ...currentState, ...data, state: newState } : { ...currentState, state: newState };
        this.elementStates.set(element, newData);
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
            strategy.updateUI(element, state, this); // 将 DisplayManager 实例传递给策略
        } else {
            console.error(`[DisplayManager] Strategy "${displayMode}" not found or does not have an updateUI method.`);
        }
    }

    static revert(element) {
        const displayMode = element.dataset.translationStrategy;
        const strategy = this.getStrategy(displayMode); // This will be undefined if displayMode is missing

        if (strategy && strategy.revertTranslation) {
            strategy.revertTranslation(element, this); // 将 DisplayManager 实例传递给策略
        }

        // Always perform cleanup, regardless of strategy success
        if (element instanceof HTMLElement) {
            element.classList.remove('universal-translator-translated');
        }
        this.elementStates.delete(element);

        // If this was an ephemeral target, also remove it from the active map
        // to ensure immediate cleanup and prevent potential memory leaks.
        if (this.activeEphemeralTargets.has(displayMode) && this.activeEphemeralTargets.get(displayMode) === element) {
            this.activeEphemeralTargets.delete(displayMode);
        }
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

    static displayLoading(element, displayMode, originalContent = null) {
        if (!displayMode) {
            console.error("[DisplayManager] displayLoading requires a displayMode.", element);
            return;
        }
        // 在状态机生命周期的开始，将策略存储在元素上。
        element.dataset.translationStrategy = displayMode;

        const data = originalContent ? { originalContent } : null;
        this.setElementState(element, this.STATES.LOADING, data);
    }

    static displayTranslation(element, { translatedText, translationUnit = null }) {
        // 验证输入。
        if (typeof translatedText !== 'string') {
            const errorMessage = `Invalid translatedText type: expected string, got ${typeof translatedText}. This indicates a bug in the translation pipeline.`;
            console.error(`[DisplayManager] ${errorMessage}`, { element, receivedValue: translatedText });
            this.displayError(element, errorMessage);
            return;
        }

        // 如果提供了翻译单元，则进行验证。
        if (translationUnit) {
            // 基本的健全性检查。具体的策略（如 replace-strategy）负责验证其所需的数据结构（如 nodeMap）。
            if (typeof translationUnit !== 'object' || translationUnit === null) {
                const errorMessage = `Invalid translationUnit provided. It must be an object.`;
                console.error(`[DisplayManager] ${errorMessage}`, { element, receivedValue: translationUnit });
                this.displayError(element, errorMessage);
                return;
            }
        }

        // 将翻译单元和翻译结果存储在状态中，并更新元素状态。
        // 策略将从状态管理器中获取这些数据以更新UI。
        this.setElementState(element, this.STATES.TRANSLATED, { translationUnit, translatedText });
    }

    static displayError(element, errorMessage) {
        this.setElementState(element, this.STATES.ERROR, { errorMessage });
    }

    /**
     * Triggers a global cleanup for all strategies.
     * This is used to hide any non-element-bound UI (like floating panels)
     * during a full page revert, ensuring no UI elements are left behind.
     */
    static hideAllEphemeralUI() {
        // Iterate through all known strategies and call their global cleanup method if it exists.
        // This is a clean, decoupled way to handle global state resets. We pass the DisplayManager
        // class itself to the cleanup method to avoid global dependencies in the strategy.
        for (const strategy of Object.values(this._strategies)) {
            strategy?.globalCleanup?.(this);
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
                this.displayTranslation(target, { translatedText });
            } else if (error) {
                this.displayError(target, error);
            }
        }
    }
};
