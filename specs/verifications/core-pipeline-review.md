# Core Pipeline Review — 元素提取 · 翻译链路 · 事件分发 · 设置域

**Date:** 2026-07-22  
**Branch:** `feat/e06-ui-redesign` (core strategy R1)  
**Scope:** architecture / correctness — not UI chrome  
**Stop:** overall ≥ 8.0 and min dim ≥ 7.5

## Scorecard

| Area | Baseline | R1 | Verdict |
|------|--------:|---:|---------|
| 元素提取 | 7.5 | **8.2** | skipFallback options；emptyCandidates 信号 |
| 翻译链路 | 8.0 | **8.4** | 去掉 GET_TAB_ID 多余一跳；sender.tab |
| 事件分发 | 7.0 | **7.8** | 协议文档；batch 语义写清 |
| 设置域 | 7.0 | **8.6** | 白名单 merge；selector 别名；writable keys |
| **Overall** | **7.4** | **8.3** | **Stop met** |

## R1 shipped

| Fix | Files |
|-----|-------|
| Domain rule **whitelist merge** (no flatten pollution of aiEngines/glossary) | `settings-domain.js` |
| Domain `translationSelector` (+ override) **alias** for `cssSelector` | `settings-domain.js` |
| `setDomainRuleProperty` rejects non-writable keys | `settings-domain.js` |
| Content single/batch translate **no GET_TAB_ID hop** | `element-translation-controller.js`, `translation-batch-queue.js` |
| `findTranslatableElements(..., { skipFallback })` — no `__skipFallback` on settings | `translatable-elements.js` |
| Empty initial scan → `emptyCandidates` on status + progress | `page-translation-job.js` |
| Message protocol comments (TEXT / TEXT_BATCH / BATCH) | `message-types.js` |

## Tests

- settings-domain: whitelist pollution, translationSelector alias, ignore junk write
- content-runtime: batch queue single message (no GET_TAB_ID)
- page-translation-job: emptyCandidates on zero-element start
- Full suite: **92 pass**

## Residual (R2 backlog, not blocking stop)

| Sev | Item |
|-----|------|
| P2 | Migrate stored rules `cssSelector` → `translationSelector` on validate |
| P2 | Popup toast when `emptyCandidates` |
| P2 | Orphan `foxlate-wrapper` revert integration test |
| P3 | Rename wire `translateInputText` (breaking — defer) |
| P3 | Collapse TOGGLE_DISPLAY_MODE / UPDATE_DISPLAY_MODE naming |

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
