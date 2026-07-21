# e01s03 — Content 色板与 --fox-* 一致性门禁

**type:** refactor  
**risk:** P2  
**bcps:** 3  
**status:** failing  

## Context

Content 浮层 CSS（`style.css` / `enhanced-style.css` / `summary.css`）故意自包含（`--fl-*` / `--fs-*`），避免污染宿主页。色值已与 product cyan/glass 对齐，但是硬编码副本。本故事用测试锁住与 `common.css` 中 `--fox-color-*` 的关键色一致，防止再漂移。

## Requirements

#### ADDED: 设计 token 奇偶校验测试
**After:** `test/design-token-parity.test.mjs` 解析 `src/common/common.css` 的 `--fox-color-primary`、`--fox-color-accent`、`--fox-color-error`、`--fox-color-text`（及 dark 媒体查询对应值），断言 content 三份 CSS 的对应硬编码/变量初值一致。

#### MODIFIED: content 色板文档化
**Before:** 三套前缀（fl-sys / fl / fs）无正式约束。  
**After:** 各文件顶部注释「镜像 --fox-*，故意隔离不注入 common.css」；若测试发现漂移则改 content 侧对齐 fox。

## Zoom-out

| 模块 | 目的 | 调用方 | 契约 |
|------|------|--------|------|
| `common.css` | 扩展页（popup/options）token | popup/options 构建 | `--fox-*` SoT |
| content `*.css` | 注入宿主页的隔离样式 | SW inject 列表 | 不依赖宿主/common 变量 |

**不**把 `common.css` 注入 content（会污染宿主）。

## Steps

1. 写 `test/design-token-parity.test.mjs`：解析 common + content CSS，比对 light 关键色 → verify: `node --test test/design-token-parity.test.mjs`
2. 扩展比对 dark 块关键色（primary/accent/error/text） → verify: `node --test test/design-token-parity.test.mjs`
3. 修漂移 + 三文件顶部注释 → verify: `node --test test/design-token-parity.test.mjs && npm test`

## Verification Script (人工)

1. 加载扩展，打开带总结按钮的页面，确认 FAB/对话框主色仍为青系。
2. 系统切 dark，浮层仍可读、主色偏 cyan。

## Out of scope

- 合并三套 content token 前缀为一种（可后续）
- 改 popup/options 视觉
- 注入 common.css 到页面

## Risks

- CSS 解析脆弱（注释/多行）→ 用简单正则抽 `:root`/`@media` 内 `--name: value`
- 故意不同的表面色（panel 透明度）不强制 1:1，只锁 brand 关键色

## Slopcheck

无新依赖。`[OK]`
