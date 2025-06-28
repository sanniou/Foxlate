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
            // **修改点 1: 保存 innerHTML 而不是 textContent**
            if (!this.#originalContent.has(element)) {
                this.#originalContent.set(element, element.innerHTML);
            }

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
            // **修改点 2: 将保存的 originalHTML 传递给策略**
            const originalHTML = this.#originalContent.get(element);
            strategy.revertTranslation(element, originalHTML);

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