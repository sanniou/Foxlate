import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function loadSelectionTranslate() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-selection-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, `
        export { getSelectionPayload, translateSelectionPayload } from ${JSON.stringify(path.join(projectRoot, 'src/content/selection-translate.js'))};
    `);
    await writeFile(mockBrowserPath, `
        export default {
            i18n: { getMessage: (k) => k },
            runtime: { sendMessage: async () => ({}) },
        };
    `);

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

    const mod = await import(pathToFileURL(outputPath).href);
    await rm(tempDir, { recursive: true, force: true });
    return mod;
}

test('translateSelectionPayload uses TRANSLATE_BATCH and displays result once', async () => {
    const { translateSelectionPayload } = await loadSelectionTranslate();
    const displays = [];
    const sent = [];
    const browserApi = {
        runtime: {
            async sendMessage(message) {
                sent.push(message);
                return { success: true, translatedTexts: ['你好'] };
            },
        },
    };

    const result = await translateSelectionPayload({
        browserApi,
        win: { location: { hostname: 'example.com' } },
        selectionPayload: {
            text: 'Hello',
            coords: { clientX: 10, clientY: 20 },
        },
        source: 'quick-action',
        displaySelectionTranslation: (payload) => displays.push(payload),
        getEffectiveSettings: async () => ({ targetLanguage: 'zh-CN' }),
    });

    assert.equal(result.success, true);
    assert.equal(sent[0].type, 'TRANSLATE_BATCH');
    assert.deepEqual(sent[0].payload.texts, ['Hello']);
    assert.equal(displays[0].isLoading, true);
    assert.equal(displays[1].translatedText, '你好');
    assert.equal(displays[1].source, 'quick-action');
});

test('translateSelectionPayload skips network when precheck rejects', async () => {
    const { translateSelectionPayload } = await loadSelectionTranslate();
    const displays = [];
    let sent = 0;
    const browserApi = {
        runtime: {
            async sendMessage() {
                sent += 1;
                return { success: true, translatedTexts: ['nope'] };
            },
        },
    };

    const result = await translateSelectionPayload({
        browserApi,
        win: { location: { hostname: 'example.com' } },
        selectionPayload: {
            text: 'https://example.com/path',
            coords: { clientX: 1, clientY: 2 },
        },
        source: 'contextMenu',
        displaySelectionTranslation: (payload) => displays.push(payload),
        getEffectiveSettings: async () => ({ targetLanguage: 'zh-CN' }),
    });

    assert.equal(result.skipped, true);
    assert.equal(sent, 0);
    assert.equal(displays.at(-1).translatedText, 'https://example.com/path');
    assert.equal(displays.at(-1).source, 'contextMenu');
});
