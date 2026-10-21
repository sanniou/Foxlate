import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const projectRoot = path.resolve(import.meta.dirname, '..');
const localesDir = path.join(projectRoot, 'public/_locales');

const readMessages = (locale) => JSON.parse(
    fs.readFileSync(path.join(localesDir, locale, 'messages.json'), 'utf8'),
);

const enMessages = readMessages('en');
const zhMessages = readMessages('zh_CN');

function walkFiles(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(fullPath));
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

/**
 * 取出每个 `getMessage(...)` 调用的第一个实参。
 * 只解析第一个实参，避免把 `getMessage('key', ['source', 'auto'])` 里的取值当成 key。
 */
function firstArgumentsOfGetMessage(source) {
    const args = [];
    const marker = 'getMessage(';
    let index = source.indexOf(marker);

    while (index !== -1) {
        let depth = 0;
        let cursor = index + marker.length - 1;
        for (; cursor < source.length; cursor += 1) {
            const char = source[cursor];
            if (char === '(') depth += 1;
            else if (char === ')') {
                depth -= 1;
                if (depth === 0) break;
            }
        }

        const argumentList = source.slice(index + marker.length, cursor);
        let level = 0;
        let end = argumentList.length;
        let quote = null;
        for (let i = 0; i < argumentList.length; i += 1) {
            const char = argumentList[i];
            if (quote) {
                if (char === quote && argumentList[i - 1] !== '\\') quote = null;
                continue;
            }
            if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
            if (char === '(' || char === '[' || char === '{') level += 1;
            else if (char === ')' || char === ']' || char === '}') level -= 1;
            else if (char === ',' && level === 0) { end = i; break; }
        }

        args.push(argumentList.slice(0, end));
        index = source.indexOf(marker, cursor);
    }

    return args;
}

/**
 * 从第一个实参里挑出字面量 key。
 * `Constants.SUPPORTED_LANGUAGES['auto']` 这类映射下标要排除 —— 它们的值由映射表本身覆盖。
 */
function literalKeysIn(argument) {
    // 去掉 `type === 'source'` 这类比较运算的操作数，它们不是 key。
    const comparable = argument.replace(/[=!]==?\s*'[^']*'/g, '');
    const keys = [];
    for (const match of comparable.matchAll(/'([A-Za-z][A-Za-z0-9_]*)'/g)) {
        const previous = comparable[match.index - 1];
        if (previous === '[' || previous === '.') continue;
        keys.push(match[1]);
    }
    return keys;
}

async function loadConstantMaps() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'foxlate-i18n-'));
    const entryPath = path.join(tempDir, 'entry.js');
    const outputPath = path.join(tempDir, 'bundle.mjs');

    await writeFile(entryPath, `export * from ${JSON.stringify(path.join(projectRoot, 'src/common/constants.js'))};`);
    await build({
        entryPoints: [entryPath],
        outfile: outputPath,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
    });

    const constants = await import(pathToFileURL(outputPath).href);
    await rm(tempDir, { recursive: true, force: true });
    return constants;
}

/** 这些映射表的值会被 `i18n.getMessage(map[value])` 动态解析。 */
const DYNAMIC_KEY_MAPS = [
    'SUPPORTED_LANGUAGES',
    'SUPPORTED_ENGINES',
    'DISPLAY_MODES',
    'AUTO_TRANSLATE_MODES',
    'SUBTITLE_DISPLAY_MODES',
];

function collectDynamicKeys(constants) {
    const keys = new Set();
    for (const mapName of DYNAMIC_KEY_MAPS) {
        const map = constants[mapName];
        assert.ok(map, `constants.js 应导出映射表 ${mapName}`);
        for (const value of Object.values(map)) {
            if (typeof value === 'string') keys.add(value);
            else if (value && typeof value === 'object') {
                for (const nested of Object.values(value)) {
                    if (typeof nested === 'string') keys.add(nested);
                }
            }
        }
    }
    return keys;
}

/**
 * 扫出源码真正引用的所有 i18n key。
 * 覆盖四条通路：
 *  1. `i18n.getMessage()` 第一实参里的字面量（含三元表达式两侧）
 *  2. 转发到 `getMessage` 的配置项：labelKey / errorKey / messageKey / optionsKey
 *  3. HTML 的 `i18n-text` / `i18n-placeholder` / `i18n-aria-label` / `i18n-title` 属性
 *  4. manifest 的 `__MSG_key__` 占位符
 */
