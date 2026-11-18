// story: e01s04
//
// 分层不变量。
//
// 事实基线（扫描 src/ 全部 294 条相对 import 得到）：
//     lib  <-  common  <-  { background, content, popup, options }
// 也就是 `lib` 与 `common` 是被依赖的底座，四个上层之间**互不引用**。
//
// 这条约束不是审美偏好，它对应运行时的真实边界：
//   * `lib/` 是 vendor 产物（browser-polyfill 1224 行 / readability 2786 行），
//     反向依赖 src 会让 vendor 升级变成不可能。
//   * `common/` 会被注入内容脚本、被 service worker 引用、也被扩展页面引用；
//     它一旦依赖 `content/`，service worker 就会静态拉进 DOM 代码而崩掉。
//     （本轮修掉的正是这一类：`common/settings-domain.js` 曾 import
//      `../content/subtitle/strategy-manifest.js`。）
//   * `background/` 不得 import `content/`：service worker 没有 DOM，
//     它只能通过**字符串路径**注入内容脚本（见 `script-injector.js`），
//     这是刻意的解耦，不能退化成静态 import。
//   * `popup/` 与 `options/` 不得互相 import：两个独立入口，共享的东西
//     必须下沉到 `common/`。
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const srcDir = path.resolve(import.meta.dirname, '../src');

/** 依赖方向：key 只能依赖 value 中列出的层（同层自由）。 */
const LAYER_DEPENDENCIES = {
    lib: [],
    common: ['lib'],
    background: ['lib', 'common'],
    content: ['lib', 'common'],
    popup: ['lib', 'common'],
    options: ['lib', 'common'],
};

const LAYERS = Object.keys(LAYER_DEPENDENCIES);

async function listJsFiles(dir) {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...await listJsFiles(full));
        } else if (entry.name.endsWith('.js')) {
            found.push(full);
        }
    }
    return found;
}

/** 提取 `from '...'` 与裸 `import '...'` 的静态说明符。 */
function extractSpecifiers(source) {
    const specifiers = new Set();
    const patterns = [
        /(?:^|\s)(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/gm,
        /(?:^|\s)import\s*['"]([^'"]+)['"]/gm,
        // dynamic import() 也算静态层级依赖：打包器会为它产出一个 chunk
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            specifiers.add(match[1]);
        }
    }
    return [...specifiers];
}

/** @returns {{ from: string, fromLayer: string, toLayer: string, specifier: string, resolved: string }[]} */
async function collectCrossLayerImports(files) {
    const edges = [];
    for (const file of files) {
        const relative = path.relative(srcDir, file).split(path.sep);
        const fromLayer = relative[0];
        if (!LAYERS.includes(fromLayer)) continue;

        const source = await readFile(file, 'utf8');
        for (const specifier of extractSpecifiers(source)) {
            if (!specifier.startsWith('.')) continue; // 包外依赖不参与分层判定
            const resolvedPath = path.resolve(path.dirname(file), specifier);
            const resolvedRelative = path.relative(srcDir, resolvedPath);
            if (resolvedRelative.startsWith('..')) continue;
            const toLayer = resolvedRelative.split(path.sep)[0];
            if (!LAYERS.includes(toLayer)) continue;
            if (toLayer === fromLayer) continue;

            edges.push({
                from: path.relative(srcDir, file).split(path.sep).join('/'),
                fromLayer,
                toLayer,
                specifier,
                resolved: resolvedRelative.split(path.sep).join('/'),
            });
        }
    }
    return edges;
}

/** 缓存一次扫描结果，供下面所有断言复用（扫描约 0.3s）。 */
let cachedFiles;
async function files() {
    cachedFiles ??= await listJsFiles(srcDir);
    return cachedFiles;
}

test('src/ 内的跨层 import 只允许沿 lib → common → 上层 单向流动', async () => {
    const edges = await collectCrossLayerImports(await files());
    assert.ok(edges.length > 100, `expected a meaningful graph, got ${edges.length} edges`);

    const violations = edges.filter(({ fromLayer, toLayer }) =>
        !LAYER_DEPENDENCIES[fromLayer].includes(toLayer));

    assert.deepEqual(
        violations.map(v => `${v.from}  ->  ${v.resolved}`),
        [],
        '发现反向或跨上层依赖；共享逻辑必须下沉到 common/',
    );
});

