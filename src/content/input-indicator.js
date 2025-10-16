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

        const rect = targetElement.getBoundingClientRect();
        // 定位在输入框右侧外部，垂直居中
        const top = window.scrollY + rect.top + rect.height / 2 - 8; // 16px / 2
        const left = window.scrollX + rect.right + 5; // 右侧 5px 间距

        this.#indicatorEl.style.top = `${top}px`;
        this.#indicatorEl.style.left = `${left}px`;
        this.#indicatorEl.style.display = 'flex';
    }

    hide() {
        if (this.#indicatorEl) {
            this.#indicatorEl.style.display = 'none';
        }
    }
}