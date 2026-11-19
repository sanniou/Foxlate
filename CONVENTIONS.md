# Conventions

## Conventional Commits & Semantic Versioning

All changes MUST follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). Versioning follows [Semantic Versioning 2.0.0](https://semver.org/).

### Commit Message Format
`<type>(<scope>): <description>` (space after colon is mandatory)

### Types & Version Bumps
- `feat`: Minor (x.Y.z)
- `fix`: Patch (x.y.Z)
- `perf`: Patch (x.y.Z)
- `docs`, `chore`, `style`, `refactor`, `test`: no bump (unless breaking)
- `BREAKING CHANGE:` / `!`: Major (X.y.z)

## GitHub & Git Operations

- No direct work on `main`. Start every task with `kickoff-branch`.
- **Integrate (solo-git):** `bash scripts/land-branch.sh <branch> "<conventional message>"` after `release-branch` gates — or equivalent local squash + push. PR optional.
- Never push to `main` except via land path (`GIT_BIGPOWERS_LAND=1` when using land-branch).
- Never include AI `Co-authored-by` footers.
- Never create GitHub issues from agents — write `specs/bugs/BUG-*.md` instead.

## Agent Workflow Mandates

- No direct coding of features from a raw user prompt — route through bigpowers skills.
- Start with `survey-context` when context is missing.
- Plan in `specs/epics/` with `verify:` per task before feature code.
- Bugs go through `investigate-bug` before a fix.
- Every story ends with a manual verification script; wait for UAT before "done".
- Tag implementing code/tests with `// story: eNNsNN`.

## Always Green / Shift Left

Preflight and CI are green before forward work.

**Preflight** (this project): `npm test && npm run build:firefox && npm run build:chrome`

Red Preflight blocks kickoff / develop / verify until fix-or-log produces green.

## Discovered Defects

Reproducible gate failures are defects, not background noise.

1. **quick-fix** — trivial / data-only / single-file
2. **fix-bug** — needs investigation (`specs/bugs/BUG-*.md` + TDD)
3. **Log** — only when repro is blocked; stop forward work until triaged

Discovered fixes: same branch, **separate commits**. Never narrate a failure and continue.

### Banned dismissive phrases

| Banned | Required |
|--------|----------|
| pre-existing | fix-or-log |
| unrelated to this session | same |
| not introduced by my changes | bisect or fix |
| out of scope (red gate) | quick-fix or fix-bug |

## specs/ — All Planning Output Goes Here

| Layer | File |
|-------|------|
| Session | `specs/state.yaml` |
| Release index | `specs/release-plan.yaml` |
| Progress | `specs/execution-status.yaml` |
| Intent | `specs/product/SCOPE_LATEST.yaml` |
| Epic detail | `specs/epics/<capsule>/epic.yaml`（完成后移入 `epics/archive/`） |
| Bugs | `specs/bugs/` |
| Review / UAT 记录 | `specs/verifications/` |

`workflow_mode` in `state.yaml` is `solo-git`. 形状契约由 `test/planning-state.test.mjs` 强制。

## Defensive Code Categories (this project)

| Category | Applies? | Notes |
|----------|----------|-------|
| Retry | **Yes** | Translator batch retry (`TranslationRetryController`) |
| Timeout | **Yes** | Network calls to translation APIs |
| Graceful degradation | **Yes** | AI short-text fallback to cheaper engine; offline/cache paths |
| Rate limit | Optional | Provider health store exists; expand if abuse appears |
| Circuit breaker | Optional | Provider health can seed this later |

## Project-specific conventions

- **设计令牌**：唯一取值来源是 `src/common/tokens.css`；`src/common/common.css` 只写语义别名（`--color-*` → `--fox-color-*`）。组件不得写颜色/尺寸/时长/字体栈字面量。由 `test/design-system.test.mjs` 强制。
- **无障碍三态**：reduced-motion / reduced-transparency / prefers-contrast 的取值也在 `tokens.css`，组件不得自行加 `!important` 覆盖。
- UI class names: semantic (`.btn`, `.card`, …), not `.m3-*`.
- Do not hand-edit `dist/`.
- pre-1.6.0 indigo MD3 设计草案已删除，不再存在 —— 不得重建或参考。
- Keep content-script injection surface minimal; prefer existing inject lists in `background-constants.js`.
- Prefer pure modules + thin browser-API adapters for testability (`node --test` + jsdom where needed).

## File-Size Guidance

Prefer modules under ~300 lines. `src/lib/*` 是 vendored 第三方代码，不适用此规则。

当前超过 300 行的第一方文件（18 个，`wc -l` 实测；不含 `src/lib`）：

| 文件 | 行数 |
|------|-----:|
| `src/content/summary/summary.css` | 733 |
| `src/common/common.css` | 720 |
| `src/content/page-translation-job.js` | 692 |
| `src/options/options-actions.js` | 632 |
| `src/content/summary/summary.view.js` | 623 |
| `src/options/options.css` | 607 |
| `src/content/summary/summary.js` | 485 |
| `src/content/style.css` | 465 |
| `src/popup/popup.css` | 412 |
| `src/options/components/AIEngineModal.js` | 408 |
| `src/common/text-measurement.js` | 406 |
| `src/content/dom-walker.js` | 398 |
| `src/content/content-runtime.js` | 385 |
| `src/content/subtitle/youtube-subtitle-strategy.js` | 352 |
| `src/options/components/DomainRuleModal.js` | 339 |
| `src/common/settings-domain.js` | 336 |
| `src/content/enhanced-tooltip-manager.js` | 324 |
| `src/content/input-handler.js` | 307 |

Boy-scout when touched — no big-bang rewrite unless planned.
