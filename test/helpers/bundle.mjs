import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const projectRoot = path.resolve(import.meta.dirname, '../..');

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

    const modules = await import(pathToFileURL(outputPath).href);
    await rm(tempDir, { recursive: true, force: true });
    return modules;
}

/**
 * 生成 `export { A, B } from '<绝对路径>'` 形式的入口源码。
 * @param {string} modulePath 相对仓库根的路径，例如 `src/common/escape.js`
 * @param {string[]} exportNames 要导出的具名符号
 */
export function reexportSource(modulePath, exportNames) {
    return `export { ${exportNames.join(', ')} } from ${JSON.stringify(path.join(projectRoot, modulePath))};`;
}
