// story: e01s03
//
// 设计系统不变量。
//
// 这份文件的前身是 design-token-parity.test.mjs：它逐条断言内容侧三套
// 私有 token（--fl-sys-* / --fl-color-* / --fs-*）的取值与 common.css
// 的 --fox-* 完全相同。也就是说，它存在的唯一目的是**守住三份手抄副本
// 不许抄错**——是在给「内容脚本拿不到设计系统」这个架构缺陷打补丁。
//
// 根因修复后（tokens.css 直接注入宿主页面），副本不再存在，不再需要
// “保住一致”。现在守的是结构性约束，任何一条被破坏都会让设计系统重新
// 滑回多套并行状态。
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

async function readCss(relativePath) {
    return readFile(path.join(projectRoot, relativePath), 'utf8');
}

/**
 * 提取 --name: value 变量对，可选限定在 prefers-color-scheme: dark 块内。
 */
/**
 * 取出一段 `@media` 块的真实边界。
 *
 * 不能用 `/@media … \{[\s\S]*$/` 这种贪心写法：它要求目标块是文件最后一段，
 * 否则会把「从该块到文件末尾」的全部内容当成块内内容丢掉。历史缺陷正是这么来的
 * —— 内容侧 CSS 把暗色块放在文件开头，于是 token 重声明门禁实际上什么都没扫到。
 */
function findMediaBlock(css, query) {
    const start = css.search(new RegExp(`@media[^{]*${query}[^{]*\{`, 'i'));
    if (start < 0) return null;

    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') {
            depth -= 1;
            if (depth === 0) return { start, end: i + 1, body: css.slice(open + 1, i) };
        }
    }
    throw new Error(`@media ${query} 的括号没有闭合`);
}

function extractVars(css, { scheme = 'light' } = {}) {
    const dark = findMediaBlock(css, 'prefers-color-scheme:\\s*dark');
    let block;
    if (scheme === 'dark') {
        assert.ok(dark, 'expected prefers-color-scheme: dark block');
        block = dark.body;
    } else {
        block = dark ? css.slice(0, dark.start) + css.slice(dark.end) : css;
    }

    const vars = new Map();
    const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let m;
    while ((m = re.exec(block)) !== null) {
        vars.set(m[1], m[2].trim().toLowerCase());
    }
    return vars;
}

/** 递归读取源码树（CSS 与 JS 都算 token 的读者：JS 里可能用 getPropertyValue）。 */
async function readSourceTree(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...await readSourceTree(full));
        } else if (/\.(css|js|mjs)$/.test(entry.name)) {
            out.push([path.relative(projectRoot, full), await readFile(full, 'utf8')]);
        }
    }
    return out;
}

