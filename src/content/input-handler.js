import { InputIndicator } from './input-indicator.js';
import {
    debounce,
    escapeRegex,
    getKeyRepresentation,
    getLastSentence,
    getTextContent,
    isSupportedInputElement,
    resolveTargetLanguageOverride,
    shouldAppendKey,
} from './input/input-text-utils.js';
import { InputTranslationClient } from './input/input-translation-client.js';

class InputHandler {
    constructor() {
        this.settings = null;
        this.keyPressCount = 0;
        this.lastKeypressTime = 0;
        this.lastKeyPressed = null;
        this.lastEventTarget = null;
        this.lastSelectionIndex = null;
        this.isInitialized = false;
        this.indicator = new InputIndicator();
        this.translationClient = new InputTranslationClient();
        this.debounceMagicWord = debounce(this.handleMagicWord.bind(this), 300);
        this.activeTargets = new WeakSet(); // 跟踪正在处理的输入框，避免重复处理
    }

    async init() {
        if (this.isInitialized) {
            return;
        }

        if (!window.getEffectiveSettings) {
            return;
        }

        try {
            const effectiveSettings = await window.getEffectiveSettings();

            this.settings = effectiveSettings.inputTranslationSettings;

            if (!this.settings) {
                return;
            }

            if (!this.settings.enabled) {
                return;
            }

            const isBlacklisted = this.settings.blacklist && this.settings.blacklist.some(domain => window.location.hostname.includes(domain));
            if (isBlacklisted) {
                console.log(`[Foxlate] Input handler disabled on blacklisted domain: ${window.location.hostname}`);
                return;
            }

            this.attachEventListeners();
            this.isInitialized = true;
        } catch (error) {
            console.error('[Foxlate] Error initializing input handler:', error);
        }
    }

    attachEventListeners() {
        this.boundHandleKeydown = this.handleKeydown.bind(this);
        document.addEventListener('keydown', this.boundHandleKeydown, true);

        this.boundDestroy = this.destroy.bind(this);
    }

    handleKeydown(event) {
        // 性能优化：减少不必要的日志输出
        if (this.settings.debugMode) {
            console.log('[Foxlate] Keydown event:', event.key, event.code, 'target:', event.target.tagName);
        }

        // 0. 仅支持纯文本输入框 (Input/Textarea)，忽略富文本编辑器 (contentEditable)
        // 这是为了防止在富文本编辑器中直接替换文本导致格式丢失
        if (!isSupportedInputElement(event.target)) {
            return;
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
        this.debounceMagicWord(event.target);
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
            this.lastEventTarget = null;
            this.lastSelectionIndex = null;
            return;
        }

        const target = event.target;
        // 双重检查，虽然 handleKeydown 已经检查过了
        if (!isSupportedInputElement(target)) {
            this.keyPressCount = 0;
            this.lastKeyPressed = null;
            this.lastEventTarget = null;
            this.lastSelectionIndex = null;
            return;
        }

        const currentTime = Date.now();
        let currentSelectionStart = null;
        try {
            currentSelectionStart = target.selectionStart;
        } catch (e) {
            // Some input types do not support selectionStart
        }

        // 检查是否为连续按下的同一个键
        const isSameKey = this.lastKeyPressed === consecutiveKey;
        const isWithinTime = currentTime - this.lastKeypressTime <= 500;
        const isSameTarget = this.lastEventTarget === target;

        // 检查光标位置是否连续 (假设每次按键光标前进1位)
        let isConsecutivePosition = true;
        // 只有当能够获取到光标位置时才检查
        if (currentSelectionStart !== null && this.lastSelectionIndex !== null) {
            isConsecutivePosition = currentSelectionStart === this.lastSelectionIndex + 1;
        }

        if (isSameKey && isWithinTime && isSameTarget && isConsecutivePosition) {
            // 在500ms内按下同一个键，且在同一个输入框，且光标连续，增加计数
            this.keyPressCount++;
        } else {
            // 重置计数，开始新的连续按键序列
            this.keyPressCount = 1;
        }

        this.lastKeypressTime = currentTime;
        this.lastKeyPressed = consecutiveKey;
        this.lastEventTarget = target;
        this.lastSelectionIndex = currentSelectionStart;

        if (this.settings.debugMode) {
            console.log('[Foxlate] Key press count:', this.keyPressCount, 'required:', consecutiveKeyPresses);
        }

        if (this.keyPressCount >= consecutiveKeyPresses) {
            this.keyPressCount = 0;
            this.lastKeyPressed = null;
            this.lastEventTarget = null;
            this.lastSelectionIndex = null;

            // 获取文本内容，改进对富文本编辑器的支持
            let fullText = getTextContent(target);

            // 改进：更精确地处理特殊键（如空格、回车等）
            if (shouldAppendKey(event.key)) {
                fullText += getKeyRepresentation(event.key);
            }

            // 获取最后一句
            const { text: lastSentence, index: startIndex } = getLastSentence(fullText);

            if (this.settings.debugMode) {
                console.log('[Foxlate] Triggering translation via consecutive key, lastSentence:', lastSentence);
            }
            event.preventDefault();

            // 触发翻译，指定替换范围
            // 注意：因为 preventDefault 阻止了当前按键上屏，所以 target.value 的长度就是我们要替换的终点
            // 如果 lastSentence 包含了当前按键（例如空格），它会被翻译。
            // 替换范围是从 lastSentence 的起始位置到当前输入框内容的末尾。
            this.triggerTranslation(target, lastSentence, null, { start: startIndex, end: target.value.length });
        }
    }

