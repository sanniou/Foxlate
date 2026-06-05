import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

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

function installBrowserMock() {
    globalThis.__foxlateBrowserMock = {
        i18n: {
            getMessage(key) {
                const messages = {
                    edit: 'Edit',
                    removeRule: 'Delete',
                    noDomainRulesFound: 'No rules',
                    defaultEngineNotFound: 'Missing engine',
                };
                return messages[key] || key;
            },
            getUILanguage() {
                return 'en-US';
            },
        },
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
    assert.equal(input.closest('.input-group').querySelector('.text-error').textContent, 'invalidCssSelector');
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
