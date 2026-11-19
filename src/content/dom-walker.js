// --- 标签定义 ---
// 通过将标签按职责分类并组合，可以提高可读性和可维护性。
import { SKIPPED_TAGS } from '../common/constants.js';

// 纯粹的结构性块级标签，其内容将被处理，但标签本身不会被保留。
const STRUCTURAL_BLOCK_TAGS = new Set([
    'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FORM'
]);

// 需要保留格式的内联标签。
const PRESERVABLE_INLINE_TAGS = new Set([
    // (已优化) 移除了 'SPAN'。SPAN 标签常用于非结构化的样式微调，保留它们会生成过于复杂的翻译文本，
    // 极易被翻译引擎破坏。移除它可以极大提高翻译的健壮性，代价是丢失一些纯样式。
    'A', 'B', 'I', 'EM', 'STRONG', 'CODE', 'U', 'S', 'SUB', 'SUP'
]);

const PRESERVABLE_BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE',
    'TABLE', 'TR', 'TH', 'TD', 'FIGURE', 'FIGCAPTION', 'ADDRESS',
    'UL', 'OL', 'DL', 'DT', 'DD' // 推荐新增
]);

/**
 * 原子保留标签：自身不包含可翻译文本，但在重建译文时必须原位复活。
 *
 * 以前它们不属于「可保留标签」，而 `#collectPreservableElement` 只在「子节点里有实质文本」
 * 时才记录标签——图片/视频/内联控件没有任何文本，于是被静默丢掉。replace 模式实测：
 * 维基信息框 `<td>` 里 `img 1→0`、GitHub README `<li>` 里 `code 3→0`。
 * 这类丢失对用户是可见的数据损失。
 */
const PRESERVABLE_ATOMIC_TAGS = new Set([
    'IMG', 'PICTURE', 'SVG', 'VIDEO', 'AUDIO', 'IFRAME', 'CANVAS', 'OBJECT', 'EMBED',
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON' // 表单控件同样是用户可感知的内容
]);

// 通过组合基本集合来构建最终的标签集。
// 1. 所有需要保留格式的标签（内联 + 块级）。
const PRESERVABLE_TAGS = new Set([...PRESERVABLE_INLINE_TAGS, ...PRESERVABLE_BLOCK_TAGS]);
// 2. 所有属于块级布局的标签（结构性 + 可保留的块级）。
const BLOCK_LEVEL_TAGS = new Set([...STRUCTURAL_BLOCK_TAGS, ...PRESERVABLE_BLOCK_TAGS]);

// --- 常量定义 ---
const BLOCK_TEXT_LENGTH_THRESHOLD = 60; // 用于判断文本是否为块级的长度阈值
const BLOCK_CHILD_SELECTORS = Array.from(BLOCK_LEVEL_TAGS).map(tag => tag.toLowerCase()).join(', ');

/**
 * A utility class for traversing a container element's DOM.
 */
export class DOMWalker {

