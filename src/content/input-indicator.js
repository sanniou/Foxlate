import { floatingLayoutService } from './layout/floating-layout-service.js';

/**
 * 管理输入框翻译时的加载指示器。
 */
export class InputIndicator {
    #indicatorEl = null;

    constructor() {
        this.#createIndicatorElement();
    }

    #createIndicatorElement() {
        if (document.getElementById('foxlate-input-indicator')) return;

        this.#indicatorEl = document.createElement('div');
        this.#indicatorEl.id = 'foxlate-input-indicator';
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
        if (document.getElementById('foxlate-input-indicator-styles')) return;

        const style = document.createElement('style');
        style.id = 'foxlate-input-indicator-styles';
        style.textContent = `
            #foxlate-input-indicator {
                position: absolute;
                z-index: 2147483647;
                pointer-events: none;
                /* 默认使用 flex 居中 spinner */
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #foxlate-input-indicator .foxlate-spinner {
                /* 覆盖全局 spinner 的尺寸，使其更小 */
                width: 16px;
                height: 16px;
                border-width: 2px;
            }
        `;
        document.head.appendChild(style);
    }

    show(targetElement) {
        if (!this.#indicatorEl) this.#createIndicatorElement();

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
