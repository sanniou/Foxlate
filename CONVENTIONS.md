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
| Epic detail | `specs/epics/eNN-*.yaml` |
| Bugs | `specs/bugs/` |

`workflow_mode` in `state.yaml` is `solo-git`.

## Defensive Code Categories (this project)

| Category | Applies? | Notes |
|----------|----------|-------|
| Retry | **Yes** | Translator batch retry (`TranslationRetryController`) |
| Timeout | **Yes** | Network calls to translation APIs |
| Graceful degradation | **Yes** | AI short-text fallback to cheaper engine; offline/cache paths |
| Rate limit | Optional | Provider health store exists; expand if abuse appears |
| Circuit breaker | Optional | Provider health can seed this later |

## Project-specific conventions

- Tokens: `--fox-*` in `src/common/common.css` only.
- UI class names: semantic (`.btn`, `.card`, …), not `.m3-*`.
- Do not hand-edit `dist/`.
- `plans/archive/*` is obsolete design history.
- Keep content-script injection surface minimal; prefer existing inject lists in `background-constants.js`.
- Prefer pure modules + thin browser-API adapters for testability (`node --test` + jsdom where needed).

## File-Size Guidance

Prefer modules under ~300 lines. Existing large files (`translator-manager.js`, `options-actions.js`, `background-message-handlers.js`) are known hotspots — boy-scout when touched, no big-bang rewrite unless planned.
