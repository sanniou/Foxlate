window.DisplayManager = class DisplayManager {
    static apply(element, translatedText, displayMode = 'replace') {
        const strategies = { // 确保这里的 key 与 popup.html 中的 value 一致
            replace: window.replaceStrategy,
            append: window.appendTranslationStrategy,
            contextMenu: window.contextMenuStrategy, // 添加新的 strategy
            hover: window.hoverStrategy,
        };
        const strategy = strategies[displayMode];
        if (strategy) {
            // 策略自身负责处理 DOM 修改和状态保存
            strategy.displayTranslation(element, translatedText); // 传递译文
            element.dataset.translationStrategy = displayMode;
            element.dataset.translated = "true";
            element.dataset.translatedText = translatedText; // 存储译文，以便切换模式时使用
            element.classList.add('universal-translator-translated');
        }
    }
    static revert(element) {
        const displayMode = element.dataset.translationStrategy;
        if (!displayMode) return;
        const strategies = {
            replace: window.replaceStrategy,
            append: window.appendTranslationStrategy,
            contextMenu: window.contextMenuStrategy, // 添加新的 strategy
            hover: window.hoverStrategy,
        };
        const strategy = strategies[displayMode];
        if (strategy) {
            // 策略自身负责恢复原始状态
            strategy.revertTranslation(element);
            element.classList.remove('universal-translator-translated');
        }
    }
    static showError(element, errorMessage) {
        element.classList.add('foxlate-error-underline');
        element.dataset.errorMessage = errorMessage;
        element.title = `Translation Error: ${errorMessage}`;
    }
    static updateDisplayMode(newDisplayMode) {
        const translatedElements = document.querySelectorAll('[data-translated="true"]');
        for (const element of translatedElements) {
            const translatedText = element.dataset.translatedText;
            if (translatedText) {
                // 首先，使用元素上记录的旧策略来恢复它
                this.revert(element);
                // 然后，使用新策略重新应用翻译
                this.apply(element, translatedText, newDisplayMode); 
            }
        }
    }
};