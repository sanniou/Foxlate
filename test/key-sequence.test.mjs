// KeySequence 的状态机测试。
//
// 「连按触发」是输入框翻译的入口，判定错了会表现为「明明是连按却不触发」或
// 「随便打几个字就误触发、把正在写的内容吃掉」。这四个条件与三种重置路径
// 原先埋在 94 行的 DOM 事件处理器里，只能靠起一个真实输入框去间接观察。
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

let modulePromise;
function modules() {
    modulePromise ??= bundleModule(reexportSource('src/content/input/key-sequence.js', ['KeySequence']));
    return modulePromise;
}

const KEY = 'ShiftRight';
const OTHER_KEY = 'ControlLeft';
const target = { id: 'input-a' };
const otherTarget = { id: 'input-b' };

/** 按下触发键一次；`at` 用于控制时间（毫秒）。 */
function press(sequence, { key = KEY, on = target, caret = 0, value = null, triggerChar = null, at = 0 } = {}) {
    return sequence.register({ consecutiveKey: key, target: on, selectionStart: caret, value, triggerChar, now: at });
}

test('同键、同框、光标逐位前进、间隔在时限内：累加', async () => {
    const { KeySequence } = await modules();
    const sequence = new KeySequence();

    assert.equal(press(sequence, { caret: 0, at: 0 }), 1);
    assert.equal(press(sequence, { caret: 1, at: 100 }), 2);
    assert.equal(press(sequence, { caret: 2, at: 200 }), 3);
    assert.equal(sequence.count, 3);
});

test('换触发键：重新开始', async () => {
    const { KeySequence } = await modules();
    const sequence = new KeySequence();

    press(sequence, { caret: 0, at: 0 });
    press(sequence, { caret: 1, at: 50 });
    assert.equal(press(sequence, { key: OTHER_KEY, caret: 2, at: 100 }), 1);
});

test('换输入框：重新开始', async () => {
    const { KeySequence } = await modules();
    const sequence = new KeySequence();

    press(sequence, { caret: 0, at: 0 });
    press(sequence, { caret: 1, at: 50 });
    assert.equal(press(sequence, { on: otherTarget, caret: 2, at: 100 }), 1);
});

test('超过 500ms：重新开始；恰好 500ms 仍算连续', async () => {
    const { KeySequence } = await modules();

    const boundary = new KeySequence();
    press(boundary, { caret: 0, at: 0 });
    assert.equal(press(boundary, { caret: 1, at: 500 }), 2, '500ms 是闭区间');

    const late = new KeySequence();
    press(late, { caret: 0, at: 0 });
    assert.equal(press(late, { caret: 1, at: 501 }), 1);
});

test('光标没前进一位（中途有别的编辑动作）：重新开始', async () => {
    const { KeySequence } = await modules();
    const sequence = new KeySequence();

    press(sequence, { caret: 10, at: 0 });
    assert.equal(press(sequence, { caret: 10, at: 50 }), 1, '原地不动说明中间不是纯连按');
    assert.equal(press(sequence, { caret: 13, at: 100 }), 1, '跳了不止一位同样不算连续');
});

test('读不到光标位置时不做位置判定（既有取舍：不因此关掉整个功能）', async () => {
    const { KeySequence } = await modules();
    const sequence = new KeySequence();

    assert.equal(press(sequence, { caret: null, at: 0 }), 1);
    assert.equal(press(sequence, { caret: null, at: 50 }), 2);
    assert.equal(press(sequence, { caret: null, at: 100 }), 3);
});

test('上一次按键真的插入了触发字符才累加', async () => {
    const { KeySequence } = await modules();
    const sequence = new KeySequence();

    assert.equal(press(sequence, { caret: 0, value: '', triggerChar: ' ' }), 1);
    assert.equal(press(sequence, { caret: 1, value: ' ', triggerChar: ' ' }), 2);
    assert.equal(press(sequence, { caret: 2, value: '  ', triggerChar: ' ' }), 3);
});

test('输入法上屏了汉字而不是触发字符：重新开始', async () => {
    const { KeySequence } = await modules();
    const sequence = new KeySequence();

    assert.equal(press(sequence, { caret: 0, value: '', triggerChar: ' ' }), 1);
    assert.equal(press(sequence, { caret: 1, value: '你', triggerChar: ' ' }), 1, '中间上屏的是汉字，不是空格');
    assert.equal(press(sequence, { caret: 2, value: '你好', triggerChar: ' ' }), 1);
});

test('reset 之后重新从 1 开始', async () => {
    const { KeySequence } = await modules();
    const sequence = new KeySequence();

    press(sequence, { caret: 0, at: 0 });
    press(sequence, { caret: 1, at: 50 });
    sequence.reset();

    assert.equal(sequence.count, 0);
    assert.equal(press(sequence, { caret: 1, at: 100 }), 1, '重置后连光标连续性也不该延续');
});
