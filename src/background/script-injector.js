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
    // 同一 (tab, frame) 的注入必须串行。
    //
    // 这里是「读已注入清单 → 执行注入 → 写回清单」，没有锁时两个并发调用会同时读到
    // 「未注入」，于是同一份 content script 被执行两次：监听器、观察器、单例全部叠一套。
    // 已复现：二次注入 subtitle-manager 后，一次状态请求收到两个响应，先到的
    // `isSupported:false` 让 popup 的字幕控件直接消失。并发来源很常见 ——
    // 用户点 popup 的翻译按钮的同时，导航事件也正在注入。
    const queues = new Map();

    const keyOf = (tabId, frameId) => `${tabId}:${frameId}`;

    async function runExclusive(key, task) {
        const previous = queues.get(key) || Promise.resolve();
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const tail = previous.then(() => gate);
        queues.set(key, tail);

        await previous.catch(() => {});
        try {
            return await task();
        } finally {
            release();
            if (queues.get(key) === tail) {
                queues.delete(key);
            }
        }
    }

    return async function ensureScriptsInjected(tabId, frameId, filesToInject) {
        if (!filesToInject?.length) {
            return true;
        }

        return runExclusive(keyOf(tabId, frameId), () => injectMissingFiles(tabId, frameId, filesToInject));
    };

    async function injectMissingFiles(tabId, frameId, filesToInject) {
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
    }
}
