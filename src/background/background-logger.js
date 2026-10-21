import { ABORT_POLICY, createErrorLogger } from '../common/error-logger.js';

/**
 * 后台上下文的错误记录器。
 *
 * 后台里 AbortError 表示「任务被打断」（例如翻译作业被新的导航取代），
 * 是预期路径而不是故障，因此记 info 而非 error。
 */
export const logBackgroundError = createErrorLogger({
    prefix: 'Foxlate Error',
    abortPolicy: ABORT_POLICY.INFO,
});
