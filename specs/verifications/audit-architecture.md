# 架构评审（1.7.8）

> **评审问题**：三个月后要加第 5 个功能时，这个代码库会不会塌。
> **评审基线**：`main` @ `3e080a5`，`package.json` 1.7.8，`npm test` → **464 pass / 0 fail / 8.1s**（评审开始时实测，见附录 A7）。
> **交付时状态**：`npm test` → 463 pass / **1 fail**，失败项是 `test/doc-format.test.mjs`，触发文件为**并行的另一份评审产物** `specs/verifications/audit-product-platform.md:189`（孤立表格行）。本报告文件单独跑该门禁为 0 问题；按职责边界未改动他人文件。
> **方法**：全量扫描 `src/**` 156 个 js/mjs（23030 行，含 `src/lib/` 4 个 vendor 文件；第一方 152 文件 18946 行）；用自写脚本生成真实 import 图、圈复杂度、payload 契约表；用**自建 esbuild 产物**（`.tmp/arch-audit/out/`，未触碰 `dist/`）测跨入口模块复制；用双 bundle 加载复现"二次注入"行为。
> **未实测项**：所有涉及真实浏览器行为（L1）、真实站点（YouTube/B 站）、真实 MV3 SW 终止重启的结论，文中显式标注"未实测"。
> **不重复上报**：`refactor-ledger.md` 批 12/13/14 与 A–O 各节已修项一律不重列。本报告的 5 条 P0 与 8 条 P1 缺陷，全部在 464 个测试全绿的前提下存在（这正是 P0-5 的论据）。

---

## 结论摘要

1. **静态分层是真实的、且有门禁**：347 条内部 import 边、**0 个模块环**、**0 条跨上层边**（`test/layering.test.mjs` 全图 DFS）。这部分不要动。
2. **但"单例"是假的**：8 个入口各自打 IIFE，模块级实例的语义是"每个 bundle 一份"。全仓库 15 个模块级实例里有 **4 个被打进多个 bundle**（`textMeasurementService` ×4、`uiTextLayoutService` ×2、`floatingLayoutService` ×2、`resize-controller` 的实例 ×2），实测同一页面上 `textMeasurementService` 有 2 份不同实例；摘要面板因此跑在 canvas 兜底引擎上，而页面翻译跑在 pretext 上。跨内容入口重复源码 **140.2 KB**。
3. **三个内容入口的幂等性写了三种**：`content-runtime` 有 `window` 守卫，`subtitle-manager` 无守卫并覆盖 `window.subtitleManager`，`summary-entry` 在模块顶层无条件注册监听。**已复现**：二次注入 `subtitle-manager.js` 后 `REQUEST_SUBTITLE_TRANSLATION_STATUS` 收到两个响应，先到的那个 `isSupported:false`，popup 的字幕控件因此消失。
4. **`domainRules` 叠加语义有两份实现**，且第二份读一个**全仓库无人写入**的字段（`subtitleStrategy`）。用户在设置页选的"字幕策略：不使用"会被后台注入器完全忽略。
5. **设置对象有两种形状**（raw 全局 / hostname-effective）同时是一等公民，4 个消费者 + 2 条写入路径，无单一来源。`content-runtime.js:158-186` 的注释记录了一次已经发生过的真实故障，修法是在消费侧"别相信这个形状"；options 表单还用"整份内存快照覆盖存储"（`options-actions.js:99/115` + `options-app.js:102-108`），外部一次变更就会抹掉用户未保存的编辑。
6. **5 个协议类型是死的**（`SAVE_RULE_CHANGE`、`GET_VALIDATED_SETTINGS`、`TOGGLE_SUBTITLE_TRANSLATION`、`DISPLAY_SELECTION_TRANSLATION`、`REVERT_PAGE_TRANSLATION`）：只有 handler/key，全仓库零发送方。45 个协议类型里 11% 不可达，而 `message-types.test.mjs` 的门禁只断言"存在且被归类"。
7. **`PageTranslationJob` 693 行 / 31 方法 / 53 次 `this.X =`**：扫描、可见性调度、滚动状态机、进度上报、消息通信五件事写在同一个类里。
8. **建议目标形态**：`lib → common(dom-free | dom) → {background, content, popup, options}` + **一个显式的"内容侧运行时注册表"**（替代 5 个隔离世界 `window.*` 全局与 15 个模块级实例中的跨包重复项）+ **一条 tab 记录**（替代 3 张 `storage.session` 表）+ **一个协议 schema 模块**（替代两端各写 destructure）+ **`package.json` 改 `type: module`**（让 27 个测试不再各自 esbuild、让纯函数可直接 import）。

---

## 评审方法与基线

| 项 | 实测值 | 命令/脚本 |
|---|---|---|
| 第一方源码 | 152 文件 / 18946 行 | `find src -name '*.js' -not -path 'src/lib/*' \| wc -l` / `… -exec cat {} + \| wc -l` |
| 全部 src（含 vendor） | 156 文件 / 23030 行 | `find src \( -name '*.js' -o -name '*.mjs' \)` |
| 测试 | 56 文件 / 13087 行 / 464 用例 | `node --test`，`wc -l test/*.mjs` |
| 内部 import 边 | 347 | `.tmp/arch-audit/graph.mjs` |
| 模块环 | **0** | Tarjan SCC 全图 |
| 跨上层边（common→上层） | **0**（仅 common→lib 4 条，属 vendor shim） | 同上 |

> 任务书给的"155 个 js 文件 23028 行"与实测 156 / 23030 差 1 文件 2 行，以实测为准。

---

## P0 必须改

### P0-1 模块级单例在多 bundle 里各有副本；三个内容入口的幂等性三种写法 —— 已复现真实故障

**证据 1：同一个页面里有 2–4 份同名"单例"。**

自建产物（`npx esbuild <8 entries> --bundle --format=iife --metafile`）实测跨入口复制：

| 模块 | 出现在几个入口 | 位置 |
|---|---|---|
| `src/lib/browser-polyfill.js` | **7** | 8 个入口里除 bilibili 策略外全有 |
| `src/common/text-measurement.js` | **4** | `content-script.js`、`summary-entry.js`、`options.js`、`popup.js` |
| `src/content/layout/floating-layout-service.js` | 2 | `content-script.js`、`summary-entry.js` |
| `src/content/layout/resize-controller.js` | 2 | 同上 |
| `src/common/ui-text-layout-service.js` | 2 | `options.js`、`popup.js` |

`src/common/text-measurement.js:241-243` 的实例状态是这个：

```js
    #engine = null;
    #preparedCache = new LruCache();
    #measurementCache = new LruCache();
```

`content-script.js` 与 `summary-entry.js` 是两次独立的 `scripting.executeScript({files})`，各是一份 IIFE，所以**同一页面上有两份 `#engine`、两份 LRU 缓存**。

**证据 2：引擎注册只发生在 content-script 那一份。**
`registerPretextMeasurementEngine` 全仓库只有一个调用点：

```js
// src/content/content-runtime.js:347
        this.registerMeasurementEngine();
```

而摘要面板的布局走**同一个** `textMeasurementService`：

```js
// src/content/layout/summary-layout-controller.js:2
import { textMeasurementService } from '../../common/text-measurement.js';
```

产物级验证（`grep -c`，实测）：

| bundle | `pretext` 出现次数 | `canvasMeasurementEngine` 出现次数 |
|---|---|---|
| `content/content-script.js` | **20** | 4 |
| `content/summary/summary-entry.js` | **0** | 3 |

即：摘要面板的排版测量**永远**跑 canvas 兜底引擎，页面翻译跑 pretext。这与 `pretext-measurement-engine.js:9-13` 注释宣称的"只有页面翻译 / 摘要这些在意断行保真度的场景才需要它"直接矛盾——摘要恰恰拿不到。

**证据 3：三个内容入口，三种幂等策略。**

| 入口 | 守卫 | 代码 |
|---|---|---|
| `content/content-script.js` | 有，`window` 标志 | `src/content/content-runtime.js:340` `if (this.window.foxlateContentScriptInitialized) {` |
| `content/subtitle/subtitle-manager.js` | **无**，且模块顶层直接覆盖全局 | `:112` `window.subtitleManager = new SubtitleManager();` / `:116` `initializeSubtitleManager();` |
| `content/summary/summary-entry.js` | 对象级（`window.summaryModuleInstance`）但监听是顶层无条件注册 | `:70` `browser.runtime.onMessage.addListener(request => {` / `:102` `bootstrapSummary();` |

`SubtitleManager` 构造函数里还注册监听（`src/content/subtitle/subtitle-manager.js:23` → `this.#addMessageListener()`；`:100-107` 的 `#addMessageListener()` 内 `:101` 就是 `this.browser.runtime.onMessage.addListener(...)`）。

**已复现**（`.tmp/arch-audit/inject/probe.mjs`：把 `subtitle-manager.js` 打成两份独立 bundle、按两次注入顺序求值）：

```
separate module instances: true
window.subtitleManager overwritten by 2nd injection: true
runtime.onMessage listeners after 2 injections: 2
one status request -> responses: [{"isSupported":false,"isEnabled":false},{"isSupported":true,"isEnabled":true}]
first response wins in WebExtensions dispatch => popup sees: {"isSupported":false,"isEnabled":false}
```

第二份创建了新的 manager 并覆盖 `window.subtitleManager`，第一份成为**孤儿但仍在应答消息**的实例；`isSupported` 为假 → `src/popup/popup-actions.js:250` 的 `renderSubtitleControls({ isSupported: Boolean(status?.isSupported) })` 会把字幕控件隐藏。

同样的结构在 `summary-entry.js` 上也复现了：

```
TOGGLE_SUMMARY_REQUEST listeners after 1 injection: 1
after 2 injections: 2
```

两个监听器都会调 `togglePageSummaryDialog()` → 开一次再关一次，用户看到"按了没反应"。

