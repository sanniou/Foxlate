# UI/UX/动效评审（1.7.8）

审计对象：`main` @ `3e080a5`（1.7.8）。范围：`src/common/{tokens,common}.css`、`src/content/{style,enhanced-style,control-reset}.css`、`src/content/summary/summary.css`、`src/popup/*`、`src/options/*`、内容侧全部 view 文件。

**方法（避免"看起来还行"）**

1. 静态：脚本扫描 8 个 CSS 文件共 1103 条声明，按属性族判定"走 token / 写字面量"，产出带行号的清单（B 节）。JS 侧统计 `var(--fox-*)` 读者数（C 节）。
2. 渲染：`dist/` 与 `src/` 逐文件 `diff` 一致后，用 `python3 -m http.server` 服务 `dist/`，Chromium 打开 popup/options 取 `getComputedStyle` 与几何（不是截图）。另建最小宿主页（只挂 `tokens.css` + `style.css` + `enhanced-style.css` + `control-reset.css` + `summary.css`）复现内容侧浮层与宿主样式泄漏。
3. 对比度：按 `tokens.css` 取值与 WCAG 相对亮度公式计算，含半透明叠底合成。

**未在浏览器中核验的项（如实标注）**

- 焦点环的**像素**：headless 窗口 `document.hasFocus() === false`，`:focus` 不匹配，只能读声明值（`!important` 转述为计算值）。焦点环结论来自 CSS 声明 + 颜色合成计算，不是取色。
- 深色模式渲染：`agent_browser` 无 media emulate 命令，深色结论来自 `tokens.css` 深色块取值计算。
- JS 驱动的状态（保存中/成功、选择器增强后的下拉、AI 模态）：静态渲染时 `browser.*` 不可用，JS 未执行。相关结论为代码阅读结论，已逐条标注。
- 真扩展上下文（i18n 注入、popup 实际宽高由浏览器决定）：未核验。

---

## 结论摘要

1. **一行退化选择器让三个内容表面错位（P0，已渲染复现，最严重）。** `src/content/style.css:8-13` 是 `.foxlate-panel, .foxlate-performance-hud, .foxlate-appended-text, .foxlate-error-underline,` 后面直接跟着重复的 `.foxlate-panel {` —— 四个选择器共享 `.foxlate-panel` 的整套声明（`visibility: hidden`、`position: fixed`、`z-index: 2147483647`、`padding: 11px 13px`、`border: 1px`、`background: var(--fox-color-panel)`、`box-shadow: var(--fox-shadow-popover)`、`max-width: 360px`）。只有 `.foxlate-panel` 自己用 `.visible { visibility: visible }` 解除了隐藏，其余三个没有：
   - `.foxlate-appended-text`（追加模式的每一段译文，`append-strategy.js:34` 无条件带上这个类）→ 计算值 `visibility: hidden`，**追加显示模式完全看不到译文**；
   - `.foxlate-performance-hud` → 计算值 `visibility: hidden`，`.visible` 只改 opacity/transform，**HUD 永不出现**；
   - `.foxlate-error-underline`（`replace-strategy.js:85`，翻译失败的段落）→ 计算值 `position: fixed; display: block; padding: 11px 13px; border: 1px; background: rgb(255,255,255); box-shadow: 0 8px 24px -10px; z-index: 2147483647`，实测一个内联 `<span>` 被拔成 105×44 的白底浮卡，**每一段失败都会在页面上多开一张卡**。
   根因（`git show 38d1d36 -- src/content/style.css`）：这个 5 选择器组原本的声明体**只有 `--fl-sys-*` 私有 token，没有任何布局属性**。1.7.4 清理把 token 声明删掉后，选择器列表直接“粘”上了紧跟其后的 `.foxlate-panel {`，于是一次「删 token」静默改写了四条的层叠。删 token 的那道门禁（`test/design-system.test.mjs` “内容侧 CSS 不再定义任何 token”）本身就是肇事者：它要求删声明，但没有规定删完后选择器列表该怎么办。
2. **两个内容浮层丢了盒模型（P0，已渲染复现）。** `.foxlate-summary-dialog` 与 `.foxlate-enhanced-panel` 在 `src/` 中**没有任何规则声明 `position` / `z-index` / `background` / `border` / `border-radius` / `box-shadow`**。实测计算值：`position: static`、`background: rgba(0,0,0,0)`、`border-radius: 0`、`box-shadow: none`、`z-index: auto`、`font-family: system-ui`（继承宿主）。也就是说 AI 摘要面板与增强悬浮提示不是浮层，而是追加到 `</body>` 前的**透明无边框静态块**。根因可定位：`git show 08db268:src/content/summary/summary.css` 的 `.foxlate-summary-dialog` 块里 `position: fixed; … z-index: 2147483641; display: flex` 与 `--fs-*` 私有 token 写在同一个规则块内，token 清理把整块删掉了。
3. **`summary.css` 往宿主页面泄漏 6 个通用类名 / 20 条规则（P0，已渲染复现）。** `.send-button`、`.refresh-button`、`.suggest-button`、`.message-actions`、`.loading-indicator`、`.message-edit-area` 均为全局选择器。最小宿主页实测：宿主自己的 `.send-button` 被改成 `38×38`、`border-radius: 12px`、`background: rgb(14,116,144)`、`padding: 0`、图标 `fill: #fff`。开了摘要的站点，页面自己的发送按钮会变成青色圆形。
4. **焦点环 1.21–1.50:1，没有一个焦点态达到 3:1（P0/P1）。** 全站 8 处自定义焦点样式里 6 处用 `box-shadow: 0 0 0 Npx color-mix(in srgb, §focus 14~28%, transparent)`：`#0891b2 24%` 在白底 = **1.33:1**，`#0e7490 14%` = **1.21:1**，16% = **1.25:1**；另外 2 处（`.lang-select`、`.themed-select-option`）位于 `@media (hover: hover)` 内且写了 `outline: 0`。`test/design-contrast.test.mjs` 校验的是 `--fox-color-focus` 原值（3.68:1，通过），但**没有任何组件把原值当环色用**。
5. **间距刻度与真实节奏不兼容（P1）。** 197 条 padding/margin/gap 里只有 **5 条**引用 `var(--space-*)` / `var(--fox-space-*)`，**87 条**落在 `{4,8,12,16,24,32}` 之外，且最常用的是 10px / 6px / 14px —— 刻度里根本没有这三档。组件在用字面量"绕过"刻度，说明刻度错了而不是组件错了。
6. **状态机存在，视觉层不存在（P1）。** `#saveSettingsBtn` 有 `data-state="loading/success/error"` 三态赋值（`options-actions.js:98,110,115,122`），全仓库**没有一条 `#saveSettingsBtn[data-state]` 规则**。同一按钮还缺 `.btn` 类（`options.html:343` 只有 `class="toast btn-primary"`），于是没有按压反馈、没有 `:disabled`、没有焦点环。
7. **`--fox-leading-relaxed` 是幽灵 token（P1）。** `enhanced-style.css:155` 与 `summary.css:371` 引用，`tokens.css` 从未定义；来源是 `38d1d36` 那次机械替换。实测该声明在计算值阶段失效并回退为 `inherit`：`.foxlate-text-content` 的 `line-height` 计算值为 `normal`（继承宿主），摘要气泡则靠父级 `line-height: 1.55` 才没崩。
8. **`aria-live` 全仓库 0 处。** 保存、导入、导出、清缓存、刷新数据、引擎测试、AI 流式回答，对读屏用户全部静默（D 节矩阵）。

---

## A. 信息架构（含重新设计的线框描述）

### A.1 popup 首屏：用户想要什么 vs 界面在问什么

打开 popup 的唯一高频意图是"把这一页翻了"。现状首屏（352px 宽，实测内容高 ≈ 493px）按视觉权重排序是：语言对卡片（白底 + 1px 边框，首屏最重的容器）→ 主 CTA（44px）→ 10.5px 入口提示 → "一个控制面板"（引擎、显示模式、2 个开关，4 个决策项，占 213px ≈ 首屏 43%）。

问题不在"4 个控制项"，而在**它们与主任务的权重相同**：`.control-surface`（`popup.css:181-189`）与 `.lang-selector`（`:65-76`）都是 `border: 1px solid var(--color-border)` + `border-radius: var(--radius-md)` + `--color-surface-raised`，也就是说"我要翻译"和"我要改引擎 URL 之外的设置"在视觉上是同级卡片。用户每次开 popup 都要重新扫过 4 个决策项才能确认"点哪个"。

第二个问题是**站点语境被藏在页脚**。`#currentRuleIndicator`（`popup.html:91`）是 `10px`、`--color-text-muted`、位于最底部，而"这条规则属于哪个站点"恰恰是 popup 存在的理由（options 是全局的，popup 是站点局部的）。实测该文案字号 10px（`popup.css:366`），是全 popup 最小的一行。

### A.2 首次使用 → 成功翻译一页：步数与断点

默认值 `translatorEngine: 'google'`、`targetLanguage: 'ZH'`、`displayMode: 'replace'`（`constants.js:49-53`），所以最短路径是 **2 步**：装完 → 点扩展图标 → 点"翻译此页"。这是好的。

断点清单（按出现概率排序）：

| # | 断点 | 现状 | 用户看到什么 |
|---|---|---|---|
| 1 | `chrome://` / `about:` / 扩展安装页 | `getHostname()` 只认 `http`（`popup-actions.js:16-21`），`setPageControlsEnabled(false, false)` 把 6 个控件全禁用 | 6 个灰控件 + 主按钮灰（`opacity: 0.55`），**没有任何文字说明为什么**。错误区只在 content-script 通信失败时才写（`popup-actions.js:114-124`），此路径不触发 |
| 2 | 内容脚本未注入 | `Receiving end does not exist` → `popupTranslationNotAvailable` | 只有一句"此页面不支持翻译。"，无"重试/刷新"动作 |
| 3 | 引擎是 AI 但没配 | `aiApiKeyMissingError` 在背景层抛出 | popup 只有 `Error: <message>` 或引擎自述，没有"去设置"按钮（`popup-actions.js:122` 直接把 `error.message` 拼进 alert） |
| 4 | 页面无可译文本 | `popupEmptyCandidates` | 提示语正确，但出口是"去 options 调整选择器"，没有直达链接 |
| 5 | 首次保存站点规则 | 任一控件改动即写 `domainRules`，页脚从"正在使用默认设置"变成"站点 · example.com" | 无"已为此站点保存"的确认反馈，只有页脚 10px 文字变化 |

第 1、3 两条是真实的流失点：**禁用态没有解释，错误态没有出口**。

### A.3 popup 重新设计（线框）

目标：首屏只留 1 个决策（点不点），把"配置"降级为可展开的第二层，把站点语境提到首屏第一行。

```
┌────────────────────────────────────────┐  352px
│  Foxlate · example.com          [⚙]    │  ← 站点名 13px/–snug；无站点时显示「此页面不可用」
├────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  │
│  │            翻译此页               │  │  ← 56px，唯一实色块（--color-primary）
│  └──────────────────────────────────┘  │     状态：翻译中 → 进度环 + 「翻译中 12/48」
│  EN → 中文 · 替换 · Google      [⌄]   │  ← 12px 摘要行，点击就地展开语言/模式选择
│                                        │
│  ▸ 此站点的翻译设置                    │  ← 折叠（默认收起）：自动翻译、滚动后翻译
│  ▸ 高级                                │  ← 折叠：引擎选择、内容选择器入口
├────────────────────────────────────────┤
│  术语表 3 条 · v1.7.8                  │
└────────────────────────────────────────┘
```

