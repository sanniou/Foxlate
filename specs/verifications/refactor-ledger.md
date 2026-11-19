# Foxlate 全盘重构 · 问题台账

> 穷尽式审计记录。每条含：编号 / 证据（文件:行） / 影响 / 状态。
> 状态：`TODO` 待修 · `FIXED` 已修 · `WONTFIX` 评估后不修（须写明理由）
>
> **本列是逐项真相，修复落地时必须同步更新**。只更新「修复进度」表、不更新本列，
> 会让这份台账对读者撒谎 —— 而台账是这套审计唯一的权威记录。（曾发生过：22 项已修复
> 却仍标 `TODO`，因为它们只在批次表里被勾掉了。）

---

## A. 安全 / 注入

| # | 证据 | 问题 | 影响 | 状态 |
|---|---|---|---|---|
| A1 | `src/content/summary/summary-message-renderer.js:162` `contentDiv.innerHTML = marked.parse(content)` | AI 返回的 Markdown 未经净化直接 innerHTML | **已实证**：`marked` v16 原样放行 `<script>`、`<img src=x onerror=...>`、`<iframe>`、`javascript:` URL。内容来自第三方 LLM，而 LLM 的输入是被总结的**任意网页**→ 页面可用 prompt injection 让 AI 输出恶意 HTML → 在内容脚本隔离世界中执行 → 可访问 `browser.*`（读 storage、冒充内容脚本发消息），等于全扩展失陷 | **FIXED** |
| A2 | `src/content/summary/summary-message-renderer.js:55` `` messageEl.innerHTML = `...<textarea rows="3">${content}</textarea>...` `` | 编辑态把消息原文插入 `<textarea>` 未转义 | `</textarea><img src=x onerror=...>` 可逃逸；与 A1 同类 | **FIXED** |
| A3 | `src/options/options-renderer.js:112,113` `data-domain="${rule.domain}"` | 属性值未转义 | 域名规则来自用户输入与云同步；可属性注入。**同文件 110 行文本内容却转义了** → 说明是遗漏而非有意 | **FIXED** |
| A4 | `src/options/options-actions.js:347,348` `data-backup-id="${backup.id}"` | 属性值未转义 | 云备份列表 id 未转义 | **FIXED** |

**对照（已正确，不要改）**：`src/content/strategies/replace-strategy.js:67,71`、`append-strategy.js:79`、`tooltip-content-view.js:32` 均 `escapeHtml(...)`；`summary-suggestions-view.js:90` 用 `textContent`。即"文本转义、属性遗漏"是系统性遗漏模式，不止一处。

---

## B. 死代码 / 过度导出

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| B1 | `src/common/lang-detect.js:96` `export function setLanguageDetector(detect)` | 全仓库零引用（文件内仅定义 1 次） | FIXED |
| B2 | `src/common/context-extractor.js:114` `export function createPromptWithContext(basePrompt, context)` | 全仓库零引用 | FIXED |
| B3 | `src/content/summary/summary.js:443` `export function destroySummary()` | 全仓库零引用 → summary 无销毁路径 | FIXED |
| B4 | `src/content/quick-action-panel.js:131` `export async function translateQuickSelection(options)` | 仅转发给 `translateSelectionPayload`，唯一注释是 `@deprecated`；全仓库零调用 | FIXED |
| B5 | 12 处"导出但仅本文件使用"：`isLanguageDetectorReady`、`detectLang`（`src/common/lang-detect.js`）、`mergeSelectors`、`findMatchingDomainRule`、`calculateEffectiveSubtitleSettings`、`calculateEffectiveSelectorSettings`、`DOMAIN_RULE_OVERRIDE_KEYS`、`DOMAIN_RULE_WRITABLE_KEYS`（`src/common/settings-domain.js`）、`injectCSSIntoRoot`（`src/content/translatable-elements.js`）、`pretextMeasurementEngine`（`src/content/layout/pretext-measurement-engine.js`）、`FOXLATE_EXTENSION_SELECTOR`（`src/content/page-translation/page-translation-elements.js`）、`initializeSubtitleManager`（`src/content/subtitle/subtitle-manager.js`） | 暴露了不必要的公共契约面 | FIXED |

---

## C. 重复逻辑（同一份逻辑写多遍）

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| C1 | **6 份逐字节相同** `function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }`：`src/common/ui-text-layout-service.js:3`、`src/content/layout/translated-content-layout-service.js:3`、`src/content/layout/floating-layout-service.js:5`、`src/content/layout/summary-layout-controller.js:4`、`src/content/layout/resize-controller.js:1`、`src/options/components/ThemedSelect.js:13` | 无共享实现 | FIXED |
| C2 | **3 份逐字节相同** `function defaultGenerateId() { return self.crypto.randomUUID(); }`：`src/content/element-translation-controller.js:9`、`src/content/content-runtime.js:17`、`src/content/translation-batch-queue.js:9` | 无共享实现 | FIXED |
| C3 | **2 份逐字节相同** `function getViewport()`：`src/content/layout/floating-layout-service.js:9`、`src/content/layout/summary-layout-controller.js:8` | 无共享实现 | FIXED |
| C4 | `debounce` 两份：`src/common/timing.js:8`（已存在的共享实现）与 `src/content/input/input-text-utils.js:3` | **共享模块已存在却被绕过**，最典型的一处 | FIXED |
| C5 | `defaultLogError` 两份：`src/background/script-injector.js:4`、`src/content/page-translation-job.js:15` | **两者行为不同**（后者含 `if (error && error.name === 'AbortError') return;`），不可盲目合并 | FIXED |

---

## D. 正确性缺陷（含已实证）

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| D1 | `src/common/settings-manager.js` — `saveLocalSettings()` 既 `await browser.storage.local.set(...)`（触发 `storage.onChanged` → 静态块监听器 → `notifySettingsChanged`），**又**显式 `await SettingsManager.notifySettingsChanged(settingsToSave, oldSettings)` | **一次保存触发两次 `settingsChanged`** | **已实证**：用真实语义的 browser mock（`set()` 会触发 `onChanged`）打包运行真实 `settings-manager.js` → `setCount=1`、`getCount=3`、`emissions=2` | **FIXED** |
| | 后果 | 订阅者双跑：`src/background/service-worker.js:164`（`JSON.stringify` 全设置 ×5 键比较 + `TabStateManager.getActiveTabIds()` + 逐标签页 `tabs.sendMessage` + `runtime.sendMessage` 广播 + `updateConcurrencyLimit()` + `updateCacheSize()`）与 `src/options/options-app.js:102`（重渲染）。等于**每次保存都向所有标签页广播两遍**，内容脚本可能重复触发重译 | FIXED |
| D2 | `build.js:460` `define: { '__DEBUG__': String(isWatchMode) }`，但全部 4 处调用点写的是 `globalThis.__DEBUG__`：`src/background/service-worker.js:145,175,206`、`src/content/content-runtime.js:305` | esbuild 的 `define` **只替换裸标识符**，不替换成员表达式 | **已实证**：最小样例 `--define:__DEBUG__=true` → 输出中 `if (globalThis.__DEBUG__)` 原样保留（运行时恒 falsy），而 `if (__DEBUG__)` 被替换为 `if (true)`。且全仓库无任何地方给 `globalThis.__DEBUG__` 赋值 → **4 处调试日志在所有构建模式下都是死代码** | **FIXED** |
| D3 | `AbortController` 只在用户主动中止时创建，`signal` 直接交给 `fetch` | 任何上游接口挂住，请求**永久悬挂**，页面停在「翻译中」直到用户手动取消 | 新增 `src/background/translators/request-timeout.js` 的 `createRequestSignal(callerSignal, timeoutMs)`：把「用户中止」与「超时」合成同一 signal，默认 30s，并强制 `dispose()` 释放定时器（成功路径也要释放，否则留下悬挂 timer）。三个翻译器（google / deeplx / ai）均已接入 | FIXED |
| D4 | `TranslationRetryController#isRetryableError` 的措辞表漏掉浏览器标准网络错误文案 | 同一类瞬时网络故障在不同内核上表现不一致：Chrome 报 `Failed to fetch`、Safari 报 `Load failed` → 被判为不可重试，**用户直接看到失败**；Firefox 报 `NetworkError when attempting to fetch resource.` → 才命中重试。即「重试机制在多数浏览器上对最常见的瞬时故障不生效」 | 补齐 `timed out` / `failed to fetch` / `fetch failed` / `load failed` / `net::err` / `504` | FIXED |

---

