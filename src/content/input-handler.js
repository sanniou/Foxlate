import browser from '../lib/browser-polyfill.js';

// content-script.js 会将 getEffectiveSettings 暴露在 window 对象上
const getEffectiveSettings = window.getEffectiveSettings;

class InputHandler {
    constructor() {
        this.settings = null;
        this.keyPressCount = 0;
        this.lastKeypressTime = 0;
        this.isInitialized = false;
    }

    async init() {
        if (this.isInitialized || !getEffectiveSettings) return;

        const effectiveSettings = await getEffectiveSettings();
        this.settings = effectiveSettings.inputTranslationSettings;

        if (!this.settings || !this.settings.enabled) {
            console.log('[Foxlate] Input handler disabled globally.');
            return;
        }

        const isBlacklisted = this.settings.blacklist && this.settings.blacklist.some(domain => window.location.hostname.includes(domain));
        if (isBlacklisted) {
            console.log(`[Foxlate] Input handler disabled on blacklisted domain: ${window.location.hostname}`);
            return;
        }

        this.attachEventListeners();
        this.isInitialized = true;
        console.log('[Foxlate] Input handler initialized with settings:', this.settings);
    }

    attachEventListeners() {
        // 使用箭头函数以保留 'this' 上下文
        this.boundHandleKeydown = (e) => this.handleConsecutiveKeyPress(e);
        this.boundHandleInput = (e) => this.handleMagicWord(e);

        if (this.settings.keyTriggerEnabled) {
            document.addEventListener('keydown', this.boundHandleKeydown, true);
        }
        // 如果功能启用，“魔法词”触发器始终开启
        document.addEventListener('input', this.boundHandleInput, true);
    }

    handleConsecutiveKeyPress(event) {
        const { consecutiveKey, consecutiveKeyPresses } = this.settings;
        if (event.code !== consecutiveKey) {
            this.keyPressCount = 0;
            return;
        }

        const target = event.target;
        const isEditable = target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        if (!isEditable) {
            this.keyPressCount = 0;
            return;
        }

        const currentTime = Date.now();
        if (currentTime - this.lastKeypressTime > 500) { // 500ms 间隔
            this.keyPressCount = 1;
        } else {
            this.keyPressCount++;
        }
        this.lastKeypressTime = currentTime;

        if (this.keyPressCount >= consecutiveKeyPresses) {
            this.keyPressCount = 0;
            event.preventDefault();
            const text = target.isContentEditable ? target.textContent : target.value;
            this.triggerTranslation(target, text);
        }
    }

    handleMagicWord(event) {
        const triggerWord = this.settings.triggerWord;
        if (!triggerWord) return;

        const target = event.target;
        const isEditable = target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        if (!isEditable) return;

        const currentText = target.isContentEditable ? target.textContent : target.value;
        
        // 正则表达式匹配: (文本) //(语言-)(触发词)
        // 示例: "some text //ja-fox"
        const regex = new RegExp(`(.*?)\s*\/\/(?:([\w-]+)-)?(${this.escapeRegex(triggerWord)})$`);
        const match = currentText.match(regex);

        if (match) {
            const textToTranslate = match[1].trim();
            const langAlias = match[2];
            
            let targetLangOverride = null;
            if (langAlias && this.settings.languageMapping) {
                // 优先完全匹配，然后尝试部分匹配（例如 ‘中文’ 匹配 ‘中文繁体’）
                targetLangOverride = this.settings.languageMapping[langAlias];
            }

            // 从输入框中移除魔法词
            if (target.isContentEditable) {
                target.textContent = textToTranslate;
            } else {
                target.value = textToTranslate;
            }

            this.triggerTranslation(target, textToTranslate, targetLangOverride);
        }
    }

    async triggerTranslation(target, text, targetLangOverride = null) {
        if (!text || !text.trim()) {
            return;
        }

        const originalBackgroundColor = target.style.backgroundColor;
        target.style.backgroundColor = '#f0f8ff'; // 视觉指示器

        try {
            const payload = { text };
            if (targetLangOverride) {
                payload.targetLang = targetLangOverride;
            }

            const result = await browser.runtime.sendMessage({
                type: 'translateInputText',
                payload: payload
            });

            if (result && result.translatedText) {
                if (target.isContentEditable) {
                    target.textContent = result.translatedText;
                } else {
                    target.value = result.translatedText;
                }
            }
        } catch (error) {
            console.error('Foxlate: Input translation failed.', error);
        } finally {
            target.style.backgroundColor = originalBackgroundColor;
        }
    }
    
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
    }
}

export function initializeInputHandler() {
    // content-script.js 应该已经在 window 上暴露了 getEffectiveSettings
    if (window.getEffectiveSettings) {
        const handler = new InputHandler();
        handler.init();
    } else {
        console.error('[Foxlate] Could not initialize InputHandler because getEffectiveSettings is not available.');
    }
}