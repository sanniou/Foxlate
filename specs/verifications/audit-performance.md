# 性能评审（1.7.8）

评审对象：`main` @ `3e080a5`（1.7.8，464 tests）。全部数字来自本机实测，复现命令附在每节末尾。
所有打包测量走 `npx esbuild`（选项与 `build.js` 逐项对齐），未写 `dist/`。
下表 KB = 1024 B（KiB）。

对比基线：批 12（1.7.5 自审）与批 13（1.7.6 摘要包拆分）已修的六项（摘要包拆分、缓存 debounce 上限、
script-injector N+1 串行读、text-measurement 缓存键、popup 首帧 IPC 排序、options modal 静态导入）
**没有重复上报**；凡是"修得不够"的地方单独标 `[批12/13 遗留]`。

---

## 结论摘要

**这套代码的"次数"做得比"体量"好，而体量又被三件不该在热路径上的东西占掉了一半。**

- 启动路径是干净的：内容脚本从求值到 `initialize()` 完成只有 **1 次 `await` / 1 次 IPC / 0 次 `storage` 读写**；
  后台 10 个事件监听器**全部同步注册**，求值 9.19 ms。这两处不需要动。
- 真正的病在**每段的固定开销**：每翻译一段，后台要串行做 **2 次 `storage.local` 读 + 2 次写**，
  每次读写的都是**整份历史数组**（典型 29.4 KB、最坏 175 KB）。500 段的页面 = 2000 次存储操作 /
  **23.9 MB** 存取量，而这一切发生在**把结果发回页面之前**。
- 第二病：`TranslationPerformanceHud` 每段重绘两次 `innerHTML`（665 字符 / 20 节点），
  且这个"debug-only 面板"在生产构建里**没有任何开关**，默认对用户可见。
- 第三病：`browser-polyfill` 被打进 **7 个入口**，重复浪费 **57.1 KB**（占全部产物的 10.4%），
  而其中 **9.0 KB / 92.7% 是一张 25 个命名空间的 API 白名单表**，扩展只用到其中 9 个；Firefox 上它
  只做一次 identity 检查就原样返回 `globalThis.browser`。

### 如果只做三件事

1. **把历史/健康度存储改成内存态 + 单次 debounce 落盘**（复用 `translation-cache-store.scheduleSave`
   已有的 `maxWait` 范式）。收益：每段 4 次存储 IPC → 0 次同步、500 段页面 23.9 MB → 约 30 KB。
   工作量 4–6 小时，无产品可见变化。
2. **给 HUD 加编译期开关**（`build.js` 里已经有 `__DEBUG__` define，一行包住 `onProgress` 即可），
   并把 `render()` 的 `innerHTML` 换成文本节点定点更新。收益：每段少 2 次 20 节点重排。
   工作量 1–2 小时。
3. **给 polyfill 去重**：内容侧把 `lib/browser-polyfill.js` 放进 `executeScript` 的 `files` 数组
   （同一次注入的多个文件共享同一执行环境的全局），popup/options 用独立 `<script>`。收益 **−38 KB 安装包**，
   零风险。工作量 2 小时。**不要**顺手把它删掉换成 shim —— 见第八节，那需要先定 `minimum_chrome_version`。

---

## 一、包体归因

### 1.1 七个入口（+1 个字幕策略入口）实际体积

`build.js` 的生产配置：`format: 'iife'`、`minify: true`、`treeShaking`、`pure: [console.log…]`。

| 入口 | min KB | 未压缩 KB | gzip KB | 占 min 总量 | 现有预算（未压缩） | 预算余量 |
|---|---|---|---|---|---|---|
| `content/content-script.js` | 147.4 | 370.7 | 46.1 | 26.9% | 440 | 15.7% |
| `content/summary/summary-entry.js` | 143.6 | 279.2 | 42.9 | 26.2% | 340 | 17.9% |
| `options/options.js` | 99.4 | 215.6 | 27.2 | 18.2% | 250 | 13.8% |
| `background/service-worker.js` | 78.4 | 206.0 | 24.8 | 14.3% | 210 | **1.9%** |
| `popup/popup.js` | 38.6 | 99.6 | 12.0 | 7.0% | 120 | 17.0% |
| `content/subtitle/youtube-subtitle-strategy.js` | 22.7 | 55.2 | 7.1 | 4.1% | 67 | 17.6% |
| `content/subtitle/subtitle-manager.js` | 15.3 | 41.9 | 4.8 | 2.8% | 50 | 16.2% |
| `content/subtitle/bilibili-subtitle-strategy.js` | 2.2 | 5.4 | 0.9 | 0.4% | 8 | 32.5% |
| **合计** | **547.7** | **1273.5** | **165.9** | 100% | — | — |

读法：`bundle-budget.test.mjs` 只约束**未压缩**体积，因此"minify 之后用户到底下载多少"完全没人看。
service-worker 的预算只剩 **4 KB**，任何一次小功能都会撞线——而它 12.1% 是 polyfill（见 1.3）。

### 1.2 逐模块归因（min，每入口 top 20）

完整表：`node .tmp/perf/analyze-meta.cjs min 20`（写 `.tmp/perf/attrib-min.md`）。

**`content/content-script.js` 147.4 KB**

| # | 模块 | KB | 占比 | 只在罕见路径？ |
|---|---|---|---|---|
| 1 | `@chenglou/pretext/generated/bidi-data.js` | 14.4 | 9.7% | **是**：RTL 文字方向数据，而支持的 11 种语言（EN/ZH/JA/KO/FR/DE/ES/RU/IT/PT/NL）**一种都不需要 bidi** |
| 2 | `@chenglou/pretext/analysis.js` | 12.7 | 8.6% | 否 |
| 3 | `src/content/page-translation-job.js` | 11.0 | 7.5% | 否 |
| 4 | `src/lib/browser-polyfill.js` | 9.5 | 6.5% | 见 1.3 |
| 5 | `@chenglou/pretext/line-break.js` | 8.0 | 5.4% | 否 |
| 6 | `src/content/content-runtime.js` | 6.5 | 4.4% | 否 |
| 7 | `src/content/enhanced-tooltip-manager.js` | 4.9 | 3.3% | 否（hover 才用，但静态 import） |
| 8 | `src/common/text-measurement.js` | 4.6 | 3.1% | 否 |
| 9 | `src/content/input-handler.js` | 4.3 | 2.9% | **是**：输入框翻译，默认开但多数页面永不触发 |
| 10 | `@chenglou/pretext/layout.js` | 4.1 | 2.8% | 否 |
| 11 | `src/content/layout/resize-controller.js` | 3.9 | 2.6% | **是**：面板缩放把手，只有浮动面板才用 |
| 12 | `src/content/display-manager.js` | 3.8 | 2.6% | 否 |
| 13 | `src/content/dom-walker.js` | 3.4 | 2.3% | 否 |
| 14 | `@chenglou/pretext/measurement.js` | 3.1 | 2.1% | 否 |
| 15 | `src/content/tooltip/hover-tooltip-surface.js` | 2.9 | 2.0% | 否 |
| 16 | `src/content/translatable-elements.js` | 2.9 | 2.0% | 否 |
| 17 | `src/content/element-translation-controller.js` | 2.4 | 1.6% | 否 |
| 18 | `src/content/translation-batch-queue.js` | 2.3 | 1.6% | 否 |
| 19 | `src/common/message-types.js` | 2.1 | 1.4% | 否 |
| 20 | `src/content/tooltip/tooltip-content-view.js` | 2.1 | 1.4% | 否 |
| — | 其余 41 个模块 | 38.6 | 26.2% | — |