## E. 架构 / 分层

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| E1 | `src/common/settings-domain.js:4` `import { DEFAULT_STRATEGY_MAP } from '../content/subtitle/strategy-manifest.js';` 及 `src/options/ui-helpers.js:3` 同样导入 | **最低层 `common/` 反向依赖上层 `content/`**。`strategy-manifest.js` 被 common 与 options 共用，是数据清单，放错了层 | FIXED |
| E2 | `src/content/style.css`（`--fl-sys-color-*`）、`src/content/enhanced-style.css`（`--fl-color-*`）、`src/content/summary/summary.css`（`--fs-*`）各自定义私有 token 系统，值逐条重复 `src/common/common.css` 的 `--fox-color-*` | **内容侧存在 3 套并行、手工维护的设计系统** | 根因：`src/options/options.css:1` 与 `src/popup/popup.css:1` 都 `@import url('/common/common.css')`，而**内容脚本从不加载 `common.css`**（`web_accessible_resources` 只有 `content/style.css`、`content/enhanced-style.css`、`lib/franc.bundle.mjs`）→ 内容侧拿不到 `--fox-*`，于是各文件自造。`src/content/enhanced-style.css:3` 注释"Guarded by test/design-token-parity.test.mjs"——即用**测试去守住副本一致**，是替架构缺陷打的补丁。违反 AGENTS.md "Never add a new design-token system alongside `--fox-*`" | FIXED |
| E3 | 内容侧 88 处硬编码 hex（`src/content/summary/summary.css` 27、`src/content/style.css` 42、`src/content/enhanced-style.css` 18、`src/options/options.css` 1），全部有等值 token：`#0891b2`=`--fox-color-primary`、`#0e7490`=`--fox-color-primary-hover`、`#e11d48`=`--fox-color-error`、`#7c3aed`=`--fox-color-accent`、`#ffffff`=`--fox-color-panel` 等 | 改 token 不影响这些点，设计系统实际不可集中改换 | 与 E2 同根因 | FIXED |
| E4 | `src/common/settings-manager.js:37` `clearCache()` 只清 `#effectiveSettingsCache`，不清 `#validatedSettingsCache`；而 `#invalidateCache()` 相反 | 公共 API 语义不一致的陷阱 | **FIXED** |
| E5 | `src/common/settings-manager.js:26` 在 **static 初始化块**中注册 `browser.storage.onChanged.addListener` | 模块级副作用（导入即注册）。当前只被 background/options/popup 导入（不含内容脚本），影响可控，但属隐式契约 | WONTFIX |

---

## F. 性能

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| F1 | `src/common/settings-manager.js:116` `return structuredClone(SettingsManager.#validatedSettingsCache)` 与 `:160/#167` 对 effective 缓存同样 `structuredClone` | 每次 `getValidatedSettings()` / `getEffectiveSettings()` 都**深拷贝整个设置对象**（含 `domainRules`、`aiEngines`、`glossary`）。一次 `getEffectiveSettings()` = 2 次全量深拷贝。 | 最优解：**验证时深冻结一次，之后所有调用直接返回同一引用** → 安全性与零分配兼得（`settings-domain.js` 的 `upsertAiEngine`/`setDomainRuleProperty` 等本就 `structuredClone` 入参、不改入参，具备冻结前提） | FIXED |
| F2 | `src/common/settings-manager.js` 深拷贝共 11 处（`settings-domain.js` 7 + `settings-manager.js` 4） | 同上，深拷贝是热路径主要开销 | FIXED |
| F3 | `src/background/service-worker.js:206` `shouldReloadTranslationJob` 对 5 个 key 逐个 `JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key])` | 设置对象含大数组（`aiEngines` 含 API key、`domainRules`），每次变更序列化 10 次 | FIXED |
| F4 | `src/background/service-worker.js:164` 变更处理中逐标签页 `tabs.sendMessage` + `runtime.sendMessage` 广播 | 与 D1 叠加 → 双倍广播 | FIXED |

---

## G. 可观测性

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| G1 | `build.js:466` `buildOptions.drop = ['console', 'debugger']`（非 watch 即生产） | **生产构建把 `console` 全部删除**，而全仓库有 67 处 `console.error` 是错误上报的唯一途径（`src/background/background-logger.js`、`defaultLogError` 等）→ 线上故障完全不可见 | **FIXED** |
| G2 | 与 D2 叠加 | 唯一还活着的调试通道 `globalThis.__DEBUG__` 恒为 falsy | FIXED |

---

## H. UI / a11y

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| H1 | 全仓库 `tabindex`/`tabIndex` **零处真实使用**（`src/content/summary/summary.state.js:135-140` 的 `tabIndex` 是数组下标变量，非属性） | 无任何显式焦点管理 | FIXED |
| H2 | 键盘事件处理器全扩展仅 8 处（`grep -rn "'keydown'\|'keyup'\|'keypress'" src`） | 面板（summary / quick-action / tooltip）缺 Escape 关闭等基本键盘交互 | FIXED |
| H3 | 内容侧 44 处 `createElement('div'/'span')` | 需逐个确认可交互元素是否用真实 `<button>`（部分已是，如 `summary-suggestions-view.js:92`） | FIXED |

---

## I. 测试

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| I1 | `test/` 27 文件 6181 行 / 163 pass | 字幕模块 10 文件 1370 行中仅 2 个（`src/content/subtitle/youtube-subtitle-parser.js` 分段归一化、`src/content/subtitle/subtitle-manager.js` 状态注册）有真实行为断言；`src/content/subtitle/youtube-subtitle-strategy.js`（343 行，最大）仅在注入清单里被断言"存在" | ✅ 已补 `test/subtitle-behavior.test.mjs`（29 用例） |
| I2 | `src/content/subtitle/subtitle-renderer.js` | 只在测试中被 `export`、从未被断言 | ✅ 已补，并暴露 M1–M5 五个真实缺陷 |

---

## J. 上帝对象 / 长函数

| # | 证据（原始） | 问题 | 处理 |
|---|---|---|---|
| J1 | `src/background/translator-manager.js` 550 行，10 个 static 字段（`#inFlightRequests`、`#translators`、`#cacheStore`、`#retryController`、`#engineResolver`、`#aiTaskRunner`、`#taskQueue`、`#activeTasks`、`#taskIdCounter`、`#MAX_CONCURRENT_REQUESTS`），20 个 static 方法 | 单类承担 12 项职责且全静态 → 无法实例化、无法注入，测试只能靠 `browser` 全局 mock。全仓库最大的架构债务 | ✅ 已拆（详见「批 7 落地清单」） |
| J2 | `src/background/handlers/translation-handlers.js:11` `createTranslationHandlers({...})` — 311 行，内联 6 个 handler | 单工厂函数过长 | ✅ 已拆为 6 个具名模块 |
| J3 | `src/content/dom-walker.js:139` `static create()` — 235 行 | 混合遍历 / 过滤 / 度量 / 注册 | ✅ 已拆为 4 段私有方法 |
| J4 | `src/content/summary/summary.view.js:21` `constructor()` — 105 行 | 构造函数直接做 105 行 DOM 构建 | ✅ 已拆为具名构建步骤 |
| J5 | `src/content/translatable-elements.js:119` `findTranslatableElements` — 116 行 | 超长函数 | ✅ 已拆 |
| J6 | `src/content/input-handler.js:97` `handleConsecutiveKeyPress` — 94 行 | 超长函数 | ✅ 已拆 |
| J7 | `src/background/cloud-backup-store.js:4` `createCloudBackupStore` — 86 行 | 超长工厂 | ✅ 已拆 |
| J8 | `src/options/options-elements.js:3` `queryOptionsElements` — 117 行；`src/background/handlers/tab-handlers.js:8` — 106 行；`src/options/options-events.js:13` — 107 行 | “偏长” | ✅ **判定不改**（见下方 J8 裁决）；但其中查出两处真缺陷 J9/J10 并修复 |
| J9 | `src/background/handlers/tab-handlers.js:67` `action.setTitle({ title: enabled ? 'Foxlate (Subtitles Enabled)' : 'Foxlate (Subtitles Disabled)' })` | **真缺陷（i18n 泄漏）**：工具栏图标悬停提示是用户可见文案，却写死英文。zh_CN 用户开字幕后悬停图标永远看到英文。全仓库唯一的 `setTitle` 调用点，也是**唯一**绕过本地化的运行时文案 | ✅ 已修（新增 `subtitleToolbarTitleEnabled/Disabled` 两个 key，走 `browserApi.i18n.getMessage`）+ 补齐门禁漏洞 |
| J10 | `src/background/badge-state.js:17,23,26` 徽标色写作裸十六进制 `'#0891b2'`/`'#f59e0b'`/`'#10b981'` | 与 `src/common/tokens.css` 的 `--fox-color-primary/success/warning` 逐值相同，却是无门禁的手抄副本，两边会各自漂移 | ✅ 已修（集中为 `BADGE_COLORS` 具名常量 + `test/design-system.test.mjs` 逐值门禁） |

### J8 裁决（为何不改）

证据：`options-elements.js` 是 id → 元素的**平铺查表**；`tab-handlers.js` 是 7 个平均 15 行的 handler，共享同一依赖包；`options-events.js` 是 3 个事件回调 + 5 张 id→action **声明式派发表**。

判断：三者的“长”来自**数据表**而非控制流。“按文件数摊平”会把一张表切成 6 个文件、把一份依赖包拆成 6 份参数传递，可读性反而下降——这正是代码质量准则里说的“为了拆而拆”。

**实际改动**：`options-events.js` 的 5 张表原本在**事件回调内部**构建（每敲一个键重建 6 个闭包、每点一次重建 19 个），已提升到实例作用域只建一次；语义完全不变（表只捕获稳定的 `actions`/`elements`/`dispatch` 引用）。其余两个文件仅修 J9/J10。

## K. 缓存 / 并发

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| K1 | `src/background/translator-manager.js:296` `#translateSingle` 有单飞去重（`#inFlightRequests` :331-355，`finally` :351 清理）；但 :426-450 的 **AI 批量路径直接把任务 push 进 `#taskQueue`，完全绕过 `#inFlightRequests`** | 两个标签页同时对同一段文本发起 AI 批量翻译 → 重复调用付费 AI 接口。单条路径有去重、批量路径没有 | FIXED |
| K2 | `src/background/translator-manager.js:404` 批量路径已查缓存，:412 又调回 `#translateSingle`，后者 :321 再查一次同一 `cacheKey` | 冗余查表（`touch` 会重排 LRU，影响淘汰顺序） | FIXED |
| K3 | `src/background/translation-cache-store.js:111` `#enforceLimit` 是 `while(size > max)` 逐条 `keys().next()` 头删。`load()` :77 从 storage 恢复时**不调用** `#enforceLimit` | 换了更小的 `cacheSize` 设置 + 重启 → 超限缓存被全量载入内存，直到下次 `set()` 才收敛 | FIXED |
| K4 | 已核查为**正常，不要改**：`#activeTasks`（:130 `finally` 清理）、`#taskQueue`（:512-517 `interruptAll` 清空）、`#inFlightRequests`（:351 `finally`）、`#engineBackoffState`（按引擎数有界） | — | WONTFIX |

