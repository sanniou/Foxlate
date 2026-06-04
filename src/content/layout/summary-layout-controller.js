import { floatingLayoutService } from './floating-layout-service.js';
import { textMeasurementService } from './text-measurement-service.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function getViewport() {
    return {
        width: window.innerWidth || document.documentElement.clientWidth || 1024,
        height: window.innerHeight || document.documentElement.clientHeight || 768,
    };
}

function textFromValue(value) {
    if (value == null) return '';
    return String(value);
}

export class SummaryLayoutController {
    static MARGIN = 16;
    static MIN_WIDTH = 360;
    static MIN_HEIGHT = 360;
    static DEFAULT_WIDTH = 440;
    static DEFAULT_HEIGHT = 520;
    static MAX_WIDTH = 760;
    static MAX_HEIGHT = 760;
    static ANCHOR_GAP = 8;

    getBounds() {
        const viewport = getViewport();
        const availableWidth = Math.max(120, viewport.width - SummaryLayoutController.MARGIN * 2);
        const availableHeight = Math.max(120, viewport.height - SummaryLayoutController.MARGIN * 2);
        const maxWidth = Math.min(SummaryLayoutController.MAX_WIDTH, availableWidth);
        const maxHeight = Math.min(SummaryLayoutController.MAX_HEIGHT, availableHeight);
        return {
            minWidth: Math.min(SummaryLayoutController.MIN_WIDTH, maxWidth),
            minHeight: Math.min(SummaryLayoutController.MIN_HEIGHT, maxHeight),
            maxWidth,
            maxHeight,
        };
    }

    planDialog({
        anchorRect = null,
        userSize = null,
        messageTexts = [],
        originalText = '',
        inputText = '',
        suggestions = [],
        suggestionsVisible = false,
    } = {}) {
        const bounds = this.getBounds();
        const contentWidth = this.#estimateContentWidth({ messageTexts, originalText, inputText, suggestions });
        const contentHeight = this.#estimateContentHeight({ messageTexts, originalText, inputText, suggestions, suggestionsVisible });
        const width = clamp(
            userSize?.width ?? Math.max(SummaryLayoutController.DEFAULT_WIDTH, contentWidth),
            bounds.minWidth,
            bounds.maxWidth,
        );
        const height = clamp(
            userSize?.height ?? Math.max(SummaryLayoutController.DEFAULT_HEIGHT, contentHeight),
            bounds.minHeight,
            bounds.maxHeight,
        );
        const position = this.#placeNearButton(anchorRect, width, height);

        return {
            ...position,
            width,
            height,
            bounds,
            transformOrigin: this.#getTransformOrigin(position.placement, anchorRect),
        };
    }

    measureTabTitle(title) {
        const box = floatingLayoutService.measureTextBox(textFromValue(title), {
            minWidth: 80,
            maxWidth: 180,
            paddingX: 34,
            paddingY: 0,
            styleOverrides: {
                fontSize: '13px',
                lineHeight: '18px',
                whiteSpace: 'normal',
            },
        });
        return clamp(box.width, 80, 180);
    }

    estimateMessageHeight(text, { width = 360, role = 'assistant' } = {}) {
        const contentWidth = Math.max(120, Math.floor(width * (role === 'user' ? 0.74 : 0.82)) - 32);
        const measurement = textMeasurementService.measureText(textFromValue(text), {
            maxWidth: contentWidth,
            minWidth: Math.min(120, contentWidth),
            styleOverrides: {
                fontSize: '14px',
                lineHeight: '22px',
                whiteSpace: 'pre-wrap',
            },
        });
        return clamp(Math.ceil(measurement.height + 24), 44, 260);
    }

    measureTextareaHeight(text, referenceElement, width) {
        const measurement = textMeasurementService.measureText(textFromValue(text) || ' ', {
            referenceElement,
            maxWidth: Math.max(80, width - 100),
            minWidth: 80,
            styleOverrides: {
                fontSize: '14px',
                lineHeight: '20px',
                whiteSpace: 'pre-wrap',
            },
        });
        return clamp(Math.ceil(measurement.height + 22), 40, 120);
    }

    estimateSuggestionHeight(text, width) {
        const measurement = textMeasurementService.measureText(textFromValue(text), {
            maxWidth: Math.max(100, width - 96),
            minWidth: 100,
            styleOverrides: {
                fontSize: '13px',
                lineHeight: '18px',
                whiteSpace: 'pre-wrap',
            },
        });
        return clamp(Math.ceil(measurement.height + 18), 38, 110);
    }

    #estimateContentWidth({ messageTexts, originalText, inputText, suggestions }) {
        const candidates = [originalText, inputText, ...messageTexts, ...suggestions]
            .filter(Boolean)
            .slice(-8);
        if (candidates.length === 0) return SummaryLayoutController.DEFAULT_WIDTH;

