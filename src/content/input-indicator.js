import { floatingLayoutService } from './layout/floating-layout-service.js';

const INDICATOR_CLASS = 'foxlate-input-indicator';

/**
 * 管理输入框翻译时的加载指示器。
 */
export class InputIndicator {
    #indicatorEl = null;

    #createIndicatorElement() {
        const existing = document.querySelector(`.${INDICATOR_CLASS}[data-foxlate-owned="true"]`);
        if (existing) {
            // content script 可能被重新注入：只复用带本扩展类名的节点，
            // 不能按 id 抢用页面自己的同名元素。
            this.#indicatorEl = existing;
            this.#injectStyles();
            return;
        }

        this.#indicatorEl = document.createElement('div');
        this.#indicatorEl.className = INDICATOR_CLASS;
        // id 只用于调试和兼容旧样式；页面若已占用同名 id，不制造重复 id。
        if (!document.getElementById('foxlate-input-indicator')) {
            this.#indicatorEl.id = 'foxlate-input-indicator';
        }
        this.#indicatorEl.dataset.foxlateOwned = 'true';
        // 初始隐藏
        this.#indicatorEl.style.display = 'none';
        
        // 使用已有的 .foxlate-spinner 样式，保持一致性
        const spinner = document.createElement('div');
        spinner.className = 'foxlate-spinner';
        this.#indicatorEl.appendChild(spinner);

        document.body.appendChild(this.#indicatorEl);

        // 为指示器本身和微调后的 spinner 添加样式
        this.#injectStyles();
    }

    #injectStyles() {
        if (document.querySelector('style[data-foxlate-owned="input-indicator-styles"]')) return;

        const style = document.createElement('style');
        style.dataset.foxlateOwned = 'input-indicator-styles';
        // id 只用于调试；页面若已占用同名 id，不制造重复 id。
        if (!document.getElementById('foxlate-input-indicator-styles')) {
            style.id = 'foxlate-input-indicator-styles';
        }
        style.textContent = `
            .${INDICATOR_CLASS} {
                position: absolute;
                z-index: 2147483647;
                pointer-events: none;
                /* 默认使用 flex 居中 spinner */
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .${INDICATOR_CLASS} .foxlate-spinner {
                /* 覆盖全局 spinner 的尺寸，使其更小 */
                width: 16px;
                height: 16px;
                border-width: 2px;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    show(targetElement) {
        if (!this.#indicatorEl || !this.#indicatorEl.isConnected) {
            this.#createIndicatorElement();
        }

        const position = floatingLayoutService.placeAnchoredBox({
            anchorRect: targetElement.getBoundingClientRect(),
            boxWidth: 16,
            boxHeight: 16,
            margin: 4,
            gap: 5,
            preferredPlacements: ['right', 'left', 'bottom', 'top'],
        });

        this.#indicatorEl.style.top = `${window.scrollY + position.top}px`;
        this.#indicatorEl.style.left = `${window.scrollX + position.left}px`;
        this.#indicatorEl.dataset.foxlatePlacement = position.placement;
        this.#indicatorEl.style.display = 'flex';
    }

    hide() {
        if (this.#indicatorEl) {
            this.#indicatorEl.style.display = 'none';
        }
    }
}
