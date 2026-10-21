/**
 * 依赖卫生门禁。
 *
 * 背景（这是本项目体积问题的真实根因形态，两次都发生过）：
 *   1. `src/lib/lit.js`（lit@3.3.1 的 vendored 副本，15.5 KB）+ package.json 的
 *      `"lit"` 运行时依赖，两者都没有任何引用 —— 是一次已放弃的「Lit 重写」留下的残骸，
 *      而 AGENTS.md 与 tech-stack.md 反而把它写成了项目技术栈。
 *   2. `franc` 曾被静态 import，使 4 个入口中 3 个都白白背上 ~240 KB。
 *
 * 共同点：**声明了却没被用** / **被用了却不知边界**。两者都不会让任何现有测试变红。
 * 本门禁把「声明与引用必须一致」变成可执行不变量。
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 递归列出目录下所有文件（跳过 node_modules / dist）。 */
function listFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(full));
        else out.push(full);
    }
    return out;
}

/** 仓库中「可能引用他人」的源文件集合：src + 构建脚本 + 静态资源 + 工具脚本 + 测试。 */
function sourceFiles() {
    const roots = ['src', 'scripts', 'public', 'test'].map(dir => join(ROOT, dir));
    const files = [join(ROOT, 'build.js')];
    for (const root of roots) {
        try {
            files.push(...listFiles(root));
        } catch {
            // 目录不存在时忽略
        }
    }
    return files.filter(file => /\.(m?js|json|html|css)$/.test(file));
}

/**
 * 「生产侧」引用者：只有这些文件算数，因为要回答的是
 * “这个 vendored 文件会不会真的进入发布产物”。
 *
 * 刻意排除 test/ 与本门禁文件自身：只被测试引用的 vendored 副本依然是发布死重量，
 * 而本文件在注释里会提到这些文件名——曾经的实现因此把自己算成引用者，注入死文件也不变红。
 */
function productionReferenceFiles(exceptRelativePath = null) {
    const roots = ['src', 'scripts', 'public'].map(dir => join(ROOT, dir));
    const files = [join(ROOT, 'build.js')];
    for (const root of roots) {
        try {
            files.push(...listFiles(root));
        } catch {
            // 目录不存在时忽略
        }
    }
    return files
        .filter(file => /\.(m?js|json|html|css)$/.test(file))
        .filter(file => relative(ROOT, file) !== exceptRelativePath)
        .filter(file => relative(ROOT, file).split(/[/\\]/)[0] !== 'test')
        .map(file => ({
            relativePath: relative(ROOT, file),
            text: readFileSync(file, 'utf8'),
        }));
}

/** 从文件内容中抽出所有 import / require 的模块说明符。 */
function importSpecifiers(text) {
    const specifiers = new Set();
    const patterns = [
        /\bfrom\s+['"]([^'"]+)['"]/g,
        /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
        /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
    ];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) specifiers.add(match[1]);
    }
    return specifiers;
}

const SOURCE_FILES = sourceFiles();
const SOURCE_FILES_WITH_TEXT = SOURCE_FILES.map(file => ({
    path: file,
    relativePath: relative(ROOT, file),
    text: readFileSync(file, 'utf8'),
}));
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('依赖卫生：vendored 资源', () => {
    const vendoredDir = join(ROOT, 'src', 'lib');

    it('src/lib 下每个 vendored 文件都必须被生产侧引用', () => {
        const names = readdirSync(vendoredDir);
        assert.ok(names.length > 0, 'src/lib 不应为空');

        for (const name of names) {
            const referrers = productionReferenceFiles(`src/lib/${name}`)
                .filter(file => file.text.includes(name));
            assert.ok(
                referrers.length > 0,
                `src/lib/${name} 没有任何生产侧引用者 —— 这是与 lit.js 同类的死重量，`
                + '应删除该文件（若是运行期 URL 加载，必须在 build.js 或 manifest 中登记）'
            );
        }
    });

    it('src/lib 不应存在与 npm dependencies 重复的 vendored 副本', () => {
        const vendored = readdirSync(vendoredDir).map(name => name.replace(/\.(m?js)$/, ''));
        for (const dependency of Object.keys(packageJson.dependencies || {})) {
            const bare = dependency.replace(/^@[^/]+\//, '');
            assert.ok(
                !vendored.some(name => name === bare || name.startsWith(`${bare}.`)),
                `src/lib 下的 ${bare} 与 dependencies 中的 ${dependency} 重复；`
                + '二者只需保留其一（历史上 lit 同时存在于两处，且两处都没被使用）'
            );
        }
    });
});

describe('依赖卫生：package.json 声明', () => {
    const allSpecifiers = new Set();
    for (const file of SOURCE_FILES_WITH_TEXT) {
        for (const specifier of importSpecifiers(file.text)) allSpecifiers.add(specifier);
    }

    const importedFrom = prefix => [...allSpecifiers].filter(specifier =>
        specifier === prefix || specifier.startsWith(`${prefix}/`)
    );

    it('每个运行时依赖都必须真的被 src 引用', () => {
        for (const dependency of Object.keys(packageJson.dependencies || {})) {
            assert.ok(
                importedFrom(dependency).length > 0,
                `dependencies 里的 "${dependency}" 在 src/ 中没有任何 import/require —— `
                + '声明了却没被用的依赖必须移除（lit 就是这样混进来的）'
            );
        }
    });

    it('每个开发依赖都必须真的被构建或测试引用', () => {
        for (const dependency of Object.keys(packageJson.devDependencies || {})) {
            assert.ok(
                importedFrom(dependency).length > 0,
                `devDependencies 里的 "${dependency}" 在仓库中没有任何引用`
            );
        }
    });

    it('src/ 不得引用任何 devDependency（会把测试依赖打进产物）', () => {
        const srcSpecifiers = new Set();
        for (const file of SOURCE_FILES_WITH_TEXT.filter(f => f.relativePath.startsWith('src/'))) {
            for (const specifier of importSpecifiers(file.text)) srcSpecifiers.add(specifier);
        }
        for (const dependency of Object.keys(packageJson.devDependencies || {})) {
            const offenders = [...srcSpecifiers].filter(specifier =>
                specifier === dependency || specifier.startsWith(`${dependency}/`)
            );
            assert.deepEqual(offenders, [],
                `src/ 引用了开发依赖 "${dependency}"；它会被打进发布产物`);
        }
    });

    it('src/ 不得引用 package.json 未声明的裸模块', () => {
        const declared = new Set([
            ...Object.keys(packageJson.dependencies || {}),
            ...Object.keys(packageJson.devDependencies || {}),
        ]);
        for (const file of SOURCE_FILES_WITH_TEXT.filter(f => f.relativePath.startsWith('src/'))) {
            for (const specifier of importSpecifiers(file.text)) {
                // 只看裸模块（相对路径与被构建改写的别名都不算）
                if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
                const bare = specifier.startsWith('@')
                    ? specifier.split('/').slice(0, 2).join('/')
                    : specifier.split('/')[0];
                assert.ok(
                    declared.has(bare),
                    `${file.relativePath} 引用了未声明的模块 "${specifier}"`
                );
            }
        }
    });
});
