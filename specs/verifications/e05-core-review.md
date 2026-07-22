# e05 Core Review — 选择器 / 规则 / 显示模式 / 面板

**Date:** 2026-07-22  
**Branch:** feat/e05-mode-switch-and-soft-display

## 1. 代码评审（选择器 + 规则）

| 区域 | 评价 | 问题 | 处理 |
|------|------|------|------|
| `DEFAULT_TRANSLATION_CONTENT/EXCLUDE` | 好 | 老站点无 main/article | 已有 FALLBACK（1.6.2） |
| `findTranslatableElements` | 中 | `__skipFallback` 是内部脏标记 | 可接受；后续可改 options 对象 |
| `DOMWalker.exclude` | 好 | 无效 exclude 只 log 继续 | OK |
| `resolveEffectiveSettings` | **弱** | 扁平 `...domainRule` 可覆盖嵌套字段；`cssSelector` 与全局 `translationSelector.default` 两套命名 | 文档缺口；未本轮大改 |
| `findMatchingDomainRule` | 好 | 最长后缀匹配 | OK |
| `precheck` 内置 | 好 | 文档曾漂移 | 1.6.2 已对齐 |
| `SETTINGS_UPDATED` 路径 | **P0 bug** | 把 **全局 raw** settings 写进 page job，冲掉 effective + 盖掉模式切换 | **本轮已修**：始终 `getEffectiveSettings()` |

### 规则层建议（backlog，非本轮）

- 显式 domain rule schema（可覆盖键白名单）
- `cssSelector` 与 `translationSelector` 命名统一
- 无效 content selector 时用户可见 toast

## 2. Bug：append → 其他模式无响应

**根因（两层）：**

1. Popup 先发 `UPDATE_DISPLAY_MODE`（正确），随后 storage 触发 `SETTINGS_UPDATED`，content 用 **全局 raw**（常为旧 `append` 或缺 effective 形状）覆盖 `currentPageJob.settings` 并再次 `updateDisplayMode`，把刚切好的模式打回或弄脏。
2. `updateElementUI` 是 **async**，但 `setElementState` / `updateDisplayMode` **不 await**，竞态下 UI 可能未画完。

**修复：**

- `handleSettingsUpdated` → 只应用 `await getEffectiveSettings()`
- `displayLoading/Translation/Error` + `updateDisplayMode` 返回/await UI promise
- 模式切换时对 ERROR 态也 re-skin；离开 replace 时防御性恢复 `originalContent`

**测试：** `test/display-mode-switch.test.mjs`（3）

## 3. UI：append / hover 自然融入

| 模式 | 改前 | 改后 |
|------|------|------|
| append inline | 主色加粗 + 色条 | 继承宿主字体/颜色，间隔点 `·`，opacity ~0.88 |
| append block | 卡片边框阴影背景 + minHeight | 仅左侧细线，透明底，无 minHeight |
| hover | 渐变底 + 阴影 + padding | 点状下划线，无填充 |
| loading hover | 虚线框填充 | 虚线下划线 + 降透明 |

## 4. 其它交互 / 代码问题（发现清单）

| # | 严重度 | 问题 | 状态 |
|---|--------|------|------|
| 1 | P0 | 模式切换被 SETTINGS_UPDATED 冲掉 | **已修** |
| 2 | P1 | async UI 不 await | **已修** |
| 3 | P1 | append/hover 视觉侵入 | **已修（软化）** |
| 4 | P2 | 域名规则扁平 merge / 双命名 selector | backlog |
| 5 | P2 | 三入口选区仍并存（仅提示） | backlog |
| 6 | P3 | replace loading spinner 仍略吵 | backlog |
| 7 | P3 | 空 fallback 无用户提示 | backlog e05 optional |

## 5. 验证

- `node --test test/display-mode-switch.test.mjs`
- `npm test`（全量）
