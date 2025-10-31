import browser from '../lib/browser-polyfill.js';
import { InputIndicator } from './input-indicator.js';
import * as Constants from '../common/constants.js';

// content-script.js 会将 getEffectiveSettings 暴露在 window 对象上
const getEffectiveSettings = window.getEffectiveSettings;

// 性能优化：使用防抖处理魔法词检测
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

class InputHandler {
    constructor() {
        this.settings = null;
        this.keyPressCount = 0;
        this.lastKeypressTime = 0;
        this.lastKeyPressed = null;
        this.isInitialized = false;
        this.indicator = new InputIndicator();
        this.debounceMagicWord = debounce(this.handleMagicWord.bind(this), 300);
        this.activeTargets = new WeakSet(); // 跟踪正在处理的输入框，避免重复处理
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
        
        // 添加清理事件监听器的能力
        this.boundDestroy = this.destroy.bind(this);
        console.log('[Foxlate] Event listeners attached');
    }

    handleKeydown(event) {
        // 性能优化：减少不必要的日志输出
        if (this.settings.debugMode) {
            console.log('[Foxlate] Keydown event:', event.key, event.code, 'target:', event.target.tagName);
        }
        
        // 1. 处理连续按键触发
        if (this.settings.keyTriggerEnabled) {
            this.handleConsecutiveKeyPress(event);
        }

        // 如果事件已被处理（例如，被连续按键触发），则不再继续处理魔法词
        if (event.defaultPrevented) {
            return;
        }

        // 2. 处理魔法词触发 - 使用防抖优化性能
        // 只对可编辑元素进行处理
        const isEditable = event.target && (event.target.isContentEditable ||
                           event.target.tagName === 'INPUT' ||
                           event.target.tagName === 'TEXTAREA');
        
        if (isEditable) {
            this.debounceMagicWord(event.target);
        }
    }

    handleConsecutiveKeyPress(event) {
        const { consecutiveKey, consecutiveKeyPresses } = this.settings;
        
        if (this.settings.debugMode) {
            console.log('[Foxlate] Consecutive key check:', 'event.key:', event.key, 'expected:', consecutiveKey, 'count:', this.keyPressCount);
        }
        
        // 检查是否为指定的触发键
        const isTriggerKey = event.code === consecutiveKey || event.key === consecutiveKey;
        if (!isTriggerKey) {
            this.keyPressCount = 0;
            this.lastKeyPressed = null;
            return;
        }

        const target = event.target;
        const isEditable = target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
        if (!isEditable) {
            this.keyPressCount = 0;
            this.lastKeyPressed = null;
            return;
        }

        const currentTime = Date.now();
        
        // 检查是否为连续按下的同一个键
        if (this.lastKeyPressed === consecutiveKey && currentTime - this.lastKeypressTime <= 500) {
            // 在500ms内按下同一个键，增加计数
            this.keyPressCount++;
        } else {
            // 重置计数，开始新的连续按键序列
            this.keyPressCount = 1;
        }
        
        this.lastKeypressTime = currentTime;
        this.lastKeyPressed = consecutiveKey;

        if (this.settings.debugMode) {
            console.log('[Foxlate] Key press count:', this.keyPressCount, 'required:', consecutiveKeyPresses);
        }

        if (this.keyPressCount >= consecutiveKeyPresses) {
            this.keyPressCount = 0;
            this.lastKeyPressed = null;
            
            // 获取文本内容，改进对富文本编辑器的支持
            let text = this.getTextContent(target);
            
            // 改进：更精确地处理特殊键（如空格、回车等）
            if (this.shouldAppendKey(event.key)) {
                text += this.getKeyRepresentation(event.key);
            }
            
            if (this.settings.debugMode) {
                console.log('[Foxlate] Triggering translation via consecutive key, text:', text);
            }
            event.preventDefault();
            this.triggerTranslation(target, text);
        }
    }

