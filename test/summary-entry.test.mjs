import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { bundleModule, projectRoot, reexportSource } from './helpers/bundle.mjs';

// 摘要包被拆成独立注入入口（`content/summary/summary-entry.js`）之后，
// 两个契约必须钉死：
//   1. 监听在模块顶层**同步**注册 —— `browser.scripting.executeScript` 在整个
//      IIFE 执行完才 resolve，后台注入完就发 TOGGLE_SUMMARY_REQUEST，晚一步就丢消息；
//   2. 快捷键路径自己就能把开关关的站点翻成「这一次要摘要」，不依赖内容运行时。

const summaryCalls = [];
let messageListener = null;
let settingsResponse = {};

const dom = new JSDOM('<!doctype html><html><body><main>text</main></body></html>', {
    url: 'https://example.com/page',
    pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getSelection = () => dom.window.getSelection();

globalThis.__foxlateBrowserMock = {
    runtime: {
        onMessage: {
            addListener(listener) {
                messageListener = listener;
            },
        },
        async sendMessage(message) {
            if (message.type === 'GET_EFFECTIVE_SETTINGS') return settingsResponse;
            return {};
        },
    },
    i18n: { getMessage: () => '' },
};

function createSummaryMockSource() {
    // 真实 summary.js 会建 DOM 面板；这里只需证明「入口按预期调用它」。
    const mockPath = path.join(os.tmpdir(), `foxlate-summary-mock-${process.pid}.js`);
    return writeFile(mockPath, `
        export function initializeSummary(settings) {
            globalThis.__summaryInitializeCalls.push(settings);
            globalThis.window.summaryModuleInstance = {
                selectionContext: 'stale-selection',
                async togglePageSummaryDialog() {
                    globalThis.__summaryToggleCalls += 1;
                },
            };
        }
    `).then(() => mockPath);
}

let bundled;

async function loadEntry({ summarySettings, aiEngines } = {}) {
    settingsResponse = {
        summarySettings,
        aiEngines,
        // 摘要模块会读的语言/引擎字段，给个完整形状避免无关分支报错。
        targetLanguage: 'zh',
        translatorEngine: 'ai:model-1',
    };

    const mockSummaryPath = await createSummaryMockSource();
    // 每个用例都是一张新页面：上一个用例建出来的面板实例必须清掉，
    // 否则后面的用例会复用旧实例，看不出「初始化路径」有没有真的走到。
    delete dom.window.summaryModuleInstance;
    globalThis.__summaryInitializeCalls = [];
    globalThis.__summaryToggleCalls = 0;

    bundled = await bundleModule(
        reexportSource('src/content/summary/summary-entry.js', ['bootstrapSummary']),
        {
            aliases: { 'summary\\.js$': mockSummaryPath },
            prefix: 'foxlate-summary-entry-',
        },
    );
    // bootstrapSummary 在模块顶层就被调用，等它落地。
    await new Promise(resolve => setTimeout(resolve, 0));
    return bundled;
}

test('消息监听在模块求值期同步注册（不等任何 await）', async () => {
    await loadEntry({ summarySettings: { enabled: false }, aiEngines: [] });

    assert.equal(typeof messageListener, 'function', '入口必须在顶层同步注册 onMessage 监听');
});

test('开关为关时只注册监听、不建摘要面板', async () => {
    await loadEntry({ summarySettings: { enabled: false }, aiEngines: [] });

    assert.deepEqual(globalThis.__summaryInitializeCalls, []);
    assert.equal(dom.window.summaryModuleInstance, undefined);
});

test('开关为开时按设置初始化摘要实例', async () => {
    await loadEntry({ summarySettings: { enabled: true }, aiEngines: [{ id: 'model-1' }] });

    assert.equal(globalThis.__summaryInitializeCalls.length, 1);
    assert.equal(globalThis.__summaryInitializeCalls[0].summarySettings.enabled, true);
    assert.ok(dom.window.summaryModuleInstance, '开关为开时面板实例必须就位');
});

test('快捷键路径把关闭的开关翻成本次启用，并清掉页面选区语境', async () => {
    await loadEntry({ summarySettings: { enabled: false }, aiEngines: [{ id: 'model-1' }] });
    // 页面上正选着一段话：快捷键说的是「总结整页」，不该沿用这段选区。
    const originalGetSelection = dom.window.getSelection;
    dom.window.getSelection = () => ({ toString: () => 'selected paragraph' });

    try {
        const result = await messageListener({ type: 'TOGGLE_SUMMARY_REQUEST' });

        assert.deepEqual(result, { success: true });
        assert.equal(globalThis.__summaryToggleCalls, 1);
        const forced = globalThis.__summaryInitializeCalls.at(-1).summarySettings;
        assert.equal(forced.enabled, true, '快捷键必须当场启用摘要');
        assert.equal(forced.aiModel, 'model-1', '强制启用时取用户配的第一个 AI 引擎');
        assert.equal(dom.window.summaryModuleInstance.selectionContext, null, '有选区时快捷键要丢掉选区语境');
    } finally {
        dom.window.getSelection = originalGetSelection;
    }
});

test('没有选区时快捷键不碰选区语境（用户可能正要总结选中段落）', async () => {
    await loadEntry({ summarySettings: { enabled: false }, aiEngines: [{ id: 'model-1' }] });
    const originalGetSelection = dom.window.getSelection;
    dom.window.getSelection = () => ({ toString: () => '   ' });

    try {
        await messageListener({ type: 'TOGGLE_SUMMARY_REQUEST' });
        assert.equal(dom.window.summaryModuleInstance.selectionContext, 'stale-selection');
    } finally {
        dom.window.getSelection = originalGetSelection;
    }
});

test('不是自己的消息就放行（返回 undefined，不吞其它类型的响应）', async () => {
    await loadEntry({ summarySettings: { enabled: false }, aiEngines: [] });

    assert.equal(messageListener({ type: 'SOMETHING_ELSE' }), undefined);
});
