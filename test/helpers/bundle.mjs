import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const projectRoot = path.resolve(import.meta.dirname, '../..');

/**
 * 打包结果缓存。
 *
 * 每个测试文件都会为自己的入口跑一次 esbuild（全套 50+ 次、单次几十到几百毫秒），
 * 而同一份 `entrySource` 的产物是确定的。缓存键包含入口源码与别名，不包含临时目录名。
 * 一次 `npm test` 里重复的构建因此只发生一次。
 */
const bundleCache = new Map();
const buildDirs = new Set();

// 构建目录要活到进程结束（缓存与 mock 的绝对路径都指向它），退出时统一清理。
process.on('exit', () => {
    for (const dir of buildDirs) {
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {
            // 退出阶段忽略清理失败
        }
    }
});

/**
 * 每次调用都 import 一份**新的**模块实例。
 *
 * 缓存的是 esbuild 的构建结果（产物文件），不是模块命名空间：模块级单例
 * （`export default new X()`）必须每个用例一份，否则状态会在用例之间串味。
 * 复制一个小文件比重新打包便宜一个数量级。
 */
async function importFreshCopy(outputPath) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-test-instance-'));
    const copyPath = path.join(dir, 'bundle.mjs');
    await copyFile(outputPath, copyPath);
    try {
        return await import(pathToFileURL(copyPath).href);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/**
 * 把源码模块打包成可在 Node 里 import 的 ESM。
 *
 * 为什么必须打包：仓库是 CommonJS 包（`package.json` 没有 `"type": "module"`），
 * 而 `src/**` 是 ESM 源码。Node 会按扩展名把 `.js` 当 CommonJS，无法直接 import
 * 命名导出，所以测试统一先过一遍 esbuild——顺便也让被测对象与实际投入浏览器的
 * 构建产物保持同一套模块语义。
 *
 * @param {string} entrySource 临时入口的源码（通常是一串 `export { X } from '...'`）
 * @param {object} [options]
 * @param {object} [options.aliases] 额外的模块别名：{ 匹配正则: 替换文件路径 }
 * @param {boolean} [options.mockBrowserPolyfill] 是否把 `lib/browser-polyfill` 换成
 *   读 `globalThis.__foxlateBrowserMock` 的转接层（默认 true，与其它测试一致）
 * @param {string} [options.prefix] 临时目录前缀
 * @returns {Promise<object>} 打包产物的模块命名空间
 */
export async function bundleModule(entrySource, {
    aliases = {},
    mockBrowserPolyfill = true,
    prefix = 'foxlate-test-',
} = {}) {
    const cacheKey = JSON.stringify({
        entrySource,
        aliases: Object.entries(aliases).sort(),
        mockBrowserPolyfill,
    });

    let pending = bundleCache.get(cacheKey);
    if (!pending) {
        pending = buildBundle(entrySource, { aliases, mockBrowserPolyfill, prefix });
        bundleCache.set(cacheKey, pending);
    }

    let built;
    try {
        built = await pending;
    } catch (error) {
        // 失败不缓存：否则一个偶发错误会污染后续所有用例。
        bundleCache.delete(cacheKey);
        throw error;
    }
    return importFreshCopy(built.outputPath);
}

async function buildBundle(entrySource, {
    aliases = {},
    mockBrowserPolyfill = true,
    prefix = 'foxlate-test-',
} = {}) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');
    const mockBrowserPath = path.join(tempDir, 'browser-polyfill-mock.js');

    await writeFile(entryPath, entrySource);

    const extraAliases = [];
    if (mockBrowserPolyfill) {
        await writeFile(mockBrowserPath, 'export default globalThis.__foxlateBrowserMock;');
        extraAliases.push([/browser-polyfill\.js$/, mockBrowserPath]);
    }
    for (const [pattern, target] of Object.entries(aliases)) {
        extraAliases.push([new RegExp(pattern), target]);
    }

    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        plugins: [{
            name: 'foxlate-test-aliases',
            setup(buildContext) {
                for (const [filter, target] of extraAliases) {
                    buildContext.onResolve({ filter }, () => ({ path: target }));
                }
            },
        }],
    });

    // 构建目录保留到进程结束：缓存要用它，且 mock polyfill 的绝对路径已经烘进产物。
    buildDirs.add(tempDir);
    return { outputPath, tempDir };
}

/**
 * 生成 `export { A, B } from '<绝对路径>'` 形式的入口源码。
 * @param {string} modulePath 相对仓库根的路径，例如 `src/common/escape.js`
 * @param {string[]} exportNames 要导出的具名符号
 */
export function reexportSource(modulePath, exportNames) {
    return `export { ${exportNames.join(', ')} } from ${JSON.stringify(path.join(projectRoot, modulePath))};`;
}
