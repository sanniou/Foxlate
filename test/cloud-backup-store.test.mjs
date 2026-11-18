// CloudBackupStore 的行为测试。
//
// 这个模块此前零测试，但它管的是用户的设置备份：轮转算错会删掉不该删的那一条，
// 或者干脆不删、把 `storage.sync` 的配额撑爆（Chrome 上 sync 只有 100KB，
// 写满之后所有同步写入都失败，是跨设备的连锁故障）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

const MAX_CLOUD_BACKUPS = 10;

let modulePromise;
function modules() {
    modulePromise ??= bundleModule(reexportSource('src/background/cloud-backup-store.js', ['CloudBackupStore']));
    return modulePromise;
}

/** 最小可用的 `storage.sync` 替身，记录每一次 remove。 */
function createSyncMock(initial = {}) {
    const data = { ...initial };
    const removed = [];
    return {
        data,
        removed,
        async get(keys) {
            if (keys === null || keys === undefined) {
                return { ...data };
            }
            if (typeof keys === 'string') {
                return keys in data ? { [keys]: data[keys] } : {};
            }
            if (Array.isArray(keys)) {
                return Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]]));
            }
            return {};
        },
        async set(items) {
            Object.assign(data, items);
        },
        async remove(keys) {
            for (const key of [].concat(keys)) {
                delete data[key];
                removed.push(key);
            }
        },
    };
}

function makeStore(sync, CloudBackupStore, logError = () => {}) {
    return new CloudBackupStore({ browserApi: { storage: { sync } }, logError });
}

test('upload 写入带前缀的条目，未超上限时不删任何东西', async () => {
    const { CloudBackupStore } = await modules();
    const sync = createSyncMock();
    const store = makeStore(sync, CloudBackupStore);

    const result = await store.upload({ targetLanguage: 'zh-CN' });

    assert.deepEqual(result, { success: true });
    assert.deepEqual(sync.removed, []);
    const keys = Object.keys(sync.data);
    const heads = keys.filter(key => /^foxlate_backup_\d+$/.test(key));
    assert.equal(heads.length, 1, 'id 前缀是既有的存储契约，改了会孤立用户已有的备份');
    assert.deepEqual(await store.download(heads[0]), { success: true, settings: { targetLanguage: 'zh-CN' } });
});

test('超过 storage.sync 单条上限（8KB）的设置被切成多片，且能完整取回', async () => {
    const { CloudBackupStore } = await modules();
    const sync = createSyncMock();
    const store = makeStore(sync, CloudBackupStore);

    // 引擎列表 + 中文域名规则让 JSON 轻松超过老的 8192 字节硬上限。
    const settingsToUpload = {
        aiEngines: Array.from({ length: 40 }, (_, index) => ({
            id: `engine-${index}`,
            name: `引擎 ${index}`,
            apiUrl: 'https://example.com/v1/chat/completions',
            model: 'gpt-4o-mini',
            customPrompt: '把 $1 翻译成中文，保留术语。'.repeat(4),
        })),
    };
    const totalBytes = new TextEncoder().encode(JSON.stringify(settingsToUpload)).length;
    assert.ok(totalBytes > 8192, `用例必须先超过单条上限，实际 ${totalBytes} 字节`);

    assert.deepEqual(await store.upload(settingsToUpload), { success: true });

    const keys = Object.keys(sync.data);
    assert.ok(keys.length > 1, '必须真的分成多条');
    for (const key of keys) {
        const bytes = new TextEncoder().encode(JSON.stringify({ [key]: sync.data[key] })).length;
        assert.ok(bytes <= 8192, `${key} 条目 ${bytes} 字节，超过 storage.sync 单条上限`);
    }

    const headId = keys.find(key => /^foxlate_backup_\d+$/.test(key));
    const downloaded = await store.download(headId);
    assert.equal(downloaded.success, true);
    assert.deepEqual(downloaded.settings, settingsToUpload);
});

test('上传时清空凭据字段：备份会进入浏览器账号，不能跟着 API Key 走', async () => {
    const { CloudBackupStore } = await modules();
    const sync = createSyncMock();
    const store = makeStore(sync, CloudBackupStore);

    await store.upload({
        targetLanguage: 'zh-CN',
        deeplxApiKey: 'should-not-leak',
        aiEngines: [{ id: 'a', apiKey: 'sk-secret', model: 'gpt', nested: { token: 'also-secret' } }],
    });

    const serialized = JSON.stringify(sync.data);
    assert.doesNotMatch(serialized, /sk-secret/);
    assert.doesNotMatch(serialized, /should-not-leak/);
    assert.doesNotMatch(serialized, /also-secret/);

    const headId = Object.keys(sync.data).find(key => /^foxlate_backup_\d+$/.test(key));
    const downloaded = await store.download(headId);
    assert.deepEqual(downloaded.settings, {
        targetLanguage: 'zh-CN',
        deeplxApiKey: '',
        aiEngines: [{ id: 'a', apiKey: '', model: 'gpt', nested: { token: '' } }],
    });
});

test('删除备份时连分片一起删，不留孤儿 key', async () => {
    const { CloudBackupStore } = await modules();
    const sync = createSyncMock();
    const store = makeStore(sync, CloudBackupStore);

    await store.upload({ aiEngines: Array.from({ length: 40 }, (_, i) => ({ id: String(i), customPrompt: 'x'.repeat(400) })) });
    const headId = Object.keys(sync.data).find(key => /^foxlate_backup_\d+$/.test(key));
    assert.ok(Object.keys(sync.data).length > 1);

    assert.deepEqual(await store.delete(headId), { success: true });
    assert.deepEqual(sync.data, {}, '头部与分片必须一起消失');
});

