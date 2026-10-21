import assert from 'node:assert/strict';
import test from 'node:test';

import { bundleModule, reexportSource } from './helpers/bundle.mjs';

const { deepFreeze, isDeepEqual, shouldReloadTranslationJob } = await bundleModule([
    reexportSource('src/common/object-utils.js', ['deepFreeze', 'isDeepEqual']),
    reexportSource('src/background/settings-reload-policy.js', ['shouldReloadTranslationJob']),
].join('\n'));

// ---------------------------------------------------------------------------
// deepFreeze
// ---------------------------------------------------------------------------

test('deepFreeze 冻结顶层与所有嵌套对象/数组', () => {
    const value = deepFreeze({
        plain: { nested: { deep: 1 } },
        list: [{ item: 1 }],
    });

    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.plain));
    assert.ok(Object.isFrozen(value.plain.nested));
    assert.ok(Object.isFrozen(value.list));
    assert.ok(Object.isFrozen(value.list[0]));
});

test('deepFreeze 后写入立即抛错，而不是静默污染共享状态', () => {
    const value = deepFreeze({ aiEngines: [{ id: 'a' }] });

    assert.throws(() => { value.targetLanguage = 'ZH'; }, TypeError);
    assert.throws(() => { value.aiEngines.push({ id: 'b' }); }, TypeError);
    assert.throws(() => { value.aiEngines[0].id = 'changed'; }, TypeError);
});

test('deepFreeze 幂等，且跳过已冻结的共享子树', () => {
    const shared = deepFreeze({ shared: true });
    const value = deepFreeze({ a: shared, b: { c: 1 } });

    // 重复冻结同一对象不得抛错
    deepFreeze(value);
    assert.ok(Object.isFrozen(value.b));
    assert.equal(value.a, shared, '已冻结子树保持同一引用，不会重写');
});

test('deepFreeze 原样返回原始值、null 与函数', () => {
    assert.equal(deepFreeze(null), null);
    assert.equal(deepFreeze(42), 42);
    assert.equal(deepFreeze('str'), 'str');
    assert.equal(deepFreeze(undefined), undefined);

    const fn = () => {};
    assert.equal(deepFreeze(fn), fn);
});

test('deepFreeze 的产物仍可被 structuredClone（冻结不改变数据类型）', () => {
    const value = deepFreeze({ list: [1, 2, 3], nested: { a: 'b' } });

    const clone = structuredClone(value);

    assert.deepEqual(clone, { list: [1, 2, 3], nested: { a: 'b' } });
    assert.ok(!Object.isFrozen(clone), '克隆是可变的，下游可安全改写自己的副本');
});

// ---------------------------------------------------------------------------
// isDeepEqual
// ---------------------------------------------------------------------------

test('isDeepEqual 比较嵌套结构，数组顺序敏感', () => {
    assert.ok(isDeepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
    assert.ok(!isDeepEqual({ a: [1, 2] }, { a: [2, 1] }));
    assert.ok(!isDeepEqual({ a: 1 }, { a: 1, b: undefined }), '键数不同即不等');
    assert.ok(!isDeepEqual([1, 2], { 0: 1, 1: 2 }), '数组与对象不互等');
});

test('isDeepEqual 与键序无关——JSON.stringify 在这里会误判', () => {
    const a = { targetLanguage: 'ZH', translatorEngine: 'google' };
    const b = { translatorEngine: 'google', targetLanguage: 'ZH' };

    assert.ok(isDeepEqual(a, b));
    assert.notEqual(
        JSON.stringify(a),
        JSON.stringify(b),
        '这正是必须换掉 JSON.stringify 的原因：键序不同会被误判为「设置变了」',
    );
});

test('isDeepEqual 把 NaN 视为相等', () => {
    assert.ok(isDeepEqual({ a: NaN }, { a: NaN }));
    assert.ok(!isDeepEqual({ a: NaN }, { a: 1 }));
});

test('isDeepEqual 在第一个差异处短路返回，不遍历剩余内容', () => {
    let nestedTouched = 0;
    const right = {
        first: 1,
        second: {
            get nested() {
                nestedTouched++;
                return 'deep';
            },
        },
    };

    // first 就已不同 → 不得再去读 second.nested
    assert.ok(!isDeepEqual({ first: 9, second: right.second }, right));
    assert.equal(nestedTouched, 0, '存在差异时不应继续遍历更深的内容');

    // 对照：JSON.stringify 会把整棵树全部读到
    JSON.stringify(right);
    assert.equal(nestedTouched, 1);
});

test('isDeepEqual 处理 null / undefined / 原始值', () => {
    assert.ok(isDeepEqual(null, null));
    assert.ok(isDeepEqual(undefined, undefined));
    assert.ok(!isDeepEqual(null, {}));
    assert.ok(!isDeepEqual(0, '0'));
    assert.ok(!isDeepEqual({ a: null }, { a: {} }));
});

// ---------------------------------------------------------------------------
// shouldReloadTranslationJob
// ---------------------------------------------------------------------------

const CRITICAL_KEYS = ['targetLanguage', 'translatorEngine', 'aiEngines'];

test('shouldReloadTranslationJob 缺少任一侧设置时保守返回 true', () => {
    assert.equal(shouldReloadTranslationJob({ oldValue: null, newValue: {}, criticalKeys: CRITICAL_KEYS }), true);
    assert.equal(shouldReloadTranslationJob({ oldValue: {}, newValue: null, criticalKeys: CRITICAL_KEYS }), true);
});

test('shouldReloadTranslationJob 只在关键键真正变化时返回 true', () => {
    const base = { targetLanguage: 'ZH', translatorEngine: 'google', uiZoomLevel: 1 };

    assert.equal(
        shouldReloadTranslationJob({
            oldValue: base,
            newValue: { ...base, uiZoomLevel: 2 },
            criticalKeys: CRITICAL_KEYS,
        }),
        false,
        '非关键键变化不应触发重新翻译',
    );
    assert.equal(
        shouldReloadTranslationJob({
            oldValue: base,
            newValue: { ...base, targetLanguage: 'EN' },
            criticalKeys: CRITICAL_KEYS,
        }),
        true,
        '目标语言变化必须触发重新翻译',
    );
});

test('shouldReloadTranslationJob 对深层相等但引用不同的关键键返回 false（不误触发重翻译）', () => {
    const oldValue = {
        aiEngines: [{ id: 'a', apiUrl: 'https://x.test', models: ['m1', 'm2'] }],
    };
    const newValue = {
        // 新引用、且键序不同——旧实现用 JSON.stringify 会在这种情况下误判
        aiEngines: [{ models: ['m1', 'm2'], apiUrl: 'https://x.test', id: 'a' }],
    };

    assert.equal(
        shouldReloadTranslationJob({ oldValue, newValue, criticalKeys: CRITICAL_KEYS }),
        false,
        '内容相同的引擎配置不得触发整页重新翻译',
    );

    assert.equal(
        shouldReloadTranslationJob({
            oldValue,
            newValue: { aiEngines: [{ id: 'a', apiUrl: 'https://x.test', models: ['m1', 'm3'] }] },
            criticalKeys: CRITICAL_KEYS,
        }),
        true,
        '引擎配置的真实变化必须被检出',
    );
});
