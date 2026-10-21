# BUG-2026-10-21T102940Z: 输入框句子边界被点号和换行误判

## Problem

输入框翻译在截取“最后一句”时，把任意 `.` 和 `。` 都当成句子边界，并且不把换行当成边界。结果是：

- `Visit example.com` 在连续空格触发后只翻译 `com`，域名前缀被丢掉；
- `Price 3.14` 只翻译 `14`；
- textarea 中第二行的魔法词（如 `first line\nsecond line //fox`）无法触发，因为正则从整个多行文本开头匹配；
- textarea 末尾连续空格触发时，可能把整个多行文本提交翻译，而不是最后一行。

预期行为：`.` 只有在后面是空白或文本末尾时才作为句子边界；换行应作为输入框中的句子边界；句末只有空白时不能丢掉上一句。

## Root Cause Analysis

`src/content/input/input-text-utils.js` 的 `getLastSentence()` 使用：

```js
const lastPeriodIndex = Math.max(
    fullText.lastIndexOf('.'),
    fullText.lastIndexOf('。')
);
return { text: fullText.substring(lastPeriodIndex + 1), index: lastPeriodIndex + 1 };
```

这段实现有三个问题：

1. 没有区分 `example.com` / `3.14` / `v1.2.3` 中的点号和真正的句末点号；
2. 没有处理 `\n`，textarea 的多行文本会被当成一整句；
3. 句号后只剩触发空格时返回空字符串，导致 `Hello.  ` 无法翻译。

## Fix

- 新增 `isSentenceBoundary()`：`.` / `!` / `?` 仅在后接空白或文本末尾时算边界；`。` / `！` / `？` / `\n` 始终算边界。
- `getLastSentence()` 先从末尾去掉触发空格，再扫描边界；只选择“边界后确实还有正文”的最后一个边界，避免句末标点导致空结果。
- 保留原返回契约 `{ text, index }`，调用方无需改动。

## Verification Evidence

- 新增 `getLastSentence` 单元用例：域名、小数、句末标点、换行、`?` 结尾。
- 新增输入处理器事件级用例：连续空格翻译保留 `Visit example.com`；textarea 最后一行连续空格只翻译 `second line`；第二行魔法词可触发。
- `node --test test/content-feature-modules.test.mjs test/input-handler.test.mjs`：20 passed，0 failed。
- `npm test`：389 passed，0 failed。
- `npm run build:firefox` / `npm run build:chrome`：均通过。

## Acceptance Criteria

- [x] 域名、小数、版本号中的点号不会切断句子。
- [x] 换行在 textarea 中作为句子边界。
- [x] 句末只有触发空格时保留上一句，不返回空文本。
- [x] 连续空格触发和魔法词触发都使用修正后的边界。
- [x] 全量测试与双平台构建通过。
