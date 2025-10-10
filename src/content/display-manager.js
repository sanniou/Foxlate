import * as Constants from '../common/constants.js';
import replaceStrategy from './strategies/replace-strategy.js';
import appendStrategy from './strategies/append-strategy.js';
import enhancedContextMenuStrategy from './strategies/enhanced-context-menu-strategy.js';
import hoverStrategy from './strategies/hover-strategy.js';


export class DisplayManager {

    static STATES = Constants.DISPLAY_MANAGER_STATES;

    static _strategies = {
        replace: replaceStrategy,
        append: appendStrategy,
        enhancedContextMenu: enhancedContextMenuStrategy,
        hover: hoverStrategy,
    };

    // 使用 WeakMap 来存储元素状态。
    // WeakMap 对键（DOM 元素）使用弱引用，当元素从 DOM 中被移除且没有其他引用时，
    // 垃圾回收器可以自动清理它，从而防止在动态页面上发生内存泄漏。
    static elementStates = new WeakMap();

    static elementRegistry = new Map();

    // 跟踪临时的、非 DOM 绑定的翻译任务，例如右键菜单。
    static activeEphemeralTargets = new Map();

    static getElementState(element) {
        // 只返回状态字符串，如 "TRANSLATED"
        return (this.elementStates.get(element) || {}).state || this.STATES.ORIGINAL;
    }

    static getElementData(element) {
        return this.elementStates.get(element);
    }

    static setElementState(element, newState, data = null) {
        const currentState = this.elementStates.get(element) || {};
        const newData = data ? { ...currentState, ...data, state: newState } : { ...currentState, state: newState };
        this.elementStates.set(element, newData);
 
        if (element instanceof HTMLElement) {
            element.dataset.foxlateState = newState.toLowerCase();
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
        // (优化) 在 dataset 被清理前，提前获取 elementId。
        // 这是修复内存泄漏的关键，确保我们总能从 elementRegistry 中移除条目。
        const elementId = (elementOrObject instanceof HTMLElement) ? elementOrObject.dataset?.translationId : null;

        // 2. 获取并调用策略的还原方法
        const strategy = this.getStrategy(displayMode);
        if (strategy && strategy.revert) {
            strategy.revert(elementOrObject, this); // 策略负责清理其自身添加的UI
        }

        // 3. DisplayManager 负责清理其自身的通用标记和状态
        // 这种检查是合理的，因为 DisplayManager 确实需要区分它管理的两种目标
        if (elementOrObject instanceof HTMLElement && elementOrObject.dataset) {
            // 在此处集中清理与框架相关的 dataset 属性
            delete elementOrObject.dataset.translationId;
            delete elementOrObject.dataset.translationStrategy;
            // (新) 清理状态标记
            delete elementOrObject.dataset.foxlateState;
        }

        this.elementStates.delete(elementOrObject);

        // 4. 如果是临时目标，则从活动映射中移除
        if (this.activeEphemeralTargets.has(displayMode) && this.activeEphemeralTargets.get(displayMode) === elementOrObject) {
            this.activeEphemeralTargets.delete(displayMode);
        }

        // (优化) 在方法结束前，使用之前获取的 elementId 清理注册表
        if (elementId) {
            this.elementRegistry.delete(elementId);
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
        // 不再使用 querySelectorAll，而是遍历我们的注册表
        for (const [elementId, weakRef] of this.elementRegistry.entries()) {
            const element = weakRef.deref();

            // 如果元素不存在了（已被GC），或者不是一个“已翻译”状态的元素，则跳过
            if (!element || this.getElementState(element) !== this.STATES.TRANSLATED) {
                console.log(`[Foxlate] Element ${elementId} is not a translated element. Skipping. state: ${this.getElementState(element)}`)
                continue;
            }
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

    static registerElement(elementId, element) {
        // 我们存储的是一个对元素的弱引用
        this.elementRegistry.set(elementId, new WeakRef(element));
    }

    static findElementById(elementId) {
        const weakRef = this.elementRegistry.get(elementId);
        if (weakRef) {
            // .deref() 方法可以获取到被引用的对象
            // 如果对象已被垃圾回收，则返回 undefined
            return weakRef.deref();
        }
        return undefined;
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
     * @param {number} frameId - 当前框架的ID。
     */
    static handleEphemeralTranslation(payload, frameId) {
        const { isLoading, success, translatedText, error, coords, source, originalText, displayMode = 'enhancedContextMenu' } = payload;
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
                    originalText: originalText || '', // 保存原始文本
                },
                frameId: frameId // 存储框架ID
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
