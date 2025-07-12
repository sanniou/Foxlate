const BLOCK_LEVEL_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE',
    'PRE', 'TD', 'TH', 'TR', 'TABLE', 'SECTION', 'ARTICLE', 'HEADER',
    'FOOTER', 'ASIDE', 'NAV', 'ADDRESS', 'FIGURE', 'FIGCAPTION', 'HR'
]);

// (新) 定义需要保留格式的内联标签
const PRESERVABLE_INLINE_TAGS = new Set(['A', 'B', 'I', 'EM', 'STRONG', 'CODE', 'U', 'S', 'SUB', 'SUP', 'SPAN']);

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
        let sourceText = ''; // 这将是带 <t_id> 标签的文本
        const nodeMap = {};
        let tagIndex = 0;

        function walk(node, isPreformatted = false) {
            // 遍历当前节点的所有子节点
            for (const child of Array.from(node.childNodes)) {
                if (child.nodeType === Node.TEXT_NODE) {
                    if (isPreformatted) {
                        // 在预格式化上下文中，保留所有空白字符
                        sourceText += child.nodeValue;
                    } else {
                        // 在常规上下文中，将多个空白字符（包括换行符）合并为单个空格，以模拟浏览器的行为。
                        sourceText += child.nodeValue.replace(/\s+/g, ' ');
                    }
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    const tagName = child.tagName.toUpperCase();
                    // 关键：跳过不需要翻译的脚本和样式块
                    if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT') {
                        continue;
                    }

                    // 如果当前标签是 PRE 或 CODE，则其所有子节点都处于预格式化上下文中。
                    const newPreformattedContext = isPreformatted || tagName === 'PRE' || tagName === 'CODE';

                    if (PRESERVABLE_INLINE_TAGS.has(tagName)) {
                        const tagId = `t${tagIndex++}`;
                        // 仅存储节点的“外壳”（标签名和属性），不包含其子节点
                        nodeMap[tagId] = child.cloneNode(false);
                        
                        sourceText += `<${tagId}>`;
                        walk(child, newPreformattedContext); // 递归处理子节点
                        sourceText += `</${tagId}>`;
                    } else if (BLOCK_LEVEL_TAGS.has(tagName)) {
                        if (sourceText.length > 0 && !sourceText.endsWith('\n')) sourceText += '\n';
                        walk(child, newPreformattedContext);
                        if (sourceText.length > 0 && !sourceText.endsWith('\n')) sourceText += '\n';
                    } else {
                        walk(child, newPreformattedContext);
                    }
                }
            }
        }

        walk(rootElement, false);
        const trimmedSourceText = sourceText.trim();

        if (!trimmedSourceText) return null;

        // 返回带标签的源文本和用于重建的节点映射表
        // 临时兼容：添加一个空的 originalNodes 数组，以通过 DisplayManager 中过时的验证。
        // 最终的解决方案应该是移除或更新 DisplayManager 中的验证逻辑。
        return {
            sourceText: trimmedSourceText,
            translationUnit: { nodeMap, originalNodes: [] }
        };
    }
}