function collectSourceKeys() {
    const keys = new Map();
    const add = (key, file) => {
        if (!keys.has(key)) keys.set(key, new Set());
        keys.get(key).add(path.relative(projectRoot, file));
    };

    for (const file of walkFiles(path.join(projectRoot, 'src'))) {
        const source = fs.readFileSync(file, 'utf8');

        if (file.endsWith('.js')) {
            if (source.includes('getMessage')) {
                for (const argument of firstArgumentsOfGetMessage(source)) {
                    for (const key of literalKeysIn(argument)) add(key, file);
                }
                for (const match of source.matchAll(/\b(?:labelKey|errorKey|messageKey|optionsKey|popupKey)\s*:\s*'([A-Za-z0-9_]+)'/g)) {
                    add(match[1], file);
                }
                for (const match of source.matchAll(/_getErrorMessage\([^,]+,\s*'([A-Za-z0-9_]+)'\)/g)) {
                    add(match[1], file);
                }
            }
        } else if (file.endsWith('.html')) {
            for (const match of source.matchAll(/i18n-(?:text|placeholder|aria-label|title)="([A-Za-z0-9_]+)"/g)) {
                add(match[1], file);
            }
        }
    }

    // manifest 模板不在 src/ 下，单独扫一遍。
    const manifestBase = path.join(projectRoot, 'public/manifest.base.json');
    const manifestSource = fs.readFileSync(manifestBase, 'utf8');
    for (const match of manifestSource.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) {
        add(match[1], manifestBase);
    }

    return keys;
}

test('每种语言的 messages.json 定义了完全相同的 key 集合', () => {
    const enKeys = Object.keys(enMessages).sort();
    const zhKeys = Object.keys(zhMessages).sort();

    const missingInZh = enKeys.filter((key) => !(key in zhMessages));
    const missingInEn = zhKeys.filter((key) => !(key in enMessages));

    assert.deepEqual(missingInZh, [], `zh_CN 缺少 en 中定义的 key: ${missingInZh.join(', ')}`);
    assert.deepEqual(missingInEn, [], `en 缺少 zh_CN 中定义的 key: ${missingInEn.join(', ')}`);
});

test('源码引用的每个 i18n key 都在 en 与 zh_CN 中存在', async () => {
    const constants = await loadConstantMaps();
    const referenced = new Set([...collectSourceKeys().keys(), ...collectDynamicKeys(constants)]);

    const missingInEn = [...referenced].filter((key) => !(key in enMessages)).sort();
    const missingInZh = [...referenced].filter((key) => !(key in zhMessages)).sort();

    assert.deepEqual(missingInEn, [], `源码引用了 en 未定义的 key（会渲染成空字符串）: ${missingInEn.join(', ')}`);
    assert.deepEqual(missingInZh, [], `源码引用了 zh_CN 未定义的 key（会渲染成空字符串）: ${missingInZh.join(', ')}`);
});

test('两种语言都没有源码从未引用的死 key', async () => {
    const constants = await loadConstantMaps();
    const referenced = new Set([...collectSourceKeys().keys(), ...collectDynamicKeys(constants)]);

    const orphanedInEn = Object.keys(enMessages).filter((key) => !referenced.has(key)).sort();
    const orphanedInZh = Object.keys(zhMessages).filter((key) => !referenced.has(key)).sort();

    assert.deepEqual(orphanedInEn, [], `en 中存在无引用的 key: ${orphanedInEn.join(', ')}`);
    assert.deepEqual(orphanedInZh, [], `zh_CN 中存在无引用的 key: ${orphanedInZh.join(', ')}`);
});

test('带占位符的消息不使用 $1..$9 之外的引用', () => {
    const offenders = [];
    for (const [locale, messages] of [['en', enMessages], ['zh_CN', zhMessages]]) {
        for (const [key, entry] of Object.entries(messages)) {
            for (const match of (entry.message ?? '').matchAll(/\$(\d+)/g)) {
                if (Number(match[1]) < 1 || Number(match[1]) > 9) offenders.push(`${locale}:${key}`);
            }
        }
    }
    assert.deepEqual(offenders, [], `占位符编号越界: ${offenders.join(', ')}`);
});

// --- 内联文案与词典的一致性 ------------------------------------------------
//
// options.html / popup.html 里每个 i18n 标记都自带一份英文兜底文案，
// 这是同一句话的第三份手写副本，极易与词典漂移。这里把「必须一致」
// 变成门禁；改文案时用 `node scripts/sync-inline-i18n.mjs` 一次性回写。

const INLINE_HTML_FILES = [
    'src/options/options.html',
    'src/popup/popup.html',
];

/** 解码 HTML 实体并把空白折叠成单空格，便于与词典做宽松比较。 */
function normalizeInlineText(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#10;/g, '\n')
        .replace(/\s+/g, ' ')
        .trim();
}

