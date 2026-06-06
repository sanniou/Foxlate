import { ResizeController } from '../layout/resize-controller.js';

export class TooltipResizeController {
    #controller = null;
    #userSize = null;

    get userSize() {
        return this.#userSize;
    }

    attach(tooltipEl, {
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
        margin,
        onResizeStart,
        onResize,
        onResizeEnd,
    }) {
        if (!tooltipEl) return;
        this.destroy();
        this.#controller = new ResizeController(tooltipEl, {
            minWidth,
            minHeight,
            maxWidth,
            maxHeight,
            margin,
            handles: ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'],
            onResizeStart,
            onResize: (size) => {
                this.#userSize = { width: size.width, height: size.height };
                onResize?.(size);
            },
            onResizeEnd: (size) => {
                this.#userSize = { width: size.width, height: size.height };
                onResizeEnd?.(size);
            },
        });
    }

    destroy() {
        this.#controller?.destroy();
        this.#controller = null;
    }
}
