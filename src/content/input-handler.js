import browser from '../lib/browser-polyfill.js';
import { InputIndicator } from './input-indicator.js';

// content-script.js 会将 getEffectiveSettings 暴露在 window 对象上
const getEffectiveSettings = window.getEffectiveSettings;

class InputHandler {
    constructor() {
        this.settings = null;
        this.keyPressCount = 0;
        this.lastKeypressTime = 0;
        this.isInitialized = false;
        this.indicator = new InputIndicator();
        console.log('[Foxlate] InputHandler constructor called');
    }

    async init() {
        console.log('[Foxlate] InputHandler.init() called, isInitialized:', this.isInitialized);
        if (this.isInitialized) {
            console.log('[Foxlate] InputHandler already initialized, skipping');
            return;
        }
        
        // 直接使用 window.getEffectiveSettings，因为它是全局暴露的
        if (!window.getEffectiveSettings) {
            console.log('[Foxlate] window.getEffectiveSettings not available');
            return;
        }

        try {
            const effectiveSettings = await window.getEffectiveSettings();
            console.log('[Foxlate] Effective settings received:', effectiveSettings);
            
            this.settings = effectiveSettings.inputTranslationSettings;
            console.log('[Foxlate] Input handler settings:', this.settings);

            if (!this.settings) {
                console.log('[Foxlate] Input handler settings not found');
                return;
            }
            
            if (!this.settings.enabled) {
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
            console.log('[Foxlate] Input handler initialized successfully');
        } catch (error) {
            console.error('[Foxlate] Error initializing input handler:', error);
        }
    }

    attachEventListeners() {
        console.log('[Foxlate] Attaching event listeners');
        this.boundHandleKeydown = this.handleKeydown.bind(this);
        document.addEventListener('keydown', this.boundHandleKeydown, true);
        console.log('[Foxlate] Event listeners attached');
    }

    handleKeydown(event) {
        console.log('[Foxlate] Keydown event:', event.key, event.code, 'target:', event.target.tagName, 'value:', event.target.value || event.target.textContent);
        
        // 1. 处理连续按键触发
        if (this.settings.keyTriggerEnabled) {
            this.handleConsecutiveKeyPress(event);
        }

        // 如果事件已被处理（例如，被连续按键触发），则不再继续处理魔法词
        if (event.defaultPrevented) {
            return;
        }

        // 2. 处理魔法词触发
        // 使用 requestAnimationFrame 延迟检查，以确保在按键事件后输入框的值已更新
        requestAnimationFrame(() => {
            this.handleMagicWord(event.target);
        });
    }

    handleConsecutiveKeyPress(event) {
        const { consecutiveKey, consecutiveKeyPresses } = this.settings;
        console.log('[Foxlate] Consecutive key check:', 'event.key:', event.key, 'event.code:', event.code, 'expected:', consecutiveKey, 'count:', this.keyPressCount);
        
        // 修复：同时检查 event.code 和 event.key，以兼容不同设置
        if (event.code !== consecutiveKey && event.key !== consecutiveKey) {
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

        console.log('[Foxlate] Key press count:', this.keyPressCount, 'required:', consecutiveKeyPresses);

        if (this.keyPressCount >= consecutiveKeyPresses) {
            this.keyPressCount = 0;
            
            // (修复) 在调用 preventDefault 之前获取文本，并手动追加触发字符。
            // `preventDefault` 会阻止空格等字符被输入，因此我们需要在翻译前手动将其添加到文本中。
            let text = target.isContentEditable ? target.textContent : target.value;
            if (event.key.length === 1) { // 只追加可打印字符
                text += event.key;
            }
            
            console.log('[Foxlate] Triggering translation via consecutive key, text:', text);
            event.preventDefault();
            this.triggerTranslation(target, text);
        }
    }

    handleMagicWord(target) {
        const triggerWord = this.settings.triggerWord;
        if (!triggerWord) return;

        const isEditable = target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
        if (!isEditable) return;

        const currentText = target.isContentEditable ? target.textContent : target.value;
        console.log('[Foxlate] Magic word check:', 'currentText:', currentText, 'triggerWord:', triggerWord);
        
        // 修复：改进正则表达式匹配，允许魔法词后跟其他内容
        // 正则表达式匹配: (文本) //(语言-)(触发词)(可选分隔符)
        // 示例: "some text //ja-fox" 或 "hello //fox world"
        const regex = new RegExp(`^(.*?)\s*\/\/(?:([\w-]+)-)?(${this.escapeRegex(triggerWord)})(?:\\s|$)`);
        const match = currentText.match(regex);
        
        console.log('[Foxlate] Magic word regex match:', match);

        if (match) {
            const textToTranslate = (match[1] || '').trim();
            const langAlias = match[2]?.toUpperCase(); // 转换为大写以便于映射
            
           let targetLangOverride = null; // 默认为 null，表示使用默认设置
            if (langAlias) {
                // 1. 检查语言别名映射
                if (this.settings.languageMapping && this.settings.languageMapping[langAlias]) {
                    targetLangOverride = this.settings.languageMapping[langAlias];
                } 
                // 2. 如果映射中没有，检查它本身是否是一个有效的项目语言代码
                else if (window.foxlateSupportedLanguages && window.foxlateSupportedLanguages.includes(langAlias)) {
                    targetLangOverride = langAlias;
                }
                // 3. 如果都不是，targetLangOverride 保持为 null，后台将使用默认语言
            }

            // 从输入框中移除魔法词及其后的可选分隔符
            const afterMatch = currentText.substring(match[0].length);
            const newText = textToTranslate + (afterMatch ? ' ' + afterMatch : '');
            
            console.log('[Foxlate] Triggering translation via magic word, text:', textToTranslate, 'langAlias:', langAlias);
            
            if (target.isContentEditable) {
                target.textContent = newText;
            } else {
                target.value = newText;
            }

            this.triggerTranslation(target, textToTranslate, targetLangOverride);
        }
    }

    async triggerTranslation(target, text, targetLangOverride = null) {
        if (!text || !text.trim()) {
            return;
        }

        this.indicator.show(target);

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
            this.indicator.hide();
        }
    }
    
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
    }
}

export function initializeInputHandler() {
    console.log('[Foxlate] Initializing input handler...');
    // content-script.js 应该已经在 window 上暴露了 getEffectiveSettings
    if (window.getEffectiveSettings) {
        console.log('[Foxlate] getEffectiveSettings is available, creating handler...');
        const handler = new InputHandler();
        handler.init();
    } else {
        console.error('[Foxlate] Could not initialize InputHandler because getEffectiveSettings is not available.');
    }
}