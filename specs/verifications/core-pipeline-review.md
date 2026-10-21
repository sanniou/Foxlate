# Core Pipeline Review — 元素提取 · 翻译链路 · 事件分发 · 设置域

**Date:** 2026-07-22  
**Branch:** `feat/e06-ui-redesign` (core strategy R1)  
**Scope:** architecture / correctness — not UI chrome  

## R1 shipped

| Fix | Files |
|-----|-------|
| Domain rule **whitelist merge** (no flatten pollution of aiEngines/glossary) | `src/common/settings-domain.js` |
| Domain `translationSelector` (+ override) **alias** for `cssSelector` | `src/common/settings-domain.js` |
| `setDomainRuleProperty` rejects non-writable keys | `src/common/settings-domain.js` |
| Content single/batch translate **no GET_TAB_ID hop** | `src/content/element-translation-controller.js`, `src/content/translation-batch-queue.js` |
| `findTranslatableElements(..., { skipFallback })` — no `__skipFallback` on settings | `src/content/translatable-elements.js` |
| Empty initial scan → `emptyCandidates` on status + progress | `src/content/page-translation-job.js` |
| Message protocol comments (TEXT / TEXT_BATCH / BATCH) | `src/common/message-types.js` |

## Tests

- settings-domain: whitelist pollution, translationSelector alias, ignore junk write
- content-runtime: batch queue single message (no GET_TAB_ID)
- page-translation-job: emptyCandidates on zero-element start
- Full suite at review time: **92 pass**

## Residual（当时遗留；现仍未解决）

| Sev | Item |
|-----|------|
| P2 | 存量规则在 validate 时由 `cssSelector` 迁移到 `translationSelector` |
| P2 | 孤立 `foxlate-wrapper` 回滚集成测试 |
| P3 | 线上协议名 `translateInputText` 重命名（破坏性 — 暂缓） |

（原列的「popup toast on emptyCandidates」已落地：`src/popup/popup-actions.js` 已消费 `response.emptyCandidates`；
「合并 TOGGLE/UPDATE_DISPLAY_MODE 命名」已判定为非缺陷 —— 二者是不同跳：`TOGGLE_DISPLAY_MODE` 是 popup/命令 → SW，
`UPDATE_DISPLAY_MODE` 是 SW → content，已在 `src/common/message-types.js` 注明。）

## Architecture (post-R1)

```
resolveEffectiveSettings:
  base = { ...global, source }
  + whitelist scalars from domain rule
  + 'default' sentinel → global
  + selector = translationSelector || cssSelector (legacy)
  + subtitle separately
  // never flatten entire domainRule
```

```
translate element:
  displayLoading → TRANSLATE_TEXT | TRANSLATE_TEXT_BATCH
  SW originTabId = sender.tab.id || payload.tabId
  // no content→GET_TAB_ID round trip
```
