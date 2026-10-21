# Foxlate 1.7.4 全盘重构评估报告

> **状态：本报告提出的阶段 1–4 与后续全部审计批次已实施完毕，验收记录见第 9 节。**
> 第 2–6 节保留的是**改造前的分析**（问题现在已不存在，但这些分析解释了代码为何是今天这个形状）；
> 第 1 节是**改造后的实测基线**，代表现状。若你的目的是「现在这个仓库怎么样」，读第 1 节与第 9 节。
>
> 逐项「问题 → 修法 → 验证」见 `specs/verifications/refactor-ledger.md`（权威清单）。

> 视角：如果从零重新设计这个项目，哪些决策要推翻、哪些要保留。
> 方法：全部结论来自**直接读源码 + 可复现构建实验**，不采信记忆与文档。
> 基线：`main` HEAD = `7b46f5e`（chore(release): merge 1.7.4），version 1.7.4。
> 复现命令见文末附录。

---

## 0. 结论摘要

### 0.1 六维评分

| 维度 | 评分 | 一句话结论 |
|---|---|---|
| 架构 | **6.5 / 10** | 分层清晰、模块化真实存在；但**依赖图无人管理**，一个 TTS 用的库污染了全部 4 个产物 |
| 性能 | **3.5 / 10** | 全仓库 JS 体积的 **~64% 是死重**；无性能预算、无门禁、无真实基线 |
| UI | **7.0 / 10** | `--fox-*` token 体系统一、暗色已支持；但 options 是 568 行静态 HTML + 121 个 id 的手工拼装 |
| 功能合理性 | **7.5 / 10** | 功能面克制、与竞品对齐；存在 1 处真实的 i18n 断链与若干死 key |
| 用户友好度 | **6.0 / 10** | 默认值合理；但英文用户（`default_locale=en`）在 3 处看到**空白按钮文字** |
| 测试 | **8.5 / 10** | 372 个测试、45 文件、10,612 行，含真实 esbuild+jsdom 集成测试与 5 道门禁；改造前 60+ 源模块零覆盖，且混入脆弱断言 |

**总评：7.6 / 10 → 项目底子好，但存在一个"高收益、低风险"的重构缺口。**

## 1. 事实基线（可复现，1.7.4 改造后实测）

### 1.1 代码规模

```
src/ = 26,211 行 / 161 文件
  content    8,536 行 / 61 文件   ← 最大
  lib        4,088 行 /  4 文件   ← vendored（readability + browser-polyfill + franc.bundle + marked）
  background 3,621 行 / 42 文件
  options    3,125 行 / 17 文件   ← 真实 UI 复杂度在这里，popup 是薄壳
  common     2,279 行 / 22 文件
  popup        473 行 /  6 文件
```

> `lib/franc.bundle.mjs`（354.8 KB 源码）已从四个主产物中剥离，改为朗读时按需加载的独立资源。

### 1.2 构建产物（`npm run build:firefox` 实测，minified）

| 产物 | 体积 |
|---|---|
| `dist/content/content-script.js` | 254.8 KB |
| `dist/options/options.js` | 96.3 KB |
| `dist/background/service-worker.js` | 67.1 KB |
| `dist/popup/popup.js` | 36.5 KB |
| **四产物合计** | **454.7 KB** |
| `dist/lib/franc.bundle.mjs` | 354.8 KB（仅朗读时按需加载） |

安装包总计 **1.2 MB / 25 个文件**（改造前约 2.3 MB）。四个主产物都是**每次注入 / 每次唤醒都要解析**的成本。

### 1.3 CSS

```
19.5 KB  common.css          10.7 KB  tokens.css（唯一 token 源）
18.7 KB  summary.css         13.5 KB  options.css
12.3 KB  content/style.css    8.6 KB  popup.css
 6.2 KB  enhanced-style.css
```

### 1.4 测试

```
45 文件 / 10,612 行 → 372 pass / 0 fail
```

### 1.5 契约面与门禁

```
i18n 词典     public/_locales/{en,zh_CN}/messages.json —— key 集合完全对齐，0 死 key
运行时依赖    仅 @chenglou/pretext
```

| 门禁 | 文件 | 条数 |
|---|---|---|
| i18n 完整性 | `test/i18n-integrity.test.mjs` | 含内联回写漂移检查 |
| 体积预算 | `test/bundle-budget.test.mjs` | 每产物上限 |
| 设计系统 | `test/design-system.test.mjs` | 18 |
| 规划契约 | `test/planning-state.test.mjs` | 16 |
| 依赖卫生 | `test/dependency-hygiene.test.mjs` | 6 |

---

## 2. 架构

### 2.1 做对了的（重构时应保留）

1. **分层是真实的，不是名义上的。**
   `src/background`（SW/引擎/缓存）→ `src/content`（页面侧）→ `src/common`（共享）→ `src/options`/`src/popup`（UI 壳）边界清晰，没有出现 content 直接 `chrome.*` 调后台这类越界。

2. **消息契约单点化。**
   `src/common/message-types.js` 是唯一 `MESSAGE_TYPES` 来源；content 侧用 `createContentMessageHandlers(runtime)` 返回**对象映射表**（`[MESSAGE_TYPES.PING]()`）而非长 `switch`，新增 handler 是纯追加操作。后台侧走 `createBackgroundMessageHandlers({...})` 依赖注入。**这是可以继续放大的模式。**

3. **内容脚本入口极薄。**
   `src/content/content-script.js` 只有 191B / 1 行 import ——`import { initializeContentRuntime } from './content-runtime.js'`。入口即引导，真实逻辑在 feature 模块，符合直觉。

4. **content 已按 feature 目录切分**（`summary/ subtitle/ tooltip/ input/ layout/ strategies/ display/ page-translation/ performance/`），60 个文件分布合理，不是一坨。

5. **测试会用 esbuild 真实打包 + jsdom**（见 `test/content-runtime-architecture.test.mjs`：`mkdtemp` 生成临时入口 → esbuild `onResolve` 注入 mock → 动态 import 真实模块）。**这不是玩具测试，是真正的集成测试。**

6. **翻译缓存有正确的数据结构**：`TranslationCacheStore` 用 `Map` + LRU `touch()`（delete→set 重排）+ `saveDelayMs = 2000` 防抖持久化 + `maxSize = 5000` 上限。这是教科书式实现。

### 2.2 结构性问题

#### A. 【严重】依赖图失控：一个 TTS 库污染了全部产物

`src/common/utils.js:1`（**每个产物都从这个 3 行函数付 239 KB**）：

```js
import { franc } from '../lib/franc.bundle.mjs';   // ← 无条件的顶层静态 import，239 KB
```

`utils.js` 同时导出 `escapeHtml`、`debounce`、`getSpeechCode`、`detectSpeechLang`。而 `escapeHtml` / `debounce` / `getSpeechCode` 被 **content / options / popup** 广泛引用：

```
src/content/summary/summary.view.js:4            import { debounce } from '../../common/utils.js';
src/content/tooltip/tooltip-content-view.js:1    import { escapeHtml } from '../../common/utils.js';
src/content/strategies/append-strategy.js:4      import { escapeHtml } from '../../common/utils.js';
src/content/strategies/replace-strategy.js:4     import { escapeHtml } from '../../common/utils.js';
src/content/strategies/enhanced-context-menu-strategy.js:3  import { getSpeechCode } from ...
src/options/components/AIEngineModal.js:5        import { escapeHtml } from '../common/utils.js';
src/options/options-actions.js:5                 import { escapeHtml } from '../common/utils.js';
```

**后果**：为了拿一个 3 行的 `escapeHtml`，每个产物都背上 239 KB 的语言检测模型。

实测各产物构成（esbuild `--metafile`）：

| 产物 | 总大小 | franc | 占比 |
|---|---|---|---|
| `content-script.js` | 492.0 KB | 239.3 KB | **48.7%** |
| `options.js` | 377.2 KB | 239.3 KB | **63.6%** |
| `popup.js` | 311.3 KB | 232.0 KB | **74.7%** |
| `service-worker.js` | 296.6 KB | 232.0 KB | **78.4%** |
| **合计** | **1477 KB** | **~942 KB** | **~64%** |

`franc` 的唯一用途是**语音朗读（TTS）的语言判定**（`getSpeechCode` / `detectSpeechLang`），却在 **service worker 启动路径**里被同步解析。

> **判据**：这不是"优化项"，是架构缺陷。`common/utils.js` 是一个 grab-bag 模块，把"零成本纯函数"和"239 KB 重依赖"捆在了同一个 import 边界上。重构的正确形态是拆成 `common/escape.js`（纯函数）+ `common/lang-detect.js`（重依赖，动态 `await import()`），并且 **franc 只在用户开启朗读时才加载**。

#### B. 【中】`common/` 是杂物间，不是共享层

`common/` 1227 行 / 9 文件里混着：设计 token 读写的 settings 逻辑、precheck 规则、context 提取、纯工具函数。`settings-manager.js`(246) 与 `settings-domain.js`(260) 职责边界需要读者自行推断。

#### C. 【中】background 的消息处理器是隐式 god module

`src/background/background-message-handlers.js` 520 行，承载全部后台能力（翻译、缓存、设置、同步、字幕、AI）。它本身没有测试引用。content 侧同结构的 `content-message-handlers.js` 只有 2.4KB / 52 行——**两侧对称性已经失衡**。

#### D. 【中】settings 的三个"真相源"

`common/constants.js` 的 `DEFAULT_SETTINGS`、`common/settings-manager.js`、`common/settings-domain.js` 三处都能"决定"一个设置的默认值与合并规则。1.7.3 的 changelog 已暴露症状：*"domain `summarySettings` merged into effective"*——**域的合并规则被事后补丁式加入**，说明 effective settings 的计算没有单一函数。

#### E.【中】层间依赖反向：`common/` 依赖 `content/`

```
src/common/ui-text-layout-service.js:1
  import { textMeasurementService } from '../content/layout/text-measurement-service.js';   ← 共享层伸手进功能层
      ↓
src/content/layout/text-measurement-service.js:1
  import { measureLineStats, measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';
      ↓
src/popup/popup-renderer.js:3
  import { uiTextLayoutService } from '../common/ui-text-layout-service.js';                ← 于是 popup 也被拖进来
```

