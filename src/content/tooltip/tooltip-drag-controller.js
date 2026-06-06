export class TooltipDragController {
    #tooltipEl = null;
    #header = null;
    #isPinned = false;
    #isDragging = false;
    #dragOffsetX = 0;
    #dragOffsetY = 0;
    #boundMouseDown = this.#handleMouseDown.bind(this);
    #boundMouseMove = this.#handleMouseMove.bind(this);
    #boundMouseUp = this.#handleMouseUp.bind(this);

    attach(tooltipEl, header) {
        this.destroy();
        this.#tooltipEl = tooltipEl;
        this.#header = header;
        this.#header?.addEventListener('mousedown', this.#boundMouseDown);
        this.#syncCursor();
    }

    setPinned(isPinned) {
        this.#isPinned = isPinned;
        this.#syncCursor();
        if (!isPinned) {
            this.#removeDocumentListeners();
        }
    }

    destroy() {
        this.#header?.removeEventListener('mousedown', this.#boundMouseDown);
        this.#removeDocumentListeners();
        this.#tooltipEl = null;
        this.#header = null;
    }

    #handleMouseDown(event) {
        if (!this.#isPinned || !this.#tooltipEl) return;
        this.#isDragging = true;
        const rect = this.#tooltipEl.getBoundingClientRect();
        this.#dragOffsetX = event.clientX - rect.left;
        this.#dragOffsetY = event.clientY - rect.top;
        this.#header.style.cursor = 'grabbing';
        document.removeEventListener('mousemove', this.#boundMouseMove);
        document.removeEventListener('mouseup', this.#boundMouseUp);
        document.addEventListener('mousemove', this.#boundMouseMove);
        document.addEventListener('mouseup', this.#boundMouseUp);
    }

    #handleMouseMove(event) {
        if (!this.#isDragging || !this.#isPinned || !this.#tooltipEl) return;
        event.preventDefault();

        const rect = this.#tooltipEl.getBoundingClientRect();
        const x = Math.max(0, Math.min(event.clientX - this.#dragOffsetX, window.innerWidth - rect.width));
        const y = Math.max(0, Math.min(event.clientY - this.#dragOffsetY, window.innerHeight - rect.height));
        this.#tooltipEl.style.left = `${x}px`;
        this.#tooltipEl.style.top = `${y}px`;
    }

    #handleMouseUp() {
        if (!this.#isDragging) return;
        this.#isDragging = false;
        this.#syncCursor();
        this.#removeDocumentListeners();
    }

    #removeDocumentListeners() {
        document.removeEventListener('mousemove', this.#boundMouseMove);
        document.removeEventListener('mouseup', this.#boundMouseUp);
        this.#isDragging = false;
    }

    #syncCursor() {
        if (!this.#header) return;
        this.#header.style.cursor = this.#isPinned ? 'grab' : '';
        this.#header.classList.toggle('draggable', this.#isPinned);
    }
}
