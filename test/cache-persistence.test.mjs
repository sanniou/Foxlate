import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

// 缓存必须真的落盘。
//
// `scheduleSave` 原来是纯 debounce：每来一批翻译就 clearTimeout 重排。整页翻译
// 期间新批次间隔远小于 2s，计时器被无限推后，于是「整页翻完、缓存一条没存」；
// 此时 service worker 被回收，所有付费结果直接消失。

async function loadCacheStore() {
    globalThis.__foxlateBrowserMock = {
        storage: { local: { get: async () => ({}), set: async () => {} } },
    };
    return bundleModule(reexportSource('src/background/translation-cache-store.js', ['TranslationCacheStore']), {
        prefix: 'foxlate-cache-persist-',
    });
}

test('repeated scheduleSave calls still persist within the max delay', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { TranslationCacheStore } = await loadCacheStore();

    const saves = [];
    const store = new TranslationCacheStore({
        browserApi: {
            storage: {
                local: {
                    get: async () => ({}),
                    set: async payload => saves.push(Object.keys(payload.translationCache).length),
                },
            },
        },
        saveDelayMs: 2000,
        maxSaveDelayMs: 6000,
    });

    store.set('k1', 'v1');
    store.scheduleSave();
    // 模拟连续批次：每 1s 再来一次，永远凑不出 2s 静默窗口。
    let savedWhileStreaming = 0;
    for (let second = 1; second <= 10; second += 1) {
        t.mock.timers.tick(1000);
        store.set(`k${second + 1}`, `v${second + 1}`);
        store.scheduleSave();
        await Promise.resolve();
        if (second === 7 && saves.length > 0) {
            savedWhileStreaming = saves.length;
        }
    }
    t.mock.timers.tick(6000);
    await Promise.resolve();

    assert.ok(
        savedWhileStreaming >= 1,
        '连续批次进行到第 7 秒时必须已经落盘过——否则 service worker 被回收时整页付费结果全丢',
    );
    assert.ok(saves.length >= 1);
});

test('a single scheduleSave still waits for the debounce delay', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const { TranslationCacheStore } = await loadCacheStore();

    let saved = 0;
    const store = new TranslationCacheStore({
        browserApi: {
            storage: {
                local: {
                    get: async () => ({}),
                    set: async () => { saved += 1; },
                },
            },
        },
        saveDelayMs: 2000,
        maxSaveDelayMs: 15000,
    });

    store.set('k', 'v');
    store.scheduleSave();

    t.mock.timers.tick(1999);
    await Promise.resolve();
    assert.equal(saved, 0, '静默窗口未到之前不该写');

    t.mock.timers.tick(1);
    await Promise.resolve();
    assert.equal(saved, 1);
});
