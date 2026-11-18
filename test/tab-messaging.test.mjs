import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

// 「注入完成」不等于「脚本已就绪」。
//
// `scripting.executeScript` 返回后，content script 要到下一次任务才会有
// `runtime.onMessage` 监听器。这之间 sendMessage 会抛 Receiving end does not exist，
// 用户点翻译就是一次无声失败（badge 不动、页面不翻译、控制台也没有动作）。

async function loadMessaging() {
    return bundleModule(reexportSource('src/background/tab-messaging.js', ['sendMessageToContent', 'isContentConnectionLostError']), {
        prefix: 'foxlate-tab-messaging-',
    });
}

test('sendMessageToContent retries through the cold-start window', async () => {
    const { sendMessageToContent } = await loadMessaging();
    const attempts = [];
    const slept = [];
    const browserApi = {
        tabs: {
            async sendMessage(tabId, message) {
                attempts.push([tabId, message.type]);
                if (attempts.length < 3) {
                    throw new Error('Could not establish connection. Receiving end does not exist.');
                }
                return { success: true };
            },
        },
    };

    const result = await sendMessageToContent({
        browserApi,
        tabId: 7,
        message: { type: 'TOGGLE_TRANSLATION_REQUEST_AT_CONTENT' },
        retryDelaysMs: [10, 20, 40],
        sleep: async ms => slept.push(ms),
    });

    assert.deepEqual(result, { success: true });
    assert.equal(attempts.length, 3);
    assert.deepEqual(slept, [10, 20]);
});

test('sendMessageToContent gives up after the configured delays', async () => {
    const { sendMessageToContent } = await loadMessaging();
    let attempts = 0;
    const browserApi = {
        tabs: {
            async sendMessage() {
                attempts += 1;
                throw new Error('Could not establish connection. Receiving end does not exist.');
            },
        },
    };

    await assert.rejects(
        () => sendMessageToContent({
            browserApi,
            tabId: 1,
            message: { type: 'X' },
            retryDelaysMs: [5, 5],
            sleep: async () => {},
        }),
        /Receiving end does not exist/,
    );
    assert.equal(attempts, 3, 'one attempt plus one per configured delay');
});

test('sendMessageToContent rethrows failures that retrying cannot fix', async () => {
    const { sendMessageToContent } = await loadMessaging();
    let attempts = 0;
    const browserApi = {
        tabs: {
            async sendMessage() {
                attempts += 1;
                throw new Error('Invalid tab ID: 99');
            },
        },
    };

    await assert.rejects(
        () => sendMessageToContent({
            browserApi,
            tabId: 99,
            message: { type: 'X' },
            retryDelaysMs: [5, 5],
            sleep: async () => {},
        }),
        /Invalid tab ID/,
    );
    assert.equal(attempts, 1);
});
