# Foxlate UI 设计方向 — 1.7.x

**已实施**：P1–P4 全部随 1.6.3–1.7.0 发布（calm chrome → options 外壳 → summary/enhanced → dark-mode + a11y）。
本文件记录的是**方向与理由**，不是待办清单。当前实现基线见
`specs/verifications/full-refactor-review-1.7.4.md` 第 1 节与第 4 节。

## 北极星

> **日常翻译工具，不是玻璃拟态演示。**
> 安静的表面、单一强调色（cyan）、零竞争性渐变、宿主页面始终是主体。

## 保留

| 保留 | 理由 |
|------|------|
| `--fox-*` 令牌名 + 语义 `--color-*` 别名 | 1.6.0 起即为在线系统；一致性门禁依赖它 |
| 内容侧隔离（`--fl-*` / `--fs-*`，不向宿主页注入 `common.css`） | 宿主安全 |
| 语义类名：`.btn` `.card` `.form-control` `.switch` `.segmented` | 约定 |
| soft append/hover + 主题化加载指示（1.6.3） | 刚修好 |
| Popup 信息架构：语言 → 翻译 → 引擎/模式 → 开关 → 页脚 | 可用 |

## 改变

| 表面 | 从 | 到 |
|------|-----|-----|
| **Popup** | 多层渐变背景、重模糊卡片、处处悬浮上抬 | 平/柔实色面板、更密间距、单一主 CTA |
| **Options** | 渐变洗底 + 模糊侧栏/卡片 | 安静的 app shell；侧栏实色；卡片 1px 边框 |
| **浮层**（tooltip / 快捷操作 / summary） | 强玻璃 + 品牌渐变芯片 | 共享面板配方：近实色表面、细边框、小阴影 |
| **主操作** | 全品牌彩虹渐变 | 实色主色（cyan）；渐变仅用于罕见品牌时刻 |
| **动效** | 大量行级 `translateY` 悬浮 | 仅焦点/边框；reduced-motion 一等公民 |
| **密度** | 高开关（62px）、过宽间距 | 紧凑行；popup 目标宽 ~360–380 |

## 明确不做

- 重做 pre-1.6.0 的 indigo MD3 设计方向（草案已删除，不得重建）
- 在 `--fox-*` 之外新增第二套令牌体系
- 用 Lit 重写 popup/options
- R3 差异化能力的 UI（独立面板）—— 属独立史诗
- PDF / 商店上架视觉

## 面板配方（共享契约）

```
surface:  实色或 94% 不透明面板（不是多层玻璃堆叠）
border:   1px --color-border
radius:   --radius-md (10–12)
shadow:   仅浮在宿主页面上时用 --shadow-sm
accent:   选中/CTA 用主色 cyan；不用彩虹填充
type:     系统字体栈（ui-sans-serif/system-ui/…）；次级 12–13px 弱化
```

`prefers-reduced-transparency: reduce` 时该配方自动退化为纯实色（由 `src/common/tokens.css` 完成，组件无需知道）。