test('内联 i18n-text 文案与 en 词典逐字一致，且目标节点不含子元素', async () => {
    const mismatches = [];

    for (const relativePath of INLINE_HTML_FILES) {
        const html = await readFile(path.join(projectRoot, relativePath), 'utf8');

        for (const match of html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\bi18n-text="([^"]+)"[^>]*>([^<]*)</g)) {
            const [, tagName, key, inlineText] = match;
            const expected = enMessages[key]?.message;

            if (expected === undefined) {
                mismatches.push(`${relativePath}: ${key} 在 en 词典中不存在`);
                continue;
            }

            if (normalizeInlineText(inlineText) !== normalizeInlineText(expected)) {
                mismatches.push(
                    `${relativePath}: <${tagName} i18n-text="${key}"> 内联文案 "${normalizeInlineText(inlineText)}" `
                    + `与 en 词典 "${normalizeInlineText(expected)}" 不一致`,
                );
            }

            // 文案必须落在叶子节点上：带子元素的节点在运行时写入 textContent 会清掉子结构。
            const elementPattern = new RegExp(
                `(<${tagName}\\b[^>]*\\bi18n-text="${key}"[^>]*>)([^<]*)</${tagName}>`,
            );
            if (!elementPattern.test(html)) {
                mismatches.push(`${relativePath}: i18n-text="${key}" 所在的 <${tagName}> 不是叶子节点（内含子元素）`);
            }
        }
    }

    assert.deepEqual(mismatches, [], `${mismatches.join('\n')}\n修复：node scripts/sync-inline-i18n.mjs`);
});

test('内联 i18n-placeholder 元素都带有与 en 词典一致的 placeholder 属性', async () => {
    const failures = [];

    for (const relativePath of INLINE_HTML_FILES) {
        const html = await readFile(path.join(projectRoot, relativePath), 'utf8');

        for (const match of html.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*\bi18n-placeholder="([^"]+)"([^>]*)>/g)) {
            const [, tagName, key, trailingAttributes] = match;
            const expected = enMessages[key]?.message;

            if (expected === undefined) {
                failures.push(`${relativePath}: ${key} 在 en 词典中不存在`);
                continue;
            }

            const placeholderMatch = trailingAttributes.match(/\bplaceholder="([^"]*)"/);
            if (!placeholderMatch) {
                failures.push(`${relativePath}: <${tagName} i18n-placeholder="${key}"> 缺少 placeholder 兜底属性`);
                continue;
            }

            if (normalizeInlineText(placeholderMatch[1]) !== normalizeInlineText(expected)) {
                failures.push(
                    `${relativePath}: i18n-placeholder="${key}" 的兜底文案 `
                    + `"${normalizeInlineText(placeholderMatch[1])}" 与 en 词典 "${normalizeInlineText(expected)}" 不一致`,
                );
            }
        }
    }

    assert.deepEqual(failures, [], `${failures.join('\n')}\n修复：node scripts/sync-inline-i18n.mjs`);
});

test('内联 i18n 标记应用的 key 都真实存在（无拼写漂移）', async () => {
    const missing = [];

    for (const relativePath of INLINE_HTML_FILES) {
        const html = await readFile(path.join(projectRoot, relativePath), 'utf8');
        for (const match of html.matchAll(/\bi18n-(?:text|placeholder|aria-label|title)="([^"]+)"/g)) {
            const key = match[1];
            if (!(key in enMessages)) missing.push(`${relativePath}: ${key}`);
            if (!(key in zhMessages)) missing.push(`${relativePath}: ${key} (zh_CN 缺失)`);
        }
    }

    assert.deepEqual(missing, [], `内联标记引用了不存在的 key：${missing.join(', ')}`);
});

