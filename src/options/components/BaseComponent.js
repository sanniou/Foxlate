/**
 * A base class for UI components that provides a simple event system.
 */

/** 模态框内可聚焦元素的判定（焦点陷阱用）。 */
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 当前打开的模态框栈（后进先出）。
 *
 * 旧实现让每个组件实例各自在 document 上挂 keydown，由此产生两个真实缺陷：
 *  - 确认框叠在规则编辑框上时，一次 Esc 会把两层一起关掉（两个监听都触发）；
 *  - 先关掉的那层不会摘掉自己的监听（摘除条件看的是「还有没有别的可见模态框」），
 *    监听器从此长期留在 document 上。
 * 改成统一栈 + 单一 document 监听后，Esc 只作用于栈顶。
 */
const modalStack = [];

/** 当前挂载共享按键监听的文档。多个文档（测试、弹出页）共存时需要跟随栈顶迁移。 */
let attachedDocument = null;

/** 遮罩淡出时长是 200ms（`--fox-transition-smooth`），兜底计时器留出余量。 */
const MODAL_CLOSE_FALLBACK_MS = 400;

function attachKeydownHandler(doc) {
    if (attachedDocument === doc) return;
    detachKeydownHandler();
    doc.addEventListener('keydown', handleModalKeydown, true);
    attachedDocument = doc;
}

function detachKeydownHandler() {
    if (!attachedDocument) return;
    attachedDocument.removeEventListener('keydown', handleModalKeydown, true);
    attachedDocument = null;
}

function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
}

function handleModalKeydown(event) {
    const top = modalStack[modalStack.length - 1];
    if (!top) return;

    if (event.key === 'Escape' && !event.isComposing) {
        // 只让最上层响应，页面自身的 Esc 快捷键也不该同时触发
        event.stopPropagation();
        top.component._handleEscKey();
        return;
    }

    if (event.key !== 'Tab') return;

    const focusables = getFocusableElements(top.element);
    const active = top.element.ownerDocument.activeElement;

    // 焦点陷阱：Tab 不能跑到被遮住的页面上
    if (focusables.length === 0) {
        event.preventDefault();
        top.element.focus({ preventScroll: true });
        return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (!top.element.contains(active)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
    } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
    }
}

function pushModal(component, element) {
    const doc = element.ownerDocument;
    const previouslyFocusedElement = doc.activeElement instanceof doc.defaultView.HTMLElement
        ? doc.activeElement
        : null;

    modalStack.push({ component, element, previouslyFocusedElement });
    attachKeydownHandler(doc);
}

/** 把某个遮罩出栈，返回它的记录（含打开前的焦点宿主）。 */
function popModal(element) {
    const index = modalStack.findLastIndex(entry => entry.element === element);
    if (index === -1) return null;

    const [entry] = modalStack.splice(index, 1);

    if (modalStack.length === 0) {
        detachKeydownHandler();
    } else {
        // 监听必须跟着当前栈顶走：否则叠层里先关掉的那次会让监听留在
        // 上一个模态框的文档上，Esc 从此没人响应。
        attachKeydownHandler(modalStack[modalStack.length - 1].element.ownerDocument);
    }
    return entry;
}

export class BaseComponent {
    #listeners = new Map();

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
        // 强制回流，否则下面加的 is-visible 会与显示切换合并，过渡不触发
        modalElement.offsetWidth;
        modalElement.classList.add('is-visible');
        pushModal(this, modalElement);

        if (resetScroll) {
            const scrollableContent = modalElement.querySelector('#domainRuleForm, .modal-scroll-content');
            if (scrollableContent) scrollableContent.scrollTop = 0;
            else modalElement.scrollTop = 0;
        }

        this.#focusIntoModal(modalElement);
    }

    /**
     * 把焦点送进模态框。
     * 旧实现只让面板「看起来」打开，焦点仍停在背后的页面上——键盘用户按 Tab
     * 会在被遮住的表单里游走，屏幕阅读器也读不到新出现的内容。
     */
    #focusIntoModal(modalElement) {
        const target = getFocusableElements(modalElement)[0] ?? modalElement;
        if (target === modalElement && !modalElement.hasAttribute('tabindex')) {
            modalElement.setAttribute('tabindex', '-1');
        }
        target.focus({ preventScroll: true });
    }

    _closeModalSurface(modalElement) {
        if (!modalElement.classList.contains('is-visible')) return;

        const entry = popModal(modalElement);
        modalElement.classList.remove('is-visible');

        let fallbackTimer = null;
        const finalize = () => {
            modalElement.removeEventListener('transitionend', onTransitionEnd);
            clearTimeout(fallbackTimer);
            modalElement.style.display = 'none';
            if (document.querySelectorAll('.modal-backdrop.is-visible').length === 0) {
                document.body.classList.remove('modal-open');
            }
            // 焦点归还给打开面板的那个控件，否则键盘用户被丢回页面开头
            if (entry?.previouslyFocusedElement?.isConnected) {
                entry.previouslyFocusedElement.focus({ preventScroll: true });
            }
        };
        // 只认遮罩自身的过渡。旧实现没做这个过滤，子元素（`.modal-content` 的
        // transform）的 transitionend 会冒泡上来，淡出还没走完就被 display:none 掐断。
        const onTransitionEnd = event => {
            if (event.target === modalElement) finalize();
        };

        // 兜底：过渡被禁用时 transitionend 不会到达，没有兜底就会留下
        // style.display='flex' 与 body.modal-open（页面再也滚不动）。
        fallbackTimer = setTimeout(finalize, MODAL_CLOSE_FALLBACK_MS);
        modalElement.addEventListener('transitionend', onTransitionEnd);
    }
}
