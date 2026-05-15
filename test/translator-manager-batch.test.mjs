import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function loadTranslatorManager() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-translator-manager-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');
    const mockSettingsPath = path.join(tempDir, 'settings-manager-mock.js');

    await writeFile(entryPath, `
        export { TranslatorManager } from ${JSON.stringify(path.join(projectRoot, 'src/background/translator-manager.js'))};
    `);
    await writeFile(mockBrowserPath, 'export default globalThis.__foxlateBrowserMock;');
    await writeFile(mockSettingsPath, `
        export const SettingsManager = {
            async getValidatedSettings() {
                return globalThis.__foxlateSettingsMock;
            }
        };
    `);

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'foxlate-test-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({
                    path: mockBrowserPath,
                }));
                buildContext.onResolve({ filter: /common\/settings-manager\.js$/ }, () => ({
                    path: mockSettingsPath,
                }));
            },
        }],
    });

    const modules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

function setupMocks() {
    globalThis.__foxlateSettingsMock = {
        translatorEngine: 'ai:test',
        parallelRequests: 5,
        cacheSize: 5000,
        aiEngines: [{
            id: 'test',
            apiKey: 'key',
            apiUrl: 'https://example.test/v1/chat/completions',
            model: 'model',
            customPrompt: 'Translate to {targetLang}: {textToTranslate}',
        }],
    };
    globalThis.__foxlateBrowserMock = {
        i18n: {
            getMessage(key, args) {
                return args ? `${key}:${JSON.stringify(args)}` : key;
            },
        },
        storage: {
            local: {
                async get() { return {}; },
                async set() {},
            },
            onChanged: {
                addListener() {},
            },
        },
    };
}

test('TranslatorManager.translateBatch uses one AI batch request and caches per item', async () => {
    setupMocks();
    const fetchCalls = [];
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        fetchCalls.push(body);
        const input = JSON.parse(body.messages[1].content);
        return {
            ok: true,
            async json() {
                return {
                    choices: [{
                        message: {
                            content: JSON.stringify(input.map(text => `${text}-ZH`)),
                        },
                    }],
                };
            },
        };
    };

    const { TranslatorManager } = await loadTranslatorManager();

    const firstResults = await TranslatorManager.translateBatch(['Hello', 'World'], 'ZH', 'auto', 'ai:test');
    const secondResults = await TranslatorManager.translateBatch(['World', 'Hello'], 'ZH', 'auto', 'ai:test');

    assert.deepEqual(firstResults.map(result => result.text), ['Hello-ZH', 'World-ZH']);
    assert.deepEqual(secondResults.map(result => result.text), ['World-ZH', 'Hello-ZH']);
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(JSON.parse(fetchCalls[0].messages[1].content), ['Hello', 'World']);
});

test('TranslatorManager.translateBatch keeps single AI item in batch shape', async () => {
    setupMocks();
    const fetchCalls = [];
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        fetchCalls.push(body);
        return {
            ok: true,
            async json() {
                return {
                    choices: [{
                        message: {
                            content: '["Hello-ZH"]',
                        },
                    }],
                };
            },
        };
    };

    const { TranslatorManager } = await loadTranslatorManager();

    const results = await TranslatorManager.translateBatch(['Hello'], 'ZH', 'auto', 'ai:test');

    assert.deepEqual(results.map(result => result.text), ['Hello-ZH']);
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(JSON.parse(fetchCalls[0].messages[1].content), ['Hello']);
});

test('TranslatorManager.translateBatch returns per-item errors without single fallback when AI batch fails', async () => {
    setupMocks();
    const fetchCalls = [];
    globalThis.fetch = async (_url, options) => {
        fetchCalls.push(JSON.parse(options.body));
        return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            async json() {
                return { error: { message: 'rate limited' } };
            },
        };
    };

    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    console.error = () => {};
    console.warn = () => {};
    try {
        const { TranslatorManager } = await loadTranslatorManager();

        const results = await TranslatorManager.translateBatch(['Hello', 'World'], 'ZH', 'auto', 'ai:test');

        assert.equal(fetchCalls.length, 1);
        assert.deepEqual(JSON.parse(fetchCalls[0].messages[1].content), ['Hello', 'World']);
        assert.equal(results.length, 2);
        assert.deepEqual(results.map(result => result.translated), [false, false]);
        assert.match(results[0].error, /AI batch translation failed/);
    } finally {
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
    }
});