**`@chenglou/pretext` 整体 42.3 KB = 内容包的 28.7%**，其中 `bidi-data.js` 14.4 KB 对当前支持语种是纯负担。

**`content/summary/summary-entry.js` 143.5 KB**

| # | 模块 | KB | 占比 |
|---|---|---|---|
| 1 | `src/lib/marked.esm.js` | 38.1 | 26.6% |
| 2 | `src/lib/readability.esm.js` | 32.0 | 22.3% |
| 3 | `src/content/summary/summary.view.js` | 15.0 | 10.5% |
| 4 | `src/content/summary/summary.js` | 9.9 | 6.9% |
| 5 | `src/lib/browser-polyfill.js` | 9.5 | 6.6% |
| 6 | `src/content/layout/summary-layout-controller.js` | 4.6 | 3.2% |
| 7 | `src/common/text-measurement.js` | 4.5 | 3.2% |
| 8 | `src/content/summary/summary-message-renderer.js` | 4.5 | 3.1% |

`[批13 遗留]` 拆包本身是成功的（内容包 −38.6%），但 **marked 38.1 KB 仍然和 readability 一起被立即加载**，
而 marked 只在"AI 返回 markdown"这一条分支上有用。两者合计 70.1 KB = 摘要包的 48.8%。

**`options/options.js` 99.4 KB**

| # | 模块 | KB | 占比 | 触达路径 |
|---|---|---|---|---|
| 1 | `src/options/options-actions.js` | 16.3 | 16.4% | 首帧 |
| 2 | `src/lib/browser-polyfill.js` | 9.5 | 9.6% | — |
| 3 | `src/options/components/AIEngineModal.js` | 8.5 | 8.5% | **点"添加引擎"按钮** |
| 4 | `src/options/components/DomainRuleModal.js` | 7.3 | 7.3% | **点"添加站点规则"按钮** |
| 5 | `src/options/options-elements.js` | 6.8 | 6.8% | 首帧 |
| 6 | `src/options/ui-constants.js` | 4.7 | 4.8% | 首帧 |
| 7 | `src/options/options-renderer.js` | 4.6 | 4.6% | 首帧 |
| 8 | `src/options/components/ThemedSelect.js` | 4.6 | 4.6% | 首帧 |
| 9 | `src/common/text-measurement.js` | 4.6 | 4.6% | 首帧（见 3.4） |
| 10 | `src/options/options-events.js` | 3.8 | 3.9% | 首帧 |

两个模态合计 **15.8 KB = 15.9%**，只由两个按钮触达。批 12 的裁决是"`format: 'iife'` 不做代码分割，
动态 `import()` 会被内联，所以不产生独立 chunk" —— **这个结论对，但推导错**：批 13 已经证明可以走
"独立入口 + 后台/宿主按需注入"（`summary-entry.js`）。options 是普通 HTML 页面，加一个
`<script src="options/modals.js">` 即可，不需要 esbuild 的 chunk 能力。

**`popup/popup.js` 38.6 KB**

| # | 模块 | KB | 占比 |
|---|---|---|---|
| 1 | `src/lib/browser-polyfill.js` | 9.5 | 24.6% |
| 2 | `src/popup/popup-actions.js` | 5.0 | 13.0% |
| 3 | `src/common/text-measurement.js` | 4.5 | 11.8% |
| 4 | `src/popup/popup-renderer.js` | 3.9 | 10.1% |
| 5 | `src/common/settings-domain.js` | 3.7 | 9.7% |
| 6 | `src/common/settings-manager.js` | 2.1 | 5.4% |
| 7 | `src/common/message-types.js` | 2.1 | 5.3% |

**popup 每 4 个字节就有 1 个是 polyfill，每 8 个字节有 1 个是文本测量。**

### 1.3 `lib/browser-polyfill`：重复 57.1 KB，其中 92.7% 是永远用不到的白名单表

| 事实 | 数字 | 证据 |
|---|---|---|
| 单份 min | 9.5 KB（min）／38.4 KB（源码 1225 行） | metafile |
| 出现在几个入口 | **7 / 8** | metafile |
| 各入口合计 | 66.6 KB | metafile |
| 重复浪费（保留一份） | **57.1 KB = 产物总量 10.4%** | metafile |
| 其中 api-metadata 字面量 | **9015 B / 9728 B = 92.7%** | 见复现命令 |
| 白名单覆盖命名空间 | 25 个 | 同上 |
| 扩展实际调用命名空间 | **9 个**：`runtime` `storage` `tabs` `scripting` `i18n` `action` `contextMenus` `webNavigation` `commands` | `grep -rhoE "browser\.\w+\.\w+" src` |

**真的需要吗？分平台回答：**

- **Firefox 109+：完全不需要。** polyfill 自己的第一个分支就是
  `if (globalThis.browser?.runtime?.id) module.exports = globalThis.browser`（`src/lib/browser-polyfill.js:1` 附近）
  —— 它只做一次身份检查，然后把原对象返回。Firefox 上这 9.5 KB 是纯粹的解析成本。
- **Chrome 88+：需要"某个叫 `browser` 的东西"，但不需要这张表。** Chrome 从不暴露 `browser` 命名空间
  （只有 `chrome`），所以 `import browser from '../lib/browser-polyfill.js'` 在 Chrome 上必须靠注入。
  逐项核对后，真正只有 polyfill 能做的是**一件事**：`runtime.onMessage` 监听器**返回 Promise** 当作响应
  （`src/background/service-worker.js:167-181`、`src/content/content-runtime.js:354` 都依赖它）。
  `storage`/`tabs`/`scripting`/`action` 在 Chrome 88+ 上原生返回 Promise。
  **但仓库没有声明 `minimum_chrome_version`**（`public/manifest.base.json` 只有 `manifest_version`/`permissions`，
  `browser_specific_settings.gecko` 只有 `id`，连 `strict_min_version` 都没有），所以"原生 Promise 可用"
  这个前提目前**没有在 manifest 里被钉住**——这是能不能瘦身的真正前提，见第八节。

**可做的两件事（收益与风险完全不同）：**

| 方案 | 省下 | 风险 | 工作量 |
|---|---|---|---|
| A. 只去重（内容侧走 `files` 数组共享，popup/options 走 `<script>`） | **−38.1 KB** 安装包（4×9.5） | 极低：注入顺序明确 | 2h |
| B. 换成 ~40 行本地 shim（只包 9 个命名空间 + onMessage Promise 适配） | **−59.5 KB**（7×8.5） | 中：需先钉 `minimum_chrome_version` 并在真机验 9 条路径 | 1–2 天 |

> A 的正确性依据：`script-injector.js` 用**一次** `scripting.executeScript({ files: [...] })` 注入，
> 同一次调用的多个文件共享同一 isolated world 的全局。把 `lib/browser-polyfill.js` 排在
> `CORE_SCRIPT_FILES`/`SUMMARY_SCRIPT_FILES`/字幕文件数组的最前面即可，且 polyfill 会自己
> `globalThis.browser = exports`。`test/helpers/bundle.mjs` 里那个"读全局的转接层"就是生产版需要的那 1 行。