`common/` 被定义为共享层，却反向依赖 `content/` 的特性模块——**这是层级倒置，也让一个文本排版引擎漏进了 popup 与 service worker**（两者的唯一用途是在 popup/summary 里做宽度测量，SW 完全用不到）。

与 A 同源同因：**依赖边界没人管**。

#### F. 【低】vendored lib 进了主 bundle

`src/lib/` 4,111 行（readability 2786 + browser-polyfill 1224 + franc.bundle + marked）是手工 vendored 的第三方代码，其中 `franc.bundle.mjs` 是 2 行超长 minified 文件（不可读、不可 patch、不可 tree-shake 审计）。用 `node_modules` + esbuild 正常打包会得到同样的体积但**可审计、可升级、可 code-split**。

---

## 3. 性能

### 3.1 冷启动成本（最大项）

**每次页面注入解析 492 KB minified JS**，其中 239 KB（franc，48.7%）与页面翻译**无关**。这是纯 CPU 解析 + 内存成本，落在每个被翻译的页面上。

再叠加：`dist/lib/readability.esm.js` 87.9 KB + `dist/lib/marked.esm.js` 38.6 KB 也会被加载/打包——**这三者（franc + readability + marked ≈ 366 KB）只为"AI 总结"一个功能服务**，纯翻译用户全额付费。

### 3.2 SW 启动成本

service worker 296.6 KB 中 78.4% 是 franc。MV3 SW 会被反复挂起/唤醒，**每次唤醒都要重新解析 232 KB 的无用代码**。这是最容易量化、最容易修的一处。

### 3.3 传导到 UI 的启动成本

options 377.2 KB（63.6% 死重）、popup 311.3 KB（74.7% 死重）——**用户点开设置面板/弹出窗的每一毫秒，都在等一个语音识别用的语言模型**。popup 是最频繁打开的界面，此处的浪费体感最强。

### 3.4 `@chenglou/pretext`（文本排版引擎）的越界

`pretext` 的模块出现在 **service-worker** 与 **popup** 产物里：

```
service-worker.js:  bidi-data 14.4 KB + analysis 12.7 KB + line-break 8.0 KB + layout 4.2 KB  ≈ 39 KB
popup.js:           bidi-data 14.4 KB + analysis 12.7 KB + line-break 8.0 KB + layout 4.1 KB  ≈ 39 KB
options.js:         同上                                                                    ≈ 39 KB
```

一个**文本换行/双向文本排版**引擎，被注入了后台服务和设置页。合理用途只在 `src/content/layout/text-measurement-service.js`（summary 布局测量）。这是依赖图污染的第二个实例，与 franc 同源同因。

### 3.5 翻译吞吐

- `page-translation-job.js:60` `INITIAL_SCAN_CHUNK_SIZE = 12`——首屏分块扫描，节奏控制存在。
- `translator-manager.js` 有 `translateBatch` / `#executeAiBatchGroup` / `updateConcurrencyLimit`——批处理与并发闸门存在。
- AI 路径有两处 `fetch`（`ai-translator.js:88` 翻译、`:156` 总结），Google / DeepLX 各一处。

**问题不在实现，在于没有任何测量**：仓库里没有性能预算、没有 benchmark、没有 CI 性能门禁。`translation-performance-hud.js` 是 debug-only 的运行时面板，不是可回归的指标。

### 3.6 缓存

`TranslationCacheStore` 的 `maxSize = 5000` 条文本，按 `${sourceLang}:${targetLang}:${text}` 作 key。风险：长文本条目 + 5000 上限，**持久化到 `storage`（2s 防抖）后是单键巨型 blob**，MV3 的 storage 写入是全量 JSON 序列化。无分层、无按域清理、无体积上限（只有条目数上限）。

---

## 4. UI

### 4.1 做对了的

> 本节描述的是**改造前**的取值位置。批次 4 之后令牌已拆为 `src/common/tokens.css`（唯一取值）+ `src/common/common.css`（语义别名）；下面提到的「common.css 是 SoT」与「content 三份 CSS 自包含」均已不再成立。

- **设计 token 已统一为 `--fox-*`**（当时 `src/common/common.css` 18.6 KB 是 SoT），并有语义别名 `--color-*`。1.6.0 起 MD3 命名已清理干净（`test/design-token-parity.test.mjs` 在把关）。
- **暗色模式已支持**：`common.css:6` `color-scheme: light dark`，`:110` `@media (prefers-color-scheme: dark)`，共 3 个 CSS 文件覆盖。
- **content 侧样式与宿主页面隔离**（`content/style.css` + `enhanced-style.css` 声明为 `web_accessible_resources`）。
- **语义化 class 约定存在**：`.btn` / `.card` / `.form-control` / `.input-group` / `.switch`（`CONVENTIONS.md` 有明文）。

### 4.2 结构性负担

**`src/options/options.html` = 568 行手写静态结构 / 121 个 id / 113 个 `i18n-text`。**

这是本项目最大的 UI 技术债：整个设置界面是**手写 HTML 骨架 + id 驱动的命令式绑定**（`options-elements.js` 收集 id → `options-events.js` 挂监听 → `options-renderer.js` 手写 DOM 更新）。后果：

- 改一个设置项要动 4 个文件（html / elements / events / renderer）。
- 无组件边界，`options-actions.js` 因此长到 603 行。
- 121 个全局 id 是隐式契约，无静态检查保护。

**对比**：`src/popup/` 只有 462 行且入口 64B——popup 侧明显更健康，因为它页面小。**options 需要的是同样的"薄壳 + 组件"处理，而不是继续在 568 行 HTML 上加行。**

### 4.3 i18n 真实缺陷（已验证）

**Bug 1 — 英文用户看到空白按钮文字。** `default_locale` 是 `en`，但下列 key 只在 `zh_CN` 存在：

```
popupShowOriginal        zh:"显示原文"      en: MISSING   ← src/popup/popup-renderer.js:120 直接赋给 textContent
popupTranslating         zh:"正在翻译..."   en: MISSING   ← src/popup/popup-renderer.js:115 直接赋给 textContent
popupStopTranslation     zh:"停止翻译"      en: MISSING
```

`popup-renderer.js:115,120` 是 `buttonText.textContent = this.browser.i18n.getMessage('popupTranslating')`——**没有 `||` 兜底**。在英文 locale 下 `getMessage` 返回空串 → **按钮文字为空**。对比 `enhanced-context-menu-strategy.js:75` 写了 `|| '正在翻译...'` 兜底，说明作者知道这个坑，只是漏了 popup。

**Bug 2 — 5 个 en 死 key**（zh 缺失且 src 零引用）：`configurationManagement`、`addPrecheckRule`、`syncManagement`、`navSync`、`navConfig`。

**Bug 3 — 无 i18n 完整性门禁**。337 vs 335 的漂移能上线，说明构建/测试里没有任何 key 集合一致性断言。

### 4.4 可访问性

`aria-*` 仅 26 处、`role=` 27 处、`tabindex` **0 处**。对一个 121 个交互 id 的设置界面来说偏低。`options.html` 里的 `<a href="#general" class="nav-link">` 导航是锚点式，没有 `role="tablist"` / `aria-current` 语义。不是阻断性问题，但属于"没做过 a11y pass"。

---

## 5. 功能合理性

### 5.1 功能面（与竞品对齐度：高）

| 功能 | 实现位置 | 评价 |
|---|---|---|
| 页面翻译（replace / append / hover / side-by-side） | `strategies/` 4 个策略 + `display-manager.js` | 策略模式，展开合理 |
| 划词翻译 | `selection-translate.js` | 单一路径（1.7.2 已统一） |
| 输入框翻译（连续空格触发） | `input-handler.js` 282 行 | 触发阈值已夹紧 2–5 |
| 字幕翻译（YouTube / Bilibili） | `subtitle/` 10 文件 | 平台各自策略 + manifest |
| AI 总结（Readability + marked） | `summary/` 9 文件 | 完整，但拖累体积 |
| 悬浮窗（朗读/拖拽/缩放） | `tooltip/` 6 文件 | 完整 |
| 术语表、域名规则、缓存、云同步 | background 侧 | 完整 |
| 引擎 | Google / DeepLX / AI 三种 | 无自建引擎，合理 |

**结论：功能面没有"为了凑数而做"的东西**，方向克制。相比同类扩展（沉浸式翻译、TWP），缺失的能力主要是：PDF 翻译、双语对照的段落级对齐、以及 Chrome 商店上架（已知 R2 轨道）。

### 5.2 膨胀与重叠

- **4 个 display strategy + `display-manager.js`(237) + `display/` 目录 3 文件** —— 显示模式这一件事散在 3 个位置，是最值得合并的 feature。
- **`summary` 9 文件 / `subtitle` 10 文件** 的模块数相对于其体量偏多（`youtube-subtitle-strategy.js` 单文件 343 行 vs `bilibili-subtitle-strategy.js` 1.7 KB / 21.8 KB dist——两者体量差 20 倍，"策略"抽象对一个只有 2 实现且极不对称的场景属于**提前抽象**）。

### 5.3 权限

`permissions: ["storage","scripting","contextMenus","webNavigation"]` —— 克制且必要。无 `tabs`（用 `scripting` 直注）、无 `<all_urls>` host permission（靠 `web_accessible_resources` 的 `matches`）。**这部分做得好，不要动。**

---

## 6. 测试

### 6.1 现状

45 文件 / 10,612 行 / 372 pass。**优点**：真实打包 + jsdom 的集成测试、事件级回归测试、以及 5 道**构建门禁**（i18n 完整性、体积预算、设计系统、规划契约、依赖卫生）。

### 6.2 覆盖缺口（改造前的最大短板，已补）

改造前的覆盖形状是「content 侧 + 纯函数」—— 即**最容易测的部分**，而不是**最容易坏的部分**。后台侧几乎全裸：

```
translator-engine-resolver / translation-cache-store / translation-retry-controller
google-translator / deeplx-translator / base-translator / cloud-backup-store
background-message-handlers（520 行分发中枢）/ navigation-handler / settings-manager
```

