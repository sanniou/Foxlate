// DOMWalker 的遍历契约测试。
//
// `create()` 从一个 235 行的巨型函数拆成了「廉价排查 → 样式解析器 → 遍历 → 组装」
// 四段。拆分安全的前提是「文本产出逐字节不变」，所以这里的断言全部落在
// sourceText / plainText / nodeMap 的确切内容上，而不是「能跑就行」。
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';
import { installDomEnvironment } from './helpers/dom-environment.mjs';

let modulePromise;
function modules() {
    modulePromise ??= bundleModule(reexportSource('src/content/dom-walker.js', ['DOMWalker']));
    return modulePromise;
}

/** 走一次完整的 create() 并返回结果。 */
async function walk(html, selector = '#t', config) {
    const { DOMWalker } = await modules();
    const dom = installDomEnvironment(html);
    const target = dom.window.document.querySelector(selector);
    return { result: DOMWalker.create(target, config), dom };
}

test('空的可保留元素：回滚开头标签，且标签序号不复用', async () => {
    const { result } = await walk('<p id="t">A <em></em> B <strong>C</strong></p>');

    assert.equal(result.sourceText, 'A  B <t1>C</t1>');
    assert.deepEqual(Object.keys(result.translationUnit.nodeMap), ['t1'],
        '空 <em> 的 t0 已回滚，后续元素必须拿新序号，不能复用可能被引用过的 id');
});

test('块级元素之间恰好补一个换行，不重复补', async () => {
    const { result } = await walk('<div id="t"><p>One</p><p>Two</p></div>');

    assert.equal(result.sourceText, '<t0>One</t0>\n<t1>Two</t1>');
    assert.equal(result.plainText, 'One\nTwo');
});

test('<br> 转成换行符参与分段', async () => {
    const { result } = await walk('<p id="t">One<br>Two</p>');

    assert.equal(result.sourceText, 'One\nTwo');
    assert.equal(result.plainText, 'One\nTwo');
});

test('相邻文本片段不注入空格：源码里没有的空白，产出里也不凭空出现', async () => {
    // 用注释节点把一个文本节点切成两段，精确命中拼接分支。
    //
    // 该分支历史上写作「若上一段以非空白结尾且本段以非空白开头，则 push(text.trimStart())，
    // 否则 push(text)」——但进入前者的前提是首字符非空白，此时 trimStart 必然是无操作，
    // 两个分支完全等价。也就是说「不足空格」这个意图从来没生效过。
    // 真要改成插入空格会直接改变线上翻译文本，属于产品决策，不在重构范围内；
    // 这里把现状钉住，避免重构顺带改了产出。
    const { result } = await walk('<p id="t">One<!--x-->Two</p>');

    assert.equal(result.sourceText, 'OneTwo');
    assert.equal(result.plainText, 'OneTwo');
});

test('CSS 上表现为块级的 <span> 同样产生分隔符', async () => {
    const { result } = await walk('<div id="t"><span style="display:block">One</span><span>Two</span></div>');

    assert.equal(result.sourceText, 'One\nTwo');
});

test('预格式化上下文从根元素向下传递，并写进 nodeMap', async () => {
    const atRoot = await walk('<pre id="t" style="white-space: pre">a\n  b</pre>');
    assert.equal(atRoot.result.sourceText, 'a\n  b', '根元素的 white-space 直接作用于它的文本节点');

    // 可保留元素会用自己的 white-space 建立新的上下文（子元素自身声明的样式优先于祖先）
    const inChild = await walk('<div id="t"><code style="white-space: pre">a\n  b</code></div>');
    assert.equal(inChild.result.sourceText, '<t0>a\n  b</t0>');
    assert.equal(inChild.result.translationUnit.nodeMap.t0.preservesWhitespace, true,
        '重建器要靠这个标记决定是否把换行还原成 <br>');

    const normal = await walk('<div id="t"><code>a\n  b</code></div>');
    assert.equal(normal.result.sourceText, '<t0>a b</t0>', '非预格式化上下文要折叠空白');
    assert.equal(normal.result.translationUnit.nodeMap.t0.preservesWhitespace, false);
});

