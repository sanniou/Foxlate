import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { bundleModule, projectRoot } from './helpers/bundle.mjs';

/**
 * 字幕管线（YouTube / Bilibili）此前只有静态断言，没有任何行为测试。
 * 这里锁住三件最容易悄悄坏掉的事：
 *   1. timedtext JSON → 带时间窗的句子（HTML 里拿不到的时间轴全靠它）；
 *   2. 当前播放时间 → 该显示哪几条字幕；
 *   3. 渲染器 / 观察器的状态复用与资源回收。
 */

const MESSAGES = { contextMenuErrorPrefix: 'Error' };

// 字幕模块按浏览器环境写，console 输出很密；测试里静音，只保留断言。
const realConsoleLog = console.log;
const realConsoleWarn = console.warn;
console.log = () => {};
console.warn = () => {};

const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="movie_player"><video></video><div class="caption-window"></div></div></body></html>',
    { pretendToBeVisual: true, url: 'https://www.youtube.com/watch?v=abc' },
);
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.MutationObserver = window.MutationObserver;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
// 默认设置：字幕开关关闭，自动启用流程会立刻结束而不是等 3 秒超时
window.getEffectiveSettings = async () => ({
    targetLanguage: 'zh',
    translatorEngine: 'ai',
    subtitleSettings: { enabled: false, displayMode: 'bilingual' },
});

const sentMessages = [];
const messageListeners = [];
globalThis.__foxlateBrowserMock = {
    i18n: { getMessage: (key) => MESSAGES[key] ?? '' },
    runtime: {
        sendMessage: async (message) => {
            sentMessages.push(message);
            return { success: true, translatedText: { translated: true, text: `${message.payload.text}-ZH` } };
        },
        onMessage: { addListener: (listener) => { messageListeners.push(listener); } },
    },
};

const subtitleDir = path.join(projectRoot, 'src/content/subtitle');
const mod = await bundleModule(
    Object.entries({
        SubtitleManager: 'subtitle-manager.js',
        SubtitleRenderer: 'subtitle-renderer.js',
        SubtitleTranslationClient: 'subtitle-translation-client.js',
        VideoSubtitleObserver: 'video-subtitle-observer.js',
        YouTubeSubtitleRenderer: 'youtube-subtitle-renderer.js',
        YouTubeSubtitleStrategy: 'youtube-subtitle-strategy.js',
        BilibiliSubtitleStrategy: 'bilibili-subtitle-strategy.js',
        parseYouTubeTimedSentences: 'youtube-subtitle-parser.js',
        waitForEffectiveSettings: 'subtitle-settings-readiness.js',
    }).map(([name, file]) => `export { ${name} } from ${JSON.stringify(path.join(subtitleDir, file))};`).join('\n'),
);

const {
    SubtitleManager,
    SubtitleRenderer,
    SubtitleTranslationClient,
    VideoSubtitleObserver,
    YouTubeSubtitleStrategy,
    BilibiliSubtitleStrategy,
    parseYouTubeTimedSentences,
    waitForEffectiveSettings,
} = mod;

const doc = window.document;

/* ────────────────────────── 1. timedtext 解析 ────────────────────────── */

function timedEvent(text, startMs, durationMs) {
    return { tStartMs: startMs, ...(durationMs === undefined ? {} : { dDurationMs: durationMs }), segs: [{ utf8: text }] };
}

test('解析器：空内容与非 JSON 都抛错，不返回半成品', () => {
    assert.throws(() => parseYouTubeTimedSentences(''), /Content is empty\./);
    assert.throws(() => parseYouTubeTimedSentences('   '), /Content is empty\./);
    assert.throws(() => parseYouTubeTimedSentences('{oops'), SyntaxError);
    assert.throws(() => parseYouTubeTimedSentences('{"foo":1}'), /Invalid JSON format\./);
});

test('解析器：丢掉括号标注块与没有 segs 的事件', () => {
    const payload = JSON.stringify({
        events: [
            timedEvent('[Music]', 0, 1000),
            { tStartMs: 1000, dDurationMs: 1000 },
            timedEvent('Hello there.', 2000, 1000),
        ],
    });

    const sentences = parseYouTubeTimedSentences(payload);
    assert.equal(sentences.length, 1);
    assert.equal(sentences[0].text, 'Hello there.');
});

