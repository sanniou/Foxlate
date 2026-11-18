import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

// AI 批量接口的失败不应该连坐。
//
// 模型偶尔会漏一条、把数组包进一句话里，或直接返回对象。以前这种形状问题会
// 让同一次付费请求里的十几条一起标红，用户看到整页错误，而其中大多数文本其实
// 完全能翻。

function createExecutor({ translateBatch, messages = [] }) {
    return bundleModule(reexportSource('src/background/translation-executor.js', ['TranslationExecutor']), {
        prefix: 'foxlate-ai-batch-',
    }).then(({ TranslationExecutor }) => {
        const batches = [];
        const executor = new TranslationExecutor({
            browserApi: {
                i18n: {
                    getMessage(key, args) {
                        return args === undefined ? key : `${key}:${JSON.stringify(args)}`;
                    },
                },
            },
            cacheStore: {
                has: () => false,
                touch: () => '',
                set: () => {},
                scheduleSave: () => {},
            },
            retryController: {
                execute: ({ operation }) => operation(),
            },
            engineResolver: {
                getTranslator: () => ({
                    name: 'AI',
                    translateBatch(texts) {
                        batches.push([...texts]);
                        return translateBatch(texts);
                    },
                }),
                withTabContext: async config => config,
            },
        });
        return { executor, batches, messages };
    });
}

function createItems(texts) {
    return texts.map((text, index) => ({
        index,
        prepared: {
            textForTranslation: text,
            cacheKey: `key-${index}`,
            glossary: { enabled: false, entries: [] },
        },
    }));
}

test('a shape failure on a big batch is isolated by splitting it', async () => {
    const { executor, batches } = await createExecutor({
        // 只要一次给三条以上，模型就漏一条并触发长度不匹配。
        translateBatch: async (texts) => {
            if (texts.length > 2) {
                throw new Error(`AI batch translation failed: AI batch response length mismatch: expected ${texts.length}, got ${texts.length - 1}.`);
            }
            return { texts: texts.map(text => `译:${text}`) };
        },
    });

    const results = await executor.executeAiBatchGroup(
        createItems(['a', 'b', 'c', 'd']),
        'ZH',
        'auto',
        'ai:default',
        {},
        undefined,
        1,
    );

    assert.deepEqual(results.map(result => result.index), [0, 1, 2, 3]);
    assert.deepEqual(results.map(result => result.text), ['译:a', '译:b', '译:c', '译:d']);
    assert.equal(results.every(result => result.translated), true);
    assert.deepEqual(batches.at(0), ['a', 'b', 'c', 'd'], '整批先试一次');
    assert.deepEqual(batches.at(-1), ['c', 'd'], '失败后拆成两半，各自成功');
});

test('a failing single item only fails itself', async () => {
    const { executor } = await createExecutor({
        translateBatch: async (texts) => {
            if (texts.includes('毒性')) {
                throw new Error('AI batch translation failed: AI batch response length mismatch: expected 1, got 0.');
            }
            return { texts: texts.map(text => `译:${text}`) };
        },
    });

    const results = await executor.executeAiBatchGroup(
        createItems(['a', '毒性']),
        'ZH',
        'auto',
        'ai:default',
        {},
        undefined,
        1,
    );

    assert.equal(results[0].translated, true);
    assert.equal(results[0].text, '译:a');
    assert.equal(results[1].translated, false);
    assert.match(results[1].error, /length mismatch/);
});

test('auth failures are reported once and never fan out', async () => {
    const { executor, batches } = await createExecutor({
        translateBatch: async () => {
            throw new Error('API Error: 401 Unauthorized');
        },
    });

    const results = await executor.executeAiBatchGroup(
        createItems(['a', 'b', 'c', 'd']),
        'ZH',
        'auto',
        'ai:default',
        {},
        undefined,
        1,
    );

    assert.equal(batches.length, 1, '鉴权错误拆小只会变成四次报错');
    assert.equal(results.every(result => result.translated === false), true);
    assert.equal(results.every(result => /401/.test(result.error)), true);
});

test('abort is not swallowed into per-item errors', async () => {
    const { executor } = await createExecutor({
        translateBatch: async () => {
            throw new DOMException('Translation was interrupted by the user.', 'AbortError');
        },
    });

    await assert.rejects(
        () => executor.executeAiBatchGroup(createItems(['a', 'b']), 'ZH', 'auto', 'ai:default', {}, undefined, 1),
        error => error.name === 'AbortError',
    );
});
