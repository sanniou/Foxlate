const CLOUD_BACKUP_PREFIX = 'foxlate_backup_';
const MAX_CLOUD_BACKUPS = 10;

/** 单个 `storage.sync` 条目上限是 8192 字节（含 key 与 JSON 外壳），留出余量后按 6000 字节切块。 */
const CHUNK_BYTES = 6000;
const PART_SEPARATOR = '.p';

/** 不上云、但下载后需要用户重填的字段。deeplxApiKey / api_key / accessToken 这类前缀写法都要盖上。 */
const SECRET_FIELD_PATTERN = /(api[-_]?key|token|secret|password)$/i;

/**
 * 云备份（`storage.sync`）的读写与轮转。
 *
 * 四个入口共享同一个结果契约：成功 `{success:true, ...}`，失败
 * `{success:false, error}` 并上报一次。这个契约原先在各方法里各抄一遍，
 * 「某个方法忘了 logError」就成了能悄悄发生的事——现在只由 `#attempt` 决定。
 *
 * 两条硬约束来自 `storage.sync` 本身：
 * 1. **单条 8KB**：整份设置塞进一个 key 时，引擎列表一长就写不进去（报 QUOTA_BYTES_PER_ITEM）。
 *    因此一份备份由「头部条目 + N 个分片」组成。
 * 2. **内容会上传到浏览器账号**：API Key 属于凭据，不能跟着设置一起同步出去。
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
            const snapshot = this.#redactSecrets(settingsToUpload);
            const chunks = this.#splitIntoChunks(JSON.stringify(snapshot ?? {}));

            const payload = {
                [backupId]: { id: backupId, timestamp, parts: chunks.length },
            };
            chunks.forEach((chunk, index) => {
                payload[`${backupId}${PART_SEPARATOR}${index}`] = { id: backupId, timestamp, part: index, chunk };
            });

            try {
                await this.#browser.storage.sync.set(payload);
            } catch (error) {
                // 写满配额时先腾地方再重试一次：否则用户只能等到 10 份旧备份自然过期。
                if (!String(error?.message || '').includes('QUOTA')) throw error;
                await this.#rotate({ keep: Math.floor(MAX_CLOUD_BACKUPS / 2) });
                await this.#browser.storage.sync.set(payload);
            }

            await this.#rotate();
            return { success: true };
        });
    }

    async download(backupId) {
        return this.#attempt('DOWNLOAD_SETTINGS_FROM_CLOUD', async () => {
            if (!backupId) {
                throw new Error('Backup ID is required.');
            }

            const allItems = await this.#browser.storage.sync.get(null);
            const head = allItems?.[backupId];
            if (!head) {
                throw new Error('Backup not found.');
            }

            if (typeof head.parts !== 'number') {
                // 1.7.5 及以前的备份把整份设置放在同一个 key 里；升级后用户手上还有这种条目。
                return { success: true, settings: head.settings };
            }

            const chunks = [];
            for (let index = 0; index < (head.parts ?? 0); index += 1) {
                const part = allItems[`${backupId}${PART_SEPARATOR}${index}`];
                if (!part?.chunk) {
                    throw new Error('Backup is incomplete.');
                }
                chunks.push(part.chunk);
            }

            return { success: true, settings: JSON.parse(chunks.join('')) };
        });
    }

    async delete(backupId) {
        return this.#attempt('DELETE_CLOUD_BACKUP', async () => {
            if (!backupId) {
                throw new Error('Backup ID is required.');
            }
            const keys = await this.#keysOfBackup(backupId);
            await this.#browser.storage.sync.remove(keys);
            return { success: true };
        });
    }

    /** 超出上限时删掉最旧的若干条（含全部分片）。 */
    async #rotate({ keep = MAX_CLOUD_BACKUPS } = {}) {
        const backups = await this.#readAll();
        if (backups.length <= keep) {
            return;
        }

        backups.sort((a, b) => a.timestamp - b.timestamp);
        const expired = backups.slice(0, backups.length - keep);
        const keysToRemove = [];
        for (const backup of expired) {
            keysToRemove.push(...await this.#keysOfBackup(backup.id));
        }
        await this.#browser.storage.sync.remove(keysToRemove);
        console.log(`[Cloud Sync] Rotated backups, removed ${keysToRemove.length} item(s).`);
    }

    /** 一个备份占用的所有 key（头部 + 分片）。 */
    async #keysOfBackup(backupId) {
        const allItems = await this.#browser.storage.sync.get(null);
        return Object.entries(allItems ?? {})
            .filter(([key, value]) => key === backupId || (value && value.id === backupId))
            .map(([key]) => key);
    }

    /** `storage.sync` 里的备份头部条目（分片不算），顺序不保证。 */
    async #readAll() {
        const allItems = await this.#browser.storage.sync.get(null);
        return Object.values(allItems ?? {}).filter(item =>
            item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            item.id.startsWith(CLOUD_BACKUP_PREFIX) &&
            typeof item.timestamp === 'number' &&
            typeof item.part !== 'number'
        );
    }

    /**
     * 深拷贝并清空凭据字段。
     *
     * 备份会进入浏览器账号（跨设备同步），API Key 一旦落进去就等于跟着账号走。
     * 清理放在存储层而不是调用方：调用方有四个（上传/下载/列表/删除）且将来还会增加，
     * 「每个调用方都记得先清理」是不能指望的约定。
     */
    #redactSecrets(value) {
        if (Array.isArray(value)) {
            return value.map(item => this.#redactSecrets(item));
        }
        if (!value || typeof value !== 'object') {
            return value;
        }

        const result = {};
        for (const [key, item] of Object.entries(value)) {
            result[key] = SECRET_FIELD_PATTERN.test(key) ? '' : this.#redactSecrets(item);
        }
        return result;
    }

    /**
     * 按 UTF-8 字节数切块。
     *
     * 配额按字节算而不是按字符算：中文条款一条 3 字节，按字符切会在长域名规则表上
     * 悄悄超限。用 `for...of` 按码点遍历，代理对（emoji、罕见汉字）不会被切成两半。
     */
    #splitIntoChunks(text) {
        const encoder = new TextEncoder();
        const chunks = [];
        let current = '';
        let currentBytes = 0;

        for (const char of text) {
            const charBytes = encoder.encode(char).length;
            if (currentBytes + charBytes > CHUNK_BYTES && current) {
                chunks.push(current);
                current = '';
                currentBytes = 0;
            }
            current += char;
            currentBytes += charBytes;
        }
        if (current) {
            chunks.push(current);
        }
        return chunks.length > 0 ? chunks : [''];
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