test('静态 aria-label / title 一律走 i18n 标记，且兜底文案与 en 词典一致', async () => {
    // 这两个属性决定读屏怎么念控件、鼠标悬停显示什么提示。
    // 写死英文的后果是：中文界面上齿轮按钮被读成 "Settings"——不会被任何现有门禁拦住。
    const failures = [];
    const LOCALIZABLE = [
        { attribute: 'aria-label', marker: 'i18n-aria-label' },
        { attribute: 'title', marker: 'i18n-title' },
    ];

    for (const relativePath of INLINE_HTML_FILES) {
        const html = await readFile(path.join(projectRoot, relativePath), 'utf8');

        for (const match of html.matchAll(/<[a-zA-Z][\w-]*\b[^>]*>/g)) {
            const tag = match[0];
            for (const { attribute, marker } of LOCALIZABLE) {
                const value = tag.match(new RegExp(`(?<!i18n-)${attribute}="([^"]*)"`))?.[1];
                if (value === undefined) continue;

                const markerKey = tag.match(new RegExp(`\\b${marker}="([^"]+)"`))?.[1];
                if (!markerKey) {
                    failures.push(`${relativePath}: ${attribute}="${value}" 没有配对的 ${marker}，会永远是英文`);
                    continue;
                }

                const expected = enMessages[markerKey]?.message;
                if (expected === undefined) {
                    failures.push(`${relativePath}: ${marker}="${markerKey}" 在 en 词典中不存在`);
                } else if (normalizeInlineText(value) !== normalizeInlineText(expected)) {
                    failures.push(
                        `${relativePath}: ${marker}="${markerKey}" 的兜底文案 "${normalizeInlineText(value)}" `
                        + `与 en 词典 "${normalizeInlineText(expected)}" 不一致`,
                    );
                }
            }
        }
    }

    assert.deepEqual(failures, [], failures.join('\n'));
});

/** 取出 `.apiName(` 调用点的括号内实参文本（含嵌套括号）。 */
/** 找出 `marker` 的全部调用点，返回括号内实参的起止下标（自动匹配嵌套括号）。 */
function callRegions(source, marker) {
    const regions = [];
    let index = source.indexOf(marker);

    while (index !== -1) {
        const start = index + marker.length;
        let depth = 0;
        let cursor = index + marker.length - 1;
        for (; cursor < source.length; cursor += 1) {
            const char = source[cursor];
            if (char === '(') depth += 1;
            else if (char === ')') {
                depth -= 1;
                if (depth === 0) break;
            }
        }
        regions.push({ start, end: cursor, text: source.slice(start, cursor) });
        index = source.indexOf(marker, cursor);
    }

    return regions;
}

/**
 * 把 `getMessage(...)` 的实参挖空。
 *
 * i18n key 本身就是拉丁字母字符串（`'subtitleToolbarTitleEnabled'`），如果不先剔除，
 * 正确写法反而会被判为「写死文案」。
 */
function withoutGetMessageCalls(source) {
    const regions = callRegions(source, 'getMessage(');
    if (regions.length === 0) return source;

    let result = '';
    let lastEnd = 0;
    for (const { start, end } of regions) {
        result += source.slice(lastEnd, start);
        lastEnd = end;
    }
    return result + source.slice(lastEnd);
}

test('运行时传给浏览器 UI 的文案必须走本地化，不得写死字面量', async () => {
    // 静态 HTML 的 aria-label/title 已有门禁，但**运行时**写进浏览器界面（工具栏图标提示、
    // 徽标文字）的文案没有任何门禁。曾经的漏洞：字幕开关把
    // 'Foxlate (Subtitles Enabled)' 写死在 `action.setTitle` 里，中文界面下悬停图标
    // 永远显示英文，而全部既有门禁都放行。
    //
    // 判定范围限定在「属性名之后」，避免把同一对象里的 `path: 'icons/…'` 误报；
    // 再剔除 getMessage(...) 的实参，避免把正确的 i18n key 误报。
    const LOCALIZABLE = [
        { api: 'setTitle', property: 'title' },
        { api: 'setBadgeText', property: 'text' },
    ];

    const failures = [];
    let scannedCallSites = 0;

    for (const file of walkFiles(path.join(projectRoot, 'src'))) {
        if (!file.endsWith('.js') || file.includes(`${path.sep}lib${path.sep}`)) continue;
        const relativePath = path.relative(projectRoot, file);
        const source = await readFile(file, 'utf8');

        for (const { api, property } of LOCALIZABLE) {
            for (const region of callRegions(source, `.${api}(`)) {
                scannedCallSites += 1;
                const cleaned = withoutGetMessageCalls(region.text);
                const propertyIndex = cleaned.search(new RegExp(`\\b${property}\\s*:`));
                if (propertyIndex === -1) continue;

                for (const match of cleaned.slice(propertyIndex).matchAll(/'([^']*)'|"([^"]*)"/g)) {
                    const literal = match[1] ?? match[2];
                    if (/[A-Za-z]/.test(literal)) {
                        failures.push(`${relativePath}: ${api} 的 ${property} 写死了文案 ${JSON.stringify(literal)}`);
                    }
                }
            }
        }
    }

    assert.ok(scannedCallSites > 0, '没有扫描到任何 setTitle/setBadgeText 调用点，门禁已失效');
    assert.deepEqual(failures, [], failures.join('\n'));
});