test('upload 超过上限时删掉最旧的那几条，只留 MAX 条', async t => {
    const { CloudBackupStore } = await modules();
    const sync = createSyncMock();
    const originalNow = Date.now;
    let tick = 1_000_000;
    Date.now = () => tick++;
    t.after(() => { Date.now = originalNow; });

    const store = makeStore(sync, CloudBackupStore, () => {});
    for (let i = 0; i < MAX_CLOUD_BACKUPS + 1; i += 1) {
        await store.upload({ seq: i });
    }

    const heads = Object.keys(sync.data).filter(key => /^foxlate_backup_\d+$/.test(key));
    assert.equal(heads.length, MAX_CLOUD_BACKUPS, '每条备份一个头部条目');
    assert.equal(sync.removed.filter(key => /^foxlate_backup_\d+$/.test(key)).length, 1);
    assert.equal(sync.removed[0], 'foxlate_backup_1000000', '被删的必须是最旧的那一条');

    const listed = await store.list();
    assert.equal(listed.backups.length, MAX_CLOUD_BACKUPS);
    assert.equal(listed.backups[0].id, 'foxlate_backup_1000010', 'list 必须最新在前');
});

test('list 忽略 storage.sync 里的非备份条目', async () => {
    const { CloudBackupStore } = await modules();
    const sync = createSyncMock({
        unrelatedSetting: { foo: 'bar' },
        'foxlate_backup_1': { id: 'foxlate_backup_1', timestamp: 10, settings: {} },
        // 形状不对的条目：缺 timestamp / id 前缀不符 / 根本不是对象
        'foxlate_backup_broken': { id: 'foxlate_backup_broken', settings: {} },
        other_prefix_2: { id: 'other_prefix_2', timestamp: 20, settings: {} },
        'foxlate_backup_3': 'not-an-object',
    });
    const store = makeStore(sync, CloudBackupStore);

    const result = await store.list();

    assert.equal(result.success, true);
    assert.deepEqual(result.backups.map(backup => backup.id), ['foxlate_backup_1']);
});

test('download 取回设置；id 不存在或为空时返回失败而不抛异常', async () => {
    const { CloudBackupStore } = await modules();
    const logged = [];
    const sync = createSyncMock({
        'foxlate_backup_9': { id: 'foxlate_backup_9', timestamp: 9, settings: { targetLanguage: 'ja' } },
    });
    const store = makeStore(sync, CloudBackupStore, (label, error) => logged.push([label, error.message]));

    assert.deepEqual(await store.download('foxlate_backup_9'), {
        success: true,
        settings: { targetLanguage: 'ja' },
    });

    assert.deepEqual(await store.download('foxlate_backup_missing'), {
        success: false,
        error: 'Backup not found.',
    });
    assert.deepEqual(await store.download(''), { success: false, error: 'Backup ID is required.' });
    assert.deepEqual(logged.map(entry => entry[0]), [
        'DOWNLOAD_SETTINGS_FROM_CLOUD',
        'DOWNLOAD_SETTINGS_FROM_CLOUD',
    ]);
});

test('delete 删除指定条目；存储层报错时转成失败结果并上报一次', async () => {
    const { CloudBackupStore } = await modules();
    const logged = [];
    const sync = createSyncMock({
        'foxlate_backup_5': { id: 'foxlate_backup_5', timestamp: 5, settings: {} },
    });
    const store = makeStore(sync, CloudBackupStore, (label, error) => logged.push([label, error.message]));

    assert.deepEqual(await store.delete('foxlate_backup_5'), { success: true });
    assert.deepEqual(sync.data, {});
    assert.deepEqual(logged, []);

    sync.remove = async () => { throw new Error('QUOTA_BYTES quota exceeded'); };
    assert.deepEqual(await store.delete('foxlate_backup_5'), {
        success: false,
        error: 'QUOTA_BYTES quota exceeded',
    });
    assert.deepEqual(logged, [['DELETE_CLOUD_BACKUP', 'QUOTA_BYTES quota exceeded']]);
});

test('四个入口都不会向上抛：存储层整体不可用时也返回失败结果', async () => {
    const { CloudBackupStore } = await modules();
    const logged = [];
    const brokenSync = {
        async get() { throw new Error('storage offline'); },
        async set() { throw new Error('storage offline'); },
        async remove() { throw new Error('storage offline'); },
    };
    const store = new CloudBackupStore({
        browserApi: { storage: { sync: brokenSync } },
        logError: (label, error) => logged.push([label, error.message]),
    });

    assert.deepEqual(await store.list(), { success: false, error: 'storage offline' });
    assert.deepEqual(await store.upload({}), { success: false, error: 'storage offline' });
    assert.deepEqual(await store.download('x'), { success: false, error: 'storage offline' });
    assert.deepEqual(await store.delete('x'), { success: false, error: 'storage offline' });

    assert.deepEqual(logged.map(entry => entry[0]), [
        'GET_CLOUD_BACKUPS',
        'UPLOAD_SETTINGS_TO_CLOUD',
        'DOWNLOAD_SETTINGS_FROM_CLOUD',
        'DELETE_CLOUD_BACKUP',
    ]);
});
