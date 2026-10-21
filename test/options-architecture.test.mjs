import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createI18nMock } from './helpers/i18n-mock.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function bundleOptionsModules() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-options-architecture-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { rootReducer, diffState } from ${JSON.stringify(path.join(projectRoot, 'src/options/options-state.js'))};
        export { queryOptionsElements } from ${JSON.stringify(path.join(projectRoot, 'src/options/options-elements.js'))};
        export { OptionsRenderer } from ${JSON.stringify(path.join(projectRoot, 'src/options/options-renderer.js'))};
        export { OptionsActions } from ${JSON.stringify(path.join(projectRoot, 'src/options/options-actions.js'))};
        export { OptionsApp } from ${JSON.stringify(path.join(projectRoot, 'src/options/options-app.js'))};
        export { createStatusMessenger } from ${JSON.stringify(path.join(projectRoot, 'src/options/options-page-shell.js'))};
        export { BaseComponent } from ${JSON.stringify(path.join(projectRoot, 'src/options/components/BaseComponent.js'))};
        export { addButtonRipple } from ${JSON.stringify(path.join(projectRoot, 'src/options/components/InteractionFeedback.js'))};
        export { createOptionsEventHandlers } from ${JSON.stringify(path.join(projectRoot, 'src/options/options-events.js'))};
        export { enhanceThemedSelects } from ${JSON.stringify(path.join(projectRoot, 'src/options/components/ThemedSelect.js'))};
        export { ELEMENT_IDS } from ${JSON.stringify(path.join(projectRoot, 'src/options/ui-constants.js'))};
    `);
    await writeFile(mockBrowserPath, 'export default globalThis.__foxlateBrowserMock;');

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'foxlate-options-test-mocks',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({
                    path: mockBrowserPath,
                }));
            },
        }],
    });

    installBrowserMock();
    const modules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

let uiConstantsPromise;
/** 复用同一份 options bundle，避免每个测试都重跑一次 esbuild。 */
async function loadUiConstants() {
    uiConstantsPromise ??= bundleOptionsModules().then(({ ELEMENT_IDS }) => ({ ELEMENT_IDS }));
    return uiConstantsPromise;
}

function installBrowserMock() {
    globalThis.__foxlateBrowserMock = {
        i18n: createI18nMock(),
        runtime: {
            sendMessage: async () => ({}),
        },
        storage: {
            onChanged: {
                addListener: () => {},
            },
            local: {
                get: async () => ({}),
                set: async () => {},
            },
            sync: {
                get: async () => ({}),
                set: async () => {},
            },
        },
    };
}

function setupDom(html) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
        pretendToBeVisual: true,
    });
    const { window } = dom;

    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.Element = window.Element;
    globalThis.SVGElement = window.SVGElement;
    globalThis.Event = window.Event;
    globalThis.MutationObserver = window.MutationObserver;
    globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
    installBrowserMock();

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 480 });
    Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: () => null,
    });
    return dom;
}

test('options state reducer updates nested settings without mutating original state', async () => {
    const { rootReducer, diffState } = await bundleOptionsModules();
    const initialState = {
        cacheSize: 5000,
        scrollIdleDelayMs: 300,
        translationSelector: {
            default: {
                content: 'main',
                exclude: 'code',
            },
        },
        inputTranslationSettings: {
            enabled: false,
            triggerWord: 'fox',
        },
    };

    const selectorState = rootReducer(initialState, {
        type: 'SET_DEFAULT_SELECTOR',
        payload: { key: 'content', value: 'article' },
    });
    assert.equal(selectorState.translationSelector.default.content, 'article');
    assert.equal(initialState.translationSelector.default.content, 'main');
    assert.deepEqual([...diffState(initialState, selectorState)], ['translationSelector']);

    const cacheState = rootReducer(selectorState, { type: 'SET_CACHE_SIZE', payload: '-1' });
    assert.equal(cacheState.cacheSize, 5000);

    const inputState = rootReducer(selectorState, {
        type: 'SET_INPUT_TRANSLATION_SETTING',
        payload: { key: 'enabled', value: true },
    });
    assert.equal(inputState.inputTranslationSettings.enabled, true);
    assert.equal(selectorState.inputTranslationSettings.enabled, false);
});

test('themed select keeps native select as value source and renders options in a body portal', async () => {
    const dom = setupDom(`
        <label class="input-group">
            <select id="engine" class="form-control">
                <option value="google">Google</option>
                <option value="deeplx">DeepLx</option>
                <option value="ai:test">AI Test</option>
            </select>
        </label>
    `);
    const { enhanceThemedSelects } = await bundleOptionsModules();
    const select = dom.window.document.querySelector('#engine');
    select.value = 'deeplx';
    const changes = [];
    select.addEventListener('change', () => changes.push(select.value));

    enhanceThemedSelects(dom.window.document);

    const wrapper = select.closest('.themed-select');
    const trigger = wrapper.querySelector('.themed-select-trigger');
    trigger.getBoundingClientRect = () => ({
        left: 24,
        top: 36,
        right: 224,
        bottom: 80,
        width: 200,
        height: 44,
    });

    assert.equal(wrapper.contains(select), true);
    assert.equal(trigger.querySelector('.themed-select-value').textContent, 'DeepLx');

    trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 30, clientY: 40 }));
    const portal = dom.window.document.body.querySelector('.themed-select-portal');
    assert.equal(portal.classList.contains('is-open'), true);
    assert.equal(portal.parentElement, dom.window.document.body);
    assert.equal(portal.querySelectorAll('.themed-select-option').length, 3);

    portal.querySelector('[data-value="ai:test"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(select.value, 'ai:test');
    assert.deepEqual(changes, ['ai:test']);
    assert.equal(trigger.querySelector('.themed-select-value').textContent, 'AI Test');
    assert.equal(portal.classList.contains('is-open'), false);
});

test('options element registry centralizes page id lookups', async () => {
    const dom = setupDom(`
        <nav id="settings-nav"></nav>
        <select id="translatorEngine"></select>
        <button id="saveSettingsBtn"></button>
        <div id="aiEngineModal"></div>
        <input id="inputTriggerWord">
    `);
    const { queryOptionsElements } = await bundleOptionsModules();

    const elements = queryOptionsElements(dom.window.document);

    assert.equal(elements.settingsNav.id, 'settings-nav');
    assert.equal(elements.translatorEngine.id, 'translatorEngine');
    assert.equal(elements.saveSettingsBtn.id, 'saveSettingsBtn');
    assert.equal(elements.aiEngineModal.id, 'aiEngineModal');
    assert.equal(elements.inputTriggerWord.id, 'inputTriggerWord');
});

test('options renderer owns rule list rendering and engine field visibility', async () => {
    setupDom(`
        <select id="translatorEngine">
            <option value="google">Google</option>
            <option value="deeplx">DeepLx</option>
            <option value="ai:test">AI Test</option>
        </select>
        <div id="deeplxUrlGroup"></div>
        <div id="aiEngineManagementGroup"></div>
        <ul id="domainRulesList"></ul>
        <div id="syncManagementControls"></div>
        <div id="defaultEngineWarning"></div>
    `);
    const { OptionsRenderer } = await bundleOptionsModules();
    const elements = {
        translatorEngine: document.querySelector('#translatorEngine'),
        deeplxUrlGroup: document.querySelector('#deeplxUrlGroup'),
        aiEngineManagementGroup: document.querySelector('#aiEngineManagementGroup'),
        domainRulesList: document.querySelector('#domainRulesList'),
        syncManagementControls: document.querySelector('#syncManagementControls'),
    };
    const renderer = new OptionsRenderer(elements);

    elements.translatorEngine.value = 'deeplx';
    renderer.updateApiFieldsVisibility({ aiEngines: [] });
    assert.equal(elements.deeplxUrlGroup.style.display, 'block');
    assert.equal(elements.aiEngineManagementGroup.style.display, 'none');

    elements.translatorEngine.value = 'ai:test';
    renderer.updateApiFieldsVisibility({ aiEngines: [{ id: 'test' }] });
    assert.equal(elements.deeplxUrlGroup.style.display, 'none');
    assert.equal(elements.aiEngineManagementGroup.style.display, 'block');

    renderer.renderDomainRules({
        domainRules: {
            'example.com': { addedAt: 2 },
            'alpha.example': { addedAt: 1 },
        },
    });
    assert.deepEqual(
        [...elements.domainRulesList.querySelectorAll('.domain-rule-item')].map(item => item.dataset.domain),
        ['alpha.example', 'example.com'],
    );
});

test('options event handlers map DOM events to app actions and dispatches', async () => {
    const dom = setupDom(`
        <button id="saveSettingsBtn"></button>
        <button id="import-btn"></button>
        <button id="toggleLogBtn"></button>
        <input id="import-input" type="file">
        <textarea id="defaultContentSelector"></textarea>
        <select id="translatorEngine"><option value="deeplx">DeepLx</option></select>
    `);
    const { createOptionsEventHandlers } = await bundleOptionsModules();
    const calls = [];
    const dispatched = [];
    const elements = {
        importInput: dom.window.document.querySelector('#import-input'),
    };
    elements.importInput.click = () => calls.push('import-click');

    const handlers = createOptionsEventHandlers({
        elements,
        dispatch: (action) => dispatched.push(action),
        actions: {
            saveSettings: () => calls.push('save'),
            importSettings: () => calls.push('import-settings'),
            toggleLogArea: () => calls.push('toggle-log'),
        },
    });
    dom.window.document.addEventListener('click', handlers.handleClick);
    dom.window.document.addEventListener('input', handlers.handleInput);
    dom.window.document.addEventListener('change', handlers.handleChange);

    dom.window.document.querySelector('#saveSettingsBtn')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    dom.window.document.querySelector('#import-btn')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    dom.window.document.querySelector('#toggleLogBtn')
        .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    const contentSelector = dom.window.document.querySelector('#defaultContentSelector');
    contentSelector.value = 'article';
    contentSelector.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true }));

    const translatorEngine = dom.window.document.querySelector('#translatorEngine');
    translatorEngine.value = 'deeplx';
    translatorEngine.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    elements.importInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assert.deepEqual(calls, ['save', 'import-click', 'toggle-log', 'import-settings']);
    assert.deepEqual(dispatched, [
        { type: 'SET_DEFAULT_SELECTOR', payload: { key: 'content', value: 'article' } },
        { type: 'SET_TRANSLATOR_ENGINE', payload: 'deeplx' },
    ]);
});

test('options action layer owns selector validation side effects', async () => {
    setupDom(`
        <label class="input-group">
            <textarea id="defaultContentSelector"></textarea>
        </label>
    `);
    const { OptionsActions } = await bundleOptionsModules();
    const input = document.querySelector('#defaultContentSelector');
    const actions = new OptionsActions({
        elements: {},
        confirmModal: {},
        domainRuleModal: {},
        getState: () => ({}),
        getCurrentSettingsState: () => ({}),
        setInitialSettingsSnapshot: () => {},
        dispatch: () => {},
        updateSaveButtonState: () => {},
        showStatusMessage: () => {},
    });

    input.value = 'main, article';
    assert.equal(actions.validateCssSelectorInput(input), true);
    assert.equal(input.closest('.input-group').classList.contains('is-invalid'), false);

    input.value = 'main, [broken';
    assert.equal(actions.validateCssSelectorInput(input), false);
    assert.equal(input.closest('.input-group').classList.contains('is-invalid'), true);
    // 断言渲染出的是可读文案，而不是 key 名（缺失 key 会渲染成空串）。
    assert.equal(input.closest('.input-group').querySelector('.text-error').textContent, 'Invalid CSS selector');
});

test('options entry stays a bootstrap module after architecture split', async () => {
    const source = await readFile(path.join(projectRoot, 'src/options/options.js'), 'utf8');
    assert.match(source, /bootstrapOptionsPage/);
    assert.ok(source.split('\n').length <= 8);
    assert.doesNotMatch(source, /SettingsManager|rootReducer|querySelector|getElementById/);
});

test('options UI primitives centralize modal surfaces and button ripple feedback', async () => {
    const dom = setupDom(`
        <div id="modal" class="modal-backdrop"></div>
        <button id="action" class="btn">Action</button>
    `);
    const { BaseComponent, addButtonRipple } = await bundleOptionsModules();

    class TestComponent extends BaseComponent {
        open(modal) {
            this._openModalSurface(modal);
        }
        close(modal) {
            this._closeModalSurface(modal);
        }
        _handleEscKey() {}
    }

    const component = new TestComponent();
    const modal = dom.window.document.querySelector('#modal');
    component.open(modal);
    assert.equal(modal.style.display, 'flex');
    assert.equal(modal.classList.contains('is-visible'), true);
    assert.equal(dom.window.document.body.classList.contains('modal-open'), true);

    component.close(modal);
    modal.dispatchEvent(new dom.window.Event('transitionend'));
    assert.equal(modal.style.display, 'none');
    assert.equal(dom.window.document.body.classList.contains('modal-open'), false);

    const button = dom.window.document.querySelector('#action');
    button.getBoundingClientRect = () => ({ left: 10, top: 20, width: 80, height: 40 });
    addButtonRipple(button, new dom.window.MouseEvent('click', { clientX: 30, clientY: 45 }));
    assert.equal(button.querySelectorAll('.ripple').length, 1);
});

test('options record lists render shared ui-record primitives from real data', async () => {
    setupDom(`
        <ul id="providerHealthList" class="item-list ui-record-list"></ul>
        <ul id="translationHistoryList" class="item-list ui-record-list"></ul>
        <div id="testQualityPreview" class="ui-metric-grid mt-2" style="display:none;"></div>
    `);
    const { OptionsActions } = await bundleOptionsModules();
    const actions = new OptionsActions({
        elements: {
            providerHealthList: document.querySelector('#providerHealthList'),
            translationHistoryList: document.querySelector('#translationHistoryList'),
            testQualityPreview: document.querySelector('#testQualityPreview'),
        },
        confirmModal: {},
        domainRuleModal: {},
        getState: () => ({}),
        getCurrentSettingsState: () => ({}),
        setInitialSettingsSnapshot: () => {},
        dispatch: () => {},
        updateSaveButtonState: () => {},
        showStatusMessage: () => {},
    });

    // —— 供应商健康列表：排序、状态胶囊文案、计数 ——
    actions.renderProviderHealth({
        google: { engine: 'google', status: 'healthy', successCount: 12, failureCount: 0, lastLatencyMs: 180, lastCheckedAt: 2000 },
        openai: { engine: 'openai', status: 'degraded', successCount: 3, failureCount: 4, lastLatencyMs: 900, lastCheckedAt: 3000, lastError: 'timeout' },
    });

    const healthItems = document.querySelectorAll('#providerHealthList > li.ui-record-item');
    assert.equal(healthItems.length, 2, '每条健康记录渲染成一个 ui-record-item');
    // 按 lastCheckedAt 倒序：openai(3000) 在前
    assert.match(healthItems[0].textContent, /openai/);
    assert.match(healthItems[1].textContent, /google/);

    const pill = healthItems[0].querySelector('.ui-status-pill');
    assert.ok(pill, '状态胶囊必须用 ui-status-pill 这个共享原语');
    assert.equal(pill.dataset.status, 'degraded');
    // 缺 key 时会渲染成空串；这里断言的是真实英文文案
    assert.equal(pill.textContent, 'degraded');
    assert.equal(healthItems[1].querySelector('.ui-status-pill').textContent, 'healthy');
    // 统计行用的是本地化标签而不是裸英文
    assert.match(healthItems[1].textContent, /success 12 · failure 0 · 180ms/);

    // —— 空态：一条记录都没有时不得凭空造 ui-record-item ——
    actions.renderProviderHealth({});
    assert.equal(document.querySelectorAll('#providerHealthList > li.ui-record-item').length, 0);
    const emptyItem = document.querySelector('#providerHealthList > li.no-rules-message');
    assert.equal(emptyItem.textContent, 'No provider health data yet.');

    // —— 历史列表：不转义就是 XSS ——
    actions.renderTranslationHistory([
        { translatedText: '<img src=x onerror="window.pwned=1">', sourceText: 'hello', engine: 'google', targetLang: 'ZH', createdAt: 1000 },
    ]);
    const historyItem = document.querySelector('#translationHistoryList > li.ui-record-item');
    assert.equal(historyItem.querySelectorAll('img').length, 0, '历史内容必须转义，不能注入元素');
    assert.match(historyItem.textContent, /<img src=x onerror/);

    // —— 上限：只渲最新 12 条，否则诊断面板会被历史淹没 ——
    actions.renderTranslationHistory(Array.from({ length: 20 }, (_, index) => ({
        translatedText: `result-${index}`, sourceText: `source-${index}`, engine: 'google', createdAt: index,
    })));
    assert.equal(document.querySelectorAll('#translationHistoryList > li.ui-record-item').length, 12);

    // —— 质量预览：3 个共享 metric 卡片，并真正显示出来 ——
    actions.renderQualityPreview('hello world', '你好世界');
    const preview = document.querySelector('#testQualityPreview');
    assert.equal(preview.querySelectorAll(':scope > .ui-metric-item').length, 3);
    assert.equal(preview.style.display, 'grid');
    const metrics = [...preview.querySelectorAll('.ui-metric-item')];
    assert.deepEqual(metrics.map(item => item.querySelector('strong').textContent), ['11', '4', '0.36x']);
    assert.deepEqual(metrics.map(item => item.querySelector('.ui-record-sub').textContent), ['Source', 'Result', 'Expansion']);
});

test('options stylesheet carries no legacy product-only classes', async () => {
    const html = await readFile(path.join(projectRoot, 'src/options/options.html'), 'utf8');
    const optionsCss = await readFile(path.join(projectRoot, 'src/options/options.css'), 'utf8');
    const commonCss = await readFile(path.join(projectRoot, 'src/common/common.css'), 'utf8');

    // 迁移已完成：共享原语必须定义在 common.css，并且不得反弹回 options 私有类。
    assert.match(commonCss, /\.ui-record-item/);
    assert.match(commonCss, /\.ui-status-pill/);
    assert.match(commonCss, /\.ui-metric-grid/);
    assert.doesNotMatch(optionsCss, /product-record-|product-settings-grid|product-diagnostics-grid|health-pill|quality-preview/);
    assert.doesNotMatch(html, /class="[^"]*product-(settings-grid|diagnostics-grid|record|note)/);

    // 容器必须挂着共享列表类，否则上面的 .ui-record-item 样式不会生效。
    assert.match(html, /id="providerHealthList" class="item-list ui-record-list"/);
    assert.match(html, /id="translationHistoryList" class="item-list ui-record-list"/);
});

// --- ELEMENT_IDS 是唯一的 id 真相源 -----------------------------------------
//
// options 层靠 `ui-constants.js` 的 ELEMENT_IDS 注册表接线。只要有人图省事写裸
// 字符串（`getElementById('foo')`），注册表就悄悄退化成一个建议，改 id 时
// 漏改一处就是「设置页静默失效」。下面三条断言把这个不变量变成门禁。

test('options 源码中不存在绕过 ELEMENT_IDS 的裸 id 字面量', async () => {
    const optionsDir = path.join(projectRoot, 'src/options');
    const files = (await readdir(optionsDir, { recursive: true }))
        .filter((name) => name.endsWith('.js'))
        .filter((name) => !name.endsWith('ui-constants.js'))
        .sort();

    const offenders = [];
    for (const relativeName of files) {
        const source = await readFile(path.join(optionsDir, relativeName), 'utf8');
        for (const match of source.matchAll(/getElementById\(\s*'([^']+)'\s*\)|querySelector\(\s*'#([\w-]+)'\s*\)/g)) {
            const id = match[1] ?? match[2];
            const line = source.slice(0, match.index).split('\n').length;
            offenders.push(`${relativeName}:${line} 使用了裸 id '${id}'`);
        }
    }

    assert.deepEqual(
        offenders,
        [],
        `以下位置绕过了 ELEMENT_IDS（请把 id 加进 ui-constants.js 并改用它）：\n${offenders.join('\n')}`,
    );
});

test('每个 ELEMENT_IDS 常量都能在 options.html 里找到对应元素', async () => {
    const { ELEMENT_IDS } = await loadUiConstants();
    const html = await readFile(path.join(projectRoot, 'src/options/options.html'), 'utf8');

    const missing = [];
    for (const [name, value] of Object.entries(ELEMENT_IDS)) {
        if (value.startsWith('#')) {
            // 选择器型常量：只要求选择器能命中，不要求 id 形式
            if (!value.includes(' ')) {
                assert.fail(`选择器型常量 ${name} 应带上下文（如 '#modal .close-button'），当前为 ${value}`);
            }
            continue;
        }
        if (!html.includes(`id="${value}"`)) missing.push(`${name} → id="${value}"`);
    }

    assert.deepEqual(
        missing,
        [],
        `以下 ELEMENT_IDS 常量在 options.html 中找不到对应元素（改名后忘了同步，运行时会是 null）：\n${missing.join('\n')}`,
    );
});

test('options.html 里的每个 id 要么被 ELEMENT_IDS 登记，要么是导航锚点', async () => {
    const { ELEMENT_IDS } = await loadUiConstants();
    const html = await readFile(path.join(projectRoot, 'src/options/options.html'), 'utf8');

    const declared = new Set(
        Object.values(ELEMENT_IDS).filter((value) => !value.startsWith('#')),
    );
    // 面板 id 是导航路由的靶子（`href="#panel"`），JS 从不按 id 查它们，
    // 所以不该被迫塞进「元素注册表」里凑数。
    const anchors = new Set(
        [...html.matchAll(/href="#([\w-]+)"/g)].map((match) => match[1]),
    );
    const inHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

    const unaccounted = [...inHtml]
        .filter((id) => !declared.has(id) && !anchors.has(id))
        .sort();
    assert.deepEqual(
        unaccounted,
        [],
        `options.html 中以下 id 既未登记在 ELEMENT_IDS，也不是导航锚点（死 id 或漏登记）：${unaccounted.join(', ')}`,
    );
});
