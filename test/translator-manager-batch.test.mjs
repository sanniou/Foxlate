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
        export { TranslationCacheStore } from ${JSON.stringify(path.join(projectRoot, 'src/background/translation-cache-store.js'))};
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
    const sentTabMessages = [];
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
        tabs: {
            async sendMessage(tabId, message) {
                sentTabMessages.push({ tabId, message });
            },
        },
    };
    return { sentTabMessages };
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
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = (callback, _delay, ...args) => realSetTimeout(callback, 0, ...args);
    globalThis.clearTimeout = realClearTimeout;
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

        assert.equal(fetchCalls.length, 3);
        assert.deepEqual(JSON.parse(fetchCalls[0].messages[1].content), ['Hello', 'World']);
        assert.equal(results.length, 2);
        assert.deepEqual(results.map(result => result.translated), [false, false]);
        assert.match(results[0].error, /AI batch translation failed/);
    } finally {
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
        globalThis.setTimeout = realSetTimeout;
        globalThis.clearTimeout = realClearTimeout;
    }
});

test('TranslatorManager.translateBatch retries a retryable AI batch once and keeps batch shape', async () => {
    const { sentTabMessages } = setupMocks();
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = (callback, _delay, ...args) => realSetTimeout(callback, 0, ...args);
    globalThis.clearTimeout = realClearTimeout;
    const fetchCalls = [];
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        fetchCalls.push(body);
        if (fetchCalls.length === 1) {
            return {
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                async json() {
                    return { error: { message: 'rate limited' } };
                },
            };
        }
        const input = JSON.parse(body.messages[1].content);
        return {
            ok: true,
            async json() {
                return {
                    choices: [{
                        message: {
                            content: JSON.stringify(input.map(text => `${text}-retry-ZH`)),
                        },
                    }],
                };
            },
        };
    };

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        const { TranslatorManager } = await loadTranslatorManager();

        const results = await TranslatorManager.translateBatch(['Hello', 'World'], 'ZH', 'auto', 'ai:test', 77);

        assert.equal(fetchCalls.length, 2);
        assert.deepEqual(JSON.parse(fetchCalls[0].messages[1].content), ['Hello', 'World']);
        assert.deepEqual(JSON.parse(fetchCalls[1].messages[1].content), ['Hello', 'World']);
        assert.deepEqual(results.map(result => result.text), ['Hello-retry-ZH', 'World-retry-ZH']);
        assert.equal(sentTabMessages.some(entry => entry.message.type === 'TRANSLATION_RETRY_SCHEDULED'), true);
    } finally {
        console.error = originalConsoleError;
        globalThis.setTimeout = realSetTimeout;
        globalThis.clearTimeout = realClearTimeout;
    }
});

// --- 回归：单条路径与批量路径必须共享同一张在途请求表（K1） ---

/**
 * AI 引擎的 fetch 替身：记录每次请求实际送出去的待译文本。
 *
 * 单条路径把待译文本直接放进 user message（原文），批量路径放的是
 * `JSON.stringify(texts)`（JSON 数组）——因此这里按形状分别推断请求类型，
 * 并回以对应的响应形状。
 */
function installAiFetch(fetchCalls, { delayMs = 0 } = {}) {
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        const userContent = body.messages[body.messages.length - 1].content;

        let batchInput = null;
        try {
            const parsed = JSON.parse(userContent);
            if (Array.isArray(parsed)) {
                batchInput = parsed;
            }
        } catch {
            // 不是 JSON 数组 → 单条路径，user message 就是原文
        }

        const reply = batchInput
            ? JSON.stringify(batchInput.map(text => `${text}-ZH`))
            : `${userContent}-ZH`;

        fetchCalls.push(batchInput ?? userContent);
        if (delayMs) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        return {
            ok: true,
            async json() {
                return { choices: [{ message: { content: reply } }] };
            },
        };
    };
}

