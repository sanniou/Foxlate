# Core Strategy Scorecard (10-point)

**Stop criterion:** overall ≥ 8.0 AND every dim ≥ 7.5  
**Baseline:** 7.4 → **R1: 8.3 (STOP MET)**

| Dim | Baseline | R1 |
|-----|--------:|---:|
| 元素提取 | 7.5 | 8.2 |
| 翻译链路 | 8.0 | 8.4 |
| 事件分发 | 7.0 | 7.8 |
| 设置域 | 7.0 | 8.6 |
| **Overall** | **7.4** | **8.3** |

## R1 done

- [x] Domain rule whitelist merge
- [x] `translationSelector` alias for `cssSelector`
- [x] Drop GET_TAB_ID hop (sender.tab)
- [x] `options.skipFallback`
- [x] `emptyCandidates` status/progress
- [x] Writable domain keys guard
- [x] Message protocol docs
- [x] 92 tests pass

## R2 backlog (optional, not required for stop)

- validateSettings migrate cssSelector → translationSelector
- popup toast on emptyCandidates
- foxlate-wrapper revert integration test
