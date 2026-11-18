import browser from '../lib/browser-polyfill.js';
import TabStateManager from './tab-state-manager.js';
import { ABORT_POLICY, createErrorLogger } from '../common/error-logger.js';

// 与后台其余部分保持同一策略：注入期间的中止是「任务被打断」，不是故障。
const defaultLogError = createErrorLogger({
    prefix: 'Foxlate Error',
    abortPolicy: ABORT_POLICY.INFO,
});

/**
 * Creates a frame resource injector with injectable dependencies for tests.
 *
 * @param {object} dependencies
 * @param {object} dependencies.browserApi
 * @param {object} dependencies.tabStateManager
 * @param {Function} dependencies.logError
 * @returns {(tabId: number, frameId: number, filesToInject: string[]) => Promise<boolean>}
 */
export function createEnsureScriptsInjected({
    browserApi = browser,
    tabStateManager = TabStateManager,
    logError = defaultLogError,
} = {}) {
    return async function ensureScriptsInjected(tabId, frameId, filesToInject) {
        if (!filesToInject?.length) {
            return true;
        }

        const uniqueFiles = [...new Set(filesToInject)];

        try {
            // 一次读回已注入清单，本地做集合差。（旧实现先整体判断、再逐文件各读一次
            // storage.session，7 个文件 = 8 次跨进程串行读取，而且前多少次全在同一个
            // 注入路径的临界区里。）
            const injectedFiles = new Set(await tabStateManager.getInjectedFiles(tabId, frameId));
            const filesMissing = uniqueFiles.filter(file => !injectedFiles.has(file));
            if (filesMissing.length === 0) {
                return true;
            }

            const cssToInject = filesMissing.filter(file => file.endsWith('.css'));
            const jsToInject = filesMissing.filter(file => file.endsWith('.js'));

            if (cssToInject.length > 0) {
                await browserApi.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, files: cssToInject });
            }
            if (jsToInject.length > 0) {
                await browserApi.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: jsToInject });
            }

            await tabStateManager.markFrameAsInjected(tabId, frameId, filesMissing);

            return true;
        } catch (error) {
            // 原样上报原始错误，不再包一层 new Error：包装会丢掉错误类型（例如
            // AbortError 的 name）与原始栈，而这两样正是判断「特殊页面 vs 导航竞态」
            // 的依据。注入失败的常见原因（chrome:// 等受限页面）写在调用方注释里，
            // 不需要塞进日志文案。
            logError(`ensureScriptsInjected for tab ${tabId}, frame ${frameId}`, error);
            return false;
        }
    };
}
