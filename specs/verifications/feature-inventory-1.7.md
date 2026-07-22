# Feature & Logic Inventory — Foxlate 1.7.x

**Date:** 2026-07-22  
**Branch:** `feat/e07-feature-audit`  
**Stop:** overall ≥ 8.0 and min dim ≥ 7.0 → **MET at R2 (8.1)**

## Scorecard

| # | Surface | Baseline | R1 | R2 | Residual |
|---|---------|--------:|---:|---:|----------|
| 1 | Page translate | 8.3 | 8.6 | **8.6** | SPA orphan-wrapper |
| 2 | Display modes | 8.2 | 8.2 | **8.2** | soft chrome UAT |
| 3 | Domain rules + effective | 8.0 | 8.5 | **8.6** | — |
| 4 | Engines + batch | 8.0 | 8.0 | **8.0** | — |
| 5 | Selection / quick-action | 7.2 | 7.3 | **7.4** | 3 entry points (doc) |
| 6 | Auto-translate navigate | 7.5 | 7.5 | **7.5** | SPA history |
| 7 | Popup control | 7.8 | 8.3 | **8.4** | emptyCandidates UX |
| 8 | Options app | 7.5 | 7.8 | **8.0** | dual-write selector |
| 9 | Subtitles | 7.0 | 7.0 | **7.5** | fail-soft readiness |
| 10 | Input translation | 7.0 | 7.0 | **7.6** | client smoke test |
| 11 | AI summary | 7.0 | 7.0 | **7.0** | engine-dependent |
| 12 | Cache/history/health/cloud | 7.2 | 7.2 | **7.2** | — |
| 13 | Glossary | 7.8 | 7.8 | **7.8** | — |
| 14 | Precheck | 8.0 | 8.0 | **8.0** | — |
| 15 | Messaging | 7.8 | 7.9 | **7.9** | legacy camelCase |
| **Overall** | | **7.6** | **7.9** | **8.1** | **STOP MET** |

## R1 shipped

- Popup i18n notice on `emptyCandidates`
- Status contract `{ state, emptyCandidates }`
- Badge amber `0` for empty jobs
- validateSettings migrates cssSelector ↔ translationSelector
- DomainRuleModal + site wizard dual-write both shapes

## R2 shipped

- Subtitle wait fail-soft (3s, warn only, toggle still works)
- InputTranslationClient smoke test (message shape + replace)
- badge-state unit tests
- Full suite **95 pass**

## Optional later (not blocking)

- Selection entry consolidation
- Summary reliability beyond error classification
- Precheck “all skipped” soft notice
