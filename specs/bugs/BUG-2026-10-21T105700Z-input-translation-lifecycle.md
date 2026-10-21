# BUG-2026-10-21T105700Z: 输入翻译运行时边界与生命周期

## Problem

1.7.5 发布前审计发现输入翻译链路有多个相互独立的运行时问题：

1. 魔法词翻译用固定 `setTimeout(..., 1000)` 持有 `activeTargets`。翻译超过 1 秒时输入框会被提前解锁，可能重复发起请求；翻译很快结束时又会无谓锁住输入框 1 秒，用户马上输入新的魔法词不会触发。
2. 空输入框或纯空白内容连按触发键时，第三次按键仍被 `preventDefault`，但待翻译文本为空，结果既不翻译也吞掉按键。
3. `InputIndicator` 构造时若页面已有 `#foxlate-input-indicator` 节点，会直接 `return` 而不给 `#indicatorEl` 赋值；随后 `show()` 访问 `null.style` 抛异常。content script 重新注入时可能命中这个路径。
4. 同一个复用逻辑只按 id 认节点，页面自己的 `#foxlate-input-indicator` 会被当成扩展节点并改写样式；指示器的 `show()`/`hide()` 会操作页面元素。
5. `InputHandler.destroy()` 没有隐藏已经显示的指示器，销毁后 loading spinner 会留在页面上。
6. 黑名单用 `hostname.includes(domain)` 匹配，`example.com` 会误命中 `notexample.com`；空字符串会命中所有站点。
7. `compositionstart` 只处理受支持的 input/textarea。若输入法组字发生在 contenteditable 等节点上，同一时段的 input keydown 不会被屏蔽，仍可能被当作连按。

## Root Cause Analysis

- `handleMagicWord()` 固定等待 1 秒再删除 `activeTargets`，与实际翻译 Promise 的生命周期脱节。
- `handleConsecutiveKeyPress()` 在调用 `getLastSentence()` 后无条件 `preventDefault`，没有先判断 `lastSentence.trim()`。
- `InputIndicator.#createIndicatorElement()` 的已有节点分支只 `return`，没有赋值实例字段，也没有补注入样式；复用条件又只按 id，缺少扩展归属标记。
- `destroy()` 只清理监听器和 debounce，没有清理指示器 UI。
- 黑名单匹配没有域名边界概念，`includes` 是子串判断。
- `compositionstart` 把“是否受支持输入框”与“是否正在组字”混为一谈；组字状态应当是全页面级别的。

## Fix

- 魔法词翻译改为在 `triggerTranslation()` 返回的 Promise settle 后立即释放 `activeTargets`，成功和失败都释放。
- 连续触发在 `lastSentence.trim()` 为空时直接返回，不调用 `preventDefault`，让触发键正常上屏。
- `InputIndicator` 改为只复用带 `data-foxlate-owned="true"` 的自身节点，页面同名 id 不再被劫持；使用 `.foxlate-input-indicator` 类名承载样式，页面占用同名 id 时不制造重复 id。
- `InputIndicator` 首次 `show()` 时惰性创建；节点被页面移除后自动重建；样式节点同样带归属标记。
- `InputHandler.destroy()` 隐藏可见指示器。
- 新增 `isHostnameBlacklisted()`，按 `host === domain || host.endsWith('.' + domain)` 匹配，并归一化大小写、前导点、尾随点和空值。
- `compositionstart` 不再要求目标必须是受支持输入框；任何页面组字都会阻止同一时段的输入翻译，直到 `compositionend` 或焦点/窗口失焦。

## Verification Evidence

- `test/input-handler.test.mjs`：18 passed，覆盖空内容不吞键、魔法词 Promise settle 后释放、销毁隐藏指示器、contenteditable 组字屏蔽。
- `test/content-feature-modules.test.mjs`：9 passed，覆盖自有指示器复用、页面同名 id 不劫持、黑名单域名边界。
- 全量 `npm test`：396 passed，0 failed。
- `npm run build:firefox` / `npm run build:chrome`：均通过。
- `npm run package:firefox`：通过，产出 1.7.5 商店包与源码包。

## Acceptance Criteria

- [x] 魔法词翻译进行中同一输入框不能重复触发。
- [x] 翻译成功或失败后立即释放，不依赖固定 1 秒定时器。
- [x] 无正文时触发键不被吞掉。
- [x] content script 重新注入后 `InputIndicator.show()` 不抛异常且不重复插入节点。
- [x] 页面同名 id 不会被扩展样式或显示状态改写。
- [x] 销毁后指示器不再可见。
- [x] 黑名单不会因子串、空字符串或大小写误判。
- [x] 任意页面节点的输入法组字都会阻止同一时段的输入翻译。
- [x] 全量测试与双平台构建通过。
