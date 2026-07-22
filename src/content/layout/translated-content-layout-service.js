import { textMeasurementService } from './text-measurement-service.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function stripTranslatorTags(text) {
    return String(text ?? '').replace(/<\/?t\d+>/g, '');
}

function readAvailableWidth(element, fallback = 320) {
    if (!element || typeof element.getBoundingClientRect !== 'function') {
        return fallback;
    }
    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement?.getBoundingClientRect?.();
    const rectWidth = rect.width || 0;
    const parentWidth = parentRect?.width || 0;
    return Math.max(120, Math.floor(rectWidth || parentWidth || fallback));
}

class TranslatedContentLayoutService {
    measure(text, {
        referenceElement = null,
        availableWidth = null,
        minWidth = 80,
        maxWidth = null,
        styleOverrides = {},
    } = {}) {
        const width = availableWidth ?? readAvailableWidth(referenceElement);
        const boundedMaxWidth = clamp(maxWidth ?? width, minWidth, Math.max(minWidth, width));
        return textMeasurementService.measureText(stripTranslatorTags(text), {
            referenceElement,
            maxWidth: boundedMaxWidth,
            minWidth,
            styleOverrides: {
                whiteSpace: 'pre-wrap',
                ...styleOverrides,
            },
        });
    }

    applyAppendLayout(appendedElement, text, {
        referenceElement = null,
        appendType = 'inline',
    } = {}) {
        if (!appendedElement) return null;
        const availableWidth = appendType === 'block'
            ? readAvailableWidth(referenceElement, 420)
            : Math.max(120, Math.floor(readAvailableWidth(referenceElement, 320) * 0.86));
        const measurement = this.measure(text, {
            referenceElement,
            availableWidth,
            minWidth: appendType === 'block' ? Math.min(160, availableWidth) : 40,
            maxWidth: availableWidth,
        });

        appendedElement.dataset.foxlateLayoutSource = measurement.source;
        appendedElement.style.setProperty('--foxlate-translation-measured-width', `${Math.ceil(measurement.width)}px`);
        appendedElement.style.setProperty('--foxlate-translation-measured-height', `${Math.ceil(measurement.height)}px`);
        appendedElement.style.setProperty('--foxlate-translation-line-count', String(measurement.lineCount));
        if (appendType === 'block') {
            // Cap width only — do not force minHeight (keeps append visually light).
            appendedElement.style.maxWidth = `${availableWidth}px`;
        }
        return measurement;
    }

    applyReplaceLayout(element, text) {
        if (!element) return null;
        const availableWidth = readAvailableWidth(element, 420);
        const measurement = this.measure(text, {
            referenceElement: element,
            availableWidth,
            minWidth: Math.min(120, availableWidth),
            maxWidth: availableWidth,
        });
        element.dataset.foxlateLayoutSource = measurement.source;
        element.style.setProperty('--foxlate-translation-measured-height', `${Math.ceil(measurement.height)}px`);
        element.style.setProperty('--foxlate-translation-line-count', String(measurement.lineCount));
        return measurement;
    }
}

export const translatedContentLayoutService = new TranslatedContentLayoutService();
export { TranslatedContentLayoutService, stripTranslatorTags };