**复现**

```bash
node .tmp/perf/build-meta.cjs            # 写 .tmp/perf/dist-min + meta-min.json
node .tmp/perf/build-meta.cjs --unmin    # 写 .tmp/perf/dist-unmin + meta-unmin.json
node .tmp/perf/analyze-meta.cjs min 20   # 逐入口 top20 + 跨入口重复
node -e "const s=require('fs').readFileSync('.tmp/perf/dist-min/content/content-script.js','utf8');
  console.log('metadata', s.indexOf('privacy=')-s.indexOf('{alarms:'))"
```

---

## 二、启动路径

### 2.1 内容脚本：注入 → `initialize()` 完成

实测（jsdom + `vm` 执行真实产物，桩掉 `browser`/存储）：

| 步骤 | `await` | IPC | `storage` 读 | 备注 |
|---|---|---|---|---|
| ① 静态 import 求值（147.4 KB min） | 0 | 0 | 0 | 实测 **12.05 ms**（V8/jsdom） |
| ② `preloadLanguageDetector()` | **0（不 await）** | 0 | 0 | **触发一次 354.8 KB 的 `import()`**（见 2.4） |
| ③ `new ContentRuntime()`：`TranslationBatchQueue` / `ElementTranslationController` / `createContentMessageHandlers` | 0 | 0 | 0 | 纯同步构造 |
| ④ `registerMeasurementEngine()`（pretext 已在 ① 内联） | 0 | 0 | 0 | 同步 setter |
| ⑤ `runtime.onMessage.addListener` | 0 | 0 | 0 | **在任何 await 之前** ✓（批 12 J14 修复有效） |
| ⑥ `await getEffectiveSettings()` → `sendMessage(GET_EFFECTIVE_SETTINGS)` | **1** | **1** | 0（内容侧） | 后台若缓存冷则读 1 次 `storage.local('settings')` |
| ⑦ `requestSummaryModule()` / `initializeInputHandler()` / `QuickActionPanel.initialize()` | 0 | 0 | 0 | 同步 |
| **合计** | **1** | **1** | **0** | |

**结论：启动链路无可优化项。** 1 次 IPC 是理论上最少值（要拿设置就必须问后台），监听器顺序正确，
内容侧不碰存储。**真正的启动成本在字节，不在次数**：147.4 KB 解析 + 354.8 KB 的 franc 拉取。

### 2.2 后台 service worker：冷启动 → 首个消息可响应

| 项 | 值 | 证据 |
|---|---|---|
| 模块求值（含解析）实测 | **9.19 ms**（min）/ 12.94 ms（未压缩） | `.tmp/perf/sw-boot.mjs`，V8 |
| `addEventListener` 注册数 | **10，全部同步**，无一个在任何 `await` 之后 | 同上 `addListenerCalls: 10` |
| 构成 | **8 个不同事件、10 次 `addListener`**：`runtime.onMessage`(1)、`runtime.onInstalled`(1)、`commands.onCommand`(1)、`contextMenus.onClicked`(1)、`webNavigation.onCompleted`(1)、`webNavigation.onHistoryStateUpdated`(1)、`tabs.onRemoved`(**2**：`service-worker.js:79` 与 `tab-state-manager.js:16` 各一个)、`storage.onChanged`(**2**：`settings-manager.js:34` 与 `translator-manager.js:32` 各一个) | 同左 |
| 消息可响应延迟 | **9.19 ms + 1 次 `storage.local.get('settings')`（仅缓存冷时）** | — |

模块求值期**发起但不等**的后台存储读（`translator-manager.js:21-29` static block）：

1. `cacheStore.load()` —— 读 `translationCache`，**满额时 1.1 MB 单键 JSON**；
2. `updateConcurrencyLimit()` —— 读 `settings`；
3. `updateCacheSize()` —— 读 `settings`（同一份，未复用）。

这三次读与"第一条 translateText 消息"竞争同一份 I/O，而且 `load()` 不完成时缓存是空的
（首条翻译必然 miss）。这不是 bug，但意味着**SW 每次被唤醒都要为一份可能为空的缓存付 1.1 MB 的反序列化**。

### 2.3 popup：打开 → 首帧

`popup-actions.js:loadAndApplySettings()` 的真实调用序列（全部串行 `await`）：

| # | 调用 | 往返对象 | 能否并行 |
|---|---|---|---|
| 1 | `tabs.query({active,currentWindow})` | 浏览器 | — |
| 2 | `runtime.sendMessage(GET_EFFECTIVE_SETTINGS)` | **后台**（可能再读一次 `storage.local`） | — |
| 3 | `tabs.sendMessage(REQUEST_SUBTITLE_TRANSLATION_STATUS)` | 内容脚本 | **可**：与 #4 无依赖 |
| 4 | `tabs.sendMessage(REQUEST_TRANSLATION_STATUS)` | 内容脚本 | **可**：与 #3 无依赖 |

**首帧 = 4 次串行 IPC。** #3 与 #4 之间没有数据依赖，`Promise.all` 即可省 1 个往返
（`#loadSubtitleControls(finalRule)` 只依赖 #2 的结果）。

**另有一处重复**（`popup-actions.js:204-217` `handleRuntimeMessage`）：

```js
if (request.type === SETTINGS_UPDATED || RELOAD_TRANSLATION_JOB) {
    await this.loadAndApplySettings();          // 内部末尾已经 await 过 updateButtonStateFromContentScript()
    await this.updateButtonStateFromContentScript();  // ← 第二次
}
```

即：每次设置变更，popup 付 **1 次 §1 + 1 次 §2 + 1 次 §3 + 2 次 §4 = 5 次 IPC**，
其中第 2 次 §4 纯属重复（`loadAndApplySettings()` 末尾已经调过）。`[批12 U1 遗留]` U1 为了修"保存后弹回旧值"加了刷新序号，但把这条路径的
二次刷新一起留下来了。

### 2.4 franc：每次注入都拉 354.8 KB（363,294 B）

`src/common/lang-detect.js` 把 franc 拆成运行时 `import()`（未压缩 363,294 B / gzip 124,622 B），
这是批 12 之前的正确决定（否则 4 个入口各内联一份）。但 `content-runtime.js:381` 在
**`initializeContentRuntime()` 的最开头无条件调用 `preloadLanguageDetector()`**：

- 触发条件：内容脚本被注入（= 用户点了翻译 / 划词 / 字幕）。
- 代价：**363,294 B（354.8 KB）文件读取 + 解析**（gzip 124,622 B，即装包净增 121.7 KB）。而且**不 await**——`precheck.shouldTranslate` 在 franc 就绪前
  走启发式规则，所以"预热"在同一轮里大概率还没赶上第一次预检（`precheck` 是同步的）。
- 结论：**付出了 354.8 KB 的成本，却常常拿不到它的收益。** 要么改为"首次 TTS / 出现 franc 判定
  分歧时"再拉，要么接受异步语义并把预检改成等待。

**复现**