        const natural = candidates.reduce((max, text) => {
            const measurement = textMeasurementService.measureText(textFromValue(text), {
                maxWidth: 620,
                minWidth: 260,
                styleOverrides: {
                    fontSize: '14px',
                    lineHeight: '22px',
                    whiteSpace: 'pre-wrap',
                },
            });
            return Math.max(max, Math.min(measurement.naturalWidth + 84, 620));
        }, SummaryLayoutController.DEFAULT_WIDTH);
        return clamp(Math.ceil(natural), SummaryLayoutController.DEFAULT_WIDTH, SummaryLayoutController.MAX_WIDTH);
    }

    #estimateContentHeight({ messageTexts, originalText, inputText, suggestions, suggestionsVisible }) {
        const recentMessages = messageTexts.slice(-5);
        const messageHeight = recentMessages.reduce((sum, text) => sum + this.estimateMessageHeight(text), 0);
        const originalHeight = originalText ? 80 : 0;
        const suggestionHeight = suggestionsVisible ? Math.min(180, suggestions.slice(0, 3).reduce((sum, text) => sum + this.estimateSuggestionHeight(text, SummaryLayoutController.DEFAULT_WIDTH), 24)) : 0;
        const inputHeight = this.measureTextareaHeight(inputText, null, SummaryLayoutController.DEFAULT_WIDTH);
        return clamp(132 + originalHeight + messageHeight + suggestionHeight + inputHeight, SummaryLayoutController.DEFAULT_HEIGHT, SummaryLayoutController.MAX_HEIGHT);
    }

    #getPreferredPlacements(anchorRect) {
        if (!anchorRect) return ['left', 'right', 'bottom', 'top'];
        const viewport = getViewport();
        const anchorX = anchorRect.left + anchorRect.width / 2;
        const anchorY = anchorRect.top + anchorRect.height / 2;
        const horizontal = anchorX > viewport.width / 2 ? ['left', 'right'] : ['right', 'left'];
        const vertical = anchorY > viewport.height / 2 ? ['top', 'bottom'] : ['bottom', 'top'];
        return [...horizontal, ...vertical];
    }

    #placeNearButton(anchorRect, width, height) {
        if (!anchorRect) {
            return floatingLayoutService.placeAnchoredBox({
                boxWidth: width,
                boxHeight: height,
                margin: SummaryLayoutController.MARGIN,
                gap: SummaryLayoutController.ANCHOR_GAP,
                preferredPlacements: ['left', 'right', 'bottom', 'top'],
            });
        }

        const viewport = getViewport();
        const margin = SummaryLayoutController.MARGIN;
        const gap = SummaryLayoutController.ANCHOR_GAP;
        const rightSpace = viewport.width - anchorRect.right - margin;
        const leftSpace = anchorRect.left - margin;
        const bottomSpace = viewport.height - anchorRect.bottom - margin;
        const topSpace = anchorRect.top - margin;
        const centerTop = anchorRect.top + anchorRect.height / 2 - height / 2;
        const centerLeft = anchorRect.left + anchorRect.width / 2 - width / 2;

        const candidates = [];
        if (leftSpace >= width + gap || leftSpace >= rightSpace) {
            candidates.push({
                placement: 'left',
                left: anchorRect.left - width - gap,
                top: centerTop,
                visibleEdgeDistance: Math.max(0, anchorRect.left - (anchorRect.left - gap)),
            });
        }
        if (rightSpace >= width + gap || rightSpace > leftSpace) {
            candidates.push({
                placement: 'right',
                left: anchorRect.right + gap,
                top: centerTop,
                visibleEdgeDistance: Math.max(0, (anchorRect.right + gap) - anchorRect.right),
            });
        }
        if (topSpace >= height + gap || topSpace >= bottomSpace) {
            candidates.push({
                placement: 'top',
                left: centerLeft,
                top: anchorRect.top - height - gap,
                visibleEdgeDistance: gap,
            });
        }
        if (bottomSpace >= height + gap || bottomSpace > topSpace) {
            candidates.push({
                placement: 'bottom',
                left: centerLeft,
                top: anchorRect.bottom + gap,
                visibleEdgeDistance: gap,
            });
        }

        for (const candidate of candidates) {
            const left = clamp(candidate.left, margin, Math.max(margin, viewport.width - width - margin));
            const top = clamp(candidate.top, margin, Math.max(margin, viewport.height - height - margin));
            if (
                left >= margin &&
                top >= margin &&
                left + width <= viewport.width - margin &&
                top + height <= viewport.height - margin
            ) {
                return { left, top, placement: candidate.placement };
            }
        }

        const fallback = candidates[0] || {
            placement: 'left',
            left: anchorRect.left - width - gap,
            top: centerTop,
        };
        return {
            left: clamp(fallback.left, margin, Math.max(margin, viewport.width - width - margin)),
            top: clamp(fallback.top, margin, Math.max(margin, viewport.height - height - margin)),
            placement: fallback.placement,
        };
    }

    #getTransformOrigin(placement, anchorRect) {
        if (!anchorRect) return 'center center';
        if (placement === 'left') return 'right center';
        if (placement === 'right') return 'left center';
        if (placement === 'top') return 'center bottom';
        return 'center top';
    }
}

export const summaryLayoutController = new SummaryLayoutController();
