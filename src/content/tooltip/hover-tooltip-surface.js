import { floatingLayoutService } from '../layout/floating-layout-service.js';
import { ResizeController } from '../layout/resize-controller.js';

const HOVER_HIDE_DELAY_MS = 100;

export class HoverTooltipSurface {
    #tooltipEl = null;
    #hideTimeout = null;
    #activeElement = null;
    #resizeController = null;
    #userSize = null;
    #isPinned = false;
    #outsideClickHandler = null;
    #win;
    #doc;

    constructor({ win = window, doc = document } = {}) {
        this.#win = win;
        this.#doc = doc;
    }

    show({ text, targetElement, isError = false }) {
        this.#ensureTooltip();
        if (!this.#tooltipEl) return;

        this.#clearHideTimer();
        this.#tooltipEl.innerHTML = '';
        this.#tooltipEl.classList.toggle('error', isError);
        this.#tooltipEl.classList.remove('loading');
        this.#tooltipEl.textContent = text;

        floatingLayoutService.applyTextBox(this.#tooltipEl, text, {
            minWidth: 180,
            maxWidth: 360,
            paddingX: 32,
            paddingY: 24,
            maxReservedHeight: Math.max(80, Math.min(240, this.#win.innerHeight - 20)),
            styleOverrides: {
                fontSize: '14px',
                lineHeight: '21px',
                whiteSpace: 'pre-wrap',
            },
        });

        if (this.#userSize) {
            this.#tooltipEl.style.width = `${this.#userSize.width}px`;
            this.#tooltipEl.style.height = `${this.#userSize.height}px`;
            this.#tooltipEl.style.minHeight = `${this.#userSize.height}px`;
        }

        this.#attachResizeController();
        this.#activeElement = targetElement;
        this.#place(targetElement);
        this.#tooltipEl.classList.add('visible');
        this.#attachTooltipListeners();
    }

    scheduleHide() {
        if (!this.#tooltipEl || this.#isPinned) return;

        this.#clearHideTimer();
        this.#hideTimeout = this.#win.setTimeout(() => {
            this.hide();
        }, HOVER_HIDE_DELAY_MS);
    }

    hide({ force = false } = {}) {
        if (!this.#tooltipEl || (this.#isPinned && !force)) return;
        this.#tooltipEl.classList.remove('visible');
        this.#detachTooltipListeners();
        this.#resizeController?.destroy();
        this.#resizeController = null;
        this.#hideTimeout = null;
        this.#activeElement = null;
        if (force) {
            this.#isPinned = false;
            this.#tooltipEl.classList.remove('pinned');
            this.#detachOutsideClickHandler();
        }
    }

    cleanup() {
        this.#clearHideTimer();
        this.hide({ force: true });
    }

    #ensureTooltip() {
        if (this.#tooltipEl) return;
        this.#tooltipEl = this.#doc.createElement('div');
        this.#tooltipEl.className = 'foxlate-panel foxlate-hover-tooltip';
        this.#doc.body.appendChild(this.#tooltipEl);
    }

    #place(targetElement) {
        if (!this.#tooltipEl || !targetElement) return;
        floatingLayoutService.placeElement(this.#tooltipEl, {
            anchorElement: targetElement,
            margin: 10,
            gap: 8,
            preferredPlacements: ['top', 'bottom', 'right', 'left'],
        });
    }

    #attachResizeController() {
        if (!this.#tooltipEl) return;
        this.#resizeController?.destroy();
        this.#resizeController = new ResizeController(this.#tooltipEl, {
            minWidth: 160,
            minHeight: 48,
            maxWidth: Math.max(180, Math.min(520, this.#win.innerWidth - 20)),
            maxHeight: Math.max(80, this.#win.innerHeight - 20),
            margin: 10,
            handles: ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'],
            onResizeStart: () => this.#pin(),
            onResize: ({ width, height }) => {
                this.#userSize = { width, height };
            },
            onResizeEnd: ({ width, height }) => {
                this.#userSize = { width, height };
                if (this.#activeElement) {
                    this.#place(this.#activeElement);
                }
            },
        });
    }

    #pin() {
        if (!this.#tooltipEl) return;
        this.#isPinned = true;
        this.#tooltipEl.classList.add('pinned');
        this.#clearHideTimer();
        if (!this.#outsideClickHandler) {
            this.#outsideClickHandler = (event) => {
                if (this.#tooltipEl?.contains(event.target)) return;
                this.#isPinned = false;
                this.#tooltipEl?.classList.remove('pinned');
                this.#detachOutsideClickHandler();
                this.scheduleHide();
            };
        }
        this.#win.setTimeout(() => {
            this.#doc.addEventListener('mousedown', this.#outsideClickHandler, true);
        }, 0);
    }

    #attachTooltipListeners() {
        if (!this.#tooltipEl || this.#tooltipEl._foxlateTooltipListeners) return;

        const handleTooltipMouseEnter = () => this.#clearHideTimer();
        const handleTooltipMouseLeave = () => this.scheduleHide();
        const handleScroll = () => {
            if (this.#activeElement && this.#tooltipEl?.classList.contains('visible')) {
                this.#place(this.#activeElement);
            }
        };

        this.#tooltipEl.addEventListener('mouseenter', handleTooltipMouseEnter);
        this.#tooltipEl.addEventListener('mouseleave', handleTooltipMouseLeave);
        this.#win.addEventListener('scroll', handleScroll, { passive: true });

        this.#tooltipEl._foxlateTooltipListeners = {
            handleTooltipMouseEnter,
            handleTooltipMouseLeave,
            handleScroll,
        };
    }

    #detachTooltipListeners() {
        if (!this.#tooltipEl?._foxlateTooltipListeners) return;

        const { handleTooltipMouseEnter, handleTooltipMouseLeave, handleScroll } = this.#tooltipEl._foxlateTooltipListeners;
        this.#tooltipEl.removeEventListener('mouseenter', handleTooltipMouseEnter);
        this.#tooltipEl.removeEventListener('mouseleave', handleTooltipMouseLeave);
        this.#win.removeEventListener('scroll', handleScroll);
        delete this.#tooltipEl._foxlateTooltipListeners;
    }

    #detachOutsideClickHandler() {
        if (!this.#outsideClickHandler) return;
        this.#doc.removeEventListener('mousedown', this.#outsideClickHandler, true);
    }

    #clearHideTimer() {
        if (!this.#hideTimeout) return;
        this.#win.clearTimeout(this.#hideTimeout);
        this.#hideTimeout = null;
    }
}
