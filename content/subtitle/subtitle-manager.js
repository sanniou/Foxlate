import { YouTubeSubtitleStrategy } from './youtube-subtitle-strategy.js';
// 未来可在此处导入其他网站的策略
import { BilibiliSubtitleStrategy } from './bilibili-subtitle-strategy.js';

class SubtitleManager {
    constructor() {
        this.activeStrategy = null;
        // 在此注册所有可用的策略
        this.availableStrategies = [
            YouTubeSubtitleStrategy,
            BilibiliSubtitleStrategy,
        ];
    }

    /**
     * 查找并初始化当前页面匹配的字幕策略。
     */
    initialize() {
        this.cleanup();

        for (const Strategy of this.availableStrategies) {
            // 策略需要能静态地判断页面是否受支持
            if (Strategy.isSupportedPage()) {
                console.log(`[SubtitleManager] Found matching strategy: ${Strategy.name}`);
                this.activeStrategy = new Strategy(this.onSubtitleChange.bind(this));
                this.activeStrategy.initialize();
                break; // 找到第一个匹配的策略后即停止
            }
        }
    }

    /**
     * 传递给策略的回调函数，当检测到新字幕时由策略调用。
     * @param {string} text - 检测到的字幕文本。
     * @param {HTMLElement} element - 包含字幕的 DOM 元素。
     */
    async onSubtitleChange(text, element) {
        // 此逻辑从旧的 content-script 中移至此处
        const effectiveSettings = await window.getEffectiveSettings();
        if (!effectiveSettings) {
            logError('onSubtitleChange', new Error("Could not get effective settings."));
            return;
        }
        const targetLang = effectiveSettings.targetLanguage;

        browser.runtime.sendMessage({
            type: 'TRANSLATE_TEXT',
            payload: { text, targetLang, sourceLang: 'auto' }
        }).then(response => {
            if (response.success && response.translatedText.translated) {
                this.displayTranslatedSubtitle(element, response.translatedText.text);
            } else if (response.error) {
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                this.displayTranslatedSubtitle(element, `${errorPrefix}: ${response.error}`, true);
            }
        }).catch(error => {
            logError('subtitleTranslationCallback', error);
            const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
            this.displayTranslatedSubtitle(element, `${errorPrefix}: ${error.message}`, true);
        });
    }

    /**
     * 在页面上显示翻译好的字幕。
     * @param {HTMLElement} originalElement - 原始字幕元素。
     * @param {string} translatedText - 翻译后的文本。
     * @param {boolean} isError - 是否为错误信息。
     */
    displayTranslatedSubtitle(originalElement, translatedText, isError = false) {
        if (!originalElement || !document.body.contains(originalElement)) return;

        const containerClass = 'foxlate-subtitle-translation-container';
        let translationContainer = originalElement.querySelector(`.${containerClass}`);

        if (!translationContainer) {
            translationContainer = document.createElement('div');
            translationContainer.className = containerClass;
            translationContainer.style.cssText = `text-align: center; font-size: 0.9em; opacity: 0.85; margin-top: 4px; pointer-events: none;`;
            originalElement.appendChild(translationContainer);
        }

        translationContainer.textContent = translatedText;
        translationContainer.classList.toggle('error', isError);
        translationContainer.style.color = isError ? '#FF5252' : '#42a5f5';
    }

    toggle(enabled) {
        enabled ? this.initialize() : this.cleanup();
    }

    getStatus() {
        return this.activeStrategy ? this.activeStrategy.getStatus() : { enabled: false, disabled: true };
    }

    cleanup() {
        if (this.activeStrategy) {
            this.activeStrategy.cleanup();
            this.activeStrategy = null;
        }
    }
}

window.subtitleManager = new SubtitleManager();