# 产品与平台评审（1.7.8）

> 审计对象：`main` @ `3e080a5`（1.7.8），Firefox 优先、Chrome 构建已存在但未上架。
> 视角：能不能上架 / 装上能不能用明白 / Chrome 上会不会坏。
> 方法：只读源码 + 脚本统计 + 权威文档核对（MDN / Chrome Docs）。**未运行任何 build 或 `npm test`**（见 §6.3：测试套件本身会重写共享 `dist/`）。
> 与 `refactor-ledger.md` 批 12/13/14 已修项不重复；本文所有条目均为新发现或在旧台账里不存在的问题。

---

## 结论摘要

- **上架阻塞项**：Firefox 缺 `gecko.data_collection_permissions`（2025-11-03 起强制，现在提交即拒）；Chrome 清单 `description` 解析后 162 字符 > 132 上限（CWS 上传直接报错）；`AMO-SUBMISSION.txt` 的生成文本声称「不收集数据、逐项选 NO」，与「默认引擎直接把页面文本发往 Google」矛盾。
- **用户卡点**：装好扩展后**当前标签页必然翻译不了**——popup 把「翻译此页」按钮禁用并显示「此页面不支持翻译」，而唯一能补注入的入口正是那个被禁用的按钮；域名规则、DeepLX 地址、AI 引擎三处「先写后测」全部拿**已保存值**去测，新填配置第一次测必失败。
- **Chrome 风险**：SW 30s idle 与「请求 30s 超时」数值重合，摘要/长 AI 请求几乎必然撞上被杀；字幕工具栏态的 handler **没有任何发送方**且图标路径不存在；`storage.session` 无 `strict_min_version` 兜底（FF 109–114 会 TypeError）。

---

## 一、Firefox vs Chrome 差异矩阵

清单差异全部来自 `build.js:357-410`（`manifestGenerator` 插件的 `generateManifest()` 从 :360 起）与 `public/manifest.base.json`。当前 `dist/manifest.json` 是 **Firefox 构建**（含 `background.scripts`），因此 Chrome 产物只能用 `build.js` 的分支逻辑 + `test/build-manifest.test.mjs` 反推，未能实机核对（见 §3 的未验证项）。

