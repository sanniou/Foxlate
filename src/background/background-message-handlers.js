import browser from '../lib/browser-polyfill.js';
import { SettingsManager } from '../common/settings-manager.js';
import { TranslatorManager } from './translator-manager.js';
import {
    providerHealthStore,
    translationFailureQueue,
    translationHistoryStore,
} from './translation-product-stores.js';
import { createTranslationHandlers } from './handlers/translation-handlers.js';
import { createAiTaskHandlers } from './handlers/ai-task-handlers.js';
import { createSettingsHandlers } from './handlers/settings-handlers.js';
import { createTabHandlers } from './handlers/tab-handlers.js';
import { createProductDataHandlers } from './handlers/product-data-handlers.js';

/**
 * 后台消息处理器的组装点。
 *
 * 这里只做两件事：准备共享依赖、把各域 handler map 合成一张表。
 * 具体逻辑按域拆在 `handlers/` 下：
 *  - translation-handlers：翻译（页面 / 批量 / 输入 / 连通性）
 *  - ai-task-handlers：摘要、追问、追问建议
 *  - settings-handlers：设置读写
 *  - tab-handlers：标签页与界面状态
 *  - product-data-handlers：缓存、历史、引擎健康、云备份
 *
 * 契约保持不变：仍然返回 `{ [MESSAGE_TYPES.X]: handler }`，
 * 由 `service-worker.js` 里的 handler-map 分发统一消费。
 */
export function createBackgroundMessageHandlers({
    browserApi = browser,
    settingsManager = SettingsManager,
    translatorManager = TranslatorManager,
    historyStore = translationHistoryStore,
    failureQueue = translationFailureQueue,
    healthStore = providerHealthStore,
    tabStateManager,
    ensureScriptsInjected,
    setBadgeAndState,
    cloudBackups,
    logError,
    cssFiles,
    coreScriptFiles,
}) {
    const groups = [
        createTranslationHandlers({
            browserApi,
            settingsManager,
            translatorManager,
            historyStore,
            failureQueue,
            healthStore,
            logError,
        }),
        createAiTaskHandlers({ translatorManager, logError }),
        createSettingsHandlers({ settingsManager }),
        createTabHandlers({
            browserApi,
            settingsManager,
            translatorManager,
            tabStateManager,
            ensureScriptsInjected,
            setBadgeAndState,
            logError,
            cssFiles,
            coreScriptFiles,
        }),
        createProductDataHandlers({
            translatorManager,
            historyStore,
            healthStore,
            cloudBackups,
        }),
    ];

    const handlers = Object.assign({}, ...groups);

    // 组装式分发最容易出的错是「两个域注册了同一个消息类型」——
    // 后者会静默覆盖前者，表现为随机丢消息。这里直接让它失败。
    const expectedCount = groups.reduce((total, group) => total + Object.keys(group).length, 0);
    if (Object.keys(handlers).length !== expectedCount) {
        const seen = new Set();
        const duplicates = [];
        for (const group of groups) {
            for (const type of Object.keys(group)) {
                if (seen.has(type)) duplicates.push(type);
                seen.add(type);
            }
        }
        throw new Error(`Duplicate background message handlers registered: ${duplicates.join(', ')}`);
    }

    return handlers;
}
