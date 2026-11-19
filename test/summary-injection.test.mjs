import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

// 摘要包（readability 正文抽取 + marked 渲染 + 面板 UI，约 278 KB）不进内容包，
// 只在真的要摘要时注入。这里是注入侧的三条边界：
//   1. 开关为关 → 不注入（否则拆包的成绩立刻作废）；
//   2. 快捷键强制 → 无视开关（用户当场要了就是开）；
//   3. 设置读不出来 → 不注入（宁可少注入一次，不要给所有页面塞 278 KB）。
//
// 注入前判断开关这件事必须留在后台：内容侧不能自己决定要不要下载自己的依赖。

globalThis.__foxlateBrowserMock = createBrowserMock();

const { createSummaryInjector } = await bundleModule(
    reexportSource('src/background/summary-injection.js', ['createSummaryInjector']),
    { prefix: 'foxlate-summary-injection-' },
);

function createBrowserMock() {
    return {
        runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({}) },
        tabs: { onRemoved: { addListener() {} }, sendMessage: async () => ({}) },
        storage: {
            onChanged: { addListener() {} },
            local: { get: async () => ({}), set: async () => {} },
            session: { get: async () => ({}), set: async () => {} },
            sync: { get: async () => ({}), set: async () => {} },
        },
        i18n: { getMessage: () => '' },
    };
}

function createHarness({ summaryEnabled = false, settingsError = null } = {}) {
    const injections = [];
    const ensureScriptsInjected = async (tabId, frameId, files) => {
        injections.push({ tabId, frameId, files });
        return true;
    };
    const settingsManager = {
        async getEffectiveSettings() {
            if (settingsError) throw settingsError;
            return { summarySettings: { enabled: summaryEnabled } };
        },
    };
    const errors = [];
    const ensureSummaryInjected = createSummaryInjector({
        ensureScriptsInjected,
        logError: (context, error) => errors.push({ context, error }),
        settingsManager,
    });
    return { ensureSummaryInjected, injections, errors };
}

test('开关为关时摘要包一次都不注入', async () => {
    const { ensureSummaryInjected, injections } = createHarness({ summaryEnabled: false });

    assert.equal(await ensureSummaryInjected(42, { hostname: 'example.com' }), false);
    assert.deepEqual(injections, [], '摘要开关为关时必须零注入');
});

test('开关为开时把样式与脚本一起注入顶层文档', async () => {
    const { ensureSummaryInjected, injections } = createHarness({ summaryEnabled: true });

    assert.equal(await ensureSummaryInjected(42, { hostname: 'example.com' }), true);
    assert.deepEqual(injections, [{
        tabId: 42,
        frameId: 0,
        files: [
            'common/tokens.css',
            'content/control-reset.css',
            'content/summary/summary.css',
            'content/summary/summary-entry.js',
        ],
    }]);
});

test('快捷键路径无视开关（用户当场要了摘要）', async () => {
    const { ensureSummaryInjected, injections } = createHarness({ summaryEnabled: false });

    assert.equal(await ensureSummaryInjected(7, { force: true }), true);
    assert.equal(injections.length, 1);
    assert.deepEqual(injections[0].files.sort(), [
        'common/tokens.css',
        'content/control-reset.css',
        'content/summary/summary-entry.js',
        'content/summary/summary.css',
    ].sort());
});

test('调用方给出 enabled=false 时不注入，也不回读设置', async () => {
    let reads = 0;
    const ensureSummaryInjected = createSummaryInjector({
        ensureScriptsInjected: async () => true,
        logError: () => {},
        settingsManager: {
            async getEffectiveSettings() {
                reads += 1;
                return { summarySettings: { enabled: true } };
            },
        },
    });

    assert.equal(await ensureSummaryInjected(42, { enabled: false }), false);
    assert.equal(reads, 0, '结论已由内容侧给出时不该再读一次设置（那正是缓存陈旧导致面板不出现的根因）');
});

test('调用方给出 enabled=true 时直接注入，同样不回读设置', async () => {
    let reads = 0;
    const injections = [];
    const ensureSummaryInjected = createSummaryInjector({
        ensureScriptsInjected: async (tabId, frameId, files) => { injections.push(files); return true; },
        logError: () => {},
        settingsManager: {
            async getEffectiveSettings() {
                reads += 1;
                return { summarySettings: { enabled: false } };
            },
        },
    });

    assert.equal(await ensureSummaryInjected(42, { enabled: true }), true);
    assert.equal(reads, 0);
    assert.equal(injections.length, 1);
});

test('设置读取失败时不注入，并把原因记进日志', async () => {
    const { ensureSummaryInjected, injections, errors } = createHarness({
        settingsError: new Error('storage unavailable'),
    });

    assert.equal(await ensureSummaryInjected(42, {}), false);
    assert.deepEqual(injections, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0].context, /read settings/);
});

test('没有 tabId 时直接返回 false，不读设置也不注入', async () => {
    const { ensureSummaryInjected, injections } = createHarness({ summaryEnabled: true });

    assert.equal(await ensureSummaryInjected(undefined, {}), false);
    assert.deepEqual(injections, []);
});
