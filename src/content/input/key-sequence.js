/** 两次按键之间允许的最大间隔（毫秒）。超过就算重新开始。 */
const MAX_INTERVAL_MS = 500;

/**
 * 「连按同一个键 N 次」的序列判定。
 *
 * 是否算作同一串连按，由五个条件共同决定：同一个触发键、同一个输入框、
 * 间隔 ≤ 500ms、光标位置逐次前进一位，以及上一次按键确实插入了触发字符。
 * 前四个条件原先连同实例字段一起手写在 `handleConsecutiveKeyPress` 里，
 * 导致命中路径和重置路径各自重复清空逻辑；现在收成一个可单独测的状态机。
 */
export class KeySequence {
    #key = null;
    #time = 0;
    #target = null;
    #selectionStart = null;
    #count = 0;

    /** 本串连按已经累计的次数。 */
    get count() {
        return this.#count;
    }

    /**
     * 记录一次触发键按下，并返回累计次数。
     * @param {{consecutiveKey: string, target: Element, selectionStart: number|null, value?: string|null, triggerChar?: string|null, now?: number}} press
     */
    register({ consecutiveKey, target, selectionStart, value = null, triggerChar = null, now = Date.now() }) {
        const previousPressInsertedTrigger = this.#didPreviousPressInsertTrigger(value, triggerChar);
        const continuesSequence =
            this.#key === consecutiveKey &&
            this.#target === target &&
            now - this.#time <= MAX_INTERVAL_MS &&
            previousPressInsertedTrigger &&
            this.#isNextPosition(selectionStart);

        this.#count = continuesSequence ? this.#count + 1 : 1;
        this.#key = consecutiveKey;
        this.#time = now;
        this.#target = target;
        this.#selectionStart = selectionStart;
        return this.#count;
    }

    reset() {
        this.#key = null;
        this.#time = 0;
        this.#target = null;
        this.#selectionStart = null;
        this.#count = 0;
    }

    /**
     * 上一次触发键按下后，输入框里实际新增的是不是触发键对应的字符。
     * 中文输入法用空格选词时，keydown 也可能是普通的 key=" "/code="Space"，
     * 但上屏的是汉字；只靠 isComposing/keyCode 无法在所有浏览器上识别。
     * 读不到 value 时退回原有行为，不因拿不到信息而关掉功能。
     */
    #didPreviousPressInsertTrigger(value, triggerChar) {
        if (this.#count === 0 || !triggerChar || value == null || this.#selectionStart == null) {
            return true;
        }
        return value[this.#selectionStart] === triggerChar;
    }

    /**
     * 光标是否恰好前进了一位。
     * 读不到光标位置时（部分 input 类型不支持）视为通过——不能因为读不到
     * 就把功能整个关掉；这是原实现的既有取舍，此处保持。
     */
    #isNextPosition(selectionStart) {
        if (selectionStart === null || this.#selectionStart === null) {
            return true;
        }
        return selectionStart === this.#selectionStart + 1;
    }
}
