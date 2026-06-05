import { BaseComponent } from './BaseComponent.js';

export class ConfirmModal extends BaseComponent {
    #elements;

    constructor(elements) {
        super();
        this.#elements = elements;
        this.#bindEvents();
    }

    open(title, message) {
        return new Promise((resolve) => {
            this.#elements.confirmModalTitle.textContent = title;
            this.#elements.confirmModalMessage.textContent = message;
            
            const confirmHandler = () => {
                this.off('confirm', confirmHandler);
                this.off('cancel', cancelHandler);
                resolve(true);
                this.close();
            };

            const cancelHandler = () => {
                this.off('confirm', confirmHandler);
                this.off('cancel', cancelHandler);
                resolve(false);
                this.close();
            };

            this.on('confirm', confirmHandler);
            this.on('cancel', cancelHandler);

            this._openModalSurface(this.#elements.confirmModal);
        });
    }

    close() {
        this._closeModalSurface(this.#elements.confirmModal);
    }

    #bindEvents() {
        // Use document-level delegation or bind to modal container if possible,
        // but here we bind to specific elements. Ensure IDs are stable.
        const bindClick = (el, handler) => {
            if(el) el.addEventListener('click', handler);
        };

        bindClick(this.#elements.confirmModalConfirmBtn, () => this.emit('confirm'));
        bindClick(this.#elements.confirmModalCancelBtn, () => this.emit('cancel'));
    }

    /**
     * 处理 ESC 键按下事件
     * @protected
     */
    _handleEscKey() {
        this.emit('cancel');
    }
}
