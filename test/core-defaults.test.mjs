// story: e04s01
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function loadModule(entrySource) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-core-defaults-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');
    await writeFile(mockBrowserPath, 'export default { i18n: { getMessage: (k) => k } };');
    await writeFile(entryPath, entrySource);
    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'mock-polyfill',
            setup(buildContext) {
                buildContext.onResolve({ filter: /browser-polyfill\.js$/ }, () => ({ path: mockBrowserPath }));
            },
        }],
    });
    const mod = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return mod;
}

test('default page translation favors replace mode and shell-safe selectors', async () => {
    const {
        DEFAULT_SETTINGS,
        DEFAULT_TRANSLATION_CONTENT,
        DEFAULT_TRANSLATION_EXCLUDE,
        FALLBACK_TRANSLATION_CONTENT,
        DISPLAY_MODES,
    } = await loadModule(`
        export {
            DEFAULT_SETTINGS,
            DEFAULT_TRANSLATION_CONTENT,
            DEFAULT_TRANSLATION_EXCLUDE,
            FALLBACK_TRANSLATION_CONTENT,
            DISPLAY_MODES,
        } from ${JSON.stringify(path.join(projectRoot, 'src/common/constants.js'))};
    `);

    assert.equal(DEFAULT_SETTINGS.displayMode, 'replace');
    assert.ok(DISPLAY_MODES.replace);
    assert.match(DEFAULT_TRANSLATION_EXCLUDE, /nav/);
    assert.match(DEFAULT_TRANSLATION_EXCLUDE, /footer/);
    assert.match(DEFAULT_TRANSLATION_EXCLUDE, /\[role="navigation"\]/);
    assert.match(DEFAULT_TRANSLATION_CONTENT, /main/);
    assert.match(DEFAULT_TRANSLATION_CONTENT, /article/);
    assert.doesNotMatch(DEFAULT_TRANSLATION_CONTENT, /(^|,\s*)div(,|$)/);
    assert.match(FALLBACK_TRANSLATION_CONTENT, /section/);
    assert.match(FALLBACK_TRANSLATION_CONTENT, /div/);
    assert.equal(DEFAULT_SETTINGS.translationSelector.default.exclude, DEFAULT_TRANSLATION_EXCLUDE);
    assert.equal(DEFAULT_SETTINGS.translationSelector.default.content, DEFAULT_TRANSLATION_CONTENT);
});

test('clampPanelPosition keeps the quick-action panel inside the viewport', async () => {
    const { clampPanelPosition } = await loadModule(`
        export { clampPanelPosition } from ${JSON.stringify(path.join(projectRoot, 'src/content/quick-action-panel.js'))};
    `);

    const clamped = clampPanelPosition({
        clientX: 400,
        clientY: 500,
        panelWidth: 112,
        panelHeight: 40,
        viewportWidth: 320,
        viewportHeight: 480,
        gutter: 8,
    });
    assert.equal(clamped.left, 320 - 112 - 8);
    assert.equal(clamped.top, 480 - 40 - 8);

    const nearOrigin = clampPanelPosition({
        clientX: 0,
        clientY: 0,
        panelWidth: 112,
        panelHeight: 40,
        viewportWidth: 320,
        viewportHeight: 480,
        gutter: 8,
    });
    assert.equal(nearOrigin.left, 8);
    assert.equal(nearOrigin.top, 8);
});
