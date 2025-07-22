import { escapeHtml } from '../common/utils.js';

/**
 * TooltipManager
 * A singleton class to manage the creation, positioning, and lifecycle of a single,
 * reusable tooltip element for the entire application. This centralizes tooltip
 * logic, preventing code duplication across different display strategies.
 */
class TooltipManager {
    #tooltipEl = null;
    #activeHideHandler = null; // A single handler for both click and scroll

    #createTooltip() {
        if (this.#tooltipEl) return;
        this.#tooltipEl = document.createElement('div');
        // A generic class name; specific styles are added via the 'type' option in show().
        this.#tooltipEl.className = 'foxlate-panel';
        document.body.appendChild(this.#tooltipEl);
    }

    #updatePosition({ coords, targetElement }) {
        if (!this.#tooltipEl) return;

        const tooltipRect = this.#tooltipEl.getBoundingClientRect();
        let x, y;

        if (coords) { // Context Menu positioning (centered on cursor)
            x = coords.clientX - tooltipRect.width / 2;
            y = coords.clientY;

            if (y + tooltipRect.height > window.innerHeight - 10) {
                y = window.innerHeight - tooltipRect.height - 10;
            }
        } else if (targetElement) { // Hover positioning (above or below element)
            const targetRect = targetElement.getBoundingClientRect();
            x = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
            y = targetRect.top - tooltipRect.height - 8;

            if (y < 10) { // Not enough space on top, move below
                y = targetRect.bottom + 8;
            }
        }

        // Common boundary checks to keep the tooltip within the viewport
        if (x + tooltipRect.width > window.innerWidth - 10) {
            x = window.innerWidth - tooltipRect.width - 10;
        }
        if (x < 10) {
            x = 10;
        }

        this.#tooltipEl.style.left = `${x}px`;
        this.#tooltipEl.style.top = `${y}px`;
    }

    hide() {
        if (this.#tooltipEl) {
            this.#tooltipEl.classList.remove('visible');
        }
        this.#removeHideListeners();
    }

    #removeHideListeners() {
        if (this.#activeHideHandler) {
            document.removeEventListener('click', this.#activeHideHandler, true);
            window.removeEventListener('scroll', this.#activeHideHandler, true);
            this.#activeHideHandler = null;
        }
    }

    show(text, {
        coords,
        targetElement,
        isLoading = false,
        isError = false,
        source = '',
        type = 'context', // 'context' or 'hover'
        onHide, // Callback for when the tooltip is hidden by user action (e.g., click-outside)
    }) {
        this.#createTooltip();
        if (!this.#tooltipEl) return;

        // Clean up any previous state before showing a new tooltip
        this.hide();

        this.#tooltipEl.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
        this.#tooltipEl.className = `foxlate-panel ${type}-panel`; // Set base and specific class
        this.#tooltipEl.classList.toggle('loading', isLoading);
        this.#tooltipEl.classList.toggle('error', isError);
        this.#tooltipEl.classList.toggle('from-shortcut', source === 'shortcut');

        this.#updatePosition({ coords, targetElement });
        this.#tooltipEl.classList.add('visible');

        // For tooltips that need to be dismissed by user interaction (like context menu)
        if (onHide) {
            this.#activeHideHandler = (e) => {
                if (!this.#tooltipEl || this.#tooltipEl.contains(e.target)) return;
                onHide(); // This will trigger DisplayManager.revert
            };
            setTimeout(() => { // Use timeout to avoid capturing the same click that triggered the show
                document.addEventListener('click', this.#activeHideHandler, true);
                window.addEventListener('scroll', this.#activeHideHandler, true);
            }, 0);
        }
    }
}

export default new TooltipManager();