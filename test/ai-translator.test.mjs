import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');
let bundledModules;

async function loadAITranslator() {
    if (bundledModules) {
        return bundledModules;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-ai-translator-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { AITranslator } from ${JSON.stringify(path.join(projectRoot, 'src/background/translators/ai-translator.js'))};
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
            name: 'browser-polyfill-mock',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({
                    path: mockBrowserPath,
                }));
            },
        }],
    });

    bundledModules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return bundledModules;
}

function setupBrowserMock() {
    globalThis.__foxlateBrowserMock = {
        i18n: {
            getMessage(key, args) {
                return args ? `${key}:${JSON.stringify(args)}` : key;
            },
        },
    };
}

function createConfig() {
    return {
        apiKey: 'key',
        apiUrl: 'https://example.test/v1/chat/completions',
        model: 'model',
        customPrompt: 'Translate to {targetLang}: {textToTranslate}',
    };
}

function installFetchMock(content) {
    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return {
            ok: true,
            async json() {
                return {
                    choices: [{ message: { content } }],
                };
            },
        };
    };
    return calls;
}

test('AITranslator.translateBatch sends one JSON-array request and parses JSON array response', async () => {
    setupBrowserMock();
    const calls = installFetchMock('["你好","世界"]');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    const result = await translator.translateBatch(['Hello', 'World'], 'ZH', 'auto', createConfig());

    assert.deepEqual(result.texts, ['你好', '世界']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.test/v1/chat/completions');
    assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), ['Hello', 'World']);
    assert.match(calls[0].body.messages[0].content, /Return only a valid JSON array/);
    assert.match(calls[0].body.messages[0].content, /Preserve any XML-like placeholder tags/);
});

test('AITranslator.translateBatch accepts fenced JSON array response', async () => {
    setupBrowserMock();
    installFetchMock('```json\n["A","B"]\n```');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    const result = await translator.translateBatch(['a', 'b'], 'EN', 'auto', createConfig());

    assert.deepEqual(result.texts, ['A', 'B']);
});

test('AITranslator.translateBatch rejects length mismatch', async () => {
    setupBrowserMock();
    installFetchMock('["only one"]');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await assert.rejects(
            () => translator.translateBatch(['one', 'two'], 'ZH', 'auto', createConfig()),
            /length mismatch/
        );
    } finally {
        console.error = originalConsoleError;
    }
});

test('AITranslator.translateBatch rejects non-string array items', async () => {
    setupBrowserMock();
    installFetchMock('["ok",{"bad":true}]');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await assert.rejects(
            () => translator.translateBatch(['one', 'two'], 'ZH', 'auto', createConfig()),
            /must be a string/
        );
    } finally {
        console.error = originalConsoleError;
    }
});

test('user text containing dollar replacements is inserted literally into the prompt', async () => {
    setupBrowserMock();
    const calls = installFetchMock('["ok"]');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    const text = 'price $& and $\' and $1 and $`';
    const config = { ...createConfig(), customPrompt: 'Translate to {targetLang}: {textToTranslate}' };
    await translator.translate(text, 'ZH', 'auto', config);

    const systemPrompt = calls[0].body.messages[0].content;
    // `$&` 是“整个匹配”，`$'` 是“匹配之后的剩余文本”。字符串形式的替换值会被
    // 解析成这些模式，把用户原文换成别的东西（`$'` 还会无限复制尾巴）。
    assert.ok(systemPrompt.includes(text), `prompt must contain the literal text, got: ${systemPrompt}`);
});

test('AITranslator.translateBatch parses a JSON array wrapped in prose', async () => {
    setupBrowserMock();
    installFetchMock('Here you go:\n["甲","乙"]\nHope this helps');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    const result = await translator.translateBatch(['a', 'b'], 'ZH', 'auto', createConfig());

    assert.deepEqual(result.texts, ['甲', '乙']);
});

test('AITranslator.translateBatch keeps brackets inside strings intact', async () => {
    setupBrowserMock();
    installFetchMock('Sure: ["含 [方括号] 的译文", "带 ] 的右括号"] done');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    const result = await translator.translateBatch(['a', 'b'], 'ZH', 'auto', createConfig());

    assert.deepEqual(result.texts, ['含 [方括号] 的译文', '带 ] 的右括号']);
});

test('AITranslator.translateBatch 校正被模型换序的返回（按占位标签锚定）', async () => {
    // 长度检查通过但顺序被打乱时，以前会把 A 段译文写进 B 段元素：界面正常、内容错位。
    setupBrowserMock();
    installFetchMock('["<t1>乙</t1>","<t0>甲</t0>"]');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    const result = await translator.translateBatch(['<t0>One</t0>', '<t1>Two</t1>'], 'ZH', 'auto', createConfig());

    assert.deepEqual(result.texts, ['<t0>甲</t0>', '<t1>乙</t1>']);
});

test('AITranslator.translateBatch 发现占位标签丢失时抛可重试错误', async () => {
    setupBrowserMock();
    installFetchMock('["纯文本，标签没了","<t1>乙</t1>"]');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        await assert.rejects(
            () => translator.translateBatch(['<t0>One</t0>', '<t1>Two</t1>'], 'ZH', 'auto', createConfig()),
            /lost placeholder tags/,
        );
    } finally {
        console.error = originalConsoleError;
    }
});

test('批量请求不再把数组同时塞进 system prompt 和 user message', async () => {
    // 之前请求体是原文的 2.16 倍：system prompt 里一次、user message 里又一次。
    setupBrowserMock();
    const calls = installFetchMock('["你好","世界"]');
    const { AITranslator } = await loadAITranslator();
    const translator = new AITranslator();

    await translator.translateBatch(['Hello', 'World'], 'ZH', 'auto', createConfig());

    const systemPrompt = calls[0].body.messages[0].content;
    assert.doesNotMatch(systemPrompt, /"Hello"/, 'system prompt 不应重复完整数组');
    assert.match(systemPrompt, /user message/);
    assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), ['Hello', 'World']);
});
