import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

/**
 * 屏幕字幕的站点级策略。
 *
 * 历史缺陷：注入器自己遍历 `domainRules[hostname]`（精确等值）并读一个全仓库零写入的
 * 幽灵字段 `subtitleStrategy`，而选项页写的是 `subtitleSettings.strategy`。结果是
 * 「字幕策略 = 不使用」完全失效，站点规则也命不中子域 —— 界面上选了、保存了、
 * 有成功提示，行为一点没变。
 *
 * 现在注入器只问 `getEffectiveSettings(hostname)`，域名叠加的唯一权威实现。
 * 这里用**真实的 resolveEffectiveSettings** 生成有效设置，测的是两个模块的契约。
 */

globalThis.__foxlateBrowserMock = {
    runtime: { onMessage: { addListener() {} }, getURL: () => 'x' },
    tabs: { onRemoved: { addListener() {} } },
    storage: {
        onChanged: { addListener() {} },
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {} },
        sync: { get: async () => ({}), set: async () => {} },
    },
    i18n: { getMessage: () => '' },
};

const { createSubtitleInjector } = await bundleModule(
    reexportSource('src/background/subtitle-injection.js', ['createSubtitleInjector']),
    { prefix: 'foxlate-subtitle-injection-' },
);
const { resolveEffectiveSettings } = await bundleModule(
    reexportSource('src/common/settings-domain.js', ['resolveEffectiveSettings']),
    { prefix: 'foxlate-subtitle-effective-' },
);

function createHarness({ domainRules = {} } = {}) {
    const injections = [];
    const injector = createSubtitleInjector({
        ensureScriptsInjected: async (tabId, frameId, files) => {
            injections.push({ tabId, frameId, files });
            return true;
        },
        logError: () => {},
        settingsManager: {
            getEffectiveSettings: async (hostname) => resolveEffectiveSettings({ domainRules }, hostname),
        },
    });
    return { injector, injections };
}

const MANAGER = 'content/subtitle/subtitle-manager.js';

test('站点规则选定的策略覆盖默认表', async () => {
    const { injector, injections } = createHarness({
        domainRules: {
            'example.com': { subtitleSettings: { enabled: true, strategy: 'bilibili' } },
        },
    });

    await injector(7, 0, 'https://example.com/watch');

    assert.equal(injections.length, 1, '站点规则命中时必须注入一次');
    assert.deepEqual(injections[0].files, [MANAGER, 'content/subtitle/bilibili-subtitle-strategy.js']);
});

test('站点规则的「不使用」真的不注入（含默认表里的站点）', async () => {
    const { injector, injections } = createHarness({
        domainRules: {
            'www.youtube.com': { subtitleSettings: { enabled: true, strategy: 'none' } },
        },
    });

    await injector(8, 0, 'https://www.youtube.com/watch?v=1');

    assert.deepEqual(injections, [], '「不使用」必须什么都不注入');
});

test('规则按点边界命中子域（规则写在 youtube.com，访问 www.youtube.com）', async () => {
    const { injector, injections } = createHarness({
        domainRules: {
            'youtube.com': { subtitleSettings: { enabled: true, strategy: 'none' } },
        },
    });

    await injector(9, 0, 'https://www.youtube.com/watch?v=1');

    assert.deepEqual(injections, [], '最长后缀匹配必须让父域规则作用到子域');
});

test('没有规则时沿用默认策略表', async () => {
    const { injector, injections } = createHarness();

    await injector(10, 0, 'https://www.youtube.com/watch');

    assert.equal(injections.length, 1);
    assert.equal(injections[0].files[1], 'content/subtitle/youtube-subtitle-strategy.js');
});

test('默认表之外的站点且无规则时不注入', async () => {
    const { injector, injections } = createHarness();

    await injector(11, 0, 'https://unlisted.example/page');

    assert.deepEqual(injections, []);
});

test('订阅为关闭（enabled:false）的站点不注入', async () => {
    const { injector, injections } = createHarness({
        domainRules: {
            'www.youtube.com': { subtitleSettings: { enabled: false, strategy: 'youtube' } },
        },
    });

    await injector(12, 0, 'https://www.youtube.com/watch');

    assert.deepEqual(injections, []);
});
