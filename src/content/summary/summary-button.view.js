import browser from '../../lib/browser-polyfill.js';
import { floatingLayoutService } from '../layout/floating-layout-service.js';

class SummaryButtonTooltip {
    constructor(text) {
        this.text = text;
        this.element = document.createElement('div');
        this.element.className = 'foxlate-summary-button-tooltip';
        this.element.textContent = text;
        document.body.appendChild(this.element);
    }

    show(anchorElement) {
        if (!anchorElement || anchorElement.classList.contains('dragging')) return;
        const box = floatingLayoutService.applyTextBox(this.element, this.text, {
            minWidth: 72,
            maxWidth: 220,
            paddingX: 20,
            paddingY: 12,
            styleOverrides: {
                fontSize: '12px',
                lineHeight: '16px',
                whiteSpace: 'normal',
            },
        });
        floatingLayoutService.placeElement(this.element, {
            anchorElement,
            box,
            margin: 10,
            gap: 10,
            preferredPlacements: ['left', 'right', 'bottom', 'top'],
        });
        this.element.classList.add('visible');
    }

    hide() {
        this.element.classList.remove('visible');
    }

    destroy() {
        this.element.remove();
    }
}

export class SummaryButton {
    constructor() {
        this.element = null;
        this.tooltip = null;
        this.create();
    }

    create() {
        this.element = document.createElement('div');
        this.element.className = 'foxlate-summary-button';

        const tooltipText = browser.i18n.getMessage('summaryButtonTooltip') || 'Summarize';
        this.element.setAttribute('aria-label', tooltipText);
        this.tooltip = new SummaryButtonTooltip(tooltipText);

        const sparklesIcon = '<svg class="icon-sparkles" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 2l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>';
        const closeIcon = '<svg class="icon-close" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

        this.element.innerHTML = sparklesIcon + closeIcon;
        this.element.addEventListener('mouseenter', () => this.tooltip?.show(this.element));
        this.element.addEventListener('mouseleave', () => this.tooltip?.hide());
        document.body.appendChild(this.element);
    }

    setPosition(x, y) {
        const rect = this.element.getBoundingClientRect();
        this.element.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width))}px`;
        this.element.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height))}px`;
    }

    destroy() {
        this.tooltip?.destroy();
        this.element?.remove();
    }
}