```bash
node .tmp/perf/sw-boot.mjs          # SW 求值 + addListener 计数
node .tmp/perf/content-boot.mjs     # 内容脚本 IPC / storage / await 计数
```

---

## 三、运行时热路径

方法：jsdom 里构造一个真实形状的页面（200 个 `<article>`，每块 `h2 + p(strong,a,span) + ul>li(code)`，
共 1225 个元素、600 个候选），给 `getComputedStyle`/`getBoundingClientRect`/`offsetWidth`/`innerHTML`/
`closest`/`matches`/`querySelector`/`appendChild`/`classList`/`setProperty`/`JSON.stringify` 打桩计数，
然后跑**真实源码路径**（`findTranslatableElements` → `DOMWalker.create` → `shouldTranslate` →
`DisplayManager.displayLoading/displayTranslation`）。脚本：`.tmp/perf/hotpath-count.mjs`。

> 说明：jsdom 没有布局引擎，桩里给 `offsetWidth=640`、`rect.width=640` 让可见性分支走通。
> 下表统计的是**调用次数**，与浏览器无关；浏览器里每次 `offsetWidth`/`getBoundingClientRect`
> 在布局脏时必须同步回流，所以"次数"就是"回流次数"。

### 3.1 每段（每元素）固定开销

| 阶段 | 操作 | 次数/元素 | 是否有布局代价 | 代码位置 |
|---|---|---|---|---|
| 候选提取 | `closest` | 2.33 | 否（选择器匹配） | `translatable-elements.js:107`（exclude 选择器 30+ 项） |
| 候选提取 | `querySelector` | 1.67 | 否 | `translatable-elements.js:196`（`hasDescendant` 逐子节点）、`:253` |
| 候选提取 | `querySelectorAll` | 0.002 | 否 | 每文档 1 次 |
| 文本抽取 | `closest` | 4.00 | 否 | `dom-walker.js:196`、`:202`、`:212`、`:232` |
| 文本抽取 | `matches` | 1.33 | 否 | `dom-walker.js:223`（exclude） |
| 文本抽取 | **`getComputedStyle`** | **2.00** | **是** | `dom-walker.js:140`（唯一的 `#createStyleResolver`） |
| 文本抽取 | **`offsetWidth` / `offsetHeight`** | **2.00** | **是**（强制布局） | `dom-walker.js:68` |
| 文本抽取 | `textContent` 读（整棵子树） | 1.00 | 否（但分配全文字符串） | `dom-walker.js:216`（另有 `:122` 的 `textContent.length`） |
| 显示写入 | **`innerHTML` 读** | **1.00** | 否（但序列化整棵子树） | `element-translation-controller.js:57` |
| 显示写入 | `querySelector` | 2.00 | 否 | 控制器自检 + `revert()` |
| 显示写入 | `createElement` | 2.00 | 否 | loading 指示器 + 译文容器 |
| 显示写入 | `appendChild` | 4.00 | 否 | 两次写入 × 2 |
| 显示写入 | `classList.add/remove` | 4.00 | 否 | 状态类 |
| 显示写入 | **`getBoundingClientRect`** | **2.00** | **是**（强制布局） | `translated-content-layout-service.js:12,13` |
| 显示写入 | **`getComputedStyle`** | **1.00** | **是** | `text-measurement.js:267`（`readTextStyle`，**无缓存**） |
| 显示写入 | `style.setProperty`（本项目） | 3.00 | 是（样式失效） | `translated-content-layout-service.js:56-58`、`:76-77` |
| 显示写入 | `JSON.stringify`（整段文本） | **1.00** | 否（但复制全文） | `text-measurement.js:353`（`#prepare` 缓存键） |
| 进度上报 | `innerHTML` **写** | **2.00** | **是（20 节点重排）** | `translation-performance-hud.js:83` |

**单段合计：布局强制读 7 次**（`getComputedStyle` 3 + `offsetWidth/offsetHeight` 2 + `getBoundingClientRect` 2），
另有 3 次 `style.setProperty` 造成样式失效；DOM 写入 ~10 次、选择器查询 ~9 次；
整段文本被完整复制 2 次（`textContent` + `innerHTML`）再加 1 次 `JSON.stringify`。

600 段页面：**600 × 7 = 4,200 次布局强制读 + 1,800 次样式失效写入**。这是浏览器里"翻译时页面发涩"的直接原因。

### 3.2 三处必须重构的点

**(a) `displayLoading` 为每段读一次 `element.innerHTML`，而只有 `replace` 模式会用它**
`element-translation-controller.js:57` → `displayLoading(element, mode, { originalContent: element.innerHTML, … })`，
**无条件**执行，与 `displayMode` 无关。而唯一读它的地方是 `display-manager.js:141-147`：

```js
if (element instanceof HTMLElement && typeof data.originalContent === 'string'
    && oldDisplayMode === 'replace' && element.innerHTML !== data.originalContent) {
    element.innerHTML = data.originalContent;   // 只在「离开 replace 模式」时兜底
}
```

所以 `append` / `hover` 模式下这 1 次整棵子树序列化 + 长期持有（`WeakMap` 里）**是纯浪费**。
修法不是删字段，而是**按模式惰性采集**：`displayMode === 'replace'` 时才读 `innerHTML`。
收益不变（每段 −1 次子树序列化），风险从"改行为"降到"改一行条件"。

**(b) `#collectElementNode` 对每个子节点做 `offsetWidth||offsetHeight`**
`dom-walker.js:68`。`#isElementVisible` 的第 3 步会在**遍历时**触发布局，而遍历本身不写 DOM，
所以一次 `create()` 内的多次读是"干净"的；但多个 `create()` 与 `appendChild` 交错时（真实场景：
`page-translation-job` 的 idle 批次里连续 translate 12 个元素），每次进入新元素都吃一次全量回流。
修法：把第 3 步降级为可选（只在第 1、2 步都通过且 `rect.width===0` 时兜底），或整批共用一个
`requestAnimationFrame` 之前的布局快照。

**(c) `text-measurement.js` 的两处遗留**

```js
// :315 —— 批 12 G4 已修（廉价模板串键）
const measurementKey = `${engine.name}\u0000…\u0000${normalizedText}`;
// :353 —— 仍然是 JSON.stringify（同一段文本 → 再完整转义复制一次）
const prepareKey = JSON.stringify([engine.name, text, textStyle.font, …]);
```

`[批12 G4 遗留]` 修了 `#measurementCache` 的键，漏了 `#preparedCache` 的键。每段文本因此多一次
全文 `JSON.stringify`（并多持有 500 份 prepared 对象）。另外 `readTextStyle()`（`:258`）**每次测量
都调 `window.getComputedStyle(referenceElement)`**，同一元素在 `applyAppendLayout` 里一次、在
`DOMWalker` 里又一次——3.1 表里那个 1.00 次/元素就是它。

### 3.3 `TranslationPerformanceHud`：debug 面板在生产里每段重绘