关键改动与理由：

1. **主 CTA 升到 56px 并独占一个色块**。现在 44px 的 `.btn-lg` 与 `.segment`（30px）、`.control-select`（32px）在同一个高度族里，且 CTA 上下的 `.entry-hint` 只有 10.5px，视觉重心实际上落在语言卡片上。
2. **语言对从"卡片"降为"摘要行 + 就地展开"**。语言对是低频决策（改一次就长期不变），不该占首屏 45px 的独立容器。展开态复用一个 `.segmented` 语言列表（选项 ≤9 个，见 `SUPPORTED_LANGUAGES`），比两个原生 `<select>` 更快。
3. **「此站点的翻译设置」默认收起**。`#autoTranslate` 与 `#scrollIdleTranslation` 都是"设一次忘掉"的项；现在它们占 2×56px 且用 `.toggle-row` 的整行 hover，抢走了 CTA 下方的视觉流。
4. **站点名进 header**，规则来源用副标题（"站点规则" / "继承自 example.com" / "默认设置"），删除页脚那行 10px 文字。
5. **禁用态必须带解释**：当 `hasHostname === false` 时，header 显示"此页面不可用"，主按钮保持可用但点击后弹出"仅在网页中翻译"（现在按钮直接灰掉且无解释）。

### A.4 options 七区诊断

现有 7 区（`options.html:21-38`）：通用 / 页面翻译 / 输入框翻译 / 规则 / 引擎 / 产品 / 缓存 / 数据（实际 8 个导航项，`nav-data` 与 `nav-cache` 分列）。

| 分区 | 内容 | 诊断 |
|---|---|---|
| 通用 | 目标语言、显示模式 | 基本正确，但只装 2 个字段，值得与"术语表"合并 |
| 页面翻译 | 滚动空闲、两个选择器、内置过滤 | 正确的分区。但"滚动空闲"在 popup 里也有同一个开关（`popup.html:69-78`），两处写同一份数据，popup 里没有"全局/站点"的说明 |
| 输入框翻译 | 魔法词、连续按键、黑名单 | 独立成区是合理的（它是一次性配置的高级特性），但默认 `enabled: true`（`constants.js:82`）而入口藏在第 3 个导航项 |
| 规则 | 域名规则列表 | 正确 |
| 引擎 | 引擎选择、AI 档案、DeepLX、测试翻译、日志、质量指标 | 一个页面塞了 5 个概念。`#aiEngineManagementGroup` 是个整宽按钮打开模态，模态里再套表单+导入模态（三层模态栈） |
| **产品** | 术语表、快捷操作面板、站点配置向导、服务健康状态、翻译历史、"失败处理"说明 | **这是四个不相关的东西被一个内部术语粘在一起**。"Product" 在本仓库是 `translation-product-stores.js` 的意思，不是用户的心智模型。站点配置向导与"规则"重复；服务健康与翻译历史是**只读诊断数据**，不该和"保存设置"共用同一条保存栏（`#saveSettingsBtn` 是全局的） |
| 缓存 | 缓存上限、用量、清空 | 与"数据"应合并：用户认为缓存就是一种数据 |
| 数据 | 云同步、导入、导出、重置 | 正确 |

"设置项找不到"的具体命中：

- **术语表**在"产品"下。用户找"术语表"会去"翻译"或"页面翻译"。
- **快捷操作面板**（选区浮层开关）在"产品"下。它影响的是页面上的行为，应该在"页面翻译"。
- **站点配置向导**在"产品"下，而"规则"下已经有一个"添加域名规则"。两个入口做同一件事，且向导的产出就是一条规则。
- **翻译历史 / 服务健康**在"产品"下，且与可编辑设置混排；它们是不可保存的只读数据，`beforeunload` 脏检查也把它们算进去的风险（当前靠 `diffState` 避开）。
- **"失败处理"**（`failureHandlingDescription`）不是设置，是一段解释"为什么不在这里重试"的开发者散文，占一个卡片。

### A.5 options 重新设计（线框 + 分区映射）

目标：**6 个分区，按用户意图命名**；只读数据从设置页拆出去。

```
┌──────────────┬──────────────────────────────────────────────────────┐
│ Foxlate      │  翻译                                                │
│              │  ┌────────────────────────────────────────────────┐  │
│ ▸ 翻译       │  │ 目标语言  [中文 ▾]        显示模式 [替换 ▾]   │  │
│   翻译       │  │ 术语表    3 条          [编辑术语表]           │  │
│   页面翻译   │  └────────────────────────────────────────────────┘  │
│   输入框翻译 │                                                      │
│              │  首次使用                                             │
│ ▸ 站点       │  ┌────────────────────────────────────────────────┐  │
│   站点规则   │  │ ① 选一个引擎   ② 点这里试一句 ③ 回网页点翻译   │  │
│              │  │  [测试翻译 ▶]  结果：……                        │  │
│ ▸ 引擎       │  └────────────────────────────────────────────────┘  │
│   引擎       │                                                      │
│              │                                                      │
│ ▸ 数据       │                                                      │
│   数据与缓存 │                                                      │
│   诊断       │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

| 新分区 | 吸收 | 说明 |
|---|---|---|
| 翻译 | 通用（目标语言、显示模式）+ 术语表 | 三样都回答"翻成什么、术语怎么处理" |
| 页面翻译 | 页面翻译 + 快捷操作面板（从"产品"移入） | 都作用在网页上 |
| 输入框翻译 | 原样保留 | 独立特性，保留 |
| 站点规则 | 规则 + 站点配置向导（从"产品"移入，作为列表顶部的"从模板新建"） | 向导产出就是规则 |
| 引擎 | 引擎选择 + AI 档案 + DeepLX + 测试翻译 + 日志 + 质量指标 | 保持不变，但把"测试翻译"收进可折叠的"连接测试" |
| 数据与缓存 | 缓存 + 云同步 + 导入导出 + 重置 | "缓存就是一种数据" |
| 诊断（新，只读） | 服务健康 + 翻译历史 + 失败处理说明 | 只读数据与可写设置物理分离；不需要"保存"语义 |

外加三个必须先修的结构问题：

1. **侧栏分组标题是硬编码英文**（`options.html:19,28,35`：`Translate` / `Engines` / `System`），没有 `i18n-text`。中文界面下侧栏是"Translate" + 「通用/页面翻译/…」的混排。
2. **两个同名的破坏性按钮**：`#clearProviderHealthBtn` 与 `#clearHistoryBtn`（`options.html:204,213`）文案都是 `clear` =「清空」，在相邻两张卡片里，各自清空不同的东西。
3. **`#saveSettingsBtn` 与 `#statusMessage` 抢占同一个坐标**：两者都是 `.toast`（`common.css:608-626`）+ `position: fixed; bottom: 2rem; left: 50%`，实测几何 `save: y 516–561`、`status: y 535–561`，重叠 26px。保存按钮还带 `pointer-events: auto`（`common.css:641-643`），会吃掉提示的点击。应改成右上角持久动作条（与内容滚动解耦），或底部中间但让提示上移 48px。

### A.6 内容侧三种浮层的 IA 不统一

同一种东西有三种形态和三种实现：

| 形态 | 类名 | 盒模型来源 | 状态 |
|---|---|---|---|
| 悬停提示（简版） | `.foxlate-panel` | CSS（`style.css:14-37`）完整 | 正常（唯一有 `.visible { visibility: visible }` 的） |
| 悬停提示（增强版，带 TTS/复制/折叠） | `.foxlate-enhanced-panel` | **无** | 透明静态块 |
| AI 摘要面板 | `.foxlate-summary-dialog` | **无**（只拷了 `color/font-family/line-height`） | 透明静态块 |
| 追加译文（第 4 种，不属浮层） | `.foxlate-appended-text` | **被 `style.css:8-13` 错误共享** | `visibility: hidden`，完全不可见 |

三者的头部/正文/操作区结构也不同：`.foxlate-panel` 无头部；`.foxlate-enhanced-panel` 有 `.foxlate-panel-header` + `.foxlate-panel-body`；`.foxlate-summary-dialog` 有 `.foxlate-summary-header` + 标签页 + 会话区 + 页脚输入框。建议抽一层 **`.foxlate-surface` 基础类**（position/z-index/background/border/radius/shadow/font/color + 三态过渡），三处继承，只在变体里改 width/height/布局方向。这同时解决 A.6 和 B 节的"三种写法"，且把 `visibility: hidden` 收进 `.foxlate-surface.is-visible` 一处，断绝“又一次漏写 `.visible`”的可能。

---

## B. 视觉体系（token 使用统计表 + 违规清单）

统计口径：`src/**/*.css` 共 8 个文件（`tokens.css` 只计定义）。"字面量"= 值里没有 `var(--fox-*)`；`0` / `auto` / `none` / `inherit` 单列为"零值"，不算违规。

### B.1 统计表

| 类别 | 声明总数 | 走 token | 字面量 | 零值 | 字面量占比 |
|---|---|---|---|---|---|
| spacing（padding/margin/gap） | 197 | 5 | 158 | 34 | **80%** |
| color（color/background/border-color/fill） | 326 | 256 | 19 | 51 | 5.8% |
| radius | 69 | 32 | 30 | 7 | 43% |
| font-size | 54 | 15 | 38 | 1 | **70%** |
| font-weight | 35 | 26 | 8 | 1 | 23% |
| shadow | 50 | 23 | 2 | 25 | 4% |
| motion（transition/animation） | 60 | 29 | 23 | 8 | 38% |
| line-height | 23 | 18 | 2 | 3 | 9% |
| tracking | 10 | 8 | 1 | 1 | 10% |

结论：**颜色体系是健康的（94% 走 token），比例尺体系是失败的（间距 80%、字号 70% 走字面量）**。这不是"个别组件不守纪律"，是刻度本身与设计不匹配 —— 见 B.3。

### B.2 层级（surface / elevated / overlay）不自洽

`tokens.css` 给了 4 个白：`--fox-color-panel`、`--fox-color-panel-solid`、`--fox-color-panel-raised` 浅色全是 `#ffffff`，深色是 `#161d2b / #161d2b / #1b2536`。而 `common.css` 的别名层把 `--color-surface-container` 指向 panel、`--color-surface-raised` 指向 panel-raised，于是出现实测（Chromium，`dist/options/options.html`）：

| 元素 | 声明 | 实测背景 | 分隔手段 |
|---|---|---|---|
| `.main-content` | `--color-surface` | `rgb(245,247,251)` | — |
| `.card` | `--color-surface-raised`（`options.css:367`） | `rgb(255,255,255)` | 1px 边框 1.32:1 |
| `.form-control` | `--color-surface-raised`（`common.css:315`） | `rgb(255,255,255)` | 1px 边框 **1.32:1** |
| `.dev`（`.themed-select-list`） | `--fox-color-panel-solid` | `#fff` | `--shadow-modal` |

**输入框与它的卡片同色，唯一的分界是一条 1.32:1 的边**——违反 WCAG 1.4.11（非文本对比 3:1），也解释了为什么 options 页"看起来糊"。深色模式下 `.card` 是 `#1b2536`、输入框也是 `#1b2536`，同样零分隔。

