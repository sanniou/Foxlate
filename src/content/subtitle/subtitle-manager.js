class SubtitleManager {
    constructor() {
        this.strategy = null; // Holds the single, registered strategy instance
        this.isEnabled = false; // Tracks the user's enabled/disabled state
        console.log("[SubtitleManager] Initialized and waiting for strategy registration.");
        this.#addMessageListener();
    }

    /**
     * Called by a strategy script (like youtube-subtitle-strategy.js) to register itself.
     * @param {class} StrategyClass The strategy class to be instantiated.
     */
    async registerStrategy(StrategyClass) {
        // Since the service worker only injects the script on the correct page,
        // we can be confident this is the right strategy. No need for isSupportedPage().
        if (!this.strategy) {
            console.log(`[SubtitleManager] Registering strategy: ${StrategyClass.name}`);
            this.strategy = new StrategyClass(this.onSubtitleChange.bind(this));
            // 注册后，检查设置，看是否需要自动启用。
            await this.#checkAndAutoEnable();
        } else {
            console.warn(`[SubtitleManager] A strategy is already registered. Ignoring new registration for ${StrategyClass.name}.`);
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
        const translatorEngine = effectiveSettings.translatorEngine;

        browser.runtime.sendMessage({
            type: 'TRANSLATE_TEXT',
            payload: { text, targetLang, sourceLang: 'auto', translatorEngine }
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

    /**
     * (新增) 当设置更新时，由 content-script 调用。
     * @param {object} newSettings - 最新的有效设置。
     */
    updateSettings(newSettings) {
        if (this.strategy && typeof this.strategy.updateSettings === 'function') {
            console.log('[SubtitleManager] Forwarding settings update to strategy.');
            this.strategy.updateSettings(newSettings);
        }
    }

    toggle(enabled) {
        this.isEnabled = enabled;
        if (this.strategy) {
            if (enabled) {
                console.log("[SubtitleManager] Enabling strategy.");
                this.strategy.initialize();
            } else {
                console.log("[SubtitleManager] Disabling strategy.");
                this.strategy.cleanup();
            }
        }
    }

    getStatus() {
        const isSupported = !!this.strategy;
        // isEnabled 直接从管理器自身状态获取
        return { isSupported, isEnabled: this.isEnabled };
    }

    // cleanup 方法现在不是必需的了，因为 toggle(false) 会处理
    // 但保留一个空的或轻量级的 cleanup 可能对未来有益
    cleanup() {
        if (this.strategy) {
            this.strategy.cleanup();
            this.isEnabled = false;
        }
    }

    /**
    * 检查用户设置，如果配置为自动开启，则自动启用策略。
    * @private
    */
    async #checkAndAutoEnable() {
        // 等待主内容脚本中的 getEffectiveSettings 函数可用。
        // 这是为了处理脚本加载顺序可能导致的问题。
        if (typeof window.getEffectiveSettings !== 'function') {
            console.log('[SubtitleManager] Waiting for getEffectiveSettings to become available...');
            await new Promise(resolve => {
                const interval = setInterval(() => {
                    if (typeof window.getEffectiveSettings === 'function') {
                        clearInterval(interval);
                        resolve();
                    }
                }, 100);
                // 设置一个超时（例如5秒），以防万一函数始终没有出现
                setTimeout(() => {
                    clearInterval(interval);
                    resolve();
                }, 5000);
            });
        }

        if (typeof window.getEffectiveSettings !== 'function') {
            console.error('[SubtitleManager] getEffectiveSettings did not become available. Cannot auto-enable.');
            return;
        }

        try {
            const settings = await window.getEffectiveSettings();
            // 检查域名规则或默认设置是否启用了字幕翻译
            if (settings?.subtitleSettings?.enabled) {
                console.log('[SubtitleManager] Subtitle translation is enabled by settings. Activating strategy.');
                this.toggle(true);
            }
        } catch (error) {
            console.error(`[SubtitleManager] Failed to check for auto-enable setting:`, error);
        }
    }
    /**
 * @private
 * 添加一个消息监听器来处理来自 popup 或其他部分的请求。
 */
    #addMessageListener() {
        browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.type) {
                case 'REQUEST_SUBTITLE_TRANSLATION_STATUS':
                    // Popup 请求当前字幕功能的状态
                    sendResponse(this.getStatus());
                    return true; // 异步响应
            }
        });
    }
}

// 初始化时，不再自动启动，而是等待来自 popup 的指令
window.subtitleManager = new SubtitleManager();