补测不是「凑覆盖率」：**这一批补测直接抓出 3 个真实缺陷**（见 9.6 与 9.10）—— 上游请求无超时导致永久悬挂、重试判定漏掉浏览器标准网络错误文案、缓存加载不收敛到 `maxSize`。它们全都落在「最容易坏」的那一类里，正是覆盖率缺口所在。

补测还**证伪了 1 个假设**（9.7）：AI 批量失败降级为逐条单请求的路径原本就是对的，补了 3 条回归测试把它钉住，防止后人「顺手修好」一个不存在的问题。

### 6.3 脆弱测试（已验证）

`assert.match(source, /.../)` 形式的**源码文本断言**存在于 4 处，集中在两个文件：

```
test/options-architecture.test.mjs:344-345   assert.match(source, /bootstrapOptionsPage/);
test/options-architecture.test.mjs:391       assert.match(html, /i18n-text="productSystemSettings"/);
test/options-architecture.test.mjs:393-395   assert.match(html, /class="ui-card-grid"/);  ...
test/options-architecture.test.mjs:398-406   assert.match(actionsSource, /ui-record-item/); assert.match(commonCss, /\.ui-card-grid/); ...
```

**这些断言不验证行为**：把 `<button class="ui-status-pill">` 的 onclick 删掉，只要字符串还在，测试依然 pass；把 class 改个名，逻辑完全正确，测试却 fail。这是**负信噪比**——它们给出虚假的安全感。

（注：`build-manifest` / `design-token-parity` / `message-types` 读源码是**正当的**——它们本来就是"门禁"而非"行为测试"。需要改的只有 `options-architecture` / `popup-architecture` 这两处 UI 快照式断言。）

---

## 7. 重构路线图（已全部执行）

阶段 1–4 的执行记录见第 9 节；逐项「问题 → 修法 → 验证」见 `specs/verifications/refactor-ledger.md`。
本节不再保留已完成的任务清单。

---

## 8. 不要动的地方

- **权限集**：`storage/scripting/contextMenus/webNavigation` 已是克制的最优解。
- **`message-types.js` 单点契约 + handler-map 分发**：这个模式是对的，扩展它，别推翻。
- **`TranslationCacheStore` 的 LRU 实现**：写法标准，只需加体积维度。
- **content 的 feature 目录结构**：已有清晰边界，折叠反而有害。
- **`--fox-*` token 体系**：统一且有用例保护。
- **esbuild + jsdom 的测试基建**：比大多数扩展项目的测试基建更好，继续用。

---

## 9. 落地记录与验收（1.7.4 → 本次改造）

报告发布后已按阶段 1–4 全部实施。本节是**事后验收记录**，每一条都附可复现的验证手段。

### 9.1 验收总账

| 指标 | 改造前 | 改造后 | 变化 |
|---|---|---|---|
| `content/content-script.js` | 492.0 KB | **254.8 KB** | −48.2% |
| `options/options.js` | 377.2 KB | **96.3 KB** | −74.5% |
| `background/service-worker.js` | 296.6 KB | **67.1 KB** | −77.4% |
| `popup/popup.js` | 311.3 KB | **36.5 KB** | −88.3% |
| **四产物合计** | **1477.1 KB** | **454.7 KB** | **−69.2%** |
| 安装包总体积 | ~2.3 MB | **1.2 MB** | −48% |
| 测试数 | 104 | **372** | +268 |
| 测试文件数 | 23 | **45** | +22 |
| i18n 词典 | en 337 / zh_CN 335（5 en-only、3 zh-only） | **en 262 / zh_CN 262** | 集合完全对齐 |
| i18n 死 key | 大量无引用条目 | **0** | 门禁锁死 |
| 运行时依赖 | lit + @chenglou/pretext | **仅 @chenglou/pretext** | 删掉从未被打包的 lit |
| 门禁 | 3 道 | **8 道** | 见 1.5 |

验证命令：`npm test && npm run build:firefox && npm run build:chrome`。

### 9.2 阶段 1：根因修复

**1. 切断 franc 静态依赖**
- 拆分 `src/common/utils.js`（已删除）→ `escape.js` / `timing.js` / `lang-detect.js` / `ids.js` / `language-config.js`
- `lang-detect.js` 把 franc 改为**运行时按需加载的独立资源**：构建期把 `src/lib/franc.bundle.mjs` 复制到 `dist/lib/`，运行期用 `import(browser.runtime.getURL('lib/franc.bundle.mjs'))` 拉取；说明符是变量，esbuild 无法静态解析，因此不会内联。在 franc 就绪前 `detectLang` 走内置字符集启发式（已覆盖 `LANGUAGE_CONFIG` 的 11 种语言），保持同步语义
- 同步更新 import 站点：现共 20 个文件从新模块导入（`grep -rl` 可复现），`src/common/utils.js` 已无任何残留引用

**franc 懒加载的端到端验证**（这条链路任何一环断了都会**静默降级**为启发式，不会报错，所以必须逐环核）：

| 环节 | 验证方式 | 结果 |
|---|---|---|
| 构建期复制资源 | `ls dist/lib/franc.bundle.mjs` | ✓ 354.8 KB |
| esbuild 未内联 | metafile 统计四个入口的 inputs | ✓ franc 在 4 个入口中均为 **0 个输入文件** |
| 运行期可取到资源 | `dist/manifest.json` 的 `web_accessible_resources` | ✓ `lib/franc.bundle.mjs` 已声明（`matches: ["<all_urls>"]`），Firefox 与 Chrome 两个 target 均正确 |
| 失败时降级 | `lang-detect.js` 的 `catch` 分支 | ✓ 静默回落到字符集启发式（覆盖 11 种语言），不抛错 |

注意：`web_accessible_resources` 声明的 `matches: ["<all_urls>"]` 是**有意为之**——franc 要在任意页面上做语言判定，但这个资源仍需被脚本注入后才使用，不会主动暴露。若将来要收紧，可改为按需在 `scripting.registerContentScripts` 里限定。

**2. 切断 `pretext` 泄漏 + 消除反向依赖**
- 旧问题：`src/common/ui-text-layout-service.js` 反向 import `src/content/layout/`，把排版引擎拖进了**不需要排版的 service worker 与 options 页面**
- 新结构：`src/common/text-measurement.js` 只定义接口 + 估算兜底；`src/content/layout/pretext-measurement-engine.js` 提供 `registerPretextMeasurementEngine()` 适配器；`content-runtime.js` 在启动时注入
- **收益**：SW 从 296.6 KB 降到 67.1 KB（−77.4%），options 从 377.2 KB 降到 96.3 KB（−74.5%）

**3. i18n 三处根因**
- `popupShowOriginal` / `popupTranslating` / `popupStopTranslation` 三个 key 源码引用但只在 zh_CN 存在、en 缺失（英文用户会看到空文案）→ 补齐两语言
- 两语言词典存在 **5 个 en-only + 3 个 zh-only** 的不对齐，另有大量源码从未引用的孤儿条目 → 全量清理：en 337 → 262、zh_CN 335 → 262，集合完全相等
- 12 处 `getMessage()` 缺兜底 → 全部补齐（`translator-manager.js` 4、`options-actions.js` 5、`precheck.js` 1、`DomainRuleModal.js` 1、`popup-renderer.js` 1；`grep -cE "getMessage\([^)]*\)\s*\|\|"` 可复现）
- `enhanced-context-menu-strategy.js:109` 的 `contextMenuErrorPrefix` 兜底原本是中文 `'翻译错误'` → 改为英文 `'Error'`（兜底文案必须与 en 词典同语言，否则英文用户会看到中文）

### 9.3 阶段 2：把「已修好」变成「不会退化」

新增 2 个门禁文件（`bundle-budget` / `i18n-integrity`），并在 2 个既有文件（`popup-architecture` / `options-architecture`）里补了行为门禁。每一条都做过**可证伪验证**（故意注入缺陷 → 门禁必须失败 → 恢复 → 必须通过）：

| 门禁 | 断言 | 可证伪验证 |
|---|---|---|
| `test/bundle-budget.test.mjs` | 未压缩体积预算：popup ≤ 120 KB、options ≤ 250 KB、SW ≤ 210 KB、content ≤ 620 KB；另断言 `@chenglou/pretext` 只允许出现在 content 入口 | 是（预算收到 50 KB → 失败；撤销 content 的 pretext 豁免 → 失败） |
| `test/i18n-integrity.test.mjs` | en/zh key 集合相等；源码引用的 key 必须存在；无死 key；内联文案 == 词典；`[i18n-text]` 必须是叶子节点；`[i18n-placeholder]` 必须有兜底属性 | 是（篡改文案 / 篡改 placeholder / 删属性 → 均失败） |
| `test/popup-architecture.test.mjs` | 用**真实 `popup.html`** + zh_CN 词典驱动 `PopupRenderer`，逐个 `[i18n-text]` 元素回查文案是否真的落到可见文本 | 是（回退修复 → 失败） |
| `test/options-architecture.test.mjs` | 源码无裸 id 字面量；每个 `ELEMENT_IDS` 常量在 HTML 中存在；每个 HTML id 要么已登记要么是导航锚点 | 是（注入裸 id / 加隐身 id / 重命名元素 → 均失败） |

另外把 `options-architecture` 里那条纯源码文本断言测试（`product options compose shared UI system primitives…`，12 条断言全是 `assert.match(源码字符串)`）换成了**行为断言**：挂载真实 DOM 后驱动 `renderProviderHealth` / `renderTranslationHistory` / `renderQualityPreview`，断言排序、状态胶囊、空态、XSS 转义、12 条上限、指标卡片；只保留「共享原语定义在 `common.css`、不得反弹回 options 私有类」这类**契约性**断言。

**顺手挖出的一个隐蔽问题**：该测试文件原本用自制的 4 键 i18n 假实现，且写成 `return messages[key] || key`。这让「key 不存在」在测试里表现为「渲染出 key 名」，而不是生产环境的「渲染成空串」——**假实现正好掩盖了 9.2 修的那批 i18n 缺陷**。现已换成共享的 `createI18nMock()`（从真实 `messages.json` 读，缺 key 就是空串）。

**预算余量实测**（未压缩口径，与预算表同口径）：