| # | 项 | Firefox 行为 | Chrome 行为 | 结论 | 证据 |
|---|---|---|---|---|---|
| 1 | `background` | `scripts:[...]` + `type:"module"` 事件页 | `service_worker:...`，`scripts` 被删 | 兼容（但见 #2） | `build.js:382-394`、`public/manifest.base.json:17-20` |
| 2 | `background.type:"module"` | 保留 | 保留 | **需分支/可删**：产物是 `format:'iife'`（`build.js:415`），两平台都不需要 module 语义；Firefox 对 `type` 的支持晚于 MV3 起点，留着只是无收益的风险面 | `build.js:415`、`public/manifest.base.json:19` |
| 3 | `browser_specific_settings` | 保留 `gecko.id` | 整个键被 `delete` | 兼容（Chrome 会因未知键告警，删除是对的） | `build.js:383` |
| 4 | `strict_min_version` | **缺失** | — | **已坏（窄窗口）**：`storage.session` 需 FF 115+，MV3 自 FF 109 起可安装；FF 109–114 上 `this.#browser.storage.session` 为 `undefined` → `getActiveTabIds()` 同步抛 TypeError，设置变更广播与徽标全断 | `public/manifest.base.json:69-72`、`src/background/tab-state-manager.js:57,113,208,225,251` |
| 5 | `data_collection_permissions` | **缺失** | 不适用（CWS 用网页表单） | **已坏（上架阻塞）**：AMO 自 2025-11-03 起新提交强制该键 | `public/manifest.base.json:69-72` |
| 6 | `storage.session` | FF 115+ 原生 | Chrome 102+ 原生 | 兼容但有前提：webextension-polyfill **不含** `storage.session` 元数据，`browser.storage.session` 走 `wrapObject` 的「未知属性直通」分支拿到**裸 `chrome.storage.session`**（不做 promise 转换）。Chrome 该 API 自身返回 Promise，因此工作，但**这条路径没有任何 polyfill 兜底**，任何 polyfill 升级/行为差异都会静默改变语义 | `src/lib/browser-polyfill.js:506-560`（metadata 无 `session`）、同文件 `wrapObject` 的 `else` 直通分支、`src/background/tab-state-manager.js:57` |
| 7 | `browser.scripting` 注入参数 | `{target:{tabId,frameIds}, files}` / `{target,func}` 均支持（FF 101+） | 同 | 兼容。两处 `func` 路径（选区）在 Firefox 返回 **structured-cloneable**、Chrome 返回 **JSON-serializable**，本项目只返回 `{text, coords}`，无差异 | `src/background/script-injector.js:46,49`、`src/background/selection-translation.js:8-24,48-52`、`src/common/context-extractor.js:37` |
| 8 | `action` vs `browserAction` | 只用 `browser.action`（MV3 正确） | 同 | 兼容。但 `setIcon` 的路径**不存在**（见 §7-1），两平台都必失败 | `src/background/handlers/tab-handlers.js:96` |
| 9 | `web_accessible_resources` 格式 | `{resources, matches}` 支持 | 同上，MV3 强制该格式 | 兼容，但多暴露 2 个从未被页面拉取的文件（见 §7-6） | `public/manifest.base.json:56-68` |
| 10 | CSP | 只在 Firefox 分支写 `extension_pages: script-src 'self'; object-src 'self'; connect-src https: wss:` | **不写**，走 MV3 默认 `script-src 'self'; object-src 'self'` | **不对称但可用**：默认 CSP 未设 `default-src`，`connect-src` 不受限，所以 Chrome 的 fetch 不被 CSP 拦（真正授权来自 `host_permissions`）。`wss:` 无任何 WebSocket 消费者（`grep WebSocket src` = 0），是冗余 | `build.js:396-399`、`public/manifest.base.json:11-16` |
| 11 | MV3 SW 生命周期 | 事件页，空闲亦会回收 | **30s idle 必杀**；官方明确「fetch 响应超过 30 秒，worker 也会被终止」 | **需分支（真实风险）**：`DEFAULT_REQUEST_TIMEOUT_MS = 30000` 与 30s 杀 SW 同值；AI 摘要/长页批量一旦超过 30s，SW 在 await 期间被回收 → 内容侧收到 port closed，用户看到失败但服务端已计费 | `src/background/translators/request-timeout.js:13`、`src/background/translators/ai-translator.js:131,203`、Chrome 官方 SW lifecycle 文档 |
| 12 | `commands` 快捷键 | `Alt+A/S/X` | 同 | **需人工验证**：Firefox 菜单栏访问键历史上 Alt+S = 历史(History)，可能与 `translate-selection` 抢键；Chrome 侧未见冲突。`toggle-summary` 无 `suggested_key`，用户必须在浏览器快捷键页手配，等于默认不可用 | `public/manifest.base.json:29-53` |
| 13 | 剪贴板写入 | `navigator.clipboard.writeText` 在 content script 需要 `clipboardWrite`，且仅安全上下文（https）可用 | Chrome 在用户手势下可用，不需要 `clipboardWrite` | **需分支**：Firefox 下 http 页面复制必然 `NotAllowedError`；`summary.js` 两处**没有 `.catch()`** → 未捕获异常 | `src/content/summary/summary.js:389,394`、`src/content/enhanced-tooltip-manager.js:300`、`public/manifest.base.json:11-16`（无 `clipboardWrite`） |
| 14 | 语音朗读 | `window.speechSynthesis` 存在但部分平台/无语音包时 `getVoices()` 为空 | Chrome 有系统语音 | **需分支（体验）**：代码只判 `!this.#speechSynthesis`，无 `getVoices()` 检查、无用户提示，点了没反应只进 `console.error` | `src/content/tooltip/tooltip-speech-controller.js:63,97` |
| 15 | 动态 `import()` 扩展资源 | content script 内 `import(moz-extension://…)` 可行 | **未验证**：Chrome 对 content script 内 `import(chrome-extension://…)` 有额外限制，失败时本模块**静默降级**为启发式，不会崩 | `src/common/lang-detect.js:22,66-76`（`catch` 后置空，`detectLang` 退回字符集规则） |
| 16 | `storage.local` 配额 | 基本无上限（IndexedDB 后端） | 10 MB（Chrome 114+，之前 5 MB）且未申请 `unlimitedStorage` | **需分支**：`cacheSize` 默认 5000 条，写盘失败只 `console.error`，之后整个会话的缓存**永久不落盘**且无任何 UI 提示 | `src/common/constants.js:65`、`src/background/translation-cache-store.js:97-99` |
| 17 | `scripting.executeScript` 于「站点访问 = 点击时」 | 不适用（MF 里 host 权限安装即给） | 用户可把站点访问改成「点击时」→ 注入全部失败 | **需分支（体验）**：注入失败后 popup 走 §5 卡点 1 的死路，界面上没有「授予本站权限」的下一步 | `src/background/navigation-handler.js:35-38` |

**结论**：API 用法本身跨浏览器是干净的（无 `chrome.*` 直写，唯一一处 `globalThis.chrome` 是 getURL 兜底：`src/common/lang-detect.js:34`）。真正的差异风险集中在 **manifest 元数据缺失**（#4/#5）与 **Chrome 独有的生命周期/配额**（#11/#16）。

---

## 二、权限审计

完整清单（脚本统计，非目测）：`permissions` 4 项、`host_permissions` 1 项、`optional_permissions` **0 项**（`public/manifest.base.json:11-16`，`host_permissions` 由 `build.js:374-375` 硬编码注入）。

