/**
 * 从带标签的译文和节点映射表中重建DOM。
 * @param {string} taggedText - 从翻译API返回的，包含 <t_id> 标签的文本。
 * @param {object} nodeMap - 从 DOMWalker 获取的，{t0: Element, t1: Element...} 映射表。
 * @returns {DocumentFragment} - 包含重建后内容的可供插入的文档片段。
 */
export function reconstructDOM(taggedText, nodeMap) {
    // 正则表达式用于分割文本和我们的自定义标签
    const regex = /(<t\d+>|<\/t\d+>)/g;
    const parts = taggedText.split(regex).filter(Boolean); // filter(Boolean) 移除空字符串

    const fragment = document.createDocumentFragment();
    const parentStack = [fragment]; // 使用一个栈来追踪当前父节点

    for (const part of parts) {
        const match = part.match(/<(\/)?(t\d+)>/);

        if (match) {
            const isClosing = !!match[1];
            const tagId = match[2];

            if (isClosing) {
                if (parentStack.length > 1) parentStack.pop(); // 遇到闭合标签，父节点出栈
                else console.warn(`[DOM Reconstructor] 遇到不匹配的闭合标签: ${part}`);
            } else { // 开放标签
                const nodeShell = nodeMap[tagId];
                if (nodeShell) {
                    const newNode = nodeShell.cloneNode(true); // 从映射表克隆节点
                    parentStack[parentStack.length - 1].appendChild(newNode);
                    parentStack.push(newNode); // 新节点成为新的父节点，入栈
                } else console.warn(`[DOM Reconstructor] 遇到未知的翻译器标签: ${part}`);
            }
        } else {
            // 是纯文本部分。
            // 关键优化：检查当前上下文是否为预格式化（如在 <pre> 或 <code> 标签内）。
            const currentParent = parentStack[parentStack.length - 1];
            // 检查当前直接父节点是否为预格式化标签。
            // 这是一个简单而有效的检查，因为 walk() 保证了 <pre> 和 <code> 自身会被保留为 <t_id> 标签。
            const isPreformatted = currentParent.nodeName === 'PRE' || currentParent.nodeName === 'CODE';

            if (isPreformatted) {
                // 在预格式化上下文中，直接插入文本，保留所有空白和换行符。
                currentParent.appendChild(document.createTextNode(part));
            } else {
                // 在常规上下文中，将翻译返回的换行符转换成 <br> 标签。
                const textParts = part.split('\n');
                textParts.forEach((text, i) => {
                    if (text) currentParent.appendChild(document.createTextNode(text));
                    if (i < textParts.length - 1) currentParent.appendChild(document.createElement('br'));
                });
            }
        }
    }
    if (parentStack.length !== 1) console.warn("[DOM Reconstructor] DOM重建结束时有未闭合的标签。");
    return fragment;
}