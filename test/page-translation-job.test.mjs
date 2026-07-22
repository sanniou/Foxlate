import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(import.meta.dirname, '..');
let bundledModules;

async function loadPageTranslationJob() {
    if (bundledModules) {
        return bundledModules;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-page-job-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { PageTranslationJob } from ${JSON.stringify(path.join(projectRoot, 'src/content/page-translation-job.js'))};
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
            name: 'browser-polyfill-mock',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({
                    path: mockBrowserPath,
                }));
            },
        }],
    });

    bundledModules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return bundledModules;
}

function setupDom(html) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    const { window } = dom;

    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.Node = window.Node;
    globalThis.NodeFilter = window.NodeFilter;
    globalThis.HTMLElement = window.HTMLElement;

    return dom;
}

function installObserverMocks({ idleDeadline = { didTimeout: true, timeRemaining: () => 50 } } = {}) {
    const intersectionInstances = [];
    const mutationInstances = [];
    let idleCallbackCalls = 0;

    class FakeIntersectionObserver {
        constructor(callback) {
            this.callback = callback;
            this.observed = [];
            this.unobserved = [];
            this.disconnected = false;
            intersectionInstances.push(this);
        }
        observe(element) {
            this.observed.push(element);
        }
        unobserve(element) {
            this.unobserved.push(element);
        }
        disconnect() {
            this.disconnected = true;
        }
        trigger(entries) {
            this.callback(entries);
        }
    }

    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.observed = [];
            this.disconnected = false;
            mutationInstances.push(this);
        }
        observe(element, options) {
            this.observed.push({ element, options });
        }
        disconnect() {
            this.disconnected = true;
        }
        trigger(mutations) {
            this.callback(mutations);
        }
    }

    globalThis.IntersectionObserver = FakeIntersectionObserver;
    globalThis.MutationObserver = FakeMutationObserver;
    globalThis.requestIdleCallback = (callback) => {
        idleCallbackCalls++;
        callback(idleDeadline);
        return idleCallbackCalls;
    };
    globalThis.cancelIdleCallback = () => {};

    return {
        intersectionInstances,
        mutationInstances,
        get idleCallbackCalls() {
            return idleCallbackCalls;
        },
    };
}

function createBrowserMock() {
    const messages = [];
    return {
        messages,
        runtime: {
            async sendMessage(message) {
                messages.push(message);
                return {};
            },
        },
        i18n: {
            getMessage(key) {
                return key;
            },
        },
    };
}

function createSettings() {
    return {
        targetLanguage: 'ZH',
        translatorEngine: 'google',
        translationSelector: { content: 'p' },
        displayMode: 'append',
    };
}

test('PageTranslationJob starts and completes when no elements are found', async () => {
    setupDom('<main><h1>No paragraph</h1></main>');
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();

    const job = new PageTranslationJob(1, createSettings(), {
        browserApi: browserMock,
        findAllSearchRootsFn: () => [document.body],
        findTranslatableElementsFn: () => [],
        logError() {},
    });

    await job.start();

    assert.equal(job.state, 'translated');
    assert.equal(document.body.dataset.translationSession, 'active');
    assert.equal(observers.mutationInstances[0].observed[0].element, document.body);
    assert.deepEqual(browserMock.messages.map(message => message.payload?.status), ['loading', 'translated']);
    assert.equal(browserMock.messages.at(-1).payload.emptyCandidates, true);
    assert.equal(job.getProgressSnapshot().emptyCandidates, true);
});

test('PageTranslationJob observes initial elements and translates intersecting entries', async () => {
    const dom = setupDom('<p id="target">Hello</p>');
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();
    const target = dom.window.document.querySelector('#target');
    const translated = [];

    const job = new PageTranslationJob(2, createSettings(), {
        browserApi: browserMock,
        findAllSearchRootsFn: () => [document.body],
        findTranslatableElementsFn: () => [target],
        logError() {},
        translateElement(element, settings) {
            translated.push({ element, settings });
        },
    });

    await job.start();
    observers.intersectionInstances[0].trigger([{ isIntersecting: true, target }]);

    assert.equal(job.state, 'translating');
    assert.deepEqual(observers.intersectionInstances[0].observed, [target]);
    assert.deepEqual(observers.intersectionInstances[0].unobserved, [target]);
    assert.deepEqual(translated, [{ element: target, settings: createSettings() }]);
});

test('PageTranslationJob emits progress snapshots for translation counters', async () => {
    setupDom('<p id="target">Hello</p>');
    installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();
    const snapshots = [];

    const job = new PageTranslationJob(11, createSettings(), {
        browserApi: browserMock,
        findAllSearchRootsFn: () => [document.body],
        findTranslatableElementsFn: () => [],
        logError() {},
        onProgress(snapshot) {
            snapshots.push(snapshot);
        },
    });

    await job.start();
    job.state = 'translating';
    job.recordTranslationStarted();
    job.recordTranslationCompleted({ success: false });

    const latest = snapshots.at(-1);
    assert.equal(latest.started, 1);
    assert.equal(latest.completed, 0);
    assert.equal(latest.failed, 1);
    assert.equal(latest.activeTranslations, 0);
});