| 权限 | 声明处 | 用途 | 使用证据 | 建议 |
|---|---|---|---|---|
| `storage` | `manifest.base.json:12` | 设置 / 缓存 / 会话状态 / 云备份 | **28 处真实调用**（`storage.local.` 12 / `storage.sync.` 9 / `storage.session.` 7，脚本计数） | 保留，必需 |
| `scripting` | `manifest.base.json:13` | 按需注入 CSS/JS、读选区 | **7 处**（`script-injector.js:46,49`；`selection-translation.js:8,48`；`context-extractor.js:37`） | 保留，必需 |
| `contextMenus` | `manifest.base.json:14` | 右键「翻译选中」 | **2 处**（`service-worker.js:84` create、`:155` onClicked） | 保留；但 `create` 前缺 `removeAll()`（§7-5） |
| `webNavigation` | `manifest.base.json:15` | 注入时机 + 自动翻译 + 字幕 | **3 处**（`service-worker.js:180,184` 两个监听、`navigation-handler.js`） | 保留，必需（本扩展**没有** `content_scripts`，全靠 `onCompleted` 注入） |
| `host_permissions: ["<all_urls>"]` | `build.js:374-375` | ① 任意页面 `executeScript`；② SW 内 `fetch` 用户自配端点（DeepLX / OpenAI 兼容） | `fetch(` **4 处**（google/deeplx/ai×2）；注入见上 | **必要但过宽**：②让任何用户填的 URL 都能被 SW 请求，`<all_urls>` 在 AMO 上是最高级别警告。可行收敛：注入仍要 `<all_urls>`，但把「API 端点」拆到 `optional_host_permissions`，仅当用户保存自定义 URL 时按 origin 申请。工作量中等，能显著降低安装页吓退率 |
| （缺）`clipboardWrite` | — | 复制译文/摘要消息 | Firefox 下 content script 必须有此权限才能 `navigator.clipboard.writeText` | **建议补**（Chrome 侧无副作用） |
| （缺）`unlimitedStorage` | — | 5000 条缓存 | 见 §1-16 | 建议作为 `optional_permissions` 由用户开启 |
| （缺）`alarms` | — | SW 保活/重试 | 当前无 keepalive；Chrome 30s 杀 SW 的缓解手段就是 alarm | 若采纳 §1-11 的修法，需要它 |

**死权限**：无。4 项 required 权限全部有 ≥2 处真实调用点。`optional_permissions` 完全为空——这本身不是缺陷，但 `clipboardWrite`/`unlimitedStorage` 恰好都是「可选/按需」型，说明这个仓库还没做过「用可选权限换取更轻的安装警告」的取舍。

---

## 三、上架就绪清单

### AMO（Firefox）

| 项 | 状态 | 缺什么 / 证据 |
|---|---|---|
| `gecko.id` | ✓ | `foxlate@sanni`（`manifest.base.json:70-71`） |
| `strict_min_version` | ✗ | 缺失；`storage.session` 要求 ≥115（`manifest.base.json:69-72`） |
| `data_collection_permissions` | ✗ | **阻塞**。2025-11-03 起新提交必须有该键；本项目会「发送网站内容到第三方」= 必须声明 `websiteContent` 类目 |
| 隐私政策 | △ | `PRIVACY.md` 存在但「Last Updated: 2024-05-16」，且有三处与代码不符（见 §6-1/2/3）；AMO 需要**可公开访问的 URL**，仓库内 md 不算 |
| 源码包 | ✓ | `scripts/package-firefox.sh:51-91` 生成，含 `BUILD.md` 与 `build-artifacts/franc.bundle.mjs` |
| 源码包纯净度 | ✗ | 脚本注释写「正式源码包里不含它」，但 `cp -R src/. "$STAGE/src/"`（`:58`）**把 `src/lib/franc.bundle.mjs` 一起拷进去**；`cp -R public`（`:59`）**把 421 KB 的 `public/icons/Generated Image … .psd` 一起拷进去**。PSD 检查只扫 `dist/`（`:36-40`） |
| 商店文案（名称/摘要/分类） | ✗ | 仓库内无任何 listing 文案源；`AMO-SUBMISSION.txt` 只写「提交入口/文件/SHA」，没有 summary、description、分类、标签 |
| 截图 | △ | 只有 `pic/page-popup.png`、`pic/page-setting.png`、`pic/sample-wiki.png`，全部 **2025-07-15**，早于 1.6.0 cyan/glass 与 1.7.0/1.7.7 的 popup/options 重排与对比度调整 → 上架截图必过期 |
| 数据使用声明一致性 | ✗ | 见 §6-4 |
| 《AMO-SUBMISSION.txt》本体 | 未验证 | 生成物在 `dist/firefox/`，`.gitignore:6` 忽略 `/dist`，当前工作区不存在；生成命令 `npm run package:firefox` 本轮禁跑。**如何验证**：`bash scripts/package-firefox.sh` 后逐行核对（它同时会重写 dist，须独占执行） |

### CWS（Chrome）

| 项 | 状态 | 缺什么 / 证据 |
|---|---|---|
| 包能上传 | ✗ | `description` 解析值 **162 字符**（`_locales/en/messages.json` → `extensionDescription`），CWS 硬上限 132 → 上传即报错。zh_CN 侧 68 字符没问题，**en 必须缩短** |
| `manifest_version: 3` | ✓ | `manifest.base.json:2` |
| `service_worker` 背景 | ✓ | `build.js:382-387` |
| `browser_specific_settings` 剥离 | ✓ | `build.js:383` |
| 无远程代码 | ✓ | 全部 esbuild 打包；`lib/franc.bundle.mjs` 是 `import()` 的**同源文件**，不是远程脚本 |
| 隐私政策 URL | ✗ | 同 AMO，需公开 URL |
| 数据使用（Data usage）表单 | ✗ | 与 §6-4 同问题：默认引擎把页面文本发往 `translate.googleapis.com`，摘要把正文发往用户 AI 端点，属「网站内容」外发，不能全选 NO |
| 单一用途/权限理由说明 | ✗ | 无文案源；`<all_urls>` 是最容易被 CWS 人工审核问询的一项 |
| 已发布 | ✗ | 未上架（`README.md:5` 写「Chrome 即将推出」；`specs/execution-status.yaml` e02 = `todo`） |