test('common/ 不依赖任何上层（service worker 会静态拉入它）', async () => {
    const edges = await collectCrossLayerImports(await files());
    const offenders = edges
        .filter(e => e.fromLayer === 'common' && !LAYER_DEPENDENCIES.common.includes(e.toLayer));
    assert.deepEqual(
        offenders.map(v => `${v.from}  ->  ${v.resolved}`),
        [],
        'common/ 出现反向依赖；共享逻辑不能向上引用',
    );
});

test('background/ 不静态 import content/（service worker 无 DOM，只能按路径注入）', async () => {
    const edges = await collectCrossLayerImports(await files());
    const offenders = edges
        .filter(e => e.fromLayer === 'background' && e.toLayer === 'content');
    assert.deepEqual(
        offenders.map(v => `${v.from}  ->  ${v.resolved}`),
        [],
        'background/ 不得静态 import content/；应通过 script-injector 按字符串路径注入',
    );
});

test('lib/ 是依赖叶子：不 import src 的任何其他层', async () => {
    const edges = await collectCrossLayerImports(await files());
    const offenders = edges.filter(e => e.fromLayer === 'lib');
    assert.deepEqual(
        offenders.map(v => `${v.from}  ->  ${v.resolved}`),
        [],
        'lib/ 是 vendored 代码，反向依赖会让 vendor 升级无法进行',
    );
});

test('popup/ 与 options/ 互不依赖（共享逻辑必须在 common/）', async () => {
    const edges = await collectCrossLayerImports(await files());
    const offenders = edges.filter(e =>
        (e.fromLayer === 'popup' && e.toLayer === 'options')
        || (e.fromLayer === 'options' && e.toLayer === 'popup'));
    assert.deepEqual(
        offenders.map(v => `${v.from}  ->  ${v.resolved}`),
        [],
        '两个独立扩展入口不得互相 import',
    );
});

test('每个模块的深层子目录 import 不超过 3 层上溯（防止目录树失控）', async () => {
    const edges = await collectCrossLayerImports(await files());
    const deep = edges.filter(({ specifier }) => (specifier.match(/\.\.\//g) ?? []).length > 4);
    assert.deepEqual(
        deep.map(v => `${v.from}  ->  ${v.specifier}`),
        [],
        '上溯超过 4 层说明目录嵌套过深，应就近归位或下沉到 common',
    );
});

test('src/ 的相对 import 图无环（模块环让初始化顺序变成运行时 undefined）', async () => {
    const all = await files();
    const graph = new Map();

    for (const file of all) {
        const relative = path.relative(srcDir, file).split(path.sep).join('/');
        const source = await readFile(file, 'utf8');
        const targets = [];
        for (const specifier of extractSpecifiers(source)) {
            if (!specifier.startsWith('.')) continue;
            const resolved = path.relative(srcDir, path.resolve(path.dirname(file), specifier))
                .split(path.sep).join('/');
            if (resolved.startsWith('..')) continue;
            targets.push(resolved);
        }
        graph.set(relative, targets);
    }

    // 迭代式 DFS 找回边；只报最短的一个环的闭环路径，便于定位。
    const CYCLES_LIMIT = 10;
    const cycles = [];
    const state = new Map(); // 'visiting' | 'done'
    const stack = [];

    const visit = node => {
        if (cycles.length >= CYCLES_LIMIT) return;
        state.set(node, 'visiting');
        stack.push(node);
        for (const next of graph.get(node) ?? []) {
            if (!graph.has(next)) continue; // 解析到 src/ 之外的模块不参与
            const nextState = state.get(next);
            if (nextState === 'visiting') {
                const start = stack.indexOf(next);
                cycles.push([...stack.slice(start), next].join(' -> '));
            } else if (nextState !== 'done') {
                visit(next);
            }
        }
        stack.pop();
        state.set(node, 'done');
    };

    for (const node of graph.keys()) {
        if (!state.has(node)) visit(node);
    }

    assert.deepEqual(cycles, [], 'src/ 出现了模块环；把被共享的纯数据/常量下沉到叶子模块');
});

test('显示策略只能由注册表装配，其他地方不得直接 import', async () => {
    const all = await files();
    const registry = 'content/display/display-strategy-registry.js';

    const importers = [];
    for (const file of all) {
        const relative = path.relative(srcDir, file).split(path.sep).join('/');
        if (relative.startsWith('content/strategies/')) continue; // 策略之间可以互相引用
        if (relative === registry) continue;
        const source = await readFile(file, 'utf8');
        if (/(?:from|\(\s*)['"][^'"]*\/strategies\//.test(source)) {
            importers.push(relative);
        }
    }

    assert.deepEqual(
        importers,
        [],
        `显示策略必须从 ${registry} 装配；否则新增一个显示模式就要改多处入口`,
    );
});