| 事实 | 值 | 证据 |
|---|---|---|
| 每次 `update()` 的 DOM 写入 | **1 次 `innerHTML` 赋值，665 字符，生成 20 个节点** | `.tmp/perf/hotpath-count.json` → `phaseD` |
| 每次触发的事件 | `emitProgress()`，即 **每段 ≥2 次**（start + complete），另加 scroll/mutation/observe | `page-translation-job.js` 的 `recordTranslationStarted/Completed` |
| 500 段页面 | **1,000 次 `innerHTML` 重写 = 20,000 个节点分配** | 同上 |
| 是否受开关控制 | **否** | `content-runtime.js:76-84` 无条件 `performanceHud.update(...)`；`translation-performance-hud.js` 里没有 `__DEBUG__` |
| 是否可见 | **是**：`update()` 在 state≠translated 时调 `show()` → `classList.add('visible')` → `opacity:1` | `translation-performance-hud.js:76-81`、`:31-33`、`style.css:138` |
| 规格怎么说的 | `full-refactor-review-1.7.4.md:218`：**"`translation-performance-hud.js` 是 debug-only 的运行时面板"** | 与代码不符 |

这不只是性能问题：**规格声称它是 debug-only，实现里它是默认 UI**。修法有两种取向（见第八节），
但无论哪种，`render()` 必须是"文本节点定点更新 + `requestAnimationFrame` 合并"，不能是 `innerHTML`。

### 3.4 `uiTextLayoutService.applyTree()`：options/popup 每次渲染都全量测量

实测（jsdom，真实 `options.html`）：

| 页面 | DOM 元素 | 被测量元素 | `getBoundingClientRect` | `JSON.stringify` | 首次 applyTree | 二次 applyTree |
|---|---|---|---|---|---|---|
| `options/options.html` | 389 | 75 | **150** | 150（+jsdom 内部噪声） | 254.8 ms（jsdom） | 8.5 ms（签名命中但仍读 150 次 rect） |
| `popup/popup.html` | 65 | 12 | **24** | 12 | 38.4 ms（jsdom） | 2.5 ms |

每条 rect 都是一次强制布局；`signature` 用的是 `JSON.stringify([text, width, …])`（`ui-text-layout-service.js:32`），
与 3.2(c) 同源。jsdom 的绝对毫秒不可外推，但**"每次 options 渲染读 150 次 `getBoundingClientRect`"** 是真实的。

### 3.5 观察器数量与批次

| 项 | 现状 | 评价 |
|---|---|---|
| `IntersectionObserver` 实例 | **1 个**（`page-translation-job.js:237`），`threshold: 0`，`root: null` | 良好；批 12 关于 `threshold` 的裁决正确 |
| `MutationObserver` 实例 | **1 个**，`{childList, subtree}` on `document.body` | 良好；每次回调对每个 added element 做 1 次 `closest`（7 选择器）+ 1 次 `getComputedStyle` + `offsetParent`，但自家写入会被 `[data-translation-id]` 祖先命中后立即跳过，实测每段约 1 次回调 |
| `window` scroll/wheel/touchmove | 3 个 `passive: true` 监听，共用同一个 handler | 良好 |
| `#processInitialScan` 批大小 | `INITIAL_SCAN_CHUNK_SIZE = 12`，单位是**顶层 body 子节点**，不是元素 | **不适配**：一个 `<div id="app">` 就是"1 块"，整页在 1 个 chunk 里跑完；`hasIdleTime()` 只在**第 1 块之后**才检查 |
| `#scheduleTranslations` 批大小 | **没有时间预算**：一个 idle callback 里 `forEach` 翻译全部入参元素 | **不适配**：视口内一次交集产生 200 个元素 → 200 次 `DOMWalker.create` + 200 条 `sendMessage` 在同一个回调里 |
| `TranslationBatchQueue` | `maxItems: 12` / `maxChars: 10000` / `delayMs: 150` | 仅 AI 引擎走这条路；Google/DeepL 每段一次独立 `TRANSLATE_TEXT`，从不合并 |

**这是"批次大小自适应"这一问的答案：初始扫描勉强算自适应（12 块 + idle 剩余 >4ms），
翻译调度完全不自适应。** 修法：`#scheduleTranslations` 改成"处理到 `deadline.timeRemaining() > 4` 为止，
剩余元素放回队列并再排一次 idle callback"——与 `#processInitialScan` 同构，20 行。

### 3.6 `requestIdleCallback` 单次预算

`#processInitialScan` 首块**无条件执行**（`processedChunks === 0 || hasIdleTime()`）。若首块是整页容器，
则不管它花 5 ms 还是 500 ms 都跑完。这是一个"本意是让位于主线程、实际可能霸占 500 ms"的形状。

**复现**

```bash
node .tmp/perf/hotpath-count.mjs --elements=200
node .tmp/perf/ui-layout-cost.mjs
```

---

## 四、存储 I/O

### 4.1 全景

| 存储区 | 键 | 写入时机 | 单次字节量级（实测/推算） | 风险 |
|---|---|---|---|---|
| `local` | `settings` | 任何设置变更（读-改-写整份） | 1.2 KB（默认）／**16.7 KB**（3 引擎 + 40 规则 + 30 术语） | 每次读改写 + 每个上下文各重读一次 |
| `local` | `translationCache` | 翻译中，debounce 2s / 上限 15s | **1.1 MB**（5000 条满额） | 单键大块写；SW 唤醒后必读一次 |
| `local` | `translationHistory` | **每翻译一段** | **29.4 KB**（80 条典型）/ **175 KB**（1000 字符截断满额） | **见 4.2，P0** |
| `local` | `providerHealth` | **每翻译一段** | ~300 B | 同上，次数问题 |
| `local` | `translationFailureQueue` | 每次失败 | 同历史（80 条） | 同上 |
| `session` | `injectedFrames` | 每次注入 | 每标签页 × 每 frame × 文件列表，~100 B | 每次 = 1 读 + 1 写整表 |
| `session` | `tabTranslationStates` | 每次状态变更 | ~50 B/标签页 | 同上 |
| `session` | `sessionTabTranslations` | 自动翻译注册 | ~50 B/标签页 | 同上 |
| `sync` | `settings` + 分片 | 仅手动上传/下载 | 每片 ≤8192 B，N 片 = N 次 `sync.set` | 同步配额 120 次/分钟；仅手动路径 |

### 4.2 P0：每段 4 次全量读改写，且阻塞结果返回

`translate-text-handler.js:33-49`（每段都会走）：

```js
const result = await translatorManager.translateText(...);
await recordEngineHealth({...});          // → providerHealth: 读全表 + 写全表
await recordTranslationOutcome({...});    // → translationHistory: 读全表 + 写全表
await sendToTabIgnoringMissingReceiver({...});  // ← 结果在这之后才回到页面
```

`BoundedStorageList.add()`（`translation-product-stores.js:29-32`）就是 `list()` 全读 + `set()` 全写；
`ProviderHealthStore.record()`（`:131`）同形。批量路径一模一样：`translate-text-batch-handler.js:42-52`
是 `for (const [index, result] of results.entries()) await recordTranslationOutcome(...)` ——
12 条一批 = **24 次全量读写**，同样在 `sendMessage` 之前。

**实测**（`.tmp/perf/storage-cost.mjs`，内存 mock + 每次读写强制一次 JSON 克隆，模拟 IPC 下限）：