（注：`summary-entry` 的探针在第二次求值时因缺少完整 DOM mock 抛错，但**监听器已在此前注册**，计数不受影响。）

**证据 4：为什么"二次注入"不是假设。** `src/background/script-injector.js:34-50` 是**无锁的读-改-写**：

```js
            const injectedFiles = new Set(await tabStateManager.getInjectedFiles(tabId, frameId));
            const filesMissing = uniqueFiles.filter(file => !injectedFiles.has(file));
            …
            await browserApi.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: jsToInject });
            await tabStateManager.markFrameAsInjected(tabId, frameId, filesMissing);
```

两个并发调用（`onCompleted` 自动注入 + 用户点"翻译"、或快捷键 + `ENSURE_SUMMARY_MODULE`）可以同时读到"未注入"，各注入一次。`TabStateManager` 的写队列只串行化**写**，不覆盖"读→执行→写"整段。

> 诚实边界：真实的并发触发窗口**未实测**（需要真浏览器 + 稳定 `--load-extension` 会话，1.7.8 本轮仍受 ledger 批 14 记录的"扩展重载摩擦"限制）。上面的复现证明的是"二次注入之后会怎样"，不是"二次注入一定发生"。但 `ensureScriptsInjected` 缺少互斥是代码事实。

**为什么是根因**：仓库把"模块级单例"当成了进程级单例。在 IIFE 多入口 + 多次 `executeScript` 的模型下，`export const x = new X()` 的语义是"每个 bundle 一份、每次注入一份"。而幂等被当成每个入口各自的自觉，不是共享原语——第 5 个内容入口（PDF？划词朗读？）会复制第三种或第四种写法。

**建议方案**

1. 新增 `src/content/content-runtime-registry.js`（唯一允许挂 `window` 的模块）：

```js
// 键空间集中在常量里，禁止各模块自造 window 属性名
const KEY = Symbol.for('foxlate.registry.v1');   // 一个不可枚举槽位，替代 6 个散落的 window.X

export function getRegistry(win = window) { … }   // { settings: fn|null, subtitleManager, summary, measurement, cssInjected:bool }
export function guardOnce(win, name, factory) { … } // 已存在则返回既有实例；否则创建并登记
```

2. 三个入口统一改为：

```js
// src/content/subtitle/subtitle-manager.js:111-116 替换为
const manager = guardOnce(window, 'subtitleManager', () => new SubtitleManager());
```

`summary-entry.js:70` 的监听移进 `guardOnce(win, 'summaryMessageListener', () => browser.runtime.onMessage.addListener(...))`。

3. `createEnsureScriptsInjected` 增加 per-`(tabId, frameId)` 互斥：

```js
// src/background/script-injector.js
const inflight = new Map(); // key = `${tabId}:${frameId}`
export function createEnsureScriptsInjected({ …, inflightMap = inflight } = {}) {
    return async function ensureScriptsInjected(tabId, frameId, filesToInject) {
        const key = `${tabId}:${frameId}`;
        if (inflightMap.has(key)) return inflightMap.get(key);
        const p = injectOnce(tabId, frameId, filesToInject).finally(() => inflightMap.delete(key));
        inflightMap.set(key, p);
        return p;
    };
}
```

4. 文本测量引擎下沉到"内容侧启动原语"：把 `registerPretextMeasurementEngine()` 从 `ContentRuntime#initialize` 移到一个由**所有**内容入口共同调用的 `src/content/measurement-bootstrap.js`，或把 `summary` 的布局测量改为接收注入的 service（构造函数参数），从而根本不需要"共享实例"这个假设。

**影响面**：`src/background/script-injector.js`、`src/content/subtitle/subtitle-manager.js`、`src/content/summary/summary-entry.js`、`src/content/content-runtime.js`、`src/content/layout/*`（4 个布局服务）、`test/script-injector.test.mjs`、`test/summary-entry.test.mjs`、`test/subtitle-behavior.test.mjs`。
**工作量**：2–3 天（含 3 条新门禁：入口幂等、`window.` 白名单、`script-injector` 并发）。**不建议**一次到位改成单一 bundle（见"需要用户决策" D4）。

---

### P0-2 `domainRules` 叠加语义有两份实现，第二份读一个从不存在的字段

**证据 1：权威实现在 `src/common/settings-domain.js`**，语义是"最长后缀匹配 + 白名单键覆盖"：

```js
// src/common/settings-domain.js:80-84
    const matchingDomain = Object.keys(domainRules)
        .filter(domain => hostname.endsWith(domain))
        .sort((a, b) => b.length - a.length)[0];
```

```js
// src/common/settings-domain.js:135-141
const DOMAIN_RULE_OVERRIDE_KEYS = Object.freeze([
    'autoTranslate',
    'translatorEngine',
    'targetLanguage',
    'sourceLanguage',
    'displayMode',
]);
```

**证据 2：第二份实现在字幕注入器里，语义不同且字段不同**：

```js
// src/background/subtitle-injection.js:26-33
            const userRules = settings.domainRules || {};

            let strategyToInject = null;
            if (userRules[hostname]?.subtitleStrategy) {
                const userChoice = userRules[hostname].subtitleStrategy;
                if (userChoice === 'none') {
```

三处不一致：

| | `settings-domain.js` | `subtitle-injection.js` |
|---|---|---|
| 键匹配 | `hostname.endsWith(domain)` 最长后缀 | `userRules[hostname]` **精确相等** |
| `applyToSubdomains` | 参与判定（`:96`） | 完全不看 |
| 字幕字段名 | `domainRule.subtitleSettings`（`store.subtitleSettings.enabled/strategy/displayMode`） | `domainRules[host].subtitleStrategy`（扁平、**无人写**） |

**证据 3：`subtitleStrategy` 是幽灵字段 —— 全仓库零写入。**
`grep -rn subtitleStrategy src public scripts build.js` 的完整输出只有 3 行，其中 2 行是上面那个读点，1 行是 options 的下拉文案：

```
src/background/subtitle-injection.js:29:            if (userRules[hostname]?.subtitleStrategy) {
src/background/subtitle-injection.js:30:                const userChoice = userRules[hostname].subtitleStrategy;
src/options/ui-helpers.js:115:    addOption(selectElement, browser.i18n.getMessage('subtitleStrategyNone') …
```

它也不在 `DOMAIN_RULE_WRITABLE_KEYS`（`settings-domain.js:229-241`）里，`setDomainRuleProperty` 会直接拒绝写它：

```js
// src/common/settings-domain.js:243-247
    if (!DOMAIN_RULE_WRITABLE_KEYS.includes(key)) {
        console.warn(`[settings-domain] ignored non-writable domain rule key: ${key}`);
        return settings;
```

**用户可见后果**：设置页里那个字幕策略下拉**确实写**的是另一个字段——

```js
// src/options/components/DomainRuleModal.js:234-235
                if (!this.#state.editingRule.subtitleSettings) this.#state.editingRule.subtitleSettings = {};
                this.#state.editingRule.subtitleSettings.strategy = val;
```

所以用户为 `www.youtube.com` 选"不使用"后：写入的是 `subtitleSettings.strategy='none'`，注入器读 `subtitleStrategy` 得到 `undefined` → 落到 `DEFAULT_STRATEGY_MAP.has('www.youtube.com')` → **照样注入 YouTube 策略脚本**。"用户关掉了字幕"这件事只靠内容侧 `displayMode: 'off'` 兜住，脚本本身还是下载并执行了。

**为什么是根因**：`domainRules` 是产品里唯一一张"用户意图表"，却被两处各自解释。第 5 个功能（比如"按站点禁用摘要/AI 引擎/快捷键"）一定会遇到同一个岔路，而没有任何机制告诉作者"该去 `settings-domain.js`"。

**建议方案**

1. 把注入判定改成调权威解析器，删掉本地实现：

```js
// src/background/subtitle-injection.js
import { resolveEffectiveSettings } from '../common/settings-domain.js';
…
const effective = resolveEffectiveSettings(await settingsManager.getValidatedSettings(), hostname);
const strategy = effective.subtitleSettings?.strategy;   // 单一来源
if (!effective.subtitleSettings?.enabled || strategy === 'none') return;
const scriptFile = STRATEGY_FILE_MAP.get(strategy);
```

2. 在 `settings-domain.js` 里把 `calculateEffectiveSubtitleSettings` 的"默认策略来自 host 表"与"用户显式选择"合并成一个签名，并给 `subtitleStrategy` 加一条**迁移**：`validateSettings` 若读到旧的 `rule.subtitleStrategy` 就折叠成 `subtitleSettings.strategy`（与已有的 `cssSelector → translationSelector` 迁移同一形态，`settings-domain.js:38-52` 已有先例）。

3. 加门禁（`test/settings-domain.test.mjs`）：**任何 `domainRules[...]` 的直接读取只允许出现在 `src/common/settings-domain.js`**。这是可 grep 的机器判据，与仓库已有的 `DISPLAY_MODES 只能从注册表装配`（`layering.test.mjs:225`）同一形态。

**影响面**：`src/background/subtitle-injection.js`（删 20 行）、`src/common/settings-domain.js`、`test/settings-domain.test.mjs`、`test/subtitle-behavior.test.mjs`。
**工作量**：0.5 天 + 0.5 天门禁与回归。

---

### P0-3 设置对象有两种形状同时是一等公民；`source` 字段把形状差异泄漏给所有消费者

**证据 1：`raw` 与 `effective` 两个形状。**

- raw：`SettingsManager.getValidatedSettings()`（`src/common/settings-manager.js:136`）—— 16 个顶层键（附录 A6），`domainRules` 是整张表。
- effective：`getEffectiveSettings(hostname)`（`:180`）—— `resolveEffectiveSettings` 在 raw 之上**改写** `displayMode`/`translatorEngine`/`targetLanguage`/`sourceLanguage`/`autoTranslate`，并**替换**整块 `subtitleSettings`、`translationSelector`、`summarySettings`：

