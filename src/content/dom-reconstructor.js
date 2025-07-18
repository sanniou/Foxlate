/**
 * 从带标签的译文和节点映射表中重建DOM。
 * @param {string} taggedText - 从翻译API返回的，包含 <t_id> 标签的文本。
 * @param {object} nodeMap - 从 DOMWalker 获取的，{t0: Element, t1: Element...} 映射表。
 * @returns {DocumentFragment} - 包含重建后内容的可供插入的文档片段。
 */
export function reconstructDOM(taggedText, nodeMap) {
    // 正则表达式用于分割文本和我们的自定义标签
    const regex = /(<\/?\s*t\d+\s*>)/g; // 更宽松的正则，允许标签内部有空格
    const parts = taggedText.split(regex).filter(Boolean); // filter(Boolean) 移除空字符串

    const fragment = document.createDocumentFragment();
    const parentStack = [fragment]; // 使用一个栈来追踪当前父节点

    for (const part of parts) {
        const match = part.match(/<(\/)?\s*(t\d+)\s*>/); // 匹配更宽松的标签格式

        if (match) {
            const isClosing = !!match[1];
            const tagId = match[2];

            if (isClosing) {
                if (parentStack.length > 1) parentStack.pop(); // 遇到闭合标签，父节点出栈
                else console.warn(`[DOM Reconstructor] 遇到不匹配的闭合标签: ${part}`);
            } else { // 开放标签
                const nodeData = nodeMap[tagId];
                if (nodeData) {
                    // 从映射表克隆节点。
                    // 使用 cloneNode(false) 因为 nodeData.node 本身就是一个没有子节点的浅克隆模板。
                    // 这使得代码意图更清晰，尽管行为上与 cloneNode(true) 在此场景下相同。
                    const newNode = nodeData.node.cloneNode(false);
                    parentStack[parentStack.length - 1].appendChild(newNode);
                    // (新) 将 preservesWhitespace 元数据附加到新创建的节点上，供后续文本节点处理时使用。
                    newNode._preservesWhitespace = nodeData.preservesWhitespace;
                    parentStack.push(newNode); // 新节点成为新的父节点，入栈
                } else console.warn(`[DOM Reconstructor] 遇到未知的翻译器标签: ${part}`);
            }
        } else {
            // 是纯文本部分。
            const currentParent = parentStack[parentStack.length - 1];
            // (新) 检查从 DOMWalker 传递过来的元数据，而不是硬编码的标签名。
            // 这种方法更健壮，可以处理通过 CSS `white-space: pre` 定义的元素。
            const isPreformatted = currentParent._preservesWhitespace === true;

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