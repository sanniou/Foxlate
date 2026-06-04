function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function getViewportLimits(margin = 8) {
    return {
        maxWidth: Math.max(120, (window.innerWidth || document.documentElement.clientWidth || 1024) - margin * 2),
        maxHeight: Math.max(120, (window.innerHeight || document.documentElement.clientHeight || 768) - margin * 2),
    };
}

const HANDLE_STYLES = {
    n: {
        width: 'calc(100% - 20px)',
        height: '10px',
        left: '10px',
        top: '-5px',
        cursor: 'ns-resize',
    },
    e: {
        width: '10px',
        height: 'calc(100% - 20px)',
        top: '10px',
        right: '-5px',
        cursor: 'ew-resize',
    },
    s: {
        width: 'calc(100% - 20px)',
        height: '10px',
        left: '10px',
        bottom: '-5px',
        cursor: 'ns-resize',
    },
    w: {
        width: '10px',
        height: 'calc(100% - 20px)',
        top: '10px',
        left: '-5px',
        cursor: 'ew-resize',
    },
    ne: {
        width: '14px',
        height: '14px',
        right: '0',
        top: '0',
        cursor: 'nesw-resize',
    },
    se: {
        width: '14px',
        height: '14px',
        right: '0',
        bottom: '0',
        cursor: 'nwse-resize',
    },
    sw: {
        width: '14px',
        height: '14px',
        left: '0',
        bottom: '0',
        cursor: 'nesw-resize',
    },
    nw: {
        width: '14px',
        height: '14px',
        left: '0',
        top: '0',
        cursor: 'nwse-resize',
    },
};

export class ResizeController {
    #element;
    #options;
    #handles = [];
    #activeResize = null;
    #boundMove = this.#handleMouseMove.bind(this);
    #boundUp = this.#handleMouseUp.bind(this);

    constructor(element, options = {}) {
        this.#element = element;
        this.#options = {
            minWidth: 220,
            minHeight: 120,
            maxWidth: null,
            maxHeight: null,
            margin: 8,
            handles: ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'],
            onResizeStart: null,
            onResize: null,
            onResizeEnd: null,
            ...options,
        };
        this.#renderHandles();
    }

    destroy() {
        document.removeEventListener('mousemove', this.#boundMove);
        document.removeEventListener('mouseup', this.#boundUp);
        for (const handle of this.#handles) {
            handle.remove();
        }
        this.#handles = [];
        this.#activeResize = null;
        delete this.#element.dataset.foxlateResizable;
        delete this.#element.dataset.foxlateResizing;
    }

    #renderHandles() {
        this.#element.querySelectorAll(':scope > .foxlate-resize-handle').forEach(handle => handle.remove());
        this.#handles = [];
        this.#element.dataset.foxlateResizable = 'true';
        if (window.getComputedStyle(this.#element).position === 'static') {
            this.#element.style.position = 'relative';
        }
        for (const direction of this.#options.handles) {
            const handle = document.createElement('div');
            handle.className = `foxlate-resize-handle foxlate-resize-${direction}`;
            handle.dataset.resizeDirection = direction;
            Object.assign(handle.style, {
                position: 'absolute',
                zIndex: '2',
                pointerEvents: 'auto',
                touchAction: 'none',
                userSelect: 'none',
                ...HANDLE_STYLES[direction],
            });
            handle.addEventListener('mousedown', (event) => this.#handleMouseDown(event, direction));
            this.#element.appendChild(handle);
            this.#handles.push(handle);
        }
    }

    #handleMouseDown(event, direction) {
        event.preventDefault();
        event.stopPropagation();
        const rect = this.#element.getBoundingClientRect();
        this.#activeResize = {
            direction,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: rect.width,
            startHeight: rect.height,
            startLeft: rect.left,
            startTop: rect.top,
            startRight: rect.right,
            startBottom: rect.bottom,
        };
        this.#element.classList.add('foxlate-resizing');
        this.#element.dataset.foxlateResizing = 'true';
        this.#options.onResizeStart?.({
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top,
            direction,
        });
        document.addEventListener('mousemove', this.#boundMove);
        document.addEventListener('mouseup', this.#boundUp);
    }

    #handleMouseMove(event) {
        if (!this.#activeResize) return;
        event.preventDefault();

        const viewportLimits = getViewportLimits(this.#options.margin);
        const { direction, startX, startY, startWidth, startHeight, startLeft, startTop, startRight, startBottom } = this.#activeResize;
        const margin = this.#options.margin;
        const maxWidth = this.#options.maxWidth ?? viewportLimits.maxWidth;
        const maxHeight = this.#options.maxHeight ?? viewportLimits.maxHeight;
        const maxEastWidth = Math.min(maxWidth, Math.max(this.#options.minWidth, (window.innerWidth || document.documentElement.clientWidth || 1024) - margin - startLeft));
        const maxSouthHeight = Math.min(maxHeight, Math.max(this.#options.minHeight, (window.innerHeight || document.documentElement.clientHeight || 768) - margin - startTop));
        const maxWestWidth = Math.min(maxWidth, Math.max(this.#options.minWidth, startRight - margin));
        const maxNorthHeight = Math.min(maxHeight, Math.max(this.#options.minHeight, startBottom - margin));
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;

        let nextWidth = startWidth;
        let nextHeight = startHeight;
        let nextLeft = startLeft;
        let nextTop = startTop;

        if (direction.includes('e')) {
            nextWidth = clamp(startWidth + deltaX, this.#options.minWidth, maxEastWidth);
            this.#element.style.width = `${nextWidth}px`;
        }
        if (direction.includes('w')) {
            nextWidth = clamp(startWidth - deltaX, this.#options.minWidth, maxWestWidth);
            nextLeft = startLeft + (startWidth - nextWidth);
            this.#element.style.width = `${nextWidth}px`;
            this.#element.style.left = `${nextLeft}px`;
        }
        if (direction.includes('s')) {
            nextHeight = clamp(startHeight + deltaY, this.#options.minHeight, maxSouthHeight);
            this.#element.style.height = `${nextHeight}px`;
            this.#element.style.minHeight = `${nextHeight}px`;
        }
        if (direction.includes('n')) {
            nextHeight = clamp(startHeight - deltaY, this.#options.minHeight, maxNorthHeight);
            nextTop = startTop + (startHeight - nextHeight);
            this.#element.style.height = `${nextHeight}px`;
            this.#element.style.minHeight = `${nextHeight}px`;
            this.#element.style.top = `${nextTop}px`;
        }

        this.#options.onResize?.({
            width: nextWidth,
            height: nextHeight,
            left: nextLeft,
            top: nextTop,
            direction,
        });
    }

    #handleMouseUp() {
        if (!this.#activeResize) return;
        const rect = this.#element.getBoundingClientRect();
        this.#element.classList.remove('foxlate-resizing');
        delete this.#element.dataset.foxlateResizing;
        document.removeEventListener('mousemove', this.#boundMove);
        document.removeEventListener('mouseup', this.#boundUp);
        this.#activeResize = null;
        this.#options.onResizeEnd?.({
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top,
        });
    }
}