`--fox-shadow-surface: 0 1px 2px rgba(20,35,52,.04)` 也帮不上（实测几乎不可见），而 `--fox-shadow-sm/md/lg/overlay/overlay-lg` 里 **`sm`/`overlay`/`overlay-lg` 三个 token 在 CSS 里零读者**——浮层本来该用 `overlay`，实际 `shadow/popover` 只有 `.foxlate-panel` 用。

**玻璃拟态是名义上的**：`grep -rn "backdrop-filter" src` → 0 命中。`--fox-color-panel-glass` 是 `rgba(255,255,255,0.94)`（6% 透明），视觉上就是实色。`tokens.css:207-215` 的 `prefers-reduced-transparency` 块把 0.94 改成 1.0，**用户开了"降低透明度"看到的变化只有 6% 的 alpha**，功能等于空转（见 C.6）。

### B.3 间距刻度冲突：87 处不在 `--fox-space-*` 上

刻度只有 `1=4 / 2=8 / 3=12 / 4=16 / 6=24 / 8=32`。实际使用的值分布（脚本统计，含 rem 归一化到 px）：`10px`×13、`6px`×11、`14px`×10、`7px`×4、`9px`×5、`18px`×5、`2px`×6、`11px`×5、`13px`×2、`15px`×1、`20px`×2、`26px`×1、`28px`×2、`30px`×1、`40px`×1、`3px`×2、`5px`×1。

**排在前三的 10 / 6 / 14 都不在刻度里。** 刻度缺 5 档、组件却用了 5 档，这就是"绕过体系"的机械原因。

完整清单（属性: 值，行号为 `src/` 下真实行）：

**`src/common/common.css`**

- L112 `padding: 0.5rem 0.9rem`（14.4px）
- L118 `gap: 0.45rem`（7.2px）
- L238 `padding: 0.7rem 1.1rem`
- L245 `padding: 0.35rem 0.7rem`
- L259 `gap: 6px`
- L267 `padding: 0.35rem 0.7rem`
- L295 `gap: 0.45rem`
- L349 `padding-right: 2.4rem`（38.4px）
- L378 `padding: 1.25rem`（20px）
- L383 `padding-bottom: 0.8rem`（12.8px）
- L466 `padding: 1.35rem`（21.6px）
- L509 `gap: 18px`
- L553 `padding: 2px 8px`
- L580 `padding: 10px`
- L593 `gap: 6px`
- L613 `padding: 0.75rem 1.25rem`

**`src/content/enhanced-style.css`**

- L82 `padding: 9px 11px`
- L99 `gap: 7px`
- L130 `padding: 8px 11px`
- L152 `padding: 0 11px 11px`
- L177 `padding: 6px`
- L223 `padding: 26px`

**`src/content/style.css`**

- L26 `padding: 11px 13px`
- L123 `padding: 13px`
- L152 `margin-bottom: 9px`
- L166 `gap: 6px 8px`
- L189 `gap: 9px`
- L440 `padding: 0 14px`

**`src/content/summary/summary.css`**

- L32 `padding: 7px 10px`
- L201 `padding: 15px 18px`
- L239 `gap: 5px`
- L257 `padding: 9px 11px`
- L292 `padding: 2px`
- L348 `padding: 18px`
- L358 `gap: 6px`
- L368 `padding: 12px 14px`
- L388 `margin: 0 0 10px`
- L438 `padding: 10px`
- L531 `padding: 14px 16px`
- L540 `padding: 10px 14px`
- L593 `margin-left: 2px`
- L598 `padding: 9px 16px`
- L606 `gap: 6px`
- L607 `padding: 7px 12px`
- L658 `gap: 10px`
- L659 `padding: 9px 12px`

**`src/options/options.css`**

- L14 `padding: 16px 10px`
- L25 `margin-bottom: 30px`
- L51 `margin-bottom: 14px`
- L59 `padding: 4px 12px 6px`
- L73 `margin-bottom: 2px`
- L74 `padding: 7px 10px`
- L180 `padding: 6px`
- L190 `gap: 3px`
- L205 `padding: 9px 12px`
- L291 `padding: 24px 28px 40px`
- L308 `margin: 0 0 14px`
- L321 `margin: 0 0 14px`
- L337 `gap: 14px 16px`
- L349 `gap: 20px`
- L369 `padding: 16px 18px`
- L374 `margin-top: 14px`
- L383 `padding: 0 0 10px`
- L418 `padding: 12px 14px`
- L454 `gap: 6px`
- L469 `padding: 1.25rem 1.35rem`
- L529 `padding: 14px 10px`
- L534 `margin-bottom: 18px`
- L583 `padding: 10px`
- L596 `padding-bottom: 2px`

**`src/popup/popup.css`**

- L18 `gap: 10px`
- L19 `padding: 12px 12px 10px`
- L61 `gap: 10px`
- L81 `padding: 9px 6px`
- L194 `gap: 6px`
- L195 `padding: 10px 12px`
- L228 `padding: 4px 28px 4px 8px`
- L248 `gap: 2px`
- L249 `padding: 3px`
- L261 `padding: 4px 6px`
- L299 `padding: 10px 12px`
- L323 `gap: 2px`
- L344 `padding: 8px 10px`
- L359 `gap: 6px`
- L361 `padding-top: 2px`
- L383 `padding: 1px 6px`
- L398 `padding: 8px 10px`

### B.4 其他字面量清单

**radius（30 条，其中真正违规的非 0/50% 值）**

- `src/content/summary/summary.css` L13 `12px`（= `--fox-radius-lg`）、L34 `10px`（= md）、L219 `9px`（无对应档）、L260 `10px 10px 0 0`、L369 `12px`、L411 `5px`、L421 `5px`、L440 `10px`、L509 `7px`、L542 `12px`、L569 `12px`、L609 `10px`、L661 `10px`、L689 `10px`、L704 `3px`
- `src/content/enhanced-style.css` L179 `8px`（= `--fox-radius-sm`）
- `src/popup/popup.css` L40 `7px`、L263 `calc(var(--radius-sm) - 1px)`
- `src/common/common.css` L554 `999px`（应为 `--radius-full`）

`summary.css` 一个文件用了 3/5/7/9/10/12 六种圆角，没有一档引用 token。

**font-size（38 条，非 token）**

- `src/popup/popup.css`：L88 `13px`、L119 `14px`、**L175 `10.5px`**、L208 `10px`、L217 `10px`、L233 `12.5px`、L267 `12px`、L329 `13px`、L336 `11px`、L366 `10px`、L399 `12px`
- `src/options/options.css`：L38 `17px`、L61 `10px`、L78 `13px`、L248 `16px`、L310 `20px`、L389 `14px`
- `src/content/summary/summary.css`：L39 `12px`、L211 `16px`、L263 `13px`、L333 `13px`、L370 `14px`、L444 `14px`、L547 `14px`、L613 `12px`、L665 `13px`、L684 `13px`
- `src/content/enhanced-style.css`：L101 `14px`、L144 `11px`、L154 `13px`、L241 `13px`
- `src/content/style.css`：L33 `13px`、L153 `12px`、L159 `11px`、L172 `11px`、L286 `12px`
- `src/common/common.css`：L544 `12px`、L557 `12px`

问题：`--fox-text-xs` 是 `0.75rem = 12px`，是字号刻度的底。而 **10px / 10.5px / 11px 承载的是真正的说明文字**：`entry-hint`（10.5px，popup 里唯一教用户怎么划词的一段）、`mini-label`（10px 分组标签）、`field-hint`（10px，"已保存到此网站规则"）、`meta-text`（10px，站点名与版本号）、`nav-group-label`（10px）、`toggle-description`（11px）。这些应当至少在 `--fox-text-xs`，否则 100% 缩放下中文笔画已经开始糊（实测 `mini-label` 计算字号 10px + `letter-spacing: 0.6px` + `text-transform: uppercase`）。

**color（19 条，全部在 B.4 内可解释的有 5 条）**

- `src/common/common.css` L275 `.ripple background: rgba(255,255,255,0.32)` —— 在 `.btn-primary` 上合理，但 `--fox-color-on-primary` 已经存在
- L428 `.switch-thumb background: #ffffff` —— 深色下应该是 `--fox-color-panel-solid`；当前在深色面板上是纯白圆点
- L451 `.modal-backdrop background: rgba(15,23,42,0.4)` —— 遮罩不在 token 里，`prefers-reduced-transparency` 碰不到它
- L598/600/601 `.log-box` `rgba(255,255,255,0.1)` / `#111827` / `#e5e7eb` —— 终端式深色块，可接受但应命名 token
- L616 `.toast color: #ffffff` —— 应为 `--fox-color-inverted-text`
- `src/content/summary/summary.css` L33 `rgba(255,255,255,0.12)`（反转底上的描边）
- `src/options/options.css` L498 `color-mix(in srgb, #ffffff 18%, transparent)` —— 硬编码 `#ffffff`
- `src/common/common.css` L350 `select.form-control` 的箭头是 **data-URI SVG，颜色写死 `%23536173`**。深色模式下计算值仍为 `#536173`，落在 `--fox-color-panel-raised: #1b2536` 上 = **2.44:1**（非文本图形要求 3:1），且 `prefers-contrast` 改不到它

**shadow（2 条）**

- `src/common/common.css` L429 `0 2px 6px rgba(20,35,52,0.24)`
- `src/content/summary/summary.css` L36 `0 22px 48px -30px rgba(20,35,52,0.72)`

**font-weight（8 条，与 `--fox-font-medium: 500 / semibold: 650 / bold: 760` 并行）**

- `enhanced-style.css:102` `720`、`summary.css:212` `760`（= bold）、`summary.css:614` `650`（= semibold）、`summary.css:40` `600`、`summary.css:287` `700`、`style.css:154/182` `700`、`style.css:240` `400`

也就是说全仓库同时存在 400/500/600/650/700/720/760 七个字重档，token 只定义了三档。

**motion（23 条，见 C.2）**

### B.5 未定义 token / 死 token

| 类型 | token | 位置 | 后果 |
|---|---|---|---|
| **未定义** | `--fox-leading-relaxed` | `enhanced-style.css:155`、`summary.css:371` | 声明在计算值阶段失效 → `line-height: inherit`。实测 `.foxlate-text-content` 计算值 `normal`（继承宿主）；摘要气泡靠父级 1.55 侥幸正常。来源可定位：`38d1d36`（1.7.4 清理）把两处 `line-height: 1.55` 机械替换为这个 token，而同一提交写进 `tokens.css` 的 leading 只有 `tight/snug/normal` 三档 |
| 未定义（注释引用） | `--fox-transition-smooth` | `BaseComponent.js:29` | 注释写"遮罩淡出时长是 200ms（`--fox-transition-smooth`）"，该 token 已并入 `--fox-motion-response`；同步的 `MODAL_CLOSE_FALLBACK_MS = 400` 是硬编码 |
| 零读者 | `--fox-shadow-sm`、`--fox-shadow-overlay`、`--fox-shadow-overlay-lg`、`--fox-shadow-input` | `tokens.css:145,150,151,147` | 浮层投影档位无人使用；`--fox-shadow-popover` 只有 `.foxlate-panel` 用 |
| 零读者 | `--fox-color-accent-hover`、`--fox-color-bg-strong`、`--fox-color-inverted-text`、`--fox-color-on-primary-soft`、`--fox-color-pressed`、`--fox-color-warm`、`--fox-color-warm-soft`、`--fox-color-warning-bg`、`--fox-gradient-brand`、`--fox-gradient-warm` | `tokens.css` | `--fox-color-inverted-text` 零读者**正是摘要工具提示用错色的原因**（见 E.4） |
| 零读者 | `--fox-radius-xl`、`--fox-text-xl`、`--fox-space-1/6/8` | `tokens.css` | 刻度存在但没人用：`--fox-space-1`（4px）零读者，而 100 多处用 4px 字面量 |

