import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 文档格式门禁。
 *
 * 文档是给人和 agent 读的交付物，格式坏了不会让构建失败，因此会静默腐烂
 * （孤立表格行在 Markdown 里就是一行裸文本、未闭合代码块会把后续内容全吞进代码块）。
 * 这里只校验「坏了就一定读错」的四种形态，不涉及文风或内容。
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectDocs() {
    const out = execFileSync('find', [
        '.',
        '-name', 'node_modules', '-prune',
        '-o', '-name', '.pi', '-prune',
        '-o', '-name', 'dist', '-prune',
        '-o', '-name', '.git', '-prune',
        '-o', '(', '-name', '*.md', '-o', '-name', '*.yaml', ')', '-print',
    ], { cwd: repoRoot, encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean).sort();
}

const docs = collectDocs();

/** 每行独立判断，返回该文件的问题列表。 */
function inspect(text) {
    const lines = text.split('\n');
    const issues = [];

    // 行尾空白：恰好两个空格是 Markdown 硬换行（合法），其余是噪音。
    // 表格行里的行尾空白一定会破坏渲染，一律算错。
    const badTrail = lines.filter(line => {
        if (!line.trim()) return false;
        const match = line.match(/[ \t]+$/);
        if (!match) return false;
        return line.startsWith('|') || match[0] !== '  ';
    });
    if (badTrail.length) issues.push(`行尾空白 ${badTrail.length} 处`);

    // 孤立表格行：表格行后面必须是分隔行或另一个表格行
    const isRow = line => /^\|.*\|$/.test(line);
    const isSeparator = line => /^\|[-: |]+\|$/.test(line);
    for (let i = 0; i < lines.length; i++) {
        if (!isRow(lines[i]) || isSeparator(lines[i])) continue;
        const next = lines[i + 1] ?? '';
        const prev = lines[i - 1] ?? '';
        if (!isSeparator(next) && !isRow(prev)) {
            issues.push(`孤立表格行（第 ${i + 1} 行）`);
            break;
        }
    }

    if (/\n{4,}/.test(text)) issues.push('连续空行堆叠');

    const fences = lines.filter(line => line.trimStart().startsWith('```')).length;
    if (fences % 2) issues.push('代码块围栏未闭合');

    return issues;
}

test('仓库文档全部通过格式检查', () => {
    assert.ok(docs.length > 20, `文档数异常（${docs.length}），collectDocs 可能失效`);

    const failures = [];
    for (const file of docs) {
        const issues = inspect(readFileSync(path.join(repoRoot, file), 'utf8'));
        if (issues.length) failures.push(`${file}: ${issues.join('、')}`);
    }

    assert.deepEqual(failures, [], `文档格式问题：\n${failures.join('\n')}`);
});

test('格式检查器能捕获四种真实损坏形态', () => {
    const cases = [
        ['| a | b |\n| --- | --- |\n| 1 | 2 |   \n', '行尾空白'],
        ['正文\n\n| a | b |\n| 1 | 2 |\n', '孤立表格行'],
        ['a\n\n\n\n\nb\n', '连续空行'],
        ['```js\ncode\n', '代码块围栏未闭合'],
    ];

    for (const [text, expected] of cases) {
        const issues = inspect(text);
        assert.ok(
            issues.some(issue => issue.includes(expected)),
            `应捕获「${expected}」，实际：${JSON.stringify(issues)}`
        );
    }
});

test('恰好两个空格的硬换行不被误报', () => {
    assert.deepEqual(inspect('**A:** 1  \n**B:** 2  \n'), []);
});