/** 一份源码集合里被读到的自定义属性名。 */
function readersIn(sources) {
    const names = new Set();
    for (const [, text] of sources) {
        for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) names.add(m[1]);
        for (const m of text.matchAll(/getPropertyValue\(\s*['"](--[a-z0-9-]+)['"]/g)) names.add(m[1]);
    }
    return names;
}

const CONTENT_CSS = [
    'src/content/style.css',
    'src/content/enhanced-style.css',
    'src/content/summary/summary.css',
];

const EXTENSION_PAGE_CSS = ['src/options/options.css', 'src/popup/popup.css'];

/** 内容脚本会把样式注入任意宿主页面，因此这些文件必须与 token 定义解耦。 */
const CONTENT_ALLOWED_LITERAL_PATTERNS = [
    // 中性投影（覆盖层在任意页面上需要更重的投影，属元素级组合值）
    /rgba\(2[05], 35, 52, [\d.]+\)/,
    /rgba\(0, 0, 0, [\d.]+\)/,
    /rgba\(12, 20, 32, [\d.]+\)/,
    // 反转色块上的半透明白描边
    /rgba\(255, 255, 255, [\d.]+\)/,
    // 使继承自宿主页面的字号/行高归位
    /(?:0|9999px|100%)/,
];

function findBrandColorLiterals(css) {
    const findings = [];
    const lines = css.split('\n');
    lines.forEach((line, index) => {
        const stripped = line.replace(/\/\*[\s\S]*?\*\//g, '');
        // 只看声明里的颜色字面量，跳过选择器与注释
        const hexes = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
        const rgbaBrand = stripped.match(/rgba\(\s*8,\s*145,\s*178/g) ?? [];
        const rgbas = stripped.match(/rgba\([^)]*\)/g) ?? [];
        const brandish = rgbas.filter(match => !CONTENT_ALLOWED_LITERAL_PATTERNS.some(re => re.test(match)));
        if (hexes.length || rgbaBrand.length || brandish.length) {
            findings.push({ line: index + 1, text: line.trim(), hexes, brandish });
        }
    });
    return findings;
}

test('内容侧 CSS 不再定义任何 token（取值只能来自 tokens.css）', async () => {
    const common = await readCss('src/common/tokens.css');
    const foxPrimitives = new Set([
        ...extractVars(common, { scheme: 'light' }).keys(),
    ]);

    for (const file of CONTENT_CSS) {
        const css = await readCss(file);
        const defined = [...extractVars(css).keys()].filter(name => !name.startsWith('--fox-'));
        assert.deepEqual(
            defined,
            [],
            `${file} 定义了 token ${defined.join(', ')}；内容样式不得自带 token 定义`,
        );

        // 内容侧可以消费 --fox-*，但不得自行声明（声明即等于再造一套）
        const redeclared = [...extractVars(css).keys()].filter(name => foxPrimitives.has(name));
        assert.deepEqual(
            redeclared,
            [],
            `${file} 重新声明了原语 ${redeclared.join(', ')}；那会遮蔽 tokens.css`,
        );
    }
});

test('内容侧 CSS 不再硬编码品牌色', async () => {
    for (const file of CONTENT_CSS) {
        const css = await readCss(file);
        const findings = findBrandColorLiterals(css);
        assert.deepEqual(
            findings,
            [],
            `${file} 仍有品牌色字面量：\n${findings.map(f => `  ${f.line}: ${f.text}`).join('\n')}`,
        );
    }
});

test('tokens.css 只含 --fox-* 自定义属性，且不改变宿主页面渲染', async () => {
    // 先剥掉注释，避免注释里提到的属性名造成误判
    const css = (await readCss('src/common/tokens.css')).replace(/\/\*[\s\S]*?\*\//g, '');

    // 1. 所有声明必须是 --fox-* 自定义属性
    const declared = [...extractVars(css).keys()];
    assert.ok(declared.length > 40, `expected a full token set, got ${declared.length}`);
    for (const name of declared) {
        assert.ok(name.startsWith('--fox-'), `tokens.css 声明了非命名空间变量 ${name}`);
    }

    // 2. 只允许 :root 选择器（@media 内的 :root 有缩进，需允许前导空白）
    const selectors = css
        .replace(/@media[^{]*\{/g, '')
        .match(/^[ \t]*[^@{}\s][^{}]*\{/gm) ?? [];
    assert.ok(selectors.length >= 2, 'expected :root for light and dark');
    for (const selector of selectors) {
        assert.equal(selector.trim().replace(/\s*\{$/, '').trim(), ':root',
            `tokens.css 出现了非 :root 选择器：${selector.trim()}`);
    }

    // 3. 不得声明会改变宿主页面渲染的属性。
    //    用「声明锚点」（行首或 ; { 之后紧跟属性名）判定，
    //    避免把 --fox-font-sans 这类自定义属性名与 @media (prefers-color-scheme:) 误判。
    const forbidden = [
        'color-scheme',
        'font',
        'font-family',
        'font-size',
        'all',
        'position',
        'display',
        'background',
        'visibility',
        'content',
        'overflow',
    ];
    for (const property of forbidden) {
        assert.ok(
            !new RegExp(`(^|[;{])\\s*${property}\\s*:`, 'm').test(css),
            `tokens.css 不得声明 ${property}（会污染宿主页面）`,
        );
    }
});

test('common.css 的别名全部指向 --fox-* 原语，不写死取值', async () => {
    const css = await readCss('src/common/common.css');
    const vars = extractVars(css);

    const aliases = [...vars.entries()].filter(([name]) => !name.startsWith('--fox-'));
    assert.ok(aliases.length > 40, 'expected the derived alias layer');

    for (const [name, value] of aliases) {
        assert.match(value, /^var\(--fox-[a-z0-9-]+\)$/,
            `${name} 应指向 --fox-* 原语，实际为 "${value}"`);
    }
});

test('common.css 声明 color-scheme，tokens.css 不声明', async () => {
    const common = await readCss('src/common/common.css');
    const tokens = (await readCss('src/common/tokens.css')).replace(/\/\*[\s\S]*?\*\//g, '');

    assert.match(common, /(^|[;{])\s*color-scheme\s*:\s*light dark/m,
        'color-scheme 会改变表单控件渲染，必须只出现在扩展页面用的 common.css');
    // 注意：不得用 /color-scheme/ 直接判断，`@media (prefers-color-scheme: dark)`
    // 是合法的媒体特性，不属于声明。
    assert.ok(!/(^|[;{])\s*color-scheme\s*:/m.test(tokens),
        'tokens.css 会被注入宿主页面，不得声明 color-scheme');
});

test('popup/options 只经 common.css 引入 token，不绕过设计系统', async () => {
    for (const file of EXTENSION_PAGE_CSS) {
        const css = await readCss(file);
        assert.match(css, /@import\s+url\(['"]\/common\/common\.css['"]\)/,
            `${file} 必须 import common.css`);
        assert.ok(!/\/common\/tokens\.css/.test(css),
            `${file} 不应直接 import tokens.css；那会绕过 color-scheme 与别名层`);
    }
});

test('common.css 导入 tokens.css 且 import 位于文件最前', async () => {
    const css = await readCss('src/common/common.css');
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const firstRule = withoutComments.match(/^\s*([^{}]+)\{/m);
    assert.match(withoutComments.trimStart().slice(0, 40), /^@import\s+url\(['"]\/common\/tokens\.css['"]\)/,
        'common.css 必须以 @import /common/tokens.css 开头（@import 必须位于所有规则之前）');
    assert.ok(firstRule, 'expected at least one rule after the import');
});

test('内容注入清单包含 tokens.css，且排在所有内容样式之前', async () => {
    const source = await readFile(
        path.join(projectRoot, 'src/background/background-constants.js'),
        'utf8',
    );
    const match = source.match(/CSS_FILES\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(match, 'expected CSS_FILES');

    const files = [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    assert.equal(files[0], 'common/tokens.css',
        `CSS_FILES 第一项必须是 common/tokens.css，实际为 ${files[0]}`);
    for (const file of files) {
        assert.ok(/\.css$/.test(file), `CSS_FILES 只应包含 css，发现 ${file}`);
    }
});

test('徽标颜色必须是 tokens.css 的品牌原语，不得另起一套', async () => {
    // `action.setBadgeBackgroundColor` 只接受字面量，读不了 CSS 变量，所以徽标色必须在
    // JS 里再写一遍。这个「再写一遍」曾经是三份无门禁的裸十六进制，与 tokens.css
    // 各自漂移。现在把它变成受约束的引用关系：两边的取值集合必须完全相同。
    const tokens = await readCss('src/common/tokens.css');
    const badgeSource = await readFile(path.join(projectRoot, 'src/background/badge-state.js'), 'utf8');

    const tokenPalette = ['primary', 'success', 'warning', 'error'].map((name) => {
        const value = tokens.match(new RegExp(`--fox-color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
        assert.ok(value, `tokens.css 缺少 --fox-color-${name}`);
        return value.toLowerCase();
    });

    const badgeBlock = badgeSource.match(/const BADGE_COLORS = \{([\s\S]*?)\};/)?.[1];
    assert.ok(badgeBlock, 'badge-state.js 里找不到 BADGE_COLORS');

    const badgePalette = [...badgeBlock.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)]
        .map(([, , value]) => value.toLowerCase())
        .sort();

    assert.deepEqual(badgePalette, [...tokenPalette].sort(),
        '徽标配色与 --fox-color-primary/success/warning/error 不一致，两边已漂移');
});

// ---------------------------------------------------------------- 设计元素
//
// 这里只钉住 Apple 设计原则里「可以机械验证」的那部分。不可验证的那些
// （「内容先于形式」「不要把熟悉的东西做陌生」）刻意不写成测试 —— 写了也只是
// 同义反复，反而让人以为它们被守住了。

/** 不看媒体上下文，把文件里所有自定义属性声明都收上来。 */
function extractAllVars(css) {
    const vars = new Map();
    const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let m;
    while ((m = re.exec(css)) !== null) vars.set(m[1], m[2].trim().toLowerCase());
    return vars;
}

test('门禁自检：extractVars 必须能看见媒体查询里的声明', () => {
    // 历史缺陷：旧实现用 /@media … dark … \{[\\s\\S]*$/ 剥离暗色块，
    // 既要求该块位于文件末尾，又看不见块内声明 —— 于是内容侧把整套 token
    // 抄进暗色块也没人拦。这里反过来证明解析器能看见。
    const sample = ':root { --fox-a: 1; }\n' +
        '@media (prefers-color-scheme: dark) {\n  :root { --fox-b: 2; }\n}\n.x { color: red; }';

    assert.ok(extractAllVars(sample).has('--fox-b'), '全文扫描必须包含暗色块内声明');
    assert.ok(!extractVars(sample).has('--fox-b'), 'light 视图应排除暗色块');
    assert.deepEqual([...extractVars(sample, { scheme: 'dark' }).keys()], ['--fox-b']);
});

test('内容侧 CSS 不得以任何方式重新声明 --fox-* 原语（含媒体查询内）', async () => {
    const primitives = new Set(extractAllVars(await readCss('src/common/tokens.css')).keys());
    for (const file of CONTENT_CSS) {
        const css = await readCss(file);
        const redeclared = [...extractAllVars(css).keys()].filter(name => primitives.has(name));
        assert.deepEqual(redeclared, [],
            `${file} 重新声明了原语 ${redeclared.join(', ')}；内容侧只能消费 tokens.css`);
    }
});

test('设计 token 不得只有定义没有读者', async () => {
    const tree = await readSourceTree(path.join(projectRoot, 'src'));
    const common = tree.find(([file]) => file === 'src/common/common.css')[1];
    const tokens = tree.find(([file]) => file === 'src/common/tokens.css')[1];

    // 别名层：:root 里的每条别名都必须被 :root 之外的规则读到。
    // 别名套别名不算「有读者」—— 那只是把死代码串成一串。
    const rootBlock = common.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
    const componentReaders = readersIn(tree.map(([file, text]) =>
        [file, file === 'src/common/common.css' ? common.replace(rootBlock, '') : text]));
    const deadAliases = [...extractVars(common).keys()]
        .filter(name => !name.startsWith('--fox-'))
        .filter(name => !componentReaders.has(name));
    assert.deepEqual(deadAliases, [],
        `别名层有死别名：${deadAliases.join(', ')}\n` +
        '（比例尺与成对的语义色在 tokens.css 里是完整的，需要时直接写 var(--fox-*)，' +
        '别名层只保留真正在用的词汇）');

    // 原语层：动效与排版 token 必须被引用。字号/圆角/间距比例尺与语义色允许
    // 保持完整（比例尺的价值就在于整齐，缺一档才是错的）。
    const MUST_HAVE_READERS = /^--fox-(motion|tracking|leading|font-sans)/;
    const allReaders = readersIn(tree);
    const deadPrimitives = [...extractVars(tokens).keys()]
        .filter(name => MUST_HAVE_READERS.test(name))
        .filter(name => !allReaders.has(name));
    assert.deepEqual(deadPrimitives, [],
        `这些原语定义了但没有任何读者：${deadPrimitives.join(', ')}`);
});

test('无障碍四态都有响应：暗色 / 降低动效 / 降低透明度 / 提高对比度', async () => {
    const tokens = await readCss('src/common/tokens.css');
    for (const [query, why] of [
        ['prefers-color-scheme:\\s*dark', '暗色模式'],
        ['prefers-reduced-motion:\\s*reduce', '降低动效'],
        ['prefers-reduced-transparency:\\s*reduce', '降低透明度'],
        ['prefers-contrast:\\s*more', '提高对比度'],
    ]) {
        assert.ok(findMediaBlock(tokens, query), `tokens.css 缺少 ${why} 的取值响应`);
    }
});

test('降低动效时保留颜色反馈，但不得保留位移', async () => {
    // §14：降低动效 ≠ 关掉反馈。颜色与透明度的交叉淡入本身就是状态变化的语言，
    // 而位移类动效（transform）是前庭不适的来源，必须保持瞬时。
    const css = await readCss('src/common/common.css');
    const block = findMediaBlock(css, 'prefers-reduced-motion:\\s*reduce');
    assert.ok(block, 'common.css 缺少 prefers-reduced-motion 兜底块');

    assert.match(block.body, /\.btn\s*,/, '恢复规则必须覆盖 .btn');
    const restored = block.body.match(/transition-property:\s*([^;]+);/)?.[1];
    assert.ok(restored, '恢复规则必须显式声明 transition-property');
    assert.ok(!/transform/.test(restored),
        `降低动效时不得把 transform 放回过渡（实际为 ${restored}）`);
    assert.match(restored, /opacity/, '至少应保留 opacity 交叉淡入');

    // 兜底仍然要压住一切
    assert.match(block.body, /\*,[\s\S]*?transition-duration:\s*0?\.001ms\s*!important/);
});

test('按钮必须在按下时就反馈，而不是等松手', async () => {
    // §2：按下即响应。这条曾经只存在于 .btn-primary，普通按钮按下毫无反馈，
    // 而 .btn 里早就写了 overflow/position 暗示过有按压态。
    const css = await readCss('src/common/common.css');
    const active = css.match(/\.btn:active:not\(:disabled\)\s*\{([^}]*)\}/)?.[1];
    assert.ok(active, '.btn 缺少 :active 按压态');
    assert.match(active, /transform:\s*scale\(/,
        '按压反馈应是位移/缩放（颜色变化单独由 .btn-primary 负责）');
    assert.match(active, /--btn-press-duration:\s*var\(--fox-motion-response-press\)/,
        '按下必须用最短的 response，否则不跟手');
});

test('会变化的数值必须使用等宽字形', async () => {
    const common = await readCss('src/common/common.css');
    assert.match(common, /\.tabular\s*\{\s*font-variant-numeric:\s*tabular-nums;/,
        'common.css 必须提供 .tabular 工具类');

    // 版本号与缓存条数都会随状态变化；比例字形下每换一个数字整行宽度就跳一次
    for (const [file, id] of [
        ['src/popup/popup.html', 'versionDisplay'],
        ['src/options/options.html', 'cacheInfoDisplay'],
    ]) {
        const html = await readFile(path.join(projectRoot, file), 'utf8');
        const element = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0];
        assert.ok(element, `${file} 里找不到 #${id}`);
        assert.match(element, /class="[^"]*\btabular\b/,
            `#${id} 会显示变化的数值，必须带 tabular 类`);
    }
});

test('字体栈必须从平台系统字体开始，且不得引用未分发的字体', async () => {
    const tokens = await readCss('src/common/tokens.css');
    const stack = tokens.match(/--fox-font-sans:\s*([^;]+);/)?.[1];
    assert.ok(stack, 'tokens.css 缺少 --fox-font-sans');
    assert.match(stack, /^\s*(ui-sans-serif|system-ui|-apple-system)/,
        `字体栈必须以平台关键字开头，实际为 "${stack.trim()}"`);

    // Inter 从未随扩展分发，却在字体栈里排第一 —— 每个用户都在等一次
    // 不会成功的字体回退。这类「声明存在、资源不存在」一律禁止。
    for (const file of [...CONTENT_CSS, ...EXTENSION_PAGE_CSS, 'src/common/tokens.css', 'src/common/common.css']) {
        const text = (await readCss(file)).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const decl of text.match(/font-family:\s*([^;]+);/g) ?? []) {
            assert.ok(!/\bInter\b/.test(decl), `${file} 引用了未分发的字体：${decl.trim()}`);
        }
    }
});

test('弹簧曲线必须是合法的 linear() 缓动', async () => {
    // 手写 19 个采样点最容易犯的错是值非单调或没覆盖到 100% —— 前者让动画
    // 中途倒退，后者让元素永远停在半路。两种都不会报错，只会「看起来有点怪」，
    // 所以必须机器检查。
    const tokens = await readCss('src/common/tokens.css');
    const curve = tokens.match(/--fox-motion-ease-spring:\s*linear\(([^;]+)\);/)?.[1];
    assert.ok(curve, 'tokens.css 缺少 --fox-motion-ease-spring');

    const points = curve.split(',').map(part => {
        const [value, stop] = part.trim().split(/\s+/);
        assert.ok(stop, `采样点 "${part.trim()}" 缺少位置`);
        return { value: Number(value), stop: Number(stop.replace('%', '')) };
    });

    assert.ok(points.length >= 10, `采样点太少（${points.length}），曲线会不够平滑`);
    assert.equal(points[0].value, 0, '弹簧必须从 0 开始');
    assert.equal(points.at(-1).value, 1, '弹簧必须落在 1，否则元素停在半路');
    assert.equal(points.at(-1).stop, 100, '最后一个采样点必须覆盖到 100%');

    for (let i = 1; i < points.length; i += 1) {
        assert.ok(points[i].value >= points[i - 1].value,
            `第 ${i + 1} 个采样点数值倒退（${points[i - 1].value} → ${points[i].value}）`);
        assert.ok(points[i].value >= 0 && points[i].value <= 1,
            `第 ${i + 1} 个采样点越界（${points[i].value}）`);
        assert.ok(points[i].stop > points[i - 1].stop,
            `第 ${i + 1} 个采样点位置未递增`);
    }
});