注：`test/design-system.test.mjs` 的"token 必须有读者"只覆盖 `--fox-(motion|tracking|leading|font-sans)`，所以上表全部通过门禁。**门禁存在一个方向性缺口**：它只查"定义了没人用"（dead token），不查"用了没定义"（ghost token）—— 而后者才是 `38d1d36` 那次机械替换造成真实渲染缺陷的那一类。建议补一条：扫全仓 `var(--fox-*)` 与 `getPropertyValue('--fox-*')`，凡不在 tokens.css 且不在组件内自定义属性白名单内的，直接判红。这条门禁在本次审计前就能抓到 `--fox-leading-relaxed` 和 `--fox-transition-smooth`。

### B.6 token 变更方案

**① 间距刻度：改成 2px 基数的 10 档，并给出机械迁移表**

```css
/* 替换现有 --fox-space-1/2/3/4/6/8 */
--fox-space-0-5: 2px;    /* 新：分隔线间距、徽标内边距 */
--fox-space-1:   4px;
--fox-space-1-5: 6px;    /* 新：最常用的紧凑间隙（11 处） */
--fox-space-2:   8px;
--fox-space-2-5: 10px;   /* 新：最常用的行内边距（13 处） */
--fox-space-3:   12px;
--fox-space-3-5: 14px;   /* 新：卡片/按钮水平内边距（10 处） */
--fox-space-4:   16px;
--fox-space-5:   20px;   /* 新 */
--fox-space-6:   24px;
--fox-space-8:   32px;
--fox-space-10:  40px;   /* 新：设置页内容区底部留白 */
```

剩余 3/5/7/9/11/13/15/18/26/28/30 属于"凭感觉"的值，**不新增 token**，而是规范化到最近的档：11→12、9→8 或 10、7→6 或 8、13→12 或 14、15→16、18→16 或 20、26→24、28→32、30→32。影响面：`summary.css` 与 `enhanced-style.css` 的浮层（原本就是 11/13/9/7 这些手调值），规范化后浮层会略微变"松"，恰好也是它现在偏挤的地方。

**② 层级：给"表面"一条真正的台阶**

```css
/* 浅色 */
--fox-color-bg:            #f5f7fb;  /* L0 页面 */
--fox-color-panel:         #ffffff;  /* L1 卡片 */
--fox-color-panel-raised:  #ffffff;  /* 保留给"浮起一层"的弹窗，不再被输入框复用 */
--fox-color-surface-dim:   #f4f8fb;  /* L0.5 内凹：输入框底 */
```

规则：**输入类控件一律用 `--fox-color-surface-dim` 做底**（`common.css:315` 与 `popup.css:231` 从 `--color-surface-raised` 改为 `--color-surface-dim`），卡片保持白。这样 `.card`(白) / `.form-control`(近白) 之间出现 2 层差异，边框可以回到 26% 而不必靠加粗补救（当前 1.32:1）。深色同理：`#1b2536`（卡片）↔ `#111827`（输入底，现有 `--fox-color-surface-dim`）。

**③ 圆角：4 档收敛**

`--fox-radius-sm: 8px` / `md: 10px` / `lg: 12px` / `full`。删除 `--fox-radius-xl: 16px`（零读者）。`summary.css` 里的 3/5/7/9px 全部映射：3→0（细滚动条）、5→8（气泡缺角，改用 `--fox-radius-sm` 单独覆盖左下角）、7→8、9→10、12→12。气泡的"缺角"应改用 `--fox-radius-sm` 的局部覆盖而不是独立数字。

**④ 字号：把底抬到 12px**

`--fox-text-xs: 0.75rem`，新增 `--fox-text-2xs: 0.6875rem`（11px）作为**唯一**允许低于 12px 的档，只给大写字母标签（`.mini-label`、`.nav-group-label`、`.foxlate-text-label`）使用。10px/10.5px 一律清除：`entry-hint` 10.5→11（或 12 并降为 `--color-text-muted`）、`meta-text` 10→11、`field-hint` 10→11、`toggle-description` 11→12（它是完整的句子，不是标签）。

**⑤ 新增浮层基础类（同时修 P0-1 / P0-2）**

先删掉 `style.css:8-13` 的退化选择器列表，只留 `.foxlate-panel`（当前 `.foxlate-performance-hud` / `.foxlate-appended-text` / `.foxlate-error-underline` 因为共享这份声明而分别变成不可见 / 不可见 / fixed 白卡）。然后：

```css
/* content/style.css，放在三份内容 CSS 都加载的位置之后 */
.foxlate-surface {
    position: fixed;
    z-index: 2147483641;
    box-sizing: border-box;
    border: 1px solid var(--fox-color-border);
    border-radius: var(--fox-radius-md);
    background: var(--fox-color-panel);
    box-shadow: var(--fox-shadow-overlay);
    color: var(--fox-color-text);
    font-family: var(--fox-font-sans);
    line-height: var(--fox-leading-normal);
    visibility: hidden;
    opacity: 0;
    transform: translateY(4px);
    transition:
        opacity var(--fox-motion-response) var(--fox-motion-ease-standard),
        transform var(--fox-motion-response) var(--fox-motion-ease-standard),
        visibility 0s linear var(--fox-motion-response);
}
.foxlate-surface.is-visible {
    visibility: visible;
    opacity: 1;
    transform: translateY(0);
    transition-delay: 0s;
}
```

`.foxlate-panel` / `.foxlate-enhanced-panel` / `.foxlate-summary-dialog` 各加 `foxlate-surface` 类，只保留各自的 width/height/布局。

---

## C. 动效（时长/缓动使用表、缺失点、过量点、三态核对表）

### C.1 时长/缓动 token 使用表

| token | 值 | 读者数 | 读者分布 |
|---|---|---|---|
| `--fox-motion-response-press` | 90ms | **1** | `common.css:158`（`.btn:active` 的 `--btn-press-duration`） |
| `--fox-motion-response-fast` | 140ms | 25 | `common.css` / `options.css` / `popup.css` 的颜色过渡 |
| `--fox-motion-response` | 200ms | 29 | 面板/浮层/开关滑块 |
| `--fox-motion-response-slow` | 280ms | 9 | 增强提示的折叠、摘要建议 |
| `--fox-motion-response-slower` | 360ms | **2** | `common.css:127`（按钮松手）、`:481`（模态入场） |
| `--fox-motion-ease-standard` | `cubic-bezier(.2,.8,.2,1)` | 54 | 主曲线 |
| `--fox-motion-ease-emphasized` | `cubic-bezier(.16,1,.3,1)` | 9 | 浮层入场 |
| `--fox-motion-ease-exit` | `cubic-bezier(.4,0,1,1)` | **1** | `common.css:473`（模态出场） |
| `--fox-motion-ease-spring` | `linear(...)` 19 点 | **2** | `common.css:133,481` |

结论：**没有"未使用的动效 token"**（门禁 `MUST_HAVE_READERS` 覆盖了 motion 组），但有 **23 条动效声明完全绕开这 9 个 token**，且绕开的恰好是最显眼的那些（摘要悬浮球、流式回答、加载三点）。`ease-exit` 与 `response-press` 各只有 1 个读者，说明"出场更短"与"按压跟手"这两条设计原则只在一个组件上落地。

### C.2 字面量时长/缓动清单（15 条，非 reduced-motion 兜底块）

| 文件:行 | 声明 | 问题 |
|---|---|---|
| `summary.css:19` | `box-shadow 220ms cubic-bezier(.2,.8,.2,1), opacity 220ms …, transform 260ms cubic-bezier(.16,1,.3,1)` | 220/260 两个值都不在 token 里；曲线是 `ease-standard`/`ease-emphasized` 的手抄 |
| `summary.css:46` | `opacity 180ms …, transform 220ms …` | 180ms 不存在于体系 |
| `summary.css:91` | `opacity 260ms …, transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1)` | **过冲曲线**。`tokens.css:138-141` 明确写"本系统的默认是 damping 1.0（不过冲）……不提供弹性档位"，这里引入了外部弹性档 |
| `summary.css:361` | `animation: summarySlideIn 0.28s cubic-bezier(.16,1,.3,1)` | 0.28s 应用 `--fox-motion-response-slow` |
| `summary.css:472` / `:484` | `animation: loading-bounce 1.4s infinite ease-in-out both` | 加载三点，1.4s；与全站 spinner 0.7–0.8s 不同源 |
| `enhanced-style.css:233` | `animation: fl-spin 0.8s linear infinite` | spinner 第三套速度 |
| `style.css:201` | `animation: foxlate-spin 0.75s linear infinite` | spinner 第二套速度（`.foxlate-panel.loading`） |
| `style.css:302` / `:386` | `animation: foxlate-spin 0.7s linear infinite` | spinner 第一套速度 |
| `style.css:449` | `transition: background-color 150ms ease, box-shadow 150ms ease` | 快速操作面板，`150ms` + 裸 `ease` |
| `popup.css:136` | `animation: foxlate-popup-spin 0.7s linear infinite` | popup spinner（0.7s，与 302 一致但与 201/233 不一致） |
| `options.css:299` | `animation: panelIn 0.2s ease` | 分区切换，裸 `ease`（应为 `--fox-motion-response`） |
| `common.css:274` | `animation: ripple 0.55s linear` | 水波纹 550ms，比任何 token 都长（options 每次点 `.btn`/`.nav-link` 都播，`options-events.js:81`） |
| `common.css:665` | `animation: errorShake 0.3s ease-in-out` | 裸 `ease-in-out` |

**同一个"加载中"有 4 种 spinner（0.7 / 0.75 / 0.8s + 三点跳动 1.4s）**，需要收敛为 1 个 `.foxlate-spinner` 组件 + `--fox-motion-response-slower`。

### C.3 缺失过渡（状态切换生硬）

| 位置 | 现状 | 症状 |
|---|---|---|
| `popup.css:144-148` `#translatePageBtn[data-state="loading"]` | 背景从 `--color-primary` 直接跳 `--color-primary-hover`；`.btn` 的 transition 列表里**没有 `background`**（只 `background-color`），两者都是 background-color，故有 140ms；但 `cursor: progress` 与 spinner 的 `display: none → inline-block` 是瞬变 | spinner 突现，按钮宽度跳 14px（`.btn-text` 居中偏移） |
| `popup.css:150-156` `[data-state="translated"]` | 从实色块突变为"透明 + 1px 边框"，**border 从 0 变 1px**，盒模型高度不变但内容内缩 2px | 点击后按钮文字横向抖 2px |
| `options.css:302-304` `.content-panel.active` | `display: none → block` + `animation: panelIn`。`display` 切换不可过渡，anim 从 `opacity:0` 起跳是有遮盖的，但**侧栏 `.nav-link.active` 的 `box-shadow: inset 3px 0 0`（`:272`）没有过渡声明** | 切换分区时高亮条瞬移 |
| `options.css:187-191` `.themed-select-list.is-open` | `display: none → flex`，无入场动画（虽然定义了 `transform-origin`，`:193-199`，却没有任何 transform 可用于缩放） | 下拉"啪"地出现；`transform-origin` 是死代码 |
| `common.css:645` `.hidden { display: none !important }` + `popup.css:392` `.meta-pill[hidden]` | `#glossaryIndicator` 用 `hidden` 属性切换 | 术语表徽标出现/消失无过渡 |
| `options.css:488-495` `#saveSettingsBtn` | `.toast.visible` 有 opacity/transform 过渡，但按钮**内部**文字（保存中→已保存）无交叉淡入 | 文案瞬换 |
| `summary.css:490-501` `.message-actions` | `opacity: 0 → 1` **只挂在 `:hover`**，无 `:focus-within` | 键盘用户永远看不到（见 E.1） |
| `summary.css:192-195` `.foxlate-summary-dialog.loading .send-button` | 只改 `opacity: .56`，无过渡 | 发送按钮"变灰"是瞬变 |