test('同一段文本的并发 AI 批量翻译只调用一次付费接口', { timeout: 20000 }, async () => {
    setupMocks();
    const fetchCalls = [];
    installAiFetch(fetchCalls, { delayMs: 5 });

    const { TranslatorManager } = await loadTranslatorManager();

    // 两个标签页同时对同一段文本发起批量翻译。
    // 修复前：AI 批量路径完全绕过 #inFlightRequests，两个批次各调一次接口。
    const [first, second] = await Promise.all([
        TranslatorManager.translateBatch(['Hello'], 'ZH', 'auto', 'ai:test', 1),
        TranslatorManager.translateBatch(['Hello'], 'ZH', 'auto', 'ai:test', 2),
    ]);

    assert.equal(fetchCalls.length, 1, '并发批次必须共享同一个在途请求');
    assert.deepEqual(fetchCalls[0], ['Hello']);
    assert.deepEqual(first.map(result => result.text), ['Hello-ZH']);
    assert.deepEqual(second.map(result => result.text), ['Hello-ZH']);
});

test('单条翻译与批量翻译并发同一段文本时共享在途请求', { timeout: 20000 }, async () => {
    setupMocks();
    const fetchCalls = [];
    installAiFetch(fetchCalls, { delayMs: 5 });

    const { TranslatorManager } = await loadTranslatorManager();

    const [single, batch] = await Promise.all([
        TranslatorManager.translateText('Hello', 'ZH', 'auto', 'ai:test', 1),
        TranslatorManager.translateBatch(['Hello'], 'ZH', 'auto', 'ai:test', 2),
    ]);

    assert.equal(fetchCalls.length, 1, '单条与批量必须命同一个在途项');
    assert.equal(single.text, 'Hello-ZH');
    assert.deepEqual(batch.map(result => result.text), ['Hello-ZH']);
});

test('同一批内的重复文本只发给 AI 一次', { timeout: 20000 }, async () => {
    setupMocks();
    const fetchCalls = [];
    installAiFetch(fetchCalls);

    const { TranslatorManager } = await loadTranslatorManager();

    const results = await TranslatorManager.translateBatch(['Hello', 'World', 'Hello'], 'ZH', 'auto', 'ai:test');

    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(fetchCalls[0], ['Hello', 'World'], '重复文本不得重复送往付费接口');
    assert.deepEqual(results.map(result => result.text), ['Hello-ZH', 'World-ZH', 'Hello-ZH']);
});

// --- 回归：非 AI 批量不再退化成串行（F2 类的性能问题） ---

test('非 AI 批量翻译并行推进，不再逐条串行等待', { timeout: 20000 }, async () => {
    setupMocks();
    globalThis.__foxlateSettingsMock.translatorEngine = 'google';

    let inFlight = 0;
    let maxInFlight = 0;
    const pendingReleases = [];
    globalThis.fetch = async (_url, options) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => pendingReleases.push(resolve));
        inFlight--;
        const text = decodeURIComponent(new URLSearchParams(options.body).get('q'));
        return { ok: true, async json() { return [[[`${text}-ZH`, text]]]; } };
    };

    const { TranslatorManager } = await loadTranslatorManager();

    // 持续放行已到达的请求：并发额度填满时，多个 fetch 会同时处于在途状态，
    // maxInFlight 于是能观察到真实并发度。若退化为串行，则顺序放行也能完成，
    // maxInFlight 只会是 1——断言失败而不是死锁。
    const release = setInterval(() => {
        while (pendingReleases.length > 0) {
            pendingReleases.shift()();
        }
    }, 1);

    try {
        const texts = ['a', 'b', 'c', 'd', 'e'];
        const results = await TranslatorManager.translateBatch(texts, 'ZH', 'auto', 'google');

        assert.deepEqual(results.map(result => result.text), texts.map(text => `${text}-ZH`));
        assert.equal(
            maxInFlight,
            5,
            '批内多条文本应并行推进（修复前逐条 await，最大并发恒为 1）',
        );
    } finally {
        clearInterval(release);
    }
});

// --- 回归：缓存 load() 必须收敛到 maxSize（K3）---

test('TranslationCacheStore.load 会把超限缓存收敛到 maxSize', { timeout: 20000 }, async () => {
    setupMocks();
    globalThis.__foxlateBrowserMock.storage.local.get = async () => ({
        translationCache: { a: '1', b: '2', c: '3', d: '4' },
    });

    const { TranslationCacheStore } = await loadTranslatorManager();
    const store = new TranslationCacheStore({
        browserApi: globalThis.__foxlateBrowserMock,
        maxSize: 2,
    });

    const size = await store.load();

    assert.equal(size, 2, '用户把 cacheSize 调小后重启，超限部分必须立即丢弃');
    assert.equal(store.size, 2);
    assert.equal(store.limit, 2);
});
