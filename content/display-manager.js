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
            // 保存原始文本到 data 属性
            if (!element.dataset.originalContent) {
                element.dataset.originalContent = element.innerHTML;
            }
            // 应用翻译
            strategy.displayTranslation(element, translatedText);
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
            // 从 data 属性中恢复原始文本
            if (element.dataset.originalContent) {
                strategy.revertTranslation(element, element.dataset.originalContent);
                delete element.dataset.originalContent; // 清理属性
            }
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
                this.revert(element);
                await this.apply(element, translatedText);
            }
        }
    }
};