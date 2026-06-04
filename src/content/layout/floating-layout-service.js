import { textMeasurementService } from './text-measurement-service.js';

const DEFAULT_MARGIN = 10;

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function getViewport() {
    return {
        width: window.innerWidth || document.documentElement.clientWidth || 1024,
        height: window.innerHeight || document.documentElement.clientHeight || 768,
    };
}

class FloatingLayoutService {
    measureTextBox(text, {
        referenceElement = null,
        minWidth = 220,
        maxWidth = 360,
        paddingX = 32,
        paddingY = 24,
        styleOverrides = {},
    } = {}) {
        const viewport = getViewport();
        const boundedMaxWidth = clamp(maxWidth, minWidth, Math.max(minWidth, viewport.width - DEFAULT_MARGIN * 2));
        const contentMaxWidth = Math.max(1, boundedMaxWidth - paddingX);
        const contentMinWidth = Math.max(0, minWidth - paddingX);
        const measurement = textMeasurementService.measureText(text, {
            referenceElement,
            maxWidth: contentMaxWidth,
            minWidth: contentMinWidth,
            styleOverrides,
        });

        return {
            ...measurement,
            width: clamp(Math.ceil(measurement.width + paddingX), minWidth, boundedMaxWidth),
            height: Math.ceil(measurement.height + paddingY),
            contentWidth: measurement.width,
            contentHeight: measurement.height,
        };
    }

    applyTextBox(element, text, options = {}) {
        if (!element) return null;
        const box = this.measureTextBox(text, {
            referenceElement: element,
            ...options,
        });
        element.style.width = `${box.width}px`;
        if (options.minHeight !== false && box.height > 0) {
            const maxReservedHeight = Number.isFinite(options.maxReservedHeight) ? options.maxReservedHeight : Number.POSITIVE_INFINITY;
            element.style.minHeight = `${Math.min(box.height, maxReservedHeight)}px`;
        }
        element.dataset.foxlateLayoutSource = box.source;
        return box;
    }

    placeAnchoredBox({
        anchorRect = null,
        point = null,
        boxWidth,
        boxHeight,
        margin = DEFAULT_MARGIN,
        gap = 8,
        preferredPlacements = ['top', 'bottom', 'right', 'left'],
    }) {
        const viewport = getViewport();
        const anchor = anchorRect || {
            left: point?.clientX ?? margin,
            right: point?.clientX ?? margin,
            top: point?.clientY ?? margin,
            bottom: point?.clientY ?? margin,
            width: 0,
            height: 0,
        };

        const candidates = {
            top: {
                left: anchor.left + anchor.width / 2 - boxWidth / 2,
                top: anchor.top - boxHeight - gap,
            },
            bottom: {
                left: anchor.left + anchor.width / 2 - boxWidth / 2,
                top: anchor.bottom + gap,
            },
            right: {
                left: anchor.right + gap,
                top: anchor.top + anchor.height / 2 - boxHeight / 2,
            },
            left: {
                left: anchor.left - boxWidth - gap,
                top: anchor.top + anchor.height / 2 - boxHeight / 2,
            },
        };

        let bestPlacement = preferredPlacements[0] || 'bottom';
        let bestCandidate = candidates[bestPlacement];
        for (const placement of preferredPlacements) {
            const candidate = candidates[placement];
            const fits = candidate.left >= margin &&
                candidate.top >= margin &&
                candidate.left + boxWidth <= viewport.width - margin &&
                candidate.top + boxHeight <= viewport.height - margin;
            if (fits) {
                bestPlacement = placement;
                bestCandidate = candidate;
                break;
            }
        }

        return {
            left: clamp(bestCandidate.left, margin, Math.max(margin, viewport.width - boxWidth - margin)),
            top: clamp(bestCandidate.top, margin, Math.max(margin, viewport.height - boxHeight - margin)),
            placement: bestPlacement,
        };
    }

    placeElement(element, {
        anchorElement = null,
        point = null,
        box = null,
        margin = DEFAULT_MARGIN,
        gap = 8,
        preferredPlacements,
    } = {}) {
        if (!element) return null;
        const rect = box || element.getBoundingClientRect();
        const anchorRect = anchorElement?.getBoundingClientRect?.() ?? null;
        const position = this.placeAnchoredBox({
            anchorRect,
            point,
            boxWidth: rect.width,
            boxHeight: rect.height,
            margin,
            gap,
            preferredPlacements,
        });
        element.style.left = `${position.left}px`;
        element.style.top = `${position.top}px`;
        element.dataset.foxlatePlacement = position.placement;
        return position;
    }
}

export const floatingLayoutService = new FloatingLayoutService();
export { FloatingLayoutService };