| 入口 | 实测 | 预算 | 余量 |
|---|---|---|---|
| `popup/popup.js` | 92.5 KB | 120 KB | 23% |
| `options/options.js` | 206.9 KB | 250 KB | 17% |
| `background/service-worker.js` | 170.9 KB | 210 KB | 19% |
| `content/content-script.js` | 568.1 KB | 620 KB | **9%** |

余量是刻意的（日常加代码不会触发，误把重量级依赖拖进来才会失败），但 **content 只剩 9%**，下一个功能若在 content 侧增加依赖需同步调预算，否则会直接卡门禁。

**依赖隔离实测**（metafile 统计）：`franc` 在四个入口中均 **0 个输入文件**——说明 `lang-detect.js` 用变量说明符（`import(getUrl(...))`）确实让 esbuild 无法静态解析，240 KB 已从静态依赖图彻底移除；`pretext` 只出现在 `content/content-script.js`（7 个输入文件）。

### 9.4 阶段 3：补真实覆盖

新增 `test/translation-pipeline-units.test.mjs` + `test/helpers/`，覆盖此前**零测试**的四个核心模块：

- `TranslationCacheStore`：LRU 语义、容量驱逐、防抖持久化
- `translator-engine-resolver`：引擎选择与降级
- `google-translator` / `deeplx-translator`：mock fetch 下的成功 / 超时 / 非 200 / 畸形响应
- `TranslationRetryController`：重试次数、退避、放弃条件

补测过程中**顺带发现并修复了 2 个真实缺陷**（见 9.6），并**证伪了 1 个假设**（见 9.7）。

### 9.5 阶段 4：结构

- **12. effective settings 单点化**：`resolveEffectiveSettings(settings, hostname)` 成为唯一合并入口（`settings-domain.js:148`），`settings-manager.js:165` 是唯一调用方；子域规则匹配、默认值解析、字幕策略回落全部可单测
- **13. background 按域拆分**：`src/background/handlers/` 6 个文件（`translation` / `ai-task` / `settings` / `tab` / `product-data` / `handler-context`），`background-message-handlers.js` 退化为组合器，对齐 content 侧已确立的 handler-map 模式
- **14. display 策略注册表**：`display-strategy-registry.js` 提供 `DisplayStrategyRegistry`，`display-manager.js:11` 通过 `static strategyRegistry` 注入
- **11. options「去 id 化」**：见 9.8 的裁定

### 9.6 补测过程中发现并修复的真实缺陷（2 个）

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 1 | 上游请求无超时：`AbortController` 只在用户主动中止时创建，`signal` 直接交给 `fetch` | 任何上游接口挂住，请求**永久悬挂**，页面停在「翻译中」直到用户手动取消 | 新增 `src/background/translators/request-timeout.js` 的 `createRequestSignal(callerSignal, timeoutMs)`，把「用户中止」与「超时」合成同一 signal，默认 30s，并强制 `dispose()` 释放定时器（成功路径也要释放，否则留下悬挂 timer）；三个翻译器（google / deeplx / ai）均已接入 |
| 2 | `TranslationRetryController#isRetryableError` 的措辞表漏掉了**浏览器标准的网络错误文案** | 同一类瞬时网络故障在不同内核上表现不一致：Chrome 报 `Failed to fetch`、Safari 报 `Load failed` → 被判为不可重试，**用户直接看到失败**；Firefox 报 `NetworkError when attempting to fetch resource.` → 才命中重试。即「重试机制在多数浏览器上对最常见的瞬时故障不生效」 | 补齐 `timed out` / `failed to fetch` / `fetch failed` / `load failed` / `net::err` / `504` |

### 9.7 补测过程中**被证伪**的假设（同样重要）

补测还盯上了一条当初怀疑有缺陷的路径：**AI 批量翻译失败时是否降级为逐条单请求**（若是，N 条文本会放大成 N 次请求）。

核对 `git show HEAD:src/background/translator-manager.js` 的 `#executeAiBatchGroup` 后确认：**该路径原本就是对的**——catch 分支直接返回逐项错误对象（`items.map(item => ({ index, text: '', translated: false, error }))`），从未拆成单请求。`git diff` 也证实 `translator-manager.js` 本次的改动**只有 i18n 兜底，没有批量逻辑变更**。

所以这里没有修复，而是补了 3 条回归测试把该行为钉住：

- `translateBatch uses one AI batch request and caches per item`（真的只发 1 次请求）
- `translateBatch keeps single AI item in batch shape`（单条也走批量形状，不悄悄切代码路径）
- `translateBatch returns per-item errors without single fallback when AI batch fails`

**为什么值得写进报告**：补测的价值不只在于「找到 bug」，也在于把「看起来可疑但实际正确」的路径变成**有测试保护的已知正确**，防止后人“顺手修好”一个不存在的问题。

### 9.8 关于第 11 项（options 组件化）的裁定：**不做，已改为门禁**

原报告把第 11 项描述为「拆成组件（card / input-group / switch），HTML 保持薄壳」。实施前的量化核查推翻了该结论：

**证据**

- options 层**已经**是 id 集中注册制：`options-elements.js` 是唯一查表入口，`ui-constants.js` 定义 115 个常量（改造前 107）。所谓「id 化」的真实缺陷不是「散落各处」，而是**注册表被绕过 13 处**（用 `git diff` + 正则 `getElementById\('...'\)|querySelector\('#...'\)|href="#..."` 可复现）：
  - `options-elements.js:101-103` —— 3 处（`settings-nav` / `toggleLogBtn` / `log-content` 用了裸字符串，而其中两个常量**本来就已定义**）
  - `options-actions.js:264-265` —— 2 处（`test-source-text` / `test-result-area` 完全不在注册表）
  - `options-page-shell.js` —— 2 处（`getElementById('general')` + `a[href="#general"]`）
  - `options-renderer.js:137,145` —— 2 处（`defaultEngineWarning`，且用的是全局 `document` 而非注入的 root）
  - `components/AIEngineModal.js:193,225,372,373` —— 4 处（`aiCustomPromptError` ×2 / `promptHelpBtn` / `promptPlaceholderHelp`）
- 真正需要组件化的部分（模态框、记录列表、主题化下拉）**已经是组件**（`BaseComponent` / `AIEngineModal` / `DomainRuleModal` / `ThemedSelect`），且 `enhanceThemedSelects` 已确立了「保留原生 DOM、渐进增强」的正确模式
- 剩余的 33 个 `input-group` / 11 个 `switch` 是**声明式样板，不是逻辑重复**：每个实例的 label key 与控件 id 都不同，组件化只能省掉 2 行包裹 div，却要让表单结构从可 grep 的 HTML 变成 JS 生成的 DOM

**裁定**：组件化属于 AGENTS.md 明令避免的「为抽象而抽象」，且收益（少量样板行）远低于风险（568 行 HTML、121 个 id 的静默失效面）。因此改为**把注册表变成强制不变量**——这才是「去 id 化」的实质：

- `ui-constants.js` 补齐 8 个常量：`TEST_SOURCE_TEXT` / `TEST_RESULT_AREA` / `SETTINGS_NAV` / `GENERAL_PANEL` / `DEFAULT_ENGINE_WARNING` / `AI_CUSTOM_PROMPT_ERROR` / `PROMPT_HELP_BTN` / `PROMPT_PLACEHOLDER_HELP`
- 13 处裸 id 全部改走注册表（其中 `AIEngineModal` 改用自己的 `#elements`，与全文件模式一致）
- 顺手修掉 `showDefaultEngineWarning()` 用 `innerHTML` 拼接本地化字符串的写法 → 改 `textContent`（把翻译文件从 HTML 注入面里拿掉）
- 删掉 `options.html` 中 CSS 与 JS 都不引用的死 id `settings-content`
- 新增 3 条门禁（见 9.3），从此**任何人再写裸 id 都会挂测试**

**若将来仍要做组件化**，前置条件是把 options 的表单交互补到「改一处挂测试」的覆盖度；当前覆盖度不足以承接 568 行 HTML 的重写。

### 9.9 新增的维护入口

```bash
npm run i18n:check   # 检查内联文案与 en 词典是否漂移（CI 可用）
npm run i18n:sync    # 按 en 词典回写 options.html / popup.html 的内联文案
```

文案改动的正确流程：改 `public/_locales/en/messages.json` → `npm run i18n:sync` → 补 zh_CN → `npm test`。

### 9.10 后续专题分析中又发现并修复 1 个真实缺陷（第 3 个）

**缺陷：同一段文本会因缓存状态返回不同译文。**（可在修复前用 5 行脚本复现）

词汇表被应用**两次**——源侧一次（让引擎看到指定术语）、输出侧又一次（修正引擎把术语翻译回去的情况），而缓存里存的是**中间产物**（引擎原始输出）：

| 路径 | 源侧词汇表 | 输出侧词汇表 |
|---|---|---|
| `translateText` 缓存未命中（`#executeTranslation`） | ✓ 应用 | ✓ 应用 |
| `translateText` 缓存命中 | ✓ 应用（已含在键里） | **✗ 缺失** |
| `translateBatch` 缓存命中 | ✓ 应用（已含在键里） | **✗ 缺失** |
| `translateBatch` → AI 批量（`#executeAiBatchGroup`） | ✓ 应用 | ✓ 应用 |

后果：用户第二次遇到同一段文本时，术语替换静默消失。这不是理论问题——页面翻译会反复碰到相同字符串（导航、表头、模板文案），命中率不低。

**同时暴露的另外两个缓存维度缺失**：

1. 键里**没有引擎**：`createTranslationCacheKey(sourceLang, targetLang, text)`。同一个文本被 Google 翻过之后，切到 DeepLX 或 AI 会直接命中旧结果；更隐蔽的是短文本回退机制（`wordCountThreshold`）**会按文本长度切换引擎**，所以即使引擎设置不变，不同文本也可能由不同引擎产出，却共用同一个键空间。
2. 键里**没有词汇表**：改完词汇表后，旧条目仍然有效，用户会继续拿到旧术语的结果。

**根因不是「漏了一行」，是缓存边界画在了流水线中间。** 只要缓存存的是中间产物，命中路径就必须「把剩下的处理补上」，而两处 hit + 两处 miss 共四处各写一遍，就必然会漂。

**修法（结构性）**：把缓存边界移到流水线**之后**。

