import browser from '../../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../../common/message-types.js';
import { logContentError } from '../content-logger.js';
import { createEffectiveSettingsGetter } from '../content-settings-client.js';
import { initializeSummary } from './summary.js';

/**
 * 摘要模块的独立注入入口。
 *
 * 为什么不是 `content/content-script.js` 的一部分：摘要把 readability（正文抽取）、
 * marked（markdown 渲染）和整个面板 UI 都拖进了内容包，而摘要默认关闭——不为它
 * 付费的页面不该下载它。这里和字幕模块（`content/subtitle/subtitle-manager.js`）
 * 用同一套形态：自成一个注入入口，自己挂消息监听，`src/background/summary-injection.js`
 * 在需要时才注入。
 *
 * 监听必须在模块顶层**同步**注册：`browser.scripting.executeScript` 的 Promise 在
 * 整个 IIFE 执行完之后才 resolve，后台注入完成即发 `TOGGLE_SUMMARY_REQUEST`，只有
 * 同步注册才不会撞上「还没监听」的空窗。
 */

const getEffectiveSettings = createEffectiveSettingsGetter({ browserApi: browser, win: window });

/**
 * 把「用户现在要摘要」翻译成一份可用的摘要配置。
 *
 * 页面上的摘要开关既可能是常开的（`summarySettings.enabled`），也可能只是这一次
 * 按了快捷键。后者要现造一份 enabled 配置，模型取用户配的第一个 AI 引擎——没有
 * 引擎时留空，让下游报「未配置 AI」，而不是用默认模型硬发请求。
 *
 * @param {object} settings 生效设置
 * @returns {object} 摘要模块可直接使用的设置
 */
export function buildForcedSummarySettings(settings = {}) {
    if (settings.summarySettings?.enabled) {
        return settings;
    }
    return {
        ...settings,
        summarySettings: {
            enabled: true,
            aiModel: settings.aiEngines?.length > 0 ? settings.aiEngines[0].id : null,
            mainBodySelector: settings.summarySettings?.mainBodySelector,
        },
    };
}

async function toggleSummary() {
    try {
        const settings = buildForcedSummarySettings(await getEffectiveSettings());

        if (!window.summaryModuleInstance) {
            initializeSummary(settings);
        }
        if (!window.summaryModuleInstance) {
            return { success: false, error: 'Failed to initialize summary module' };
        }

        // 快捷键路径没有选区语境：页面上残留的选区会让面板误以为要总结选中段落。
        if (window.getSelection()?.toString().trim()) {
            window.summaryModuleInstance.selectionContext = null;
        }
        await window.summaryModuleInstance.togglePageSummaryDialog();
        return { success: true };
    } catch (error) {
        logContentError('TOGGLE_SUMMARY_REQUEST', error);
        return { success: false, error: error.message };
    }
}

browser.runtime.onMessage.addListener(request => {
    if (request?.type !== MESSAGE_TYPES.TOGGLE_SUMMARY_REQUEST) {
        return undefined;
    }
    return toggleSummary();
});

/**
 * 让常开的摘要按钮就位：只有站点/全局开关为开时才初始化。
 *
 * 注意这里判的是**原始**开关，不是 `buildForcedSummarySettings` 的结果——后者总是
 * enabled，用它判断会让每次翻译都建出一个用户没要的摘要面板。
 *
 * @returns {Promise<boolean>} 是否初始化了摘要实例
 */
export async function bootstrapSummary() {
    try {
        const settings = await getEffectiveSettings();
        if (!settings?.summarySettings?.enabled) {
            return false;
        }
        // 已经被快捷键路径初始化过就复用，重复 initialize 会销毁重建面板并丢失会话历史。
        if (!window.summaryModuleInstance) {
            initializeSummary(settings);
        }
        return Boolean(window.summaryModuleInstance);
    } catch (error) {
        logContentError('bootstrapSummary', error);
        return false;
    }
}

bootstrapSummary();