## L. 协议 / 一致性（核查结论：良好）

- `src/common/message-types.js` 61 行 / 47 个类型，`test/message-types.test.mjs` 已用「三张分类表必须无重叠无遗漏地覆盖全部取值」做门禁，且断言组装后的 handler map 与后台入站协议**一一对应**。**协议层是全仓库质量最高的部分，不要动。**
- 唯一注意点：`TRANSLATE_INPUT_TEXT: 'translateInputText'`（wire 值与 key 不同名，已在注释中说明为 legacy 并保持稳定）——**已核查无绕过**，`test/content-feature-modules.test.mjs:137` 锁住了这个 wire 值。
- `src/options/` 的 action type 是内联字符串（`dispatch({ type: 'SET_FULL_STATE' })`，`src/options/options-actions.js` 与 `src/options/options-state.js` 两侧各写一遍）——可提常量，属轻度 stringly-typed，非缺陷。

---

## M. 字幕管线（补 I1/I2 行为测试时新增发现的真实缺陷）

|---|
| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| M1 | `src/content/subtitle/youtube-subtitle-renderer.js` `hide()` | 只把叠层改成不可见，`lastRenderedState` 不变。下一次 `render()` 若 lines/top 与上次相同则提前 return → 叠层永远停在 hidden。用户表现为：在弹窗里关掉字幕显示模式再打开，字幕再也不出现（视频没换、时间轴没变时必然命中） | ✅ 已修（`hide()`/`destroy()` 一并失效缓存） |
| M2 | `src/content/subtitle/video-subtitle-observer.js` `start()` | 轮询容器出现的 `setInterval` 只在回调内部自清；`stop()` 只 `disconnect()` MutationObserver，**从不清该计时器**。容器始终不出现（B 站非播放页/懒加载面板）或反复开关时，计时器持续累积；若容器在 stop 之后才出现，还会在一个已停用的策略上复活观察器 | ✅ 已修（保存 id 并置幂等，`stop()` 调 `_stopPolling()`） |
| M3 | `src/content/subtitle/youtube-subtitle-parser.js` 组句处 | 片段拼接写死 `sentenceBuffer += `${block.text} ``，句内每个 timedtext event 之间都塞一个空格。中日韩字幕被渲染成「第一句 结束。」，看上去像漏字——而中文正是本扩展的主力场景 | ✅ 已修（新增 `src/common/text-join.js` 的 `joinSubtitleFragments`，按脚本决定是否补空格） |
| M4 | `src/content/subtitle/video-subtitle-observer.js:20` 默认 `textJoiner` | 同上，B 站 span 片段同样白空格拼接（`join(' ')`） | ✅ 已修（改调 `joinSubtitleFragments`） |
| M5 | `src/content/subtitle/youtube-subtitle-strategy.js` `updateSettings()` | 关掉显示模式时，只在 `this.videoElement` 存在才重渲染。而 `videoElement` 为空恰是「翻译失败 → `stopVideoObserver()`」的状态，此时关开关不会收起叠层，旧字幕僵在屏幕上且再也不会被更新 | ✅ 已修（displayMode 为 `off` 时直接 `hide()` 并返回） |

**测试证据**：`test/subtitle-behavior.test.mjs`（29 用例）一次性覆盖解析/时间窗选片/渲染器复用与失效/翻译客户端/就绪等待/管理器分发/观察器资源回收/Y·B 两平台策略状态。M1–M5 每一处都用「回退该修复 → 对应用例必须变红」验证过（5/5 全部成立）。

> 同时清除两个**假阳性**：`updateSubtitleDisplay` 的 `filter()` 看着像每帧 O(n)，但 `timeupdate` 实际约 4 次/秒（5000 条字幕也只有 2 万次比较/秒），**不值得改**；`subtitleRenderer.displayTranslatedSubtitle` 的硬编码 `#FF5252`/`#42a5f5` 属于注入到宿主页面的样式，不参与 `--fox-*` 设计令牌体系，**不算违规**。

---

## N. 规划驾驶舱 / 依赖声明（批 9；两者的共同形态：说了、但没有人真在读/真在用）

扫描方法：用 **bigpowers 框架自己的读取器** `dashboard/src/loaders/reader.js` 去读本仓库的 `specs/`，
而不是目测 YAML 内容。

| # | 问题 | 证据 | 状态 |
|---|---|---|---|
| N1 | `state.yaml` 的 `active_flow`/`epic`/`story` 被包在 `session:` 下，而框架读取器只认顶层键 | 读取器返回 `activeFlow: null`、`activeEpic: null`、`activeStory: null`；`epicCycle: {}`；`release: {}` | ✅ 已修 |
| N2 | `execution-status.yaml` 是扁平 map，而读取器与 Allure 报告只读 `development_status:` 嵌套 | 读取器返回 **0 条**史诗 | ✅ 已修（12 条） |
| N3 | `release-plan.yaml` 存了 `status` 副本，与 `execution-status.yaml` 和 `epic.yaml` 三者互不相同 | e01：done / done / **planned**；e04：done / done / **in_progress** | ✅ 已修（状态副本已删） |
| N4 | 声称 `active` 的史诗 e06 **根本没有胶囊目录** | `specs/epics/e06-*` 不存在 | ✅ 已修（`capsule_dir: null` + note 明写缺口） |
| N5 | `version_target: "1.7.0"` 早已发布；`version_shipped` 漏掉 1.6.3 与 1.7.1–1.7.4 | `changelog.md` | ✅ 已修 |
| N6 | `SCOPE_LATEST.yaml` 缺少 `scope-work` 要求的 7 个必备字段中的 5 个 | 仅有 `in_scope`/`out_of_scope` | ✅ 已修 |
| N7 | `src/lib/lit.js`（15.5 KB）+ `dependencies.lit`，**两者都无任何引用** | `from 'lit'` 命中 0；`dist/` 无 lit | ✅ 已删（连带 6 个包） |
| N8 | `AGENTS.md` 与 `tech-stack.md` 把 Lit 写成现行技术栈，而它早在 `SCOPE_LATEST.yaml` 与 `UI_REDESIGN_DIRECTION.md` 里被列为 out_of_scope | 三处文档互相矛盾 | ✅ 已修 |

**根因**：这两类问题同形——**声明存在，读者不存在**。N1–N6 是「文件里写了状态，但没有任何工具在读它」；
N7–N8 是「声明了依赖，但没有任何代码在用」。两者都不会让任何现有测试变红，所以能长期存活。

**门禁**：`test/planning-state.test.mjs`（16 条）与 `test/dependency-hygiene.test.mjs`（6 条）。

> 门禁自身的一个真实缺陷（值得记住）：`dependency-hygiene` 的第一版把自己算成了引用者
> （它注释里写了 `src/lib/lit.js` 这个文件名），于是「把死文件放回去」的注入**依然全绿**。
> 修法：引用者集合限定为生产侧（`src/` + `build.js` + `public/` + `scripts/`，排除 `test/` 与门禁自身）。
> **道门禁必须先能骗过自己，才能证明它没被骗过。**

## O. 设计元素（Apple 设计原则审视）