### C.4 过量动效（等待感被放大）

| 位置 | 现状 | 为什么过量 |
|---|---|---|
| `summary.css:19` 摘要悬浮球 | 悬停 `translateY(-2px) scale(1.03)`（`:69`）+ 点击 `translateY(1px) scale(0.96)`（`:75`）+ 图标 `rotate(14deg) scale(1.1)`（`:108`）+ 状态切换 `rotate(±90deg) scale(.55)`（`:98,119`） | 一个 50×50 的悬浮球叠了 4 层位移/缩放，且入场 260ms + 图标 360ms，鼠标划过像"活物"；`§2 按下即响应` 的精神是"跟我说收到了"，这已经变成表演 |
| `summary.css:91` 图标切换 | 360ms + **过冲曲线** `cubic-bezier(.34,1.56,.64,1)` | 与 `tokens.css` 明确拒绝过冲的原则冲突；且 360ms 是体系里最慢的档 |
| `enhanced-style.css:158-161` 折叠 | `max-height` 280ms 过渡（`max-height: 500px → 0`） | `max-height` 过渡的进度与视觉高度不成比例：内容只有 60px 高时，前 240ms 只走完 12% 的位移，收起来像卡住；且触发整条消息一次 layout（`max-height` 会重排），长文本折叠时肉眼可见抖动 |
| `enhanced-style.css:199` 图标按钮 hover `translateY(-1px)` | 6px padding 的小按钮整体上浮 | 小控件位移 1px 在 1x 屏幕上就是半个物理像素的抖动 |
| `common.css:274` `.ripple` 550ms + `scale(4)` + 白 32% | 每次点击按钮都播 | 与按钮自身的 `scale(0.97)`（`:159`）叠加：点击时按钮缩、水波扩，两个方向相反的运动同时发生 |
| `popup.css:136` spinner 0.7s | 与另外 3 个 spinner 速度不同 | 同一扩展里加载指示器转速不一致，本身就是"不专业"的信号 |

### C.5 `prefers-reduced-motion` 逐点核对表

核对方法：找出每一条 `animation` / `transition` 声明，检查其目标选择器是否出现在某一处 reduce 块里（或"扩展页面全局 `*` 兜底"覆盖到）。

`common.css:688-719` 的全局兜底只作用于扩展页面（popup/options）；内容侧不加载 `common.css`（`common.css:8-10` 明确说明），所以内容侧的每个动效点都必须单独覆盖。

| # | 动效点 | 文件:行 | reduce 生效？ | 依据 |
|---|---|---|---|---|
| 1 | 主 CTA spinner | `popup.css:136` | ✅ | `popup.css:406-412` 显式 `animation: none` |
| 2 | `.btn` 颜色过渡 | `common.css:128` | ✅ | `common.css:704-719` 白名单恢复颜色 |
| 3 | `.btn` 按压 `scale(.97)` | `common.css:157-160` | ✅ | 白名单的 `transition-property` 不含 transform |
| 4 | `.form-control` 过渡 | `common.css:320` | ✅ | 白名单 |
| 5 | `.switch-track/-thumb` | `common.css:415,430` | ✅ | 白名单 |
| 6 | `.modal-backdrop/.modal-content` | `common.css:454,473,481` | ✅ | 白名单 |
| 7 | `.toast` | `common.css:622` | ✅ | 白名单 |
| 8 | `.ripple` | `common.css:274` | ✅ | 全局 `animation-duration: .001ms` |
| 9 | `.error-shake` | `common.css:665` | ✅ | 全局 |
| 10 | `.segment` | `popup.css:269` | ✅ | 扩展页面全局兜底 |
| 11 | options `panelIn` | `options.css:299` | ✅ | `options.css:516-520` |
| 12 | `.themed-select-icon` 旋转 | `options.css:156` | ✅ | 全局兜底（transform 被压成 0.001ms） |
| 13 | `.foxlate-panel` 显隐 | `style.css:20,51` | ✅ | `style.css:402-411` |
| 14 | `.foxlate-performance-hud` | `style.css:133` | ✅ | 同上 |
| 15 | 行内/追加 spinner | `style.css:302,386` | ✅ | `style.css:413-419` 置 `animation: none` |
| 16 | `.foxlate-hover-highlight` 下划线色 | `style.css:344` | ⚠️ | 只压到 0.001ms（`:409`），颜色反馈被一起关掉；`common.css` 的原则是"颜色反馈要留"，内容侧没有等价处理 |
| 17 | **快速操作面板按钮** | `style.css:449` | ❌ | `.foxlate-quick-action-panel button` 不在 `style.css:402-408` 列表内，150ms 过渡照跑 |
| 18 | **增强提示折叠** | `enhanced-style.css:158-161` | ❌ | **`enhanced-style.css` 没有任何 reduce 块** |
| 19 | **增强提示图标按钮** | `enhanced-style.css:183-186,199` | ❌ | 同上 |
| 20 | **增强提示文本头 hover** | `enhanced-style.css:133` | ❌ | 同上 |
| 21 | **增强提示 spinner** | `enhanced-style.css:233` | ❌ | 同上（无限旋转动画照跑） |
| 22 | 摘要悬浮球 | `summary.css:19` | ✅ | `summary.css:726-731` 列出 `.foxlate-summary-button` |
| 23 | **悬浮球图标旋转（360ms 过冲）** | `summary.css:91` | ❌ | reduce 块列的是**容器**，`.foxlate-summary-button svg` 是子元素，`transition-duration` 不继承 |
| 24 | **悬浮球工具提示** | `summary.css:46` | ❌ | `.foxlate-summary-button-tooltip` 不在列表 |
| 25 | 摘要面板显隐 | `summary.css:134` | ✅ | `.foxlate-summary-dialog` 在列表 |
| 26 | **摘要标签页** | `summary.css:264` | ❌ | 不在列表 |
| 27 | **`.refresh-button`** | `summary.css:223` | ❌ | 不在列表 |
| 28 | **`.send-button`** | `summary.css:573` | ❌ | 不在列表 |
| 29 | **`.suggest-button`** | `summary.css:615` | ❌ | 不在列表 |
| 30 | **建议项上浮** | `summary.css:666` | ❌ | 不在列表 |
| 31 | **消息操作按钮淡入** | `summary.css:495` | ❌ | 不在列表 |
| 32 | **打字三点** | `summary.css:472,484` | ❌ | 不在列表 |
| 33 | 消息入场 | `summary.css:361` | ✅ | `.foxlate-summary-message` 在列表 |
| 34 | 建议区滑入 | `summary.css:643` | ✅ | `.foxlate-summary-suggestions` 在列表 |

**14/34 未生效**（❌），1 条只压时间不改反馈（⚠️ #16），19/34 完全生效。未生效的两处是无限循环动画（#21 增强 spinner、#32 打字三点）。

`prefers-reduced-motion` 的语义缺陷还有一处：`common.css:704-719` 把颜色过渡**重新打开到 120ms**，注释说"颜色反馈是状态变化的语言"。但 `popup.css:406-412` 把 spinner 改成静态圆点（这正确），而 `style.css:413-419` 把三个 spinner 的 `border-color` 全设成 `--fox-color-primary` —— 一个纯色圆环看起来像"卡住的加载"，比静止更让人焦虑。建议改成"静态三点 + 文案"，而不是纯色环。

### C.6 `prefers-contrast` / `prefers-reduced-transparency` 核对表

`prefers-contrast` / `prefers-reduced-transparency` 全部只在 `tokens.css` 做取值替换（`tokens.css:207-238`），这是正确的架构。问题在于**被替换的 token 并不是每个视觉点的实际取值来源**。

| 视觉点 | 取值来源 | contrast: more 生效？ | reduced-transparency 生效？ |
|---|---|---|---|
| 普通边框 | `--fox-color-border` | ⚠️ 部分：`rgba(83,97,115,.6)` 在白色上 = **2.64:1**，仍不到 3:1 | — |
| 强边框 | `--fox-color-border-strong` | ✅ `#536173` = 6.32:1 | — |
| 焦点环 | `color-mix(§focus 16~28%, transparent)` | ❌ token 改了（`#0e7490`），但组件把 alpha 稀释到 16–28%，最终 1.25–1.50:1 | — |
| 开关未选中轨道 | `color-mix(text-muted 22%, transparent)` | ❌ 未命中：1.35:1（浅） / 1.45:1（深） | — |
| `select` 下拉箭头 | data-URI `%23536173`（`common.css:350`） | ❌ 硬编码，改不到；深色下 2.44:1 | — |
| `.modal-backdrop` 遮罩 | `rgba(15,23,42,.4)` 字面量（`common.css:451`） | ❌ | ❌ 不透明遮罩不受影响（可接受） |
| 玻璃面板 | `--fox-color-panel-glass` | — | ⚠️ 0.94 → 1.0，**因为全仓库没有 `backdrop-filter`**，用户感知不到差异 |
| 反转提示芯片 | `--fox-color-inverted-surface` | — | ✅ 0.92 → `#172033` |
| 语言选择器边框（popup） | `--color-border` | ⚠️ 同"普通边框" | — |
| 禁用态 | `opacity: .52 / .55 / .42` | ❌ 与对比度模式无关；主 CTA 禁用后文字 1.54:1 | — |
| 强制色彩模式 | — | **`forced-colors` 零处理**：`color-mix`、`rgba` 背景在 Windows 高对比度下会塌成系统色，图标（`fill: currentColor`）与边框可能一起消失 | — |

结论：三态里 **reduced-motion 覆盖 19/34**、**contrast 有效但被组件稀释**、**reduced-transparency 唯一作用对象（玻璃）不存在**。

---

## D. 状态完整性矩阵（组件 × 五态，缺项打 ✗）

图例：✅ 有；✗ 无；⚠️ 有但不完整。

