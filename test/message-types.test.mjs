import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function loadMessageTypes() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-message-types-test-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');

    await writeFile(entryPath, `
        export { MESSAGE_TYPES } from ${JSON.stringify(path.join(projectRoot, 'src/common/message-types.js'))};
    `);
    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
    });
    const modules = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

test('message type registry has stable unique values', async () => {
    const { MESSAGE_TYPES } = await loadMessageTypes();
    const values = Object.values(MESSAGE_TYPES);
    assert.equal(new Set(values).size, values.length);
    assert.equal(MESSAGE_TYPES.TRANSLATE_INPUT_TEXT, 'translateInputText');
    assert.equal(MESSAGE_TYPES.SAVE_RULE_CHANGE, 'SAVE_RULE_CHANGE');
});

test('service worker owns the internal save-rule-change protocol handler', async () => {
    const source = await readFile(path.join(projectRoot, 'src/background/service-worker.js'), 'utf8');
    assert.match(source, /MESSAGE_TYPES\.SAVE_RULE_CHANGE/);
    assert.match(source, /saveDomainRuleProperty/);
    assert.doesNotMatch(source, /messageHandlers\.SAVE_RULE_CHANGE/);
});
