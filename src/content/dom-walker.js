// --- 标签定义 ---
// 通过将标签按职责分类并组合，可以提高可读性和可维护性。

// 纯粹的结构性块级标签，其内容将被处理，但标签本身不会被保留。
const STRUCTURAL_BLOCK_TAGS = new Set([
    'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV'
]);

// 需要保留格式的内联标签。
const PRESERVABLE_INLINE_TAGS = new Set([
    // (已优化) 移除了 'SPAN'。SPAN 标签常用于非结构化的样式微调，保留它们会生成过于复杂的翻译文本，
    // 极易被翻译引擎破坏。移除它可以极大提高翻译的健壮性，代价是丢失一些纯样式。
    'A', 'B', 'I', 'EM', 'STRONG', 'CODE', 'U', 'S', 'SUB', 'SUP'
]);

// 需要保留格式的块级标签。
const PRESERVABLE_BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE',
    'TABLE', 'TR', 'TH', 'TD', 'FIGURE', 'FIGCAPTION', 'ADDRESS', 'HR'
]);

// 定义在遍历时应完全跳过的标签。
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);

// 通过组合基本集合来构建最终的标签集。
// 1. 所有需要保留格式的标签（内联 + 块级）。
const PRESERVABLE_TAGS = new Set([...PRESERVABLE_INLINE_TAGS, ...PRESERVABLE_BLOCK_TAGS]);
// 2. 所有属于块级布局的标签（结构性 + 可保留的块级）。
const BLOCK_LEVEL_TAGS = new Set([...STRUCTURAL_BLOCK_TAGS, ...PRESERVABLE_BLOCK_TAGS]);


/**
 * A utility class for traversing a container element's DOM.
 */
export class DOMWalker {
    /**
     * (新) 通过深度遍历DOM，将元素内容解构为带标签的文本和节点映射表。
     * 这是实现格式保留翻译的核心。
     * @param {HTMLElement} rootElement - The element to process.
     * @returns {{sourceText: string, translationUnit: {nodeMap: object}}|null}
     */
    static create(rootElement) {
        // --- 性能优化：快速预检查 ---
        // 在进行昂贵的DOM遍历之前，先执行一些快速检查，以提前排除不合格的元素。

        // (新) 检查此元素是否为由 'append' 策略添加的翻译容器。
        // 如果是，则直接跳过，以防止重复翻译。
        if (rootElement.dataset.foxlateAppendedText === 'true') {
            return null;
        }

        // 1. 检查内容：如果元素（及其后代）根本不包含任何文本，则无需处理。
        //    这是一个非常快速且有效的检查。
        if (!rootElement.textContent.trim()) {
            return null;
        }
        // 2. 检查可见性：如果元素的渲染尺寸为0，则它对用户不可见，无需翻译。
        //    这可以捕获 `display: none` 或其他导致元素不占用空间的样式。
        const rect = rootElement.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            return null;
        }

        let sourceText = ''; // 这将是带 <t_id> 标签的文本
        const nodeMap = {};
        let tagIndex = 0;

        const ensureSeparator = () => {
            if (sourceText.length > 0 && !/\s$/.test(sourceText)) {
                sourceText += '\n';
            }
        };

        /**
         * 递归遍历DOM节点。
         * @param {Node} node - 当前遍历的节点。
         * @param {boolean} inPreformattedContext - 指示当前是否处于一个保留空白的上下文中（如 <pre>）。
         */
        function walk(node, inPreformattedContext) {
            for (const child of node.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) { // 文本节点
                    let text = child.nodeValue;
                    // 如果不在预格式化上下文中，则模拟浏览器的行为，将多个连续的空白字符（包括换行符）折叠成一个空格。
                    // 这可以从根本上防止因源代码格式化而导致的意外换行问题。
                    if (!inPreformattedContext) {
                        text = text.replace(/\s+/g, ' ');
                    }
                    sourceText += text;
                } else if (child.nodeType === Node.ELEMENT_NODE) { // 元素节点
                    const tagName = child.tagName.toUpperCase();
                    // 关键：跳过不需要翻译的脚本和样式块
                    if (SKIPPED_TAGS.has(tagName)) continue;

                    // (新) 将 <br> 标签显式地转换成一个换行符，以保留其格式。
                    if (tagName === 'BR') {
                        sourceText += '\n';
                        continue;
                    }

                    // 决定元素是否应作为块级分隔符。
                    // 这取决于它是语义上的块级标签（如 P, DIV）还是通过 CSS 被设置为块级显示（如 <span style="display:block">）。
                    const isSemanticallyBlock = BLOCK_LEVEL_TAGS.has(tagName);
                    const isKnownInline = PRESERVABLE_INLINE_TAGS.has(tagName);
                    let isVisuallyBlock = false;
                    // 如果一个标签既不是已知的块级标签，也不是已知的内联标签（例如 SPAN），
                    // 我们需要检查它的 CSS display 属性来判断它是否在布局上起到了分隔作用。
                    if (!isSemanticallyBlock && !isKnownInline) {
                        const style = window.getComputedStyle(child);
                        // 任何非 'inline' 的显示类型通常都会在布局中产生一个断点，应被视为一个块。
                        if (style.display !== 'inline') {
                            isVisuallyBlock = true;
                        }
                    }
                    const actsAsBlock = isSemanticallyBlock || isVisuallyBlock;
                    const isPreservable = PRESERVABLE_TAGS.has(tagName);

                    // 步骤 1: 为块级元素添加前导分隔符
                    if (actsAsBlock) ensureSeparator();

                    // 步骤 2: 处理元素内容
                    if (isPreservable) {
                        const tagId = `t${tagIndex++}`;
                        // (新) 检查元素的 white-space 样式，以决定是否保留换行符。
                        // 这个信息将传递给 dom-reconstructor。
                        const style = window.getComputedStyle(child);
                        const whiteSpace = style.whiteSpace;
                        const preservesWhitespace = whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'pre-line';
                        nodeMap[tagId] = {
                            node: child.cloneNode(false),
                            preservesWhitespace: preservesWhitespace
                        };
                        sourceText += `<${tagId}>`;
                        // 将此元素自身的格式化上下文传递给递归调用。
                        walk(child, preservesWhitespace);
                        sourceText += `</${tagId}>`;
                    } else {
                        // 对于结构性但非保留的标签（如 DIV），它们继承父级的格式化上下文。
                        walk(child, inPreformattedContext);
                    }

                    // 步骤 3: 为块级元素添加尾随分隔符
                    if (actsAsBlock) ensureSeparator();
                }
            }
        }

        // 在开始遍历之前，确定根元素自身的格式化上下文。
        const rootStyle = window.getComputedStyle(rootElement);
        const rootPreservesWhitespace = ['pre', 'pre-wrap', 'pre-line'].includes(rootStyle.whiteSpace);
        walk(rootElement, rootPreservesWhitespace);

        const trimmedSourceText = sourceText.trim();

        if (!trimmedSourceText) return null;

        // 返回带标签的源文本和用于重建的节点映射表
        return {
            sourceText: trimmedSourceText,
            translationUnit: { nodeMap }
        };
    }
}