| # | 问题 | 证据 | 处理 |
|---|---|---|---|
| O1 | **内容侧 CSS 各自维护了一整套暗色 token** | 三个内容 CSS 的 `@media (prefers-color-scheme: dark)` 块里重新声明 `--fox-*`，且已与 tokens.css 漂移：`--fox-color-border` 0.2 vs 0.18、`--fox-color-border-strong` 0.32 vs 0.3。根因是一次 `git checkout -- <3 个 CSS>` 把批 4 的去 token 化成果整个抹掉 | ✅ 已修（按语义映射重建，只消费 tokens.css） |
| O2 | **门禁看不见媒体查询里的声明** | `extractVars` 用 `/@media … dark … \{[\s\S]*$/` 剥离暗色块：既要求该块位于文件末尾，又完全看不见块内声明。O1 的重声明因此无人拦 | ✅ 已修（按括号配平定位媒体块）+ 解析器自检测试 |
| O3 | **别名层 14 条死别名** | 实测零引用：`--color-on-primary-container`、`--color-warning-bg`、`--state-hover-opacity`、`--text-xl`、`--radius-xl`、`--space-1/6/8`、`--shadow-sm/input`、`--gradient-brand/warm`、`--transition-base/smooth` | ✅ 已删 + 门禁「别名必须有读者」 |
| O4 | **两套过渡 token 并行** | `--transition-*` 与 `--fox-transition-*` 取值接近但不一致 | ✅ 合并为 `--fox-motion-response-*` + `--fox-motion-ease-*` |
| O5 | **动效参数没有统一模型** | 时长与曲线散落 54 处；无按压档、无出场曲线、无弹簧 | ✅ 新增 response/ease 两组 token（Apple 用 damping + response 描述弹簧） |
| O6 | **字距与行高没有 token，同一模式三种取值** | 三个「小号全大写标签」分别用 0.04em / 0.06em / 0；`.title`(15px) 与 `.section-title`(20px) 都写 -0.02em（字距不随字号分级）；`font-weight: 720` 裸写 | ✅ 新增 tracking/leading 比例尺并全量接入 |
| O7 | **无障碍只覆盖暗色与降低动效** | 无 `prefers-reduced-transparency`、无 `prefers-contrast` | ✅ 已补（token 层响应，组件无感） |
| O8 | **「降低动效」= 关掉一切反馈** | 全局 `transition-duration: 0.001ms !important` 把颜色/透明度交叉淡入一起杀掉，用户反而看不出状态变化 | ✅ 已修：兜底仍压位移，颜色类过渡按选择器重新打开 |
| O9 | **按压反馈只存在于主按钮** | `.btn` 有 `overflow/position` 暗示按压态，但只有 `.btn-primary:active` 改了背景色；普通按钮按下毫无反馈 | ✅ 新增 `.btn:active` 位移反馈（90ms，松手回弹簧） |
| O10 | **会变化的数值用比例字形** | 版本号、缓存条数（`count / limit`）每次刷新整行宽度跳动 | ✅ 新增 `.tabular` 工具类并接入两处 |
| O11 | **字体栈以未分发的 Inter 开头** | Inter 从未随扩展分发，却排在 `--fox-font-sans` 第一位 —— 每个用户都在等一次不会成功的字体回退 | ✅ 改为平台关键字开头 + 门禁禁止引用未分发字体 |
| O12 | **`--fox-motion-ease-spring` 定义后无人使用** | 本批新增的 token 自己就犯了 O3 的同款错误 | ✅ 接入模态框入场；新增「动效/排版 token 必须有读者」门禁 |
| O13 | **手写弹簧采样点无校验** | 19 点 `linear()` 若值非单调或未覆盖 100%，动画会倒退或停在半路，且不报错 | ✅ 新增门禁（单调、值域、覆盖到 100%） |

**刻意没做的**（避免为不存在的场景预留结构）：

- **不提供弹性档位**：Apple 说只有「手势本身带动量」时才允许过冲（damping ≈ 0.8）。本扩展的拖拽（悬浮窗、总结面板）都没有吸附目标，没有可过冲的落点，所以只保留 damping 1.0 一档。
- **不做 `Dynamic Type` 全量接入**：字号已经是 rem，跟随系统缩放；但比例尺只覆盖 popup/options 两个固定布局的界面，内容侧注入的是宿主页面的排版，不应由扩展改写。
- **不引入 UI 框架**：`DomainRuleModal extends BaseComponent` 已经够用，Lit 那条路（O11 的邻居问题）已被 SCOPE 显式否决。

**门禁**（`test/design-system.test.mjs`，新增 9 条，共 18 条）：媒体块解析器自检；内容侧不得以任何方式重声明 `--fox-*`（含媒体查询内）；别名必须有读者；动效/排版 token 必须有读者；无障碍四态齐备；降低动效必须保留颜色反馈且不得放回 `transform`；`.btn` 必须有 `:active`；数值必须带 `.tabular`；字体栈必须从平台关键字开头且不得引用未分发字体；弹簧曲线必须单调且覆盖到 100%。

**真阳性验证**：6 个注入（暗色块重声明原语、死别名、死动效 token、去掉按压反馈、把 `transform` 放回降低动效过渡、把 Inter 放回字体栈）全部被门禁捕获，恢复后 18 通过；弹簧曲线破坏单调性也被捕获。

---

## 不修的项与理由（WONTFIX 汇总）

审计里每一条都做了裁决；以下是**评估后决定不改**的项。记下来是为了让“没改”与“忘了改”区分开。

| # | 项 | 不改的理由 |
|---|---|---|
| E3 余量 | 字幕错误色 `#FF5252` / `#42a5f5` | 这两处是**注入到宿主页面**的样式（字幕叠层直接坐在别人的页面上），不参与扩展自己的 `--fox-*` 体系；纳入反而会引入一个跨边界的伪依赖。见 M 节说明 |
| E5 | `src/common/settings-manager.js` 在 static 初始化块注册 `storage.onChanged` | **它是 D1 修复后的唯一通知通道**。改成显式 `init()` 会把“隐式契约”换成“忘记调 init 就静默停止全部设置传播”——后者的故障模式更差且更难发现。ESM 每个 realm 只求值一次，不存在重复注册。已在代码注释里写明这是设计而非副作用 |
| J8 | `options-elements.js` / `tab-handlers.js` / `options-events.js` 偏长 | 三者的“长”来自**数据表**而非控制流；按文件数摊平会把一张表切碎。见 J8 裁决 |
| K4 | `#activeTasks` / `#taskQueue` / `#inFlightRequests` / `#engineBackoffState` | 已核查为正确（都有 `finally` 清理或天然有界） |
| L | options 的 action type 是内联字符串 | 轻度 stringly-typed，非缺陷；提取常量会让两侧各多一份间接层而无安全收益 |
| M 假阳性 | `updateSubtitleDisplay` 的 `filter()` | `timeupdate` 实际约 4 次/秒，5000 条字幕也只有 2 万次比较/秒，不值得改 |

---

## 修复进度

| 批次 | 内容 | 状态 |
|---|---|---|
| 1 | A1–A4 安全（HTML 净化器 + 属性转义） | ✅ 完成 |
| 2 | D1 重复广播、D2 `__DEBUG__`、G1 错误上报被删、E4/#emit 订阅者隔离 | ✅ 完成 |
| 3 | B1–B4 死代码删除、C1–C4 重复收敛 | ✅ 完成 |
| 4 | B5 过度导出、E1 分层、E2/E3 设计 token | ✅ 完成 |
| 5 | F1/F3 性能、K1–K3 缓存与并发 | ✅ 完成 |
| 6 | H1–H3 无障碍、I1–I2 测试覆盖 | ✅ 完成 |
| 7 | J1–J8 上帝对象拆分（+ J8 裁决、J9/J10 新发现缺陷） | ✅ 完成 |
| 8 | 字幕管线行为测试 + M1–M5 缺陷修复 | ✅ 完成 |
| 9 | N 节：规划驾驶舱契约修复、`lit` 死依赖与错误栈声明（+ 2 道门禁） | ✅ 完成 |
| 10 | 设计元素（O1–O13，Apple 设计原则审视） | ✅ 完成 |
| 11 | C5 错误记录器合并（+ 修掉错误处理器自身抛 `TypeError` 的真实缺陷） | ✅ 完成 |

### 批 1–3 落地清单（可直接复查）

**新增模块**
- `src/common/html-sanitizer.js` — 白名单 HTML 净化器。在**无浏览上下文**的文档里解析（事件处理属性不会被激活成处理器），白名单元素+属性，URL 协议校验，`a` 强制 `rel="noopener noreferrer nofollow"`。
- `src/common/math.js` — `clamp`（原来 6 份逐字节重复）
- `src/common/url-utils.js` — `getHostnameFromUrl`（原来 popup/background 各一份）
- `src/content/layout/viewport.js` — `getViewport`（原来 2 份逐字节重复）
- `src/common/ids.js` 新增 `generateId`（原来 3 份逐字节重复的 `defaultGenerateId`）

**新增测试**
- `test/html-sanitizer.test.mjs` — 25 个用例：脚本/事件属性/`javascript:`及其变形/`data:text/html`/iframe·object·embed·form/svg·math/注释/template 全部拦住；同时反向验证 **marked 的全量输出形态（代码块 class、表格 colspan、任务列表、外链 rel）不被误删**
- `test/settings-manager-events.test.mjs` — 5 个用例，用**会回声的真实语义 storage mock** 锁住「一次保存只广播一次」，并锁住 oldValue/newValue 归一化对称性

**关键修复点**
- `src/content/summary/summary-message-renderer.js:169` → `sanitizeHtml(marked.parse(content))`；`:61` textarea 内容 `escapeHtml`
- `src/options/options-renderer.js:112,113`、`src/options/options-actions.js:347,348` → 属性值 `escapeHtml`
- `src/common/settings-manager.js` → 移除 `saveLocalSettings` 里的显式 `notifySettingsChanged` 调用（写入本身会触发 `storage.onChanged`），并在 `notifySettingsChanged` 里对 `oldValue` 做 `validateSettings` 归一化（否则 service worker 逐键比较会产生假阳性重载）
- `src/common/settings-manager.js` `#emit` → 逐订阅者 try/catch 隔离
- `build.js` → `define` 补 `globalThis.__DEBUG__`；`drop: ['console']` 改为 `drop: ['debugger']` + `pure: ['console.log','console.debug','console.info']`

**行为验证（非声称）**
- 一次 `saveLocalSettings` 的 `settingsChanged` 触发次数：**2 → 1**（用真实语义 mock 实测）
- 生产产物：`__DEBUG__` 残留 0 处；`console.error` 保留 21 处；`console.log`/`console.debug` 0 处
- `npm test`：**193 pass / 0 fail**（新增 30 个用例）

### 批 4 落地清单（可直接复查）

**E2/E3 — 内容侧 3 套并行设计系统 → 单一 tokens.css**

根因：`src/content/style.css`（`--fl-sys-*`）、`enhanced-style.css`（`--fl-color-*`）、`summary/summary.css`（`--fs-*`）各自手抄 `common.css` 的取值，而内容脚本从不加载 `common.css`
（宿主页面里没有 `--fox-*`）。旧测试 `design-token-parity.test.mjs` 逐条断言“副本抄得一致”，等于给架构缺陷打补丁。

