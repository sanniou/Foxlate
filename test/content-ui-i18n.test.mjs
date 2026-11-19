import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

/**
 * 用户可见文案必须走 i18n。
 *
 * 为什么单独立一条门禁：插进宿主页面的 UI（摘要面板、提示气泡、快选面板）不在
 * `popup.html` / `options.html` 里，任何「HTML 里的文案都有翻译键」的检查都扫不到它们。
 * 实测就是这样漏掉的——中文界面下摘要消息的图标按钮对屏幕阅读器播报 `Copy`、`Retry`、
 * `Copy Error`，而旁边可见的文字是中文；这些按钮没有可见文本，`aria-label` 是它们唯一
 * 的名称，读错等于按钮没有标签。
 *
 * 只查**写死的字面量**：`browser.i18n.getMessage(...)` 的返回值、品牌名与数据属性不算。
 */

const projectRoot = path.resolve(import.meta.dirname, '..');
const CONTENT_DIR = path.join(projectRoot, 'src/content');

/** 英文文案出现在这些位置才算缺陷。 */
const PATTERNS = [
    // aria-label="Copy" / aria-label='Retry'
    { label: '硬编码 aria-label', regex: /aria-label\s*=\s*["'](?![^"']*\$\{)[A-Za-z]/ },
    // setAttribute('aria-label', 'Edit suggestion')
    { label: '硬编码 aria-label（setAttribute）', regex: /setAttribute\(\s*['"]aria-label['"]\s*,\s*['"][A-Za-z]/ },
    // title="Reload"
    { label: '硬编码 title', regex: /\btitle\s*=\s*["'](?![^"']*\$\{)[A-Za-z]/ },
    // .textContent = 'Loading…'
    { label: '硬编码可见文本', regex: /\.(?:textContent|innerText)\s*=\s*['"][A-Za-z]/ },
];

/** 不是「文案」的东西：品牌名、语言代码、图标名、键名。 */
const ALLOWED_LITERALS = [
    'Foxlate',
    'N/A',
];

async function collectJsFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectJsFiles(full));
        } else if (entry.name.endsWith('.js')) {
            files.push(full);
        }
    }
    return files;
}

test('内容脚本的控件标签与可见文本都走 i18n', async () => {
    const files = await collectJsFiles(CONTENT_DIR);
    const violations = [];

    for (const file of files) {
        const source = await readFile(file, 'utf8');
        const relative = path.relative(projectRoot, file);
        const lines = source.split('\n');

        lines.forEach((line, index) => {
            if (ALLOWED_LITERALS.some(allowed => line.includes(`'${allowed}'`) || line.includes(`"${allowed}"`))) {
                // 同一行可能既有品牌名又有一处真缺陷，所以不整行跳过，继续按模式判断。
            }
            for (const pattern of PATTERNS) {
                if (!pattern.regex.test(line)) continue;
                if (ALLOWED_LITERALS.some(allowed => line.includes(`'${allowed}'`) || line.includes(`"${allowed}"`))) continue;
                if (/getMessage/.test(line)) continue;
                violations.push(`${relative}:${index + 1} ${pattern.label} — ${line.trim().slice(0, 100)}`);
            }
        });
    }

    assert.deepEqual(violations, [], `这些用户可见文案没有走 i18n：\n  ${violations.join('\n  ')}`);
});

test('新加的消息键在两种语言里都存在且非空', async () => {
    const keys = [
        'summaryRefreshButton',
        'summarySendButton',
        'summaryCopyMessage',
        'summaryRetryMessage',
        'summaryCopyError',
        'summaryRerollMessage',
        'summaryEditMessage',
        'summarySaveEdit',
        'summaryCancelEdit',
        'summaryEditSuggestion',
    ];

    for (const locale of ['en', 'zh_CN']) {
        const messages = JSON.parse(await readFile(
            path.join(projectRoot, `public/_locales/${locale}/messages.json`),
            'utf8',
        ));
        for (const key of keys) {
            assert.ok(messages[key]?.message?.trim(), `${locale} 缺少 ${key}`);
            assert.ok(messages[key]?.description?.trim(), `${locale} 的 ${key} 缺少 description（商店审核要看）`);
        }
    }
});
