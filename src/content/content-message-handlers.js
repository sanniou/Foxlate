import { MESSAGE_TYPES } from '../common/message-types.js';

export function createContentMessageHandlers(runtime) {
    return {
        [MESSAGE_TYPES.PING]() {
            return { status: 'PONG' };
        },

        [MESSAGE_TYPES.SETTINGS_UPDATED](request) {
            return runtime.handleSettingsUpdated(request.payload?.newValue);
        },

        [MESSAGE_TYPES.RELOAD_TRANSLATION_JOB]() {
            return runtime.reloadTranslationJob();
        },

        [MESSAGE_TYPES.TRANSLATE_PAGE_REQUEST](request) {
            return runtime.startTranslationJob(request.payload?.tabId, { ignoreIfActive: true });
        },

        [MESSAGE_TYPES.REVERT_PAGE_TRANSLATION]() {
            return runtime.revertTranslationJob();
        },

        [MESSAGE_TYPES.TOGGLE_TRANSLATION_REQUEST_AT_CONTENT](request) {
            return runtime.toggleTranslationJob(request.payload?.tabId);
        },

        [MESSAGE_TYPES.TRANSLATE_TEXT_RESULT](request) {
            runtime.handleTranslationResult(request.payload);
            return { success: true };
        },

        [MESSAGE_TYPES.TRANSLATE_TEXT_BATCH_RESULT](request) {
            runtime.handleBatchTranslationResult(request.payload);
            return { success: true };
        },

        [MESSAGE_TYPES.TRANSLATION_RETRY_SCHEDULED](request) {
            runtime.handleTranslationRetryScheduled(request.payload);
            return { success: true };
        },

        async [MESSAGE_TYPES.UPDATE_DISPLAY_MODE](request) {
            await runtime.updateDisplayMode(request.payload?.displayMode);
            return { success: true };
        },

        [MESSAGE_TYPES.REQUEST_TRANSLATION_STATUS]() {
            return runtime.getTranslationStatus();
        },

        [MESSAGE_TYPES.DISPLAY_SELECTION_TRANSLATION](request) {
            return runtime.displaySelectionTranslation(request.payload);
        },

        [MESSAGE_TYPES.TOGGLE_SUBTITLE_TRANSLATION](request) {
            return runtime.toggleSubtitleTranslation(request.payload?.enabled);
        },

        [MESSAGE_TYPES.REQUEST_SUBTITLE_TRANSLATION_STATUS]() {
            return runtime.getSubtitleTranslationStatus();
        },

        [MESSAGE_TYPES.TOGGLE_SUMMARY_REQUEST]() {
            return runtime.toggleSummary();
        },
    };
}
