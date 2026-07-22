import * as Constants from '../common/constants.js';
import { resolveDisplayLanguageContext } from './display/display-language-context.js';
import { DisplayStateStore } from './display/display-state-store.js';
import { defaultDisplayStrategyRegistry } from './display/display-strategy-registry.js';


export class DisplayManager {

    static STATES = Constants.DISPLAY_MANAGER_STATES;

    static strategyRegistry = defaultDisplayStrategyRegistry;

    // 使用 WeakMap 来存储元素状态。
    // WeakMap 对键（DOM 元素）使用弱引用，当元素从 DOM 中被移除且没有其他引用时，
    // 垃圾回收器可以自动清理它，从而防止在动态页面上发生内存泄漏。
    static elementStates = new WeakMap();

    static elementRegistry = new Map();

    // 跟踪临时的、非 DOM 绑定的翻译任务，例如右键菜单。
    static activeEphemeralTargets = new Map();

    static stateStore = new DisplayStateStore({
        states: DisplayManager.STATES,
        elementStates: DisplayManager.elementStates,
        elementRegistry: DisplayManager.elementRegistry,
        activeEphemeralTargets: DisplayManager.activeEphemeralTargets,
    });

    static getElementState(element) {
        // 只返回状态字符串，如 "TRANSLATED"
        return this.stateStore.getState(element);
    }

    static getElementData(element) {
        return this.stateStore.getData(element);
    }

    static setElementState(element, newState, data = null) {
        this.stateStore.setState(element, newState, data);
        // Return the UI update promise so callers (and mode switches) can await paint.
        return this.updateElementUI(element, newState);
    }

    static async updateElementUI(element, state) {
        const displayMode = element.dataset.translationStrategy;
        if (!displayMode) {
            console.error("[DisplayManager] Cannot update UI. Element is missing 'data-translation-strategy'.", element);
            return;
        }

        let options = {};
        try {
            options = await resolveDisplayLanguageContext(displayMode);
        } catch (error) {
            console.error('[DisplayManager] Failed to resolve display language context.', error);
        }

        if (!this.strategyRegistry.update({ displayMode, target: element, state, manager: this, options })) {
            console.error(`[DisplayManager] Strategy "${displayMode}" not found or does not have an updateUI method.`);
        }
    }

    static revert(elementOrObject) {
        // 1. 从状态或元素中安全地获取显示模式
        const stateData = this.stateStore.getData(elementOrObject);
        const displayMode = stateData?.strategy || elementOrObject?.dataset?.translationStrategy;
        // (优化) 在 dataset 被清理前，提前获取 elementId。
        // 这是修复内存泄漏的关键，确保我们总能从 elementRegistry 中移除条目。
        const elementId = (elementOrObject instanceof HTMLElement) ? elementOrObject.dataset?.translationId : null;

        // 2. 获取并调用策略的还原方法
        this.strategyRegistry.revert(displayMode, elementOrObject, this);

        // 3. DisplayManager 负责清理其自身的通用标记和状态
        // 这种检查是合理的，因为 DisplayManager 确实需要区分它管理的两种目标
        if (elementOrObject instanceof HTMLElement && elementOrObject.dataset) {
            // 在此处集中清理与框架相关的 dataset 属性
            delete elementOrObject.dataset.translationId;
            delete elementOrObject.dataset.translationStrategy;
            // (新) 清理状态标记
            delete elementOrObject.dataset.foxlateState;
        }

        this.stateStore.deleteTarget(elementOrObject);

        // 4. 如果是临时目标，则从活动映射中移除
        this.stateStore.removeActiveEphemeral(displayMode, elementOrObject);

        // (优化) 在方法结束前，使用之前获取的 elementId 清理注册表
        if (elementId) {
            this.stateStore.removeElementId(elementId);
        }

        // (新) 如果元素是由脚本生成的包裹器，则用其内容替换它（“解包”）。
        // 这比手动移动子节点更简洁、更高效。
        if (elementOrObject.dataset?.foxlateGenerated === 'true' && elementOrObject.parentNode) {
            // 使用 `replaceWith` 将包裹元素替换为其所有子节点。
            elementOrObject.replaceWith(...elementOrObject.childNodes);
        }
    }

