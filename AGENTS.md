# Foxlate — AI Agents

Read CONVENTIONS.md before any GitHub or git operation.

<!-- BEGIN bigpowers:project -->
## Project

Browser extension for seamless webpage translation (selection, page, input, subtitles, AI summary). Firefox-first; Chrome build exists.

Stack: JavaScript (ESM) · Lit 3 · esbuild · WebExtensions MV3 · node:test · CommonJS package root

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
| Lint | _(none — no dedicated linter yet)_ |
| Preflight | `npm test && npm run build:firefox && npm run build:chrome` |
| CI | `gh pr checks` (when a PR is open) |

## Architecture

- `src/background/` — service worker, translator engines, tab state, cache, cloud backup
- `src/content/` — page translation job, display strategies, tooltip, summary, subtitles, input
- `src/popup/` / `src/options/` — extension UI (bootstrap → app → state/actions/renderer)
- `src/common/` — shared design tokens (`--fox-*` in `common.css`) and utilities
- `build.js` — esbuild pipeline; rewrites manifest for chrome vs firefox
- `public/` — manifest base, icons, locales (`en`, `zh_CN`)

## Conventions

- Design tokens live in `src/common/common.css` as `--fox-*` (and semantic `--color-*` aliases). Do not reintroduce Material/MD3 class names.
- `plans/archive/` holds obsolete pre-1.6.0 design drafts — never implement from them.
- Popup/options use semantic classes: `.btn`, `.card`, `.form-control`, `.input-group`, `.switch`.
- Feature modules under `src/content/<feature>/` stay focused; entry points stay thin bootstraps.
- Tests: `node --test` in `test/*.test.mjs`. Prefer architecture/behavior tests over snapshot UI tests.
- Version source of truth: `package.json` → build injects into dist manifest.
- Integrate mode: **solo-git** (`specs/state.yaml` `workflow_mode: solo-git`).

## Never

- Never dismiss reproducible gate failures as pre-existing or out of scope
- Never proceed on red Preflight — invoke quick-fix or fix-bug first
- Never edit `dist/` by hand — always rebuild
- Never implement UI from `plans/archive/*` (stale indigo MD3 drafts)
- Never add a new design-token system alongside `--fox-*`
- Never push directly to `main` except via `land-branch.sh`
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

- Live design system is cyan/glass `--fox-*` (shipped in 1.6.0), not the indigo drafts in `plans/archive/`
- Chrome build target exists; store listing still "coming soon"
- Tests: 79 pass baseline at seed time
<!-- END bigpowers:learned-preferences -->
