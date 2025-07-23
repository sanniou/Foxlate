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
     * @private
     * @static
     * 使用混合方法确定元素的追加类型 ('inline' 或 'block')。
     * 此方法优先考虑用户定义的 CSS 选择器，然后回退到启发式分析。
     *
     * @param {HTMLElement} element - 要分类的元素。
     * @param {object} config - 当前生效的配置，包含用户定义的选择器。
     * @param {string} [config.block] - 应视为块级的 CSS 选择器。
     * @param {string} [config.inline] - 应视为内联的 CSS 选择器。
     * @returns {'inline' | 'block'} - 确定的追加类型。
     */
    static #determineAppendType(element, config) {
        // 1. 用户配置优先 (最高优先级)
        if (config.block && element.matches(config.block)) {
            return 'block';
        }
        if (config.inline && element.matches(config.inline)) {
            return 'inline';
        }

        // 2. 启发式分析作为后备方案
        const blockChildSelectors = 'p, div, h1, h2, h3, h4, h5, h6, li, tr, td, th, blockquote, pre, section, article, header, footer, nav, aside, form, hr, table';
        if (element.querySelector(blockChildSelectors) || (element.textContent || '').trim().length > 80) {
            return 'block';
        }

        const style = window.getComputedStyle(element);
        const display = style.display;
        if (['block', 'flex', 'grid', 'table', 'list-item'].includes(display) || style.float !== 'none') {
            return 'block';
        }

        if (display.startsWith('inline')) {
            return 'inline';
        }

        // 3. 安全的默认值
        return 'inline';
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
        // --- 性能优化：快速预检查 ---
        // 在进行昂贵的DOM遍历之前，先执行一些快速检查，以提前排除不合格的元素。

        // (新) 检查 aria-hidden 属性。如果元素或其任何祖先对辅助技术是隐藏的，
        // 那么它在语义上就是不可见的，因此不应该被翻译。
        if (rootElement.closest('[aria-hidden="true"]')) {
            return null;
        }

        // (新) 检查此元素或其父元素是否匹配排除选择器，并添加了错误处理。
        if (config.exclude) {
            try {
                if (rootElement.closest(config.exclude)) {
                    return null;
                }
            } catch (e) {
                // 如果选择器无效，记录错误并忽略该规则，而不是使整个脚本崩溃。
                console.error(`[Foxlate] Invalid exclude selector in configuration: "${config.exclude}". Translation will proceed.`, e);
            }
        }

        // (新) 检查 contenteditable 属性。如果元素是可编辑的，则不应翻译，以避免干扰用户输入。
        // isContentEditable 是一个继承属性，所以这个检查也覆盖了父元素可编辑的情况。
        if (rootElement.isContentEditable) {
            return null;
        }

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
                    // (新) 优化空白拼接逻辑。
                    // 如果 sourceText 已经以空白结尾，并且新的文本片段以空白开头，
                    // 则移除新片段的起始空白，以防止出现连续的多个空格。
                    if (/\s$/.test(sourceText) && /^\s/.test(text)) {
                        sourceText += text.trimStart();
                    } else {
                        sourceText += text;
                    }
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    // (新) 在遍历期间检查元素是否匹配排除规则。
                    // 这修复了只排除顶层容器而不排除其内部匹配元素的缺陷。
                    if (config.exclude) {
                        try {
                            if (child.matches(config.exclude)) {
                                continue; // 如果匹配，则跳过此元素及其所有子元素。
                            }
                        } catch (e) {
                            // 错误已在顶层处理，此处静默失败以避免控制台垃圾信息。
                        }
                    }

                    // (新) 检查 aria-hidden 属性。如果一个子元素被标记为对辅助技术隐藏，
                    // 那么它在语义上也是不可见的，应该被跳过。
                    // 这修复了顶层元素可见但其部分子元素被隐藏的场景。
                    if (child.getAttribute('aria-hidden') === 'true') {
                        continue;
                    }

                    // (新) 检查 contenteditable 属性，跳过可编辑的区域以避免干扰用户。
                    // 这处理了在一个可翻译块内部嵌套一个可编辑区域的情况。
                    if (child.isContentEditable) {
                        continue;
                    }

                    const tagName = child.tagName.toUpperCase();
                    // 关键：跳过不需要翻译的脚本和样式块
                    if (SKIPPED_TAGS.has(tagName)) continue;

                    // (新) 将 <br> 标签显式地转换成一个换行符，以保留其格式。
                    if (tagName === 'BR') {
                        sourceText += '\n';
                        continue;
                    }

                    // (新) 检查子元素的可见性。如果元素的渲染尺寸为0，则它对用户不可见，无需翻译。
                    // 这可以捕获 `display: none` 或其他导致元素不占用空间的样式。
                    // 这个检查在 <br> 标签处理之后，以确保换行符不会被错误地跳过。
                    const rect = child.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) {
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

                    // 步骤 1: 为块级元素添加前导分隔符（换行）
                    if (actsAsBlock) ensureSeparator();

                    // 步骤 2: 处理元素内容
                    if (isPreservable) {
                        const textLengthBefore = sourceText.length;
                        const tagId = `t${tagIndex}`; // 暂时不递增索引

                        // (新) 检查元素的 white-space 样式，以决定是否保留换行符。
                        // 这个信息将传递给 dom-reconstructor。
                        const style = window.getComputedStyle(child);
                        const whiteSpace = style.whiteSpace;
                        const preservesWhitespace = whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'pre-line';

                        // 乐观地添加起始标签，如果子节点为空则后续移除。
                        sourceText += `<${tagId}>`;
                        const openingTagLength = sourceText.length;

                        // 将此元素自身的格式化上下文传递给递归调用。
                        walk(child, preservesWhitespace);

                        // 检查递归调用是否向 sourceText 添加了任何有效内容。
                        const contentAdded = sourceText.substring(openingTagLength).trim();

                        if (contentAdded) {
                            // 如果确实添加了内容，则完成标签的创建。
                            nodeMap[tagId] = {
                                node: child.cloneNode(false),
                                preservesWhitespace: preservesWhitespace
                            };
                            sourceText += `</${tagId}>`;
                            tagIndex++; // 只有在确认标签有效后才递增索引。
                        } else {
                            // 如果没有添加任何内容，则回滚，移除之前添加的起始标签。
                            sourceText = sourceText.substring(0, textLengthBefore);
                        }
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

        // (新) 调用混合决策系统来确定追加类型
        const appendType = DOMWalker.#determineAppendType(rootElement, config);

        // 返回带标签的源文本和用于重建的节点映射表
        return {
            sourceText: trimmedSourceText,
            translationUnit: {
                nodeMap,
                appendType // 存储确定的追加类型
            }
        };
    }
}