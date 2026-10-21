import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(projectRoot, 'src');

/**
 * 各个入口允许的最大体积（未压缩，KB）。
 * 预算留了约 25% 余量：日常加代码不会触发，误把重量级依赖拖进来才会失败。
 * 这些数字来自 1.7.4 重构后的实测值（见 specs/verifications/full-refactor-review-1.7.4.md）。
 */
const SIZE_BUDGET_KB = {
    'popup/popup.js': 120,
    'options/options.js': 250,
    'background/service-worker.js': 210,
    'content/content-script.js': 620,
};

/**
 * 只应该在特定入口出现、绝不该扩散的重量级依赖。
 * 每一条都对应一次真实回归：这些包曾经被 popup / options / service worker 全量打包。
 */
const SCOPED_DEPENDENCIES = [
    {
        module: 'node_modules/@chenglou/pretext/',
        allowedOnlyIn: ['content/content-script.js'],
        why: 'pretext 排版引擎（约 117 KB 源码）只有页面内翻译/摘要需要，popup 与 options 用 Canvas 引擎即可。',
    },
];

let buildReport;

async function buildEntryPoints() {
    if (buildReport) return buildReport.outputs;

    const outDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-bundle-'));
    const result = await build({
        entryPoints: Object.keys(SIZE_BUDGET_KB).map((entry) => path.join(srcDir, entry)),
        bundle: true,
        outdir: outDir,
        outbase: srcDir,
        platform: 'browser',
        format: 'iife',
        charset: 'utf8',
        logLevel: 'silent',
        minify: false,
        treeShaking: true,
        metafile: true,
        define: { '__DEBUG__': 'false' },
    });

    buildReport = { outputs: normalizeOutputKeys(result.metafile.outputs, outDir), outDir };
    await rm(outDir, { recursive: true, force: true });
    return buildReport.outputs;
}

function normalizeOutputKeys(outputs, outDir) {
    const normalized = new Map();
    for (const [file, info] of Object.entries(outputs)) {
        normalized.set(path.relative(outDir, file).split(path.sep).join('/'), info);
    }
    return normalized;
}

test('每个入口都被构建出来', async () => {
    const outputs = await buildEntryPoints();
    for (const entry of Object.keys(SIZE_BUDGET_KB)) {
        assert.ok(outputs.has(entry), `缺少构建产物 ${entry}；实际产物: ${[...outputs.keys()].join(', ')}`);
    }
});

test('入口体积不超过预算', async () => {
    const outputs = await buildEntryPoints();
    const overBudget = [];

    for (const [entry, budgetKb] of Object.entries(SIZE_BUDGET_KB)) {
        const info = outputs.get(entry);
        const totalKb = Object.values(info.inputs)
            .reduce((sum, input) => sum + input.bytesInOutput, 0) / 1024;

        if (totalKb > budgetKb) {
            overBudget.push(`${entry}: ${totalKb.toFixed(1)} KB > ${budgetKb} KB`);
        }
    }

    assert.deepEqual(overBudget, [], `入口体积超出预算:\n  ${overBudget.join('\n  ')}`);
});

test('重量级依赖不扩散到不需要它的入口', async () => {
    const outputs = await buildEntryPoints();
    const violations = [];

    for (const entry of Object.keys(SIZE_BUDGET_KB)) {
        const info = outputs.get(entry);
        for (const dependency of SCOPED_DEPENDENCIES) {
            if (dependency.allowedOnlyIn.includes(entry)) continue;

            const hit = Object.keys(info.inputs).find((file) => file.includes(dependency.module));
            if (!hit) continue;

            const bytes = info.inputs[hit].bytesInOutput;
            violations.push(`${entry} 打包了 ${dependency.module}（${(bytes / 1024).toFixed(1)} KB）—— ${dependency.why}`);
        }
    }

    assert.deepEqual(violations, [], `依赖越界:\n  ${violations.join('\n  ')}`);
});
