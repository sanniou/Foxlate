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

            this.#openModal(this.#elements.confirmModal);
        });
    }

    close() {
        this.#closeModal(this.#elements.confirmModal);
    }

    #bindEvents() {
        this.#elements.confirmModalConfirmBtn.addEventListener('click', () => {
            this.emit('confirm');
        });

        this.#elements.confirmModalCancelBtn.addEventListener('click', () => {
            this.emit('cancel');
        });
        
        this.#elements.closeConfirmModalBtn.addEventListener('click', () => {
            this.emit('cancel');
        });
    }

    #openModal(modalElement) {
        document.body.classList.add('modal-open');
        modalElement.style.display = 'flex';
        modalElement.offsetWidth; // Trigger reflow
        modalElement.classList.add('is-visible');
    }

    #closeModal(modalElement) {
        if (!modalElement.classList.contains('is-visible')) return;

        modalElement.classList.remove('is-visible');
        const onTransitionEnd = () => {
            modalElement.style.display = 'none';
            modalElement.removeEventListener('transitionend', onTransitionEnd);
            if (document.querySelectorAll('.modal.is-visible').length === 0) {
                document.body.classList.remove('modal-open');
            }
        };
        modalElement.addEventListener('transitionend', onTransitionEnd);
    }
}