```js
// src/common/settings-domain.js:148-152
export function resolveEffectiveSettings(settings, hostname) {
    const domainRules = settings.domainRules || {};
    const { domainRule, ruleSource } = findMatchingDomainRule(domainRules, hostname);
    const effectiveSettings = {
        ...settings,
        source: ruleSource,
    };
```

```js
// src/common/settings-domain.js:168
    effectiveSettings.subtitleSettings = calculateEffectiveSubtitleSettings(hostname, domainRule);
```

**证据 2：`source` 是注入的"元数据"，却混进了设置对象本身。** 全仓库读 `settings.source` 的有 3 处，全部是业务判断（`src/background/handlers/tab-handlers.js:70`、`src/popup/popup-actions.js:57`、`src/popup/popup-actions.js:133`），即"这条 effective 是从哪条规则来的"被当成设置字段用。

**证据 3：消费者分布（实测 grep 计数）。**

| 侧 | 拿到的形状 | 传输方式 |
|---|---|---|
| background | raw（`getValidatedSettings`）+ effective（`getEffectiveSettings`） | 直接调 `SettingsManager` 静态方法 |
| content | 只有 effective | `runtime.sendMessage(GET_EFFECTIVE_SETTINGS)`（`src/content/content-settings-client.js:9-12`） |
| options | **raw**（直接读 storage 再 `validateSettings`） | `src/options/options-actions.js` 直接 `SettingsManager.saveLocalSettings(...)` |
| popup | **effective**（消息往返）+ **直接写**（`settingsManager.saveDomainRuleProperty`） | `src/popup/popup-actions.js:52`（读）/ `:172`（写） |

于是同一个 `settings` 对象有**两条写入路径**（popup/options 直接 `storage.local`；content → 消息 → background）和**两种形状**，而判断"该用哪种"没有任何类型或门禁提示。

**证据 4：这个歧义已经造成过真实故障，修法是"在消费侧别相信这个形状"。**

```js
// src/content/content-runtime.js:158-166
    async handleSettingsUpdated(_newSettings) {
        // Always re-resolve *effective* settings for this hostname.
        // Raw storage payloads are global-shaped (nested translationSelector.default,
        // no domain overlays) and must not replace the page job settings or drive
        // display-mode switches — that caused append→replace/hover to no-op after
        // SETTINGS_UPDATED overwrote a correct UPDATE_DISPLAY_MODE.
        const effective = await this.getEffectiveSettings();
```

即：后台明明在 `SETTINGS_UPDATED` 的 payload 里送了 `newValue`，内容侧必须**丢掉它**再发一次消息重新取。一次设置变更 = 1 次广播 + N 次往返。

**证据 5：第五个地方在"造"设置对象。** `src/content/summary/summary-entry.js:33-45` 的 `buildForcedSummarySettings` 手工拼一个 `summarySettings`，并在注释里承认它恒为 `enabled: true` 所以不能用来判断开关：

```js
// src/content/summary/summary-entry.js:33-36
export function buildForcedSummarySettings(settings = {}) {
    if (settings.summarySettings?.enabled) {
        return settings;
    }
```

**为什么是根因**：设置是全局唯一的数据源，却有 3 种派生形状（raw / effective / forced）与 2 条写路径，靠 4 处注释互相提醒。第 5 个功能加一个新设置项时，必须同时回答"哪个形状能读到它、哪条路径能写它、广播带不带它"，而没有任何一处能回答。

**证据 6（新增，与 S1 同形但仍存活）：options 表单用"整份内存快照"覆盖存储，且外部变更会抹掉未保存的编辑。**

写：`src/options/options-actions.js:99` 取快照、`:115` 整份写：

```js
        const settingsToSave = this.getCurrentSettingsState();     // :99
        …
            await SettingsManager.saveLocalSettings(settingsToSave);  // :115
```

```js
// src/options/options-app.js:31-33
    getCurrentSettingsState() {
        return { ...this.state };
    }
```

`this.state` 只在启动时从存储读入（`options-actions.js:86` `getValidatedSettings()`），此后仅由 reducer 与 `SET_FULL_STATE` 改动（导入设置时另有一次重读 `options-actions.js:411`）。`saveLocalSettings` 内部只有两行，**没有任何重读-合并**：

```js
// src/common/settings-manager.js:205-208
    static async saveLocalSettings(settings) {
        const settingsToSave = prepareSettingsForStorage(settings);
        await browser.storage.local.set({ settings: settingsToSave });
    }
```

读回来时更狠：

```js
// src/options/options-app.js:102-108
        SettingsManager.on('settingsChanged', ({ newValue }) => {
            this.setInitialSettingsSnapshot(newValue);
            this.dispatch({
                type: 'SET_FULL_STATE',
                payload: JSON.parse(this.initialSettingsSnapshot),
            });
        });
```

两个后果（代码即证，**未做浏览器级复现**）：

1. **未保存的编辑会被外部变更清空**。用户在 options 改了几个字段还没点保存，此时 popup 切换了一次显示模式（`saveDomainRuleProperty` → `storage.local.set` → `settingsChanged`）→ `SET_FULL_STATE` 用存储值整体替换 `this.state` → 用户刚敲的内容消失，且**没有任何提示**。
2. **整份覆盖会丢掉别人的字段级写入**。popup 的 `saveDomainRuleProperty` 是读-改-写（`settings-manager.js:221-229` `#mutateStoredSettings`），而 options 的保存是"我的快照覆盖一切"。两者并发时后者赢。

这正是 ledger S1 描述的场景；S1 的修复只覆盖了 `#mutateStoredSettings`（单字段写入），**主设置表单这条路径没有一起修**。仓库自己已经把这个危害写在了注释里，只是没盖住 options 表单：

```js
// src/common/settings-manager.js:213-215（#mutateStoredSettings 的注释）
     * 单字段写入（新增/删除 AI 引擎、改某个域规则属性）如果先读缓存再整对象回写，
     * 别的上下文（另一个 options 页、popup、内容脚本）在两者之间的写入就会被它的
     * 旧快照抹平——用户会看到「刚设置的开关自己关回去了」。
```


**建议方案（具体到签名）**

1. 在 `src/common/settings-contract.js` 新增唯一出入口，把"形状"变成类型级不可混淆的两个函数名：

```js
/** 只允许 background/options 使用：未叠加域名规则的存储值，只读、深冻结 */
export function readStoredSettings({ settingsManager }) { … }
/** 只允许 content/popup 使用：已按 hostname 叠加，随 hostname 变化 */
export async function readEffectiveSettings({ settingsManager, hostname }) { … }
```

2. 把 `source` 从设置对象里摘出去，改成并列返回：

```js
// 现在：resolveEffectiveSettings(settings, hostname) → {…settings, source, …}
// 改为：resolveEffectiveSettings(settings, hostname) → { settings, source }
```
`resolveEffectiveSettings` 的返回值形状变了，`settings-manager.js:189`、`test/settings-domain.test.mjs`（7 个用例）一起改；`tab-handlers.js:70`、`popup-actions.js:57/133` 三处读点改为解构。

3. 取消 popup 的直接写入路径：`PopupActions.saveChangeToRule` 改为发 `SAVE_RULE_CHANGE`（那个 handler 现在已经存在，只是没人调用，见 P1-3）。这样"设置的唯一写入口 = background"。

4. 门禁：`src/options`、`src/popup` 不得 import `resolveEffectiveSettings`；`src/content` 不得 import `settings-domain.js`（现为 0，加断言保持 0）。

**影响面**：`src/common/settings-domain.js`、`settings-manager.js`、`src/background/handlers/settings-handlers.js`、`tab-handlers.js`、`src/popup/popup-actions.js`（3 处）、`src/content/content-runtime.js`、`test/settings-domain.test.mjs`、`test/popup-architecture.test.mjs`。
**工作量**：1.5–2 天。形状改名会红一批测试，属预期。

---

### P0-4 `PageTranslationJob`：693 行 / 31 方法 / 53 处实例状态赋值，五件事写在一个类里

**证据（实测）**：

| 文件 | 行数 | 方法数 | `this.X =` 次数 | DOM 引用 | browser 引用 |
|---|---:|---:|---:|---:|---:|
| `src/content/page-translation-job.js` | **693** | **31** | **53** | 10 | 7 |
| `src/content/summary/summary.view.js` | 624 | 37 | 65 | 18 | 8 |
| `src/content/content-runtime.js` | 386 | 19 | 23 | 12 | 3 |
| `src/common/settings-manager.js` | 286 | 17 | 0（全静态 3 字段） | 0 | 6 |

状态清单本身就说明职责混在一起（`src/content/page-translation-job.js:52-75`）：

```js
        this.mutationQueue = new Set();
        this.idleCallbackId = null;
        this.initialScanIdleCallbackId = null;
        // 隐藏文档不能用 requestIdleCallback 推进（见 #isDocumentHidden）
        this.initialScanTimeoutId = null;
        this.translationTimeoutIds = new Set();
        this.initialScanQueue = [];
        this.initialScanInProgress = false;
        this.initialScanObservedCount = 0;
        this.mutationDebounceTimerId = null;
        …
        this.state = 'idle';
```

一个类里同时是：①DOM 扫描器（`#startInitialScan`/`#processInitialScan`）、②可见性调度器（IntersectionObserver + 滚动状态机 `#handleScrollActivity`）、③翻译派发器（`#scheduleTranslations` → `translateElement`）、④进度/徽标上报（`recordTranslationStarted/Completed`、`checkCompletion` 里 3 次 `sendMessage`）、⑤文档状态探测（`#isDocumentHidden` 用 `globalThis.document?.hidden`）。

**为什么这是根因（而不是"长一点无所谓"）**：这个类已经在预算内产出过 3 个真实的运行时缺陷（ledger K13 双作业、批 14 的"后台标签页永久挂死"、以及 `:225-234` 那段 `threshold` 注释解释的"元素永不翻译"）。三个缺陷分别属于 ②、⑤、②，说明**缺陷集中在"调度与可见性"这一段，而它和另外四件事共享同一批字段**。加第 5 个功能（比如"只翻译当前视口内的段落"或"翻译图片 alt"）必须动这 53 个字段里的若干，且无法单独测试。