test('解析器：缺 dDurationMs 时按 3 秒兜底，时间窗包含起止点', () => {
    const payload = JSON.stringify({ events: [timedEvent('Hi.', 5000)] });

    const [sentence] = parseYouTubeTimedSentences(payload);
    assert.equal(sentence.startTime, 5000);
    assert.equal(sentence.endTime, 8000);
});

test('解析器：按句末标点合并多段，句子时间窗跨到标点所在段', () => {
    const payload = JSON.stringify({
        events: [
            timedEvent('Hello', 1000, 1000),
            timedEvent('world.', 2000, 500),
            timedEvent('Next one', 3000, 1000),
        ],
    });

    const sentences = parseYouTubeTimedSentences(payload);
    assert.deepEqual(sentences.map(s => s.text), ['Hello world.', 'Next one']);
    assert.equal(sentences[0].startTime, 1000, '起点取句子开头那段');
    assert.equal(sentences[0].endTime, 2500, '终点取标点所在那段');
    assert.equal(sentences[1].startTime, 3000, '尾句没有标点也要保留');
    assert.equal(sentences[1].endTime, 4000);
});

test('解析器：中文标点同样断句，换行归一为空格', () => {
    const payload = JSON.stringify({
        events: [
            timedEvent('第一句', 0, 1000),
            timedEvent('结束。\n第二', 1000, 1000),
            timedEvent('句？', 2000, 1000),
        ],
    });

    const sentences = parseYouTubeTimedSentences(payload);
    assert.deepEqual(sentences.map(s => s.text), ['第一句结束。', '第二句？']);
});

test('解析器：广告字幕段没有可译内容时返回空数组，而不是抛错', () => {
    const payload = JSON.stringify({ events: [timedEvent('[Applause]', 0, 1000)] });
    assert.deepEqual(parseYouTubeTimedSentences(payload), []);
});

/* ────────────────────────── 2. 当前时间 → 该显示哪几条 ────────────────────────── */

function buildYouTubeStrategy() {
    const strategy = new YouTubeSubtitleStrategy(() => {});
    strategy.updateSettings({ subtitleSettings: { displayMode: 'bilingual' } });
    return strategy;
}

/** 让 caption 窗口在 jsdom 里“看起来是可见且有尺寸的”。 */
function stubCaptionGeometry(captionWindow) {
    Object.defineProperty(captionWindow, 'offsetHeight', { value: 24, configurable: true });
    captionWindow.style.display = 'block';
    captionWindow.getBoundingClientRect = () => ({ top: 300, left: 100, bottom: 324, right: 700, width: 600, height: 24 });
    const player = doc.querySelector('#movie_player');
    player.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 400, right: 800, width: 800, height: 400 });
}

test('播放时间落在哪句就渲染哪句，窗口外一条都不给', (t) => {
    const strategy = buildYouTubeStrategy();
    t.after(() => strategy.cleanup());
    stubCaptionGeometry(doc.querySelector('.caption-window'));

    strategy.subtitleScript = [
        { text: 'First.', translated: '第一', startTime: 1000, endTime: 2000 },
        { text: 'Second.', translated: '第二', startTime: 2500, endTime: 3500 },
    ];

    strategy.updateSubtitleDisplay(1.5);
    let overlay = doc.querySelector('#san-reader-translation-overlay');
    assert.equal(overlay.textContent, '第一\nFirst.');

    strategy.updateSubtitleDisplay(3.0);
    overlay = doc.querySelector('#san-reader-translation-overlay');
    assert.equal(overlay.textContent, '第二\nSecond.');

    strategy.updateSubtitleDisplay(2.2);
    assert.notEqual(overlay.textContent, '第一\nFirst.', '空白区间必须清掉上一条，不能留残影');
});

test('重叠的两条字幕同时显示，顺序与脚本一致', (t) => {
    const strategy = buildYouTubeStrategy();
    t.after(() => strategy.cleanup());
    stubCaptionGeometry(doc.querySelector('.caption-window'));

    strategy.subtitleScript = [
        { text: 'A.', translated: 'A译', startTime: 0, endTime: 3000 },
        { text: 'B.', translated: 'B译', startTime: 1000, endTime: 4000 },
    ];

    strategy.updateSubtitleDisplay(2);
    const overlay = doc.querySelector('#san-reader-translation-overlay');
    assert.deepEqual([...overlay.children].map(node => node.textContent), ['A译\nA.', 'B译\nB.']);
});