统一后的结构：
- **新增 `src/common/tokens.css`（6.6 KB）** — 只含 `--fox-*` 原语定义（72 个变量），只用 `:root` 选择器，**不声明 `color-scheme`**（那会改变宿主页面表单控件渲染），浅色 + `@media (prefers-color-scheme: dark)` 两套取值。可安全注入任意宿主页面。
- **`src/common/common.css` 重构（18 KB → 687 行）** — 第 1 行 `@import url('/common/tokens.css')`，保留全部语义别名（`--color-*` 等，全部指向 `--fox-*`）、组件类、以及唯一一份 `color-scheme: light dark`（仅扩展页面生效）。
- **`src/background/background-constants.js` 的 `CSS_FILES` 首项改为 `common/tokens.css`**，先注入 token 再注入内容样式。
- **`public/manifest.base.json` 的 `web_accessible_resources`** 增加 `common/tokens.css`。
- 三个内容侧 CSS 文件删除全部私有 token 定义与品牌色字面量，改用 `var(--fox-*)`。

结构守卫（取代旧的 parity 测试）：
- 删除 `test/design-token-parity.test.mjs` → **新建 `test/design-system.test.mjs`（9 个用例）**：内容侧 CSS 不得定义任何非 `--fox-*` token、不得重声明原语、不得硬编码品牌色（仅放行中性投影/半透明白描边）；`tokens.css` 只能有 `:root` 且不得声明会污染宿主的属性（`color-scheme`/`font*`/`all`/`position`/`display`/`background`/`visibility`/`content`/`overflow`）；`common.css` 的别名必须全部写成 `var(--fox-*)`；`color-scheme` 只允许出现在 `common.css`；popup/options 只能 import `common.css` 不得直接 import `tokens.css`；`CSS_FILES` 首项必须是 `common/tokens.css`。
  - 判定细节：`@media (prefers-color-scheme: dark)` 是媒体**特性**不是声明，因此禁用项一律用「声明锚点」`(^|[;{])\s*prop\s*:` 判断；dark 块内的 `:root` 有缩进，选择器正则须允许前导空白。

**E1 — 分层倒置**
- `git mv src/content/subtitle/strategy-manifest.js src/common/subtitle-strategy-manifest.js`（纯数据清单，无 content 模块引用它）；3 处引用方全部改路径。`src/common/settings-domain.js` 原先 `import '../content/subtitle/…'` 的反向依赖消失。
- `src/common/` 现已零反向依赖（实证：`grep -rn "from '\.\./\(content\|options\|background\)/" src/common/` 无结果）。

**B5 — 过度导出**
- 去掉 12 个仅文件内使用的 `export`（先用 `grep -rhoE "\b<name>\b" src/ test/ build.js` 逐个确认引用总数与所在文件，全部只出现在自身文件）：`isLanguageDetectorReady`/`detectLang`、`mergeSelectors`/`findMatchingDomainRule`/`calculateEffectiveSubtitleSettings`/`calculateEffectiveSelectorSettings`/`DOMAIN_RULE_OVERRIDE_KEYS`/`DOMAIN_RULE_WRITABLE_KEYS`、`injectCSSIntoRoot`、`pretextMeasurementEngine`、`FOXLATE_EXTENSION_SELECTOR`、`initializeSubtitleManager`。

**新增门禁：`test/layering.test.mjs`（7 个用例）**
把实测出的分层事实固化为不变量。事实基线（扫描 src/ 全部 294 条相对 import）：`lib ← common ← {background, content, popup, options}`，四个上层互不引用。用例：
1. 跨层 import 只能沿 `lib → common → 上层` 单向（扫描器同时识别静态 import/export-from 与动态 `import()`）；
2. `common/` 不依赖任何上层（service worker 会静态拉入它，一旦依赖 content 就崩）；
3. `background/` 不静态 import `content/`（SW 无 DOM，只能按字符串路径注入，见 `script-injector.js`）；
4. `lib/` 是依赖叶子（vendored，反向依赖会让升级不可能）；
5. `popup/` 与 `options/` 互不依赖；
6. 单文件上溯 import 不超过 4 层 `../`（防目录树失控）；
7. 显示策略只能由 `content/display/display-strategy-registry.js` 装配，其他地方不得直接 import（否则新增显示模式要改多处入口）。

**批 4 验证（非声称）**
- `npm test`：**199 pass / 0 fail**（新增 16 个用例：design-system 9 + layering 7；删除旧 parity 测试的 4 个）。
- `npm run build:firefox`：成功，47ms；`dist/common/tokens.css`（6603 B）与 `dist/common/common.css`（17255 B）均已产出。
- `dist/manifest.json` 的 `web_accessible_resources` 实测包含 `common/tokens.css`。
- 内容侧 CSS 实测已无任何 `--fl-*`/`--fs-*` token 定义：`style.css` 引用 16 个、`enhanced-style.css` 15 个、`summary.css` 18 个 `--fox-*`；`tokens.css` 定义 72 个原语。
- 注释里残留的旧测试名 `test/design-token-parity.test.mjs` 已全部改为 `test/design-system.test.mjs`（`src/` 内已无残留；`specs/epics/archive/**` 与 `specs/verifications/full-refactor-review-1.7.4.md` 的历史引用按“历史记录不改”保留）。

---

### 批 5–8 落地清单（可直接复查）

**批 5（F1/F3 性能、K1–K3 缓存与并发）**
- `src/background/translator-manager.js` → 删掉两个 batch 处理器内部各一次的 `structuredClone(fullState)`，改为接受调用方传入的 `settings` 参数（向后兼容、纯增量）。
- K1：AI 批量路径现在也取 `#inFlightRequests` 单飞锁，不再绕过去重重复调用付费 AI 接口；单条与批量并发同一段文本会共享在途请求。
- K2：批量路径不再“查两次缓存”。
- K3：`TranslationCacheStore.load()` 末尾调 `#enforceLimit()`，换了更小 `cacheSize` 重启后不会全量载入。

**批 6（H1–H3、I1–I2 无障碍与测试）**
- options 六个模态框：焦点移入/焦点陷阱/Esc 监听器改为**模块级栈**（原来每个实例自己挂 `keydown`，叠层一次全关 + 监听泄漏）/ 过渡动画结束后再摘 DOM / `role` + `aria-modal`。新增 `test/options-modal-accessibility.test.mjs`。
- popup/options 的 i18n 泄漏：新增 `i18n-aria-label` / `i18n-title` 内联标记机制与对应门禁。
- tooltip 图标按钮全部改为真 `<button type="button">` 并补齐 `aria-label`，新增 `test/tooltip-accessibility.test.mjs`（8 用例）。

**批 8（字幕管线）** — M1–M5，详见上方 M 节；新增 `test/subtitle-behavior.test.mjs`（538 行 / 29 用例）。

**批 7（J1–J8 上帝对象拆分）**

| 原文件 | 拆前 | 拆后 | 拆出的模块 |
|---|---|---|---|
| `src/background/translator-manager.js` | 550 行 / 10 static 字段 / 20 static 方法 | **110 行** | `translation-runtime.js`、`single-translation.js`、`translation-batch-runner.js`（+ 更多运行时模块，见 `test/translation-runtime-modules.test.mjs`） |
| `src/background/handlers/translation-handlers.js` | 311 行单工厂 | **1962 B**（只剩装配） | `handlers/translation/`：`translate-text-handler.js`(92)、`translate-text-batch-handler.js`(120)、`engine-test-handlers.js`(79)、`translation-handler-support.js`(74)、`translate-input-text-handler.js`(53)、`translate-batch-handler.js`(25) |
| `src/content/dom-walker.js` `create()` | 235 行单方法 | 41 行（只负责查找 + 委派） | 拆为 `#rejectImmediately` / `#createStyleResolver` / `#walkChildNodes` / `#walkElement` / `#walkTextNode` / `#buildResult` 等私有方法；`#appendTag`+#appendSegment`+`#handleElement` 合并为单一分派点 |
| `src/content/summary/summary.view.js` `constructor()` | 105 行 | 11 行（调用 10 个具名构建步骤） | `#buildHeaderAndCloseButton` / `#buildTabsAndSettings` / `#buildContentArea` / `#buildSuggestionArea` / `#bindSuggestionTriggers` / `#bindContentActions` / `#bindOptionControls` 等 |
| `src/content/translatable-elements.js` J5 / `src/content/input-handler.js` J6 / `src/background/cloud-backup-store.js` J7 | 116 / 94 / 86 行 | 均拆为具名步骤 | — |
| `src/options/options-events.js` | 5 张表在事件回调内构建 | 提升到实例作用域 | 语义不变，去掉每次按键/点击的闭包重建 |

**批 7 新增测试**：`test/dom-walker.test.mjs`(131，含标签回滚/分隔符/预格式化上下文/6 项廉价排查/追加类型)、`test/translation-runtime-modules.test.mjs`(320)、`test/translation-handlers.test.mjs`(309)。

**批 7 新发现的真缺陷（不在原台账里）**
- **幻影失败**：`translate-text-handler` 与 `translate-text-batch-handler` 在缓存命中路径上会带着上一次请求的错误字段返回，用户会看到“翻译成功但同时报错”。已修，并有测试钉住。
- **J9**：`tab-handlers.js` 把工具栏悬停提示写死英文（i18n 泄漏）。已修 + 补门禁。
- **J10**：`badge-state.js` 徽标色与 `tokens.css` 品牌原语是无门禁的手抄副本。已修 + 补门禁。
- **`DOMWalker.#appendSegment` 的死分支**：原先的分支前提（首字符非空白）恰好让 `trimStart()` 必然无操作，两个分支完全等价——“不足空格”的意图从未生效。已按等价形式改写；**若要真的插入空格那是行为变更，需单独决策**。