**结论**：Chrome 侧距离可提交还差 **1 个 5 分钟修复**（缩短 en description）+ 表单文案；Firefox 侧差 **1 个 manifest 键**（data_collection_permissions）。两者的真正成本在文案与截图，不在代码。

---

## 四、i18n 完整性

键集（脚本比对，非目测）：`en` **297** 键 / `zh_CN` **297** 键，**仅 en 0 个、仅 zh_CN 0 个**。

| 检查 | 结果 |
|---|---|
| 键集相等 | ✓ 297 = 297，零差集 |
| 代码里 `getMessage('literal')` 的键全部存在 | ✓ 命中 257 个 key，缺失 **0** |
| 字面量从未出现的「死键」 | ✓ **0**（297 个 key 全部能在 `src/` 里找到字面量引用，含常量表里的动态 key） |
| 常量表动态 key（`SUPPORTED_ENGINES` / `SUPPORTED_LANGUAGES` / `DISPLAY_MODES.optionsKey/popupKey` / `AUTO_TRANSLATE_MODES` / `SUBTITLE_DISPLAY_MODES`）全部存在于词典 | ✓ 0 缺失（逐值脚本核对） |
| `ERROR_MESSAGES[*].errorKey`（`summary-error-messages.js:11-19`） | ✓ 7/7 存在 |
| 三目/拼接型动态 key（`getMessage(cond ? 'a' : 'b')`） | 共 **8 处**，逐一对齐后全部存在：`tooltip-speech-controller.js:53`、`tooltip-content-view.js:13,18,19,20`、`enhanced-tooltip-manager.js:103,276`、`tab-handlers.js:100` |
| 三元里嵌在 `ui-helpers.js:135` 的 `map[code]` | ✓ 覆盖 `AUTO_TRANSLATE_MODES` 全值 |
| `description` 字段（给译者/AMO 用） | en 276/297、zh_CN 277/297 有 `description`；缺的 20–21 个是 `logEntry*`/`tooltip*` 一类自解释键，不影响 |

**动态 key 风险清单（真正的坑，全部为「字符串通畅但语义没接上」）**：

1. **`contextMenuTitle` 的 `%s` 永远不会被替换** — `public/_locales/en/messages.json:331`、`zh_CN:332` 用 `%s`，而 `browser.i18n.getMessage` 只认 `$1`/声明式 `placeholders`；调用点 `src/background/service-worker.js:85` **没有传第二个参数**。结果：右键菜单实际显示 `Translate '%s' with Foxlate` / `使用 Foxlate 翻译 '%s'`。门禁 `test/i18n-integrity.test.mjs:219` 只校验 `$1..$9` 的编号范围，**`%s` 不在它的视野里** —— 这是「门禁看着覆盖了 i18n，实际漏掉一种占位符方言」。
2. `popupTranslationFailed` 的 `{count}` 是手写 `.replace('{count}', …)`（`src/popup/popup-actions.js:105-107`），不是 i18n 占位符；换语序的语言（如日语）无法调整位置。当前只有 en/zh_CN，不构成故障，属结构性隐患。
3. `logEntryStart` / `logEntryPrecheckMatch` 使用 `$1..$3` 但只有 `logEntryPrecheckMatch` 声明了 `placeholders`；其余依赖浏览器对裸 `$N` 的隐式替换。两平台都支持裸 `$N`，故现状可用，但与 #1 的 `%s` 同源——**同一份词典里混用了三种占位符写法**，迟早再犯。

---

## 五、首次使用与失败恢复

### 真实路径（从 options/popup/background 代码推出，非文档）

```
安装
 └─ browser.runtime.onInstalled → 建右键菜单（service-worker.js:83-89）
当前已打开的标签页：无任何 content script（manifest 里没有 content_scripts；注入只发生在 webNavigation.onCompleted，navigation-handler.js:35-38）
 └─ 点工具栏图标 → popup
     ├─ tabs.query 取 active tab（popup-actions.js:60）
     ├─ GET_EFFECTIVE_SETTINGS（后台）
     ├─ setPageControlsEnabled(false, …) ← 先把按钮全禁掉（popup-actions.js:79 / renderer:131-142）
     ├─ tabs.sendMessage(REQUEST_TRANSLATION_STATUS) → 失败：Receiving end does not exist
     └─ catch → 显示「此页面不支持翻译」（popup-actions.js:115-119），按钮**保持禁用**
刷新页面 → onCompleted → 注入 4 个 CSS + content-script.js → 之后一切正常
```

### 卡点清单（按遇到概率排序）

