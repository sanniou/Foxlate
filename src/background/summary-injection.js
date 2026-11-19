import { SettingsManager } from '../common/settings-manager.js';
import { SUMMARY_CSS_FILES, SUMMARY_SCRIPT_FILES } from './background-constants.js';

/**
 * 摘要模块的按需注入器。
 *
 * 摘要包（readability 正文抽取 + marked 渲染 + 面板 UI）约 200KB，摘要默认关闭，
 * 所以它从内容包里拆了出去（见 `background-constants.js` 的注释）。拆开之后注入时机
 * 就成了唯一的入口，集中在两处：
 *
 * - 页面翻译开始/设置更新时，内容运行时发 `ENSURE_SUMMARY_MODULE`，并把它的生效
 *   设置里 `summarySettings.enabled` 的结论一并带上（它刚刚就是按这份结论决定要不
 *   要建面板的）。带上之后后台不再自己重读设置——那会撞上后台设置缓存的陈旧窗口，
 *   实测「在设置页打开摘要 → 立即翻译当前页」时面板按钮不出现；
 * - 用户按摘要快捷键，`force: true` 无视开关——用户当场要了，就是开。
 *
 * 注入本身是幂等的：`ensureScriptsInjected` 按 frame 记已注入文件，重复调用只剩一次
 * storage 读。
 *
 * @param {object} dependencies
 * @param {Function} dependencies.ensureScriptsInjected 注入实现
 * @param {Function} dependencies.logError 错误日志
 * @param {object} [dependencies.settingsManager] 设置来源，默认全局单例
 * @returns {(tabId: number, options?: {force?: boolean, hostname?: string}) => Promise<boolean>}
 *   返回是否已就绪（开关为关时返回 false，表示「不需要注入」而不是「注入失败」）
 */
export function createSummaryInjector({
    ensureScriptsInjected,
    logError,
    settingsManager = SettingsManager,
}) {
    return async function ensureSummaryInjected(tabId, { force = false, hostname, enabled } = {}) {
        if (!tabId) {
            return false;
        }

        // 调用方已经判断过开关时直接用它的结论；没给结论（例如其它调用点）才回读设置。
        if (!force && enabled === false) {
            return false;
        }

        if (!force && enabled === undefined) {
            try {
                const settings = await settingsManager.getEffectiveSettings(hostname);
                if (!settings?.summarySettings?.enabled) {
                    return false;
                }
            } catch (error) {
                // 设置读不出来时按需方关闭处理：宁可这次让用户再按一次快捷键，
                // 也不要为了一个未确认的开关给所有页面塞 200KB。
                logError('ensureSummaryInjected (read settings)', error);
                return false;
            }
        }

        return ensureScriptsInjected(tabId, 0, [...SUMMARY_CSS_FILES, ...SUMMARY_SCRIPT_FILES]);
    };
}