```
设置读一次 → 源侧词汇表 → 解析引擎 → 缓存键(引擎,语向,词汇表指纹,改写后源文本)
                                              ↓
                                       缓存里 = 最终用户可见文本
                                              ↓
                              命中：原样返回　　未命中：执行后存最终值
```

于是不对称在**结构上不可能发生**——命中路径不再有任何后处理。具体改动：

- `translation-cache-store.js`：键加入引擎与词汇表指纹（`#createGlossaryFingerprint` 对归一化后的词条按序拼接；顺序必须计入，因为词汇表是逐条 reduce 应用的）。
- `translator-manager.js`：新增 `#prepareTranslation()` 作为唯一的流水线前缀；`translateText` 退化为薄包装（`#translateSingle`）；命中路径直接 `return this.#cacheStore.touch(cacheKey)`；存储改存最终值。
- `translator-engine-resolver.js`：`resolveEngine` / `resolveTranslatorForText` 接受调用方已读到的 `settings`，避免内部重复 `getValidatedSettings()`（该方法每次都会 `structuredClone` 整个设置对象）。另修一处：`#resolveFallbackEngine` 已经拿到了 `settings` 却没用它。

**顺带的性能改善**：`translateBatch` 原先在循环内逐条读设置，现在整批只读一次——对一个 3000 段的页面，少了约 3000 次 `structuredClone(settings)`。

**验证**（全部可复现）：

| 断言 | 修复前 | 修复后 |
|---|---|---|
| 同一输入两次调用得到相同译文 | ❌ `OUTPUT 世界_GLOSS` vs `OUTPUT world` | ✓ 一致 |
| 缓存仍然生效（引擎只调一次） | ✓ | ✓ |
| 改词汇表后用新术语、并重新调用引擎 | ❌ | ✓ |
| 换引擎后不复用另一引擎的缓存 | ❌ | ✓ |
| 关闭词汇表后不再套用旧结果 | ❌ | ✓ |
| `translateBatch` 命中/未命中一致 | ❌ | ✓ |

新增 4 条回归测试钉住（`test/translation-pipeline-units.test.mjs`，含批处理路径），并把缓存键测试从「断言分隔符字面量」改为「断言维度可区分」。

**一个未改的邻近问题（已知，未修）**：引擎返回空字符串时，单条路径返回 `{ text: '', translated: true }`，把「没翻出来」报成成功。改动它会连带影响内容端的渲染与重试行为，属于单独议题，不在本次范围内。

### 9.11 穷尽式审计与批 5–8：把“全部问题”真地清完

用户要求把发现的问题**全部**提出并修复（“不要偷懒不要遗留”）。为此建立了持久台账 `specs/verifications/refactor-ledger.md`（A–M 十二个维度，逐条带行号证据与状态），并按依赖关系分批落地。本节记录批次结果；**逐条明细以台账为准**。

| 批次 | 内容 | 新增真缺陷 |
|---|---|---|
| 5 | F1/F3 性能、K1–K3 缓存与并发 | K1（AI 批量路径绕过单飞锁 → 重复调用付费接口）、K3（`load()` 不收敛到 `maxSize`） |
| 6 | H1–H3 无障碍、I1–I2 测试覆盖 | 模态框 Esc 监听器逐实例挂载 → 叠层一次全关 + 监听泄漏；popup/options 的 i18n 泄漏 |
| 7 | J1–J8 上帝对象/长函数拆分 | **J9**（工具栏提示写死英文）、**J10**（徽标色与设计令牌各自漂移）、幻影失败、`#appendSegment` 死分支 |
| 8 | 字幕管线行为测试（I1/I2） | **M1–M5**（详见台账 M 节） |
| 9 | 规划驾驶舱契约级修复（见 10.6） | **驾驶舱对工具链完全不可见**（读取器返回空集）、**`lit` 是死依赖却被三处文档声称是技术栈** |

**拆分效果（可复查）**：`translator-manager.js` 550 → **110 行**（10 个 static 字段 / 20 个 static 方法 → facade 只留编排）；`translation-handlers.js` 311 行单工厂 → 6 个具名模块；`dom-walker.js` 的 `create()` 235 → **41 行**；`summary.view.js` 的 `constructor()` 105 → **11 行**。

**J8 裁定：不改**。`options-elements.js`（117 行）、`tab-handlers.js`（106 行）、`options-events.js`（107 行）的“长”来自**声明式数据表**而非控制流。按文件摊平会把一张 id→action 表切成 6 个文件、把一份依赖包拆成 6 份参数传递——可读性反而下降。实际改动只针对其中查出的 J9/J10，并把 `options-events.js` 的 5 张表从**事件回调内**提升到实例作用域（原本每敲一个键重建 6 个闭包）。

**J9（真缺陷，i18n）**：`tab-handlers.js:67` 把工具栏悬停提示写成 `'Foxlate (Subtitles Enabled)'`。这是全仓库唯一的 `setTitle` 调用点，也是**唯一**绕过本地化的运行时文案——中文用户开字幕后悬停图标永远看到英文，而全部既有 i18n 门禁都放行（因为门禁只覆盖静态 HTML 的 `aria-label`/`title`）。已修，并补齐门禁。

**J10（真缺陷，重复）**：`badge-state.js` 的徽标色是 `tokens.css` 品牌原语的裸十六进制副本，无门禁、会各自漂移。`setBadgeBackgroundColor` 只接受字面量，所以“写第二遍”不可避免——但可以把它变成**受约束的引用关系**：取值集合必须逐值相等。已修，并补齐门禁。

**一条被证伪的“不足空格”意图**：`DOMWalker.#appendSegment` 原先写作“上一段以非空白结尾且本段以非空白开头 → `push(text.trimStart())`，否则 `push(text)`”。但进入前者的前提就是首字符非空白，此时 `trimStart()` 必然无操作——**两个分支完全等价，这个“不足空格”的意图从未生效**。已按等价形式改写并在测试里钉住现状；真若要改成插入空格，那是**行为变更**（会直接改变线上翻译文本），属于单独的产品决策，不在重构范围内。

**新增的三道门禁（全部用“回退修复 → 必须变红”验证过真阳性）**：
1. `test/i18n-integrity.test.mjs` 新增「运行时传给浏览器 UI 的文案不得写死」：扫 `.setTitle(`/`.setBadgeText(` 的实参，判定范围限定在属性名之后（避开同一对象里的 `path: 'icons/…'`），并剔除 `getMessage(...)` 实参（避开把 i18n key 误报）。回退到写死英文 → 报出两条确切字面量。
2. `test/design-system.test.mjs` 新增「徽标颜色必须是 tokens.css 品牌原语」：`BADGE_COLORS` 的取值集合与 `--fox-color-primary/success/warning` 逐值相等。改一位 → 变红。
3. `test/dom-walker.test.mjs`（131 行）：把 235 行拆分的**文本产出契约**逐字节钉住（标签回滚与序号不复用、块级分隔符不重复、预格式化上下文传递、6 项廉价排查、追加类型判定）。

**最终验收（非声称）**：`npm test` **336 pass / 0 fail**（审计起点 193）；`npm run build:firefox` 与 `build:chrome` 均成功（46–48ms）；`dist` 1.2 MB；`dist/common/tokens.css` 与 `dist/content/content-script.js` 已产出。

**一条工具链教训（已固化）**：用于“回退→跑测→恢复”的验证器 `_verify_regressions.mjs` 最初没有子进程超时，遇到回退后触发的死循环会**永挂**（用户实际观察到“跑了几个小时”）。现已内置文件级备份自愈 + 子进程 `timeout`。另：**验证回退一律用文件 backup，不用 `git stash`**——曾因挂死丢失 stash pop。

---

### 9.12 设计元素重构（Apple 设计原则审视，批 10）

触发：用户加载 apple-design skill 后要求「重构设计元素」。审视对象是**设计元素本身**（动效、材料、排版、无障碍三态、按压反馈），不是页面布局。

#### 一句话结论

**Foxlate 的视觉语言已经不错，但它的「设计系统」有一半是复制出来的，不是继承来的。** 取值散落在 7 个 CSS 文件里各自抄一遍，于是同一种模式出现两三种取值，而唯一的门禁恰好看不见出问题的那一半。

#### 最严重的发现：设计系统被复制而非继承

内容侧三个 CSS（`src/content/style.css`、`src/content/enhanced-style.css`、`src/content/summary/summary.css`）各自维护了一整套暗色 token —— 它们在 `@media (prefers-color-scheme: dark)` 里重新声明 `--fox-*`，而这些取值**已经和 `tokens.css` 漂移了**：

| token | 内容侧副本 | tokens.css |
|---|---|---|
| `--fox-color-border` | `rgba(120,140,164,0.2)` | `rgba(120,140,164,0.18)` |
| `--fox-color-border-strong` | `rgba(189,201,218,0.32)` | `rgba(189,201,218,0.3)` |

漂移的根因是一次 `git checkout -- <3 个内容 CSS>` —— 批 4 把这三个文件去 token 化的成果被整个抹掉，而**没有任何测试变红**。

为什么门禁没拦住？`test/design-system.test.mjs` 的 `extractVars` 用 `/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*$/` 剥离暗色块。这个正则有两个缺陷：

1. `[\s\S]*$` 是贪婪的，隐含「暗色块必须是文件最后一段」；内容侧把暗色块放在文件开头，于是**从该块到文件末尾的全部内容都被当成块内内容丢掉了**。
2. 即使位置正确，被丢掉的正是暗色块本身 —— **块内声明永远不在扫描范围内**。

所以那道「内容侧不得重声明原语」的门禁，在内容侧文件上实际上什么都没扫。这是本次审计里第二次遇到同一形态的问题：**门禁声明存在，检查对象不存在**。

#### 其余发现（按严重度）

