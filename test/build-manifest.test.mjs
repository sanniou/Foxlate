// story: e01s01
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test, { after } from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const baseManifestPath = path.join(projectRoot, 'public', 'manifest.base.json');

// 构建产物写到临时目录，不碰仓库里的 `dist/`。
// 这组用例会对两个 target 各真跑一次构建；写共享 `dist/` 会让「跑测试」等于
// 「改构建产物」——并行跑测试时互相覆盖，也会把脏产物留在工作区里。
const buildRootPromise = mkdtemp(path.join(os.tmpdir(), 'foxlate-build-manifest-'));
let buildDir = null;

after(async () => {
    await rm(await buildRootPromise, { recursive: true, force: true });
});

async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readDist(relativePath) {
    return readFile(path.join(buildDir, relativePath), 'utf8');
}

async function readDistManifest() {
    return readJson(path.join(buildDir, 'manifest.json'));
}

async function runBuild(target) {
    const root = await buildRootPromise;
    buildDir = path.join(root, target);
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['build.js', `--target=${target}`, `--outdir=${buildDir}`], {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`build --target=${target} exited ${code}\n${stderr}`));
        });
    });
}

test('manifest.base.json version is a build-time placeholder', async () => {
    const base = await readJson(baseManifestPath);
    assert.equal(
        base.version,
        '0.0.0',
        'base version must be 0.0.0; package.json is the sole source of truth',
    );
});

test('chrome build injects package version and service_worker background', async () => {
    const { version } = await readJson(packageJsonPath);
    await runBuild('chrome');
    const manifest = await readDistManifest();

    assert.equal(manifest.version, version);
    assert.equal(manifest.background?.service_worker, 'background/service-worker.js');
    assert.equal(manifest.background?.scripts, undefined);
});

test('firefox build injects package version and scripts background', async () => {
    const { version } = await readJson(packageJsonPath);
    await runBuild('firefox');
    const manifest = await readDistManifest();

    assert.equal(manifest.version, version);
    assert.deepEqual(manifest.background?.scripts, ['background/service-worker.js']);
    assert.equal(manifest.background?.service_worker, undefined);
});

// ---------------------------------------------------------------------------
// 生产构建的输出内容门禁
//
// 这些断言守住两类曾经静默失效的东西：
// 1. 调试标志：源码写的是 `globalThis.__DEBUG__`，而 esbuild 的 define 只替换裸标识符
//    与它认识的成员表达式。只定义裸名时成员表达式会原样进产物、运行时恒为 falsy，
//    所有调试日志变成死代码——而且不会有任何报错。
// 2. 错误上报通道：曾经用 `drop: ['console']`，把 console.error/warn 一起删掉，
//    而全仓库的错误上报只有这一条路径，线上故障将完全不可见。
// ---------------------------------------------------------------------------

test('production bundle resolves the debug flag at build time', async () => {
    await runBuild('firefox');

    for (const relativePath of ['background/service-worker.js', 'content/content-script.js']) {
        const code = await readDist(relativePath);
        assert.equal(
            code.includes('globalThis.__DEBUG__'),
            false,
            `${relativePath} 仍含未替换的 globalThis.__DEBUG__——build.js 的 define 没有覆盖成员表达式`,
        );
        assert.equal(
            /\b__DEBUG__\b/.test(code),
            false,
            `${relativePath} 仍残留 __DEBUG__ 标识符`,
        );
    }
});

test('production build keeps error reporting but drops noisy debug logging', async () => {
    await runBuild('firefox');

    for (const relativePath of ['background/service-worker.js', 'content/content-script.js', 'options/options.js']) {
        const code = await readDist(relativePath);
        assert.ok(
            code.includes('console.error'),
            `${relativePath} 丢掉了 console.error——线上错误将无法诊断`,
        );
        assert.equal(
            code.includes('console.log'),
            false,
            `${relativePath} 仍含 console.log（生产构建应通过 pure 删除）`,
        );
        assert.equal(
            code.includes('debugger'),
            false,
            `${relativePath} 仍含 debugger 语句`,
        );
    }
});

test('production build eliminates debug-only branches entirely', async () => {
    await runBuild('firefox');

    // 这些字符串只出现在 `if (globalThis.__DEBUG__)` 分支里；
    // 能消除字符串说明条件确实被编译期求值为 false，而不只是日志被删。
    const debugOnlyStrings = [
        'Settings changed. Notifying content scripts',
        'Critical setting',
    ];

    const code = await readDist('background/service-worker.js');
    for (const marker of debugOnlyStrings) {
        assert.equal(
            code.includes(marker),
            false,
            `调试分支未在编译期消除，仍存在: ${marker}`,
        );
    }
});

test('两条 target 的 manifest 都带上商店与平台必需项', async () => {
    // 这些是「不修就上传不了 / 装到旧版浏览器就坏」的元数据，不是风格问题：
    // - data_collection_permissions：AMO 自 2025-11-03 起对新提交强制，缺失即拒；
    // - strict_min_version：storage.session 需要 Firefox 115+；
    // - clipboardWrite：Firefox 内容脚本写剪贴板的前提；
    // - 每个 command 都要有默认键位，否则「有快捷键」只是文档里的说法。
    for (const target of ['firefox', 'chrome']) {
        await runBuild(target);
        const manifest = await readDistManifest();

        assert.ok(
            manifest.permissions.includes('clipboardWrite'),
            `${target}: 缺 clipboardWrite —— Firefox 下复制译文会被拒绝`,
        );

        for (const [name, command] of Object.entries(manifest.commands || {})) {
            assert.ok(
                command.suggested_key?.default,
                `${target}: command ${name} 没有默认键位，用户必须手配才能用`,
            );
        }

        if (target === 'firefox') {
            const gecko = manifest.browser_specific_settings?.gecko || {};
            const declared = gecko.data_collection_permissions?.required;
            assert.ok(
                Array.isArray(declared) && declared.includes('websiteContent'),
                'Firefox: 必须声明 data_collection_permissions.required = ["websiteContent"]（AMO 强制）',
            );
            assert.equal(gecko.strict_min_version, '115.0', 'Firefox: storage.session 要求 115+');
        } else {
            assert.equal(manifest.browser_specific_settings, undefined, 'Chrome: 不得残留 gecko 键');
            const description = manifest.description;
            assert.ok(
                typeof description === 'string' && description.length <= 132,
                `Chrome: description 必须 ≤132 字符（当前 ${description?.length}），否则 CWS 上传报错`,
            );
        }
    }
});