test('显示模式为 off 时不出现叠层', (t) => {
    const strategy = new YouTubeSubtitleStrategy(() => {});
    t.after(() => strategy.cleanup());
    stubCaptionGeometry(doc.querySelector('.caption-window'));

    strategy.subtitleScript = [{ text: 'A.', translated: 'A译', startTime: 0, endTime: 9000 }];
    strategy.updateSubtitleDisplay(1);

    const overlay = doc.querySelector('#san-reader-translation-overlay');
    assert.equal(overlay?.style.visibility ?? 'hidden', 'hidden');
});

test('关掉显示模式再打开，同一句字幕要重新出现', (t) => {
    const strategy = buildYouTubeStrategy();
    t.after(() => strategy.cleanup());
    stubCaptionGeometry(doc.querySelector('.caption-window'));

    strategy.subtitleScript = [{ text: 'A.', translated: 'A译', startTime: 0, endTime: 9000 }];

    strategy.updateSubtitleDisplay(1);
    const overlay = doc.querySelector('#san-reader-translation-overlay');
    assert.equal(overlay.style.visibility, 'visible');

    // 关掉显示模式（视频里什么都没变，所以 lines/top 与上次完全相同）
    strategy.videoElement = { currentTime: 1, removeEventListener: () => {} };
    strategy.updateSettings({ subtitleSettings: { displayMode: 'off' } });
    assert.equal(overlay.style.visibility, 'hidden');

    strategy.updateSettings({ subtitleSettings: { displayMode: 'bilingual' } });
    assert.equal(
        doc.querySelector('#san-reader-translation-overlay').style.visibility,
        'visible',
        '渲染缓存在关闭时必须失效，否则字幕再也回不来',
    );
});

test('视频观察器没在跑时，关掉显示模式同样要收起叠层', (t) => {
    const strategy = buildYouTubeStrategy();
    t.after(() => strategy.cleanup());
    stubCaptionGeometry(doc.querySelector('.caption-window'));

    strategy.subtitleScript = [{ text: 'A.', translated: 'A译', startTime: 0, endTime: 9000 }];
    strategy.updateSubtitleDisplay(1);
    const overlay = doc.querySelector('#san-reader-translation-overlay');
    assert.equal(overlay.style.visibility, 'visible');
    assert.equal(strategy.videoElement, null, '本用例的前提就是没有视频观察器');

    strategy.updateSettings({ subtitleSettings: { displayMode: 'off' } });
    assert.equal(
        overlay.style.visibility,
        'hidden',
        '翻译失败停掉观察器后，关开关不能等下一次 timeupdate——它永远不会来',
    );
});

/* ────────────────────────── 3. 渲染器：状态复用与失效 ────────────────────────── */

test('渲染器拒绝渲染已经脱离文档的元素', () => {
    const renderer = new SubtitleRenderer();
    const detached = doc.createElement('div');

    renderer.displayTranslatedSubtitle(detached, '不该出现');
    assert.equal(detached.children.length, 0);
});

test('渲染器复用同一个译文容器，错误态走 class 而不是重建 DOM', () => {
    const renderer = new SubtitleRenderer();
    const host = doc.createElement('div');
    doc.body.appendChild(host);

    renderer.displayTranslatedSubtitle(host, '你好');
    const container = host.querySelector('.foxlate-subtitle-translation-container');
    assert.equal(container.textContent, '你好');
    assert.equal(container.classList.contains('error'), false);

    renderer.displayTranslatedSubtitle(host, 'Error: boom', true);
    assert.equal(host.querySelectorAll('.foxlate-subtitle-translation-container').length, 1);
    assert.equal(container.textContent, 'Error: boom');
    assert.equal(container.classList.contains('error'), true);
});

test('渲染器把 null 元素当作“无事发生”而不是抛错', () => {
    assert.doesNotThrow(() => new SubtitleRenderer().displayTranslatedSubtitle(null, 'x'));
});

/* ────────────────────────── 4. 翻译客户端与就绪等待 ────────────────────────── */

test('字幕翻译客户端：拿不到生效设置时抛错，而不是发一条空消息', async () => {
    const client = new SubtitleTranslationClient({ windowRef: {} });
    await assert.rejects(() => client.translate('hi'), /Could not get effective settings\./);
});

test('字幕翻译客户端带上目标语言与引擎，并复用错误文案前缀', async () => {
    sentMessages.length = 0;
    const client = new SubtitleTranslationClient({ windowRef: window });

    const response = await client.translate('hello');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].payload.text, 'hello');
    assert.equal(sentMessages[0].payload.sourceLang, 'auto');
    assert.equal(sentMessages[0].payload.targetLang, 'zh');
    assert.equal(sentMessages[0].payload.translatorEngine, 'ai');
    assert.equal(response.success, true);

    assert.equal(client.getErrorText(new Error('boom')), 'Error: boom');
});

