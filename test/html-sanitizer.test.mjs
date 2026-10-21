import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { bundleModule, reexportSource } from './helpers/bundle.mjs';

const { sanitizeHtml } = await bundleModule(
    reexportSource('src/common/html-sanitizer.js', ['sanitizeHtml']),
    { mockBrowserPolyfill: false, prefix: 'foxlate-html-sanitizer-test-' },
);

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const document = dom.window.document;

/** 净化后返回可读字符串，便于断言。 */
function clean(html) {
    return sanitizeHtml(html, { document });
}

/**
 * 把净化结果真正插入到一个文档里，然后检查是否产生了可执行的东西。
 * 只看字符串容易被序列化差异骗过，这里做的是「插入后」的真实检查。
 */
function render(html) {
    const host = document.createElement('div');
    host.innerHTML = clean(html);
    return host;
}

// ---------------------------------------------------------------------------
// 脚本执行面
// ---------------------------------------------------------------------------

test('剥离 <script> 及其内容', () => {
    const host = render('<p>before</p><script>window.__pwned = 1;</script><p>after</p>');
    assert.equal(host.querySelector('script'), null);
    assert.ok(!host.innerHTML.includes('__pwned'));
    assert.ok(host.textContent.includes('before') && host.textContent.includes('after'));
});

test('剥离事件处理属性，图片的 onerror 不再存在', () => {
    const host = render('<img src="x" onerror="window.__pwned=1">');
    const img = host.querySelector('img');
    assert.ok(img, 'img 本身应保留（Markdown 支持图片）');
    assert.equal(img.getAttribute('onerror'), null);
    assert.equal(img.hasAttribute('onerror'), false);
});

test('剥离任意 on* 属性，含大小写变形', () => {
    const host = render('<p ONCLICK="x" oNmOuSeOvEr="y" onclick="z">t</p>');
    const p = host.querySelector('p');
    assert.equal(p.attributes.length, 0, '所有 on* 属性都应被移除');
});

test('剥离内联样式属性（可用于覆盖 UI 或做 CSS 外泄）', () => {
    const host = render('<p style="position:fixed;inset:0;z-index:999999">x</p>');
    assert.equal(host.querySelector('p').hasAttribute('style'), false);
});

// ---------------------------------------------------------------------------
// URL 协议
// ---------------------------------------------------------------------------

test('阻止 javascript: 协议的链接', () => {
    const host = render('<a href="javascript:alert(1)">click</a>');
    const a = host.querySelector('a');
    assert.ok(a);
    assert.equal(a.hasAttribute('href'), false, 'javascript: 必须被剥离');
});

test('阻止协议大小写 / 控制字符绕过的 javascript:', () => {
    for (const payload of [
        'JaVaScRiPt:alert(1)',
        'java\tscript:alert(1)',
        'java\nscript:alert(1)',
        'java\rscript:alert(1)',
        '\u0001javascript:alert(1)',
        '  javascript:alert(1)  ',
    ]) {
        const host = render(`<a href="${payload}">x</a>`);
        assert.equal(host.querySelector('a').hasAttribute('href'), false, `未拦住: ${JSON.stringify(payload)}`);
    }
});

test('阻止 vbscript: 与 data:text/html', () => {
    const host = render('<a href="vbscript:msgbox(1)">a</a><img src="data:text/html,<script>1</script>">');
    assert.equal(host.querySelector('a').hasAttribute('href'), false);
    assert.equal(host.querySelector('img').hasAttribute('src'), false);
});

test('保留 http/https/mailto 与相对链接，并强制 noopener', () => {
    const host = render('<a href="https://e.com">1</a><a href="/p">2</a><a href="mailto:a@b.c">3</a><a href="#x">4</a>');
    const [a1, a2, a3, a4] = host.querySelectorAll('a');
    assert.equal(a1.getAttribute('href'), 'https://e.com');
    assert.equal(a2.getAttribute('href'), '/p');
    assert.equal(a3.getAttribute('href'), 'mailto:a@b.c');
    assert.equal(a4.getAttribute('href'), '#x');
    for (const a of [a1, a2, a3, a4]) {
        assert.equal(a.getAttribute('rel'), 'noopener noreferrer nofollow');
        assert.equal(a.getAttribute('target'), '_blank');
    }
});

test('img 允许 http(s) 与 data:image，但不允许 svg+xml 以外的可执行 data', () => {
    const host = render([
        '<img src="https://e.com/a.png">',
        '<img src="data:image/png;base64,iVBORw0KGgo=">',
        '<img src="data:text/html;base64,PHNjcmlwdD4=">',
    ].join(''));
    const [ok, dataPng, dataHtml] = host.querySelectorAll('img');
    assert.equal(ok.getAttribute('src'), 'https://e.com/a.png');
    assert.equal(dataPng.getAttribute('src'), 'data:image/png;base64,iVBORw0KGgo=');
    assert.equal(dataHtml.hasAttribute('src'), false);
});

// ---------------------------------------------------------------------------
// 危险容器元素
// ---------------------------------------------------------------------------