| 指标 | 值 |
|---|---|
| 每段存储操作 | **2 读 + 2 写** |
| 每段存取字节 | **25.1 KB 读 / 25.1 KB 写** |
| 500 段页面总量 | **1000 读 + 1000 写 = 23.9 MB** |
| 仅 JSON 序列化耗时 | **284 ms / 500 段 = 0.57 ms/段** |
| 最坏情况（1000 字符截断历史） | 历史数组 175 KB → 每段存取 **约 525 KB**，500 段 = **260 MB** |
| 对比：5000 条翻译缓存落盘 | 1.1 MB，`Object.fromEntries` 17.1 ms + 解析 8.7 ms（**每 ≤15s 一次**） |

浏览器里每次 `storage.local.get/set` 是一次跨进程异步 IPC（典型 0.3–1 ms，本机无法在不启动真浏览器
的前提下测准，故不作为结论）。**即便只算 JSON 下限，500 段页面也要多付 284 ms 的纯主线程时间，
而且这 284 ms 是串行挡在"译文上屏"之前的。**

**修法（这是本条的全部收益）**：`BoundedStorageList` 与 `ProviderHealthStore` 改成
"内存态 + `scheduleSave()`（debounce + `maxWait`）"，直接复用 `translation-cache-store.js:102-120`
已经验证过的模式；记录动作改为 `void`（不等）；把 `sendToTab...` 提到记录之前。
预计：每段 4 次 IPC → 0 次；500 段 23.9 MB → ~30 KB（一次落盘）。

### 4.3 设置：一份 16.7 KB 的对象，含所有 API Key，发给每一个内容脚本

`GET_EFFECTIVE_SETTINGS` 的返回是 `resolveEffectiveSettings()` 的结果 —— 也就是**整份设置**
（`settings-domain.js:148-152`：`{...settings, source}`）。实测：

| 场景 | 字节 | 含什么 |
|---|---|---|
| 默认 | 1,297 B | — |
| 3 个 AI 引擎 + 40 条域名规则 + 30 条术语（合理使用半年后） | **16,668 B** | **全部 `apiKey`（`sk-…`）、全部站点规则、全部术语** |

内容脚本真正需要的字段：`targetLanguage` `translatorEngine` `sourceLanguage` `displayMode`
`translationSelection(content/exclude)` `inputTranslationSettings` `summarySettings` `quickActionPanel`
`translateAfterScrollIdle` `scrollIdleDelayMs` `glossary`（约 10 个标量 + 2 个对象）。
**16.7 KB 里有 ~13 KB 是内容侧永不读的**（`aiEngines` 全部、`domainRules` 除当前站点外全部）。

同时 `validateSettings()`（深克隆 + 逐键合并）在**每次**缓存失效后各上下文跑一次：实测
0.032 ms（默认）/ **0.241 ms**（上述配置），`deepFreeze` 另计。一次设置保存 = 写入方 1 次读改写 +
每个活跃上下文各 1 次读 + 校验 + 冻结。次数不多，但**每次都在搬 16.7 KB**。

### 4.4 `storage.session`：每次注入 5 次操作

`tab-handlers` → `ensureScriptsInjected` → `getInjectedFiles`（1 读）→ `markFrameAsInjected`（1 读 + 1 写）
→ `setTabStatus`（1 读 + 1 写）。批 12 的 G3 把"每文件各读一次"降到了"一次批量读"（有效），
但 `#readModifyWrite` 仍然是**整表读 + 整表写**（`tab-state-manager.js:250-259`）：
标签页越多、frame 越多，每次写入搬运的表越大。当前量级（几十个标签页 × 几百字节）不构成问题，
是"形状不对但暂时不疼"。

### 4.5 序列化成本（可直接用于预算）

| 对象 | 字节 | `Object.fromEntries` | `JSON.parse` |
|---|---|---|---|
| 5000 条翻译缓存 | 1,108,912 | 17.1 ms | 8.7 ms |
| 80 条历史（典型） | 29,431 | — | — |
| 80 条历史（1000 字符截断） | 175,031 | — | — |

**复现**

```bash
node .tmp/perf/storage-cost.mjs 500
node .tmp/perf/settings-size.mjs
```

---

## 五、测试基建

### 5.1 总耗时（实测）

```
npm test  →  464 tests / 463 pass / 1 fail
             duration_ms 7154.07   wall 7215 ms    (56 个测试文件，冷跑)
             duration_ms 5795.12   wall 5795 ms    (同一命令热跑，第二次)
```

两次同机同命令差 1.36 s（−19%），差异来自文件系统缓存与 16 核上的并发争用。**下文一律以冷跑
7.2 s 为口径**（对门禁更保守），并在需要时标注热跑值。唯一 fail 是
`specs/verifications/audit-product-platform.md:189`（并行评审产出的另一份文档，非本文件，
本文件已单独通过 `node --test test/doc-format.test.mjs`）。

### 5.2 每文件耗时（串行单跑，含 node 启动 ~90–117 ms 基线）

`node --test test/<file>` 逐个跑，排序后 top 26：

| 文件 | ms | 主要成本 |
|---|---|---|
| `test/input-handler.test.mjs` | 3332 | **1,200 ms 是真 `setTimeout` 等待**（3 处 `setTimeout(…, 400)`）+ 18 个用例 + 1 × esbuild |
| `test/translator-manager-batch.test.mjs` | 2450 | esbuild + 大量 `await` 微任务 |
| `test/translation-pipeline-units.test.mjs` | 2306 | esbuild + 200 ms 真等待 |
| `test/dom-walker.test.mjs` | 1587 | 真实 DOM 遍历 + esbuild |
| `test/popup-architecture.test.mjs` | 1545 | esbuild + jsdom |
| `test/summary-dialog-accessibility.test.mjs` | 1515 | esbuild + jsdom |
| `test/options-architecture.test.mjs` | 1486 | esbuild |
| `test/html-sanitizer.test.mjs` | 1312 | 模糊输入扫描 |
| `test/subtitle-behavior.test.mjs` | 1242 | esbuild |
| `test/layout-services.test.mjs` | 1240 | 测量服务（无 esbuild） |
| `test/display-mode-switch.test.mjs` | 1230 | **4 × esbuild**（全仓最多） |
| `test/dom-processing.test.mjs` | 1229 | jsdom |
| `test/build-manifest.test.mjs` | 1222 | 起子进程跑构建脚本 |
| `test/page-translation-job.test.mjs` | 1100 | esbuild + 45 ms 真等待 |
| `test/summary-content-extractor.test.mjs` | 1020 | esbuild + readability |
| `test/options-modal-accessibility.test.mjs` | 997 | esbuild + jsdom |
| `test/display-system.test.mjs` | 955 | — |
| `test/content-feature-modules.test.mjs` | 886 | esbuild |
| `test/hover-keyboard-access.test.mjs` | 845 | esbuild |
| `test/content-runtime-architecture.test.mjs` | 754 | esbuild |
| `test/tooltip-accessibility.test.mjs` | 731 | **2 × esbuild** |
| `test/summary-entry.test.mjs` | 712 | esbuild |
| `test/message-types.test.mjs` | 533 | esbuild |
| `test/layering.test.mjs` | 470 | 遍历 161 个文件建图 |
| `test/i18n-integrity.test.mjs` | 468 | 扫 locale |
| `test/bundle-budget.test.mjs` | 254 | **1 次 7 入口 esbuild** |