test('生效设置等待：已就绪立刻返回 true，超时返回 false 而不是抛错', async () => {
    assert.equal(await waitForEffectiveSettings({ getEffectiveSettings: () => {} }), true);
    assert.equal(await waitForEffectiveSettings({}, 60, 10), false);
});

test('生效设置等待：运行时就绪后返回 true', async () => {
    const windowRef = {};
    setTimeout(() => { windowRef.getEffectiveSettings = () => {}; }, 20);
    assert.equal(await waitForEffectiveSettings(windowRef, 500, 10), true);
});

/* ────────────────────────── 5. 管理器 ────────────────────────── */

function createManager(overrides = {}) {
    const calls = { initialize: 0, cleanup: 0 };
    const strategy = {
        initialize: () => { calls.initialize += 1; },
        cleanup: () => { calls.cleanup += 1; },
    };
    const manager = new SubtitleManager(overrides);
    manager.strategy = strategy;
    return { manager, strategy, calls };
}

test('管理器只接受第一个策略，重复注册被忽略', async () => {
    const manager = new SubtitleManager();
    await manager.registerStrategy(class First { initialize() {} cleanup() {} updateSettings() {} });
    const first = manager.strategy;

    await manager.registerStrategy(class Second { initialize() {} cleanup() {} });
    assert.equal(manager.strategy, first, '注入两个策略脚本时不能互相顶掉');
});

test('管理器 toggle 转发给策略，getStatus 反映支持与开关', () => {
    const { manager, calls } = createManager();

    assert.deepEqual(manager.getStatus(), { isSupported: true, isEnabled: false });
    manager.toggle(true);
    assert.deepEqual(manager.getStatus(), { isSupported: true, isEnabled: true });
    manager.toggle(false);
    assert.equal(calls.initialize, 1);
    assert.equal(calls.cleanup, 1);
});

test('管理器把 up-to-date 设置转发给策略', () => {
    const seen = [];
    const { manager } = createManager();
    manager.strategy.updateSettings = (settings) => seen.push(settings);

    manager.updateSettings({ subtitleSettings: { displayMode: 'off' } });
    assert.deepEqual(seen, [{ subtitleSettings: { displayMode: 'off' } }]);
});

test('管理器：翻译成功渲染译文，失败渲染带前缀的错误', async () => {
    const rendered = [];
    const { manager } = createManager({ renderer: { displayTranslatedSubtitle: (...args) => rendered.push(args) } });
    const host = doc.createElement('div');

    await manager.onSubtitleChange('hello', host);
    assert.deepEqual(rendered[0], [host, 'hello-ZH']);

    manager.translationClient = { translate: async () => ({ success: false, error: 'quota' }), getErrorText: () => 'Error' };
    await manager.onSubtitleChange('hello', host);
    assert.deepEqual(rendered[1], [host, 'Error: quota', true]);
});

test('管理器：翻译抛异常时渲染错误而不是让字幕管线静默停住', async () => {
    const rendered = [];
    const errors = [];
    const { manager } = createManager({
        renderer: { displayTranslatedSubtitle: (...args) => rendered.push(args) },
        logError: (...args) => errors.push(args),
    });
    const host = doc.createElement('div');

    manager.translationClient = {
        translate: async () => { throw new Error('network down'); },
        getErrorText: (error) => `Error: ${error.message}`,
    };

    await manager.onSubtitleChange('hello', host);
    assert.equal(errors.length, 1);
    assert.deepEqual(rendered[0], [host, 'Error: network down', true]);
});

test('管理器响应 popup 的状态查询', () => {
    const { manager } = createManager();
    const respond = (request) => {
        let payload;
        const handled = messageListeners.some((listener) => listener(request, {}, (value) => { payload = value; }));
        return { handled, payload };
    };

    const result = respond({ type: 'REQUEST_SUBTITLE_TRANSLATION_STATUS' });
    assert.equal(result.handled, true);
    assert.deepEqual(result.payload, { isSupported: true, isEnabled: false });

    const ignored = respond({ type: 'SOMETHING_ELSE' });
    assert.equal(ignored.handled, false, '不认识的消息必须返回 false，不能劫持别人的响应');
});

