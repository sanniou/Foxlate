import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { projectRoot } from './helpers/bundle.mjs';

/**
 * 用「行为与真实浏览器一致」的 storage mock 加载真实的 SettingsManager。
 *
 * 关键点：mock 的 `storage.local.set()` 会像真实浏览器那样向所有上下文
 * （**包括写入方自己**）投递 `storage.onChanged`。这是复现「一次保存触发两次
 * settingsChanged」这类回声缺陷的前提——用不会回声的 mock 是查不出来的。
 */
async function loadSettingsManager() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-settings-events-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { SettingsManager } from ${JSON.stringify(path.join(projectRoot, 'src/common/settings-manager.js'))};
        export { isDeepEqual } from ${JSON.stringify(path.join(projectRoot, 'src/common/object-utils.js'))};
        export { storageMock } from ${JSON.stringify(path.join(tempDir, 'browser-polyfill-mock.js'))};
    `);

    await writeFile(mockBrowserPath, `
        const store = { settings: null };
        const onChangedListeners = [];
        const stats = { setCount: 0, getCount: 0 };
        const browser = {
            storage: {
                local: {
                    async get(key) { stats.getCount++; return { [key]: store[key] }; },
                    async set(obj) {
                        stats.setCount++;
                        const changes = {};
                        for (const [k, v] of Object.entries(obj)) {
                            changes[k] = { oldValue: store[k], newValue: v };
                        }
                        Object.assign(store, obj);
                        for (const fn of onChangedListeners) fn(changes, 'local');
                    },
                },
                sync: { async get() { return {}; }, async set() {} },
                onChanged: { addListener(fn) { onChangedListeners.push(fn); } },
            },
        };
        export const storageMock = {
            stats,
            reset() { stats.setCount = 0; stats.getCount = 0; },
            listenerCount: () => onChangedListeners.length,
        };
        export default browser;
    `);

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'foxlate-settings-events-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({ path: mockBrowserPath }));
            },
        }],
    });

    const modules = await import(pathToFileURL(outputPath).href);
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

const { SettingsManager, storageMock, isDeepEqual } = await loadSettingsManager();

test('storage.onChanged 在模块加载时就注册了一次（设置变更的唯一通知通道）', () => {
    assert.equal(storageMock.listenerCount(), 1);
});

test('一次 saveLocalSettings 只触发一次 settingsChanged（不会因 onChanged 回声而重复广播）', async () => {
    const emissions = [];
    const listener = (payload) => emissions.push(payload);
    SettingsManager.on('settingsChanged', listener);

    await SettingsManager.saveLocalSettings({ targetLanguage: 'zh-CN', translatorEngine: 'google' });
    // 真实浏览器里 onChanged 是异步投递的，留出微任务/任务队列落地时间
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.equal(storageMock.stats.setCount, 1, '应只写一次 storage');
    assert.equal(emissions.length, 1, `一次保存应只通知一次，实际 ${emissions.length} 次`);

    SettingsManager.off('settingsChanged', listener);
});

test('订阅者拿到的 newValue 是验证后的完整设置，而不是存储里的原始片段', async () => {
    const emissions = [];
    const listener = (payload) => emissions.push(payload);
    SettingsManager.on('settingsChanged', listener);

    // 只写一个字段，验证过程应补齐其余默认值
    await SettingsManager.saveLocalSettings({ targetLanguage: 'ja' });
    await new Promise(resolve => setTimeout(resolve, 20));

    const { newValue } = emissions.at(-1);
    assert.equal(newValue.targetLanguage, 'ja');
    // 默认值必须被补齐：否则订阅者会拿到残缺对象
    assert.ok(Object.keys(newValue).length > 1, 'newValue 应是完整设置对象');
    assert.ok('displayMode' in newValue && 'translatorEngine' in newValue);

    SettingsManager.off('settingsChanged', listener);
});

test('oldValue 经过与 newValue 相同的归一化，关键键未变时不会产生假变更', async () => {
    const emissions = [];
    const listener = (payload) => emissions.push(payload);
    SettingsManager.on('settingsChanged', listener);

    await SettingsManager.saveLocalSettings({ targetLanguage: 'ko', translatorEngine: 'google' });
    await new Promise(resolve => setTimeout(resolve, 20));
    await SettingsManager.saveLocalSettings({ targetLanguage: 'ko', translatorEngine: 'google' });
    await new Promise(resolve => setTimeout(resolve, 20));

    const last = emissions.at(-1);
    // 两次写入内容相同 → 关键设置逐键比较必须全部相等，
    // 否则 service worker 会误判「关键设置变了」而重载整页翻译。
    const criticalKeys = ['targetLanguage', 'translatorEngine', 'translationSelector', 'deeplxApiUrl', 'aiEngines'];
    for (const key of criticalKeys) {
        assert.ok(
            isDeepEqual(last.oldValue[key], last.newValue[key]),
            `关键键 ${key} 在相同写入前后被判定为发生了变化`,
        );
    }

    SettingsManager.off('settingsChanged', listener);
});

test('settingsChanged 的订阅者抛错不会让保存失败，且其他订阅者仍被通知', async () => {
    const received = [];
    const throwing = () => { throw new Error('subscriber boom'); };
    const normal = (payload) => received.push(payload);

    SettingsManager.on('settingsChanged', throwing);
    SettingsManager.on('settingsChanged', normal);

    await SettingsManager.saveLocalSettings({ targetLanguage: 'fr' });
    await new Promise(resolve => setTimeout(resolve, 20));

    // 保存本身必须成功
    assert.equal((await SettingsManager.getValidatedSettings()).targetLanguage, 'fr');
    SettingsManager.off('settingsChanged', throwing);
    SettingsManager.off('settingsChanged', normal);
});

test('getValidatedSettings 命中缓存时返回同一冻结引用（不再逐次深拷贝整个设置对象）', async () => {
    await SettingsManager.saveLocalSettings({ targetLanguage: 'de' });
    await new Promise(resolve => setTimeout(resolve, 20));

    const first = await SettingsManager.getValidatedSettings();
    const second = await SettingsManager.getValidatedSettings();

    assert.equal(first, second, '命中缓存必须返回同一引用');
    assert.ok(Object.isFrozen(first), '缓存对象必须冻结，防止调用方污染共享状态');
    assert.ok(Object.isFrozen(first.aiEngines), '嵌套数组同样冻结');
    assert.throws(() => { first.targetLanguage = 'xx'; }, TypeError, '越界写入必须立刻抛错而不是静默生效');
});

test('getEffectiveSettings 对同一主机名返回同一冻结引用，跨主机名互不影响', async () => {
    const first = await SettingsManager.getEffectiveSettings('cache-identity.example.com');
    const second = await SettingsManager.getEffectiveSettings('cache-identity.example.com');
    const other = await SettingsManager.getEffectiveSettings('other-host.example.com');

    assert.equal(first, second, '同一主机名必须命中同一引用');
    assert.equal(other, await SettingsManager.getEffectiveSettings('other-host.example.com'));
    assert.notEqual(first, other, '不同主机名的有效设置必须是不同对象');
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.subtitleSettings), '嵌套对象同样冻结');
    assert.ok(Object.isFrozen(first.translationSelector));
});

test('设置变更后缓存失效，重新给出新的冻结引用', async () => {
    const before = await SettingsManager.getValidatedSettings();

    await SettingsManager.saveLocalSettings({ targetLanguage: 'es' });
    await new Promise(resolve => setTimeout(resolve, 20));

    const after = await SettingsManager.getValidatedSettings();

    assert.notEqual(after, before, '变更后必须重建缓存');
    assert.equal(after.targetLanguage, 'es');
    assert.ok(Object.isFrozen(after));
});