| # | 问题 | 具体证据 |
|---|---|---|
| O3 | **别名层 14 条死别名** | `--color-warning-bg`、`--text-xl`、`--radius-xl`、`--space-1/6/8`、`--shadow-sm/input`、`--gradient-brand/warm`、`--transition-base/smooth`、`--state-hover-opacity`、`--color-on-primary-container` 全部零引用 |
| O4 | **两套过渡 token 并行** | `--transition-*` 与 `--fox-transition-*` 取值接近但不一致 |
| O5 | **动效没有参数模型** | 54 处硬编码时长/曲线；无按压档、无出场曲线、无弹簧 |
| O6 | **字距/行高无 token，同一模式三种取值** | 三个「小号全大写标签」分别用 `0.04em` / `0.06em` / `0`；`.title`(15px) 与 `.section-title`(20px) 都写 `-0.02em`（字距未随字号分级，违背 §15）；`font-weight: 720` 裸写 |
| O7 | **无障碍只覆盖暗色与降低动效** | 无 `prefers-reduced-transparency`、无 `prefers-contrast` |
| O8 | **「降低动效」等于关掉一切反馈** | 全局 `transition-duration: 0.001ms !important` 把颜色/透明度交叉淡入一起杀掉 —— 用户反而看不出状态变化（违背 §14） |
| O9 | **按压反馈只存在于主按钮** | `.btn` 里写着 `overflow: hidden; position: relative`（暗示按压态），但只有 `.btn-primary:active` 改了背景色；普通按钮按下毫无反馈（违背 §2「按下即响应」） |
| O10 | **会变化的数值用比例字形** | 版本号、缓存条数（`count / limit`）每次刷新整行宽度跳动（违背 §15） |
| O11 | **字体栈以未分发的 Inter 开头** | Inter 从未随扩展分发，却排在 `--fox-font-sans` 第一位 —— 每个用户都在等一次不会成功的字体回退 |
| O12 | **本批新增的 `--fox-motion-ease-spring` 自己就没人用** | 犯了与 O3 完全相同的错误 |
| O13 | **手写弹簧采样点无校验** | 19 点 `linear()` 若值非单调或未覆盖 100%，动画会倒退或停在半路，且不报错 |

#### 修法（关键设计决策）

1. **内容侧三个 CSS 按「语义映射」重建，不按「值匹配」**。先用值匹配试过一遍，立刻失败：tokens.css 里 `#0891b2` 既是 `--fox-color-primary` 又是 `--fox-color-primary-hover`（暗色模式下两者恰好同值），按值猜会把 hover 态全部映射错。改为读原文语义（`background: var(--fs-primary, …)` → `var(--fox-color-primary)`）逐个映射。

2. **动效参数按 Apple 的模型建**：`damping` + `response` 两参数描述弹簧，`response` 不是 `duration` —— 弹簧没有固定时长。落地为 `--fox-motion-response-{press,fast,,slow,slower}` + `--fox-motion-ease-{standard,emphasized,exit,spring}`。
   **刻意不提供弹性档位**：Apple 说只有「手势本身带动量」时才允许过冲（damping ≈ 0.8）。本扩展的拖拽（悬浮窗、总结面板）都没有吸附目标，没有可过冲的落点 —— 为不存在的场景预留 token 就是提前抽象。
   **出场曲线是入场曲线的镜像控制点**，保证「怎么进来的就怎么出去」（§7）。

3. **按压反馈用自定义属性间接引用时长**。`transition` 是单条声明，但 `transition-duration` 可以读自定义属性：`.btn` 声明 `--btn-press-duration: var(--fox-motion-response-slower)`（松手回弹簧），`.btn:active` 覆写为 `var(--fox-motion-response-press)`（90ms 跟手）。进入 `:active` 用新状态的时长，离开用基础时长 —— 无需重复整条 `transition`。

4. **降低动效改为「压位移、留颜色」**。全局兜底仍是 `transition-duration: 0.001ms !important`，但按选择器把颜色类过渡重新打开（`.btn`、`.form-control`、`.switch-track`、`.modal-*`、`.toast`、`.segment`、`.nav-link`、`.themed-select-*`、`.item-list li` —— 选择器来自实测，是全仓库唯一定义了 `transition` 的元素集合）。`transition-property` 里**刻意不含 `transform`**。

5. **无障碍在 token 层响应**，组件无感：`prefers-reduced-transparency` 把玻璃面板换成实色；`prefers-contrast: more` 加实边框并把次级文字提到正文强度。

6. **弹簧接到该用的地方**：模态框入场（用户点击的直接结果，需要跟手感与落位感），出场走更快的镜像曲线。

#### 新增门禁（9 条，`test/design-system.test.mjs` 共 18 条）

| 门禁 | 钉住的不变量 |
|---|---|
| 解析器自检 | `extractVars` 必须能看见媒体查询里的声明（用样本断言 light 排除、dark 包含） |
| 内容侧不得重声明原语 | 全文扫描（含媒体查询内），不是只看 light 块 |
| 别名必须有读者 | `:root` 里每条别名都要被 `:root` 之外的规则读到；别名套别名不算读者 |
| 动效/排版 token 必须有读者 | `--fox-motion-*`、`--fox-tracking-*`、`--fox-leading-*`、`--fox-font-sans`；比例尺与语义色允许完整 |
| 无障碍四态 | 暗色 / 降低动效 / 降低透明度 / 提高对比度都必须有取值响应 |
| 降低动效保留颜色 | 恢复规则必须覆盖 `.btn`、显式声明 `transition-property`、含 `opacity`、不含 `transform` |
| 按压反馈 | `.btn:active` 必须存在、必须是位移/缩放、必须用最短 response |
| 数值等宽 | `.tabular` 必须存在，且版本号与缓存条数元素必须带它 |
| 字体栈 | 必须以平台关键字开头；任何 CSS 不得引用未分发的字体 |
| 弹簧曲线 | 19 点采样必须单调、值域 `[0,1]`、覆盖到 100% |

**真阳性验证**：6 个注入（暗色块重声明原语 / 死别名 / 死动效 token / 去掉按压反馈 / 把 `transform` 放回降低动效过渡 / 把 Inter 放回字体栈）全部被捕获，恢复后 18 通过；破坏弹簧曲线单调性同样被捕获。

#### 刻意没做的（避免过度设计）

- **不做 `Dynamic Type` 全量接入**：字号已经是 rem、跟随系统缩放，但比例尺只覆盖 popup/options 这两个固定布局的界面。内容侧注入的是宿主页面的排版，不应由扩展改写。
- **不引入 UI 框架**：`DomainRuleModal extends BaseComponent` 够用，Lit 那条路已被 SCOPE 显式否决（见 10.6）。

### 9.13 对审计自身的一次核实（批 11）

用户问「发现的所有问题都修复了吗」。逐项读代码核实后，答案是**几乎全部已修，但这份台账本身有一个必须记下来的缺陷**。

#### 台账的「逐项状态列」曾经对读者撒谎

台账里每一行都有状态列。批次表勾了「批 1–8 完成」，但**逐项状态列有 22 项仍标 `TODO`** —— B1–B5、C1–C4、E1–E3、E5、F1–F4、G2、H1–H3、K1–K3，以及 D1 的「后果」子行。

也就是说：读者逐条查台账，会以为 22 个问题没修；而实际上它们都在批 1–10 里修完了，只是状态只在**批次表**那一处被更新。这正是我一路在修的那类问题的又一次出现 —— **同一事实写在两处，各自漂移**。这次的受害者是审计记录本身。

修法有三层：
1. 逐项按代码核实后更新 26 行状态（22 个 `TODO` + D1 后果 + E5 裁决）。
2. 在台账顶部写明「**本列是逐项真相，修复落地时必须同步更新**」，并记录这次发生过的漂移。
3. 新增 `## 不修的项与理由（WONTFIX 汇总）` 一节 —— 让「没改」与「忘了改」在记录里可区分。

#### 本批唯一真实遗留的缺陷：C5（同一份逻辑写多遍）

`defaultLogError` 在仓库里有三份实现，差异**只在于是否吞掉 `AbortError`**：

| 位置 | 行为 |
|---|---|
| `src/content/translation/page-translation-job.js` | 吞掉 AbortError |
| `src/content/input/input-translation-service.js` | 不吞 |
| `src/background/service-worker.js` | 不吞 |

这类问题的代价不在于行数，而在于**策略散落在调用点**：想知道「谁吞掉中止错误」，得把三份实现都读一遍。

修法：合并为 `src/common/error-logger.js` 的工厂，**把中止策略变成显式参数**：

```js
createErrorLogger({ context: 'PageTranslation', source: 'content', quietAbort: true })
```

**顺带修掉一个真实缺陷**：content 侧原实现直读 `error.message` / `error.stack`，当 `error` 是 `null` 或 `undefined` 时，**错误处理器自己会再抛 `TypeError`** —— 最需要它工作的时刻它反而制造第二个错误。共享实现改为 `error instanceof Error ? error.message : String(error)`。

替换了 6 个调用点（`page-translation-job.js`、`translation-dispatcher.js`、`input-translation-service.js`、`translation-handlers.js` 两处、`service-worker.js`），新增 `test/error-logger.test.mjs`（5 条，含 `null` / `undefined` / 非 Error 对象三类入参）。

**真阳性验证**：把 content 侧的旧实现放回去 → 测试变红（空指针与上下文断言同时失败）；恢复后 5 通过，源码与备份逐字节一致。

#### 逐项核实后的结论

| 类别 | 条目 | 状态 |
|---|---|---|
| 安全（A1–A4） | HTML 净化器、属性转义、URL 协议校验 | 已修 |
| 死代码（B1–B5） | 5 项删除 + 过度导出收敛 | 已修 |
| 重复逻辑（C1–C5） | 5 项收敛，含本批的日志工厂 | 已修 |
| 正确性（D1–D2、G1） | 重复广播、`__DEBUG__`、错误上报 | 已修 |
| 架构分层（E1–E4） | 分层倒置、设计 token、订阅者隔离 | 已修；E5 裁决为不改（理由见台账） |
| 性能（F1–F4） | 批量路径、双重查缓存、广播次数 | 已修 |
| 可观测性（G2） | `console.log` 残留 0 处 | 已修 |
| 无障碍（H1–H3、O7–O9） | 键盘路径、模态框焦点、四态媒体查询、按压反馈 | 已修 |
| 测试（I1–I2） | 字幕管线、tooltip、错误记录器行为测试 | 已修 |
| 上帝对象（J1–J10） | 4 处拆分 + J8 裁决 + 2 处新缺陷 | 已修 |
| 缓存并发（K1–K3） | 单飞去重、重复查缓存、容量收敛 | 已修 |
| 协议（L） | 核查结论良好 | 无需修改 |
| 字幕管线（M1–M5） | 5 处真实缺陷 | 已修 |
| 规划驾驶舱（N） | 4 文件契约 + 死依赖 | 已修 |
| 设计元素（O1–O13） | 设计系统复制而非继承 + 12 项 | 已修 |

