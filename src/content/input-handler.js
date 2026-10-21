import { InputIndicator } from './input-indicator.js';
import { debounce } from '../common/timing.js';
import {
    escapeRegex,
    getKeyRepresentation,
    getLastSentence,
    getSelectionStart,
    getTextContent,
    isHostnameBlacklisted,
    isSupportedInputElement,
    resolveTargetLanguageOverride,
    shouldAppendKey,
} from './input/input-text-utils.js';
import { InputTranslationClient } from './input/input-translation-client.js';
import { KeySequence } from './input/key-sequence.js';

/** 连按次数的可配置区间。 */
const MIN_PRESSES = 2;
const MAX_PRESSES = 5;
const DEFAULT_PRESSES = 3;

export class InputHandler {
    constructor() {
        this.settings = null;
        this.keySequence = new KeySequence();
        this.isComposing = false;
        this.compositionTarget = null;
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

            const isBlacklisted = isHostnameBlacklisted(window.location.hostname, this.settings.blacklist);
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

        // 输入法组字期间浏览器仍会上报 keydown（选词的空格就是 key=" "/code="Space"），
        // 必须按 composition 生命周期整体屏蔽，否则中文输入会被当成连按触发。
        this.boundHandleCompositionStart = (event) => {
            // 组字可能发生在 contenteditable 等不受支持的节点上；只要页面上
            // 有输入法组字，就不能让同一时间段内的输入框 keydown 进入连按。
            this.isComposing = true;
            this.compositionTarget = event.target;
            this.keySequence.reset();
        };
        // compositionend 的目标不一定是原输入框（元素可能已被移除或焦点已转移），
        // 因此这里必须无条件收尾，避免 isComposing 永久卡在 true。
        this.boundHandleCompositionEnd = () => {
            this.resetCompositionState();
        };
        this.boundHandleFocusOut = (event) => {
            if (event.target === this.compositionTarget) {
                this.resetCompositionState();
            }
        };
        this.boundHandleWindowBlur = () => {
            this.resetCompositionState();
        };
        document.addEventListener('compositionstart', this.boundHandleCompositionStart, true);
        document.addEventListener('compositionend', this.boundHandleCompositionEnd, true);
        document.addEventListener('focusout', this.boundHandleFocusOut, true);
        window.addEventListener('blur', this.boundHandleWindowBlur, true);

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

        // 输入法组字期间的 keydown 不是普通按键：中文选词的空格也会带
        // key=" "/code="Space"。此时既不能累计连按，也不能继续走魔法词。
        // keyCode 229 是部分浏览器/输入法在 isComposing 缺失时的兼容信号。
        // event.repeat 是按住不放产生的自动重复，也不能当成“连按三次”。
        if (event.isComposing || event.keyCode === 229 || event.repeat || this.isComposing) {
            this.keySequence.reset();
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
        const { consecutiveKey } = this.settings;
        const requiredPresses = Math.max(
            MIN_PRESSES,
            Math.min(MAX_PRESSES, Number.parseInt(this.settings.consecutiveKeyPresses, 10) || DEFAULT_PRESSES),
        );

        // 不是触发键、或不在受支持的输入框里：这一串就断了
        if ((event.code !== consecutiveKey && event.key !== consecutiveKey) || !isSupportedInputElement(event.target)) {
            this.keySequence.reset();
            return;
        }

        const target = event.target;
        const count = this.keySequence.register({
            consecutiveKey,
            target,
            selectionStart: getSelectionStart(target),
            value: getTextContent(target),
            triggerChar: getKeyRepresentation(consecutiveKey),
        });

        if (this.settings.debugMode) {
            console.log('[Foxlate] Consecutive key count:', count, 'required:', requiredPresses);
        }

        if (count < requiredPresses) {
            return;
        }

        this.keySequence.reset();

        // preventDefault 阻止了当前按键上屏，所以 target.value 的长度就是要替换的终点。
        // 若这个键本身会产生字符（空格/回车/单个字符），它还没进 value，需要补上才译。
        let fullText = getTextContent(target);
        if (shouldAppendKey(event.key)) {
            fullText += getKeyRepresentation(event.key);
        }
        const { text: lastSentence, index: startIndex } = getLastSentence(fullText);

        // 没有可翻译正文时不要把触发键吃掉：空输入框里连按三次空格
        // 应当只是输入空格，而不是被 preventDefault 后什么也不发生。
        if (!lastSentence.trim()) {
            return;
        }

        event.preventDefault();
        this.triggerTranslation(target, lastSentence, null, { start: startIndex, end: target.value.length });
    }

    resetCompositionState() {
        this.isComposing = false;
        this.compositionTarget = null;
        this.keySequence.reset();
    }

    handleMagicWord(target) {
        const triggerWord = this.settings.triggerWord;
        if (!triggerWord || this.isComposing) return;

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

            const translation = this.triggerTranslation(target, textToTranslate, targetLangOverride, { start: replaceStart, end: replaceEnd });

            // 翻译结束（成功、失败或返回空结果）后立即释放标记。
            // 不能再用固定 1 秒定时器：慢请求期间用户无法再次触发，快请求结束后
            // 又会白白锁住输入框 1 秒。
            Promise.resolve(translation).then(
                () => this.activeTargets.delete(target),
                () => this.activeTargets.delete(target),
            );
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
        if (this.boundHandleCompositionStart) {
            document.removeEventListener('compositionstart', this.boundHandleCompositionStart, true);
            this.boundHandleCompositionStart = null;
        }
        if (this.boundHandleCompositionEnd) {
            document.removeEventListener('compositionend', this.boundHandleCompositionEnd, true);
            this.boundHandleCompositionEnd = null;
        }
        if (this.boundHandleFocusOut) {
            document.removeEventListener('focusout', this.boundHandleFocusOut, true);
            this.boundHandleFocusOut = null;
        }
        if (this.boundHandleWindowBlur) {
            window.removeEventListener('blur', this.boundHandleWindowBlur, true);
            this.boundHandleWindowBlur = null;
        }
        this.resetCompositionState();
        this.debounceMagicWord.cancel?.();
        this.indicator.hide();
        this.activeTargets = new WeakSet();
        this.isInitialized = false;
    }
}

export function initializeInputHandler() {
    if (!window.getEffectiveSettings) {
        console.error('[Foxlate] Could not initialize InputHandler because getEffectiveSettings is not available.');
        return null;
    }

    const handler = new InputHandler();
    handler.init();
    return handler;
}
