# Project Context — Foxlate

> Mapped 2026-07-22 from live codebase (v1.6.0). Refresh after major refactors.

## Stack

| Layer | Choice |
|-------|--------|
| Language | JavaScript ESM in `src/`; package root `"type": "commonjs"` |
| UI | Lit 3 (options modals/components); plain DOM for popup |
| Build | Custom `build.js` + esbuild; targets `chrome` / `firefox` |
| Extension API | MV3 + vendored `webextension-polyfill` (`src/lib/browser-polyfill.js`) |
| Text | `node --test` + jsdom (`test/*.test.mjs`) — **79 pass** at map time |
| Markdown | `marked.esm.js` (summary) |
| Extraction | Mozilla Readability (summary) |
| Lang detect | `franc.bundle.mjs` |
| Text measure | `@chenglou/pretext` + canvas fallbacks |
| Locales | `public/_locales/{en,zh_CN}` |

**Deps (runtime):** `lit`, `@chenglou/pretext`  
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
- Live tokens: `--fox-*` + semantic `--color-*` aliases in `src/common/common.css`
- Dark via `prefers-color-scheme`
- Semantic classes: `.btn`, `.card`, `.form-control`, `.input-group`, `.switch`
- Content surfaces (tooltip/summary/subtitle) have **separate CSS** — partial token alignment

## Signals / Active Considerations

| Signal | Severity | Implication |
|--------|----------|-------------|
| Version triple source (`package.json` 1.6.0, `manifest.base` 1.3.0, dist built) | P1 | R1: single SoT |
| `.m3-form-field` leftovers in `options/validator.js` | P3 | R1 cleanup |
| Large files: `options-actions.js` (~25k), `background-message-handlers.js` (~22k), `translator-manager.js` (~18k), `options.html` (~31k) | P2 | boy-scout only |
| Chrome listed "coming soon" but build target works | P1 product | R2 store reach |
| Content CSS not fully on `--fox-*` | P2 | R1 token pass |
| No linter / typecheck | P2 | Preflight is test+build only |
| `plans/archive/*` obsolete vs live UI | info | do not implement from drafts |
| SW lifecycle differences Chrome vs Firefox | P1 for R2 | re-injection / idle SW tests needed |
| AI cost path already has short-text fallback | good | keep for new engines |

## Build notes

- `build.js --target=chrome` → `service_worker` field
- `build.js --target=firefox` → `scripts` + `type: module`
- Vendored libs checked/downloaded via `npm run check`
