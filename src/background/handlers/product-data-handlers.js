import { MESSAGE_TYPES } from '../../common/message-types.js';

/**
 * 产品数据 / 诊断类消息处理器（缓存、历史、引擎健康、云备份）。
 * 纯读写转发，没有业务分支——options 页面的「产品」区块完全靠这一组驱动。
 */
export function createProductDataHandlers({
    translatorManager,
    historyStore,
    healthStore,
    cloudBackups,
}) {
    return {
        async [MESSAGE_TYPES.GET_CACHE_INFO]() {
            return translatorManager.getCacheInfo();
        },

        async [MESSAGE_TYPES.CLEAR_CACHE]() {
            await translatorManager.clearCache();
            return { success: true };
        },

        async [MESSAGE_TYPES.GET_TRANSLATION_HISTORY]() {
            return { success: true, items: await historyStore.list() };
        },

        async [MESSAGE_TYPES.CLEAR_TRANSLATION_HISTORY]() {
            await historyStore.clear();
            return { success: true };
        },

        async [MESSAGE_TYPES.GET_PROVIDER_HEALTH]() {
            return { success: true, providers: await healthStore.list() };
        },

        async [MESSAGE_TYPES.CLEAR_PROVIDER_HEALTH]() {
            await healthStore.clear();
            return { success: true };
        },

        async [MESSAGE_TYPES.GET_CLOUD_BACKUPS]() {
            return cloudBackups.list();
        },

        async [MESSAGE_TYPES.UPLOAD_SETTINGS_TO_CLOUD](request) {
            return cloudBackups.upload(request.payload);
        },

        async [MESSAGE_TYPES.DOWNLOAD_SETTINGS_FROM_CLOUD](request) {
            return cloudBackups.download(request.payload.backupId);
        },

        async [MESSAGE_TYPES.DELETE_CLOUD_BACKUP](request) {
            return cloudBackups.delete(request.payload.backupId);
        },
    };
}
