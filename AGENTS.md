# Foxlate — AI Agents

Read CONVENTIONS.md before any GitHub or git operation.

<!-- BEGIN bigpowers:project -->
## Project

Browser extension for seamless webpage translation (selection, page, input, subtitles, AI summary). Firefox-first; Chrome build exists.

Stack: JavaScript (ESM) · plain DOM (no UI framework) · esbuild · WebExtensions MV3 · node:test · CommonJS package root

## Commands

| Action | Command |
|--------|---------|
| Install | `npm install` |
| Test | `npm test` |
| Build (Firefox) | `npm run build:firefox` |
| Build (Chrome) | `npm run build:chrome` |
| Watch (Chrome) | `npm run watch:chrome` |
| Watch (Firefox) | `npm run watch:firefox` |
| Check deps | `npm run check` |
| Package (Firefox) | `npm run package:firefox` |
| Lint | _(none — no dedicated linter yet)_ |
| Preflight | `npm test && npm run build:firefox && npm run build:chrome` |
| CI | `gh pr checks` (when a PR is open) |

## Architecture

- `src/background/` — service worker, translator engines, tab state, cache, cloud backup
- `src/content/` — page translation job, display strategies, tooltip, summary, subtitles, input
- `src/popup/` / `src/options/` — extension UI (bootstrap → app → state/actions/renderer)
- `src/common/` — design tokens (`tokens.css` = 取值，`common.css` = 语义别名) and utilities
- `src/common/design/` — 动效/排版常量与无障碍策略的单一来源
- `build.js` — esbuild pipeline; rewrites manifest for chrome vs firefox
- `public/` — manifest base, icons, locales (`en`, `zh_CN`)

## Conventions

- 设计令牌的唯一取值来源是 `src/common/tokens.css`（`--fox-*`）。`src/common/common.css` 只允许写语义别名（`--color-*` → `--fox-color-*`），不得直接写颜色/尺寸字面量。不得引入第二套令牌体系，不得用 Material/MD3 类名。
- 动效、排版、无障碍三态（reduced-motion / reduced-transparency / prefers-contrast）的取值同样只在 `tokens.css`；组件不得写死时长或字体栈。
- 已废弃的 pre-1.6.0 indigo MD3 设计草案已删除 —— 不要重建、不要参考、不要实现。
- Popup/options use semantic classes: `.btn`, `.card`, `.form-control`, `.input-group`, `.switch`.
- Feature modules under `src/content/<feature>/` stay focused; entry points stay thin bootstraps.
- Tests: `node --test` in `test/*.test.mjs`. Prefer architecture/behavior tests over snapshot UI tests. A regression test earns its place by going red on the old code — verify by reverting the fix, not by trusting the assertion.
- Docs: `specs/` is the planning cockpit — `execution-status.yaml` is the only status store; epic files are plan-time snapshots. `specs/verifications/refactor-ledger.md` is the authoritative list of every defect found and fixed; the review report is `specs/verifications/full-refactor-review-1.7.4.md`. `test/doc-format.test.mjs` gates doc formatting.
- Version source of truth: `package.json` → build injects into dist manifest.
- Integrate mode: **solo-git** (`specs/state.yaml` `workflow_mode: solo-git`).

## Never

- Never dismiss reproducible gate failures as pre-existing or out of scope
- Never proceed on red Preflight — invoke quick-fix or fix-bug first
- Never edit `dist/` by hand — always rebuild
- Never reintroduce the pre-1.6.0 indigo MD3 design direction (rejected; the cyan/glass `--fox-*` system is live)
- Never add a new design-token system alongside `--fox-*`
- Never push directly to `main` except via `land-branch.sh`
- Never ship design sources (`.psd`, `.ai`, `.xcf`) or `.md` in the store package — `source-artifact-ignore` in build.js enforces this; `package-firefox.sh` re-checks before zipping
- Never create GitHub issues from agent workflows — use `specs/bugs/`
- Never attribute commits to AI agents (`Co-authored-by`, etc.)

## Agent Rules

- **Workflow Mandate:** Use bigpowers skills (`plan-work`, `develop-tdd`, `orchestrate-project`, …). Do not freestyle feature code from a raw "build X" prompt.
- **Always Green:** Preflight must be green before forward work.
- Read `specs/` before writing code. Plans go to `specs/` before implementation.
- Write the minimum code that solves the stated problem.
- Run tests after every change. Show evidence before declaring done.
- One clarifying question beats a wrong assumption.
<!-- END bigpowers:project -->

<!-- BEGIN bigpowers:context-routing -->
## Context routing

| Glob | Notes |
|------|-------|
| `src/background/**` | Translators, SW lifecycle, injection, product stores |
| `src/content/**` | Page translation, display, tooltip, summary, subtitles |
| `src/popup/**`, `src/options/**` | Extension chrome UI |
| `src/common/**` | Shared tokens and helpers |
| `test/**` | node:test suite |
| `specs/**` | Planning cockpit — YAML is SoT |
<!-- END bigpowers:context-routing -->

<!-- BEGIN bigpowers:learned-preferences -->
## Learned User Preferences

- Prefer solo-git integrate (no PR ceremony by default)
- Product route locked: R1 stabilize → R2 Chrome reach → R3 one differentiator

## Workspace Facts

- Live design system is cyan/glass `--fox-*`（1.6.0 起）——取值在 `src/common/tokens.css`，语义别名在 `src/common/common.css`
- Chrome build target exists; store listing still "coming soon"
- Tests: `npm test` → 375 pass（43 个测试文件）
<!-- END bigpowers:learned-preferences -->
