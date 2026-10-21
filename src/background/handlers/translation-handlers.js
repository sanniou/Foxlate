import { MESSAGE_TYPES } from '../../common/message-types.js';
import { createTranslateTextHandler } from './translation/translate-text-handler.js';
import { createTranslateTextBatchHandler } from './translation/translate-text-batch-handler.js';
import { createTranslateBatchHandler } from './translation/translate-batch-handler.js';
import { createTranslateInputTextHandler } from './translation/translate-input-text-handler.js';
import { createTestTranslateTextHandler, createTestConnectionHandler } from './translation/engine-test-handlers.js';

/**
 * 翻译类消息处理器的装配表。
 *
 * 职责边界：把「一次翻译请求」翻译成对 TranslatorManager 的调用，
 * 并负责把结果写进产品数据（provider health / 失败队列 / 历史）。
 * 不碰设置解析之外的领域逻辑，也不碰标签页状态。
 *
 * 每个 handler 都在 `translation/` 下各占一个文件——它们原先内联在这个 311 行的
 * 工厂里，任何一处改动都要在一个巨大的对象字面量里定位。
 */
export function createTranslationHandlers({
    browserApi,
    settingsManager,
    translatorManager,
    historyStore,
    failureQueue,
    healthStore,
    logError,
}) {
    const dependencies = {
        browserApi,
        settingsManager,
        translatorManager,
        historyStore,
        failureQueue,
        healthStore,
        logError,
    };

    return {
        [MESSAGE_TYPES.TRANSLATE_TEXT]: createTranslateTextHandler(dependencies),
        [MESSAGE_TYPES.TRANSLATE_TEXT_BATCH]: createTranslateTextBatchHandler(dependencies),
        [MESSAGE_TYPES.TEST_TRANSLATE_TEXT]: createTestTranslateTextHandler(dependencies),
        [MESSAGE_TYPES.TRANSLATE_BATCH]: createTranslateBatchHandler(dependencies),
        [MESSAGE_TYPES.TRANSLATE_INPUT_TEXT]: createTranslateInputTextHandler(dependencies),
        [MESSAGE_TYPES.TEST_CONNECTION]: createTestConnectionHandler(dependencies),
    };
}