**建议方案（拆成 4 个可注入协作者，`PageTranslationJob` 只保留编排）**

```js
// src/content/page-translation/initial-scanner.js
export class InitialScanner {
    constructor({ getSearchRoots, findTranslatableElements, isDocumentHidden, schedule,
                  onChunkObserved, chunkSize = 12 }) {}
    async start(settings) {}          // 只负责"按视口距离排序 + 分块推进"
    stop() {}
}

// src/content/page-translation/visibility-scheduler.js
export class VisibilityScheduler {                 // IO + 滚动空闲 + 隐藏文档兜底
    constructor({ isDocumentHidden, onVisible, isScrollingEnabled, scrollIdleDelayMs }) {}
    observe(elements) {} unObserveAll() {} notifyScrollActivity() {}
}

// src/content/page-translation/mutation-scanner.js
export class MutationScanner {                      // MutationObserver + debounce + rIC
    constructor({ isExtensionElement, isPotentiallyVisible, onCandidates, debounceMs = 300 }) {}
    start(root = document.body) {} stop() {}
}

// 保留：src/content/page-translation-job.js
export class PageTranslationJob {
    constructor(tabId, settings, { scanner, visibility, mutations, progress, translateElement, dispatcher }) {}
    getProgressSnapshot(extra = {}) {}   // 仍在这里：它要汇总三方
}
```

关键约束（写在测试里）：`InitialScanner` / `VisibilityScheduler` / `MutationScanner` **不接收 browserApi**，只接收回调 —— 于是它们可以完全脱离 WebExtension 环境做纯单元测试（不需要 `globalThis.__foxlateBrowserMock`）。

**影响面**：`src/content/page-translation-job.js` 693 → 约 260 行；新增 3 个模块约 380 行；`src/content/content-runtime.js:73-100`（工厂）；`test/page-translation-job.test.mjs`（现有用例改注入点，断言不变）；`test/content-runtime-architecture.test.mjs`。
**工作量**：3–4 天（含把现有 12 个作业用例迁移到新的注入点，并保持"回退即变红"）。**风险**：这是全仓库最容易引入回归的一处，必须一个协作者一步、每步单独提交。

---

### P0-5 质量门禁只看得见"存在"，看不见"缺席"——本报告 8 条缺陷全部在 464 绿的情况下存在

**证据 1：架构类测试是**源码文本断言**，实测 108 处 `assert.match/doesNotMatch`。

| 文件 | `assert.match/doesNotMatch` | `readFile` |
|---|---:|---:|
| `test/content-runtime-architecture.test.mjs` | 21 | 8 |
| `test/options-architecture.test.mjs` | 13 | 8 |
| `test/core-defaults.test.mjs` | 13 | 0 |
| `test/design-system.test.mjs` | 12 | 6 |

典型形态（`test/content-runtime-architecture.test.mjs:347` 起「content-script entry stays a bootstrap module」）是"读源文件、断言里面没有某个模式"。它能防"有人把逻辑塞回入口"，但**看不见跨文件的事实**：某条消息没有发送方、某个字段没有写入方、某个模块被打进两个 bundle。本报告 P0-1/P0-2/P1-3 全都属于这一类。

**证据 2：协议门禁断言的是"覆盖"，不是"可达"。** `test/message-types.test.mjs:105`（`every message type is classified exactly once …`）断言"每个消息类型都被归类一次"，`:121`（`composed background handler map covers every background-inbound type …`）断言"handler map 与后台入站协议一一对应"。两个断言都要求**存在**；一个永不发送的类型会永远绿。实测 5 个死类型（P1-3）。

**证据 3：体积门禁按入口断言，但按"入口不超预算"，不按"模块不进两个入口"。** `test/bundle-budget.test.mjs:126`「重量级依赖不扩散到不需要它的入口」是唯一一条跨入口断言，且只覆盖 3 个白名单模块（readability / marked / `src/content/summary/`）。`text-measurement.js`（12,972 B × 4 份）不在其内。

**为什么这算 P0**：仓库的自评（ledger N 节）已经总结出"声明存在、读者不存在"是它的头号缺陷形态，之后加的门禁**仍然只朝这个方向补**。第 5 个功能加进来时，真正会咬人的是"缺席"类问题：新消息没人发、新字段没人写、新单例被打进两个包。

**建议方案（4 道可落地的"缺席"门禁）**

