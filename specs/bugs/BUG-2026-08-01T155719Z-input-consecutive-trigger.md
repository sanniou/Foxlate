# BUG-2026-08-01T155719Z: 输入框连续按键触发条件失真

## Problem

输入框翻译启用连续按键触发时，用户期望只有同一个配置按键在限定时间内连续达到配置次数才触发翻译。实际行为中，包含普通字符和空格的打字序列也可能被识别为连续触发序列，导致输入内容被意外翻译。

复现方向：在默认连续空格触发配置下，在普通文本输入框中输入带有空格间隔的普通文本，观察触发计数和翻译请求是否被错误触发。也应覆盖纯连续空格、普通字符打断、跨输入框和超时序列。

预期行为：只有真实发生的同一触发键事件连续达到阈值时才调用输入翻译；任意其他按键都应清零当前序列。

## Root Cause Analysis

输入事件处理器的连续序列状态没有保存上一次事件实际按下的键，而是把上一次键状态写成当前配置中的触发键值。后续判断因此比较的是配置值与配置值，而不是前后两次真实事件；连续按键契约没有被正确建模。光标位置检查只是附加条件，不能替代按键身份检查，且在浏览器 keydown、选区和输入法场景下并不可靠。

现有测试覆盖了输入文本工具函数和翻译客户端，却没有通过输入处理器的公开行为验证按键事件序列，因此该缺陷可以回归而不被发现。

安全影响：NONE。未发现可利用的权限、注入或数据泄露路径；影响是错误触发翻译和潜在的输入内容替换。

风险级别：High（用户输入可能被意外替换，且触发器是全站 content script 行为）。

## Related Findings

1. **阈值缺少运行时约束（Medium）**：设置层和事件处理器没有保证连续按键次数为有限的正整数。异常值如 0 或负数可能使第一次匹配事件直接满足阈值；非数字值还可能造成永不触发或行为不一致。
2. **支持的输入控件范围与实现不一致（Medium）**：输入元素判定接受所有 `INPUT`，包括 checkbox、date、number 等非纯文本控件，但后续依赖 `selectionStart`、`setRangeText` 和字符串值替换。应限制到真正支持文本编辑的控件，或为其他类型定义明确行为。
3. **销毁后的延迟回调（Low/Medium）**：魔法词检测使用 debounce，但销毁时没有取消其定时器。销毁后仍可能执行一次旧输入框检查；重新初始化或页面生命周期切换时会增加重复处理风险。
4. **光标连续性假设脆弱（Medium）**：事件处理器假设每次按键使 `selectionStart` 恰好前进一个位置，无法稳健覆盖选区、光标移动、组合输入法和代理输入事件。该逻辑不应作为真实连续按键身份的替代。

## Verification Evidence

- `npm test`：101 passed，0 failed。
- `npm run build:firefox`：通过。
- `npm run build:chrome`：通过。
- 相关历史变更集中在输入处理器的连续按键检测提交；当前测试集合没有 InputHandler 事件级测试。

## TDD Fix Plan

1. **RED**：通过输入处理器的事件处理行为测试，模拟配置为三次 Space，然后发送 Space、Space、Space，断言仅第三次触发翻译；模拟 Space、字符、Space、Space，断言不触发。
   **GREEN**：连续状态保存并比较真实按键身份；任意非触发键清零序列。保留同一目标和时间窗口约束。
   **verify**：`node --test test/input-handler.test.mjs`

2. **RED**：覆盖不同目标输入框、超出时间窗口、选区/光标移动以及自定义触发键，断言序列按契约重新开始且不会误触发。
   **GREEN**：集中实现序列重置条件，避免依赖配置值或单一光标递增假设来判断按键身份。
   **verify**：`node --test test/input-handler.test.mjs`

3. **RED**：覆盖 `consecutiveKeyPresses` 为 0、负数、非数字、1 和超出 UI 上限的配置，断言运行时使用安全的有限正整数范围。
   **GREEN**：在设置边界或输入处理器入口统一规范化阈值，避免异常配置改变触发语义。
   **verify**：`node --test test/input-handler.test.mjs test/options-architecture.test.mjs`

4. **RED**：覆盖 checkbox、date、number、text、search、email、textarea，断言只有文本编辑控件注册连续按键翻译。
   **GREEN**：收紧输入元素判定，或为明确支持的控件提供完整且经过测试的替换契约。
   **verify**：`node --test test/input-handler.test.mjs`

5. **RED**：调用销毁后等待 debounce 延迟，断言不会再执行魔法词检查或发出翻译请求。
   **GREEN**：为 debounce 提供取消能力，并在 InputHandler.destroy 中调用；同时清理完整的按键序列状态。
   **verify**：`node --test test/input-handler.test.mjs`

**REFACTOR**：将事件级输入处理测试保持在独立文件，复用现有 bundle/mock 模式；不引入新的测试框架或状态抽象。

## Acceptance Criteria

- [ ] 普通字符、空格间隔文本不会满足连续同键触发条件。
- [ ] 只有真实同一触发键达到阈值才触发一次翻译。
- [ ] 超时、换目标、非触发键、光标/选区变化会正确重置或重新开始序列。
- [ ] 异常阈值不会导致首键误触发。
- [ ] 非文本输入控件不会被错误处理。
- [ ] 销毁后不存在遗留 debounce 回调。
- [ ] 所有新增测试通过。
- [ ] 现有测试、Firefox 构建和 Chrome 构建继续通过。

## Resolution

<!-- filled in by validate-fix -->