    handleMagicWord(target) {
        const triggerWord = this.settings.triggerWord;
        if (!triggerWord) return;

        if (!isSupportedInputElement(target)) return;

        // 防止重复处理同一个输入框
        if (this.activeTargets.has(target)) {
            return;
        }

        const fullText = getTextContent(target);
        const { text: lastSentence, index: startIndex } = getLastSentence(fullText);

        if (this.settings.debugMode) {
            console.log('[Foxlate] Magic word check:', 'lastSentence:', lastSentence, 'triggerWord:', triggerWord);
        }

        // 改进：更灵活的正则表达式匹配，支持多种分隔符
        // 正则表达式匹配: (文本) (分隔符) (语言-)(触发词)(可选分隔符)
        // 示例: "some text //ja-fox" 或 "hello //fox world"
        const regex = new RegExp(`^(.*?)\\s*(?:\\/\\/|##)(?:\\s*([\\w-]+)\\s*-\\s*)?(${escapeRegex(triggerWord)})(?:\\s|$)`, 'i');
        const match = lastSentence.match(regex);

        if (this.settings.debugMode) {
            console.log('[Foxlate] Magic word regex match:', match);
        }

        if (match) {
            // 标记正在处理
            this.activeTargets.add(target);

            const textToTranslate = (match[1] || '').trim();
            const langAlias = match[2]?.toUpperCase(); // 转换为大写以便于映射

            const targetLangOverride = resolveTargetLanguageOverride(langAlias, this.settings);

            // 计算替换范围
            // match[0] 是匹配到的整个字符串（包含魔法词）
            // 它的起始位置相对于 lastSentence 是 match.index
            // 它的起始位置相对于 fullText 是 startIndex + match.index
            const replaceStart = startIndex + match.index;
            const replaceEnd = replaceStart + match[0].length;

            if (this.settings.debugMode) {
                console.log('[Foxlate] Triggering translation via magic word, text:', textToTranslate, 'langAlias:', langAlias);
            }

            // 不再立即移除魔法词，而是等待翻译完成后整体替换
            // this.setTextContent(target, newText);

            this.triggerTranslation(target, textToTranslate, targetLangOverride, { start: replaceStart, end: replaceEnd });

            // 处理完成后清除标记
            setTimeout(() => {
                this.activeTargets.delete(target);
            }, 1000);
        }
    }

    async triggerTranslation(target, text, targetLangOverride = null, replaceRange = null) {
        return this.translationClient.translateAndReplace({
            target,
            text,
            targetLangOverride,
            replaceRange,
            indicator: this.indicator,
        });
    }

    // 新增：销毁方法，清理资源
    destroy() {
        if (this.boundHandleKeydown) {
            document.removeEventListener('keydown', this.boundHandleKeydown, true);
            this.boundHandleKeydown = null;
        }
        this.activeTargets = new WeakSet();
        this.isInitialized = false;
    }
}

export function initializeInputHandler() {
    if (window.getEffectiveSettings) {
        const handler = new InputHandler();
        handler.init();
        return handler;
    } else {
        console.error('[Foxlate] Could not initialize InputHandler because getEffectiveSettings is not available.');
    }
    return null;
}