**新增门禁（全部用“回退→变红”验证过真阳性）**
- `test/dom-walker.test.mjs`：`<span>` 类元素在 jsdom 下计算样式非 `inline` → 会被判定为块级（与真实浏览器不一致）；依赖内联 `display:` 写断言。
- `test/i18n-integrity.test.mjs` 新增「运行时传给浏览器 UI 的文案不得写死」：扫 `src/**/*.js` 的 `.setTitle(`/`.setBadgeText(` 调用点，判定范围限定在属性名之后（避开 `path: 'icons/…'`），并剔除 `getMessage(...)` 实参（避开把 i18n key 误报）。回退到写死英文 → 报出两条确切字面量。
- `test/design-system.test.mjs` 新增「徽标颜色必须是 tokens.css 品牌原语」：取 `BADGE_COLORS` 块与 `--fox-color-primary/success/warning` 的取值**集合**逐值相等。把取值改一位 → 变红。

**批 5–8 验证（非声称）**
- `npm test`：**334 pass / 0 fail**（起点 193）。
- 所有回归测试都用“回退修复 → 对应用例必须变红”验证过（K 类 4+5、M 类 5/5、J9、J10、幻影失败、新增门禁）。

---

### 批 9–11 落地清单（可直接复查）

**批 9（规划驾驶舱 + 依赖声明）**
- 新增 `test/planning-state.test.mjs`（16 条）、`test/dependency-hygiene.test.mjs`（6 条）；新增 devDependency `js-yaml@4.1.0`。
- `specs/state.yaml` / `execution-status.yaml` / `release-plan.yaml` / `SCOPE_LATEST.yaml` 按框架读取器契约改写。
- 删除 `src/lib/lit.js` 与 `lit` 依赖；改正 `AGENTS.md` 与 `tech-stack.md` 的技术栈描述。

**批 10（设计元素）**
- `src/common/tokens.css`：`--fox-motion-*`（5 档 response + 4 条曲线，含 19 点临界阻尼弹簧）、`--fox-tracking-*`（5 档）、`--fox-leading-*`（3 档）；新增 `prefers-reduced-transparency`、`prefers-contrast: more`（含暗色变体）、token 级 `prefers-reduced-motion`。
- `src/common/common.css`：头部重建为「@import + 纯别名层」（删 14 条死别名）；`.btn:active` 按压反馈（`--btn-press-duration` 间接引用时长）；`.tabular`；降低动效块改为「压位移、留颜色」；模态框入场接弹簧。
- `src/content/{style,enhanced-style,summary/summary}.css`：按**语义映射**（非值匹配）去 token 化，删除各自重声明的 `@media (prefers-color-scheme: dark)` 原语块。
- `test/design-system.test.mjs`：9 → 18 条（新增解析器自检、内容侧禁重声明、别名必须有读者、动效/排版 token 必须有读者、无障碍四态、降低动效保留颜色、`.btn:active`、`.tabular`、字体栈、弹簧曲线合法性）。

**批 11（C5 错误记录器）**
- 新增 `src/common/error-logger.js`：`createErrorLogger({ context, source, quietAbort })`。**中止策略变成显式参数**——此前它是“同一份逻辑写多遍”的根源（三份实现的差异全在是否吞掉 AbortError）。
- 新增 `test/error-logger.test.mjs`（5 条，含 `null` / `undefined` / 非 Error 对象三类入参）。
- 替换 6 个调用点：`src/content/page-translation-job.js`、`src/content/element-translation-controller.js`、`src/content/input/input-translation-client.js`、`src/background/handlers/translation-handlers.js`（两处：页面翻译与输入框翻译）、`src/background/service-worker.js`。
- **顺带修掉一个真实缺陷**：content 侧原实现直读 `error.message` / `error.stack`，在 `error` 为 `null` 或 `undefined` 时会**在错误处理器里再抛 `TypeError`**。共享实现加了 `error instanceof Error ? error.message : String(error)` 保护。

---

---

### 批 12 落地清单（1.7.5 多视角自审：用户 / 产品 / UI / 架构）

审计方式：5 个只读 subagent 分视角并行（产品+用户旅程 / UI+无障碍 / 架构|性能|测试 / 安全|并发 / 扩展生命周期），凡是「代码读起来像缺陷」的结论一律先复现再立项——本轮拒绝了 2 条假阳性（见末段）。

**P0 · 生命周期**

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| P0-1 | `src/background/navigation-handler.js` 只在 `onHistoryStateUpdated`（SPA 路由）清状态；`onCompleted`（同一标签页第二次整页导航）走的是同一个「已注入」检查 | 扩展装好后第一次整页导航之后，同一标签页的后续整页导航**永远不会重新注入**内容脚本：注入记录按 tabId 记忆，而 `document` 已经换了。表现是「刷新过一次之后，翻译按钮/右键菜单全哑」 | **FIXED** |

修法：`TabStateManager.resetTabDocumentState(tabId)`（清 `tabTranslationStates` + `injectedFrames`，保留 host 级 `sessionTabTranslations`）；`handleNavigation(details, { documentReplaced })` 在 `frameId === 0 && documentReplaced` 时调用它并清徽标；`onCompleted` 传 `documentReplaced: true`，`onHistoryStateUpdated` 不传。

**并发 / 竞态**

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| K12 | `src/background/translation-task-scheduler.js` `#active` 是单槽 + `interruptAll()` | 用户在 A 标签页点「停止翻译」会把 B 标签页正在跑的翻译一起中止；排队任务也不分标签页 | **FIXED** |
| K13 | `src/content/content-runtime.js` `startTranslationJob` 先查 `this.currentPageJob`、再 `await getEffectiveSettings()`、最后才赋值 | 两次快速点击可以各自通过检查 → 两个作业同时跑，`replace` 模式下同一段落被翻两遍 | **FIXED** |
| K14 | `src/content/input/input-translation-client.js` 无请求代号 | 慢的旧响应会覆盖新响应（用户看到的译文与输入框内容不符） | **FIXED** |
| K15 | `src/background/navigation-handler.js` 不中止作业 | 整页导航后旧文档的翻译作业仍在跑，结果写进已卸载的 DOM | **FIXED** |
| C10 | `src/background/translation-cache-store.js` `scheduleSave` 每次调用都 `clearTimeout` + 2s | 持续翻译时计时器**永远**被重置 → 长会话一次都不落盘，关闭浏览器即丢全部缓存 | **FIXED**（加 `maxWait` 上限） |
| C11 | `src/background/translation-pipeline.js` 缓存键不含 AI 的 `customPrompt`/`model` | 改了提示词或模型，旧译文仍被命中 → 用户「改了提示词却没效果」 | **FIXED**（`aiConfigFingerprint` 进键） |

**数据完整性**

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| S1 | `src/common/settings-manager.js` `savePartialSettings` 基于调用方传入的整份快照写 `storage.local` | 两个设置页同时打开时，后保存的一方会静默丢弃另一方刚改的字段 | **FIXED**（保存前重读权威值再合并） |
| S2 | `src/background/cloud-backup-store.js` 整份设置塞进单个 `storage.sync` key | `QUOTA_BYTES_PER_ITEM` 是 8192 字节：引擎列表一大就上传失败，且 API Key 明文上云 | **FIXED**（分片 + 头部键，删除时连分片一起删，`apiKey`/`token`/`secret`/`password` 系字段置空） |

**正确性 / 转义**

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| J11 | `src/background/translators/ai-translator.js` 用字符串值做 `String.replace` 的替换位 | `$&`、`$'`、`$1` 会被当作替换模式解析 → 页面里只要出现 `$&` 这类字样，提示词就会被打歪 | **FIXED**（函数式替换） |
| J12 | `src/common/translation-glossary.js` 同上（术语目标文本含 `$&` 会翻成别的东西） | **FIXED** |
| J13 | `src/background/translators/ai-translator.js` | 模型回 `Here you go:\n[...]` 这种包了话的 JSON、或漏一条，`JSON.parse` 整段抛错 → 同一次付费请求里的十几条一起变红，而且错误文案不含可重试关键词，**没有第二次机会** | **FIXED**（括号配对抠出数组做宽松解析；整批失败且错误属于「形状类」时二分拆小重试） |

**冷启动**

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| J14 | `src/content/content-runtime.js` 把 `onMessage` 监听器注册在若干 `await` 之后，而背景注入返回后立刻 `sendMessage` | 首次点击翻译有概率落进「Receiving end does not exist」真空期 | **FIXED**（监听器先注册，再用 `src/background/tab-messaging.js` 对真空期做有限重试） |

**i18n / UI 一致性**

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| J15 | `src/content/summary/summary-error-messages.js` 中文文案写死 | 英文界面下摘要失败提示是中文 | **FIXED**（改 i18n key，补 en/zh_CN 条目） |
| J16 | `src/options/components/DomainRuleModal.js` `'未设置'` 写死 3 处 | 英文界面下域名规则弹窗显示中文 | **FIXED** |
| U1 | `src/popup/popup-actions.js` 保存后重拉快照 | 保存显示模式触发的异步刷新会把用户刚点的分段控件弹回旧值 | **FIXED**（本地意图优先 + 刷新序号） |

**架构 / 门禁**

