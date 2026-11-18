/**
 * 文本测量框架（零依赖）。
 *
 * 设计要点：
 * 1. 本模块属于 `common/`，任何上下文（content / popup / options / service worker）都可安全引用，
 *    它不会把任何重量级排版库拖进依赖图。
 * 2. 真正的精确排版引擎是**可插拔**的：content 侧在启动时通过 `setEngine()`
 *    注入 `@chenglou/pretext` 适配器；popup / options 不注入，直接使用内置的
 *    Canvas 引擎（真实字体度量，无需额外字节）。
 * 3. `measureText` 保持同步语义 —— 调用方（布局服务）都在同步渲染路径上。
 *
 * 历史上本模块直接从 `content/layout/` 反向 import 一个绑死 pretext 的实现，
 * 导致 popup 与 service worker 也被迫打包整套排版引擎。
 */

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT_RATIO = 1.5;
const DEFAULT_FONT_FAMILY = 'Arial, sans-serif';
const DEFAULT_CACHE_LIMIT = 500;

/** 折叠空白时用于判断段落内的候选断点。 */
const CJK_CHAR_REGEX = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;

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

function getCanvasContext() {
    if (typeof OffscreenCanvas !== 'undefined') {
        try {
            return new OffscreenCanvas(1, 1).getContext('2d');
        } catch {
            // 继续尝试 DOM canvas
        }
    }
    if (typeof document === 'undefined') return null;
    try {
        return document.createElement('canvas').getContext('2d');
    } catch {
        return null;
    }
}

let sharedCanvasContext;
let customContextFactory = null;

/**
 * 注入一个 Canvas 2D 上下文工厂（测试用，也可用于嵌入式环境降级）。
 * 传 null 恢复为自动探测
 * `OffscreenCanvas` / `document.createElement('canvas')`。
 * @param {(() => CanvasRenderingContext2D | null) | null} factory
 */
export function setCanvasContextFactory(factory) {
    customContextFactory = factory;
    sharedCanvasContext = undefined;
}

function resolveCanvasContext() {
    if (customContextFactory) {
        return customContextFactory();
    }
    if (sharedCanvasContext === undefined) {
        sharedCanvasContext = getCanvasContext();
    }
    return sharedCanvasContext;
}

function segmentGraphemes(text) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(s => s.segment);
    }
    return [...text];
}

function segmentWords(text) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        return [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].map(s => s.segment);
    }
    // 退化方案：拉丁按空白切分，CJK 逐字切开。
    return text.match(/[\s]+|[^\s]+/g) ?? [text];
}

/**
 * 把一个段落切成「不可再断」的最小候选块序列。
 * CJK 字符各自成块（可在任意字间断行），拉丁词整体成块。
 * @param {string} paragraph
 * @param {string} wordBreak
 * @returns {string[]}
 */
function splitBreaks(paragraph, wordBreak) {
    const chunks = [];
    for (const token of segmentWords(paragraph)) {
        if (token === '') continue;
        if (CJK_CHAR_REGEX.test(token) && wordBreak !== 'keep-all') {
            chunks.push(...segmentGraphemes(token));
            continue;
        }
        chunks.push(token);
    }
    return chunks;
}

/**
 * 内置 Canvas 测量引擎：使用真实字体度量，零外部依赖。
 * popup / options 使用它；content 会替换为 pretext 引擎以获得更强的断行保真度。
 * @type {{ name: string, prepare: Function, measureLineStats: Function, measureNaturalWidth: Function }}
 */
