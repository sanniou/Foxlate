import test from 'node:test';
import assert from 'node:assert/strict';

import { bundleModule, reexportSource } from './helpers/bundle.mjs';

const logger = await bundleModule(
    reexportSource('src/common/error-logger.js', ['ABORT_POLICY', 'createErrorLogger']),
    { mockBrowserPolyfill: false },
);
const { logBackgroundError } = await bundleModule(
    reexportSource('src/background/background-logger.js', ['logBackgroundError']),
    { mockBrowserPolyfill: false },
);

/** 捕获一次调用产生的 console 输出。 */
function capture(run) {
    const originalLog = console.log;
    const originalError = console.error;
    const logged = [];
    const errored = [];
    console.log = (...args) => logged.push(args);
    console.error = (...args) => errored.push(args);
    try {
        run();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return { logged, errored };
}

test('error-logger：error 为 null/undefined 时不得自己抛错', () => {
    // 回归：旧的内容侧实现直接读 error.message，于是错误处理器抛 TypeError，
    // 把原始故障盖掉 —— 用户看到的错误是「记录日志失败」而不是真正的失败。
    const logError = logger.createErrorLogger();

    for (const value of [null, undefined, 0, '']) {
        const { errored } = capture(() => {
            assert.doesNotThrow(() => logError('ctx', value), `${String(value)} 不应抛错`);
        });
        assert.equal(errored.length, 1, `${String(value)} 应产生一条 console.error`);
        assert.equal(errored[0][1], value || 'An unknown error occurred.');
    }
});

test('error-logger：Error 实例记录 message 与 stack', () => {
    const logError = logger.createErrorLogger({ prefix: 'Foxlate Error' });
    const error = new Error('boom');

    const { errored } = capture(() => logError('page translate', error));

    assert.equal(errored.length, 1);
    assert.equal(errored[0][0], '[Foxlate Error] in page translate:');
    assert.equal(errored[0][1], 'boom');
    assert.equal(errored[0][2], error.stack);
});

test('error-logger：AbortError 按策略分流（silent / info / error）', () => {
    const abort = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

    const silent = capture(() => logger.createErrorLogger({
        abortPolicy: logger.ABORT_POLICY.SILENT,
    })('ctx', abort()));
    assert.deepEqual([silent.logged.length, silent.errored.length], [0, 0], 'silent 应完全静默');

    const info = capture(() => logger.createErrorLogger({
        abortPolicy: logger.ABORT_POLICY.INFO,
    })('ctx', abort()));
    assert.equal(info.logged.length, 1, 'info 应记一条 console.log');
    assert.equal(info.errored.length, 0, 'info 不得记为错误');
    assert.match(info.logged[0][0], /Task was interrupted in ctx/);

    const asError = capture(() => logger.createErrorLogger({
        abortPolicy: logger.ABORT_POLICY.ERROR,
    })('ctx', abort()));
    assert.equal(asError.logged.length, 0);
    assert.equal(asError.errored.length, 1, 'error 策略应记为错误');
});

test('error-logger：非 Error 值原样记录，不做字符串化', () => {
    const logError = logger.createErrorLogger();
    const payload = { code: 42 };

    const { errored } = capture(() => logError('ctx', payload));

    assert.equal(errored[0][1], payload, '应传原对象，便于控制台展开');
});

test('后台错误记录器对 AbortError 记 info 而不是 error', () => {
    const abort = Object.assign(new Error('interrupted'), { name: 'AbortError' });

    const { logged, errored } = capture(() => logBackgroundError('translation job', abort));

    assert.equal(errored.length, 0, '后台里中止是预期路径，不该记为错误');
    assert.equal(logged.length, 1);
    assert.match(logged[0][0], /Task was interrupted in translation job/);
});
