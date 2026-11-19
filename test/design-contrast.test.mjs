import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

/**
 * 配色对比度门禁（WCAG 2.2 AA）。
 *
 * 为什么需要它：`tokens.css` 里其实早就有「把次级文字提到正文强度」的声明，但它只挂在
 * `@media (prefers-contrast: more)` 下——也就是说**可读性被绑在用户主动开启的系统开关
 * 上**。默认状态实测：次要文字 3.08:1、主色按钮白字 3.68:1、成功绿 2.54:1，宿主页面与
 * 设置页共有 60+ 处正文/说明文字不达 AA。这类问题构建不报错、截图看起来「只是有点淡」，
 * 只有算比率才能发现，因此必须有门禁把比率钉住。
 *
 * 只校验 token 层：组件里不允许出现颜色字面量（见 design-system.test.mjs），所以
 * token 达标就等于全站达标。
 */

const projectRoot = path.resolve(import.meta.dirname, '..');
const TOKENS_PATH = 'src/common/tokens.css';

/** WCAG 2.2：正文 4.5:1，大字号 3:1，非文本图形 3:1。这里一律用最严的 4.5。 */
const AA_TEXT = 4.5;
/** 焦点环属于非文本图形（1.4.11）。 */
const AA_GRAPHIC = 3;

