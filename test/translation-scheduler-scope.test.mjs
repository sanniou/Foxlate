import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

// 「还原」只能停自己那一页。
//
// 中断曾经只有 `interruptAll()` 一个粒度：任一标签页点还原，其它标签页正在付费请求里的
// 批量翻译会被一起 abort，随后在那页上被渲染成整页错误标记。

async function loadScheduler() {
    return bundleModule(reexportSource('src/background/translation-task-scheduler.js', ['TranslationTaskScheduler']), {
        prefix: 'foxlate-scheduler-scope-',
    });
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

test('interruptTab only aborts the given tab', async () => {
    const { TranslationTaskScheduler } = await loadScheduler();
    const scheduler = new TranslationTaskScheduler({ maxConcurrent: 5 });

    const gateA = deferred();
    const gateB = deferred();
    let signalA;
    let signalB;

    const taskA = scheduler.run(signal => {
        signalA = signal;
        return gateA.promise;
    }, { tabId: 1 });
    const taskB = scheduler.run(signal => {
        signalB = signal;
        return gateB.promise;
    }, { tabId: 2 });

    scheduler.interruptTab(1);
    // 正在跑的任务只拿到 abort 信号（自己负责退出），外层 promise 由 job 自己结算。
    assert.equal(signalA.aborted, true);
    assert.equal(signalB.aborted, false);

    gateA.resolve('a-done');
    gateB.resolve('b-done');

    assert.equal(await taskA, 'a-done');
    assert.equal(await taskB, 'b-done');
});

test('interruptTab drops queued tasks of the given tab and keeps the others', async () => {
    const { TranslationTaskScheduler } = await loadScheduler();
    const scheduler = new TranslationTaskScheduler({ maxConcurrent: 1 });

    const gate = deferred();
    const running = scheduler.run(() => gate.promise, { tabId: 1 });
    const queuedSameTab = scheduler.run(async () => 'never-run', { tabId: 1 });
    const queuedOtherTab = scheduler.run(async () => 'ran', { tabId: 2 });

    scheduler.interruptTab(1);
    gate.resolve('running-done');

    await running;
    await assert.rejects(queuedSameTab, error => error.name === 'AbortError');
    assert.equal(await queuedOtherTab, 'ran');
});

test('interruptTab without a tab id is a no-op', async () => {
    const { TranslationTaskScheduler } = await loadScheduler();
    const scheduler = new TranslationTaskScheduler({ maxConcurrent: 2 });

    const gate = deferred();
    const task = scheduler.run(() => gate.promise, { tabId: 3 });

    scheduler.interruptTab(undefined);
    gate.resolve('done');

    assert.equal(await task, 'done');
});