```js
// 1) test/protocol-reachability.test.mjs
//    每个 MESSAGE_TYPES 键：必须能在 src/ 里找到 >=1 处 `type: MESSAGE_TYPES.X`
//    （或用白名单显式标注「只作为 handler 存在，供将来使用」并说明原因）
// 2) test/singleton-instances.test.mjs
//    metafile 交叉：同一条 `export const x = new X()` 出现在 >1 个内容入口 ⇒ 红
//    （白名单：纯数据/无状态，需逐条写明理由）
// 3) test/domain-rules-readers.test.mjs
//    `grep domainRules[` 只允许 settings-domain.js 命中
// 4) test/settings-shape.test.mjs
//    src/content/** 不得出现 `getValidatedSettings`；src/options/** 不得出现 `resolveEffectiveSettings`
```

第 2 条的门禁要用真实 metafile：现有 `test/helpers/bundle.mjs` 已经会跑 esbuild，只需 `metafile: true` 并把 `inputs` 汇总，成本可忽略。

**影响面**：仅新增测试文件 + 给 `test/helpers/bundle.mjs` 加 `metafile` 透出。**零生产代码改动。**
**工作量**：1 天（4 条门禁 + 让当前代码转绿：需要真删掉死类型、修掉 P0-1/P0-2，所以**排在这两条之后**）。

---

## P1 应该改

### P1-1 `runTranslationBatch`：177 行 / 圈复杂度 22 / 5 条结果路径挤在一个函数里

**证据**：`src/background/translation-batch-runner.js:21-197`，实测 **177 行、CC 22、最大嵌套深度 5**（附录 A4 第 4 行）。同一个函数里写回了 5 种不同的结果形状：

| 路径 | 行 | 写入 |
|---|---|---|
| 预处理后为空 | `:47` | `results[index] = { text:'', translated:false, log:[getMessage(…)] }` |
| 源=目标语言 | `:52` | 同上（不同 key） |
| prepare 抛错 | `:66-73` | 同上 + `error` |
| 非 AI 单条路径 | `:87-96` | `runSingleTranslation(...)` 并发推进 |
| 缓存命中 | `:104-112` | `cacheStore.touch(cacheKey)` |
| AI 批量候选 / 复用他人 | `:118-124` | `inFlight.claim(cacheKey)` 分叉 |

外加 `:150-176` 的"批量结果按 index 摊回在途项"和 `:180-196` 的"必须继续向上传播非 AI 条目的失败"。

**为什么该改**：三条不变量（共享在途表、先下发再等待、错误传播）都靠注释守着，且都写在同一个作用域里；任何一个新分支（例如"第 5 个功能要按段落情感分桶"）都必须重新理解全部 5 条路径。

**方案**：按"候选分类"抽纯函数，保留一个薄编排：

```js
// 纯函数、无 browserApi，可单测
export function classifyBatchItems({ texts, sourceLang, targetLang, settings, cacheStore, inFlight })
    → { skipped: Map<index, result>, single: Array<{index, prepared}>, batches: Map<engine, Item[]>, waiters: Item[] }
```
```js
// 编排只剩两段
export async function runTranslationBatch(runtime, req) {
    const plan = classifyBatchItems(…);
    const tasks = [...dispatchSingle(plan.single), ...dispatchBatches(plan.batches)];
    return await settleBatch({ plan, tasks, inFlight, results });
}
```
**影响面**：`src/background/translation-batch-runner.js`、`src/background/translator-manager.js:?`（调用点）、`test/translator-manager-batch.test.mjs`（6 用例，断言不变）、`test/ai-batch-resilience.test.mjs`。**工作量**：1.5 天。

---

### P1-2 "接收方不在"这一个浏览器事实，被实现 3 遍，最热的那份最弱

**证据**：三份互不相同的实现。

```js
// ① src/background/tab-messaging.js:11-21 —— 4 个模式、就绪判断、可选重试
const CONNECTION_LOST_PATTERNS = [
    'Receiving end does not exist',
    'Could not establish connection',
    'message channel closed',
    'message port closed',
];
export function isContentConnectionLostError(error) {
    const message = String(error?.message || '');
    return CONNECTION_LOST_PATTERNS.some(pattern => message.includes(pattern));
}
```

```js
// ② src/background/handlers/translation/translation-handler-support.js:70 —— 1 个模式、无重试、且不安全
        if (!sendError.message.includes('Receiving end does not exist')) {
```

```js
// ③ 4 处内联，且 error.message 可能 undefined
// src/popup/popup-actions.js:115 / :198 / :229、src/background/handlers/tab-handlers.js:85
            if (error.message.includes('Receiving end does not exist')) {
```

对照：`src/background/service-worker.js:207` 用的是安全写法 `error?.message?.includes(...)`——说明"可选链"这条修复只落在了一个地方（ledger 批 12 修的就是这一处）。

**影响**：② 是翻译结果回传路径（每次翻译都走），它对 `message channel closed` / `message port closed` 不视作正常竞态，因此在 Firefox 页面卸载时会把它当故障写日志；③ 的 4 处则在 `error.message` 为 undefined 时自己抛 `TypeError`（把"无害失败"变成"未捕获异常"）。

**方案**：②③ 全部改调 `isContentConnectionLostError`，并把 `sendToTabIgnoringMissingReceiver` 改为复用 `sendMessageToContent` 的退避策略（或显式传 `retryDelaysMs: []`）。**影响面**：4 个文件、约 12 行。**工作量**：0.5 天。

---

### P1-3 5 个死协议类型；payload 没有任何单一契约

**证据 1：死类型（`grep -rn` 全量，含 `public/`、`scripts/`、`build.js`）**

| 类型 | 唯一出现位置 | 发送方 |
|---|---|---|
| `SAVE_RULE_CHANGE` | `src/background/handlers/settings-handlers.js:18` | **无**（popup 直接调 `SettingsManager.saveDomainRuleProperty`，`src/popup/popup-actions.js:172`） |
| `GET_VALIDATED_SETTINGS` | `src/background/handlers/settings-handlers.js:14` | **无** |
| `TOGGLE_SUBTITLE_TRANSLATION` | `src/content/content-message-handlers.js:61` | **无** |
| `DISPLAY_SELECTION_TRANSLATION` | `src/content/content-message-handlers.js:53` | **无** |
| `REVERT_PAGE_TRANSLATION` | `src/content/content-message-handlers.js:21` | **无** |

45 个 wire 类型里 5 个不可达（11%）。其中 `DISPLAY_SELECTION_TRANSLATION` 是被 `TRANSLATE_SELECTION_REQUEST` 取代后的遗留（`src/common/message-types.js:50` 的注释 `SW → content: run shared selection translate path` 已说明新路径）。

**证据 2：payload 形状两端各写一遍，无 schema。** 实测（`.tmp/arch-audit/payloads3.mjs`，按花括号配平提取）：

- 45 个类型里 **34 个有发送方、44 个有接收方**；
- **14 个类型的接收方只是把整个 payload 原样转交**（`runtime.handleTranslationResult(request.payload)` 这种），即字段契约藏在第三个模块里；
- 发送/接收两端字段名**当前完全一致**（脚本判定"接收方读了没人写的字段" = 0 命中）—— 这是好消息，说明没有漂移；但一致性靠人，不靠机器。

字段最多的几个：

| 类型 | 发送方数 | 字段数 |
|---|---:|---:|
| `TRANSLATION_STATUS_UPDATE` | 5 | 6 |
| `TRANSLATE_TEXT` | 2 | 6 |
| `TRANSLATE_TEXT_BATCH` | 1 | 6 |
| `TRANSLATE_TEXT_RESULT` | 2 | 5 |

**方案**：

1. 删掉 5 个死类型 + 对应 handler（**先**用 grep 复核；本报告已复核，但落地前必须再跑一次并写进 PR 描述）。删除时同步改 `test/message-types.test.mjs` 的三张分类表。
2. 新增 `src/common/message-schema.js`（只放数据 + 一个校验器，零依赖）：

```js
export const MESSAGE_SCHEMA = Object.freeze({
    TRANSLATE_TEXT: { request: ['text','targetLang','sourceLang','elementId','translatorEngine','tabId'],
                      response: ['elementId','success','translatedText','wasTranslated','error'] },
    …
});
export function assertPayload(type, kind, payload) { … }  // 只在 __DEBUG__ 下启用
```
两端各调一次：发送侧 `assertPayload(type,'request',payload)`，接收侧首行同一句。门禁：`MESSAGE_SCHEMA` 的键集合必须等于 `MESSAGE_TYPES` 的键集合。
**影响面**：`src/common/message-types.js`、新增 1 文件、5 个 handler 文件、`test/message-types.test.mjs`。**工作量**：1.5 天。

---

### P1-4 三张 `storage.session` 的 tab 表可以合并成一条 tab 记录

**证据**：`src/background/tab-state-manager.js` 维护 3 张独立的、以 tabId 为键的表：

| 表 | 读点 | 写点 | 生命周期 |
|---|---|---|---|
| `tabTranslationStates` | `:57` | `:70`（`setTabStatus`） | 文档级（`resetTabDocumentState` 清） |
| `sessionTabTranslations` | `:113` | `:92`（`registerTabForAutoTranslation`） | **宿主级**（`resetTabDocumentState` 刻意不清，`tab-state-manager.js:153-154` 注释） |
| `injectedFrames` | `:208`、`:225` | `:186`（`markFrameAsInjected`） | 文档级 |

三个表共享同一个 `#readModifyWrite`，而它在"多键"形态下会把**整份读到的对象原样写回**：

```js
// src/background/tab-state-manager.js:250-255
        const currentStates = await this.#browser.storage.session.get(keys);
        if (Array.isArray(keys)) {
            const newStates = modifier(currentStates || {});
            await this.#browser.storage.session.set(newStates);
            return;
        }
```

再加两处痕迹：`removeTab` 里有一段死代码

```js
// src/background/tab-state-manager.js:134-135
                if (changed) {
                }
```

以及 `#writeLock` 只锁写不锁读（`:32-37`），`isFrameInjected`/`getInjectedFiles` 全在锁外。

**方案**：单一 key `tabRecords`，一条记录装三个字段：

```js
// { [tabId]: { status, host, frames: { [frameId]: string[] } } }
async getTabRecord(tabId)                     // 一次读
async patchTabRecord(tabId, patchFn)          // 一次读改写（沿用现有队列）
async resetDocumentFields(tabId)              // 清 status + frames，保留 host
```
收益：3 次 storage 读 → 1 次；`resetTabDocumentState` 与 `removeTab` 的差异变成"清哪几个字段"而不是"清哪几张表"；`#readModifyWrite` 的多键分支可以删掉（现在只有 `removeTab` / `resetTabDocumentState` 用它）。
**代价**：迁移需兼容旧格式（现有代码已为 `injectedFrames` 的数组旧格式留了分支 `:210-213`，同一手法可复用）。**影响面**：`tab-state-manager.js`（263 → 约 200）、`test/tab-state-manager.test.mjs`（15 用例）。**工作量**：1 天。

---

### P1-5 `window` 服务定位器：5 个自定义全局、35 处属性访问

**证据**（实测：`grep -rnoE "(window|windowRef|win|this\\.window|this\\.win)\\.<id>\\b" src --include=*.js`，排除 `src/lib/`）：

| 全局 | 写入点 | 属性访问次数 |
|---|---|---:|
| `getEffectiveSettings` | `content-runtime.js:349` | 12（含 `subtitle-manager`、`youtube-subtitle-strategy` ×2、`display-language-context`、`input-handler` ×2） |
| `subtitleManager` | `subtitle-manager.js:112` | 12（含 `content-runtime.js:184/281/288`、两个策略文件） |
| `summaryModuleInstance` | `summary.js:458`、`:460` | 8 |
| `foxlateContentScriptInitialized` | `content-runtime.js:344` | 2 |
| `__foxlate_css_injected` | `content-runtime.js:374` | **1（就是那次写，零读者）** |
| **隔离世界小计** | | **35** |
| `__foxlate_originals` | `youtube-subtitle-strategy.js:96` | 10（**页面世界**注入函数内，合法，不计入上面 35） |

`__foxlate_css_injected` 是纯死代码：全仓库唯一出现就是那行赋值（已 grep 确认）。

`window.getEffectiveSettings` 最糟：`src/content/subtitle/subtitle-settings-readiness.js` 整文件（20 行）就是"轮询等这个函数出现"：

```js
// src/content/subtitle/subtitle-settings-readiness.js:6
    if (typeof windowRef.getEffectiveSettings === 'function') {
```

即：一个依赖注入问题被解决成了"轮询全局变量是否就绪"。

**方案**：P0-1 的 `content-runtime-registry.js` 覆盖 `subtitleManager` / `summary` / `measurement` / 开关标志；`getEffectiveSettings` 改为由各入口自行构造（`createEffectiveSettingsGetter` 已经是纯函数，`summary-entry.js:21` 已经在这么做）→ `subtitle-settings-readiness.js` 整个文件可以删。`__foxlate_css_injected` 直接删。**影响面**：7 个文件、删 1 文件、删 1 死写。**工作量**：1 天。

---

### P1-6 摘要面板的内部事件总线：8 个事件名，两侧各写一次字面量

**证据**：`SummaryDialog` 用 DOM `CustomEvent` 当内部总线（`src/content/summary/summary.view.js:183-185`）：

```js
    dispatchEvent(type, detail) {
        this.element.dispatchEvent(new CustomEvent(type, { detail }));
    }
```

发射侧（2 个文件，实测 8 个事件名）：`dialog-action`、`refresh`、`request-close`、`send-message`、`tab-close`、`tab-switch`、`tab-toggle-original`、`infer-suggestions`。
监听侧（`src/content/summary/summary.js:133-143`）逐条字面量注册：

```js
        this.summaryDialog.element.addEventListener('send-message', e => this.handleSendMessage(e.detail.query));
        this.summaryDialog.element.addEventListener('refresh', () => this.handleRefresh());
```

没有任何常量、没有 schema、没有"两侧一致"的门禁；`e.detail` 的形状（`{action,index,payload}` / `{query}` / `{tabId}`）也是隐式的。

**方案**：新增 `src/content/summary/summary-events.js`：

```js
export const SUMMARY_VIEW_EVENTS = Object.freeze({
    SEND_MESSAGE: 'send-message', REFRESH: 'refresh', REQUEST_CLOSE: 'request-close',
    DIALOG_ACTION: 'dialog-action', TAB_SWITCH: 'tab-switch', TAB_CLOSE: 'tab-close',
    TAB_TOGGLE_ORIGINAL: 'tab-toggle-original', INFER_SUGGESTIONS: 'infer-suggestions',
});
```
门禁：`grep dispatchEvent('` 与 `addEventListener('` 在 `src/content/summary/` 内不得命中裸字符串。**影响面**：3 个文件、约 20 行替换。**工作量**：0.5 天。**注意**：不要顺手改成回调注入——`CustomEvent` 在这里承担了"view 不 import module"的解耦，是对的；缺的只是常量与门禁。

---

### P1-7 引擎解析日志硬编码中文——与已修的 J9/J15/J16 同一模式

**证据**：`src/background/translator-engine-resolver.js` 的 4 条日志是中文裸串，而同一 `log` 数组的其它条目走 i18n：

```js
// :94
            log.push(`短文本引擎为“默认”，解析为全局引擎: ${fallbackEngineName}`);
// :98
            log.push(`[警告] 检测到循环依赖：备用引擎 (${fallbackEngineName}) 与当前引擎相同。为防止死循环，将使用原始AI引擎。`);
// :105
            log.push(`[警告] 找不到备用翻译器 '${fallbackEngineName}'。将使用原始AI引擎。`);
// :109
            log.push(`短文本切换：单词数 ${wordCount} <= ${aiConfig.wordCountThreshold}，切换到 ${resolvedFallbackEngine}`);
```

对照同一链路的 i18n 用法：`src/background/translation-executor.js:46` `const getMessage = (key, args) => this.#browserApi.i18n.getMessage(key, args);`，其后 `:55` 起共 6 处 `getMessage('logEntry…')`。

**这是用户可见的**：`log` 只在一条路径上被消费 —— `src/background/handlers/translation/engine-test-handlers.js:41` `log: result.log || []` → options 的日志面板：

```js
// src/options/options-actions.js:307-308
            if (response.log && response.log.length > 0) {
                this.logContent.textContent += `\n${response.log.join('\n')}`;
```

即英文界面下这里必然出现中文。**方案**：4 处改为 `logEntryFallback*` 新 key（en/zh_CN 各 4 条），`scripts/sync-inline-i18n.mjs` 会校验。**影响面**：1 文件 + 2 个 locale json。**工作量**：0.5 小时。

---

### P1-8 `translateText` 与 `translateTextBatch` 两个 handler 结构性重复约 70%

**证据**：`src/background/handlers/translation/translate-text-handler.js`（92 行）与 `translate-text-batch-handler.js`（120 行）的成功/失败两条路径逐段同构：

| 段 | single | batch |
|---|---|---|
| 解析 payload + 校验 `originTabId` | `:19-25` | `:29-35` |
| `recordEngineHealth({healthStore, engine, startedAt, error})` | `:30-35` | `:47-53`、`:78-85` |
| 逐条 `recordTranslationOutcome(...)` | `:36-46` | `:55-65` |
| `sendToTabIgnoringMissingReceiver({… label: '… (sending error)'})` | `:47-62`、`:80-89` | `:58-73`、`:99-115` |
| catch 分支（健康度 + 失败队列 + 发送错误） | `:63-90` | `:74-118` |

差别只在"整批只记一次健康度"（batch 的 `:47-53` 有注释解释）。

**方案**：抽 `src/background/handlers/translation/translation-outcome.js`：

```js
export async function runTranslationWithOutcome({
    browserApi, translatorManager, historyStore, failureQueue, healthStore, logError,
    request, sender, surface,              // 'page' | 'page-batch'
    invoke,                                // () => Promise<result | result[]>
    toResultMessage,                        // (results) => { type, payload }
    healthMode = 'per-call' | 'per-batch',
}) {}
```
**影响面**：2 个 handler 变薄（各 ~25 行）+ 新 1 文件。**工作量**：1 天。**风险**：`test/translation-handlers.test.mjs` 是行为断言，能兜住。

---

## P2 可以改

| # | 项 | 证据 | 建议 |
|---|---|---|---|
| P2-1 | `src/background/handlers/handler-context.js` 整个模块只有 2 个函数、共 4 行逻辑 | `:14-16` `getHostname`、`:19-21` `getLatency` | 保留（有 6 个 handler 用它，删除会变成 6 份副本），但可以并进 `translation-handler-support.js`，少一层目录 |
| P2-2 | `SettingsManager.generateDefaultSettings()` 是纯转发 | `src/common/settings-manager.js:128-130` 唯一语句 `return generateDefaultSettings();` | 调用方（`options-actions.js`）直接 import `settings-domain.js` 的版本；静态类不承担转发 |
| P2-3 | `tab-state-manager.js:134-135` 空 `if (changed) {}` | 见 P0-4 证据段 | 删（1 行） |
| P2-4 | `youtube-subtitle-strategy.js` 的 DOM id / 事件名仍是旧产品名 | `:12` `static SCRIPT_ID = 'san-reader-network-interceptor';`、`:13` `static EVENT_NAME = 'san-reader-subtitle-data';` | 改成 `foxlate-*`（注意与已注入页面上的旧 id 不冲突：脚本执行后立即 `remove()`，改名的唯一影响是升级瞬间可能短暂双注入，可接受） |
| P2-5 | `DISPLAY_MODES` 只覆盖 3 个用户可选模式，第 4 个策略 `enhancedContextMenu` 绕过表 | `src/common/constants.js:162-180`（3 项）vs `src/content/display/display-strategy-registry.js:8-14`（4 项）；`src/content/display/display-language-context.js:6` 用字面量 `if (displayMode !== 'enhancedContextMenu')` | 给注册表项加 `userSelectable: false` 标记，`display-language-context` 改成读注册表标记；这样"第 5 个显示模式"只需改 1 个表 |
| P2-6 | `options-renderer.render` 的手写 dirty-key 清单与字段写入没有一致性保证 | `src/options/options-renderer.js:20-84`：8 处 `changes.has('<key>')` + 约 30 处元素赋值 | 把"键 → 渲染函数"做成表（与 `options-events.js` 的声明式派发表同一形态），至少让清单集中在一处 |
| P2-7 | `DisplayManager` 是 100% 静态门面，而它包着的 `DisplayStateStore` 是可注入实例 | `src/content/display-manager.js:19-27`（4 个 `static` 字段 + `static stateStore`） | 半分层：门面保留（80 处调用方），但把 `stateStore` 改成模块级 `const` 而不是 `static`，避免类初始化的求值顺序依赖 |
| P2-8 | 元素状态有 3 份表示（WeakMap / `data-*` / `elementRegistry`）需要手工同步 | `src/content/display/display-state-store.js:24-36`（同时写 WeakMap 与 `dataset.foxlateState`）；`display-manager.js:81-84` 手动 delete 3 个 dataset | 保留（`data-*` 是 CSS 与"宿主页面残留检测"的契约），但把 3 个 dataset key 提成常量并集中清理 |
| P2-9 | `youtube-subtitle-strategy` 的 `withTabContext` 用动态 `import()` | `src/background/translator-engine-resolver.js:81` `const { extractTabContext } = await import('../common/context-extractor.js');` | iife 打包不产生 chunk（ledger 批 12 已对 readability 判过同一条），改回静态 import 省一个微任务；收益小，可与别的改动搭车 |
| P2-10 | `TranslatedContentLayoutService` / `summaryLayoutController` / `uiTextLayoutService` 三个"XxxLayoutService"命名同构但职责不同（一个测量文本盒、一个定位面板、一个给 popup 排版） | `src/content/layout/translated-content-layout-service.js:82`、`summary-layout-controller.js:272`、`src/common/ui-text-layout-service.js:79` | 命名区分（`…Measurer` / `…Positioner` / `…TextFit`），纯可读性收益 |

---

## 建议不要动的地方（附理由）

| 项 | 理由（含证据） |
|---|---|
| **`src/common/message-types.js` + handler map 组装 + 重复检测** | 45 个 wire 类型的值唯一、`DISPLAY_SELECTION_TRANSLATION` 之外无别名；`src/background/background-message-handlers.js:79-92` 对"两个域注册同一类型"直接抛错（不是静默覆盖）。这是全仓库唯一一处**主动失败**的组装逻辑。要改的只是"死类型"和 payload schema（P1-3），路由机制本身别碰。 |
| **`test/layering.test.mjs`** | 347 条边的全图 DFS 找环 + 跨层白名单 + "`strategies/` 只能从注册表装配"。它是本仓库唯一一条**结构性**门禁，实测真的挡住了历史上的 4 个环（ledger 批 12 G2）。只建议**扩展**（P0-5 的四条），不建议重写。 |
| **显示策略的注册表 + 声明式 `DISPLAY_MODES` 表** | 加一个显示模式的真实扇出是 3 个文件（`constants.js` 表项、新 `strategies/x.js`、`display-strategy-registry.js` 一行），popup/options 都从表里读（`src/options/ui-helpers.js:95`、`src/popup/popup-renderer.js:43`、`src/background/handlers/tab-handlers.js:64`）。这是"加第 5 个功能"里唯一已经做对的扩展点。 |
| **`translation-pipeline` / `translation-executor` / `single-translation` 的分工** | pipeline 决定"翻什么、键是什么"（97 行 / 5 方法，全部可单测），executor 决定"怎么翻、失败怎么办"（192 行 / 3 方法），`single-translation.js` 68 行只做编排。实测 `executeTranslation` CC 15 / 69 行——虽不短，但三个文件之间没有互相反向调用，职责边界是真的。 |
| **`InFlightRegistry`（50 行）与 `TranslationTaskScheduler`（128 行）** | 两者都是被测过的独立叶子（`test/translation-scheduler-scope.test.mjs`、`translator-manager-batch.test.mjs`），且都已在 `finally` 里自查清理（ledger K4 已裁决）。 |
| **`src/lib/browser-polyfill.js`（1224 行）** | vendor。它被 49 个模块 import（扇入第一），但它是**依赖叶子**且有 `layering.test.mjs:144` 守着不反向依赖。7 份副本是体积问题（P0-1），不是设计问题。 |
| **`translation-cache-store.js` 的 LRU + `scheduleSave` 的 `maxWait`** | 批 12 的 C10 已修"持续翻译永不落盘"，`#enforceLimit` 现在 `load()` 里也会调（K3）。没有新证据。 |
| **`src/common/text-measurement.js` 的 LRU 与 canvas 兜底策略** | 引擎可插拔 + 2 层 LRU 的设计是对的；问题只在 P0-1 的"每个 bundle 一份"。改实例归属，别改这个模块内部。 |

---

## 需要用户决策的取舍

### D1 设置形状：收敛成"只有 effective"还是"raw/effective 双轨但强命名"

| 选项 | 内容 | 代价 |
|---|---|---|
| **A（推荐）** | 只保留一个可跨边界流动的形状：**effective**。options 页为了编辑"全局默认值"，改读 `readStoredSettings`（明确命名、只在 options/background 内可用），跨进程一律 effective | 改 `resolveEffectiveSettings` 返回 `{settings, source}`（7 个测试用例）；popup 停止直接写，改走 `SAVE_RULE_CHANGE`（+1 往返，实测 popup 已有 3 次往返，可接受） |
| B | 保留双轨，但用两个**命名完全不同**的模块导出（`readStoredSettings` / `readEffectiveSettings`）+ 门禁禁止跨用 | 不动运行时语义，1 天；但"哪种形状"仍然是人的纪律，第 5 个功能仍可能拿错 |

### D2 `PageTranslationJob`：推倒重建 vs 渐进拆四个协作者

| 选项 | 内容 | 代价 |
|---|---|---|
| **A（推荐）** | 渐进：3 个协作者（InitialScanner / VisibilityScheduler / MutationScanner）逐个抽出，每步一个提交、现有 12 个用例全程保绿 | 3–4 天；中途会出现"半个 job + 两个协作者"的过渡态 |
| B | 重写：按"扫描 → 候选池 → 调度 → 派发"四段重写为新类，旧类只留适配 | 5–7 天，且 `page-translation-job.test.mjs` 的 12 个用例需要重写而非迁移；**风险**：后台标签页挂死、threshold 语义这类只有真浏览器能发现的行为，重写后需要重跑一遍浏览器级验证（1.7.8 的浏览器回路仍不稳定，见 ledger 批 14"说明"） |

### D3 是否把 `package.json` 改成 `"type": "module"`

| 选项 | 内容 | 代价 |
|---|---|---|
| **A（推荐）** | 加 `"type": "module"`，`build.js` → `build.cjs`（`build-entries.cjs` 已经是 .cjs），package.json 两行 scripts 改路径 | 一次性 1 天：27 个测试文件的 esbuild harness 可以删掉大部分（纯逻辑模块直接 `import`）；`test/doc-format.test.mjs`、`dependency-hygiene.test.mjs` 里对 `build.js` 的引用要改；AGENTS.md/tech-stack.md 4 处文档同步 |
| B | 保持 CJS 根，维持现状 | 0 成本；代价是每个纯函数测试都要过 esbuild（实测单文件 150–700ms），并且**无法**在 Node 里直接 `import('./src/common/math.js')`（实测报 `Unexpected token 'export'`） |

> 这条的收益不是墙钟时间（整套 8.1s，esbuild 占其中一小部分），而是**"能不能不打包就测一个纯函数"**。它同时是 P0-5 里四条新门禁的前置（门禁要读 `src` 的函数导出，而不是读源码文本）。

### D4 三个内容入口是否合并成单一 bundle

| 选项 | 内容 | 代价 |
|---|---|---|
| **A（推荐）** | 保持拆分（批 13 的成果：`content-script.js` 597→366.7 KB），用 P0-1 的注册表 + 注入互斥解决"多份单例" | 需要在注册表里逐条声明共享状态（约 6 项）；`textMeasurementService` 的引擎注册要下沉到共享 bootstrap（1 个新文件） |
| B | 合并回单包 | 摘要/字幕的 278 KB 回到冷路径（批 13 花了一整轮才移出去），且 P0-1 的"多份单例"问题自动消失。**不建议**，但这是唯一能让"单例真的是单例"的方案 |

---

## 实测数据附录

### A1 分层与文件规模（`find`/`cat` 实测）

| 层 | 文件 | 行数 | 占第一方 |
|---|---:|---:|---:|
| `src/background/` | 44 | 4116 | 21.7% |
| `src/content/` | 63 | 8926 | 47.1% |
| `src/common/` | 22 | 2294 | 12.1% |
| `src/options/` | 17 | 3112 | 16.4% |
| `src/popup/` | 6 | 498 | 2.6% |
| **第一方合计** | **152** | **18946** | 100% |
| `src/lib/`（vendor） | 4 | 4084 | — |

按功能目录（`src/content` 内部）：

| 目录 | 文件 | 行数 |
|---|---:|---:|
| `content/summary/` | 10 | 1992 |
| `content/subtitle/` | 9 | 961 |
| `content/layout/` | 6 | 779 |
| `content/tooltip/` | 6 | 546 |
| `content/strategies/` | 4 | 484 |
| `content/input/` | 3 | 299 |
| `content/display/` | 4 | 172 |
| `content/page-translation/` | 3 | 134 |
| `content/performance/` | 1 | 107 |
| **`content/` 根下（无归属）** | **17** | **3452** |
| `options/components/` | 6 | 1295 |
| `background/handlers/` | 12 | 790 |
| `background/translators/` | 5 | 471 |

### A2 依赖图（`.tmp/arch-audit/graph.mjs`，Tarjan SCC）

| 指标 | 实测 |
|---|---:|
| 节点（js/mjs） | 156 |
| 内部边 | **347** |
| 模块环（SCC size>1） | **0** |
| `common → 上层` 反向边 | **0** |
| 跨上层边（background↔content↔options↔popup） | **0** |
| `common → lib` 边 | 4（`context-extractor`、`i18n-dom`、`precheck`、`settings-manager`，全部指向 `browser-polyfill`） |
| 外部包 | 1（`@chenglou/pretext` → `src/content/layout/pretext-measurement-engine.js`） |
| 未被任何模块 import 的文件 | 9，**全部是合法入口/按 URL 加载的资源**（8 个 entry + `src/lib/franc.bundle.mjs`）→ 无死模块 |

扇出 / 扇入 Top：

| 出度 | 文件 | | 入度 | 文件 |
|---:|---|---|---:|---|
| 16 | `src/background/service-worker.js` | | 49 | `src/lib/browser-polyfill.js` |
| 16 | `src/content/content-runtime.js` | | 27 | `src/common/message-types.js` |
| 13 | `src/background/translation-runtime.js` | | 19 | `src/common/constants.js` |
| 10 | `src/options/options-app.js` | | 11 | `src/common/settings-manager.js` |
| 9 | `src/background/background-message-handlers.js` | | 9 | `src/common/escape.js` |
| 9 | `src/content/page-translation-job.js` | | 6 | `src/common/math.js` |
| 9 | `src/content/summary/summary.view.js` | | 6 | `src/content/content-logger.js` |

### A3 隐式耦合（`grep -rn` 实测）

| 通道 | 计数 | 说明 |
|---|---:|---|
| `window.<自定义属性>` 赋值 | 10 处 / 6 个键 | 隔离世界 6 处 5 键（`summaryModuleInstance`×2、`subtitleManager`、`foxlateContentScriptInitialized`、`getEffectiveSettings`、`__foxlate_css_injected`）；页面世界 4 处（`__foxlate_originals`×3、`window.fetch`） |
| `window.<自定义属性>` 属性访问（隔离世界） | **35** | `getEffectiveSettings` 12、`subtitleManager` 12、`summaryModuleInstance` 8、`foxlateContentScriptInitialized` 2、`__foxlate_css_injected` 1 |
| 同上（含页面世界 `__foxlate_originals`） | 45 | 后者在主世界注入函数内，属合法桥接 |
| `globalThis.__DEBUG__` | 4 处 | ledger D2 已修（现在真的生效） |
| `document.dispatchEvent(CustomEvent)` 内部总线 | 摘要 8 个事件名 / 2 个发射文件 / 1 个监听文件 | 见 P1-6 |
| `document.dispatchEvent` 主世界桥 | 1（`youtube-subtitle-strategy.js:110`） | 合法（页面世界拦截器） |
| `error.message.includes('Receiving end does not exist')` | 5 处（4 处不安全） | 见 P1-2 |
| `Object.keys(constants.…)` 表驱动 | 3 处（`DISPLAY_MODES` ×3） | 正向证据：这条扩展点是设计对的 |

### A4 圈复杂度 Top 10（自写掩码+花括号配平脚本，剔除嵌套、**排除 `??`**）

> 方法说明：先对源码做字符串/注释/模板/正则掩码，再按花括号配平取出每个函数体，统计 `if / else-if / for / while / do / case / catch / && / || / 三元`，并减去嵌套函数自身的决策点。`??` 与 `?.` **不计入**（它们不是分支，`DomainRuleModal#render` 若计入 `??` 会虚高到 37）。

| # | CC | 最大嵌套 | 行数 | 位置 | 函数 |
|---:|---:|---:|---:|---|---|
| 1 | 32 | 3 | 65 | `src/options/options-renderer.js:20-84` | `render` |
| 2 | 27 | 3 | 39 | `src/options/components/DomainRuleModal.js:65-103` | `#render` |
| 3 | 23 | 7 | 155 | `src/background/handlers/tab-handlers.js:9-163` | `createTabHandlers` |
| 4 | 22 | 5 | 177 | `src/background/translation-batch-runner.js:21-197` | `runTranslationBatch` |
| 5 | 21 | 2 | 24 | `src/content/summary/summary-error-messages.js:21-44` | `classifySummaryError` |
| 6 | 20 | 4 | 68 | `src/content/summary/summary.js:349-416` | `handleDialogAction` |
| 7 | 19 | 2 | 23 | `src/common/text-measurement.js:265-287` | `readTextStyle` |
| 8 | 18 | 5 | 78 | `src/options/options-state.js:8-85` | `rootReducer` |
| 9 | 18 | 5 | 50 | `src/common/settings-domain.js:26-75` | `validateSettings` |
| 10 | 16 | 4 | 79 | `src/content/layout/summary-layout-controller.js:183-261` | `#placeNearButton` |

**逐条裁决**（避免把"数据表/默认值链"误判为复杂度）：

- **#1、#2、#7 是假的**：主体是"逐字段赋值 + `??` 默认值链"，控制流只有 1–2 圈。真正的问题是 P2-6 的 dirty-key 手写清单。
- **#3 是数据表**（ledger J8 已裁决不改），本次同意：7 个平均 15 行的 handler 共享一个依赖包。
- **#4 是真的**（P1-1）。
- **#5 是查表型分派**（错误消息分类），可保留；#6 是 dialog action 分派，可保留。
- **#10 是真的分支密集**（面板定位：4 个方向 + 视口夹取 + 锚点回退），但它已有 `test/layout-services.test.mjs` 覆盖。

### A5 跨入口模块复制（自建 esbuild 产物 + `--metafile`）

| 入口 | 产物大小（未压缩，仅 src 模块） | 模块数 |
|---|---:|---:|
| `background/service-worker.js` | 209,206 B | 56 |
| `content/content-script.js` | 375,740 B | 61 |
| `content/summary/summary-entry.js` | 283,275 B | 26 |
| `content/subtitle/youtube-subtitle-strategy.js` | 54,835 B | 7 |
| `content/subtitle/subtitle-manager.js` | 41,163 B | 7 |
| `content/subtitle/bilibili-subtitle-strategy.js` | 5,338 B | 3 |
| `options/options.js` | 218,103 B | 34 |
| `popup/popup.js` | 99,843 B | 20 |

| 指标 | 实测 |
|---|---:|
| 出现在 >1 个入口的模块 | 26 |
| 重复字节总量（多份副本之和） | **359,232 B（350.8 KB）** |
| **内容侧**重复（content-script + summary + 2 策略） | **143,579 B（140.2 KB）**，13 个模块 |

内容侧重复明细：

| 字节 | 份数 | 模块 |
|---:|---:|---|
| 32,328 | 4 | `src/lib/browser-polyfill.js` |
| 12,972 | 2 | `src/common/text-measurement.js` |
| 8,329 | 2 | `src/content/layout/resize-controller.js` |
| 7,975 | 2 | `src/common/constants.js` |
| 5,015 | 2 | `src/content/layout/floating-layout-service.js` |
| 2,954 | 4 | `src/common/message-types.js` |
| 582 | 2 | `src/content/content-settings-client.js` |
| 545 | 2 | `src/common/text-join.js` |
| 414 | 2 | `src/common/timing.js` |
| 386 | 4 | `src/content/content-logger.js` |
| 295 | 2 | `src/content/layout/viewport.js` |
| 293 | 2 | `src/common/escape.js` |
| 155 | 2 | `src/common/math.js` |

产物级交叉验证：`grep -c 'pretext'` → `content-script.js` 20、`summary-entry.js` **0**；`grep -c 'canvasMeasurementEngine'` → `content-script.js` 4、`summary-entry.js` 3。

### A6 设置形状（`src/common/constants.js` 的 `DEFAULT_SETTINGS`）

16 个顶层键：`translatorEngine`、`targetLanguage`、`displayMode`、`translateAfterScrollIdle`、`scrollIdleDelayMs`、`deeplxApiUrl`、`translationSelector`、`aiEngines`、`domainRules`、`cacheSize`、`parallelRequests`、`summarySettings`、`glossary`、`quickActionPanel`、`syncEnabled`、`inputTranslationSettings`。

注意：**`subtitleSettings` 不在其中**（字幕完全靠域名规则 + 内置 host 表派生），而 `resolveEffectiveSettings` 会**无条件**产出一个 `subtitleSettings`（`settings-domain.js:168`）。这是"两种形状"最尖锐的一处：`raw.subtitleSettings` 不存在，`effective.subtitleSettings` 一定存在。

`resolveEffectiveSettings` 额外注入的键：`source`（`settings-domain.js:152`）。

### A7 测试与门禁

| 指标 | 实测 |
|---|---:|
| 测试文件 | 56（13087 行） |
| 用例 | 464 pass / 0 fail |
| 总耗时 | 8,126 ms（`node --test`，Node v26.13.1） |
| 用 esbuild 打包的测试文件 | **27** |
| 用 jsdom 的测试文件 | 18 |
| 自建 esbuild harness（未用 `test/helpers/bundle.mjs`） | **25** 个文件 |
| `await build(` 调用点 | 28 |
| `assert.match / doesNotMatch` | **108** |
| 其中三个"架构"文件占比 | `content-runtime-architecture` 21 + `options-architecture` 13 + `core-defaults` 13 = 47 |

单文件墙钟（`node --test <file>`）：`page-translation-job` 677ms、`layering` 207ms、`object-utils` 176ms、`tab-state-manager` 152ms、`design-system` 143ms。

### A8 协议表（45 个 wire 类型）

| 分类 | 数量 | 说明 |
|---|---:|---|
| 后台入站 | 31 | `test/message-types.test.mjs` 的 `BACKGROUND_INBOUND_TYPES` |
| 内容侧入站 | 10 | 同上 `CONTENT_INBOUND_TYPES` |
| 后台推送 | 5 | 同上 `BACKGROUND_PUSH_TYPES` |
| **有发送方（脚本可检出）** | 34 | `.tmp/arch-audit/payloads3.mjs` |
| **无任何发送方（死）** | **5** | `SAVE_RULE_CHANGE`、`GET_VALIDATED_SETTINGS`、`TOGGLE_SUBTITLE_TRANSLATION`、`DISPLAY_SELECTION_TRANSLATION`、`REVERT_PAGE_TRANSLATION` |
| 接收方只原样转交 payload | 14 | 字段契约实际藏在第三个模块 |
| 两端字段名一致的（可检出） | 全部 | 当前**无漂移**；一致性靠人，无 schema |

### A9 模块级实例清单（15 个）

`export default new X()`（6）：

| 位置 | 实例 |
|---|---|
| `src/background/tab-state-manager.js:263` | `TabStateManager` |
| `src/content/strategies/replace-strategy.js:95` | `ReplaceStrategy` |
| `src/content/strategies/append-strategy.js:107` | `AppendStrategy` |
| `src/content/strategies/hover-strategy.js:133` | `HoverStrategy` |
| `src/content/strategies/enhanced-context-menu-strategy.js:150` | `EnhancedContextMenuStrategy` |
| `src/content/enhanced-tooltip-manager.js:324` | `EnhancedTooltipManager` |

`export const x = new X()`（9）：

| 位置 | 实例 | 被打进几个 bundle |
|---|---|---:|
| `src/common/ui-text-layout-service.js:79` | `uiTextLayoutService` | 2（options, popup） |
| `src/common/text-measurement.js:406` | `textMeasurementService` | **4** |
| `src/background/translation-product-stores.js:162-164` | `translationHistoryStore` / `translationFailureQueue` / `providerHealthStore` | 1 |
| `src/content/display/display-strategy-registry.js:50` | `defaultDisplayStrategyRegistry` | 1 |
| `src/content/layout/translated-content-layout-service.js:82` | `translatedContentLayoutService` | 1 |
| `src/content/layout/floating-layout-service.js:138` | `floatingLayoutService` | 2 |
| `src/content/layout/summary-layout-controller.js:272` | `summaryLayoutController` | 1 |

另有 1 个模块级可变数据容器：`src/content/display/element-state-map.js:13` `export const elementStates = new WeakMap();`（1 个 bundle，安全）。

**只有 `textMeasurementService` 的重复造成了功能性差异**（引擎 + 缓存；证据：`grep -c pretext` → `content-script.js` 20 / `summary-entry.js` 0），其余重复是体积问题。这个结论要说清楚：不要因为"单例假了"就把 15 个全部重构，只需处理被打进 >1 个 bundle 的那 4 个。

### A10 双注入复现记录

命令：`node .tmp/arch-audit/inject/probe.mjs`、`node .tmp/arch-audit/inject/probe-summary.mjs`
方法：把 `src/content/subtitle/subtitle-manager.js` 与 `src/content/summary/summary-entry.js` 各打成两份独立 ESM bundle（`browser-polyfill` 替换为读 `globalThis.__mockBrowser` 的转接层），按两次注入顺序求值，统计 `runtime.onMessage` 监听器数量与应答。

```
# subtitle-manager ×2
separate module instances: true
window.subtitleManager overwritten by 2nd injection: true
runtime.onMessage listeners after 2 injections: 2
one status request -> responses: [{"isSupported":false,"isEnabled":false},{"isSupported":true,"isEnabled":true}]
first response wins in WebExtensions dispatch => popup sees: {"isSupported":false,"isEnabled":false}

# summary-entry ×2
TOGGLE_SUMMARY_REQUEST listeners after 1 injection: 1
after 2 injections: 2
```

边界：以上证明"二次注入后会发生什么"；"二次注入是否必然发生"取决于 P0-1 证据 4 的并发窗口，该窗口**未在真浏览器实测**。

---

## 附：本报告与 refactor-ledger 的关系

| ledger 已裁决项 | 本报告立场 |
|---|---|
| E5（`SettingsManager` 静态块注册 `storage.onChanged`）WONTFIX | **同意并加强**：P0-3 的方案把"唯一通知通道"这个语义抄进 `settings-contract.js` 的注释，不再依赖读者去读 `settings-manager.js:26`。 |
| J8（`options-elements` / `tab-handlers` / `options-events` 偏长）不改 | **同意**。A4 的 #3 复测确认其 CC 来自数据表。 |
| K4（`#activeTasks` / `#taskQueue` / `#inFlightRequests`）正确 | **同意**。新增的 `ensureScriptsInjected` 并发问题不属于这一类（它是"读-执行-写"而非"任务表"）。 |
| L（协议层质量最高，不要动） | **部分修正**：路由机制确实最好（含唯一一处主动失败），但"最佳"不等于"有契约"——5 个死类型与零 schema 是 L 节未覆盖的维度。 |
| 批 13（摘要按需注入） | **同意其架构判断**，但指出拆分引入了"两个 bundle 各一份 common 单例"这一新问题（P0-1），当时未评估。 |