    static getStrategy(displayMode) {
        return this.strategyRegistry.get(displayMode);
    }

    static async updateDisplayMode(newDisplayMode) {
        if (!newDisplayMode || !this.strategyRegistry.get(newDisplayMode)) {
            console.warn(`[DisplayManager] updateDisplayMode ignored unknown mode: ${newDisplayMode}`);
            return;
        }

        const tasks = [];

        // Walk the registry of live translated elements (not querySelectorAll).
        for (const [elementId, weakRef] of this.stateStore.entries()) {
            const element = weakRef.deref();

            if (!element) {
                this.stateStore.removeElementId(elementId);
                continue;
            }

            const state = this.getElementState(element);
            // Only re-skin elements that already have a finished translation payload.
            if (state !== this.STATES.TRANSLATED && state !== this.STATES.ERROR) {
                continue;
            }

            const data = this.getElementData(element) || {};
            const oldDisplayMode = element.dataset.translationStrategy || data.strategy;
            if (oldDisplayMode === newDisplayMode) {
                continue;
            }

            // Strip previous strategy chrome without clearing DisplayManager state.
            this.strategyRegistry.revert(oldDisplayMode, element, this);

            // Defensive restore when leaving replace if revert left mixed DOM.
            if (
                element instanceof HTMLElement
                && typeof data.originalContent === 'string'
                && oldDisplayMode === 'replace'
                && element.innerHTML !== data.originalContent
            ) {
                element.innerHTML = data.originalContent;
            }

            element.dataset.translationStrategy = newDisplayMode;
            this.stateStore.patchData(element, { strategy: newDisplayMode });

            tasks.push(this.updateElementUI(element, state));
        }

        await Promise.all(tasks);
    }

    static registerElement(elementId, element) {
        // 我们存储的是一个对元素的弱引用
        this.stateStore.registerElement(elementId, element);
    }

    static findElementById(elementId) {
        return this.stateStore.findElementById(elementId);
    }

    static displayLoading(element, displayMode, initialState = {}) {
        if (!displayMode) {
            console.error("[DisplayManager] displayLoading requires a displayMode.", element);
            return Promise.resolve();
        }
        element.dataset.translationStrategy = displayMode;
        const loadingState = { ...initialState, strategy: displayMode };
        return this.setElementState(element, this.STATES.LOADING, loadingState);
    }

    static displayTranslation(element, { translatedText, plainText = null }) {
        if (typeof translatedText !== 'string') {
            const errorMessage = `Invalid translatedText type: expected string, got ${typeof translatedText}. This indicates a bug in the translation pipeline.`;
            console.error(`[DisplayManager] ${errorMessage}`, { element, receivedValue: translatedText });
            return this.displayError(element, errorMessage);
        }

        const derivedPlainText = plainText ?? translatedText.replace(/<(\/)?t\d+>/g, '');
        return this.setElementState(element, this.STATES.TRANSLATED, { translatedText, plainText: derivedPlainText });
    }

    static displayError(element, errorMessage) {
        return this.setElementState(element, this.STATES.ERROR, { errorMessage });
    }

    /**
     * Triggers a global cleanup for all strategies.
     * This is used to hide any non-element-bound UI (like floating panels)
     * during a full page revert, ensuring no UI elements are left behind.
     */
    static hideAllEphemeralUI() {
        this.strategyRegistry.globalCleanup(this);
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
            const activeTarget = this.stateStore.getActiveEphemeral(displayMode);
            if (activeTarget) {
                this.revert(activeTarget);
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
            this.stateStore.setActiveEphemeral(displayMode, target);
            this.displayLoading(target, displayMode);
        } else {
            target = this.stateStore.getActiveEphemeral(displayMode);
            if (!target) return;

            if (success) {
                this.displayTranslation(target, { translatedText });
            } else if (error) {
                this.displayError(target, error);
            }
        }
    }
};