test('PageTranslationJob prioritizes initial scan roots nearest the viewport', async () => {
    const dom = setupDom(`
        <section id="far"><p id="far-text">Far</p></section>
        <section id="current"><p id="current-text">Current</p></section>
        <section id="above"><p id="above-text">Above</p></section>
    `);
    Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 100 });
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();
    const far = dom.window.document.querySelector('#far');
    const current = dom.window.document.querySelector('#current');
    const above = dom.window.document.querySelector('#above');
    far.getBoundingClientRect = () => ({ top: 900, bottom: 940, left: 0, right: 100 });
    current.getBoundingClientRect = () => ({ top: 20, bottom: 60, left: 0, right: 100 });
    above.getBoundingClientRect = () => ({ top: -80, bottom: -40, left: 0, right: 100 });
    const scanOrder = [];

    const job = new PageTranslationJob(9, createSettings(), {
        browserApi: browserMock,
        findAllSearchRootsFn(root) {
            scanOrder.push(root.id);
            return [root];
        },
        findTranslatableElementsFn(_settings, roots) {
            const paragraph = roots[0].querySelector('p');
            return paragraph ? [paragraph] : [];
        },
        logError() {},
    });

    await job.start();

    assert.deepEqual(scanOrder, ['current', 'above', 'far']);
    assert.deepEqual(
        observers.intersectionInstances[0].observed.map(element => element.id),
        ['current-text', 'above-text', 'far-text']
    );
});

test('PageTranslationJob slices initial scan work across idle callbacks', async () => {
    const dom = setupDom(`
        <section id="one"><p id="one-text">One</p></section>
        <section id="two"><p id="two-text">Two</p></section>
        <section id="three"><p id="three-text">Three</p></section>
    `);
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();

    const job = new PageTranslationJob(10, createSettings(), {
        browserApi: browserMock,
        findAllSearchRootsFn(root) {
            return [root];
        },
        findTranslatableElementsFn(_settings, roots) {
            const paragraph = roots[0].querySelector('p');
            return paragraph ? [paragraph] : [];
        },
        logError() {},
    });
    job.INITIAL_SCAN_CHUNK_SIZE = 1;

    await job.start();

    assert.equal(observers.idleCallbackCalls >= 3, true);
    assert.deepEqual(
        observers.intersectionInstances[0].observed.map(element => element.id).sort(),
        ['one-text', 'three-text', 'two-text']
    );
});

test('PageTranslationJob delays intersecting translations until scroll is idle', async () => {
    const dom = setupDom('<p id="target">Hello</p>');
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();
    const target = dom.window.document.querySelector('#target');
    target.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 0, right: 100 });
    const translated = [];
    const settings = { ...createSettings(), scrollIdleDelayMs: 5 };

    const job = new PageTranslationJob(5, settings, {
        browserApi: browserMock,
        findAllSearchRootsFn: () => [document.body],
        findTranslatableElementsFn: () => [target],
        logError() {},
        translateElement(element, activeSettings) {
            translated.push({ element, settings: activeSettings });
        },
    });

    await job.start();
    dom.window.dispatchEvent(new dom.window.Event('wheel'));
    observers.intersectionInstances[0].trigger([{ isIntersecting: true, target }]);
    observers.intersectionInstances[0].trigger([{ isIntersecting: true, target }]);

    assert.equal(translated.length, 0);
    await new Promise(resolve => setTimeout(resolve, 15));

    assert.equal(translated.length, 1);
    assert.deepEqual(translated, [{ element: target, settings }]);
});

test('PageTranslationJob only flushes scroll-pending elements still in the viewport', async () => {
    const dom = setupDom('<p id="old">Old</p><p id="current">Current</p>');
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();
    const oldTarget = dom.window.document.querySelector('#old');
    const currentTarget = dom.window.document.querySelector('#current');
    let oldTargetRect = { top: -200, bottom: -100, left: 0, right: 100 };
    oldTarget.getBoundingClientRect = () => oldTargetRect;
    currentTarget.getBoundingClientRect = () => ({ top: 20, bottom: 60, left: 0, right: 100 });
    const translated = [];

    const job = new PageTranslationJob(8, { ...createSettings(), scrollIdleDelayMs: 5 }, {
        browserApi: browserMock,
        findAllSearchRootsFn: () => [document.body],
        findTranslatableElementsFn: () => [oldTarget, currentTarget],
        logError() {},
        translateElement(element, settings) {
            translated.push({ element, settings });
        },
    });

    await job.start();
    dom.window.dispatchEvent(new dom.window.Event('scroll'));
    observers.intersectionInstances[0].trigger([
        { isIntersecting: true, target: oldTarget },
        { isIntersecting: true, target: currentTarget },
    ]);
    await new Promise(resolve => setTimeout(resolve, 15));

    assert.deepEqual(translated.map(item => item.element), [currentTarget]);
    assert.equal(observers.intersectionInstances[0].observed.filter(element => element === oldTarget).length, 2);

    oldTargetRect = { top: 30, bottom: 70, left: 0, right: 100 };
    observers.intersectionInstances[0].trigger([{ isIntersecting: true, target: oldTarget }]);

    assert.deepEqual(translated.map(item => item.element), [currentTarget, oldTarget]);
});

