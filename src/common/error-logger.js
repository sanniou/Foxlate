/**
 * 全扩展统一的错误记录器工厂。
 *
 * 背景：此前有三份各自实现的错误记录器（background 的 `logBackgroundError`、
 * script-injector 与 page-translation-job 各自的 `defaultLogError`），格式相近
 * 但行为不同，且差异是**偶然的**而不是声明出来的：
 *
 * | 位置 | AbortError | null/undefined |
 * |---|---|---|
 * | `src/background/background-logger.js` | 记 info（任务被打断） | 安全 |
 * | `src/background/script-injector.js` | 被 catch 包成普通 Error → 记 error | 安全 |
 * | `src/content/page-translation-job.js` | 静默 | **抛 TypeError** |
 *
 * 最后一格是真实缺陷：`error.message` 在没有 `instanceof Error` 保护的情况下被读取，
 * 于是错误处理器自己抛错，把原始故障盖掉。
 *
 * 修法：实现只留一份，**策略变成显式参数**。三处调用点的策略本来就该不同
 * （内容脚本里用户主动中止不该产生日志；后台里它是「任务被打断」，值得一条 info），
 * 但实现必须相同 —— 把差异写进参数，就不会再有人误以为它们是同一个东西。
 */

/** AbortError 的记录策略。 */
export const ABORT_POLICY = {
    /** 完全不记录（用户主动中止，不是故障）。 */
    SILENT: 'silent',
    /** 记一条 `console.log`：任务被打断，不是故障。 */
    INFO: 'info',
    /** 与普通错误同样处理。 */
    ERROR: 'error',
};

/**
 * @param {object} [options]
 * @param {string} [options.prefix] 日志前缀，用于区分来源上下文。
 * @param {'silent'|'info'|'error'} [options.abortPolicy] AbortError 的处理策略。
 * @returns {(context: string, error: unknown) => void}
 */
export function createErrorLogger({
    prefix = 'Foxlate Error',
    abortPolicy = ABORT_POLICY.SILENT,
} = {}) {
    return function logError(context, error) {
        if (error?.name === 'AbortError') {
            if (abortPolicy === ABORT_POLICY.SILENT) {
                return;
            }
            if (abortPolicy === ABORT_POLICY.INFO) {
                console.log(`[Foxlate] Task was interrupted in ${context}:`, error.message);
                return;
            }
            // ABORT_POLICY.ERROR 落到下面与普通错误同样处理
        }

        if (error instanceof Error) {
            console.error(`[${prefix}] in ${context}:`, error.message, error.stack);
            return;
        }

        console.error(`[${prefix}] in ${context}:`, error || 'An unknown error occurred.');
    };
}
