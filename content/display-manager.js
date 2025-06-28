window.DisplayManager = class DisplayManager {
    static #originalContent = new Map();

    // findTextNodes 保持不变，因为它用于发现需要翻译的元素，而不是保存状态。
    static #findTextNodes(rootNode) {
        const textNodes = [];
        if (!rootNode || rootNode.nodeType !== Node.ELEMENT_NODE) {
            return textNodes;
        }
        const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
            acceptNode: function(node) {
                const parentTag = node.parentElement.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'textarea', 'code'].includes(parentTag)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (node.nodeValue.trim() === '') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }
        return textNodes;
    }

    static async apply(element, translatedText) {
        const strategies = {
            replace: window.replaceStrategy,
            append: window.appendTranslationStrategy,
            hover: window.hoverStrategy,
        };

        const { settings } = await browser.storage.sync.get('settings');
        const displayMode = settings?.displayMode || 'replace';
        const strategy = strategies[displayMode];

        if (strategy) {
            // 保存原始内容，如果是文本节点，则只保存该节点的内容
            if (!this.#originalContent.has(element)) {
                // 检查是否为文本节点的父元素（通过我们设置的data-translation-id属性）
                if (element.dataset.translationId && element.dataset.translationId.startsWith('ut-')) {
                    // 找到元素中的所有文本节点
                    const textNodes = this.#findTextNodes(element);
                    // 保存原始内容
                    this.#originalContent.set(element, {
                        innerHTML: element.innerHTML,
                        textNodes: textNodes.map(node => ({
                            node,
                            content: node.textContent
                        }))
                    });
                } else {
                    // 对于非文本节点的父元素，保持原有行为
                    this.#originalContent.set(element, element.innerHTML);
                }
            }

            // 应用翻译
            strategy.displayTranslation(element, translatedText);
            element.dataset.translationStrategy = displayMode;
            element.dataset.translated = "true";
            element.dataset.translatedText = translatedText;
        }
    }

    static revert(element) {
        const displayMode = element.dataset.translationStrategy;
        if (!displayMode) return;

        const strategies = {
            replace: window.replaceStrategy,
            append: window.appendTranslationStrategy,
            hover: window.hoverStrategy,
        };
        const strategy = strategies[displayMode];

        if (strategy) {
            // 获取保存的原始内容
            const originalContent = this.#originalContent.get(element);
            
            // 检查是否为文本节点的父元素
            if (originalContent && typeof originalContent === 'object' && originalContent.textNodes) {
                // 恢复文本节点的内容
                strategy.revertTranslation(element, originalContent.innerHTML);
                
                // 额外处理：确保文本节点内容完全恢复
                const currentTextNodes = this.#findTextNodes(element);
                originalContent.textNodes.forEach((saved, index) => {
                    if (currentTextNodes[index]) {
                        currentTextNodes[index].textContent = saved.content;
                    }
                });
            } else {
                // 对于非文本节点的父元素，保持原有行为
                strategy.revertTranslation(element, originalContent);
            }

            this.#originalContent.delete(element);
        }
    }

    static showError(element, errorMessage) {
        element.classList.add('universal-translator-error');
        element.dataset.errorMessage = errorMessage;
        element.title = `Translation Error: ${errorMessage}`;
    }

    static async updateDisplayMode(newDisplayMode) {
        const translatedElements = document.querySelectorAll('[data-translated="true"]');
        for (const element of translatedElements) {
            const translatedText = element.dataset.translatedText;
            if (translatedText) {
                // 这里的 revert 会使用新的逻辑，正确传递 innerHTML
                this.revert(element);
                // apply 会重新保存状态并应用新策略
                await this.apply(element, translatedText);
            }
        }
    }
};