| # | 卡点 | 用户看到什么 | 证据 | 改法 |
|---|---|---|---|---|
| 1 | **装好后当前页永远翻译不了** | 「此页面不支持翻译」，且「翻译此页」按钮是灰的 | `src/popup/popup-actions.js:79,115-119`、`src/popup/popup-renderer.js:131-142` | 关键洞察：后台**本来就有**补注入能力（`TOGGLE_TRANSLATION_REQUEST` → `ensureScriptsInjected`，`tab-handlers.js:24-27`）。所以修法不是在 popup 加「请刷新」，而是：catch 到 Receiving-end 时**保持按钮可用**，点击即走注入；文案改为「本页尚未注入，点击翻译即注入」。Chrome 的「站点访问=点击时」也是同一处修好 |
| 2 | **引擎「先测后存」必失败** | 填了 DeepLX 地址/AI 配置 → 点 Test → `DeepLx API URL not provided in options` 或 `Selected AI engine configuration not found for ID: ai:xxx` | `src/options/options-actions.js:293-300`（payload 只带 `text/targetLang/sourceLang/translatorEngine`）；后台按**已保存设置**解析配置 `src/background/translator-engine-resolver.js:51-53` | 测试按钮把 `getCurrentSettingsState()` 一起发过去（`TEST_CONNECTION` 已经这么做了，`engine-test-handlers.js:59-90`），或测试前先隐式保存 |
| 3 | **域名规则写错零反馈** | 绿色的「Rule saved successfully.」然后什么也不发生 | 校验只有 `required`：`src/options/components/DomainRuleModal.js:33`；保存键是**原始输入**：`options-actions.js:187`；匹配用 `hostname.endsWith(domain)`：`src/common/settings-domain.js:81` | 保存前归一化 `new URL(input).hostname` 或 `input.trim().toLowerCase()`，并拒绝含 `/`、`:`、`*` 的输入；`endsWith` 改成 `hostname === d \|\| hostname.endsWith('.' + d)` |
| 4 | **`endsWith` 过宽匹配**（不是卡点，是错译风险） | 为 `google.com` 建的规则会命中 `notgoogle.com`；为 `m` 建的规则命中所有以 m 结尾的域名 | `src/common/settings-domain.js:81` | 同上；`applyToSubdomains` 的语义其实要求的是「点边界」 |
| 5 | **导入坏备份 → 设置被写坏且提示成功** | 「设置已成功导入！」之后扩展行为异常（例如 `aiEngines` 变成字符串 → `settings.aiEngines.find` 抛 TypeError） | `src/options/options-actions.js:231-247`：`JSON.parse` → `saveLocalSettings(settings)`，**无 schema/版本校验、无确认、无回滚**；`validateSettings` 只做浅合并（`src/common/settings-domain.js:29`） | 校验顶层形状 + 写前先导出一份当前设置到 `storage.local` 的快照作为回滚点；导入导出加 `_foxlate: {version}` 头 |
| 6 | **AI 摘要 30 秒硬死** | 「网络超时」类文案，但其实是本地计时器 | `request-timeout.js:13` 默认 30 s，AI 走 `aiConfig?.timeoutMs`（`ai-translator.js:131,203`），而 UI **没有任何 timeout 字段**（`options.html` 全文无 timeout） | 摘要/追问单独给 120 s，或把 `timeoutMs` 暴露到 AI 引擎表单；Chrome 侧同时要保住 SW（§1-11） |
| 7 | 默认引擎在中国大陆不可达 | 满页红下划线 + 「每一段都翻译失败了（N 段）」 | 默认 `translatorEngine: 'google'`（`src/common/constants.js:50`）→ `translate.googleapis.com`（`google-translator.js:9`），而 zh_CN 是**一等语言** | 首次运行按 `navigator.language` 或一次性的连通性探测决定默认引擎；或首装时给一张「选引擎」卡片（DeepLX / AI） |
| 8 | `toggle-summary` 快捷键默认不可用 | 快捷键页里该命令没有键位 | `public/manifest.base.json:48-50` 无 `suggested_key` | 给一个默认键，或删除该命令以免误以为可用 |
| 9 | 复制按钮在 http 页面 / Firefox 静默失败 | 点了没反馈 | `src/content/summary/summary.js:389,394`（无 catch）、`enhanced-tooltip-manager.js:300`（只 console.error）、缺 `clipboardWrite` | 补权限 + 两处加 `.catch()` 并给「复制失败」文案 |

---

## 六、文档事实核查