export const canvasMeasurementEngine = {
    name: 'canvas',

    prepare(text, textStyle) {
        const context = resolveCanvasContext();
        if (!context) return null;
        context.font = textStyle.font;
        const { letterSpacing = 0 } = textStyle;
        const measure = (value) => {
            const base = context.measureText(value).width;
            if (!letterSpacing) return base;
            // 字距加在字与字之间，不计入行尾。
            return base + letterSpacing * Math.max(0, segmentGraphemes(value).length - 1);
        };
        const paragraphs = textStyle.whiteSpace === 'pre-wrap'
            ? text.split('\n')
            : [text.replace(/\s+/g, ' ').trim()];
        return { paragraphs, measure, wordBreak: textStyle.wordBreak };
    },

    measureLineStats(prepared, maxWidth) {
        let lineCount = 0;
        let maxLineWidth = 0;

        for (const paragraph of prepared.paragraphs) {
            if (paragraph === '') {
                lineCount += 1;
                continue;
            }
            const chunks = splitBreaks(paragraph, prepared.wordBreak);
            let current = '';
            let currentWidth = 0;
            // 行尾空白不计入行宽，所以空格先挂起，只有真接上后续内容才算数。
            let pendingSpace = '';

            const flush = () => {
                lineCount += 1;
                maxLineWidth = Math.max(maxLineWidth, currentWidth);
                current = '';
                currentWidth = 0;
            };

            for (const chunk of chunks) {
                if (/^\s+$/.test(chunk)) {
                    if (current !== '') pendingSpace = chunk;
                    continue;
                }

                const candidate = current + pendingSpace + chunk;
                const candidateWidth = prepared.measure(candidate);
                if (current !== '' && candidateWidth > maxWidth) {
                    flush();
                }
                pendingSpace = '';

                // 单词整体仍然超宽时，按字素硬断。
                if (prepared.measure(chunk) > maxWidth && segmentGraphemes(chunk).length > 1) {
                    for (const grapheme of segmentGraphemes(chunk)) {
                        const merged = current + grapheme;
                        if (current !== '' && prepared.measure(merged) > maxWidth) {
                            flush();
                        }
                        current += grapheme;
                        currentWidth = prepared.measure(current);
                    }
                    continue;
                }

                if (current === '') {
                    current = chunk;
                    currentWidth = prepared.measure(chunk);
                } else {
                    current += chunk;
                    currentWidth = candidateWidth;
                }
            }
            flush();
        }

        if (lineCount === 0) lineCount = 1;
        return { lineCount, maxLineWidth };
    },

    measureNaturalWidth(prepared) {
        return prepared.paragraphs.reduce((widest, paragraph) => (
            Math.max(widest, prepared.measure(paragraph))
        ), 0);
    },
};

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

export class TextMeasurementService {
    #engine = null;
    #preparedCache = new LruCache();
    #measurementCache = new LruCache();

    /**
     * 注入精确排版引擎（需要 `name` / `prepare` / `measureLineStats` / `measureNaturalWidth`）。
     * 传 null 可退回内置 Canvas 引擎。
     * @param {{name: string, prepare: Function, measureLineStats: Function, measureNaturalWidth: Function} | null} engine
     */
    setEngine(engine) {
        this.#engine = engine ?? null;
        this.clear();
    }

    /** 当前生效的引擎名（内置引擎为 'canvas'）。 */
    get engineName() {
        return this.#engine?.name ?? canvasMeasurementEngine.name;
    }

    /** Canvas 引擎是否可用 —— 所有引擎都建立在 Canvas 度量之上。 */
    isSupported() {
        return Boolean(resolveCanvasContext());
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
        const engine = this.#engine ?? canvasMeasurementEngine;

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
                source: engine.name,
            };
        }

        // 缓存键用模板字符串拼接：JSON.stringify 会把整段文本再转义复制一遍，
        // 而这张表在页面翻译时每个节点都要查一次。这里每个字段都是控制字符的自描述拼接，
        // 不会互相扭串。
        const measurementKey = `${engine.name}\u0000${textStyle.font}\u0000${textStyle.fontSize}\u0000${textStyle.lineHeight}\u0000${textStyle.letterSpacing}\u0000${textStyle.whiteSpace}\u0000${textStyle.wordBreak}\u0000${width}\u0000${min}\u0000${normalizedText}`;
        const cached = this.#measurementCache.get(measurementKey);
        if (cached) return cached;

        let result;
        const prepared = this.#prepare(engine, normalizedText, textStyle);
        if (prepared) {
            try {
                const stats = engine.measureLineStats(prepared, width);
                const naturalWidth = engine.measureNaturalWidth(prepared);
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
                    source: engine.name,
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

    #prepare(engine, text, textStyle) {
        const prepareKey = JSON.stringify([
            engine.name,
            text,
            textStyle.font,
            textStyle.whiteSpace,
            textStyle.wordBreak,
            textStyle.letterSpacing,
        ]);
        const cached = this.#preparedCache.get(prepareKey);
        if (cached) return cached;

        const prepared = engine.prepare(text, textStyle);
        if (prepared) {
            this.#preparedCache.set(prepareKey, prepared);
        }
        return prepared;
    }

    /**
     * 最后的兜底：没有任何可用 Canvas 时按平均字宽估算。
     * 正常情况下不会走到这里（扩展环境总有 Canvas）。
     */
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
