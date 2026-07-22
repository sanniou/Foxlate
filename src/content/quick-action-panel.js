import browser from '../lib/browser-polyfill.js';
import { getSelectionPayload, translateSelectionPayload } from './selection-translate.js';

/** Pure viewport clamp used by the floating quick-action panel. */
export function clampPanelPosition({
    clientX = 0,
    clientY = 0,
    panelWidth = 112,
    panelHeight = 40,
    viewportWidth = 0,
    viewportHeight = 0,
    gutter = 8,
} = {}) {
    let left = clientX - panelWidth / 2;
    let top = clientY + gutter;
    left = Math.min(Math.max(gutter, left), Math.max(gutter, viewportWidth - panelWidth - gutter));
    top = Math.min(Math.max(gutter, top), Math.max(gutter, viewportHeight - panelHeight - gutter));
    return { left, top };
}

export class QuickActionPanel {
    #browser;
    #window;
    #panel = null;
    #settings = {};
    #onTranslate;
    #hideTimer = null;
    #boundSelectionChange = this.#handleSelectionChange.bind(this);
    #boundMouseUp = this.#handleSelectionChange.bind(this);

    constructor({
        browserApi = browser,
        win = window,
        settings = {},
        onTranslate,
    } = {}) {
        this.#browser = browserApi;
        this.#window = win;
        this.#settings = settings;
        this.#onTranslate = onTranslate;
    }

    initialize(settings = this.#settings) {
        this.updateSettings(settings);
        this.#window.document.addEventListener('selectionchange', this.#boundSelectionChange);
        this.#window.document.addEventListener('mouseup', this.#boundMouseUp);
    }

    updateSettings(settings = {}) {
        this.#settings = settings;
        if (!this.#isEnabled()) {
            this.hide();
        }
    }

    destroy() {
        this.#window.document.removeEventListener('selectionchange', this.#boundSelectionChange);
        this.#window.document.removeEventListener('mouseup', this.#boundMouseUp);
        this.hide();
    }

    hide() {
        if (this.#hideTimer) {
            this.#window.clearTimeout(this.#hideTimer);
            this.#hideTimer = null;
        }
        this.#panel?.remove();
        this.#panel = null;
    }

    #isEnabled() {
        const panelSettings = this.#settings.quickActionPanel || {};
        return panelSettings.enabled !== false && panelSettings.showOnSelection !== false;
    }

    #handleSelectionChange() {
        if (!this.#isEnabled()) return;

        if (this.#hideTimer) {
            this.#window.clearTimeout(this.#hideTimer);
        }

        this.#hideTimer = this.#window.setTimeout(() => {
            const payload = getSelectionPayload(this.#window);
            if (!payload) {
                this.hide();
                return;
            }
            this.#show(payload);
        }, 80);
    }

    #show(selectionPayload) {
        this.#ensurePanel();
        this.#positionPanel(selectionPayload.coords);
        this.#panel.dataset.visible = 'true';
        this.#panel.querySelector('[data-action="translate"]').onclick = () => {
            this.hide();
            this.#onTranslate?.(selectionPayload);
        };
    }

    /** Clamp panel inside the viewport with an 8px gutter. */
    #positionPanel(coords) {
        const { left, top } = clampPanelPosition({
            clientX: coords?.clientX || 0,
            clientY: coords?.clientY || 0,
            panelWidth: this.#panel.offsetWidth || 112,
            panelHeight: this.#panel.offsetHeight || 40,
            viewportWidth: this.#window.innerWidth || 0,
            viewportHeight: this.#window.innerHeight || 0,
        });
        this.#panel.style.left = `${left}px`;
        this.#panel.style.top = `${top}px`;
    }

    #ensurePanel() {
        if (this.#panel) return;

        this.#panel = this.#window.document.createElement('div');
        this.#panel.className = 'foxlate-quick-action-panel';
        const translateLabel = this.#browser.i18n.getMessage('translateButtonText') || 'Translate';
        this.#panel.innerHTML = `
            <button type="button" data-action="translate">${translateLabel}</button>
        `;
        this.#window.document.body.appendChild(this.#panel);
    }
}

/** @deprecated use translateSelectionPayload — kept name for content-runtime call sites */
export async function translateQuickSelection(options) {
    return translateSelectionPayload({
        ...options,
        source: options.source || 'quick-action',
    });
}