| # | 文档原话 | 实际 | 判定 |
|---|---|---|---|
| 1 | `AGENTS.md:34` 「`src/common/design/` — 动效/排版常量与无障碍策略的单一来源」 | **该目录不存在**（`ls src/common/design` → 不存在）。动效/排版/无障碍取值实际在 `src/common/tokens.css`（`AGENTS.md:46` 自己也是这么写的） | ✗ 自相矛盾且指向幽灵路径 |
| 2 | `CONVENTIONS.md:99` 「当前超过 300 行的第一方文件（19 个，`wc -l` 实测）」，表内只列 6 行 | 实测 **18 个**（`find src -name '*.js' -o -name '*.css' \| grep -v ^src/lib \| xargs wc -l \| awk '$1>300'`）；最大者 `summary.css` 733 行，而表里写 722 | ✗ 计数与行数均过期 |
| 3 | `AGENTS.md:58` 「`.psd`/`.ai`/`.xcf` 不得进包 —— `source-artifact-ignore` in build.js 强制」 | `build.js` 里没有叫 `source-artifact-ignore` 的东西；实际机制是 `SOURCE_ARTIFACT_EXTENSIONS` + `isExcludedAsset`（`build.js:230-235`） | ✗ 引用了不存在的标识符（机制本身是对的） |
| 4 | `AMO-SUBMISSION.txt`（生成模板，`scripts/package-firefox.sh:100-135`）「隐私政策：扩展仅在本机处理文本；翻译文本会发送到用户自选的翻译服务」「数据收集声明：不收集（none），填写时逐项选 NO」 | ① 默认引擎是 Google（`constants.js:50`）——**用户没有选过**；② 摘要把整页正文发往用户 AI 端点（`ai-task-runner.js:10`）；③ 云备份把设置写进 `storage.sync`（`cloud-backup-store.js:55-60`） | ✗ 与代码不符。「不发数据」不成立；AMO/CWS 都要按「网站内容外发」申报 |
| 5 | `PRIVACY.md:22` 「Foxlate only interacts with translation services you explicitly choose」 | 同 #4①：默认 Google 是开发者选的 | ✗ |
| 6 | `PRIVACY.md:3` 「Last Updated: 2024-05-16」 | 期间新增了 AI 摘要（整页正文外发）、云备份（跨设备同步设置）、朗读（TTS 可能外发文本到系统语音） | ✗ 内容未覆盖新增数据流 |
| 7 | `specs/state.yaml:34` `last_step_completed`：「发布 1.7.7 … 461 tests」 | `package.json` 是 1.7.8；`changelog.md:3` 有 1.7.8；`AGENTS.md:95` 写 464 tests | ✗ 状态文件落后一个版本（这是「唯一状态存储」的自我承诺被自己违反） |
| 8 | `specs/verifications/feature-inventory-1.7.md:1-4` 自称「1.7.1 快照（非 live）」并指向 `full-refactor-review-1.7.4.md` 第 1 节作为「现行状态」 | 该报告基线是 `7b46f5e` / 1.7.4（`full-refactor-review-1.7.4.md:11`），第 1 节数字是 1.7.4 时点 | △ 已自我声明非 live（好），但**它指向的「现状」也已过期 4 个版本**——「指向 live」的指针本身是死的 |
| 9 | `refactor-ledger.md` 批 11 落地清单里的 3 个路径：`src/content/translation/page-translation-job.js`、`src/content/translation/translation-dispatcher.js`、`src/content/input/input-translation-service.js` | **三个都不存在**；实际是 `src/content/page-translation-job.js`、`src/content/input/input-translation-client.js`（无 dispatcher 文件） | ✗ 台账是「唯一权威记录」，路径漂移会让后来者 grep 不到 |
| 10 | `AGENTS.md:95` 「464 pass（56 个测试文件）」 | 测试文件 **56 个** ✓（`ls test/*.test.mjs`）；464 这个数**未验证**——见 §6.3 | △ 文件数对，用例数待复跑 |
| 11 | `changelog.md:33` 「content bundle 597 KB → 367 KB」；批 13「压缩后 146.2 KB」 | 当前 `dist/content/content-script.js` = 150,949 B = **147.4 KB**（minified），量级一致；预算门禁 440 KB（`test/bundle-budget.test.mjs:27`）与实测 147 KB 数量级不对等（预算按未压缩构建计），不是错误但容易被误读 | ✓ 基本属实 |
| 12 | `README.md:34` 「跨浏览器兼容 … 确保在 Chrome 和 Firefox 上提供一致的体验」 | Chrome 侧未上架、未实机验证（e02 = todo），且存在 §1-11/#16 与 §3 的 description 阻塞 | △ 营销层面的过度承诺 |

### 6.3「未验证」的原因（重要）

`npm test` **不可作为只读验证手段**：`test/build-manifest.test.mjs:18-33` 用 `spawn(node build.js --target=...)` 真跑构建并写 `dist/manifest.json`（`runBuild` 在 3 个 test 里各调一次）。因此「跑测试」等价于「重写共享 dist」，与本轮的限制冲突。所以测试数与 464 pass 未复核。
**如何验证**：在独占 dist 的窗口里 `npm test 2>&1 | tail -20`，或把 `build-manifest.test.mjs` 的构建目标改到 `os.tmpdir()`（顺带修掉「测试污染构建产物」这个卫生问题）。

---

## 七、不可达代码与半成品

全仓库 `grep -rn "TODO\|FIXME\|XXX\|not implemented" src test build.js scripts`（排除 `src/lib/`）**零命中**。所以本节列的不是注释标记，而是**行为上挂了一半**的地方：