function findMediaBlock(css, query) {
    const start = css.search(new RegExp(`@media[^{]*${query}[^{]*\\{`, 'i'));
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

/**
 * 取出指定配色方案下的 token 表。
 *
 * 只取顶层 `:root` 声明，并且排除 `prefers-contrast: more` 块：那份是「用户要求更高
 * 对比度」的加强档，不是默认档。默认档必须自己达标，不能靠它兜底。
 */
function extractScheme(css, scheme) {
    const dark = findMediaBlock(css, 'prefers-color-scheme:\\s*dark');
    let body;
    if (scheme === 'dark') {
        assert.ok(dark, 'tokens.css 缺少 prefers-color-scheme: dark 块');
        body = dark.body;
    } else {
        body = dark ? css.slice(0, dark.start) + css.slice(dark.end) : css;
    }

    // 去掉加强对比度块（含 dark + more 组合），只留默认取值。
    for (;;) {
        const more = findMediaBlock(body, 'prefers-contrast:\\s*more');
        if (!more) break;
        body = body.slice(0, more.start) + body.slice(more.end);
    }

    const vars = new Map();
    for (const match of body.matchAll(/(--fox-[\w-]+)\s*:\s*([^;]+);/g)) {
        vars.set(match[1], match[2].trim());
    }
    return vars;
}

/**
 * 解析 token 表，得到「最终生效值」。
 *
 * 两件 CSS 语义必须在这里复现，否则门禁会误判：
 * 1. 深色块只覆盖它声明的那部分，未声明的沿用浅色取值（层叠，不是从零开始）；
 * 2. `--a: var(--b)` 这类间接引用要递归展开，否则算不出对比度。
 */
function resolveScheme(css, scheme) {
    const light = extractScheme(css, 'light');
    const merged = scheme === 'dark'
        ? new Map([...light, ...extractScheme(css, 'dark')])
        : new Map(light);

    const resolve = (name, depth = 0) => {
        const raw = merged.get(name);
        if (raw === undefined || depth > 8) return raw;
        const indirect = raw.match(/^var\((--fox-[\w-]+)\)$/);
        return indirect ? resolve(indirect[1], depth + 1) : raw;
    };

    for (const name of merged.keys()) {
        merged.set(name, resolve(name));
    }
    return merged;
}

function parseColor(value) {
    if (!value) return null;
    const text = value.trim();
    if (text.startsWith('#')) {
        const hex = text.slice(1);
        const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
        if (full.length !== 6) return null;
        return {
            r: parseInt(full.slice(0, 2), 16),
            g: parseInt(full.slice(2, 4), 16),
            b: parseInt(full.slice(4, 6), 16),
            a: 1,
        };
    }
    const match = text.match(/^rgba?\(([^)]+)\)$/i);
    if (!match) return null;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** 半透明前景叠在不透明底色上的实际观感色。 */
function composite(fg, bg) {
    const a = fg.a ?? 1;
    return {
        r: Math.round(fg.r * a + bg.r * (1 - a)),
        g: Math.round(fg.g * a + bg.g * (1 - a)),
        b: Math.round(fg.b * a + bg.b * (1 - a)),
        a: 1,
    };
}

function relativeLuminance({ r, g, b }) {
    const channel = c => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * @param {string} fgValue 前景 token 值
 * @param {string} bgValue 背景 token 值
 * @param {string} [baseValue] 背景为半透明时叠在哪个实色上（深色方案必须传 panel，
 *   否则 rgba(…,0.16) 会被当白底混合，算出一堆假的 1.01:1）
 */
function contrast(fgValue, bgValue, baseValue) {
    const fg = parseColor(fgValue);
    const bg = parseColor(bgValue);
    assert.ok(fg, `无法解析颜色: ${fgValue}`);
    assert.ok(bg, `无法解析颜色: ${bgValue}`);
    const base = parseColor(baseValue) ?? { r: 255, g: 255, b: 255, a: 1 };
    const bgSolid = bg.a < 1 ? composite(bg, base) : bg;
    const fgSolid = fg.a < 1 ? composite(fg, bgSolid) : fg;
    const [hi, lo] = [relativeLuminance(fgSolid), relativeLuminance(bgSolid)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** 文字必须在其所有可能落上的表面上都达标。 */
const TEXT_TOKENS = [
    '--fox-color-text',
    '--fox-color-text-secondary',
    '--fox-color-text-muted',
];

const SURFACE_TOKENS = [
    '--fox-color-bg',
    '--fox-color-panel',
    '--fox-color-panel-raised',
    '--fox-color-surface-dim',
    '--fox-color-bg-strong',
    '--fox-color-panel-glass',
];

/** 语义色同时承担「彩色文字」与「彩色底 + 白字/深字」两种用法，两边都要达标。 */
const SEMANTIC_TEXT_TOKENS = [
    '--fox-color-success',
    '--fox-color-warning',
    '--fox-color-error',
];

/** 前景色 on 背景色的成对契约。 */
const PAIRS = [
    ['--fox-color-on-primary', '--fox-color-primary'],
    ['--fox-color-on-primary', '--fox-color-primary-hover'],
    ['--fox-color-on-primary', '--fox-color-primary-active'],
    ['--fox-color-on-primary-soft', '--fox-color-primary-soft'],
    ['--fox-color-on-accent-soft', '--fox-color-accent-soft'],
    ['--fox-color-on-error-bg', '--fox-color-error-bg'],
    ['--fox-color-inverted-text', '--fox-color-inverted-surface'],
];

function buildFailures(vars, scheme) {
    const failures = [];
    // 半透明背景统一叠在本方案的 panel 上——那是这些色块实际出现的底面。
    const base = vars.get('--fox-color-panel');
    const value = name => {
        const raw = vars.get(name);
        assert.ok(raw, `${scheme} 配色缺少 ${name}`);
        return raw;
    };

    for (const text of TEXT_TOKENS) {
        for (const surface of SURFACE_TOKENS) {
            const ratio = contrast(value(text), value(surface), base);
            if (ratio < AA_TEXT) {
                failures.push(`${text} on ${surface}: ${ratio.toFixed(2)} < ${AA_TEXT}`);
            }
        }
    }

    for (const semantic of SEMANTIC_TEXT_TOKENS) {
        for (const surface of ['--fox-color-panel', '--fox-color-bg']) {
            const ratio = contrast(value(semantic), value(surface), base);
            if (ratio < AA_TEXT) {
                failures.push(`${semantic} on ${surface}: ${ratio.toFixed(2)} < ${AA_TEXT}`);
            }
        }
    }

    for (const [fg, bg] of PAIRS) {
        const ratio = contrast(value(fg), value(bg), base);
        if (ratio < AA_TEXT) {
            failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${AA_TEXT}`);
        }
    }

    const focus = contrast(value('--fox-color-focus'), value('--fox-color-panel'), base);
    if (focus < AA_GRAPHIC) {
        failures.push(`--fox-color-focus on --fox-color-panel: ${focus.toFixed(2)} < ${AA_GRAPHIC}`);
    }

    return failures;
}

const tokensCss = await readFile(path.join(projectRoot, TOKENS_PATH), 'utf8');

test('浅色配色：正文与说明文字在所有表面达到 AA', () => {
    const failures = buildFailures(resolveScheme(tokensCss, 'light'), '浅色');
    assert.deepEqual(failures, [], `浅色配色的对比度不达 AA：\n  ${failures.join('\n  ')}`);
});

test('深色配色：正文与说明文字在所有表面达到 AA', () => {
    const failures = buildFailures(resolveScheme(tokensCss, 'dark'), '深色');
    assert.deepEqual(failures, [], `深色配色的对比度不达 AA：\n  ${failures.join('\n  ')}`);
});

test('对比度计算与 WCAG 参考值一致', () => {
    // 黑/白 = 21:1，同色 = 1:1，中灰 #767676 on 白 ≈ 4.54:1。
    assert.equal(contrast('#000000', '#ffffff').toFixed(0), '21');
    assert.equal(contrast('#ffffff', '#ffffff').toFixed(0), '1');
    assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.02);
});
