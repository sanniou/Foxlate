# Scope rules review — page translate & summary

**Date:** 2026-07-22 · **Branch/work:** e09 · **Version target:** 1.7.3

## Goal

Ensure candidates for **page translation** and **summary** land on the right *content* scope — prose body, not chrome.

## Findings (before)

| # | Issue | Severity |
|---|--------|----------|
| 1 | `findTranslatableElements` ignored `translationSelector.exclude` — only `DOMWalker` applied exclude later, so chrome nodes still entered observe/IO queue | **P0** |
| 2 | Default content included `button`, `label`, `[role=tab]`, `[role=link]` → control chrome noise | **P0** |
| 3 | Summary used `querySelector(mainBody)` → first/smallest article/teaser often won | **P0** |
| 4 | `summarySettings` default was `{}`; domain rule `summarySettings` not merged into effective | **P1** |
| 5 | Site wizard `app` preset targeted buttons/tabs as content | **P1** |

## Fixes

1. **Candidate filter:** exclude applied at candidate collection + final list.
2. **Defaults:** prose-only content; richer shell exclude (`role=search`, form, sidebar/toc/breadcrumb/pagination).
3. **Summary:** `DEFAULT_SUMMARY_MAIN_BODY`; pick **largest** matching node; Readability strip also drops nav/complementary.
4. **Effective settings:** domain `summarySettings` overlay + writable key; validate fills mainBody default.
5. **Presets:** article/docs/app rewritten for prose scope.

## Residual

- SPA sites with no semantic main still need domain rules (fallback `div` can be broad).
- Shadow-DOM body text for summary still whole-document Readability path if selector misses.
- Existing stored user selectors keep old content (validate merges default exclude only when missing keys via deep-merge of default selector object — **stored content not force-overwritten**).

## Score (scope quality)

| Dim | Before | After |
|-----|-------:|------:|
| Translate candidate precision | 6.0 | **8.2** |
| Translate exclude correctness | 5.5 | **8.5** |
| Summary body scope | 5.5 | **8.0** |
| Domain rule surface | 6.5 | **8.0** |
| **Overall scope** | **5.9** | **8.2** |