test('根元素层面的廉价排查：aria-hidden / Foxlate UI / 已完成追加 / 无文本 / 不可见', async () => {
    const cases = [
        ['aria-hidden 祖先', '<div aria-hidden="true"><p id="t">X</p></div>'],
        ['Foxlate 自身 UI', '<div class="foxlate-summary"><p id="t">X</p></div>'],
        ['已追加译文', '<p id="t" data-foxlate-appended-text="true">X</p>'],
        ['只有空白', '<p id="t">   </p>'],
        ['不可见', '<p id="t" style="display:none">X</p>'],
        ['aria-hidden 自身', '<p id="t" aria-hidden="true">X</p>'],
    ];

    for (const [label, html] of cases) {
        const { result } = await walk(html);
        assert.equal(result, null, `${label} 必须直接放弃`);
    }
});

test('contenteditable 区域直接放弃（jsdom 未实现 isContentEditable，故显式植入）', async () => {
    const { DOMWalker } = await modules();
    const dom = installDomEnvironment('<p id="t">X</p>');
    const target = dom.window.document.querySelector('#t');

    Object.defineProperty(target, 'isContentEditable', { value: true, configurable: true });

    assert.equal(DOMWalker.create(target), null);
});

test('排除选择器同时作用于根元素与内部子节点', async () => {
    const { result } = await walk('<p id="t">Keep<span class="skip">Drop</span>Tail</p>', '#t', { exclude: '.skip' });

    assert.equal(result.sourceText, 'KeepTail');
    assert.equal(result.plainText, 'KeepTail');
});

test('无效的排除选择器只放弃这条规则，不影响翻译继续', async () => {
    const { result } = await walk('<p id="t">Hello</p>', '#t', { exclude: '>>>broken<<<' });

    assert.equal(result.sourceText, 'Hello');
});

test('追加类型由计算样式决定：display 非 inline 即为块级', async () => {
    const block = await walk('<p id="t">Hello world</p>');
    assert.equal(block.result.translationUnit.appendType, 'block');

    const inline = await walk('<span id="t" style="display:inline">Hello world</span>');
    assert.equal(inline.result.translationUnit.appendType, 'inline');

    // 内联元素里出现块级子元素 → 升级为块级
    const promoted = await walk('<span id="t" style="display:inline"><div>Hello</div></span>');
    assert.equal(promoted.result.translationUnit.appendType, 'block');
});

test('图片等原子元素在重建后原位复活，不被文本替换吃掉', async () => {
    // replace 模式的真实事故：维基信息框 `<td>` 里 `img 1→0`、GitHub README `<li>` 里
    // `code 3→0`——因为原子元素没有文本，`#collectPreservableElement` 的"空内容回滚"
    // 逻辑把它们当成空标签丢掉了。
    const { DOMWalker } = await modules();
    const { reconstructDOM } = await bundleModule(reexportSource('src/content/dom-reconstructor.js', ['reconstructDOM']));
    const dom = installDomEnvironment('<p id="t">before <img src="a.png" alt="x"> after</p>');
    const target = dom.window.document.querySelector('#t');

    const { sourceText, translationUnit } = DOMWalker.create(target);
    assert.match(sourceText, /<t0><\/t0>/, '图片必须留下一个原子标签占位');

    // 译文里标签顺序照原样保留（这里模拟翻译引擎原样回传标签）。
    const translated = sourceText.replace('before', '之前').replace('after', '之后');
    const fragment = reconstructDOM(translated, translationUnit.nodeMap);
    const container = dom.window.document.createElement('p');
    container.appendChild(fragment);

    assert.equal(container.querySelectorAll('img').length, 1, '图片必须被重建回来');
    assert.equal(container.querySelector('img').getAttribute('src'), 'a.png');
    assert.match(container.textContent, /之前/);
});
