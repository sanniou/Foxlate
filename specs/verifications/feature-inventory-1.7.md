# Feature inventory (live)

**Baseline:** 1.7.1 landed. **e08:** selection single path + input event + precheck-all-skip notice.

| Surface | Score | Note |
|---------|------:|------|
| Page translate | 8.6 | empty + allPrecheckSkipped signals |
| Display modes | 8.2 | |
| Domain rules | 8.6 | write translationSelector; validate dual-fills legacy |
| Engines / batch | 8.0 | |
| Selection | 8.0 | one content path; SW inject+handoff only |
| Auto-nav | 7.5 | SPA residual |
| Popup | 8.5 | empty / precheck notices |
| Options | 8.0 | |
| Subtitles | 7.5 | fail-soft readiness |
| Input | 8.0 | realm-safe CustomEvent + event assert |
| Summary | 7.0 | |
| Cache/history/cloud | 7.2 | |
| Glossary | 7.8 | |
| Precheck | 8.2 | all-skipped UX |
| Messaging | 8.0 | TRANSLATE_SELECTION_REQUEST |
| **Overall** | **8.2** | |

## Cleaned noise

- Removed duplicate `plans/*.md` (archive copies remain)
- Dropped dead `precheckRules` critical-key
- Options write path no longer dual-writes cssSelector by hand