**串行合计 39,407 ms**；并行 `npm test` 7,215 ms（≈5.5×，`node --test` 按 CPU 数并发）。

另一条容易忽略的成本：**全仓测试里有 17 处真实 `setTimeout` 等待，合计 1,585 ms**——
占整套 7,215 ms 的 **22%**，其中 `input-handler` 一家 1,200 ms：

| 文件 | 真实等待 |
|---|---|
| `test/input-handler.test.mjs` | 1,200 ms（3 × 400 ms + 1 × 0 ms） |
| `test/translation-pipeline-units.test.mjs` | 200 ms |
| `test/settings-manager-events.test.mjs` | 140 ms |
| `test/page-translation-job.test.mjs` | 45 ms |

这些等待是为了等 debounce / 空闲回调。`node:test` 自带 `mock.timers`
（`t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })`），`cache-persistence`（6 处）与
`options-modal-accessibility`（2 处）已经在用——同一套模式没推广到 `input-handler`。

### 5.3 esbuild 调用次数与可复用性

| 项 | 数量 | 实测成本 |
|---|---|---|
| `bundleModule()` 调用点 | **26 次**（21 个文件） | 首次 90.9 ms，同进程第二次 52.6 ms，小模块 22.0 ms |
| 直接 `await build(...)` 调用 | **27 次**（27 个文件自行 `import { build } from 'esbuild'`） | 同上量级 |
| **esbuild 总调用次数** | **53 次**（48 个文件） | — |
| `bundle-budget.test.mjs` 的整包构建 | 1 次 / 7 入口 | 约 90 ms（本机 `build-meta.cjs` 53 ms） |
| `build-manifest.test.mjs` 的子进程构建 | 1 次 | 约 1.2 s（文件总耗时 1222 ms） |
| 生产 `build.js` 本身 | 1 次 7 入口 | **53 ms**（esbuild，`--unmin` 65 ms） |

**结论：53 次 esbuild × 平均约 55 ms ≈ 2.9 s**，真实等待 **1.6 s**，其余是"每文件一个 node 进程"
的基线（56 × 约 100 ms ≈ 5.6 s，串行口径）。三者有重叠（并行执行），但在 7.2 s 的墙钟里，
esbuild 与真实等待各占约 1/4，**都值得砍，且都能砍**。

### 5.4 能砍掉多少秒（按收益排序）

| 方案 | 省下 | 风险 | 实现要点 |
|---|---|---|---|
| ① **`input-handler.test.mjs` 的 1,200 ms 真等待换成 `t.mock.timers`** | **1.2 s**（该文件 3.3 s → 约 2.1 s；它是全仓最慢单文件，直接压在关键路径上，热跑口径下收益上限就是整套的三分之一） | 低：`cache-persistence.test.mjs` 已用同一套假定时器 | 3 处 `setTimeout(…, 400)` |
| ② 把 `bundleModule` 结果按"入口源码 + 插件配置"做**进程内 LRU**（不是跨进程） | **≈1.2 s** | 低（单进程内，键算错只影响同一文件） | `test/helpers/bundle.mjs` 加 20 行 Map；批 12 拒绝的是"跨进程缓存"，本条是进程内 |
| ③ `display-mode-switch`(4) / `translation-runtime-modules`(3) / `tooltip-accessibility`(2) / `translation-handlers`(2) 各合并成一个入口 | **≈0.5 s** | 低 | 一个入口导出多个符号，替代 11 次构建 |
| ④ `build-manifest.test.mjs` 不再起子进程，改为 `require('../build.js')` 的纯函数 | **≈1.0 s** | 中：`build.js` 目前是"脚本"不是"库"，要拆出 `generateManifest()` | 文件 1222 ms → 约 200 ms |
| ⑤ 其余 3 处真等待（200 + 140 + 45 ms） | **≈0.3 s** | 低 | 同上 |
| ⑥ `npm test` 显式 `--test-concurrency=8`（16 核机器上默认并发会互抢 CPU） | 待实测 | 低 | 收益取决于核数 |

**合计可砍 ≈ 4.2 s 的串行成本；墙钟口径 7.2 s → 约 3.5 s（−50%）或更少**——并行执行会摊薄，
但 `input-handler` 这个 3.3 s 的尾巴一定在关键路径上，砍掉它直接抬高整套的并行上限。 ①②⑤ 三项（1.8 s）改动只落在 5 个文件、风险接近零，
建议先做这三项。 再往下砍就要动"每文件一个进程"这个模型，
不建议——那 5.6 s 的进程基线换来的是文件间完全隔离，是这套测试最值钱的性质。

**复现**

```bash
npm test                                                       # 总量
for f in test/*.test.mjs; do s=$(date +%s%N); node --test "$f" >/dev/null 2>&1; e=$(date +%s%N); echo "$(( (e-s)/1000000 )) $f"; done | sort -rn
node .tmp/perf/bundle-cost.mjs                                  # 单次 bundleModule 成本
```

---

## 六、建议门禁

现有门禁只有一道：`test/bundle-budget.test.mjs`（未压缩体积 + 依赖归属）。以下 7 道都是**可执行、
阈值来自本文实测**、并且在当前代码上应当立刻变红的（标注了）。

| # | 门禁 | 阈值 | 现在会红吗 | 实现要点 |
|---|---|---|---|---|
| G1 | **每段存储操作数** | 一次 `TRANSLATE_TEXT` 内 `storage.local` 的读+写 **≤ 0**（记录必须异步或批量落盘） | **会**（现在 4） | 假 `browser.storage` 计数，直接调 `createTranslateTextHandler` 的 handler |
| G2 | **每个入口的 gzip 预算** | content ≤ 50 / summary ≤ 50 / options ≤ 32 / SW ≤ 28 / popup ≤ 14 / youtube ≤ 9 / subtitle ≤ 6 / bilibili ≤ 2（KB） | 否（当前 46.1/42.9/27.2/24.8/12.0/7.1/4.8/0.9，余量 8–24%） | `bundle-budget.test.mjs` 里加 `zlib.gzipSync` 一列 |
| G3 | **跨入口重复预算** | `Σ(bytes − 每模块单入口最大值)` **≤ 20 KB**；且 `lib/browser-polyfill.js` 只允许出现在 **1** 个入口 | **会**（现在 112.7 KB，polyfill 出现在 7 个） | metafile 已含 `outputs[*].inputs`，20 行即可 |
| G4 | **HUD 不得每段重绘** | ① `src/content/performance/` 里 `render()` 不得出现 `innerHTML =`；② 一次 `emitProgress` 的 DOM 写入 ≤ 1 个文本节点 | **会** | 单元测试用 `Object.defineProperty(HTMLElement.prototype,'innerHTML',{set(){throw}})` |
| G5 | **HUD 必须是编译期可选** | 生产产物 `grep -c "__DEBUG__"` 无意义（已被 define 消除）；改为断言 `content-runtime.js` 里 `performanceHud.` 调用点全部位于 `if (globalThis.__DEBUG__)` 内 | **会** | 源码 AST/正则断言，或直接查产物里不含 `foxlate-performance-hud` 类名 |
| G6 | **启动 IPC 预算** | 内容脚本 `initialize()` 期间 `runtime.sendMessage` **=== 1**；popup 首帧 IPC **≤ 3** | 内容侧**不会**（已达标，作为回归锁）；popup **会**（现在 4） | 复用 `.tmp/perf/content-boot.mjs` 的桩，搬进 `test/` |
| G7 | **测试总时长预算** | `npm test` ≤ 9 s（当前 7.2 s）；单文件 ≤ 4 s | 否 | 在 `node --test` 外层包一层计时，或用 `--test-reporter` 汇总 `duration_ms` |

