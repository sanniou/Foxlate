import { isDeepEqual } from '../common/object-utils.js';

/**
 * 判断一次设置变更是否要求内容脚本丢弃当前页面的翻译结果、重新开始翻译。
 *
 * 独立成模块而不是内联在 `service-worker.js` 里，是因为 service worker 脚本在
 * 测试环境中不可加载（它注册监听器、注入脚本、依赖完整浏览器 API），
 * 内联就等于这段唯一决定"要不要重新翻译"的逻辑永远无法被断言。
 *
 * @param {object} params
 * @param {object} [params.oldValue] - 归一化后的旧设置；缺失时保守地判定为需要重载。
 * @param {object} [params.newValue] - 归一化后的新设置；缺失时保守地判定为需要重载。
 * @param {string[]} params.criticalKeys - 影响翻译结果的关键键名。
 * @returns {boolean} 是否需要重新翻译当前页面。
 */
export function shouldReloadTranslationJob({ oldValue, newValue, criticalKeys }) {
    if (!oldValue || !newValue) {
        return true;
    }

    return criticalKeys.some(key => {
        // 结构化短路比较：引擎配置/站点规则这类大数组上不再逐个 key 序列化。
        const hasChanged = !isDeepEqual(oldValue[key], newValue[key]);
        if (hasChanged && globalThis.__DEBUG__) {
            console.log(`[Foxlate] Critical setting '${key}' changed. Page re-translation required.`);
        }
        return hasChanged;
    });
}