| 组件 | loading | empty | error | success | disabled |
|---|---|---|---|---|---|
| popup 翻译按钮（`#translatePageBtn`） | ⚠️ 有 spinner（`popup.css:140`），但**点击后到 status 广播到达前是"禁用 + 原文案"**，最长可感知为空窗（`popup-actions.js:152` 只置 `disabled`，未置 `data-state`） | ✗ 无"本页没有可译内容"的就地展示，只在 `renderError` 里借用 alert（`popup-actions.js:96-113`） | ⚠️ 有（`.alert-error`），但兜底分支直接渲染 `Error: ${error.message}`（`:122`） | ⚠️ 只有文案变化（"显示原文"），无 toast/无状态确认 | ✅ `opacity: .55` + `disabled`，但**无解释文案** |
| popup 引擎/语言/模式控件 | ✗ 首次挂载时 `populateSelect` 前是空 `<select>`，无骨架 | ✗ | ✗ 保存失败无提示 | ✗ | ✅（`:137-141`） |
| popup 站点规则指示 | — | ✅ "正在使用默认设置" | ✗ | ✗ 保存站点规则后只有文字变（无"已保存"） | — |
| options 保存按钮 | ✗ **`data-state="loading"` 无任何样式** | — | ✗ `data-state="error"` 无样式（只有字段 `error-shake`） | ✗ `data-state="success"` 无样式 | ✗ 保存中不禁用，可重复提交 |
| options 缓存用量 | ⚠️ 占位 `...`（`options.html:243`） | ✗ 0 条时仍显示 `0 / 5000`，无"暂无缓存" | ⚠️ 失败写 `N/A`（未本地化） | — | — |
| options 清空缓存 | ✗ 无 loading/禁用 | — | ✗ 无错误分支（`options-actions.js:79` 不 try/catch） | ✅ toast | ✗ |
| options 引擎测试（`#manual-test-translate-btn`） | ✗ **无 loading**：`performTestTranslation` 先 `display:block` 结果区再 `await loadLanguageDetector()`（`options-actions.js:270,280`），这段等待在界面上是空白 | ✅ `testSourceEmpty` | ✅ `alert-error` | ✅ `alert` | ✗ 测试中不禁用按钮 |
| options AI 引擎测试 | ⚠️ `testing` 文案存在（locale `testing`），按钮态未核验（JS 路径） | — | ✅ `#aiTestResult` | ✅ | ✗ |
| options 翻译历史 | ✗ 无 loading（`initialize` → `refreshProductData` 期间是空白列表） | ✅ `translationHistoryEmpty`，但**无 `.no-rules-message` 样式**（该 class 在 CSS 中零定义） | ✗ `refreshProductData` 无 try/catch（`options-actions.js:443-451`），消息失败会整块不渲染且无提示 | ⚠️ 清空成功有 toast | ⚠️ **静默截断 `slice(0,12)`**，无"仅显示最近 12 条" |
| options 服务健康 | ✗ 同上 | ✅ + 无样式 | ✗ 同上 | ⚠️ | — |
| options 云端备份列表 | ✗ `refreshCloudData` 无 loading（有 `refreshingCloudData` 文案但未使用） | ✅ `noCloudBackupsFound` + 无样式 | ⚠️ `cloudSettingsInfo.textContent = \`Error: …\``（`:367`，未本地化） | ✅ toast | ✗ |
| options 导入 | ✗ 无（`FileReader` + `JSON.parse`，大文件无指示） | — | ✅ `importError` | ✅ `importSuccess` | ✗ 导入中不禁用 |
| options 导出 | ✗ 无 | — | ✗ **无 try/catch**（`:217-229`），失败时静默 | ✅ `exportSuccess` | ✗ |
| options 模态（确认/引擎/规则） | — | ✅ 引擎列表 `noAiEnginesFound` | ✅ | — | ⚠️ 无"保存中" |
| 摘要对话框 | ✅ 三点 + `summaryLoadingSuggestions` | ✅ `summaryErrorContentEmpty` | ✅ 7 类错误 + 重试/复制 | ✅ | ⚠️ `send-button:disabled` 在浅色下 1.66:1 |
| 增强悬浮提示 | ✅ `tooltipTranslating` | ✗ 无"无译文"态 | ✅ `translationFailedFallback` | — | ⚠️ 折叠时 4 个按钮 `disabled`（`enhanced-tooltip-manager.js:280`） |
| 快选面板 | — | ✗ | ✗ | — | — |

**缺项统计：五态齐全的组件 0 个；缺 loading 的有 8 个；缺 disabled 的有 7 个；缺 empty 的有 5 个。**

最高价值的三条补丁：

1. popup 按钮点击立刻进 `data-state="loading"`（不要让 spinner 等广播）。
2. `#saveSettingsBtn` 补 `[data-state]` 样式 + 保存中 `disabled`（防重复提交）。
3. `performTestTranslation` / `refreshProductData` / `exportSettings` 补 try/catch 与 loading（这三个是"点了没反应"投诉的主要来源）。

---

## E. 可访问性

### E.1 焦点可见性

`:focus-visible` / `:focus` 规则全量（`grep -rn "focus" src --include=*.css` 共 13 处）：

| 选择器 | 文件:行 | 处理 | 环色实际对比 |
|---|---|---|---|
| `.btn:focus-visible` | `common.css:142` | `outline: 0` + `box-shadow: 0 0 0 4px color-mix(focus 24%)` | **1.33:1** |
| `.form-control:focus-visible` | `common.css:143` | 同上（24%） | 1.33:1 |
| `.switch input:focus-visible + .switch-track` | `common.css:144` | 同上（24%） | 1.33:1，且环画在 40.8×23.2 的轨道上 |
| `.form-control:focus` | `common.css:332` | `outline: 0` + `box-shadow 0 0 0 3px color-mix(primary 16%)` | **1.25:1** |
| `.lang-select:hover, .lang-select:focus` | `popup.css:93-99` | **写在 `@media (hover: hover)` 内**，`outline: 0` + 只改背景 | 焦点态 = 背景差（`--color-surface-hover` 8% alpha）；**无 hover 能力的设备上完全没有焦点指示** |
| `.form-control-sm:focus, .control-select:focus` | `popup.css:237-242` | 边框 + 3px 14% halo | **1.21:1** |
| `.themed-select-trigger:focus-visible` | `options.css:138-141` | `outline: 0` + 3px 16% | **1.25:1** |
| `.themed-select-option:focus-visible` | `options.css:225-229` | **在 `@media (hover: hover)` 内**，`outline: 0` + 只改背景 | 箭头键移动焦点时"看不见焦点在哪"；非 hover 设备零指示 |
| `.nav-link` | 无规则 | UA 默认环 | 可见，但与 surrounding 的 brand halo 不是一套 |
| `.segment`（popup 显示模式） | 无规则 | UA 默认环（黑色方框） | 与同 popup 的 CTA halo 明显不同源 |
| `.foxlate-icon-btn`（增强提示） | 无规则 | UA 默认环（`control-reset` 只清 `appearance`，不清 `outline`） | 宿主页面外观决定环的样式 |
| `.refresh-button` / `.send-button` / `.suggest-button` / `.message-actions button` / `.foxlate-summary-tab-title` | 无规则 | UA 默认环 | 但在宿主页面上环色不可控 |
| `.message-edit-area textarea:focus` / `.foxlate-summary-footer textarea:focus` | `summary.css:448,555` | 4px 16% halo | **1.25:1** |

三条硬结论：

1. **没有一个焦点环达到 WCAG 2.4.13 / 1.4.11 的 3:1。** 8 处自定义焦点样式里 6 处都在稀释 `--fox-color-focus`（14%–28% alpha），而 token 本身是达标的（3.68:1）。修法很便宜：环用**实色 2px + 2px offset**（`outline: 2px solid var(--fox-color-focus); outline-offset: 2px`），或 halo 换成 `0 0 0 2px var(--fox-color-focus)`。
2. **两处 `outline: 0` 写在 `@media (hover: hover)` 里**（`popup.css:93-99`、`options.css:223-229`），等于在"有鼠标"的设备上删掉系统环、只留一个不可见的背景差。这是 3 处里最省事的 bug。
3. **焦点视觉有三套**：品牌 halo（`.btn`/`.form-control`）、UA 默认环（`.segment`/`.nav-link`/`.foxlate-icon-btn`）、无指示（`.lang-select` 在非 hover 设备、`.themed-select-native`）。同一屏出现两种环已经是"没做完"的信号。

### E.2 焦点顺序

- **每个被增强的 `<select>` 会多出一个不可见的 Tab 站。** `ThemedSelect.js` 把原生 select 藏成 `position: absolute; width: 1px; opacity: 0; pointer-events: none`（`options.css:93-102`）但**没有** `display:none` 或 `tabindex="-1"`。实测（Chromium，手工注入同 class 节点）：`element.focus()` 后 `document.activeElement === element` 为 **true**，`getComputedStyle().boxShadow === 'none'`，几何 `w:1, h:38`。因为 `min-height: 38px` 胜过 `height: 1px !important`，它是一条 1×38 的无形焦点条。options 页有 20+ 个被增强的 select → 20+ 个无声 Tab 站。修法：`tabindex="-1"` 或 `aria-hidden="true"`（原生 select 仍可被 AT 的虚拟光标访问）。
- **下拉列表框的焦点管理缺失**（`ThemedSelect.js`）：`trigger` 有 `aria-haspopup="listbox"`，但**没有 `role="combobox"`、没有 `aria-controls`、没有 `aria-activedescendant`**。列表被 portal 到 `document.body`（`ThemedSelect.js:17-25`），打开后焦点**不进入列表**（`openThemedSelect` 只做 `classList.add('is-open')`）。因此：Tab 会跳过整个展开的列表；方向键由 `trigger` 的 keydown 直接改原生 select 的值（`ThemedSelect.js:182-200`），列表只是装饰。键盘用户"看不见也进不去"。
- **popup 隐藏控件仍是焦点成员**：`#subtitleDisplayModeSelect` 位于 `style="display:none"` 的 `.subtitle-section` 内（不渲染，实际不可聚焦，实测 `0×0`），可接受；但 `autoTranslate`/`scrollIdleTranslation` 的 `<input>` 是 `0×0`（`common.css:401-406`），焦点由相邻 `.switch-track` 承接，顺序正确。
- **模态焦点陷阱实现正确**（`BaseComponent.js:49-85`）：Esc 只作用于栈顶、Tab 循环、打开时入焦点、关闭时归还焦点。这是本仓库 a11y 做得最好的一处。唯一缺口：`body.modal-open`（`BaseComponent.js:173,214`）在 CSS 中**没有任何规则**，`overflow: hidden` 缺失（靠 `.app-layout { height: 100vh; overflow: hidden }` 侥幸不滚）。

### E.3 可点击区域（≥24px；推荐 44px）

| 目标 | 尺寸 | 判定 |
|---|---|---|
| `.switch-track`（options 的 `.setting-row` 里） | **40.8 × 23.19** | ❌ < 24。popup 里因为包在 52px 的 `.toggle-row` 里没事；options 的 `label.switch` 只包轨道本身，实际点击区就是 40.8×23.19 |
| `.foxlate-summary-tab-close`（关闭标签页） | **18 × 18**（`padding: 2px` + `svg 14px`，`summary.css:287-295,309-313`） | ❌ |
| `.segment`（popup 显示模式） | 97.3 × 30 | ⚠️ ≥24 但 < 44；三个连排且间隙 2px，误触成本高 |
| `#swapLanguagesBtn` | 30 × 30 | ⚠️ 同上 |
| `#openOptionsBtn` | **32 × 36**（`width:32; height:32` 被 `.btn { min-height:36px }` 改写） | ⚠️ 非正方形，视觉上歪的 |
| `.message-actions button`（复制/编辑/重试） | 24 × 24（`padding: 4px` + 16px 图标） | ⚠️ 刚好在线上，但父级 `opacity: 0` 时不可见 |
| `.btn-sm` / `.actions .btn` | 32 高 | ⚠️ |
| `.themed-select-option` | 37 高 | ✅ |
| `.foxlate-icon-btn` | 28 × 28 | ✅ |
| `.send-button` | 38 × 38 | ✅ |
| `.foxlate-summary-button` | 50 × 50 | ✅ |

