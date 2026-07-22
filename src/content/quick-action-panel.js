import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';

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

function getSelectionPayload(win = window) {
    const selection = win.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text || selection.rangeCount === 0) {
        return null;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
        return null;
    }

    return {
        text,
        coords: {
            clientX: rect.left + rect.width / 2,
            clientY: rect.bottom + 10,
        },
    };
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

export async function translateQuickSelection({
    browserApi = browser,
    win = window,
    displaySelectionTranslation,
    selectionPayload,
}) {
    const translationId = `quick-${Date.now()}`;
    const basePayload = {
        translationId,
        coords: selectionPayload.coords,
        source: 'quick-action',
        originalText: selectionPayload.text,
    };

    displaySelectionTranslation({ ...basePayload, isLoading: true });

    try {
        const response = await browserApi.runtime.sendMessage({
            type: MESSAGE_TYPES.TRANSLATE_BATCH,
            payload: {
                texts: [selectionPayload.text],
                hostname: win.location.hostname,
            },
        });
        const translatedText = response?.translatedTexts?.[0] || selectionPayload.text;
        displaySelectionTranslation({
            ...basePayload,
            success: !!response?.success,
            translatedText,
            error: response?.success ? null : (response?.error || 'Translation failed'),
        });
    } catch (error) {
        displaySelectionTranslation({
            ...basePayload,
            success: false,
            error: error.message,
        });
    }
}
