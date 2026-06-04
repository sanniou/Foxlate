import { textMeasurementService } from '../content/layout/text-measurement-service.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function getElementText(element) {
    if (!element) return '';
    if (element.tagName === 'SELECT') {
        return element.selectedOptions?.[0]?.textContent || element.options?.[0]?.textContent || '';
    }
    return element.textContent || element.getAttribute('aria-label') || element.title || '';
}

function readContainerWidth(element, fallback = 240) {
    const rect = element?.getBoundingClientRect?.();
    const parentRect = element?.parentElement?.getBoundingClientRect?.();
    return Math.max(80, Math.floor(rect?.width || parentRect?.width || fallback));
}

export class UITextLayoutService {
    #signatureByElement = new WeakMap();

    applyElement(element, {
        minWidth = 40,
        maxWidth = null,
        paddingX = 24,
        styleOverrides = {},
    } = {}) {
        if (!element) return null;
        const text = getElementText(element).trim();
        if (!text) return null;
        const availableWidth = readContainerWidth(element);
        const boundedMaxWidth = clamp(maxWidth ?? availableWidth, minWidth, Math.max(minWidth, availableWidth));
        const signature = JSON.stringify([text, availableWidth, boundedMaxWidth, minWidth, paddingX, styleOverrides]);
        if (this.#signatureByElement.get(element) === signature) {
            return null;
        }
        const measurement = textMeasurementService.measureText(text, {
            referenceElement: element,
            maxWidth: Math.max(1, boundedMaxWidth - paddingX),
            minWidth: Math.max(0, minWidth - paddingX),
            styleOverrides,
        });
        element.dataset.foxlateLayoutSource = measurement.source;
        element.style.setProperty('--foxlate-ui-text-width', `${Math.ceil(measurement.width + paddingX)}px`);
        element.style.setProperty('--foxlate-ui-text-lines', String(measurement.lineCount));
        this.#signatureByElement.set(element, signature);
        return measurement;
    }

    applyTree(root = document) {
        const targets = root.querySelectorAll([
            'button',
            'select',
            'label',
            '.toggle-title',
            '.toggle-description',
            '.nav-link',
            '.domain-rule-item',
            '.form-control',
        ].join(','));
        for (const element of targets) {
            this.applyElement(element, {
                minWidth: element.matches?.('button') ? 36 : 48,
                paddingX: element.matches?.('select, .form-control') ? 36 : 18,
                styleOverrides: {
                    whiteSpace: 'normal',
                },
            });
        }
    }

    invalidate(root = document) {
        const targets = root.querySelectorAll?.('[data-foxlate-layout-source]') ?? [];
        for (const element of targets) {
            this.#signatureByElement.delete(element);
        }
    }
}

export const uiTextLayoutService = new UITextLayoutService();