**没有未修复的条目。** 未改的 6 项全部是评估后的裁决（WONTFIX），理由逐条写在台账里。

## 10. 路线与实现方案的再审视（专题）

第 0–9 节回答的是「这个项目现在怎么样」。本节回答一个不同的问题：**方向与方案本身对不对。**

### 10.1 路线层：最上游的问题不是选错了方向，而是规划层自己不一致且落后现实

三个规划文件互相矛盾，且都落后于真实仓库：

| 事实 | `state.yaml` | `release-plan.yaml` | 真实仓库 |
|---|---|---|---|
| 版本 | `1.6.2` | `target_version: 1.7.0` | **`package.json` = 1.7.4** |
| HEAD | `20921b3` | — | **`7b46f5e`** |
| 当前轨道 | `release_track: R2-reach` | `R1.7 (e06) status: active`；`R2 status: planned` | 两者说法相反 |
| 活跃 epic 的跟踪 | `execution-status.yaml` 只列 e01/e04（均已归档），**完全没有 e06** | e06 带 4 个 story | — |
| 交接建议 | `handoff.note` 建议做 `e02`（Chromium）或 `e05`（打磨） | e06 才是 active | 建议与实际在做的相反 |

**这不是「文档没更新」的洁癖问题。** `specs/` 被定位为决策驾驶舱（YAML 是 SoT），而路线选择、下一步做什么都从这些文件读。当它们自己打架、且都停留在 1.6.2，任何「按 specs 决策」的流程都建在错前提上——包括「R2 还没做」这个判断本身。

**建议（按收益排序）**：
1. `state.yaml` 的 `product.version` 与 `git.head` **不再手抄**——版本已经是 `package.json` 单一事实源（构建已经这么做了），head 同理；交给 preflight 注入或直接删字段。
2. `execution-status.yaml` 改为从 `release-plan.yaml` 派生（或删掉），避免两处各写一份进度。
3. `handoff.note` 里把「下一步做什么」这类**带时效的叙述**换成指向 `release-plan.yaml` 的单一出处。

### 10.2 R2（Chromium reach）被当成工程轨道，但它真正的阻塞点不是工程

| e02 自述的工作 | 实际状态 |
|---|---|
| packaging | ✅ 已完成（`build.js` 双目标；本次 `build:chrome` 通过）|
| SW lifecycle | ✅ 已完成（MV3 + `browser-polyfill.js` 已覆盖 `browser`/`chrome` 差异）|
| store readiness | ❌ 未做 —— 商店素材、隐私政策入口、权限说明 |

而 `e02` 的 `stories: []`——一个列为 `planned`、WSJF 8 的轨道，故事列表是空的。

**结论**：R2 的前两项已经完成，剩下的是发布准备工作。把它笼统地称为「轨道」会让工程资源持续流向已完成的部分（构建、兼容性），而真正阻塞上架的（素材、合规、商店流程）没人归因。

**建议**：把 e02 拆成「已知的 Chromium 特有工程遗留项」（若有，逐条列出）与「发布清单」（非工程）。之前把 R2 说成「reach」在方向上没错，但在执行上缺一个能真正被推进的载体。

### 10.3 R1.7（UI 重设计）与 R2/R3 的资源分配是错配的，而 e05 里埋着一个正确性问题

`e06`（Calm tool chrome redesign）是当前 active 的 epic，带 4 个 story（P1 tokens+popup+内容面板、P2 options 与模态框、P3 summary 对齐、P4 深色模式 + a11y）。

客观事实：
- 设计系统本身是**自洽且已落地**的（第 4 节：cyan/glass `--fox-*` 自 1.6.0 起已发布）。所以 e06 的收益是**观感与一致性**，不是能力或触达。
- 同一份 `release-plan.yaml` 里，`e05`（residual polish）把三项挂在「可选打磨」：empty-result toast、copy-on-panel、pixel-level error chrome。
- 而 **empty-result 不是打磨，是正确性缺陷**：第 9.10 节末尾记录的单条路径 `{ text: '', translated: true }` 正是「引擎返回空字符串却上报成功」，内容端会把失败当成功。它被埋在一个 WSJF 3 的 backlog 里。

**建议**：
1. 把 empty-result 从 e05 提到正确性修复（它影响状态语义，不只是一句提示）。
2. e06 里 **a11y（P4）** 对应的是第 4.4 节查出来的真实缺口，保留；而「pixel-level error chrome」这类纯观感项可以降到最低优先。
3. 坦白说：当 R2（触达）和 R3（差异化）都还在 backlog 时，把唯一 active 的工程轨道花在 chrome 重设计上，是一次明确的**权衡**。既然是权衡，就应该显式写下来（收益是什么、代价是 R2/R3 推后多少），而不是让它默认发生。

### 10.4 R3 的二选一有明确答案：选 Native Translator API

`e03` 的描述是「Native Translator API OR standalone panel (pick one)」，status `backlog`。

**为什么这个选择并不对称：**

| | Native Translator API | standalone panel |
|---|---|---|
| 新增能力 | 端上、免费、离线、文本不出本机 | 无——它是一个**容器** |
| 竞品能否轻易复制 | 不能（取决于浏览器能力，不是写代码快）| 能（纯 UI） |
| 落地成本 | 低——见下 | 中高（新面板 = 新 UI + 新状态 + 新布局） |
| 与现有架构的关系 | 几乎是「再加一个翻译器」 | 与 display strategy / tooltip 职责重叠 |

**成本为什么低（可直接验证的架构优势）**：

- 引擎注册表就是 3 项：`deeplx` / `google` / `ai`（`translator-manager.js:15-19`）。
- 翻译器接口已被统一为 `translate(text, targetLang, sourceLang, options, signal) → { text, log }`（本次新增的超时、重试、缓存全部挂在这个接口**之上**）。
- 因此新增一个端上引擎 = 写一个 `translate()`，**白拿**缓存、超时合成、重试与退避、引擎下拉项、短文本回退候选。
- `getTranslator()` 返回 `undefined` 时已有明确的 no-translator 错误路径（第 9.10 节的代码），所以「浏览器不支持」可以静默回退到现有引擎。

**必须同时说清楚的两个约束**（否则这个建议就是纸上谈兵）：

1. **Firefox 没有这套 API**。项目是 Firefox-first，所以原生引擎只能是**Chrome 上的增强**，不能是唯一路径 → 必须特性检测 + 回退。这正好也是 R2 的真实内容之一。
2. **它不能替掉现有的网络引擎**，只能成为第 4 个选项；但对「不想把网页内容发给任何服务器」的用户，它是现有三个引擎**都给不了**的东西——而这正是翻译类扩展最被在意的一点。
3. 附带收益：端上 `LanguageDetector` 或许能替掉 240 KB 的 franc（见 9.2 的懒加载分析），值得在实现时一并评估——但**不要为了减体积而引它**，引它的理由是翻译本身。

### 10.5 实现方案层：四类不合理

**① 缓存边界画在流水线中间（已修，见 9.10）**
一份逻辑（词汇表）写在 4 个地方，其中 2 个写漏——这不是粗心，是边界画错的必然后果。

**② 「策略」抽象下的两个实现体量差 5.8 倍，而且难测的那半没测**

| 文件 | 行数 | 有行为测试 |
|---|---|---|
| `youtube-subtitle-strategy.js` | **343** | ✗（仅在注入清单里被断言存在）|
| `bilibili-subtitle-strategy.js` | **59** | ✗ |
| `subtitle-translation-client.js` | 34 | ✗ |
| `video-subtitle-observer.js` | 94 | ✗ |
| `youtube-subtitle-parser.js` | 73 | ✅ 分段归一化 |
| `subtitle-manager.js` | 116 | ✅ 状态注册 |

字幕模块共 10 个文件 / 1370 行，**只有 2 个文件有真实行为断言**。抽象本身不亏，但真正的复杂度（343 行）不在「策略模式」里，而在「YouTube 播放器接口适配」里——这块恰恰是零测试。

**建议**：不动抽象，而是把「平台适配」与「字幕翻译管线」切开，先给管线补测试（它可以用假的事件流驱动，成本低、覆盖高）。

**③ 词汇表双次应用是有意设计，却没有测试钉住这个意图**
源侧一次（让引擎看到指定术语）+ 输出侧一次（修正引擎把术语翻回去）。两者都保留是合理的，但在本次修复之前，**没有任何测试表达「两处都必须生效」**。现已用 4 条回归测试钉住。

**④ `wordCountThreshold` 让「同一个引擎设置」下不同长度的文本走不同引擎**
机制本身合理（短文本浪费 AI 额度没意义），但它是一个**语义地雷**：它使「引擎由谁提供」不完全由设置决定。在缓存键补上引擎维度之前，它与 ① 叠加，会产生完全无法解释的现象（同一句话短的走 Google、长的走 AI，却互相命中）。
现状：切换会写入日志（`短文本切换：...`）且已进缓存键，可以认为是合理的；但它是那种「加了新维度就必须重新审视」的点——例如若将来做**跨设备同步缓存**，这个维度必须一起同步，否则两端结果不一致。

**⑤ i18n 的重复本身没有被消除**
阶段 1D 做的是「消除漂移」（内联文案 == en 词典已由门禁锁住），这是对的、也是当务之急。但 `options.html` / `popup.html` 的内联文案仍然是**手工维护的第二份拷贝**。中期可选：把静态骨架改成由 locale 驱动的渲染，从根上消灭第二份拷贝。这是可选项——现在的门禁已经让漂移不可能静默发生。

### 10.6 路线层的最上游缺陷（已修）：驾驶舱与工具链契约脱节

10.1 指出「规划层自己不一致」，当时把它描述成「落后 3 个版本的抄写问题」。按 bigpowers 框架契约复查后发现：**那只是表象。真问题是这些文件从形状上就不符合框架的读取契约，导致驾驶舱对工具链完全不可见。**

