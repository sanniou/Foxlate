import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function loadExtractor() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-summary-extract-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const stubPath = path.join(tempDir, 'readability-stub.js');

    await writeFile(stubPath, `
        export default class Readability {
            constructor(doc) { this.doc = doc; }
            parse() {
                const text = this.doc?.body?.innerText || this.doc?.body?.textContent || '';
                return text.trim() ? { textContent: text } : null;
            }
        }
    `);
    await writeFile(entryPath, `
        export { SummaryContentExtractor } from ${JSON.stringify(path.join(projectRoot, 'src/content/summary/summary-content-extractor.js'))};
    `);

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'stub-readability',
            setup(buildContext) {
                buildContext.onResolve({ filter: /readability\.esm\.js$/ }, () => ({
                    path: stubPath,
                }));
            },
        }],
    });

    const mod = await import(pathToFileURL(outputPath).href);
    await rm(tempDir, { recursive: true, force: true });
    return mod;
}

test('summary extractor picks the largest mainBody match, not the first', async () => {
    const { SummaryContentExtractor } = await loadExtractor();
    const dom = new JSDOM(`<!doctype html><html><body>
        <article class="teaser">Short teaser</article>
        <article class="full">This is the full article body with enough prose to win the score.</article>
        <nav>Nav chrome should not matter</nav>
    </body></html>`);

    const extractor = new SummaryContentExtractor({
        settings: {
            summarySettings: {
                mainBodySelector: 'article',
            },
        },
        documentRef: dom.window.document,
    });

    const content = await extractor.extractPageContent();
    assert.match(content, /full article body/);
    assert.doesNotMatch(content, /Short teaser/);
});

test('summary extractor falls back to default main body when settings empty', async () => {
    const { SummaryContentExtractor } = await loadExtractor();
    const dom = new JSDOM(`<!doctype html><html><body>
        <main id="m">Main article prose for summary scope.</main>
        <footer>footer noise</footer>
    </body></html>`);

    const extractor = new SummaryContentExtractor({
        settings: { summarySettings: {} },
        documentRef: dom.window.document,
    });

    const content = await extractor.extractPageContent();
    assert.match(content, /Main article prose/);
});
