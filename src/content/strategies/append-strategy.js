window.appendTranslationStrategy = {
    /**
     * @private
     * Determines the correct CSS class for the appended node based on the parent's display style.
     * @param {HTMLElement} element - The wrapper element (`<font>`) to check against.
     * @returns {string} The base class name ('foxlate-appended-text' or 'foxlate-appended-text foxlate-appended-block').
     */
    _getAppendClassName: function(element) {
      const parent = element.parentElement;
      if (!parent) {
          return 'foxlate-appended-text'; // Default to inline if no parent
      }

      // --- Rule 1: Parent is a clear paragraph-like tag ---
      // If the parent is a semantic block-level tag, its content is a block.
      const paragraphLikeTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'DD', 'DT', 'FIGCAPTION']);
      if (paragraphLikeTags.has(parent.tagName)) {
          return 'foxlate-appended-text foxlate-appended-block';
      }

      // --- Rule 2: Parent is a generic container (like DIV), check the *next* sibling ---
      // This handles cases where a text node is not wrapped in a <p> but is followed by a block element.
      let nextSibling = element.nextSibling;
      // Skip over any whitespace-only text nodes to find the next meaningful element.
      while (nextSibling && nextSibling.nodeType === Node.TEXT_NODE && nextSibling.nodeValue.trim() === '') {
          nextSibling = nextSibling.nextSibling;
      }

      // If the next significant sibling is a block-level element, our text is likely the end of a line/paragraph.
      if (nextSibling && nextSibling.nodeType === Node.ELEMENT_NODE) {
          const nextSiblingStyle = window.getComputedStyle(nextSibling);
          if (nextSiblingStyle.display === 'block') {
              return 'foxlate-appended-text foxlate-appended-block';
          }
      }

      // --- Default ---
      // In all other cases (e.g., text followed by inline elements or nothing), default to a simple inline append.
      return 'foxlate-appended-text';
    },

    /**
     * 在元素后面追加一个包含译文的节点。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} translatedText - 翻译后的文本。
     */
    displayTranslation: function(element, translatedText) {
        // 查找已有的翻译 font 标签，有则更新，无则创建
        let translationNode = element.querySelector(".foxlate-appended-text");

        if (translationNode) {
            // Node exists, just update it.
            translationNode.textContent = translatedText;
        } else {
            // This path is a fallback for cases where the node wasn't created during the LOADING state.
            const className = this._getAppendClassName(element);
            this.createTranslationNode(element, translatedText, className);
        }
    },
    createTranslationNode: function(element, textContent, className = 'foxlate-appended-text') {
        let translationNode = document.createElement('span');
        translationNode.className = className; // 类名用于标识和还原
        translationNode.textContent = textContent;
        element.appendChild(translationNode);
    },

    updateUI: function(element, state) {
        let translationNode = element.querySelector('.foxlate-appended-text');

        switch (state) {
            case window.DisplayManager.STATES.ORIGINAL:
                this.revertTranslation(element);
                break;
            case window.DisplayManager.STATES.LOADING:
                if (translationNode) {
                    translationNode.textContent = '';
                    translationNode.classList.add('loading');
                } else {
                    const className = this._getAppendClassName(element) + ' loading';
                    this.createTranslationNode(element,  '', className);
                }
                break;
            case window.DisplayManager.STATES.TRANSLATED:
                const translatedText = element.dataset.translatedText;
                if (translatedText) {
                    this.displayTranslation(element, translatedText);
                    element.querySelector('.foxlate-appended-text')?.classList.remove('loading', 'error');
                } else {
                    this.revertTranslation(element);
                }
                break;
            case window.DisplayManager.STATES.ERROR:
                // 不再直接移除，而是在追加的节点中显示错误信息
                if (!translationNode) {
                    // 如果节点不存在（例如，加载状态之前就出错了），则创建一个
                    this.createTranslationNode(element, '', 'foxlate-appended-text');
                    translationNode = element.querySelector('.foxlate-appended-text');
                }

                if (translationNode) {
                    const errorMessage = element.dataset.errorMessage || 'Unknown error';
                    const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';

                    translationNode.classList.remove('loading');
                    translationNode.classList.add('error'); // 添加 error 类以便 CSS 设置样式
                    translationNode.textContent = `${errorPrefix}: ${errorMessage}`;
                }
                break;
            default:
                console.warn(`[Append Strategy] Unknown state: ${state}`);
        }
    },

    /**
     * 移除追加的翻译节点。
     * @param {HTMLElement} element - 目标元素。
     */
    revertTranslation: function(element) {
        // 移除所有由这个策略添加的节点
        element.querySelectorAll('.foxlate-appended-text').forEach(node => {
            if (node) {
                node.remove();
            }
        });
    }
};