| # | 位置 | 问题 | 影响 | 证据 |
|---|---|---|---|---|
| 1 | `src/background/handlers/tab-handlers.js:93-105` | `UPDATE_SUBTITLE_TRANSLATION_STATUS` handler **没有任何发送方**（`grep -rn UPDATE_SUBTITLE_TRANSLATION_STATUS src` = `tab-handlers.js:93` + `message-types.js:61`，另测试 1 处）；且它引用的 `icons/icon48.png`、`icons/icon48-disabled.png` **两个文件都不存在**（实际是 `icons/icon-48.png`，无 disabled 变体） | 字幕工具栏态（换图标 + 换悬停文案）100% 不生效，且即使有人发这条消息也只会进 `catch` 记一条日志 | `tab-handlers.js:96`；`public/icons/` 只有 `icon-16/32/48/96/128.png` |
| 2 | `src/background/subtitle-injection.js:29-30` | 读 `userRules[hostname]?.subtitleStrategy`，而 UI 写的是 `rule.subtitleSettings.strategy`（`DomainRuleModal.js:233-235`、`options-actions.js:187`） | **站点级字幕策略选择器完全无效**：选了 YouTube/Bilibili/「关闭」都只走 `DEFAULT_STRATEGY_MAP`（`subtitle-injection.js:35`），`'none'`（关闭）永远不生效 | 两个键名不同，`subtitleSettings.strategy` 全仓库无读者（`grep "\.strategy"` 只命中 subtitle-manager 的实例字段与 DomainRuleModal 的写/读回填） |
| 3 | `src/background/handlers/tab-handlers.js:96` | 图标路径写死为不存在的文件：`icons/icon48.png`（实际叫 `icon-48.png`）与根本不存在的 `icon48-disabled.png` | 即便给 #1 接上发送方，`setIcon` 仍抛错，同一 `try` 里的 `setTitle` 被连带跳过 | **FIXED**（handler 连同 `MESSAGE_TYPES` 与两个 locale 键一并删除：无发送方、无图标资源，属半成品） |
| 4 | `src/options/options-actions.js:231-247` | 导入备份无校验（§5-5） | 半成品：能导入，不能保证导入后还能用 | — |
| 5 | `src/background/service-worker.js:83-89` | `contextMenus.create` 只在 `onInstalled` 跑，且**不先 `removeAll()`**。更新版本时 `onInstalled(reason='update')` 会用已存在的 id 再建一次 → duplicate-id 错误；本地化标题的变更因此永远刷不到旧菜单上 | 右键菜单文案改动会在老用户机器上「不生效」，且没有错误处理 | — |
| 6 | `public/manifest.base.json:56-68` | `web_accessible_resources` 里的 `common/tokens.css`、`content/enhanced-style.css` 从未被任何页面 `runtime.getURL` 拉取（两者只经 `scripting.insertCSS` 注入，`background-constants.js:11-16`），却对 `<all_urls>` 全部开放 | 多两个可指纹文件 + WAR 面扩大；`content/style.css` 是唯一真需要（`content-runtime.js:31` → `translatable-elements.js:63` 的 shadow-root `<link>`） | `grep getURL src` 只有 style.css 与 franc |
| 7 | `public/manifest.base.json:48-50` | `toggle-summary` 无默认快捷键（§5-8） | 声称有快捷键，实际要用户手配 | — |
| 8 | `src/common/constants.js` 常量消费者复核 | 逐项 grep：`SUPPORTED_LANGUAGES`(5 文件)、`SKIPPED_TAGS`(2)、`SUPPORTED_ENGINES`(4)、`DEFAULT_TRANSLATION_EXCLUDE/CONTENT`(各 1)、`FALLBACK_TRANSLATION_CONTENT`(2)、`DEFAULT_SUMMARY_MAIN_BODY`(3)、`MAX_SUMMARY_INPUT_CHARS`(1，`summary.js:265`)、`AI_PROMPTS`(1)、`DISPLAY_MODES`(5)、`AUTO_TRANSLATE_MODES`(2)、`SUBTITLE_DISPLAY_MODES`(3)、`DISPLAY_MANAGER_STATES`(6) | **全部有真实消费者**，本项未发现死常量。字幕策略的 `displayName` 也是活的（`ui-helpers.js:117`） | 与任务里的猜测相反，记在此处以免下一轮重复调查 |
| 9 | `test/i18n-integrity.test.mjs:219-231` | 占位符门禁只看 `$1..$9`，不识别 `%s`（§4-1 的漏网原因） | 门禁「看着在管 i18n 占位符」 | — |

---

## 八、P0 / P1 / P2 与工作量

### P0（阻塞上架，合计 ≈ 1.5 人日，几乎全是文案/元数据）

| # | 项 | 改哪里 | 工作量 |
|---|---|---|---|
| P0-1 | AMO 缺 `gecko.data_collection_permissions` | `public/manifest.base.json:69-72`（`required: [websiteContent]` + 说明文案），并确认与 AMO 表单一致 | 0.2 d |
| P0-2 | CWS `description` 162 → ≤132（en） | `public/_locales/en/messages.json` `extensionDescription` | 0.1 d |
| P0-3 | 数据使用声明与代码对齐 | 重写 `PRIVACY.md`（含 AI 摘要、云备份、默认引擎）+ `scripts/package-firefox.sh` 的 AMO 模板 + CWS 表单文案 | 0.5 d |
| P0-4 | 商店素材：listing 文案 + 新截图（3 张 `pic/*` 早于 1.6/1.7 改版） | 仓库外产物；截图需在 1.7.8 上重拍 | 0.5 d |

> 说明：P0-1/2 是「不修就上传不了」，P0-3/4 是「上传了也会被审核驳回/用户投诉」。

### P1（用户卡点与真实损坏，合计 ≈ 3 人日）