**证据（用框架自己的读取器跑，不是目测）**：`bigpowers/dashboard/src/loaders/reader.js` 是框架读这些文件的地方。修复前把它指向本仓库：

| 读取项 | 修复前 | 应有值 | 原因 |
|---|---|---|---|
| `activeFlow` | `null` | `planning` / `build_epic` / `fix_bug` | 键被包在 `session:` 下；读取器只认顶层 `active_flow` |
| `activeEpic` / `activeStory` | `null` | 史诗 / 故事 ID | 同上（`session.epic` / `session.story`） |
| `epicCycle` | `{}` | `{current_step, …}` | 该键从未被写过 |
| `release` | `{}` | 发布字段 | 用了自创的 `product.version` / `release_track` |
| `execution-status` 条目数 | **0** | 12 | 文件是扁平 map；读取器与 Allure 报告只读 `development_status:` 嵌套 |

即：**驾驶舱的机器可读那一半，对所有消费者都是空的。** 而这四个文件对同一件事（现在发布到哪、哪条轨道在做）给出四种答案：

| 来源 | e01 | e04 | e06 |
|---|---|---|---|
| `execution-status.yaml`（修复前） | done | done | **缺条目** |
| `release-plan.yaml`（修复前） | done | done | active |
| `epics/archive/*/epic.yaml` | **planned** | **in_progress** | **胶囊不存在** |
| `SCOPE_LATEST.yaml` | 1.6.1 已发布 | 1.6.2 已发布 | in_scope |
| 真实（`changelog.md`） | 1.6.1 | 1.6.2 | 1.7.0 calm chrome |

另加三处硬伤：`version_target: "1.7.0"` 声称的目标版本**早已发布**；`version_shipped` 漏掉 1.6.3 与 1.7.1–1.7.4；一个被声明为 `active` 的史诗 e06 **根本没有胶囊目录**（`specs/epics/e06-*` 不存在）。

**为什么这是「路线不合理」而不是洁癖**：`release-plan.yaml` 与 `state.yaml` 是决策输入。当它们给出四种互斥答案、机器侧又全为空时，「下一步做什么」只能靠人回忆——这正是同一批文件能在 3 个小版本里漂移 4 次的结构原因。

**修复（按框架文档的契约，不自创 schema）**：
- `state.yaml` → 文档规定的规范形状（顶层 `active_flow` / `active_epic_id` / `active_story_id` / `release` / `epic_cycle` / `bug_cycle` / `git` / `handoff`）。**删除**自创的 `product.version`、`release_track`、`session:` 包装与 `handoff.note`——它们都是其他文件 SoT 的副本。
- `execution-status.yaml` → `development_status:` 嵌套，12 条**有发布产物可证**的条目。规则是「查不到就不写」：e06s03 / e06s04 故意留空，因为没有任何版本产物能证明它们完成，写上去就是把猜测写成事实。
- `release-plan.yaml` → `release.version`（= `package.json`）；史诗条目只留 `id` / `title` / `capsule_dir` / `wsjf` / `track`，**移除 status 副本**（框架把「Status in release-plan」明列为 anti-pattern）；e05 移入 `backlog:`（不占路线）；e06 保留但 `capsule_dir: null` + `note` 说明缺口——**保留缺口比抹掉它更诚实**。
- `SCOPE_LATEST.yaml` → 补齐 `scope-work` 要求的 7 个必备字段（此前只有 `in_scope` / `out_of_scope` 两个）；`out_of_scope` 每项补上理由（框架要求「每项注明为何排除」以防 scope creep）；`version_shipped` 补齐 1.6.3 与 1.7.1–1.7.4；`version_target` 改为 `1.8.0`（R3 目标；R2 走 1.7.x 补丁线）。

**门禁**（`test/planning-state.test.mjs`，16 条）：版本唯一 SoT；禁止状态副本；禁止手抄 commit hash；轨道状态与所辖史诗状态不得矛盾（一个 `done` 轨道不得留有未完成史诗，一个非 `done` 轨道不得「所辖史诗全部完成」——后者正是历史漂移形态）；`capsule_dir` 必须真实存在；`version_shipped` 每一版都必须在 `changelog.md` 里找得到；`version_target` 不得是已发布版本。

**真阳性验证**（回退注入 → 必须变红）：退回扁平写法 → 5 失败；史诗加回 `status` → 1 失败；`version_target` 设成已发布的 1.7.0 → 1 失败；恢复后 16 通过。修复后框架读取器已能正确解码：`activeFlow: "none"`、`epicCycle` 有值、`execution-status` 12 条。

**同批的第二个真实缺陷：`lit` 是死依赖，而三处文档声称它是技术栈**

`src/lib/lit.js`（lit@3.3.1 的 vendored 副本，15.5 KB）与 `package.json` 里的 `"lit": "^3.3.1"` **都没有任何引用**：全仓库 `from 'lit'` 命中 0 处，`dist/` 里也没有 lit，`options` 的模态框是 `DomainRuleModal extends BaseComponent`（纯 DOM）。

而同时：
- `AGENTS.md:10` 写 `Stack: … · Lit 3 · …`
- `specs/tech-architecture/tech-stack.md:10` 写 `| UI | Lit 3 (options modals/components) … |`，末行写 `Deps (runtime): lit, @chenglou/pretext`
- `SCOPE_LATEST.yaml` 与 `UI_REDESIGN_DIRECTION.md` 把「Lit rewrite of popup/options」列为 **out_of_scope**

即：**一个已被否决的方向，其残留物留在了仓库里，并被文档追认为现行技术栈**。而 `AGENTS.md` 是每个 agent 的输入——这条错误会持续误导后续所有决策。

**修复**：删除 `src/lib/lit.js`；`npm uninstall lit`（连带移除 6 个包）；改正 `AGENTS.md` 与 `tech-stack.md` 的栈描述，并在 tech-stack 里写明来龙去脉。

**门禁**（`test/dependency-hygiene.test.mjs`，6 条）：`src/lib/*` 每个 vendored 文件必须有**生产侧**引用；`src/lib` 不得与 `dependencies` 重复；每个 `dependencies` 必须真的被 `src/` 引用；`src/` 不得引用任何 devDependency；`src/` 不得引用未声明的裸模块。

> 这道门禁的第一次实现有个真实缺陷：它把自己算成了引用者（本文件注释里写了 `src/lib/lit.js` 这个文件名），于是「把死文件放回去」的注入**依然全绿**。修法是引用者集合限定为生产侧并排除门禁自身——**门禁必须先骗过自己，才能证明它没被骗过**。

**真阳性验证**：放回死文件 → 1 失败；`dependencies` 塞未使用的 lodash → 1 失败；`src/` import devDependency → 1 失败；引用未声明裸模块 → 1 失败；恢复后 6 通过。

### 10.7 一句话总结

- **路线层最大的问题不是选错了方向，而是规划层与工具链的契约脱节**（4 个文件给出 4 种答案，且机器侧读出来全是空）。修这个成本几乎为零，收益是后续所有决策的前提正确。
- **R2 不是工程问题而是发布问题，却挂着空故事列表**；**R3 的二选一有明确答案**（Native Translator API，成本低而竞品难复制）；**R1.7 是权衡不是错误**，但应显式记账。
- **实现方案层最贵的一类问题是「同一份逻辑写多遍」**——缓存边界（已修）、词汇表（已钉测）、字幕平台适配（未测）都属此类；**「声明了却没被用」是同一问题的镜像**（lit 既是死文件又是死依赖，还被文档追认为技术栈）。

---

## 附录 B：复现命令

```bash
# 代码规模
find src -name "*.js" | xargs wc -l | sort -rn | head -21

# 构建产物体积
npm run build:firefox && find dist -name "*.js" -printf "%s %p\n" | awk '{printf "%8.1f KB  %s\n",$1/1024,$2}' | sort -rn

# 单个产物的依赖构成（本报告所有体积归因的来源）
npx esbuild src/content/content-script.js --bundle --minify --format=iife --charset=utf8 \
  --define:__DEBUG__=false --drop:console --drop:debugger \
  --metafile=/tmp/mf.json --outfile=/tmp/cs.js
node -e "const m=require('/tmp/mf.json');const o=Object.values(m.outputs).find(x=>x.entryPoint);\
const i=Object.entries(o.inputs).map(([k,v])=>[k,v.bytesInOutput]).sort((a,b)=>b[1]-a[1]);\
let s=0;for(const[,b]of i)s+=b;for(const[k,b]of i.slice(0,18))console.log((b/1024).toFixed(1).padStart(8)+' KB '+(100*b/s).toFixed(1).padStart(5)+'%  '+k)"

# i18n 漂移
node -e "const en=require('./public/_locales/en/messages.json'),zh=require('./public/_locales/zh_CN/messages.json');\
const e=Object.keys(en),z=Object.keys(zh);\
console.log('en',e.length,'zh',z.length);console.log('en-only',e.filter(k=>!zh[k]));console.log('zh-only',z.filter(k=>!en[k]))"

# 零测试覆盖模块
for f in $(find src -name '*.js' -not -path 'src/lib/*'); do b=$(basename "$f"); \
  grep -rq "$b" test/ 2>/dev/null || echo "$f"; done

# 规划驾驶舱（路线层）契约 —— 永久门禁
node --test test/planning-state.test.mjs
# 期望 16 pass。关键两条：execution-status.yaml 必须有 development_status 嵌套；
# release-plan.yaml 的史诗不得带 status

# 依赖声明与引用一致性
node --test test/dependency-hygiene.test.mjs
# 期望 6 pass。把死文件示例放回 src/lib/ 应立刻变红

# 【取证方法】用框架自己的读取器看驾驶舱（批 9 的原始证据就是这么取的）：
#   bigpowers/dashboard/src/loaders/reader.js → readStateYaml / readExecutionStatus
# 注意：框架 dashboard 的 dependencies（js-yaml/blessed/chokidar/express）未随包安装，
# 所以调用它之前需要自备 js-yaml（例：`npm i --prefix /tmp/y js-yaml@4` 后设 NODE_PATH=/tmp/y/node_modules）。
# 这是 upstream 部署问题；仓库自身的门禁不依赖它。

# 脆弱断言
grep -rn "assert.match(source\|assert.match(html\|assert.match(commonCss" test/*.mjs
```
