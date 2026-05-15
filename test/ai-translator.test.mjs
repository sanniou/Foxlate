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
