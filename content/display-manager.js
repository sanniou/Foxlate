window.DisplayManager = class DisplayManager {
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
            // 策略自身负责处理 DOM 修改和状态保存
            strategy.displayTranslation(element, translatedText); // 传递译文
            element.dataset.translationStrategy = displayMode;
            element.dataset.translated = "true";
            element.dataset.translatedText = translatedText;
            element.classList.add('universal-translator-translated');
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
            // 策略自身负责恢复原始状态
            strategy.revertTranslation(element);
            element.classList.remove('universal-translator-translated');
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
                // 首先，使用元素上记录的旧策略来恢复它
                this.revert(element);
                // 然后，使用新策略重新应用翻译（apply会从设置中读取新模式）
                await this.apply(element, translatedText); 
            }
        }
    }
};