| # | 项 | 改哪里 | 工作量 |
|---|---|---|---|
| P1-1 | 首次安装后当前页无法翻译（按钮被禁用） | `src/popup/popup-actions.js:79,115-119`（+ 文案） | 0.3 d |
| P1-2 | 站点级字幕策略/开关无效（`subtitleStrategy` vs `subtitleSettings.strategy`） | `src/background/subtitle-injection.js:29-30` | 0.2 d |
| P1-3 | 域名规则无校验 + `endsWith` 过宽 | `src/options/components/DomainRuleModal.js:33`、`src/options/options-actions.js:187`、`src/common/settings-domain.js:81`（+ 门禁用例） | 0.5 d |
| P1-4 | 引擎「先测后存」必失败 | `src/options/options-actions.js:293-300` + `engine-test-handlers.js` | 0.3 d |
| P1-5 | AI 请求 30 s 硬超时（摘要基本不可用） | `src/background/translators/request-timeout.js:13` + AI 引擎表单加 `timeoutMs` | 0.3 d |
| P1-6 | Chrome SW 30 s 被杀（与 P1-5 同源） | 摘要/长任务改为「后台排队 + `alarms` 保活 + 轮询」，或把超时压到 <25 s 并明确提示 | 0.8 d |
| P1-7 | 剪贴板：缺 `clipboardWrite` + 两处无 catch | `manifest.base.json:11-16`、`summary.js:389,394` | 0.2 d |
| P1-8 | 导入备份零校验 | `src/options/options-actions.js:231-247` | 0.3 d |

### P2（体验/卫生，合计 ≈ 2 人日）

| # | 项 | 工作量 |
|---|---|---|
| P2-1 | 字幕工具栏态整条链路（无发送方 + 图标路径不存在）——要么接通，要么删除 handler 与其 locale 键 | 0.3 d（删）/ 0.5 d（接通） |
| P2-2 | `contextMenuTitle` 的 `%s` → `$1` + 传参；门禁补 `%s` 检查 | 0.2 d |
| P2-3 | 补 `strict_min_version: "115.0"`（storage.session） | 0.05 d |
| P2-4 | 移除 `background.type: "module"`（IIFE 产物不需要） | 0.05 d |
| P2-5 | 缓存写盘配额失败要用户可见（或加 `unlimitedStorage` 可选） | 0.3 d |
| P2-6 | WAR 去掉 `common/tokens.css`、`content/enhanced-style.css` | 0.1 d |
| P2-7 | `contextMenus.removeAll()` 后再 `create` | 0.1 d |
| P2-8 | 源码包排除 `.psd` 与 `src/lib/*.bundle.mjs`（并修脚本里与事实相反的注释） | 0.1 d |
| P2-9 | 文档漂移修正：`AGENTS.md:34`、`:70`；`CONVENTIONS.md:99`；`state.yaml:34`；`refactor-ledger.md` 批 11 三处路径；`feature-inventory-1.7.md` 的「现状」指针 | 0.4 d |
| P2-10 | `npm test` 不再写 `dist/`（`build-manifest.test.mjs` 改到 tmpdir） | 0.3 d |
| P2-11 | `/lang` 快捷键冲突核实（Alt+S vs Firefox History）与 `toggle-summary` 默认键 | 0.1 d |
| P2-12 | `<all_urls>` 拆分：API 端点走 `optional_host_permissions`（降低安装警告） | 1.0 d（可选） |

**总工作量：P0 1.5 d + P1 3 d + P2 2 d ≈ 6.5 人日**，其中 P0 全部是元数据/文案，可以今天就做完；P1-6（SW 保活）是唯一需要设计取舍的一项。

---

## 附：未验证项与验证方法

| 项 | 为什么没验证 | 怎么验证 |
|---|---|---|
| Chrome 产物实际能否加载 | 禁止跑 `npm run build:chrome` | 在独占 dist 的窗口：`npm run build:chrome && chrome --load-extension=dist`，看 SW 控制台与 `chrome://extensions` 错误 |
| CWS 上传是否被 `description` 拦下 | 需要开发者账号 | 缩短 en description 前后各上传一次空包，对比报错 |
| AMO `data_collection_permissions` 的强制范围（新提交 vs 更新） | 需 AMO 后台 | 在 AMO 开发者页提交 1.7.8，读它的校验提示 |
| `Alt+S` 在 Firefox 是否被 History 菜单占用 | 需真机（Windows/Linux） | 真机按 `Alt+S`；或 `about:addons` → 管理扩展快捷键，看是否显示冲突 |
| `import(chrome-extension://…)` 在 Chrome content script 内是否成功 | 需真机 | 加载扩展后，在 https 页面控制台看 `lib/franc.bundle.mjs` 是否被请求；`detectLang` 是否仍走启发式 |
| 30 s SW 被杀 | 需真机 + 慢端点 | 用 `scripts/e2e/mock-server.mjs` 加一个 40 s 延迟的 `/v1/chat/completions`，触发摘要，观察 SW 是否重建 |
| 464 pass | 会重写 dist | 见 §6.3 |
| `dist/firefox/AMO-SUBMISSION.txt` 内容 | 生成物不存在，且生成命令禁跑 | `bash scripts/package-firefox.sh`（独占 dist） |