/* ────────────────────────── 6. 观察器与 Bilibili 策略 ────────────────────────── */

test('观察器 stop() 会取消还没等到容器出现的轮询', () => {
    const created = [];
    const cleared = [];
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    // 用假计时器：真实 setInterval 在本用例里永远不触发，留着只会把测试进程吊住
    globalThis.setInterval = () => { created.push(created.length + 1); return created.length; };
    globalThis.clearInterval = (id) => { cleared.push(id); };

    try {
        const observer = new VideoSubtitleObserver(() => {}, {
            targetSelector: '#never-appears',
            segmentSelector: 'span',
        });
        observer.start();
        observer.stop();

        assert.ok(created.length >= 1, 'start() 应该发起轮询');
        for (const id of created) {
            assert.ok(cleared.includes(id), '容器一直不出现时，轮询计时器必须被 stop() 清掉');
        }
    } finally {
        globalThis.setInterval = realSetInterval;
        globalThis.clearInterval = realClearInterval;
    }
});

test('观察器在容器出现后接上，并把整句字幕连同宿主元素交出去', () => {
    const container = doc.createElement('div');
    container.className = 'bili-player-subtitle-panel';
    const line = doc.createElement('div');
    line.className = 'bili-player-subtitle-text';
    for (const text of ['翻译', '字幕']) {
        const span = doc.createElement('span');
        span.textContent = text;
        line.appendChild(span);
    }
    container.appendChild(line);
    doc.body.appendChild(container);

    const seen = [];
    const observer = new VideoSubtitleObserver((text, element) => seen.push([text, element]), {
        targetSelector: '.bili-player-subtitle-panel',
        segmentSelector: '.bili-player-subtitle-text > span',
    });

    // 轮询到容器后应该接上 MutationObserver（假计时器，不拉开真实 1 秒轮询）
    const realSetInterval = globalThis.setInterval;
    let tick;
    globalThis.setInterval = (fn) => { tick = fn; return 1; };
    try {
        observer.start();
        assert.equal(observer.observer, null);
        tick();
    } finally {
        globalThis.setInterval = realSetInterval;
        assert.ok(observer.observer, '容器出现后必须接上监听');
    }

    observer.processSubtitles(container);
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], '翻译字幕', '中文片段之间不能凭空多出空格');
    assert.equal(seen[0][1], line, '宿主元素给的是 segment 的父节点，译文才能插到同一行');

    // 文本没变时不重复翻译
    observer.processSubtitles(container);
    assert.equal(seen.length, 1);

    line.lastChild.textContent = '字幕更新';
    observer.processSubtitles(container);
    assert.equal(seen.length, 2);
    assert.equal(seen[1][0], '翻译字幕更新');

    observer.stop();
    container.remove();
});

test('Bilibili 策略：只有播放器容器存在时才认为页面受支持', () => {
    const marker = doc.createElement('div');
    marker.className = 'bpx-player-container';

    assert.equal(BilibiliSubtitleStrategy.isSupportedPage(), false);
    doc.body.appendChild(marker);
    try {
        assert.equal(BilibiliSubtitleStrategy.isSupportedPage(), true);
    } finally {
        marker.remove();
    }
});

test('Bilibili 策略在非支持页面不启动观察器，cleanup 可重复调用', () => {
    const strategy = new BilibiliSubtitleStrategy(() => {});
    strategy.initialize();
    assert.equal(strategy.observer, null);
    assert.deepEqual(strategy.getStatus(), { isSupported: false, isEnabled: false });

    strategy.cleanup();
    assert.doesNotThrow(() => strategy.cleanup());
});

/* ────────────────────────── 7. 策略的状态判定 ────────────────────────── */

test('YouTube 策略：不在 /watch 页时自报不支持', (t) => {
    const strategy = buildYouTubeStrategy();
    t.after(() => strategy.cleanup());

    assert.equal(strategy.getStatus().isSupported, true);
    assert.equal(strategy.getStatus().isEnabled, false);

    strategy.subtitleScript = [{ text: 'A.', translated: 'A', startTime: 0, endTime: 1000 }];
    assert.equal(strategy.getStatus().isEnabled, false, '仅仅有字幕数据不算已启用，还要有视频观察器');

    strategy.spaNavigationHandler();
    assert.deepEqual(strategy.subtitleScript, [], 'SPA 跳转必须清掉上一支视频的字幕');
});

test.after(() => {
    console.log = realConsoleLog;
    console.warn = realConsoleWarn;
});
