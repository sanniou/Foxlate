import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * 内容样式里的「规则合并」曾经把三个不同东西绑在一起。
 *
 * 1.7.4 去 token 化时，`.foxlate-panel, .foxlate-performance-hud, .foxlate-appended-text,
 * .foxlate-error-underline,` 这组选择器后面的纯 token 声明体被删掉，列表却留着 ——
 * 于是 CSS 解析器把它和紧随其后的 `.foxlate-panel {` 合并成一条规则：四个类共享
 * `position: fixed` / `z-index: 2147483647` / **`visibility: hidden`** / `opacity: 0`。
 *
 * 后果是真实的、而且是主功能级的：
 * - 追加显示模式下每段译文都带 `.foxlate-appended-text`，而它只有 `position`/`opacity`
 *   被后面的规则覆盖，`visibility: hidden` 没人覆盖 → **追加模式的译文完全不可见**；
 * - `.foxlate-error-underline`（替换模式的失败下划线）同样不可见；
 * - 性能浮层被拉成 fixed + 隐藏。
 *
 * 这里锁住两件事：面板的盒模型规则不得落到内联译文/下划线/浮层上；
 * `visibility: hidden` 只允许出现在面板自身的规则里。
 */

const cssPath = path.join(import.meta.dirname, '../src/content/style.css');
const css = readFileSync(cssPath, 'utf8');

/** 极简规则切分：只处理本文件用到的形态（顶层与 @media 内的规则）。 */
function parseRules(text) {
    const rules = [];
    const stack = [];
    let buffer = '';
    let depth = 0;

    for (const char of text) {
        if (char === '{') {
            const selector = buffer.trim();
            buffer = '';
            depth += 1;
            stack.push({ selector, declarations: '' });
            continue;
        }
        if (char === '}') {
            const current = stack.pop();
            depth -= 1;
            if (current && current.selector && !current.selector.startsWith('@')) {
                rules.push({ selector: current.selector, declarations: current.declarations });
            }
            buffer = '';
            continue;
        }
        if (depth > 0) {
            stack[stack.length - 1].declarations += char;
        } else {
            buffer += char;
        }
    }
    return rules;
}

const rules = parseRules(css.replace(/\/\*[\s\S]*?\*\//g, ''));

// 浮层自己确实应当是 fixed，不属于"被面板盒模型污染"的内联内容。
const INLINE_CLASSES = ['.foxlate-appended-text', '.foxlate-error-underline'];

function selectorsOf(selectorText) {
    return selectorText.split(',').map(part => part.trim()).filter(Boolean);
}

test('面板的盒模型规则不得与内联译文/下划线共用选择器', () => {
    const offenders = [];

    for (const rule of rules) {
        const selectors = selectorsOf(rule.selector);
        const hasPanelBoxModel = /position:\s*fixed/.test(rule.declarations)
            && /z-index:\s*2147483/.test(rule.declarations);
        if (!hasPanelBoxModel) continue;

        for (const selector of selectors) {
            if (INLINE_CLASSES.some(cls => selector.includes(cls))) {
                offenders.push(`{ ${rule.selector} } 同时给内联内容套上了面板盒模型`);
            }
        }
    }

    assert.deepEqual(offenders, [], `选择器列表合并：\n${offenders.join('\n')}`);
});

test('visibility: hidden 只出现在面板自身的规则里', () => {
    const offenders = [];

    for (const rule of rules) {
        if (!/visibility:\s*hidden/.test(rule.declarations)) continue;
        for (const selector of selectorsOf(rule.selector)) {
            // `.foxlate-panel.visible` 之类都是面板自己的状态类，允许。
            if (!selector.startsWith('.foxlate-panel')) {
                offenders.push(`${selector} 被设成 visibility: hidden（会被宿主页面当成"内容不存在"）`);
            }
        }
    }

    assert.deepEqual(offenders, [], `隐藏声明泄漏：\n${offenders.join('\n')}`);
});

test('summary.css 的每条规则都限定在 foxlate 作用域内（不污染宿主页面）', () => {
    const summaryCssPath = path.join(import.meta.dirname, '../src/content/summary/summary.css');
    const summaryCss = readFileSync(summaryCssPath, 'utf8');
    const summaryRules = parseRules(summaryCss.replace(/\/\*[\s\S]*?\*\//g, ''));

    // 这些通用类名（.send-button / .message-actions / .refresh-button / .suggest-button）
    // 曾经以裸选择器注入任意宿主页面：实测宿主页自己的 `.send-button` 被改成 38×38 的
    // 青色圆按钮、图标被强制白色。摘要面板的样式必须挂在 `.foxlate-summary-dialog`
    // 之下（或使用 foxlate- 前缀）。
    const ALLOWED_PREFIXES = ['.foxlate-', '@', 'from', 'to'];
    const offenders = [];

    for (const rule of summaryRules) {
        for (const selector of selectorsOf(rule.selector)) {
            if (ALLOWED_PREFIXES.some(prefix => selector.startsWith(prefix))) continue;
            if (/^\d+%$/.test(selector)) continue;
            offenders.push(selector);
        }
    }

    assert.deepEqual(offenders, [], `这些选择器会改到宿主页面：\n${offenders.join('\n')}`);
});
