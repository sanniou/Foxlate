import {
    measureLineStats,
    measureNaturalWidth,
    prepareWithSegments,
} from '@chenglou/pretext';

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT_RATIO = 1.5;
const DEFAULT_FONT_FAMILY = 'Arial, sans-serif';
const DEFAULT_CACHE_LIMIT = 500;

function parsePx(value) {
    if (!value || value === 'normal') return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeWhiteSpace(whiteSpace) {
    return ['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(whiteSpace) ? 'pre-wrap' : 'normal';
}

function normalizeWordBreak(wordBreak) {
    return wordBreak === 'keep-all' ? 'keep-all' : 'normal';
}

function createCanvasContext() {
    if (typeof document === 'undefined') return null;
    try {
        return document.createElement('canvas').getContext('2d');
    } catch (error) {
        return null;
    }
}

class LruCache {
    #limit;
    #map = new Map();

    constructor(limit = DEFAULT_CACHE_LIMIT) {
        this.#limit = limit;
    }

    get(key) {
        if (!this.#map.has(key)) return undefined;
        const value = this.#map.get(key);
        this.#map.delete(key);
        this.#map.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.#map.has(key)) {
            this.#map.delete(key);
        }
        this.#map.set(key, value);
        while (this.#map.size > this.#limit) {
            const oldestKey = this.#map.keys().next().value;
            this.#map.delete(oldestKey);
        }
    }

    clear() {
        this.#map.clear();
    }
}

class TextMeasurementService {
    #preparedCache = new LruCache();
    #measurementCache = new LruCache();
    #canvasContext = undefined;

    isSupported() {
        if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
            return false;
        }
        if (this.#canvasContext === undefined) {
            this.#canvasContext = createCanvasContext();
        }
        return Boolean(this.#canvasContext);
    }

    readTextStyle(referenceElement, overrides = {}) {
        const computedStyle = referenceElement && typeof window !== 'undefined'
            ? window.getComputedStyle(referenceElement)
            : null;
        const fontSize = parsePx(overrides.fontSize) ?? parsePx(computedStyle?.fontSize) ?? DEFAULT_FONT_SIZE;
        const lineHeight = parsePx(overrides.lineHeight) ?? parsePx(computedStyle?.lineHeight) ?? Math.ceil(fontSize * DEFAULT_LINE_HEIGHT_RATIO);
        const fontStyle = overrides.fontStyle ?? computedStyle?.fontStyle ?? 'normal';
        const fontVariant = overrides.fontVariant ?? computedStyle?.fontVariant ?? 'normal';
        const fontWeight = overrides.fontWeight ?? computedStyle?.fontWeight ?? '400';
        const fontFamily = overrides.fontFamily ?? computedStyle?.fontFamily ?? DEFAULT_FONT_FAMILY;
        const letterSpacing = parsePx(overrides.letterSpacing) ?? parsePx(computedStyle?.letterSpacing) ?? 0;
        const whiteSpace = normalizeWhiteSpace(overrides.whiteSpace ?? computedStyle?.whiteSpace);
        const wordBreak = normalizeWordBreak(overrides.wordBreak ?? computedStyle?.wordBreak);

        return {
            font: `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize}px ${fontFamily}`,
            fontSize,
            lineHeight,
            letterSpacing,
            whiteSpace,
            wordBreak,
        };
    }

    measureText(text, {
        referenceElement = null,
        maxWidth = 360,
        minWidth = 0,
        styleOverrides = {},
    } = {}) {
        const normalizedText = String(text ?? '');
        const width = Math.max(1, Math.floor(maxWidth));
        const min = Math.max(0, Math.floor(minWidth));
        const textStyle = this.readTextStyle(referenceElement, styleOverrides);

        if (!normalizedText.trim()) {
            return {
                available: this.isSupported(),
                width: min,
                height: 0,
                lineCount: 0,
                maxLineWidth: 0,
                naturalWidth: 0,
                lineHeight: textStyle.lineHeight,
                font: textStyle.font,
                source: this.isSupported() ? 'pretext' : 'fallback',
            };
        }

        const measurementKey = JSON.stringify([normalizedText, textStyle, width, min]);
        const cached = this.#measurementCache.get(measurementKey);
        if (cached) return cached;

        let result;
        if (this.isSupported()) {
            try {
                const prepared = this.#prepare(normalizedText, textStyle);
                const stats = measureLineStats(prepared, width);
                const naturalWidth = measureNaturalWidth(prepared);
                const measuredWidth = Math.max(min, Math.min(width, Math.ceil(Math.min(naturalWidth, stats.maxLineWidth || width))));
                result = {
                    available: true,
                    width: measuredWidth,
                    height: Math.ceil(stats.lineCount * textStyle.lineHeight),
                    lineCount: stats.lineCount,
                    maxLineWidth: Math.ceil(stats.maxLineWidth),
                    naturalWidth: Math.ceil(naturalWidth),
                    lineHeight: textStyle.lineHeight,
                    font: textStyle.font,
                    source: 'pretext',
                };
            } catch (error) {
                result = this.#measureFallback(normalizedText, textStyle, width, min);
                result.error = error;
            }
        } else {
            result = this.#measureFallback(normalizedText, textStyle, width, min);
        }

        this.#measurementCache.set(measurementKey, result);
        return result;
    }

    #prepare(text, textStyle) {
        const prepareKey = JSON.stringify([
            text,
            textStyle.font,
            textStyle.whiteSpace,
            textStyle.wordBreak,
            textStyle.letterSpacing,
        ]);
        const cached = this.#preparedCache.get(prepareKey);
        if (cached) return cached;

        const prepared = prepareWithSegments(text, textStyle.font, {
            whiteSpace: textStyle.whiteSpace,
            wordBreak: textStyle.wordBreak,
            letterSpacing: textStyle.letterSpacing,
        });
        this.#preparedCache.set(prepareKey, prepared);
        return prepared;
    }

    #measureFallback(text, textStyle, maxWidth, minWidth) {
        const averageGlyphWidth = Math.max(4, textStyle.fontSize * 0.56 + textStyle.letterSpacing);
        const hardLines = textStyle.whiteSpace === 'pre-wrap' ? text.split(/\n/) : [text.replace(/\s+/g, ' ')];
        let lineCount = 0;
        let widest = 0;

        for (const line of hardLines) {
            const estimatedWidth = line.length * averageGlyphWidth;
            widest = Math.max(widest, estimatedWidth);
            lineCount += Math.max(1, Math.ceil(estimatedWidth / maxWidth));
        }

        return {
            available: false,
            width: Math.max(minWidth, Math.min(maxWidth, Math.ceil(widest))),
            height: Math.ceil(lineCount * textStyle.lineHeight),
            lineCount,
            maxLineWidth: Math.ceil(Math.min(widest, maxWidth)),
            naturalWidth: Math.ceil(widest),
            lineHeight: textStyle.lineHeight,
            font: textStyle.font,
            source: 'fallback',
        };
    }

    clear() {
        this.#preparedCache.clear();
        this.#measurementCache.clear();
    }
}

export const textMeasurementService = new TextMeasurementService();
export { TextMeasurementService };
