import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { projectRoot } from './helpers/bundle.mjs';

/**
 * 单字段写入（引擎增删、域规则属性）必须是「读最新 storage → 改 → 写」。
 *
 * 这里的 storage mock 刻意**延迟投递** `storage.onChanged`：真实浏览器里一次
 * `storage.local.set()` 完成后，onChanged 要等一轮 IPC 才到其它上下文。在它到达
 * 之前，任何"先读缓存、再整对象回写"的实现都会把另一个上下文的写入整段抹掉。
 * 用同步投递 onChanged 的 mock 测不出这个窗口——缓存会立刻失效。
 */
async function loadSettingsManager() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-settings-fresh-read-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { SettingsManager } from ${JSON.stringify(path.join(projectRoot, 'src/common/settings-manager.js'))};
        export { store, writeFromAnotherContext, flushChanges } from ${JSON.stringify(path.join(tempDir, 'browser-polyfill-mock.js'))};
    `);

    await writeFile(mockBrowserPath, `
        export const store = { settings: null };
        const listeners = [];
        const pending = [];

        function record(obj) {
            const changes = {};
            for (const [key, value] of Object.entries(obj)) {
                changes[key] = { oldValue: store[key], newValue: value };
            }
            Object.assign(store, obj);
            pending.push(changes);
        }

        const browser = {
            storage: {
                local: {
                    async get(key) { return { [key]: store[key] }; },
                    async set(obj) { record(obj); },
                },
                sync: { async get() { return {}; }, async set() {} },
                onChanged: { addListener(fn) { listeners.push(fn); } },
            },
        };

        /** 模拟另一个上下文写入：storage 已变，onChanged 尚未送达本上下文。 */
        export function writeFromAnotherContext(obj) {
            record(obj);
        }

        /** 送达此前积压的 onChanged。 */
        export function flushChanges() {
            const batches = pending.splice(0, pending.length);
            for (const changes of batches) {
                for (const listener of listeners) listener(changes, 'local');
            }
        }

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
            name: 'foxlate-settings-fresh-read-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({ path: mockBrowserPath }));
            },
        }],
    });

    const modules = await import(pathToFileURL(outputPath).href);
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

const { SettingsManager, store, writeFromAnotherContext, flushChanges } = await loadSettingsManager();

function seed(settings) {
    store.settings = settings;
    SettingsManager.clearCache();
}

test('removing an AI engine keeps the domain rule another context just wrote', async () => {
    seed({
        domainRules: { 'old.example': { displayMode: 'hover' } },
        aiEngines: [{ id: 'a1', name: 'A', apiUrl: 'https://x', model: 'm', apiKey: 'k' }],
    });
    await SettingsManager.getValidatedSettings(); // 本上下文缓存住旧快照

    // 另一个上下文（另一个 popup）改了域规则，onChanged 还没送到这里。
    writeFromAnotherContext({
        settings: { ...store.settings, domainRules: { 'new.example': { displayMode: 'append' } } },
    });

    await SettingsManager.removeAiEngine('a1');

    assert.deepEqual(Object.keys(store.settings.domainRules), ['new.example'], '旧快照回写会把另一个上下文的修改抹掉');
    assert.deepEqual(store.settings.aiEngines, []);
});

test('saving a domain rule keeps the engine another context just added', async () => {
    seed({
        domainRules: {},
        aiEngines: [],
    });
    await SettingsManager.getValidatedSettings();

    writeFromAnotherContext({
        settings: {
            ...store.settings,
            aiEngines: [{ id: 'b1', name: 'B', apiUrl: 'https://y', model: 'm', apiKey: 'k' }],
        },
    });

    await SettingsManager.saveDomainRuleProperty('docs.example', 'displayMode', 'hover');

    assert.deepEqual(store.settings.aiEngines.map(engine => engine.id), ['b1']);
    assert.equal(store.settings.domainRules['docs.example'].displayMode, 'hover');

    // 迟到的 onChanged 也必须能被消费，不能把状态改回去。
    flushChanges();
    assert.deepEqual(store.settings.aiEngines.map(engine => engine.id), ['b1']);
});
