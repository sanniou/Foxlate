import replaceStrategy from '../strategies/replace-strategy.js';
import appendStrategy from '../strategies/append-strategy.js';
import enhancedContextMenuStrategy from '../strategies/enhanced-context-menu-strategy.js';
import hoverStrategy from '../strategies/hover-strategy.js';

export class DisplayStrategyRegistry {
    constructor(strategies = {}) {
        this.strategies = {
            replace: replaceStrategy,
            append: appendStrategy,
            enhancedContextMenu: enhancedContextMenuStrategy,
            hover: hoverStrategy,
            ...strategies,
        };
    }

    get(displayMode) {
        return this.strategies[displayMode];
    }

    values() {
        return Object.values(this.strategies);
    }

    hasUpdate(displayMode) {
        return typeof this.get(displayMode)?.updateUI === 'function';
    }

    update({ displayMode, target, state, manager, options = {} }) {
        const strategy = this.get(displayMode);
        if (!strategy?.updateUI) {
            return false;
        }
        strategy.updateUI(target, state, manager, options);
        return true;
    }

    revert(displayMode, target, manager) {
        const strategy = this.get(displayMode);
        strategy?.revert?.(target, manager);
    }

    globalCleanup(manager) {
        for (const strategy of this.values()) {
            strategy?.globalCleanup?.(manager);
        }
    }
}

export const defaultDisplayStrategyRegistry = new DisplayStrategyRegistry();
