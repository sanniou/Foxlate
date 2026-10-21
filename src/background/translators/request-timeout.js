/**
 * 为翻译请求提供统一的超时能力。
 *
 * 之前三个翻译器都直接把调用方的 `signal` 交给 `fetch`，而调用方的 signal 只在
 * 用户主动中止时才触发 —— 也就是说**任何上游接口挂住，请求就会一直挂着**，
 * 页面停在「翻译中」直到用户手动取消。
 *
 * 这里把「用户中止」与「超时」合成为同一个 signal，并让调用方用 `dispose()`
 * 释放内部定时器（成功路径上也要释放，否则会留下悬挂的 timer）。
 */

/** 默认单次上游请求超时（毫秒）。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/**
 * @param {AbortSignal} [callerSignal] 用户/上层传入的中止信号
 * @param {number} [timeoutMs] 超时毫秒数，<=0 表示不设超时
 * @returns {{ signal: AbortSignal | undefined, dispose: () => void }}
 */
export function createRequestSignal(callerSignal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const noTimeout = !timeoutMs || timeoutMs <= 0;
    if (noTimeout) {
        return { signal: callerSignal, dispose: () => {} };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort(new DOMException(`The operation timed out after ${timeoutMs}ms.`, 'TimeoutError'));
    }, timeoutMs);

    const forwardCallerAbort = () => {
        controller.abort(callerSignal?.reason ?? new DOMException('Translation was interrupted by the user.', 'AbortError'));
    };

    if (callerSignal) {
        if (callerSignal.aborted) {
            forwardCallerAbort();
        } else {
            callerSignal.addEventListener('abort', forwardCallerAbort, { once: true });
        }
    }

    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timer);
            callerSignal?.removeEventListener?.('abort', forwardCallerAbort);
        },
    };
}
