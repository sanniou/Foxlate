# Feature inventory — 1.7.1 快照（非 live）

> 这是 1.7.1 时点的一次打分快照，**不是现行状态**。
> 现行状态见 `specs/verifications/full-refactor-review-1.7.4.md` 第 1 节（实测基线）与第 5 节（功能合理性）。
> 原文件头写作 “(live)”，但它自 1.7.1 后未再更新 —— 声称“live”却无人维护的文档会误导读者，比不写更差。

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
