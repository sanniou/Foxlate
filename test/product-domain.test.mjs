import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function bundleProductModules() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-product-domain-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export {
            applyGlossaryToText,
            formatGlossaryEntries,
            normalizeGlossary,
            parseGlossaryEntries,
        } from ${JSON.stringify(path.join(projectRoot, 'src/common/translation-glossary.js'))};
        export {
            ProviderHealthStore,
            TranslationFailureQueue,
            TranslationHistoryStore,
        } from ${JSON.stringify(path.join(projectRoot, 'src/background/translation-product-stores.js'))};
    `);
    await writeFile(mockBrowserPath, 'export default globalThis.__foxlateBrowserMock;');

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'foxlate-product-test-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({
                    path: mockBrowserPath,
                }));
            },
        }],
    });

    const modules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

function createStorageBrowserMock() {
    const storage = {};
    return {
        storage,
        storageApi: {
            local: {
                async get(key) {
                    if (Array.isArray(key)) {
                        return Object.fromEntries(key.map(item => [item, storage[item]]));
                    }
                    return { [key]: storage[key] };
                },
                async set(values) {
                    Object.assign(storage, values);
                },
            },
        },
    };
}

test('translation glossary parses, normalizes, formats, and applies configured terms', async () => {
    const {
        applyGlossaryToText,
        formatGlossaryEntries,
        normalizeGlossary,
        parseGlossaryEntries,
    } = await bundleProductModules();

    const entries = parseGlossaryEntries('Foxlate => Foxlate\nOpenAI = OpenAI\nEmpty =>');
    assert.deepEqual(entries.map(entry => [entry.source, entry.target]), [
        ['Foxlate', 'Foxlate'],
        ['OpenAI', 'OpenAI'],
        ['Empty', 'Empty'],
    ]);

    const glossary = normalizeGlossary({ enabled: true, entries });
    assert.equal(applyGlossaryToText('foxlate works with openai', glossary), 'Foxlate works with OpenAI');
    assert.equal(formatGlossaryEntries(glossary.entries), 'Foxlate => Foxlate\nOpenAI => OpenAI\nEmpty => Empty');
    assert.equal(applyGlossaryToText('foxlate', { enabled: false, entries }), 'foxlate');
});

test('translation product stores bound history, resolve failures, and update provider health', async () => {
    const {
        ProviderHealthStore,
        TranslationFailureQueue,
        TranslationHistoryStore,
    } = await bundleProductModules();
    const { storageApi } = createStorageBrowserMock();

    const history = new TranslationHistoryStore({ browserApi: { storage: storageApi }, limit: 2 });
    await history.recordSuccess({ sourceText: 'one', translatedText: '一', targetLang: 'ZH', engine: 'google' });
    await history.recordSuccess({ sourceText: 'two', translatedText: '二', targetLang: 'ZH', engine: 'google' });
    await history.recordSuccess({ sourceText: 'three', translatedText: '三', targetLang: 'ZH', engine: 'google' });
    const historyItems = await history.list();
    assert.equal(historyItems.length, 2);
    assert.equal(historyItems[0].sourceText, 'three');
    assert.equal(historyItems[1].sourceText, 'two');

    const failures = new TranslationFailureQueue({ browserApi: { storage: storageApi }, limit: 5 });
    await failures.recordFailure({ sourceText: 'broken', targetLang: 'ZH', engine: 'deeplx', error: 'timeout' });
    const [failure] = await failures.list();
    assert.equal(failure.error, 'timeout');
    await failures.resolve(failure.id);
    assert.deepEqual(await failures.list(), []);

    const health = new ProviderHealthStore({ browserApi: { storage: storageApi } });
    await health.record({ engine: 'google', success: true, latencyMs: 32 });
    await health.record({ engine: 'google', success: false, error: 'rate limit', latencyMs: 1200 });
    const providers = await health.list();
    assert.equal(providers.google.status, 'degraded');
    assert.equal(providers.google.successCount, 1);
    assert.equal(providers.google.failureCount, 1);
    assert.equal(providers.google.lastError, 'rate limit');
});
