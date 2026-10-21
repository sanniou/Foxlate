# Project Context — Foxlate

> Mapped 2026-07-22 from live codebase (v1.6.0). Stack/table refresh 2026-10; test counts in this file are a snapshot, not a contract.
> 本文件是**架构参考**（栈选择、模块职责、契约、约定）。架构演进史与已修缺陷见
> `specs/verifications/full-refactor-review-1.7.4.md` 与 `specs/verifications/refactor-ledger.md`。

## Stack

| Layer | Choice |
|-------|--------|
| Language | JavaScript ESM in `src/`; package root `"type": "commonjs"` |
| UI | Plain DOM + `BaseComponent` subclasses (popup and options alike); **no UI framework** |
| Build | Custom `build.js` + esbuild; targets `chrome` / `firefox` |
| Extension API | MV3 + vendored `webextension-polyfill` (`src/lib/browser-polyfill.js`) |
| Text | `node --test` + jsdom (`test/*.test.mjs`) — 45 个文件 / 372 pass |
| Markdown | `marked.esm.js` (summary) |
| Extraction | Mozilla Readability (summary) |
| Lang detect | `franc.bundle.mjs` |
| Text measure | `@chenglou/pretext` + canvas fallbacks |
| Locales | `public/_locales/{en,zh_CN}` |

**Deps (runtime):** `@chenglou/pretext`

> A vendored `lit@3.3.1` bundle and the `lit` npm dependency were removed in the 2026-10 refactor: nothing
> imported either one. `SCOPE_LATEST.yaml` lists "Lit rewrite of popup/options" as out of scope — the vendored
> bundle was a leftover from that rejected direction, not a shipped stack choice.  
**Deps (dev):** `esbuild`, `fs-extra`, `glob`, `jsdom`

No TypeScript. No bundler beyond esbuild entry points. No dedicated linter/formatter yet.

## Architecture

**Pattern:** Feature-oriented modules + message-bus between extension contexts.

```
popup / options  ──MSG──►  background (service worker)
                              │  TranslatorManager + engines
                              │  SettingsManager + domain resolve
                              │  TabState / cache / product stores
                              ▼
                         content-script runtime
                              │  PageTranslationJob
                              │  Display strategies (replace/append/hover)
                              │  Tooltip / Summary / Subtitle / Input
```

### Entry points
| Context | Entry |
|---------|-------|
| Background | `src/background/service-worker.js` |
| Content | `src/content/content-script.js` → `content-runtime.js` |
| Popup | `src/popup/popup.js` → thin bootstrap |
| Options | `src/options/options.js` → thin bootstrap |
| Build | `build.js` (manifest rewrite per target) |

### Key modules
- **Messaging:** `src/common/message-types.js` frozen string enum; handlers as maps in `createBackgroundMessageHandlers` / `createContentMessageHandlers`
- **Settings:** `DEFAULT_SETTINGS` in `constants.js` → `settings-domain.js` (validate/merge/effective) → `SettingsManager` (storage)
- **Translation:** `TranslatorManager` + `BaseTranslator` subclasses (`google`, `deeplx`, `ai`)
- **Page job:** `PageTranslationJob` + DOM walker/reconstructor + batch queue + scroll-idle
- **Display:** strategy registry (replace / append / hover) + state store
- **Product stores:** history, failure queue, provider health (bounded lists)
- **UI architecture:** reducer-ish state + actions + renderer + events (popup & options)

### Data flow (page translate)
1. Popup/command → background toggle/status
2. Content starts `PageTranslationJob`
3. Discover elements → batch `TRANSLATE_TEXT_BATCH` → background engines
4. Results → display strategy applies DOM mutations
5. Status badges via `TRANSLATION_STATUS_UPDATE`

## Conventions (Observed)

### Error handling
- Local `try/catch` at I/O boundaries; `logBackgroundError` / content `logError`
- Abort via `DOMException('…', 'AbortError')` for user-cancelled translation
- Batch AI: per-item errors without single-item fallback on total batch failure; one retry for retryable failures
- Message sends often `.catch(() => {})` when receiver may be gone (SW / closed tab)

### API shapes
- Internal RPC: `{ type: MESSAGE_TYPES.*, payload }`
- Engine result shape: `{ text, log[] }` (BaseTranslator contract)
- Settings: nested plain objects; deep-merge on validate; domain rules keyed by hostname with timestamps

### Type safety
- None (JS). Contracts enforced by tests and runtime checks (`texts` must be array, etc.)

### Observability
- `globalThis.__DEBUG__` gated logs in SW / content
- Provider health store + translation history (product panel)
- Optional performance HUD under content

### Testing
- Architecture tests assert module boundaries (bootstrap stays thin, registries own X)
- Domain tests for settings, glossary, product stores, batch translate
- jsdom for DOM walker / layout services
- **No e2e / browser automation** in repo yet

### UI / design
- 令牌唯一取值来源：`src/common/tokens.css`（`--fox-*`）；`src/common/common.css` 只写语义别名（`--color-*` → `--fox-color-*`）
- 动效 / 排版 / 无障碍三态（reduced-motion / reduced-transparency / prefers-contrast）的取值也在 `tokens.css`
- Dark via `prefers-color-scheme`
- Semantic classes: `.btn`, `.card`, `.form-control`, `.input-group`, `.switch`
- 内容侧（tooltip/summary/subtitle）与 popup/options 共用同一套 `--fox-*`（已统一；内容侧另有 `--fl-*`/`--fs-*` 宿主隔离前缀）
- 门禁：`test/design-system.test.mjs`

## Signals / Active Considerations

只列**当前仍未解决**的信号。已解决的历史信号（版本三元 SoT、MD3 残留、大型文件、内容 CSS 未对齐）不再保留 —— 已完成待办不属参考文档。

| Signal | Severity | Implication |
|--------|----------|-------------|
| Chrome 已能构建但商店仍标 "coming soon" | P1 product | R2 触达：素材 + 隐私说明 + 权限解释 |
| SW lifecycle differences Chrome vs Firefox | P1 for R2 | re-injection / idle SW 测试仍缺 |
| R3 差异化能力未择一 | P1 product | 原生 Translator API 引擎 vs 独立面板（见 SCOPE `open_decisions`） |
| No linter / typecheck | P2 | Preflight is test+build only |
| No e2e / browser automation | P2 | 需人工冒烟；产物级回归靠 jsdom 集成测试 |
| AI cost path already has short-text fallback | good | keep for new engines |

## Build notes

- `build.js --target=chrome` → `service_worker` field
- `build.js --target=firefox` → `scripts` + `type: module`
- Vendored libs checked/downloaded via `npm run check`
