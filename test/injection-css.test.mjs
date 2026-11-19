import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { bundleModule, projectRoot, reexportSource } from './helpers/bundle.mjs';

// 注入到宿主页面的样式清单，以及「宿主页面 UA 外观漏进我们的控件」这个长期缺陷。
//
// 两个独立的坑：
//   1. `<button>` 带 UA 默认外观（Chrome：2px outset black + Arial + 内边距）。组件只
//      声明了一部分外观，没声明的就从 UA 漏进来，于是摘要悬浮按钮和面板标签页外面套
//      着一圈黑色立体方框。修法是零特异性的 `:where()` 基线，组件规则天然胜过它。
//   2. 摘要包的 CSS 依赖 `--fox-*` token，而快捷键路径是在**没翻译过的页面**上直接
//      注入摘要包的（此时 `content/style.css` 与会话 tokens 都还没注入）。只给
//      `summary.css` 会让里面所有 `var(--fox-color-*)` 失效，面板变透明。

globalThis.__foxlateBrowserMock = { runtime: { onMessage: { addListener() {} } } };

const { CSS_FILES, SUMMARY_CSS_FILES } = await bundleModule(
    reexportSource('src/background/background-constants.js', ['CSS_FILES', 'SUMMARY_CSS_FILES']),
    { prefix: 'foxlate-injection-css-' },
);

const readSrc = relative => readFile(path.join(projectRoot, 'src', relative), 'utf8');

test('token 样式与控件基线先于组件样式注入', () => {
    assert.equal(CSS_FILES[0], 'common/tokens.css', 'tokens.css 必须第一个注入：基线样式要用 --fox-font-*');
    const resetIndex = CSS_FILES.indexOf('content/control-reset.css');
    assert.ok(resetIndex > 0, 'CSS_FILES 必须包含 content/control-reset.css');
    assert.ok(
        resetIndex < CSS_FILES.indexOf('content/style.css'),
        '控件基线必须先于组件样式，否则同特异性时组件会被基线反盖',
    );
});

test('摘要包的样式清单自带 token 与控件基线', () => {
    assert.ok(SUMMARY_CSS_FILES.includes('common/tokens.css'), '快捷键路径没有 tokens.css 会让摘要面板失去全部颜色');
    assert.ok(SUMMARY_CSS_FILES.includes('content/control-reset.css'), '摘要按钮与面板按钮同样会被 UA 外观包边');
    assert.ok(
        SUMMARY_CSS_FILES.includes('content/summary/summary.css'),
        '摘要包自己的样式不能少',
    );
});

test('控件基线的特异性压在组件之下、宿主元素规则之上', async () => {
    const css = await readSrc('content/control-reset.css');
    // 期望形态：`:where(button)[class^="foxlate"]` = (0,1,0)。
    //   - 写成 `:where(button)` 或 `:where(button[class*="foxlate"])` → (0,0,0)，
    //     宿主页面的 `button { … }` (0,0,1) 会反过来盖住基线；
    //   - 写成 `button[class*="foxlate"]` → (0,1,1)，会盖掉组件自己的 padding/border。
    assert.match(css, /:where\(button\)\[class\^="foxlate"\]/, '选择器必须是 :where(button)[class^="foxlate"] 这个 (0,1,0) 形态');
    assert.doesNotMatch(css, /^button\[/m, '不要用裸 button[class…]：特异性 (0,1,1) 会盖掉组件声明');
    for (const declaration of ['appearance: none', 'border: 0', 'padding: 0', 'background: none']) {
        assert.ok(css.includes(declaration), `控件基线缺少 ${declaration}`);
    }
    assert.ok(css.includes('var(--fox-font-sans)'), '字体必须走设计 token，不能写死字体栈');
});

test('内容侧所有被注入的样式文件都真实存在', async () => {
    for (const file of [...CSS_FILES, ...SUMMARY_CSS_FILES]) {
        const css = await readFile(path.join(projectRoot, 'src', file), 'utf8');
        assert.ok(css.length > 0, `${file} 是空的`);
    }
});