    handleMagicWord(target) {
        const triggerWord = this.settings.triggerWord;
        if (!triggerWord) return;

        const isEditable = target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
        if (!isEditable) return;

        // 防止重复处理同一个输入框
        if (this.activeTargets.has(target)) {
            return;
        }

        const currentText = this.getTextContent(target);
        
        if (this.settings.debugMode) {
            console.log('[Foxlate] Magic word check:', 'currentText:', currentText, 'triggerWord:', triggerWord);
        }
        
        // 改进：更灵活的正则表达式匹配，支持多种分隔符
        // 正则表达式匹配: (文本) (分隔符) (语言-)(触发词)(可选分隔符)
        // 示例: "some text //ja-fox" 或 "hello //fox world"
        const regex = new RegExp(`^(.*?)\\s*(?:\\/\\/|##)(?:\\s*([\\w-]+)\\s*-\\s*)?(${this.escapeRegex(triggerWord)})(?:\\s|$)`, 'i');
        const match = currentText.match(regex);
        
        if (this.settings.debugMode) {
            console.log('[Foxlate] Magic word regex match:', match);
        }

        if (match) {
            // 标记正在处理
            this.activeTargets.add(target);
            
            const textToTranslate = (match[1] || '').trim();
            const langAlias = match[2]?.toUpperCase(); // 转换为大写以便于映射
            
            let targetLangOverride = null; // 默认为 null，表示使用默认设置
            if (langAlias) {
                // 1. 检查语言别名映射
                if (this.settings.languageMapping && this.settings.languageMapping[langAlias]) {
                    targetLangOverride = this.settings.languageMapping[langAlias];
                }
                // 2. 如果别名映射中没有，检查是否为标准语言代码
                else if (Constants.SUPPORTED_LANGUAGES[langAlias]) {
                    targetLangOverride = langAlias;
                }
                // 3. 检查是否为语言值的映射（如 'EN' 对应 'langEN'）
                else if (Object.values(Constants.SUPPORTED_LANGUAGES).includes(langAlias)) {
                    // 查找语言代码对应的键
                    const langCode = Object.keys(Constants.SUPPORTED_LANGUAGES).find(
                        key => Constants.SUPPORTED_LANGUAGES[key] === langAlias
                    );
                    if (langCode) {
                        targetLangOverride = langCode;
                    }
                }
                // 如果都不是，targetLangOverride 保持为 null，后台将使用默认语言
            }

            // 从输入框中移除魔法词及其后的可选分隔符
            const afterMatch = currentText.substring(match[0].length);
            const newText = textToTranslate + (afterMatch ? ' ' + afterMatch : '');
            
            if (this.settings.debugMode) {
                console.log('[Foxlate] Triggering translation via magic word, text:', textToTranslate, 'langAlias:', langAlias);
            }
            
            this.setTextContent(target, newText);
            this.triggerTranslation(target, textToTranslate, targetLangOverride);
            
            // 处理完成后清除标记
            setTimeout(() => {
                this.activeTargets.delete(target);
            }, 1000);
        }
    }

    async triggerTranslation(target, text, targetLangOverride = null) {
        if (!text || !text.trim()) {
            return;
        }

        // 添加翻译前验证
        if (text.length > 5000) {
            console.warn('[Foxlate] Text too long for translation:', text.length);
            return;
        }

        this.indicator.show(target);

        try {
            const payload = {
                text,
                source: 'inputHandler',
                timestamp: Date.now()
            };
            if (targetLangOverride) {
                payload.targetLang = targetLangOverride;
            }

            const result = await browser.runtime.sendMessage({
                type: 'translateInputText',
                payload: payload
            });

            if (result && result.translatedText) {
                this.setTextContent(target, result.translatedText);
                
                // 触发自定义事件，允许其他组件响应翻译完成
                const translationEvent = new CustomEvent('foxlate:inputTranslated', {
                    detail: {
                        target,
                        originalText: text,
                        translatedText: result.translatedText,
                        targetLang: targetLangOverride
                    }
                });
                document.dispatchEvent(translationEvent);
            } else if (result && result.error) {
                console.error('[Foxlate] Translation error:', result.error);
            }
        } catch (error) {
            console.error('[Foxlate] Input translation failed.', error);
        } finally {
            this.indicator.hide();
        }
    }
    
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
    }

    // 新增：统一的文本内容获取方法，支持更多输入类型
    getTextContent(target) {
        if (target.isContentEditable) {
            return target.textContent || target.innerText || '';
        }
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            return target.value || '';
        }
        return '';
    }

    // 新增：统一的文本内容设置方法，支持更多输入类型
    setTextContent(target, text) {
        if (target.isContentEditable) {
            // 保持光标位置
            const selection = window.getSelection();
            const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
            const wasFocused = target === document.activeElement;
            
            target.textContent = text;
            
            // 恢复焦点和光标位置
            if (wasFocused && range) {
                try {
                    selection.removeAllRanges();
                    selection.addRange(range);
                } catch (e) {
                    // 忽略光标恢复错误
                }
            }
        } else if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            target.value = text;
        }
    }

    // 新增：判断是否应该追加按键字符
    shouldAppendKey(key) {
        // 只追加可打印字符和空格
        return key.length === 1 || key === 'Space' || key === 'Enter';
    }

    // 新增：获取按键的字符表示
    getKeyRepresentation(key) {
        switch (key) {
            case 'Space': return ' ';
            case 'Enter': return '\n';
            case 'Tab': return '\t';
            default: return key.length === 1 ? key : '';
        }
    }

    // 新增：销毁方法，清理资源
    destroy() {
        if (this.boundHandleKeydown) {
            document.removeEventListener('keydown', this.boundHandleKeydown, true);
            this.boundHandleKeydown = null;
        }
        this.activeTargets = new WeakSet();
        this.isInitialized = false;
        console.log('[Foxlate] InputHandler destroyed');
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