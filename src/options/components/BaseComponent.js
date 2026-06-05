/**
 * A base class for UI components that provides a simple event system.
 */
export class BaseComponent {
    #listeners = new Map();
    #escKeyHandler = null;

    constructor() {
        if (new.target === BaseComponent) {
            throw new TypeError("Cannot construct BaseComponent instances directly.");
        }
    }

    /**
     * Register an event listener.
     * @param {string} eventName - The name of the event.
     * @param {Function} callback - The callback function to execute.
     */
    on(eventName, callback) {
        if (!this.#listeners.has(eventName)) {
            this.#listeners.set(eventName, []);
        }
        this.#listeners.get(eventName).push(callback);
    }

    /**
     * Unregister an event listener.
     * @param {string} eventName - The name of the event.
     * @param {Function} callback - The callback function to remove.
     */
    off(eventName, callback) {
        if (this.#listeners.has(eventName)) {
            const callbacks = this.#listeners.get(eventName);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Dispatch an event.
     * @param {string} eventName - The name of the event.
     * @param {*} [data] - The data to pass to the listeners.
     * @protected
     */
    emit(eventName, data) {
        if (this.#listeners.has(eventName)) {
            this.#listeners.get(eventName).forEach(callback => callback(data));
        }
    }

    /**
     * 添加 ESC 键事件监听器
     * @protected
     */
    _addEscKeyHandler() {
        if (this.#escKeyHandler) return; // 避免重复添加
        
        this.#escKeyHandler = (e) => {
            if (e.key === 'Escape') {
                this._handleEscKey();
            }
        };
        
        document.addEventListener('keydown', this.#escKeyHandler);
    }

    /**
     * 移除 ESC 键事件监听器
     * @protected
     */
    _removeEscKeyHandler() {
        if (this.#escKeyHandler) {
            document.removeEventListener('keydown', this.#escKeyHandler);
            this.#escKeyHandler = null;
        }
    }

    /**
     * 处理 ESC 键按下事件，子类需要重写此方法
     * @protected
     */
    _handleEscKey() {
        // 子类需要重写此方法来实现具体的关闭逻辑
    }

    _openModalSurface(modalElement, {
        resetScroll = false,
    } = {}) {
        document.body.classList.add('modal-open');
        modalElement.style.display = 'flex';
        modalElement.offsetWidth;
        modalElement.classList.add('is-visible');
        this._addEscKeyHandler();

        if (resetScroll) {
            const scrollableContent = modalElement.querySelector('#domainRuleForm, .modal-scroll-content');
            if (scrollableContent) scrollableContent.scrollTop = 0;
            else modalElement.scrollTop = 0;
        }
    }

    _closeModalSurface(modalElement) {
        if (!modalElement.classList.contains('is-visible')) return;

        modalElement.classList.remove('is-visible');
        const onTransitionEnd = () => {
            modalElement.style.display = 'none';
            modalElement.removeEventListener('transitionend', onTransitionEnd);
            if (document.querySelectorAll('.modal-backdrop.is-visible').length === 0) {
                document.body.classList.remove('modal-open');
                this._removeEscKeyHandler();
            }
        };
        modalElement.addEventListener('transitionend', onTransitionEnd);
    }
}
