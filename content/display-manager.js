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
        const strategies = {
            replace: window.replaceStrategy,
            append: window.appendTranslationStrategy,
            contextMenu: window.contextMenuStrategy,
            hover: window.hoverStrategy,
        };
        
        for (const element of translatedElements) {
            const oldDisplayMode = element.dataset.translationStrategy;
            const translatedText = element.dataset.translatedText;
            
            if (!translatedText || oldDisplayMode === newDisplayMode) {
                continue;
            }
            
            const oldStrategy = strategies[oldDisplayMode];
            const newStrategy = strategies[newDisplayMode];
            
            if (oldStrategy && newStrategy) {
                // 1. 仅恢复旧策略引入的特定UI（例如，移除附加的span或事件监听器）。
                oldStrategy.revertTranslation(element);
                // 2. 应用新策略的UI。
                newStrategy.displayTranslation(element, translatedText);
                // 3. 只更新策略标识符。其他状态（如 .universal-translator-translated 类）保持不变。
                element.dataset.translationStrategy = newDisplayMode;
            }
        }
    }
};