/**
 * 一次性维护脚本：把 options.html / popup.html 里的内联 i18n 兜底文案
 * 与 `public/_locales/en/messages.json` 对齐，消除「同一份文案三处手写」的漂移。
 *
 * 用法：node scripts/sync-inline-i18n.mjs [--check]
 *   --check  只报告差异，不写文件（退出码 1 表示有漂移）
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const EN_MESSAGES_PATH = path.join(projectRoot, 'public/_locales/en/messages.json');
const TARGETS = [
    path.join(projectRoot, 'src/options/options.html'),
    path.join(projectRoot, 'src/popup/popup.html'),
];

const checkOnly = process.argv.includes('--check');

/** HTML 文本节点里必须转义的字符。 */
function escapeText(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 属性值里额外需要处理换行与引号。 */
function escapeAttribute(value) {
    return escapeText(value).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
}

function syncInlineText(source, messages) {
    const changes = [];
    const next = source.replace(
        /(i18n-text="([^"]+)")([^>]*)>([^<]*)(<)/g,
        (match, attrPart, key, midAttrs, inlineText, closer) => {
            const message = messages[key]?.message;
            if (message === undefined) {
                changes.push({ kind: 'missing-key', key });
                return match;
            }
            const escaped = escapeText(message);
            if (inlineText === escaped) return match;
            changes.push({ kind: 'text', key, from: inlineText, to: escaped });
            return `${attrPart}${midAttrs}>${escaped}${closer}`;
        },
    );
    return { next, changes };
}

function syncInlinePlaceholder(source, messages) {
    const changes = [];
    const next = source.replace(
        /i18n-placeholder="([^"]+)"(?!\s+placeholder=)/g,
        (match, key) => {
            const message = messages[key]?.message;
            if (message === undefined) {
                changes.push({ kind: 'missing-key', key });
                return match;
            }
            changes.push({ kind: 'placeholder', key, to: message });
            return `${match} placeholder="${escapeAttribute(message)}"`;
        },
    );

    const withExisting = next.replace(
        /(i18n-placeholder="([^"]+)"\s+placeholder=")([^"]*)(")/g,
        (match, head, key, current, tail) => {
            const message = messages[key]?.message;
            if (message === undefined) return match;
            const escaped = escapeAttribute(message);
            if (current === escaped) return match;
            changes.push({ kind: 'placeholder-update', key, from: current, to: escaped });
            return `${head}${escaped}${tail}`;
        },
    );

    return { next: withExisting, changes };
}

const messages = JSON.parse(await readFile(EN_MESSAGES_PATH, 'utf8'));
let drifted = 0;

for (const filePath of TARGETS) {
    const original = await readFile(filePath, 'utf8');
    const textResult = syncInlineText(original, messages);
    const placeholderResult = syncInlinePlaceholder(textResult.next, messages);
    const changes = [...textResult.changes, ...placeholderResult.changes];
    const relative = path.relative(projectRoot, filePath);

    if (changes.length === 0) {
        console.log(`✔ ${relative} 已与 en 词典一致`);
        continue;
    }

    drifted += changes.length;
    console.log(`✖ ${relative} 有 ${changes.length} 处漂移：`);
    for (const change of changes) {
        if (change.kind === 'missing-key') {
            console.log(`    [缺 key] ${change.key}`);
        } else if (change.kind === 'placeholder') {
            console.log(`    [补 placeholder] ${change.key} → ${JSON.stringify(change.to)}`);
        } else {
            console.log(`    [${change.kind}] ${change.key}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`);
        }
    }

    if (!checkOnly) {
        await writeFile(filePath, placeholderResult.next);
        console.log(`    → 已写入 ${relative}`);
    }
}

if (checkOnly && drifted > 0) {
    console.log(`\n内联 i18n 文案与 en 词典存在 ${drifted} 处漂移。运行 node scripts/sync-inline-i18n.mjs 修复。`);
    process.exitCode = 1;
}
