import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function loadBadgeState() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-badge-state-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');

    await writeFile(entryPath, `
        export { setBadgeAndState, BADGE_COLORS } from ${JSON.stringify(path.join(projectRoot, 'src/background/badge-state.js'))};
    `);

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
    });

    const mod = await import(pathToFileURL(outputPath));
    await rm(tempDir, { recursive: true, force: true });
    return mod;
}

function createApis() {
    const badges = [];
    const colors = [];
    const statuses = [];
    return {
        browserApi: {
            action: {
                async setBadgeText({ tabId, text }) {
                    badges.push({ tabId, text });
                },
                async setBadgeBackgroundColor({ tabId, color }) {
                    colors.push({ tabId, color });
                },
            },
        },
        tabStateManager: {
            async setTabStatus(tabId, state) {
                statuses.push({ tabId, state });
            },
        },
        badges,
        colors,
        statuses,
    };
}

test('setBadgeAndState marks emptyCandidates translated jobs with amber zero badge', async () => {
    const { setBadgeAndState, BADGE_COLORS } = await loadBadgeState();
    const apis = createApis();
    await setBadgeAndState(apis, 3, 'translated', { emptyCandidates: true });
    assert.deepEqual(apis.statuses, [{ tabId: 3, state: 'translated' }]);
    assert.deepEqual(apis.badges, [{ tabId: 3, text: '0' }]);
    // 断言取值来源而不是字面量：徽标色与 tokens.css 的对应关系由 design-system 门禁守，
    // 这里只证明「哪种状态用哪个颜色」。
    assert.equal(apis.colors[0].color, BADGE_COLORS.empty);
});

test('全部段落失败时徽标打「!」而不是勾——勾会骗用户说已经翻好了', async () => {
    const { setBadgeAndState, BADGE_COLORS } = await loadBadgeState();
    const apis = createApis();

    await setBadgeAndState(apis, 5, 'translated', { failedCount: 12, completedCount: 0 });

    assert.deepEqual(apis.badges, [{ tabId: 5, text: '!' }]);
    assert.equal(apis.colors[0].color, BADGE_COLORS.failed);
});

test('部分失败但确有翻译成功时仍是勾（失败段有独立的错误标记）', async () => {
    const { setBadgeAndState, BADGE_COLORS } = await loadBadgeState();
    const apis = createApis();

    await setBadgeAndState(apis, 6, 'translated', { failedCount: 3, completedCount: 9 });

    assert.deepEqual(apis.badges, [{ tabId: 6, text: '✓' }]);
    assert.equal(apis.colors[0].color, BADGE_COLORS.success);
});

test('setBadgeAndState uses success mark when candidates existed', async () => {
    const { setBadgeAndState, BADGE_COLORS } = await loadBadgeState();
    const apis = createApis();
    await setBadgeAndState(apis, 4, 'translated');
    assert.deepEqual(apis.badges, [{ tabId: 4, text: '✓' }]);
    assert.equal(apis.colors[0].color, BADGE_COLORS.success);
});
