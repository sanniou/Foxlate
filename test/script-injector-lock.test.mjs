import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

/**
 * 同一 (tab, frame) 的注入必须串行。
 *
 * 这里是「读已注入清单 → 执行注入 → 写回清单」，没有锁时两个并发调用会同时读到
 * 「未注入」，同一份 content script 被执行两次：监听器、观察器、单例全部叠一套。
 * 已复现的后果：二次注入 subtitle-manager 后，一次状态请求收到两个响应，先到的
 * `isSupported:false` 让 popup 的字幕控件直接消失。
 *
 * 并发来源很常见：用户点 popup 的翻译按钮的同时，导航事件也在注入。
 */

globalThis.__foxlateBrowserMock = {
    runtime: { onMessage: { addListener() {} }, getURL: () => 'x' },
    tabs: { onRemoved: { addListener() {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    storage: {
        onChanged: { addListener() {} },
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {} },
        sync: { get: async () => ({}), set: async () => {} },
    },
    i18n: { getMessage: () => '' },
};

const { createEnsureScriptsInjected } = await bundleModule(
    reexportSource('src/background/script-injector.js', ['createEnsureScriptsInjected']),
    { prefix: 'foxlate-script-injector-' },
);

function createHarness({ injected = [] } = {}) {
    const marks = [];
    const injectedFiles = new Set(injected);
    const calls = { css: 0, js: 0 };

    const tabStateManager = {
        getInjectedFiles: async () => {
            // 模拟跨进程读取的延迟，让两个并发调用都能读到同一份旧快照。
            await new Promise(resolve => setTimeout(resolve, 5));
            return [...injectedFiles];
        },
        markFrameAsInjected: async (_tabId, _frameId, files) => {
            marks.push(files);
            for (const file of files) injectedFiles.add(file);
        },
    };

    const browserApi = {
        scripting: {
            insertCSS: async () => {
                calls.css += 1;
                await new Promise(resolve => setTimeout(resolve, 10));
            },
            executeScript: async () => {
                calls.js += 1;
                await new Promise(resolve => setTimeout(resolve, 10));
            },
        },
    };

    const ensureScriptsInjected = createEnsureScriptsInjected({
        browserApi,
        tabStateManager,
        logError: () => {},
    });

    return { ensureScriptsInjected, calls, marks, injectedFiles };
}

test('并发注入同一帧时只执行一次', async () => {
    const { ensureScriptsInjected, calls, marks } = createHarness();
    const files = ['content/style.css', 'content/content-script.js'];

    const results = await Promise.all([
        ensureScriptsInjected(1, 0, files),
        ensureScriptsInjected(1, 0, files),
        ensureScriptsInjected(1, 0, files),
    ]);

    assert.deepEqual(results, [true, true, true]);
    assert.equal(calls.css, 1, 'CSS 只应注入一次');
    assert.equal(calls.js, 1, '脚本只应注入一次');
    assert.equal(marks.length, 1, '注入清单只应写回一次');
});

test('不同帧互不阻塞，各自注入一次', async () => {
    const { ensureScriptsInjected, calls } = createHarness();
    const files = ['content/content-script.js'];

    const results = await Promise.all([
        ensureScriptsInjected(1, 0, files),
        ensureScriptsInjected(1, 7, files),
    ]);

    assert.deepEqual(results, [true, true]);
    assert.equal(calls.js, 2, '两个帧各注一次');
});

test('已注入的文件不会重复执行', async () => {
    const { ensureScriptsInjected, calls } = createHarness({ injected: ['content/content-script.js'] });

    assert.equal(await ensureScriptsInjected(2, 0, ['content/content-script.js']), true);
    assert.equal(calls.js, 0);
});

test('注入失败返回 false，并且不会卡死后续调用', async () => {
    let fail = true;
    const injectedFiles = new Set();
    const ensureScriptsInjected = createEnsureScriptsInjected({
        browserApi: {
            scripting: {
                insertCSS: async () => {},
                executeScript: async () => {
                    if (fail) throw new Error('Cannot access contents of the page');
                },
            },
        },
        tabStateManager: {
            getInjectedFiles: async () => [...injectedFiles],
            markFrameAsInjected: async () => {},
        },
        logError: () => {},
    });

    assert.equal(await ensureScriptsInjected(3, 0, ['content/content-script.js']), false, '失败必须如实返回');
    fail = false;
    assert.equal(await ensureScriptsInjected(3, 0, ['content/content-script.js']), true, '锁必须被释放');
});