| # | 证据 | 问题 | 状态 |
|---|---|---|---|
| G1 | `test/bundle-budget.test.mjs` 遍历的是 `SIZE_BUDGET_KB` 的键 | 新增构建入口永远不会被体积门禁覆盖（`build.js` 有 7 个入口，门禁只管 4 个） | **FIXED**（入口清单抽到 `build-entries.cjs` 单一来源，门禁按入口清单逐个断言） |
| G2 | `src/content/strategies/*` → `display-manager.js` → `display/display-strategy-registry.js` → `src/content/strategies/*` | 4 个模块环：策略只需要「读」元素状态，却依赖整个 DisplayManager | **FIXED**（状态表下沉到叶子模块 `src/content/display/element-state-map.js`，环 4 → 0） |
| G3 | `src/background/script-injector.js` 逐文件串行读 `storage.session` | 注入前 N 次串行 IPC | **FIXED**（一次批量读） |
| G4 | `src/common/text-measurement.js` 每次查表都对全文 `JSON.stringify` 当缓存键 | 长文本反复测量时的主要开销 | **FIXED**（廉价键） |
| G5 | 无模块环门禁 | 环一旦回来没人会知道 | **FIXED**（`test/layering.test.mjs` 新增全图 DFS 找环） |

**本轮判定为「不是缺陷」的三条**

- **IO `threshold: 0.5` 会让高于两倍视口的元素永不翻译**——错。IntersectionObserver 在 `isIntersecting` 翻转时就会入队回调，不要求跨越阈值桶；`checkCompletion` 也从不要求 `observedElements` 为空。**曾据此改过 `threshold: 0` 并写了用例，验证发现是假阳性，已回退。** 教训：观察者语义先对规范，再立缺陷。
- **「AI 批量没有条数上限」**——错。`src/content/translation-batch-queue.js:7-8` 已有 `DEFAULT_MAX_ITEMS = 12` / `DEFAULT_MAX_CHARS = 10000`，`:88` 达到任一上限即冲刷。审计只读到 `groupBatchItems` 按语言/引擎分组的那一层，就下了结论。真实缺陷是上面 J13 的**失败连坐**，不是上限。
- **「页面一个可翻译元素都没有」时用户看不到反馈**——不成立。`emptyCandidates` / `allPrecheckSkipped` 已经从作业传到 `badge-state.js` 与 popup 文案。

**本轮评估后不修（含理由）**

- `src/lib/readability.esm.js` 从动态 `import()` 拿到静态导入：`build.js` 用 `format: 'iife'`，esbuild 对 iife 不做代码分割，动态导入会被内联进同一个包——改了等于没改。
- popup 把 `bindPopupEvents` 提到首个 `await` 之前：收益是几毫秒的可点击窗口，代价是在 `currentHostname` 尚未就绪时点击会把改动写到默认规则而不是当前站点规则。**收益不抵风险，维持原序。**
- options 两个模态框（17.0KB + 15.1KB）改动态导入：同 iife 原因，不产生独立 chunk。
- `test/helpers/bundle.mjs` 跨测试文件共享构建缓存：12 个测试文件各跑一次 esbuild，但跨进程缓存一旦键算错，整套测试会对着旧产物变绿——**用一个可能撒谎的缓存换 1–2 秒，不值。**

**待决策的大项 → 已在批 13 落地**（用户批准）：摘要包按需注入，见下。

**验证（本批实际跑出来的数字）**

- `npm test`：**434 pass / 0 fail**（50 个测试文件，本批起点 396）。
- `npm run build:firefox`、`npm run build:chrome`：均成功。
- 每条修复都用「回退修复 → 对应用例必须变红」验证过：P0-1（2 红）、K12（3 红）、K13（1 红）、K14（1 红）、C10/C11、S1、S2（4 红）、J11（1 红）、J13（3 红）、J14（2 红）、G1（1 红）、G2（1 红）。

---

## 批 13 · 1.7.6：摘要包按需注入（把 36% 的内容包移出冷路径）

### 问题

内容脚本在每一次页面加载里都带着 `src/lib/readability.esm.js`（81.4 KB）、`src/lib/marked.esm.js`（55.4 KB）与整个 `src/content/summary/`（约 77 KB）——合计约 214 KB，占当时 597 KB 内容包的 36%。而摘要默认关闭，且只在用户按下按钮/快捷键时才用得上。**不翻译、不摘要的页面也在下载并解析这三块。**

批 12 把这条记为「待决策」，因为拆包要同时改构建入口、注入时机、消息流与四条初始化路径。批准后落地，做法沿用仓库既有的字幕模块形态（`content/subtitle/subtitle-manager.js` 是独立注入入口，自己挂监听），不引入新范式。

### 落地

| 位置 | 变更 |
|------|------|
| `build-entries.cjs` | 新增第 8 个入口 `content/summary/summary-entry.js`（入口清单仍是单一来源） |
| `src/content/summary/summary-entry.js` | 新增。模块顶层**同步**注册 `TOGGLE_SUMMARY_REQUEST` 监听；`bootstrapSummary()` 只在站点开关为开时建面板；`buildForcedSummarySettings()` 把「这一次要摘要」翻成可用配置 |
| `src/content/content-runtime.js` | 删掉 `import { initializeSummary }`、`initializeSummary` 字段与 `toggleSummary()`；改为 `requestSummaryModule()` 发 `ENSURE_SUMMARY_MODULE`（注入失败只记日志，不影响页面翻译） |
| `src/content/content-message-handlers.js` | 摘掉 `TOGGLE_SUMMARY_REQUEST` 映射（改由摘要包自己处理，避免两处响应同一条消息） |
| `src/common/message-types.js` | 新增 `ENSURE_SUMMARY_MODULE`（content → SW） |
| `src/background/summary-injection.js` | 新增注入器：开关为关不注入；`force: true` 用于快捷键；设置读失败按「不需要」处理，绝不为了一个未确认的开关给所有页面塞 278 KB |
| `src/background/background-constants.js` | `SUMMARY_SCRIPT_FILES` / `SUMMARY_CSS_FILES` 单独成组；`content/summary/summary.css` 从 `CSS_FILES` 移出（非摘要页面不再注入它） |
| `src/background/handlers/tab-handlers.js` | `ENSURE_SUMMARY_MODULE` 处理器；tabId 取 `sender.tab.id` 而非 payload（请求方永远是自己所属的标签页，自报 tabId 只是给伪造留缝） |
| `src/background/service-worker.js` | `toggle-summary` 快捷键改为 `ensureSummaryInjected(tab.id, { force: true })`；顺带把 `error.message.includes` 修成 `error?.message?.includes` |

### 数字（未压缩，同一套 esbuild 配置）

| 入口 | 1.7.5 | 1.7.6 | 变化 |
|------|-------|-------|------|
| `content/content-script.js` | 597.0 KB | 366.7 KB | **−230.3 KB（−38.6%）** |
| `content/summary/summary-entry.js` | — | 277.9 KB | 仅摘要开启/点击时注入 |

压缩后产物：`content-script.js` 146.2 KB，`summary-entry.js` 142.9 KB。

### 门禁（三条，都在旧结构上验证过变红）

1. `test/bundle-budget.test.mjs` → `SCOPED_DEPENDENCIES` 新增 `src/lib/readability.esm.js`、`src/lib/marked.esm.js`、`src/content/summary/`，只允许出现在 `content/summary/summary-entry.js`。把 `initializeSummary` 重新 import 进 `content-runtime.js` 后实测报出 readability 81.4 KB、marked 55.4 KB、`src/content/summary/` 三条越界。
2. 体积预算：`content/content-script.js` 620 → **440 KB**，新增 `content/summary/summary-entry.js` **340 KB**。同一实验下实测 `512.9 KB > 440 KB`。
3. `test/summary-entry.test.mjs`（新增 6 例）：监听在模块求值期同步注册；开关为关不建面板；开关为开按设置初始化；快捷键把关闭的开关翻成本次启用且丢掉页面选区语境；无选区时不动选区语境；非本模块消息返回 `undefined` 放行。

另加 `test/summary-injection.test.mjs`（新增 5 例）：关不注入、开同时注入样式与脚本到 frame 0、`force` 无视开关、设置读失败不注入并记日志、无 tabId 直接返回 false。

### 教训

- **拆分之后「谁决定要不要下载」必须留在后台。** 内容侧能自己 import 自己就会 import；判据放在注入器里，内容侧只发一条「我需要」。
- **监听必须同步注册。** `browser.scripting.executeScript` 在整个 IIFE 执行完才 resolve，后台注入完立刻发消息；任何 `await` 之后再注册都会丢第一条。
- **`buildForcedSummarySettings` 不能拿来判断开关**——它恒为 `enabled: true`，用它判「要不要初始化」会让每次翻译都建出一个用户没要的面板。判断用原始设置。
- `getSelection().toString()` 清零选区语境的逻辑只应在**有选区**时触发；测试初版断言写反了，是测试错不是实现错。

### 验证

- `npm test`：**445 pass / 0 fail**（52 个测试文件；本批起点 434）。
- `npm run build:firefox`、`npm run build:chrome`：均成功。

---

## 批 14 · 1.7.7：真浏览器自测（UI 可测性 + 运行时挂死 + 徽标诚实）

### 方法（这轮与前三轮不同）

前三轮是「读代码找缺陷」。这轮先建可复现的真浏览器回路，再让浏览器自己报问题：

1. `scripts/e2e/mock-server.mjs` —— 零依赖 fixture 服务：`/`（标题/列表/引用/表格/代码/表单/长文）、`/long?paras=N`、DeepLX mock、OpenAI 兼容 `/v1/chat/completions`（支持 `mode=fail|garbage|short`）。**这些 bug 模式正是它跑出来的。**
2. `chrome --load-extension=dist` + agent-browser 驱动真实扩展页面（popup/options 是普通 HTML，可直接打开度量）。
3. 度量脚本不看截图、只取 `getComputedStyle` 与几何，得到可复现的数字而不是「看起来还行」。

