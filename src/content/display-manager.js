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

        // (修改) 使用 .toggle 方法简化 CSS 类的添加和移除。
        // .toggle 方法更简洁，且避免了不必要的条件分支。
        if (element instanceof HTMLElement) {  // 仅对实际 DOM 节点操作
            element.classList.toggle('universal-translator-translated', newState === this.STATES.TRANSLATED);
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

    static revert(elementOrObject) {
        // 1. 从状态或元素中安全地获取显示模式
        const stateData = this.elementStates.get(elementOrObject);
        const displayMode = stateData?.strategy || elementOrObject?.dataset?.translationStrategy;

        // 2. 获取并调用策略的还原方法
        const strategy = this.getStrategy(displayMode);
        if (strategy && strategy.revert) {
            strategy.revert(elementOrObject, this); // 策略负责清理其自身添加的UI
        }

        // 3. DisplayManager 负责清理其自身的通用标记和状态
        // 这种检查是合理的，因为 DisplayManager 确实需要区分它管理的两种目标
        if (elementOrObject instanceof HTMLElement) {
            elementOrObject.classList.remove('universal-translator-translated');
            // 在此处集中清理与框架相关的 dataset 属性
            if (elementOrObject.dataset) {
                delete elementOrObject.dataset.translationId;
                delete elementOrObject.dataset.translationStrategy;
            }
        }

        this.elementStates.delete(elementOrObject);

        // 4. 如果是临时目标，则从活动映射中移除
        if (this.activeEphemeralTargets.has(displayMode) && this.activeEphemeralTargets.get(displayMode) === elementOrObject) {
            this.activeEphemeralTargets.delete(displayMode);
        }

        // (新) 如果元素是由脚本生成的包裹器，则用其内容替换它（“解包”）。
        // 这比手动移动子节点更简洁、更高效。
        if (elementOrObject.dataset?.foxlateGenerated === 'true' && elementOrObject.parentNode) {
            // 使用 `replaceWith` 将包裹元素替换为其所有子节点。
            elementOrObject.replaceWith(...elementOrObject.childNodes);
        }
    }

    static getStrategy(displayMode) {
        return this._strategies[displayMode];
    }

    static updateDisplayMode(newDisplayMode) {
        const translatedElements = document.querySelectorAll('.universal-translator-translated');

        for (const element of translatedElements) {
            const oldDisplayMode = element.dataset.translationStrategy;
            const oldStrategy = this.getStrategy(oldDisplayMode);

            // 只调用策略的还原方法，而不触及 DisplayManager 的状态。
            // 这会清理旧的UI，但保留元素为“已翻译”状态。
            if (oldStrategy && oldStrategy.revert) {
                oldStrategy.revert(element, this);
            }

            // 更新 dataset 和状态中的策略
            element.dataset.translationStrategy = newDisplayMode;
            const currentState = this.elementStates.get(element) || {};
            this.elementStates.set(element, { ...currentState, strategy: newDisplayMode });

            // 使用新策略重新应用“已翻译”状态的UI
            this.updateElementUI(element, this.STATES.TRANSLATED);
        }
    }

    static displayLoading(element, displayMode, initialState = {}) {
        if (!displayMode) {
            console.error("[DisplayManager] displayLoading requires a displayMode.", element);
            return;
        }
        // 在状态机生命周期的开始，将策略存储在元素上。
        element.dataset.translationStrategy = displayMode;
        // 将所有初始状态（如 originalContent 和 translationUnit）存储起来。
        const loadingState = { ...initialState, strategy: displayMode };
        this.setElementState(element, this.STATES.LOADING, loadingState);
    }

    static displayTranslation(element, { translatedText, plainText = null }) {
        // 验证输入。
        if (typeof translatedText !== 'string') {
            const errorMessage = `Invalid translatedText type: expected string, got ${typeof translatedText}. This indicates a bug in the translation pipeline.`;
            console.error(`[DisplayManager] ${errorMessage}`, { element, receivedValue: translatedText });
            this.displayError(element, errorMessage);
            return;
        }

        // 如果未提供 plainText，则从带标签的文本中派生它作为后备。
        // 这确保了所有策略都能安全地访问到一个纯净的文本版本。
        const derivedPlainText = plainText ?? translatedText.replace(/<(\/)?t\d+>/g, '');
        // 将翻译结果与已有的状态（包含 originalContent 和 translationUnit）合并。
        // 策略将从状态管理器中获取这些数据以更新UI。
        this.setElementState(element, this.STATES.TRANSLATED, { translatedText, plainText: derivedPlainText });
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
