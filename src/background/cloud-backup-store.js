const CLOUD_BACKUP_PREFIX = 'foxlate_backup_';
const MAX_CLOUD_BACKUPS = 10;

/**
 * 云备份（`storage.sync`）的读写与轮转。
 *
 * 四个入口共享同一个结果契约：成功 `{success:true, ...}`，失败
 * `{success:false, error}` 并上报一次。这个契约原先在各方法里各抄一遍，
 * 「某个方法忘了 logError」就成了能悄悄发生的事——现在只由 `#attempt` 决定。
 */
export class CloudBackupStore {
    #browser;
    #logError;

    constructor({ browserApi, logError }) {
        this.#browser = browserApi;
        this.#logError = logError;
    }

    async list() {
        return this.#attempt('GET_CLOUD_BACKUPS', async () => {
            const backups = await this.#readAll();
            backups.sort((a, b) => b.timestamp - a.timestamp);
            return { success: true, backups };
        });
    }

    async upload(settingsToUpload) {
        return this.#attempt('UPLOAD_SETTINGS_TO_CLOUD', async () => {
            const timestamp = Date.now();
            const backupId = `${CLOUD_BACKUP_PREFIX}${timestamp}`;
            await this.#browser.storage.sync.set({
                [backupId]: { id: backupId, timestamp, settings: settingsToUpload },
            });
            await this.#rotate();
            return { success: true };
        });
    }

    async download(backupId) {
        return this.#attempt('DOWNLOAD_SETTINGS_FROM_CLOUD', async () => {
            if (!backupId) {
                throw new Error('Backup ID is required.');
            }
            const data = await this.#browser.storage.sync.get(backupId);
            if (!data?.[backupId]) {
                throw new Error('Backup not found.');
            }
            return { success: true, settings: data[backupId].settings };
        });
    }

    async delete(backupId) {
        return this.#attempt('DELETE_CLOUD_BACKUP', async () => {
            if (!backupId) {
                throw new Error('Backup ID is required.');
            }
            await this.#browser.storage.sync.remove(backupId);
            return { success: true };
        });
    }

    /** 超出上限时删掉最旧的若干条。 */
    async #rotate() {
        const backups = await this.#readAll();
        if (backups.length <= MAX_CLOUD_BACKUPS) {
            return;
        }

        backups.sort((a, b) => a.timestamp - b.timestamp);
        const keysToRemove = backups.slice(0, backups.length - MAX_CLOUD_BACKUPS).map(backup => backup.id);
        await this.#browser.storage.sync.remove(keysToRemove);
        console.log(`[Cloud Sync] Rotated backups, removed ${keysToRemove.length} oldest item(s).`);
    }

    /** `storage.sync` 里所有形状合法的备份条目，顺序不保证。 */
    async #readAll() {
        const allItems = await this.#browser.storage.sync.get(null);
        return Object.values(allItems).filter(item =>
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            item.id.startsWith(CLOUD_BACKUP_PREFIX) &&
            typeof item.timestamp === 'number'
        );
    }

    /** 统一封装：失败一律上报一次，并转成调用方约定的失败结果。 */
    async #attempt(errorLabel, operation) {
        try {
            return await operation();
        } catch (error) {
            this.#logError(errorLabel, error);
            return { success: false, error: error.message };
        }
    }
}
