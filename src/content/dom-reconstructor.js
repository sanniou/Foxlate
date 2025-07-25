/**
 * (已重构) 一个健壮的类，用于从带标签的文本重建DOM结构。
 * 它通过一个带有验证的栈模型来处理标签嵌套，并能正确处理预格式化文本。
 */
class DOMReconstructor {
    // (优化) 将正则表达式定义为静态常量，避免重复编译。
    static TAG_REGEX = /(<\/?\s*t\d+\s*>)/g;

    /**
     * @param {string} taggedText - 从翻译API返回的，包含 <t_id> 标签的文本。
     * @param {object} nodeMap - 从 DOMWalker 获取的，{t0: Element, t1: Element...} 映射表。
     */
    constructor(taggedText, nodeMap) {
        this.taggedText = taggedText;
        this.nodeMap = nodeMap;
        this.fragment = document.createDocumentFragment();
        // 使用一个栈来追踪当前父节点。栈顶始终是即将附加子节点的元素。
        this.parentStack = [this.fragment];
    }

    /**
     * 执行重建过程。
     * @returns {DocumentFragment} 包含重建后内容的可供插入的文档片段。
     * @throws {Error} 如果标签不匹配或有未闭合的标签，则抛出错误。
     */
    reconstruct() {
        const parts = this.taggedText.split(DOMReconstructor.TAG_REGEX).filter(Boolean);

        for (const part of parts) {
            const isTag = part.startsWith('<');
            if (isTag) {
                this.#processTag(part);
            } else {
                this.#processText(part);
            }
        }

        // (健壮性) 检查在重建结束后，是否所有标签都已正确闭合。
        if (this.parentStack.length !== 1) {
            const openTags = this.parentStack.slice(1).map(el => el._tagId).join(', ');
            throw new Error(`DOM reconstruction finished with unclosed tags: ${openTags}`);
        }

        return this.fragment;
    }

    #processTag(part) {
        const match = part.match(/<(\/)?\s*(t\d+)\s*>/);
        if (!match) return; // 忽略无效的标签格式

        const isClosing = !!match[1];
        const tagId = match[2];

        if (isClosing) {
            // (健壮性) 验证闭合标签是否与栈顶的开放标签匹配。
            const lastOpenedNode = this.parentStack[this.parentStack.length - 1];
            if (this.parentStack.length > 1 && lastOpenedNode._tagId === tagId) {
                this.parentStack.pop(); // 匹配成功，父节点出栈。
            } else {
                // 标签不匹配是严重错误，直接抛出，由调用方处理。
                throw new Error(`Mismatched closing tag. Expected </${lastOpenedNode._tagId}> but got ${part}.`);
            }
        } else { // 开放标签
            const nodeData = this.nodeMap[tagId];
            if (nodeData) {
                const newNode = nodeData.node.cloneNode(false);
                // 将元数据附加到新创建的节点上，供后续处理时使用。
                newNode._preservesWhitespace = nodeData.preservesWhitespace;
                newNode._tagId = tagId; // 存储标签ID用于闭合验证。

                this.parentStack[this.parentStack.length - 1].appendChild(newNode);
                this.parentStack.push(newNode); // 新节点成为新的父节点，入栈。
            } else {
                // 未知的标签ID也是严重错误。
                throw new Error(`Unknown translator tag ID found: ${part}`);
            }
        }
    }

    #processText(part) {
        const currentParent = this.parentStack[this.parentStack.length - 1];
        // 检查从 DOMWalker 传递过来的元数据。
        const isPreformatted = currentParent._preservesWhitespace === true;

        if (isPreformatted) {
            // 在预格式化上下文中，直接插入文本，浏览器会负责保留所有空白和换行符。
            currentParent.appendChild(document.createTextNode(part));
        } else {
            // 在常规上下文中，将翻译返回的换行符 `\n` 转换成 `<br>` 标签。
            const textParts = part.split('\n');
            textParts.forEach((text, i) => {
                if (text) {
                    currentParent.appendChild(document.createTextNode(text));
                }
                // 在每个部分之后（除了最后一个）添加一个 <br>。
                if (i < textParts.length - 1) {
                    currentParent.appendChild(document.createElement('br'));
                }
            });
        }
    }
}

/**
 * 从带标签的译文和节点映射表中重建DOM。
 * 这是一个工厂函数，它实例化并运行 DOMReconstructor。
 * @param {string} taggedText - 从翻译API返回的，包含 <t_id> 标签的文本。
 * @param {object} nodeMap - 从 DOMWalker 获取的，{t0: Element, t1: Element...} 映射表。
 * @returns {DocumentFragment} - 包含重建后内容的可供插入的文档片段。
 */
export function reconstructDOM(taggedText, nodeMap) {
    return new DOMReconstructor(taggedText, nodeMap).reconstruct();
}