### E.4 非文本对比（`design-contrast.test.mjs` 未覆盖的部分）

现有门禁只校验 token 两两配对的**文字**对比（`TEXT_TOKENS × SURFACE_TOKENS`）与 `--fox-color-focus` 原值。以下全部未覆盖，且实测不达 3:1：

| 对象 | 取值 | 对比 | 标准 |
|---|---|---|---|
| 输入框 / 卡片边界 | `--fox-color-border` = `rgba(120,140,164,.26)` | **1.32:1**（浅） / 1.49:1（深） | 1.4.11 需 3:1；且输入框与卡片同色 `#ffffff`，边界是唯一识别手段 |
| 强边框 | `rgba(83,97,115,.34)` | 1.66:1 | 同上 |
| **焦点环（24%）** | `color-mix(#0891b2 24%, transparent)` | **1.33:1** | 2.4.13 / 1.4.11 |
| 焦点环（16%） | `color-mix(#0e7490 16%, transparent)` | **1.25:1** | 同上 |
| 焦点环（28%） | `color-mix(#0e7490 28%, transparent)` | 1.50:1 | 同上 |
| 开关未选中轨道 | `color-mix(text-muted 22%)` | 1.35:1（浅） / 1.45:1（深） | 1.4.11 |
| `select` 下拉箭头（深色） | data-URI `#536173` | **2.44:1** | 1.4.11（且 token 化不了） |
| **摘要工具提示文字（深色）** | `--fox-color-on-primary`(#083344) on `--fox-color-inverted-surface` | **1.22:1** | 4.5:1。`summary.css:37` 用错了 token——`--fox-color-inverted-text`(#fff) 存在且零读者，门禁校验的正是 `inverted-text` 对 `inverted-surface`（12.84:1） |
| 摘要发送按钮禁用态（浅色） | `--fox-color-on-primary`(#fff) on `--fox-color-border-strong` | 1.66:1 | 禁用态 WCAG 豁免，但用户看不出图标 |
| 主 CTA 禁用态 | `opacity: .52` 整块 | 文字 1.54:1 | 同上；"禁用"与"坏了"难区分 |
| 模态遮罩 | `rgba(15,23,42,.4)` | 2.55:1（对白底） | 遮罩只需可感知，可接受 |
| `prefers-contrast: more` 下的普通边框 | `rgba(83,97,115,.6)` | **2.64:1** —— 用户**已经**要求更高对比度，仍未达标 | 1.4.11 |

### E.5 `aria-live` 覆盖

`grep -rn "aria-live\|role=\"status\"" src` → **0 命中**。唯一的异步播报是 `popup.html:30` 的 `role="alert"`（错误横幅）。

| 异步结果 | 元素 | 播报 |
|---|---|---|
| popup 错误 | `#error-display` `role="alert"` | ✅ |
| popup 翻译完成 / 按钮变"显示原文" | `#translatePageBtn` | ❌ 无播报 |
| options 保存成功/失败 | `#statusMessage`（`.toast`，无 role） | ❌ |
| options 导入/导出/清缓存/重置 | 同上 | ❌ |
| 引擎测试结果 | `#test-result-area` | ❌ |
| AI 引擎测试 | `#aiTestResult` | ❌ |
| 缓存用量变化 | `#cacheInfoDisplay` | ❌ |
| 翻译历史 / 健康刷新 | `#translationHistoryList` / `#providerHealthList` | ❌ |
| 摘要流式回答（逐 token 追加） | `.foxlate-summary-conversation` | ❌ 无 `role="log"` / `aria-live="polite"`；`role="dialog"` 只在进入时播报标签 |
| 悬停提示（键盘聚焦触发） | `.foxlate-panel` | ❌ 无 `role="tooltip"`、无 `aria-describedby` 关联，被聚焦的元素与被显示的内容之间没有可访问性关系 |

最小修法：`#statusMessage` 加 `role="status" aria-live="polite"`；`#test-result-area`、`#aiTestResult` 加 `role="status"`；摘要会话区加 `role="log" aria-live="polite"`；悬停提示加 `role="tooltip"` 并把 `id` 写进触发元素的 `aria-describedby`。

### E.6 键盘可达的浮层

| 浮层 | Esc | 焦点陷阱 | 初始焦点 | 判 |
|---|---|---|---|---|
| options 三个模态 | ✅ 栈顶 | ✅ Tab 循环 | ✅ 首个可聚焦 | ✅ 良好 |
| options 主题下拉（portal） | ✅（document 级 Escape） | ✗ 无 | ✗ 焦点留在 trigger | ❌ 列表不可键盘操作 |
| 摘要面板 | ✅（`summary.view.js:133`，Capture 阶段，`isComposing` 已排除） | ✗ 有意不设 `aria-modal`（注释说明正确），但**没有 `focusin` 逃逸处理**——Tab 会走出面板进入宿主页面，面板不关闭也不提示 | ✅ `textarea.focus()` | ⚠️ 可接受但出口不明确 |
| 增强悬浮提示 | ✅（`enhanced-tooltip-manager.js:159-175`） | — | 无（`pointer-events: none`，面板本身不可聚焦） | ⚠️ 折叠可达：`.toggle-btn` 是真按钮（`tooltip-content-view.js:18`，带 aria-label）；但 `.foxlate-text-header` 另绑了一份 div 点击（`enhanced-tooltip-manager.js:274-277`），鼠标有两条等价路径、键盘一条，属冗余而不阻塞 |
| 快选面板 | ✅（`quick-action-panel.js:32`） | — | ✗ 面板插入 `body` 末尾后不聚焦（`quick-action-panel.js:128-135`） | ⚠️ 键盘用户需 Tab 到文档末尾才能碰到那个按钮，否则只能 Esc |

`.foxlate-text-header`（`enhanced-style.css:126-134`）是 `<div>` + `cursor: pointer` + `click` 监听，与 `.toggle-btn` 的按钮路径重复；建议删掉 div 的 click（改回 `cursor: default`），减少一个只在鼠标下存在的交互面。

---

## F. 文案改写清单（原文 → 建议，附理由）

分类依据：术语 / 动词 / 空状态 / 错误。

### F.1 术语（同一个东西四个名字）

| 位置 | 现状 | 建议 | 理由 |
|---|---|---|---|
| `navProduct` / `productSystemSettings` | 「产品」/「产品系统」（Product / Product System） | 「更多设置」/「其它设置」 | "Product" 是仓库内部模块名（`translation-product-stores.js`），用户不知道"产品系统"是什么。该区实际装的是术语表/快选面板/站点向导/健康/历史（A.4） |
| 摘要功能 4 个名字 | `enableContentSummary`「启用内容总结」、`summaryButtonTooltip`「总结」、`summaryModalTitle`「AI 摘要」、`mainBodySelectorLabel`「主体内容选择器」、`summaryTabPageTitle`「整页」 | 统一为「内容摘要」，动词用「摘要」 | 同一功能在 4 个界面叫 4 个名字，用户无法建立"按钮→面板"的因果 |
| `navCache`「缓存」+ `navData`「数据管理」 | 两个相邻区 | 合并为「数据与缓存」 | 缓存是数据的一种；现在"清缓存"和"清历史"分居两区，都属于"清数据" |
| `translationEngine`「翻译引擎：」 | 带全角冒号的 label | 「翻译引擎」（冒号交给 CSS `::after`） | 冒号被写进 i18n 值，导致 `aiCustomPrompt`「自定义提示词:」用了**半角**冒号（不一致），且 `popupTranslating`「正在翻译…」与 `testing`「测试中...」混用 `…`/`...` |
| `popupDisplayModeReplace`「替换模式」 vs `replaceOriginal`「Replace Original」 | popup 叫 Replace，options 叫 Replace Original | options 也用「替换原文」 | 同一个枚举两个英文名 |
| `providerStatusHealthy/Degraded`「正常/异常」 vs `providerHealthSuccess/Failure`「成功/失败」 vs `providerHealthSuccess` 的复数计数 | 三种词性混排在同一行（`renderProviderHealth` 拼成 `成功 12 · 失败 3 · 240ms`） | 「健康/降级」+「成功 12 · 失败 3 · 延迟 240ms」 | 现在同一行里"正常"和"成功"指同一件事 |

### F.2 动词（按钮说不清要发生什么）

| 位置 | 现状 | 建议 | 理由 |
|---|---|---|---|
| `clearProviderHealthBtn` / `clearHistoryBtn`（`options.html:204,213`） | 两个都是「清空」 | 「清空健康记录」/「清空翻译历史」 | 相邻卡片里两个同名破坏性按钮，只能靠位置区分 |
| `refreshProductData`「刷新」 | 笼统 | 「刷新数据」 | 它同时刷历史和健康 |
| `test`「测试」（AI 引擎） | 不知道测什么 | 「测试连接」 | 实际发一次 chat completion |
| `translateButtonText`「翻译」（测试区） | 与主 CTA「翻译此页」混淆 | 「试翻这句」 | 这是设置页的沙盒，不是执行翻译 |
| `removeRule`「移除」/ `remove`「移除」 | 用在规则、AI 引擎、云备份三处 | 规则→「删除规则」，云备份→「删除备份」 | 移除/删除混用；且 `renderCloudDataList` 用 `removeRule` 的文案做"删除备份"（`options-actions.js:348`），语义错位 |
| `summaryCopyMessage`「复制」/ `summaryCopyError`「复制错误信息」 | 一个具体一个笼统 | 「复制回答」/「复制错误」 | — |

### F.3 空状态（没有出口）

| key | 现状 | 建议 | 理由 |
|---|---|---|---|
| `noAiEnginesFound` | 「未配置任何引擎。」 | 「还没有 AI 引擎。点下方"添加 AI 引擎"填入名称/地址/密钥。」 | 空状态必须指向下一步；现在下方正好有按钮但文案不指 |
| `noDomainRulesFound` | 「未配置任何域名规则。」 | 「还没有域名规则。可为某个站点单独设置语言与显示模式。」 | 同上 |
| `noCloudBackupsFound` | 「未找到云端备份。」 | 「还没有云端备份。开启云同步后点"上传设置到云端"。」 | 同上 |
| `translationHistoryEmpty` | 「暂无翻译历史。」 | 「还没有翻译记录。在网页上翻译一段后会出现。」 | 说明"它什么时候会有" |
| `providerHealthEmpty` | 「暂无服务健康数据。」 | 「还没有引擎调用记录。翻译或用"测试连接"后会记录下来。」 | "服务健康"是内部术语 |
| `popupEmptyCandidates` | 「未找到可翻译文本。可在选项中调整内容选择器。」 | 「这页没有找到可翻译的正文。」+ 按钮「打开内容选择器」 | 现在把用户推去一个他找不到的地方 |

### F.4 错误（说人话）

| key/位置 | 现状 | 建议 | 理由 |
|---|---|---|---|
| `popup-actions.js:122` | `Error: ${error.message}` 直接进 alert | 「无法读取页面状态，请刷新页面后重试。」+ 原始错误进 console | 把异常字符串给用户看 |
| `summaryErrorUnknown` | 「处理请求时遇到了问题。请重试，如果问题持续存在，请联系支持。」 | 「重试」按钮已经在消息下方，文案里的"请联系支持"没有联系方式 | 无出口的指引 |
| `options-actions.js:367` | `cloudSettingsInfo.textContent = \`Error: ${error.message}\`` | 用 `loadCloudDataFailed` | 唯一一处未本地化的错误 |
| `invalidCssSelector` | 「CSS 选择器无效」（无行号/无位置） | 「第 2 行不是有效的选择器：`.foo[`」 | 用户不知道怎么修 |
| `precheckBuiltinDescription` | 「自动跳过 URL、邮箱…**暂不支持自定义正则预检规则**。」 | 删掉第二句，或改为可折叠的"了解过滤规则" | 用户在看设置时不需要知道"不支持什么" |
| `failureHandlingDescription` | 「网页翻译失败会在网页上下文中通过自动重试和服务健康状态处理，不在设置页重试单条网页翻译。」 | 整段删除，改成健康卡片下方一行「失败会自动重试；连续失败会显示在页面上」 | 这是一段写给开发者的辩护词，解释"为什么这里没有这个功能" |
| `subtitleDisplayModeOff` | 「关闭（注入但不显示）」 | 「关闭」 | 括号里是实现细节 |
| `inputTriggerWordDescription` | 「输入文本后跟"//[lang-]"+ 魔法词进行翻译。例如，"你好 //en-fox"。」 | 「在输入框里写 `你好 //en-fox` 即可翻译；`//en-` 指定目标语言。」 | "魔法词"不是用户词汇；语法说明顺序反了（先说结果再说规则） |
| `qualityPreviewExpansion` | 「膨胀比例」 | 「长度比」 | "膨胀"是负面词，这里只是字符数比 |

### F.5 i18n 缺陷（未翻译 / 翻译后失真）

| 位置 | 问题 |
|---|---|
| `options.html:19,28,35` | `Translate` / `Engines` / `System` 三个侧栏分组标题**硬编码英文**，无 `i18n-text`。中文界面下侧栏是英文组名 + 中文项名 |
| `AIEngineModal.js:112` | `aiFormTitle.textContent = i18n('edit') / i18n('add')` → 中文只显示「编辑」/「添加」，**丢掉了"引擎"这个宾语**（对照 `DomainRuleModal.js:73` 用的是完整的「编辑域名规则」，做法不一致） |
| `scrollIdleDelayLabel` | 英文「Scroll idle delay」/ 中文「停止判定时间」——中文缺"滚动"这个主语，且"判定"是工程词。建议「滚动停止后等待」（并在输入框后缀标 `ms`） |
| `summary` 系列 | `summaryErrorNetwork` 等 7 条在中文里把 Markdown 的 `**粗体**` 直接塞进 i18n 值（`**网络连接错误**`），依赖渲染器解析；若某处按纯文本渲染就会出现星号 |

---

## G. 优先级排序（P0/P1/P2 + 工作量）

工作量口径：S ≤ 0.5 人日，M ≈ 1–2 人日，L ≥ 3 人日。

| # | 优先级 | 问题 | 位置 | 工作量 |
|---|---|---|---|---|
| 1 | **P0** | `style.css:8-13` 退化选择器列表：追加模式译文/HUD 不可见，失败段落被拔成 fixed 白卡 | `style.css:8-13` | S（删掉列表里的三个多余选择器） |
| 2 | **P0** | 两个内容浮层缺基础盒模型（透明静态块） | `summary.css:128`、`enhanced-style.css:14` | M（抽 `.foxlate-surface`） |
| 3 | **P0** | `summary.css` 20 条全局选择器污染宿主页面 | `summary.css:215,230,436,448,454,464,475,487,488,490,504,516,522,561,579,585,590,603,622,629` | S（加 `.foxlate-summary-dialog` 前缀） |
| 4 | **P0** | 焦点环全部 < 3:1（14–28% alpha） | `common.css:142-147,332-337`、`options.css:138-141,225-229`、`popup.css:237-242`、`summary.css:448,555` | S |
| 5 | **P0** | `outline: 0` 写在 `@media (hover: hover)` 内 | `popup.css:93-99`、`options.css:223-229` | S |
| 6 | **P1** | 深色下摘要工具提示文字 1.22:1（用错 token） | `summary.css:37` | S |
| 7 | **P1** | 输入框与卡片同色，边界 1.32:1 | `common.css:315`、`popup.css:231` | S |
| 8 | **P1** | 消息操作按钮 `opacity:0` 仅 hover 可见 | `summary.css:490-501` | S（加 `:focus-within`） |
| 9 | **P1** | 保存按钮无 `.btn`、`data-state` 无样式、保存中不禁用 | `options.html:343`、`options-actions.js:98-123` | S |
| 10 | **P1** | 保存按钮与状态 toast 坐标重叠 | `common.css:608-626,641-643`、`options.html:343,346` | S |
| 11 | **P1** | `--fox-leading-relaxed` 未定义（`38d1d36` 机械替换的产物） | `enhanced-style.css:155`、`summary.css:371` | S（并补"ghost token"门禁） |
| 12 | **P1** | 主题下拉：不可见 Tab 站 + 列表框无焦点管理 | `ThemedSelect.js:17-25,93-101,182-200`、`options.css:93-102` | M |
| 13 | **P1** | 间距刻度缺 6/10/14 档，87 处字面量 | `tokens.css:110-116` + 4 个组件文件 | L（刻度先改，再机械替换） |
| 14 | **P1** | 0 处 `aria-live`，异步结果全部静默 | `options.html:346`、`options-renderer`/`summary.view` | M |
| 15 | **P1** | popup 点击到 spinner 之间有空窗；错误无出口 | `popup-actions.js:148-161,114-124` | S |
| 16 | **P1** | 侧栏分组标题未本地化；`aiFormTitle` 丢宾语 | `options.html:19,28,35`、`AIEngineModal.js:112` | S |
| 17 | **P2** | 15 条动效字面量 + 4 套 spinner 速度 + 过冲曲线 | `summary.css:19,46,91,361,472,484`、`style.css:201,302,386,449`、`enhanced-style.css:233`、`popup.css:136`、`options.css:299`、`common.css:274,665` | M |
| 18 | **P2** | reduced-motion 14/34 未覆盖（`enhanced-style.css` 整份缺失） | 见 C.5 | M |
| 19 | **P2** | 点击区：开关轨道 23.2px、标签关闭 18px | `common.css:408-410`、`summary.css:287-295,309-313` | S |
| 20 | **P2** | 字号下限 10px 承载真文字 | 见 B.4 font-size | M |
| 21 | **P2** | 三种浮层三套盒模型/结构 | 见 A.6 | L |
| 22 | **P2** | 域名/缓存/健康空状态无样式（`.no-rules-message` 零定义） | `common.css` 缺规则；`options-actions.js:560` | S |
| 23 | **P2** | 静默截断 `slice(0,12)`、`testing`/`refreshingCloudData` 文案未用 | `options-actions.js:570` | S |
| 24 | **P2** | 文案：4 个摘要名、2 个同名「清空」、开发者散文段落 | 见 F | M |
| 25 | **P2** | `forced-colors` 零处理 | 全站 | M |
| 26 | **P2** | `prefers-contrast` 下普通边框仍 2.64:1 | `tokens.css:222` | S |
| 27 | **P2** | `select` 箭头硬编码 `#536173`（深色 2.44:1） | `common.css:350` | S |
| 28 | **P2** | `.modal-open` 类无对应规则 | `BaseComponent.js:173,214` | S |

**建议顺序**：1（一行，先止血：删掉 `style.css:8-13` 列表里除 `.foxlate-panel` 外的三个选择器，然后给 `.foxlate-appended-text` / `.foxlate-performance-hud` 各自补 `visibility: visible`，或直接走第 2 条的 `.foxlate-surface`）→ 2–5（P0 余下，一天）→ 6–11（P1 的 S 项，一天）→ 12、14、15、16 → 13（刻度改造，单独一次 PR，因为有 87 处机械替换）→ 17–21（视觉一致性与浮层重构）→ 其余。

---

## H. 需要用户决策的取舍

1. **`.foxlate-surface` 重构 vs 三处各补一遍**。抽基础类要动三个浮层的类名与 JS 里 `className` 赋值（`summary.view.js:189`、`enhanced-tooltip-manager.js:36`、`hover-tooltip-surface.js:87`），并且要同步改 `dom-walker` 的 `FRAME_*` 排除列表（`page-translation-elements.js:4`）。补丁式修法 3 处各写 12 行，能过，但 A.6 的"三种写法"会留下。**建议抽类**，代价是动 4 个 JS 文件。
2. **间距刻度：加档 vs 规范化**。加 6/10/14 三档（B.6①）迁移成本最低（值是现成的），但刻度会从"4px 网格"退化成"2px 网格 + 3 个半档"。规范化到 4/8/12/16 更干净，但要重绘所有浮层的视觉节奏。**建议加档**（6/10/14 恰好是读出节奏），把 3/5/7/9/13/15 这些真正的随手值规范化。
3. **popup 是否允许"折叠配置"**。A.3 的线框假设用户愿意多点一次才看到显示模式。代价：改显示模式的步数从 1 变 2。对"每天改一次模式"的用户是退步。替代方案：保留一行 3 段控件但压到 24px 高并放到摘要行里。**需要你定：优先首屏清爽，还是优先模式切换的手速**。
4. **`prefers-reduced-motion` 下 spinner 怎么表现**。当前做法（`style.css:413-419`）是静态纯色环，我认为它像"卡住"。备选：(a) 静态三点 + "翻译中"文字；(b) 保留极慢旋转（3s/圈，低于前庭阈值）；(c) 纯文字。**这是产品口味问题，需要你选**。
5. **AI 摘要面板的定位模型**。修好 `position: fixed` 后，它是"贴按钮弹出"（`placeNearButton`）还是"右侧停靠抽屉"？后者对长对话更合适（当前 `height` 上限 `min(80vh, …)`，会话区 `overflow-y: auto`，本质是个抽屉）。改动会牵动 `summary-layout-controller.js` 的 `planDialog`。
6. **"产品"分区拆到什么程度**。A.5 把它拆进"翻译""页面翻译""站点规则""诊断"四处，意味着 4 个 URL hash 失效（`#product` 书签、快捷键、可能的用户习惯）。若需要兼容，`#product` 应重定向到新的"更多设置"并保留锚点。
7. **是否给内容侧浮层加载 `common.css`**。现在内容侧只有 `tokens.css`（正确，因为 `common.css` 声明 `color-scheme`）。但 `.foxlate-surface` 的样式若写在 `common.css` 里就能被扩展页复用；写在 `style.css` 里则内容侧独享。**建议写 `style.css` 并在 `common.css` 里镜像一份语义别名**，避免再次出现"三种写法"。

---

### 附：本次用到的可复现命令

```bash
# 1. token 读者统计（未定义 / 零读者）
grep -o -- '--fox-[a-z0-9-]*' src/common/tokens.css | sort -u > /tmp/tok.txt
grep -rho -- 'var(\s*--fox-[a-z0-9-]*' src --include='*.css' | sed 's/var(\s*//' | sort -u > /tmp/used.txt
comm -13 /tmp/tok.txt /tmp/used.txt   # 用了但没定义
comm -23 /tmp/tok.txt /tmp/used.txt   # 定义了但没人用

# 2. 渲染核验（只读 dist，不写共享产物）
diff -r src/content/summary/summary.css dist/content/summary/summary.css
cd dist && python3 -m http.server 8977 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8977/popup/popup.html 与 /options/options.html
# 取 getComputedStyle 与 getBoundingClientRect（本报告所有"实测"均来自此）
```