test('PageTranslationJob translates immediately when scroll-idle strategy is disabled', async () => {
    const dom = setupDom('<p id="target">Hello</p>');
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();
    const target = dom.window.document.querySelector('#target');
    const translated = [];
    const settings = { ...createSettings(), translateAfterScrollIdle: false, scrollIdleDelayMs: 5 };

    const job = new PageTranslationJob(6, settings, {
        browserApi: browserMock,
        findAllSearchRootsFn: () => [document.body],
        findTranslatableElementsFn: () => [target],
        logError() {},
        translateElement(element, activeSettings) {
            translated.push({ element, settings: activeSettings });
        },
    });

    await job.start();
    dom.window.dispatchEvent(new dom.window.Event('scroll'));
    observers.intersectionInstances[0].trigger([{ isIntersecting: true, target }]);

    assert.deepEqual(translated, [{ element: target, settings }]);
});

test('PageTranslationJob revert clears delayed scroll translations', async () => {
    const dom = setupDom('<p id="target">Hello</p>');
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();
    const target = dom.window.document.querySelector('#target');
    const translated = [];

    const job = new PageTranslationJob(7, { ...createSettings(), scrollIdleDelayMs: 5 }, {
        browserApi: browserMock,
        findAllSearchRootsFn: () => [document.body],
        findTranslatableElementsFn: () => [target],
        logError() {},
        translateElement(element, settings) {
            translated.push({ element, settings });
        },
    });

    await job.start();
    dom.window.dispatchEvent(new dom.window.Event('touchmove'));
    observers.intersectionInstances[0].trigger([{ isIntersecting: true, target }]);
    await job.revert();
    await new Promise(resolve => setTimeout(resolve, 15));

    assert.deepEqual(translated, []);
    assert.equal(observers.intersectionInstances[0].disconnected, true);
    assert.equal(observers.mutationInstances[0].disconnected, true);
});

test('PageTranslationJob processes visible dynamic nodes into new observed elements', async () => {
    const dom = setupDom('<main id="root"></main>');
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();
    const root = dom.window.document.querySelector('#root');
    const added = dom.window.document.createElement('section');
    const newTarget = dom.window.document.createElement('p');
    newTarget.textContent = 'New';
    added.appendChild(newTarget);
    root.appendChild(added);

    const job = new PageTranslationJob(3, createSettings(), {
        browserApi: browserMock,
        domWalker: { isPotentiallyVisible: () => true },
        findAllSearchRootsFn: () => [added],
        findTranslatableElementsFn: (_settings, roots) => roots.includes(added) ? [newTarget] : [],
        logError() {},
    });
    job.DEBOUNCE_DELAY = 0;

    await job.start();
    observers.mutationInstances[0].trigger([{ type: 'childList', addedNodes: [added] }]);
    await new Promise(resolve => setTimeout(resolve, 5));

    assert.equal(observers.intersectionInstances[0].observed.includes(newTarget), true);
});

test('PageTranslationJob revert stops observers, reverts registry, and unwraps leftovers', async () => {
    const dom = setupDom('<div id="translated">Text</div><foxlate-wrapper data-foxlate-generated="true"><span id="child">Loose</span></foxlate-wrapper>');
    const observers = installObserverMocks();
    const browserMock = createBrowserMock();
    globalThis.__foxlateBrowserMock = browserMock;
    const { PageTranslationJob } = await loadPageTranslationJob();
    const translated = dom.window.document.querySelector('#translated');
    const reverted = [];
    let cleanupCalled = false;
    let revertedJob = null;
    const displayManager = {
        elementRegistry: new Map([['one', new WeakRef(translated)]]),
        hideAllEphemeralUI() {
            cleanupCalled = true;
        },
        revert(element) {
            reverted.push(element);
        },
    };

    const job = new PageTranslationJob(4, createSettings(), {
        browserApi: browserMock,
        displayManager,
        findAllSearchRootsFn: () => [document.body],
        findTranslatableElementsFn: () => [translated],
        logError() {},
        onReverted(jobInstance) {
            revertedJob = jobInstance;
        },
    });

    await job.start();
    await job.revert();

    assert.equal(cleanupCalled, true);
    assert.deepEqual(reverted, [translated]);
    assert.equal(document.body.dataset.translationSession, undefined);
    assert.equal(dom.window.document.querySelector('foxlate-wrapper'), null);
    assert.equal(dom.window.document.querySelector('#child')?.textContent, 'Loose');
    assert.equal(observers.intersectionInstances[0].disconnected, true);
    assert.equal(observers.mutationInstances[0].disconnected, true);
    assert.equal(revertedJob, job);
    assert.deepEqual(browserMock.messages.map(message => message.type), [
        'TRANSLATION_STATUS_UPDATE',
        'STOP_TRANSLATION',
        'TRANSLATION_STATUS_UPDATE',
    ]);
});