test('整棵丢弃 iframe / object / embed / form / base / meta / link / style', () => {
    const payloads = [
        '<iframe src="https://evil.com"></iframe>',
        '<object data="evil.swf"></object>',
        '<embed src="evil.swf">',
        '<form action="https://evil.com"><input name="p"><button>go</button></form>',
        '<base href="https://evil.com/">',
        '<meta http-equiv="refresh" content="0;url=https://evil.com">',
        '<link rel="stylesheet" href="https://evil.com/x.css">',
        '<style>body{display:none}</style>',
    ];
    for (const payload of payloads) {
        const host = render(`<p>keep</p>${payload}`);
        assert.equal(host.querySelectorAll('iframe, object, embed, form, input, button, base, meta, link, style').length, 0,
            `未清干净: ${payload}`);
        assert.ok(host.textContent.includes('keep'), '正常内容不应被误删');
    }
});

test('丢弃 svg / math 命名空间（可用 animation 事件执行代码）', () => {
    const host = render('<svg><animate onbegin="alert(1)"></animate></svg><math><mtext>x</mtext></math>');
    assert.equal(host.querySelector('svg, math, animate, mtext'), null);
});

test('丢弃注释（可用于拼接标记）', () => {
    const host = render('<p>a<!--[if IE]><script>x</script><![endif]-->b</p>');
    assert.equal(host.innerHTML.includes('<!--'), false);
    assert.ok(host.textContent.includes('a') && host.textContent.includes('b'));
});

test('丢弃 template 内容', () => {
    const host = render('<template><img src=x onerror=alert(1)></template>');
    assert.equal(host.querySelector('template, img'), null);
});

// ---------------------------------------------------------------------------
// 正常 Markdown 输出必须原样保留（不能因为净化而丢功能）
// ---------------------------------------------------------------------------

test('保留 marked 产出的完整 Markdown 结构', () => {
    const host = render([
        '<h1>h1</h1>',
        '<p><strong>b</strong><em>i</em><del>d</del> <code>c</code></p>',
        '<pre><code class="language-js">const a=1;</code></pre>',
        '<blockquote><p>q</p></blockquote>',
        '<ul><li>x</li></ul><ol start="3"><li>y</li></ol>',
        '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td colspan="2">1</td></tr></tbody></table>',
        '<hr><p><a href="https://e.com">l</a> <img src="https://e.com/i.png" alt="i"></p>',
    ].join(''));

    assert.equal(host.querySelector('h1').textContent, 'h1');
    assert.ok(host.querySelector('strong') && host.querySelector('em') && host.querySelector('del'));
    assert.equal(host.querySelector('code').textContent, 'c');
    assert.equal(host.querySelector('pre code').getAttribute('class'), 'language-js');
    assert.ok(host.querySelector('blockquote p'));
    assert.deepEqual([...host.querySelectorAll('li')].map(li => li.textContent), ['x', 'y']);
    assert.equal(host.querySelector('ol').getAttribute('start'), '3');
    assert.equal(host.querySelector('th').textContent, 'a');
    assert.equal(host.querySelector('td').getAttribute('colspan'), '2');
    assert.ok(host.querySelector('hr'));
    assert.equal(host.querySelector('a').getAttribute('href'), 'https://e.com');
    assert.equal(host.querySelector('img').getAttribute('alt'), 'i');
});

test('保留 Markdown 任务列表的可读文本（input 被丢弃但文字仍在）', () => {
    const host = render('<ul><li><input disabled="" type="checkbox"> 待办</li></ul>');
    assert.equal(host.querySelector('input'), null);
    assert.ok(host.querySelector('li').textContent.includes('待办'), '复选框被移除后文字必须保留');
});

test('非白名单元素脱壳而不是整块删除，用户可见文本不丢', () => {
    const host = render('<article><section><p>正文</p></section></article>');
    assert.equal(host.querySelector('article, section'), null);
    assert.equal(host.querySelector('p').textContent, '正文');
});

test('class 值含引号/空白以外的可疑字符时被剥离，不能用于属性逃逸', () => {
    const host = render('<code class=\'a" onmouseover="x\'>c</code>');
    const code = host.querySelector('code');
    assert.equal(code.hasAttribute('onmouseover'), false);
    // 值里含非法字符，class 应被整体移除
    assert.equal(code.hasAttribute('class'), false);
});

// ---------------------------------------------------------------------------
// 健壮性
// ---------------------------------------------------------------------------

test('空输入与非字符串输入返回空串', () => {
    assert.equal(clean(''), '');
    assert.equal(sanitizeHtml(null, { document }), '');
    assert.equal(sanitizeHtml(undefined, { document }), '');
    assert.equal(sanitizeHtml(123, { document }), '');
});

test('净化是幂等的（二次净化结果不变）', () => {
    const input = '<p>a</p><img src=x onerror=alert(1)><a href="javascript:x">l</a><article>b</article>';
    const once = clean(input);
    const twice = clean(once);
    assert.equal(twice, once);
});

test('深度嵌套不会栈溢出或漏掉深层危险属性', () => {
    const deep = '<div>'.repeat(200) + '<img src=x onerror=alert(1)>' + '</div>'.repeat(200);
    const host = render(deep);
    const img = host.querySelector('img');
    assert.equal(img.hasAttribute('onerror'), false);
});

test('畸形/未闭合标记下的危险属性仍被清除', () => {
    const host = render('<p><img src=x onerror=alert(1)><script>bad');
    assert.equal(host.querySelector('img')?.hasAttribute('onerror') ?? false, false);
    assert.equal(host.querySelector('script'), null);
});
