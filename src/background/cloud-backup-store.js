const CLOUD_BACKUP_PREFIX = 'foxlate_backup_';
const MAX_CLOUD_BACKUPS = 10;

export function createCloudBackupStore({
    browserApi,
    logError,
}) {
    async function getCloudBackupItems() {
        const allItems = await browserApi.storage.sync.get(null);
        return Object.values(allItems)
            .filter(item =>
                item &&
                typeof item === 'object' &&
                typeof item.id === 'string' &&
                item.id.startsWith(CLOUD_BACKUP_PREFIX) &&
                typeof item.timestamp === 'number'
            );
    }

    return {
        async list() {
            try {
                const backups = await getCloudBackupItems();
                backups.sort((a, b) => b.timestamp - a.timestamp);
                return { success: true, backups };
            } catch (error) {
                logError('GET_CLOUD_BACKUPS', error);
                return { success: false, error: error.message };
            }
        },

        async upload(settingsToUpload) {
            try {
                const timestamp = Date.now();
                const backupId = `${CLOUD_BACKUP_PREFIX}${timestamp}`;
                const backupItem = {
                    id: backupId,
                    timestamp,
                    settings: settingsToUpload,
                };

                await browserApi.storage.sync.set({ [backupId]: backupItem });

                const allBackups = await getCloudBackupItems();
                if (allBackups.length > MAX_CLOUD_BACKUPS) {
                    allBackups.sort((a, b) => a.timestamp - b.timestamp);
                    const backupsToRemoveCount = allBackups.length - MAX_CLOUD_BACKUPS;
                    const keysToRemove = allBackups.slice(0, backupsToRemoveCount).map(backup => backup.id);
                    await browserApi.storage.sync.remove(keysToRemove);
                    console.log(`[Cloud Sync] Rotated backups, removed ${keysToRemove.length} oldest item(s).`);
                }

                return { success: true };
            } catch (error) {
                logError('UPLOAD_SETTINGS_TO_CLOUD', error);
                return { success: false, error: error.message };
            }
        },

        async download(backupId) {
            try {
                if (!backupId) {
                    throw new Error('Backup ID is required.');
                }
                const data = await browserApi.storage.sync.get(backupId);
                if (data?.[backupId]) {
                    return { success: true, settings: data[backupId].settings };
                }
                throw new Error('Backup not found.');
            } catch (error) {
                logError('DOWNLOAD_SETTINGS_FROM_CLOUD', error);
                return { success: false, error: error.message };
            }
        },

        async delete(backupId) {
            try {
                if (!backupId) {
                    throw new Error('Backup ID is required.');
                }
                await browserApi.storage.sync.remove(backupId);
                return { success: true };
            } catch (error) {
                logError('DELETE_CLOUD_BACKUP', error);
                return { success: false, error: error.message };
            }
        },
    };
}