    /**
     * (已优化) 检查元素在视觉上是否对用户可见。
     * 此函数通过一个分层的、成本递增的检查策略来优化性能：
     * 1. (最快) 检查基本的 CSS 样式属性，这些操作不会触发浏览器重排。
     * 2. (次快) 检查 `offsetParent` 属性，这是一个无需重排的 DOM 属性，可以快速排除被隐藏容器包裹的元素。
     * 3. (最慢) 最后才访问 `offsetWidth`/`offsetHeight`，这会强制浏览器进行重排（reflow/layout），是成本最高的操作。
     * @param {HTMLElement} element - 要检查的元素。
     * @param {function(HTMLElement): CSSStyleDeclaration} getCachedStyle - 用于获取缓存样式的函数。
     * @returns {boolean} 如果元素可见，则返回 true。
     */
    static #isElementVisible(element, getCachedStyle) {
        // 步骤 1: 快速的、无重排的样式检查
        const style = getCachedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
            return false;
        }

        // 步骤 2: 快速的、无重排的 DOM 属性检查，以避免不必要的布局计算。
        // `offsetParent` 为 null 通常意味着元素不可见（例如，在 `display:none` 的容器内）。
        // 我们需要处理那些 `offsetParent` 为 null 但元素仍然可见的例外情况。
        if (element.offsetParent === null) {
            const tagName = element.tagName.toUpperCase();
            // 例外：根元素 (HTML, BODY) 和固定/粘性定位的元素，它们的 offsetParent 可能为 null 但它们是可见的。
            // 对于所有其他情况，offsetParent 为 null 意味着元素是隐藏的。
            if (tagName !== 'HTML' && tagName !== 'BODY' && style.position !== 'fixed' && style.position !== 'sticky') {
                return false;
            }
        }

        // 步骤 3: 最后的、成本最高的检查，它会强制浏览器进行重排。
        return element.offsetWidth > 0 || element.offsetHeight > 0;
    }

    /**
     * (新) 执行一个轻量级的、无重排的可见性预检查。
     * 此方法用于在高频场景（如 MutationObserver）中快速过滤掉明显不可见的元素。
     * @param {HTMLElement} element - 要检查的元素。
     * @param {function(HTMLElement): CSSStyleDeclaration} getCachedStyle - 用于获取缓存样式的函数。
     * @returns {boolean} 如果元素可能是可见的，则返回 true。
     */
    static isPotentiallyVisible(element, getCachedStyle) {
        const style = getCachedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
        }

        if (element.offsetParent === null) {
            const tagName = element.tagName.toUpperCase();
            if (tagName !== 'HTML' && tagName !== 'BODY' && style.position !== 'fixed' && style.position !== 'sticky') {
                return false;
            }
        }

        return true;
    }

    /**
     * @private
     * @static
     * 使用混合方法确定元素的追加类型 ('inline' 或 'block')。
     * 此方法优先考虑用户定义的 CSS 选择器，然后回退到启发式分析。
     *
     * @param {HTMLElement} element - 要分类的元素。
     * @param {object} config - 当前生效的配置，包含用户定义的选择器。
     * @param {string} [config.block] - 应视为块级的 CSS 选择器。
     * @param {string} [config.inline] - 应视为内联的 CSS 选择器
     * @param {function(HTMLElement): CSSStyleDeclaration} getCachedStyle - (修改) 用于获取缓存样式的函数。。
     * @returns {'inline' | 'block'} - 确定的追加类型。
     */
    static #determineAppendType(element, config, getCachedStyle) {
        // 1. 优先基于计算样式，因为它是最权威的布局信息源。
        const style = getCachedStyle(element);
        const display = style.display;

        // 任何非 'inline' 的显示类型（如 block, flex, grid, list-item 等）
        // 通常都会在布局中产生一个断点，应被视为块级。
        if (display !== 'inline') {
            return 'block';
        }

        // 2. 对于 `display: inline` 的元素，应用启发式规则作为补充。
        //    - 如果一个内联元素包含任何块级子元素，它在结构上应被视为块级。
        //    - 如果一个内联元素包含非常长的文本，为了在追加翻译时获得更好的可读性和布局，
        //      也应将其提升为块级处理（例如，用 <div> 包裹而不是 <span>）。
        if (element.querySelector(BLOCK_CHILD_SELECTORS) || (element.textContent || '').trim().length > BLOCK_TEXT_LENGTH_THRESHOLD) {
            return 'block';
        }

        // 3. 如果以上条件都不满足，则安全地将其视为内联元素。
        return 'inline';
    }

    /**
     * 一次性样式解析器：同一次遍历中每个元素只取一次 computedStyle。
     * 可见性判断会用到它，成本必须摊薄。
     */
    static #createStyleResolver() {
        const styleCache = new WeakMap();
        return (element) => {
            if (styleCache.has(element)) {
                return styleCache.get(element);
            }
            const style = window.getComputedStyle(element);
            styleCache.set(element, style);
            return style;
        };
    }

    /** 该元素的 white-space 样式是否要求保留换行符。 */
    static #preservesWhitespace(style) {
        const whiteSpace = style.whiteSpace;
        return whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'pre-line';
    }

    /**
     * 追加一个文本片段。两个数组必须同步追加（segments 带标签、plainTextSegments 是纯文本）。
     *
     * 此处曾有一层「上一段以非空白结尾且本段以非空白开头 → push(text.trimStart())」的
     * 分支，但进入该分支的前提就是首字符非空白，trimStart 必然无操作，两个分支完全等价。
     * 已按等价形式改写；若确实想要「不足空格」那是行为变更，需单独决策。
     */
    static #appendSegment(state, text) {
        state.segments.push(text);
        state.plainTextSegments.push(text);
    }

    /** 块级元素之间补一个换行分隔符；已经以空白结尾时不补。 */
    static #ensureSeparator(state) {
        const lastSegment = state.segments[state.segments.length - 1] || '';
        if (state.segments.length === 0 || lastSegment.length === 0) {
            return;
        }
        // 尾随空白在此上下文只可能是文本节点规范化产生的 ' ' 或 <br> 产生的 '\n'，
        // 直接比较字符比正则快，且逻辑等价。
        const lastChar = lastSegment[lastSegment.length - 1];
        if (lastChar === ' ' || lastChar === '\n') {
            return;
        }
        state.segments.push('\n');
        state.plainTextSegments.push('\n');
    }

    /**
     * 遍历前的快速排查。顺序从最便宜到最贵，尽早放弃：
     * contenteditable → 已追加的译文容器 → aria-hidden → 排除选择器 → Foxlate 自身 UI
     * → 无文本 → 可见性（最贵，放在最后）。
     */
    static #isObviouslyUntranslatable(rootElement, config) {
        // isContentEditable 是继承属性，因此也覆盖「父元素可编辑」的情况
        if (rootElement.isContentEditable) {
            return true;
        }

        // 防止对 'append' 策略已经写入的译文再次翻译
        if (rootElement.dataset.foxlateAppendedText === 'true') {
            return true;
        }

        if (rootElement.closest('[aria-hidden="true"]')) {
            return true;
        }

        if (config.exclude) {
            try {
                if (rootElement.closest(config.exclude)) {
                    return true;
                }
            } catch (e) {
                // 无效选择器只忽略这一条规则，不能让整个脚本崩掉
                console.error(`[Foxlate] Invalid exclude selector in configuration: "${config.exclude}". Translation will proceed.`, e);
            }
        }

        // Foxlate 自身的 UI（例如摘要面板）不应被翻译
        if (rootElement.closest('[class^="foxlate-"], [class*=" foxlate-"]')) {
            return true;
        }

        return !rootElement.textContent.trim();
    }

    /** 子节点级的跳过判定：排除选择器、显式不翻译区域、Foxlate UI、lang、aria-hidden、可编辑区、脚本样式。 */
    static #shouldSkipChild(child, state) {
        if (state.exclude) {
            try {
                if (child.matches(state.exclude)) {
                    return true; // 跳过此元素及其全部子元素
                }
            } catch {
                // 无效选择器已在顶层上报过，此处静默跳过以免刷屏
            }
        }

        // 不能因为 html/body 上的 lang 跳过整页正文；这里只作用于子节点，根元素不在此列
        if (child.closest('.notranslate, [translate="no"], [class^="foxlate-"], [class*=" foxlate-"]')) {
            return true;
        }
        if (child.getAttribute('lang')?.trim()) {
            return true;
        }
        if (child.getAttribute('aria-hidden') === 'true') {
            return true;
        }
        if (child.isContentEditable) {
            return true;
        }

        return SKIPPED_TAGS.has(child.tagName.toUpperCase());
    }

    /**
     * 元素是否在布局上起分隔作用：语义块级标签直接算；
     * 既不是已知块级也不是已知内联的标签（例如 SPAN）看 CSS display。
     */
    static #actsAsBlock(child, tagName, getCachedStyle) {
        if (BLOCK_LEVEL_TAGS.has(tagName)) {
            return true;
        }
        if (PRESERVABLE_INLINE_TAGS.has(tagName)) {
            return false;
        }
        return getCachedStyle(child).display !== 'inline';
    }

    /** 文本节点：不在预格式化上下文时折叠空白，然后追加。 */
    static #collectTextNode(node, inPreformattedContext, state) {
        const text = inPreformattedContext ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ');
        DOMWalker.#appendSegment(state, text);
    }

    /**
     * 原子元素：用一个空的 `<tN></tN>` 对占位，重建时 `cloneNode(false)` 原样插回。
     * 里面没有可翻译文本，所以不需要走子节点遍历。
     */
    static #collectAtomicElement(child, state) {
        const tagId = `t${state.tagIndex++}`;
        state.nodeMap[tagId] = {
            node: child.cloneNode(false),
            preservesWhitespace: false,
            atomic: true,
        };
        state.segments.push(`<${tagId}>`, `</${tagId}>`);
    }

    /**
     * 保留格式的元素：用 <tN> 包裹其内容，并记录重建所需的节点信息。
     * 起始标签是乐观写入的——子节点最终没有实质内容时回滚。
     */
    static #collectPreservableElement(child, state) {
        const segmentsLengthBefore = state.segments.length;
        const tagId = `t${state.tagIndex++}`;
        const preservesWhitespace = DOMWalker.#preservesWhitespace(state.getCachedStyle(child));

        state.segments.push(`<${tagId}>`);
        const openingTagIndex = state.segments.length;

        DOMWalker.#walk(child, preservesWhitespace, state);

        const contentAdded = state.segments.slice(openingTagIndex).some(segment => segment.trim() !== '');
        if (!contentAdded) {
            state.segments.length = segmentsLengthBefore;
            return;
        }

        state.nodeMap[tagId] = {
            node: child.cloneNode(false),
            preservesWhitespace,
        };
        state.segments.push(`</${tagId}>`);
    }

    /** 元素节点：先过跳过判定，再按块级/内联方式收集内容。 */
    static #collectElementNode(child, inPreformattedContext, state) {
        if (DOMWalker.#shouldSkipChild(child, state)) {
            return;
        }

        const tagName = child.tagName.toUpperCase();

        // <br> 显式转成换行符以保留格式
        if (tagName === 'BR') {
            state.segments.push('\n');
            state.plainTextSegments.push('\n');
            return;
        }

        // 可见性检查在 <br> 之后，否则换行符会被错误地跳过
        if (!DOMWalker.#isElementVisible(child, state.getCachedStyle)) {
            return;
        }

        const actsAsBlock = DOMWalker.#actsAsBlock(child, tagName, state.getCachedStyle);

        if (actsAsBlock) {
            DOMWalker.#ensureSeparator(state);
        }

        if (PRESERVABLE_TAGS.has(tagName)) {
            DOMWalker.#collectPreservableElement(child, state);
        } else if (PRESERVABLE_ATOMIC_TAGS.has(tagName)) {
            DOMWalker.#collectAtomicElement(child, state);
        } else {
            // 结构性但非保留的标签（如 DIV）继承父级的格式化上下文
            DOMWalker.#walk(child, inPreformattedContext, state);
        }

        if (actsAsBlock) {
            DOMWalker.#ensureSeparator(state);
        }
    }

    /**
     * 深度遍历节点，把内容拆成「带 <tN> 标签的文本」与「纯文本」两组同步的片段，
     * 同时把重建译文所需的节点信息记进 nodeMap。
     */
    static #walk(node, inPreformattedContext, state) {
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                DOMWalker.#collectTextNode(child, inPreformattedContext, state);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                DOMWalker.#collectElementNode(child, inPreformattedContext, state);
            }
        }
    }

    /**
     * (新) 通过深度遍历DOM，将元素内容解构为带标签的文本和节点映射表。
     * 这是实现格式保留翻译的核心。
     * @param {HTMLElement} rootElement - The element to process.
     * @param {object} [config={}] - 包含选择器配置的对象。
     * @param {string} [config.inline] - 应视为内联的 CSS 选择器。
     * @param {string} [config.block] - 应视为块级的 CSS 选择器。
     * @param {string} [config.exclude] - 应排除翻译的 CSS 选择器。
     * @returns {{sourceText: string, translationUnit: object}|null}
     */
    static create(rootElement, config = {}) {
        if (DOMWalker.#isObviouslyUntranslatable(rootElement, config)) {
            return null;
        }

        const getCachedStyle = DOMWalker.#createStyleResolver();

        // 可见性检查成本最高（会触发布局计算），放在所有廉价排查之后
        if (!DOMWalker.#isElementVisible(rootElement, getCachedStyle)) {
            return null;
        }

        const state = {
            segments: [],           // 带 <tN> 标签的文本
            plainTextSegments: [],  // 与 segments 同步追加的纯文本
            nodeMap: {},
            tagIndex: 0,
            exclude: config.exclude,
            getCachedStyle,
        };

        // 根元素自身的格式化上下文会向下传递
        DOMWalker.#walk(rootElement, DOMWalker.#preservesWhitespace(getCachedStyle(rootElement)), state);

        const sourceText = state.segments.join('').trim();
        const plainText = state.plainTextSegments.join('').trim();

        // 用纯文本判断是否有有效内容（带标签的文本在只含 <tN></tN> 时仍非空）
        if (!plainText) {
            return null;
        }

        return {
            sourceText,
            plainText,
            translationUnit: {
                nodeMap: state.nodeMap,
                appendType: DOMWalker.#determineAppendType(rootElement, config, getCachedStyle),
            },
        };
    }
}