**红线（一旦越过就不是性能问题，是缺陷）**

- 任何 `storage.*` 写的**字节数**超过 `chrome.storage.local` 单键 10 MB 配额（当前缓存满额 1.1 MB，
  历史最坏 175 KB —— 缓存只要再加 9 倍就会静默丢全部付费结果）。
- `sync` 区写入次数 > 120 次/分钟（`cloud-backup-store` 分片上传，引擎列表一大就会撞）。
- 内容脚本初始化期间出现**第二个** `await`（意味着有人把设置读两次或加了新的启动往返）。

---

## 七、P0 / P1 / P2 与工作量

| 级别 | 项 | 收益（可量化） | 工作量 | 风险 |
|---|---|---|---|---|
| **P0-1** | 历史/健康度存储改内存态 + debounce 落盘；记录动作不 await；`sendMessage` 提前 | 每段 4 次存储 IPC → 0；500 段页面 23.9 MB → ~30 KB；省 284 ms 串行主线程 | 4–6 h | 低（照抄 `translation-cache-store` 已验证的 `scheduleSave`+`maxWait`） |
| **P0-2** | HUD：`__DEBUG__` 编译期开关 + `render()` 改文本节点定点更新 | 每段 −2 次 20 节点 `innerHTML` 重排；500 段 −1000 次重写 | 1–2 h | 低（但牵涉"要不要保留用户可见的进度面板"的产品决策，见第八节） |
| **P0-3** | polyfill 去重（方案 A） | 安装包 **−38.1 KB**（−7%），重复浪费 57.1 → 19 KB | 2 h | 低 |
| **P1-1** | `#scheduleTranslations` 改成时间片自适应（与 `#processInitialScan` 同构） | 一次交集 200 元素时，单次 idle 回调的最坏阻塞从 ~200 段降到 >4ms 剩余为止 | 2 h | 低 |
| **P1-2** | `displayLoading` 的 `originalContent` 改为「仅 `displayMode === 'replace'` 时采集」 | 每段 −1 次整棵子树序列化 + 内存持有（append/hover 模式下） | 1 h | 低（唯一读点是 `display-manager.js:141-147` 的 replace 兜底） |
| **P1-3** | `text-measurement`：`#prepare` 去掉 `JSON.stringify`；`readTextStyle` 按元素缓存 computedStyle | 每段 −1 次全文复制；每段 −1 次 `getComputedStyle` | 2 h | 低 |
| **P1-4** | `pretext` 的 `bidi-data`（14.4 KB）改按需；或整个 pretext 延迟到首次布局 | 内容包 −14.4 KB（−9.7%）／−42.3 KB（−28.7%） | 4–8 h | 中（延迟化要把 `applyAppendLayout` 变 async，影响 3 个策略） |
| **P1-5** | popup：`Promise.all` 并行 #3/#4；去掉 `SETTINGS_UPDATED` 的重复刷新 | 首帧 4 → 3 IPC；设置变更 5 → 3 IPC | 1 h | 低 |
| **P2-1** | options 两个模态拆成独立入口按需 `<script>` | −15.8 KB（−15.9%） | 3 h | 中（要照 summary-entry 的模式，但要处理模态打开的 await） |
| **P2-2** | summary 里的 `marked`（38.1 KB）延到"确实渲染 markdown" | −38.1 KB（−26.6% of summary） | 3 h | 中 |
| **P2-3** | 内容脚本只下发"内容侧需要的字段"（16.7 KB → 约 4 KB） | 每次注入 −12.7 KB IPC；**顺带不再把 API Key 发给内容脚本** | 3 h | 中（要确认 10 个字段的完整清单） |
| **P2-4** | 测试基建 ①②③（假定时器 / bundle LRU / 合并入口） | **−2.9 s（7.2 → 约 4.3 s）**；再加 ④（build 拆库）→ 约 3.0 s | 4 h | 低–中 |
| **P2-5** | `dom-walker` 第 3 步可见性检查降级为兜底 | 每段 −2 次强制布局 | 3 h | **中–高**：可见性判定错了会翻译隐藏内容，必须先在真页面回归 |

**总计**：P0 三件 ≈ 8 小时，P1 五件 ≈ 10 小时，P2 五件 ≈ 16 小时。

---

## 八、需要用户决策的取舍

1. **HUD 到底是不是产品功能？**
   规格说它是 debug-only，代码把它做成默认可见 UI。两条路：
   (a) 承认它是产品功能 → 那就必须重写成定点更新 + rAF 合并（工作量 +1 天，视觉不变）；
   (b) 承认它是 debug → 用 `__DEBUG__` 包住，生产产物里彻底消失（**−2 次重排/段，立竿见影**）。
   **我建议 (b)**：页面翻译的进度已经有 badge（`badge-state.js`）+ popup 按钮状态两条通道，
   右下角常驻面板对普通用户是噪音。但这会让"调试时看不到指标"，需要你确认。

2. **polyfill 换 shim 需要先钉浏览器最低版本。**
   现在 manifest 里 **`minimum_chrome_version` 和 `gecko.strict_min_version` 都没写**，
   等于对外承诺"任何版本都能装"。要省下 59.5 KB，必须先声明 Chrome ≥ 121（`onMessage` 以外的
   Promise 支持已稳定；`onMessage` 仍需 40 行适配层）。这会把一部分老用户关在门外——**这是产品决策，不是技术决策。**

3. **`pretext` 到底值不值 42.3 KB（内容包 28.7%）？**
   它是"译文断行保真度"的引擎，替代品是内置 canvas 引擎（`text-measurement.js` 里已有，0 额外字节）。
   把两者在 20 个真实页面上对比一次（渲染后行数差、溢出率），才能决定：
   (a) 保留但延迟加载（首段译文会先用 canvas 估一次，之后再重排 → 可能闪）；
   (b) 直接降到 canvas（−42.3 KB，回退到 1.7.4 之前的保真度）；
   (c) 保留现状。
   **这个取舍我不建议由评审单方面做判断——它直接换到用户可见的排版质量。**

4. **历史/失败队列要不要留在 `storage.local`？**
   P0-1 的修法默认"仍然落盘，只是批量"。如果这两个 store 其实是"只给设置页里的两列表看的"，
   更彻底的方案是只用 `storage.session`（会话内可见，重启即清，0 长期配额压力）。
   需要你确认这两个列表对用户的实际价值（现在 5000 条缓存 vs 80 条历史，比例本身就很怪）。

5. **测试时间换隔离度：要不要为了 2.2 s 动 `test/` 结构？**
   `test/**` 本次禁止修改，所以上面 5.4 的方案都只是提案，未落地。如果这 2.2 s 对你没价值，
   可以只做 ①②（收益 0.9 s、改动 2 个文件、几乎零风险），跳过 ③。