### UI 找到的问题（都有度量）

- **对比度：options 页 51 处、popup 12 处低于 WCAG AA。** 根因是 `--fox-color-text-muted: #8794a6`（白底 **3.08:1**）被用来承载 10–11px 的真正文字（分区标题、说明、缓存/历史元信息），加上主色 `#0891b2` 上的白字 **3.68:1**（主 CTA「翻译此页」就是它）。改 token 后实测 **options 51 → 0，popup 12 → 0**（154 / 40 个可见文本节点）。
- **宿主页面样式漏进来自家 UI。** 摘要对话框字体是宿主页面的 `system-ui` 而不是 `--fox-font-sans`、文字颜色不是 `--fox-color-text`（面板背景是自家的白/深色，颜色却继承宿主）。修法：面板容器自己声明字体与颜色。
- **所有注入按钮都带着 Chrome 的 UA 方框。** 摘要悬浮按钮与摘要面板的标签页外面是 `2px outset` 黑色立体框 + Arial。修法：新增 `content/control-reset.css`，用 `:where(button)[class*=" foxlate"]`（特异性 0,1,0）给基线：压得住宿主页面的 `button {}`(0,0,1)，压不住组件自己的 `.foxlate-x {}`(0,1,0)，于是只补缺口、不覆盖设计。
- **读屏标签是英文、界面是中文。** `Copy / Retry / Copy Error / Suggest / Send` 五个 aria-label 写死在 `summary.view.js` 与 `summary-suggestions-view.js`（且 `getMessage('copy')` 这类裸 key 根本不存在）。改为走 i18n，并用测试遍历打包后的对话框标记证明没有英文 aria-label 残留。

### 运行时找到的问题

- **后台标签页里翻译永久挂死（P1）。** `chrome.tabs.create({active:false})` 打开链接再翻译 → 状态永远 `loading`。根因：IntersectionObserver 在隐藏文档里不产生回调，而初次扫描只在元素 intersect 时才入队 → `checkCompletion` 永不收敛。修法：扫描在可见时走 `requestIdleCallback`、隐藏时走短超时；mutation 队列同样处理。这条**只能**靠真浏览器发现，代码读起来完全合理。
- **徽标撒谎。** 每一段都失败（密钥错/限流/断网）时徽标仍是 `✓`，页面只有满屏红下划线。现在返回 `failedCount/completedCount`，全失败时徽标 `!` + 错误色，popup 用一句话说明失败段数与要检查什么。

### 门禁

- `test/design-contrast.test.mjs`：**解析真实 CSS 变量**算对比度，对 popup/options 的语义色对强制 AA（含深色模式）。比的是取值而不是字面量，token 改了门禁自动跟着改。
- `test/injection-css.test.mjs`：`control-reset.css` 必须同时在 `CSS_FILES` 与 `SUMMARY_CSS_FILES` 里，且排在 `tokens.css` 之后。
- `test/content-ui-i18n.test.mjs`：打包摘要对话框标记，断言 aria-label 全部来自 locale 表。
- `test/page-translation-job.test.mjs`：新增隐藏文档下的扫描推进用例（旧的 rIC 行为下变红）。
- `test/badge-state.test.mjs`：全失败 → `!` + `failed` 色；部分失败 → 仍是 `✓`。

### 验证

- `npm test`：**461 pass / 0 fail**（55 个测试文件；本批起点 445）。
- `npm run build:firefox`、`npm run build:chrome`：均成功。
- 浏览器度量：对比度 0 失败；摘要对话框 `font-family: ui-sans-serif`、`color: var(--fox-color-text)`；`aria-label` 全中文（重新生成摘要/复制/重试/复制错误信息/建议/发送追问）。

### 说明（诚实记录）

- 后续几项修复的**浏览器级**复验被扩展重载摩擦挡住（`chrome.runtime.reload()` 后 `--load-extension` 指向的目录被替换，扩展变 `ERR_BLOCKED_BY_CLIENT`）。这几项以单元级证据为准：先在旧代码上用同一组用例确认变红，再在新代码上转绿。
- 未覆盖：输入翻译的真浏览器路径（IME）、字幕站点（需要 YouTube/B 站真实页面）、AI 摘要的流式渲染。属下一轮。

---

## 批 13（1.7.8 桌面端可达性复查）

### H. UI / a11y

| # | 证据 | 问题 | 影响 | 状态 |
|---|---|---|---|---|
| H14 | `src/content/strategies/hover-strategy.js:31-38`（旧）只有 `mouseenter`/`mouseleave` | hover 显示模式是纯鼠标交互 | 用 Tab 在链接间移动的用户，在整个「悬停显示」模式下拿不到任何译文——这是该模式唯一没被覆盖的输入方式，而链接恰恰是键盘用户最常停驻的元素 | **FIXED**（`focus`/`blur` 与鼠标共用展示路径；`revert` 一并摘掉四个监听器） |
| H15 | `src/content/strategies/hover-strategy.js:99`（旧）`data?.errorMessage \|\| 'Translation Error'` | 错误态回退文案写死英文 | 中文界面里浮层弹出英文；且 `data.originalContent` 缺失时把 `undefined` 拼进文案 | **FIXED**（新增 locale key `translationFailedFallback`，`originalContent` 用 `?? ''` 兜底） |

### 门禁

- `test/hover-keyboard-access.test.mjs`：键盘聚焦展示、失焦收起、`revert` 后鼠标与焦点都不再触发、错误文案来自 i18n。回退到旧行为后 2/3 变红（仅补上类的具名导出以便注入假浮层，行为断言本身是红的）。

### 验证

- `npm test`：**464 pass / 0 fail**（56 个测试文件；本批起点 461）。
- 未覆盖：hover 模式的**真浏览器**键盘路径（需要 `--load-extension` 会话稳定加载当前 dist，本轮重载摩擦未解决，以 jsdom 行为断言为准）。

## 批 14（1.7.9 全功能 / UI / 代码自测）

五路只读 agent 报告 + 真 Chrome 逐条复现。本批只收「浏览器里能看见、能复现」的缺陷。

### I. CSS / 渲染（三处同源级联缺陷）

| # | 证据 | 问题 | 影响 | 状态 |
|---|---|---|---|---|
| I1 | `src/content/style.css:452-460`（旧） | `.foxlate-panel, .foxlate-performance-hud, .foxlate-appended-text, .foxlate-error-underline,` 的声明体在 1.7.4 去 token 时被删、列表残留，与紧随的 `.foxlate-panel {` 合并成一条规则 | **追加显示模式的每段译文计算值都是 `visibility: hidden` / `opacity: 0` / `position: fixed`** —— 整条显示模式事实上不可见；失败下划线同样不可见；性能浮层被拉成 fixed | **FIXED**（`test/content-style-isolation.test.mjs` 锁死面板盒模型与隐藏声明不得泄漏） |
| I2 | `src/content/style.css:452-460`（旧） | 摘要面板一并被合并进上述列表 | 浮层没有 `1px` 描边、`box-shadow`、`12px` 圆角，只剩 `display: flex`；文字继承宿主页面的 Times New Roman | **FIXED**（恢复盒模型 + `font: inherit`） |
| I3 | 真 Chrome 实测（背景标签页） | 后台标签页无布局/绘制 → `IntersectionObserver` 不回调，而作业只把 `isIntersecting` 的元素入队并靠观察器推进 | 后台标签页翻译永远 `loading`，徽标永远转圈 | **FIXED**（入队后作业自行排空剩余元素） |

### J. 焦点可见性

| # | 证据 | 问题 | 影响 | 状态 |
|---|---|---|---|---|
| J1 | `src/common/common.css:142-146`、`src/options/options.css:138-141`、`src/popup/popup.css:237-241`、`src/content/style.css:454-460`（旧） | 四处 `outline: 0` + `16%–28%` `color-mix` 阴影 | 焦点环叠在任意表面约 1.2–1.5:1，低于 3:1 要求 | **FIXED**（`2px solid` 实色 token） |
| J2 | `src/options/options.css:224-228`、`src/popup/popup.css:93-98`（旧） | 下拉选项在 `@media (hover: hover)` 里 `outline: 0` | 外接键盘 + 鼠标的 Windows 用户完全失去焦点指示 | **FIXED**（hover 只管底色，焦点另给实色 outline） |

### 门禁

- `test/content-style-isolation.test.mjs`（2 例）：面板盒模型规则不得与内联译文/下划线/浮层共用选择器；`visibility: hidden` 只能出现在面板自身规则里。旧 CSS 下必红。
- `test/design-contrast.test.mjs` 新增焦点环门禁：任何 `:focus` 规则不得 `outline: 0`。旧 CSS 下必红。

### 验证

- `npm test`：**490 pass / 0 fail**（61 个测试文件）。
- 真 Chrome 计算值：`.foxlate-appended-text` 旧 CSS `visibility: hidden` → 新 CSS `visible`；`.foxlate-panel` 旧 `border: 0 none` / 无阴影 → 新 `1px` + `0 8px 24px -10px` + `12px`；四处焦点规则经 CSSOM 读取确认为 `2px solid var(--color-*)`。
- 未覆盖：`@media (hover: hover)` 焦点环的真实键盘走查（窗口级焦点在无头会话里拿不到，以 CSSOM 声明为准）。
