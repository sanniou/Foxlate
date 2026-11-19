import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

/**
 * 历史/失败队列的写入粒度。
 *
 * 页面翻译按批回报结果，每批十几条。若每条都「读整表 + 写整表」，一个 500 段的页面
 * 就是约 1000 次全表读写，而且这些 await 排在译文上屏之前 —— 用户能直接感觉到卡顿。
 * 这里锁住三件事：
 *   1. N 条记录只产生 1 次写（合并 flush）；
 *   2. 读取走内存，不再重复读 storage；
 *   3. `flush()` 之后数据真的落到了 storage（不依赖定时器）。
 */

globalThis.__foxlateBrowserMock = {
    runtime: { onMessage: { addListener() {} } },
    storage: {
        onChanged: { addListener() {} },
        local: { get: async () => ({}), set: async () => {} },
    },
    i18n: { getMessage: () => '' },
};

const { TranslationHistoryStore, TranslationFailureQueue } = await bundleModule(
    reexportSource('src/background/translation-product-stores.js', [
        'TranslationHistoryStore',
        'TranslationFailureQueue',
    ]),
    { prefix: 'foxlate-product-stores-' },
);

function createCountingStorage(initial = {}) {
    const table = { ...initial };
    const counters = { get: 0, set: 0, bytes: 0 };
    return {
        counters,
        table,
        storage: {
            local: {
                get: async (key) => {
                    counters.get += 1;
                    return { [key]: table[key] };
                },
                set: async (patch) => {
                    counters.set += 1;
                    for (const [key, value] of Object.entries(patch)) {
                        table[key] = value;
                        counters.bytes += JSON.stringify(value).length;
                    }
                },
            },
        },
    };
}

test('同一个批次的 12 条记录只写一次 storage', async () => {
    const { counters, storage, table } = createCountingStorage();
    const store = new TranslationHistoryStore({ browserApi: { storage }, limit: 80 });

    for (let index = 0; index < 12; index += 1) {
        await store.recordSuccess({
            sourceText: `源 ${index}`,
            translatedText: `译 ${index}`,
            targetLang: 'zh-CN',
            sourceLang: 'en',
            engine: 'google',
            hostname: 'example.com',
        });
    }
    await store.flush();

    assert.equal(counters.get, 1, '整表只应读一次（首次加载），不是每条一次');
    assert.equal(counters.set, 1, '一批记录必须合并成一次写');
    assert.equal(table.translationHistory.length, 12);
    // 最新在前
    assert.equal(table.translationHistory[0].sourceText, '源 11');
});

test('list() 在写入前也能看到内存里的最新记录', async () => {
    const { storage } = createCountingStorage();
    const store = new TranslationHistoryStore({ browserApi: { storage } });

    await store.recordSuccess({
        sourceText: 'a', translatedText: 'b', targetLang: 'zh-CN', sourceLang: 'en', engine: 'google',
    });

    const items = await store.list();
    assert.equal(items.length, 1, '未 flush 时读取必须看到内存中的记录');
    assert.equal(items[0].translatedText, 'b');
});

test('超过上限时保留最新的记录', async () => {
    const { storage, table } = createCountingStorage();
    const store = new TranslationHistoryStore({ browserApi: { storage }, limit: 3 });

    for (const text of ['1', '2', '3', '4']) {
        await store.recordSuccess({
            sourceText: text, translatedText: text, targetLang: 'zh-CN', sourceLang: 'en', engine: 'google',
        });
    }
    await store.flush();

    assert.deepEqual(table.translationHistory.map(item => item.sourceText), ['4', '3', '2']);
});

test('失败队列同样合并写入，失败条目落在自己的表里', async () => {
    const { counters, storage, table } = createCountingStorage();
    const queue = new TranslationFailureQueue({ browserApi: { storage }, limit: 80 });

    await queue.recordFailure({
        sourceText: 'x', targetLang: 'zh-CN', sourceLang: 'en', engine: 'deeplx', error: 'HTTP 429',
    });
    await queue.recordFailure({
        sourceText: 'y', targetLang: 'zh-CN', sourceLang: 'en', engine: 'deeplx', error: 'HTTP 500',
    });
    await queue.flush();

    assert.equal(counters.set, 1);
    assert.equal(table.translationFailureQueue.length, 2);
    assert.equal(table.translationFailureQueue[0].error, 'HTTP 500');
});
