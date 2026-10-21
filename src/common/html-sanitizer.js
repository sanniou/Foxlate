/**
 * AI 输出用的白名单 HTML 净化器。
 *
 * 为什么需要它：AI 总结/对话的 Markdown 经 `marked` 解析后会被 `innerHTML` 插入
 * 到内容脚本的隔离世界中。而 `marked` **默认透传原始 HTML**——它只负责把 Markdown
 * 转成 HTML，不做任何安全过滤。内容又来自第三方 LLM，LLM 的输入是被总结的任意网页，
 * 于是页面可以用提示注入诱导模型输出 `<img src=x onerror=...>`，在隔离世界中执行，
 * 进而通过 `browser.*` 读取设置、冒充内容脚本发消息。
 *
 * 设计要点：
 * - 在**无浏览上下文**的文档里解析（`DOMParser` / `createHTMLDocument`）。没有浏览
 *   上下文，事件处理属性不会被编译成处理器，脚本不会执行——净化前的窗口期因而是安全的。
 * - 白名单制：只保留 Markdown 会产出的元素，其余一律「脱壳保留子节点」；
 *   少数本身就能造成执行/加载/钓鱼的元素整棵子树丢弃。
 * - 属性一律白名单，并单独校验 URL 协议。
 */

/** 整棵子树丢弃：这些元素自身就能执行代码、加载外部资源或伪装成浏览器 UI。 */
const DROP_SUBTREE_TAGS = new Set([
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
    'form', 'input', 'button', 'select', 'option', 'textarea', 'label', 'fieldset', 'legend',
    'base', 'meta', 'link', 'title', 'head', 'noscript', 'template',
    'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track', 'portal',
]);

/** 保留（并逐个校验属性）。 */
const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr', 'div', 'span',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'abbr', 'kbd', 'samp', 'var',
    'code', 'pre', 'blockquote', 'q', 'cite',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'a', 'img',
]);

/** 所有允许元素都可带的属性。 */
const GLOBAL_ATTRIBUTES = new Set(['title', 'dir', 'lang']);

/** 按标签限定的属性。 */
const TAG_ATTRIBUTES = new Map([
    ['a', new Set(['href'])],
    ['img', new Set(['src', 'alt', 'width', 'height'])],
    ['code', new Set(['class'])],
    ['pre', new Set(['class'])],
    ['span', new Set(['class'])],
    ['div', new Set(['class'])],
    ['ol', new Set(['start', 'reversed'])],
    ['td', new Set(['colspan', 'rowspan'])],
    ['th', new Set(['colspan', 'rowspan', 'scope'])],
    ['col', new Set(['span'])],
    ['colgroup', new Set(['span'])],
]);

/** 值必须是 URL 的属性。 */
const URL_ATTRIBUTES = new Set(['href', 'src']);

/** 允许的 URL 协议（相对 URL 永远允许）。 */
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** `img src` 额外允许内联图片，但不允许 `data:text/html` 之类的可执行载荷。 */
const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i;

/** class 值只允许这些字符，杜绝用空白/引号做属性逃逸。 */
const SAFE_CLASS_VALUE = /^[A-Za-z0-9_\- ]+$/;

/**
 * 去掉控制字符与首尾空白，然后判断协议是否安全。
 *
 * 攻击者会用 `java\tscript:`、`JaVaScRiPt:`、前导换行等手段绕过朴素的字符串比较，
 * 所以这里先做规范化再判断。
 */
function isSafeUrl(rawValue, { allowImageDataUrl = false } = {}) {
    // 去掉所有 C0/C1 控制字符与空白（浏览器解析 URL 时会忽略它们）
    const value = String(rawValue).replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
    if (!value) {
        return false;
    }

    if (allowImageDataUrl && SAFE_IMAGE_DATA_URL.test(value)) {
        return true;
    }

    // 相对 URL：不含协议部分（第一个 ':' 出现在 '/' '?' '#' 之后，或根本没有 ':'）
    const colonIndex = value.indexOf(':');
    const firstDelimiter = value.search(/[/?#]/);
    if (colonIndex === -1 || (firstDelimiter !== -1 && firstDelimiter < colonIndex)) {
        return true;
    }

    const scheme = value.slice(0, colonIndex + 1).toLowerCase();
    return SAFE_URL_PROTOCOLS.has(scheme);
}

/**
 * 取得一个**无浏览上下文**的文档用于解析。
 *
 * 关键安全性前提：没有浏览上下文的文档里，事件处理属性不会被激活成处理器，
 * 脚本不会执行。因此「解析 → 净化」之间的窗口期是安全的。
 */
function createInertDocument(ownerDocument) {
    if (typeof ownerDocument?.implementation?.createHTMLDocument === 'function') {
        return ownerDocument.implementation.createHTMLDocument('');
    }
    if (typeof DOMParser !== 'undefined') {
        return new DOMParser().parseFromString('<!doctype html><html><body></body></html>', 'text/html');
    }
    throw new Error('[Foxlate] sanitizeHtml 需要一个 DOM 环境（document 或 DOMParser）。');
}

function isAllowedAttribute(tagName, attributeName) {
    if (attributeName.startsWith('on')) {
        return false; // 事件处理属性一律拒绝
    }
    if (GLOBAL_ATTRIBUTES.has(attributeName)) {
        return true;
    }
    return TAG_ATTRIBUTES.get(tagName)?.has(attributeName) ?? false;
}

function sanitizeAttributes(element) {
    const tagName = element.localName;

    for (const attribute of [...element.attributes]) {
        const name = attribute.localName.toLowerCase();

        if (!isAllowedAttribute(tagName, name)) {
            element.removeAttribute(attribute.name);
            continue;
        }

        if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value, { allowImageDataUrl: tagName === 'img' })) {
            element.removeAttribute(attribute.name);
            continue;
        }

        if (name === 'class' && !SAFE_CLASS_VALUE.test(attribute.value)) {
            element.removeAttribute(attribute.name);
        }
    }

    // 外链一律加 noopener/noreferrer，避免通过 window.opener 反向控制页面
    if (tagName === 'a' && element.hasAttribute('href')) {
        element.setAttribute('rel', 'noopener noreferrer nofollow');
        element.setAttribute('target', '_blank');
    }
}

/**
 * 递归净化一个元素。
 *
 * 顺序很关键：**先递归子节点，再决定自己是否脱壳**。
 * 如果反过先脱壳，上移的子节点就再也不会被白名单判定—
 * 例如 `<article><section>` 会把未净化的 `section` 提升到父级。
 */
function sanitizeNode(node, inertDocument) {
    const tagName = node.localName;

    if (DROP_SUBTREE_TAGS.has(tagName)) {
        node.remove();
        return;
    }

    sanitizeAttributes(node);

    for (const child of [...node.children]) {
        sanitizeNode(child, inertDocument);
    }

    // 非白名单元素：脱壳保留子节点（此时子节点已全部净化完毕）
    if (!ALLOWED_TAGS.has(tagName)) {
        const fragment = inertDocument.createDocumentFragment();
        while (node.firstChild) {
            fragment.appendChild(node.firstChild);
        }
        node.replaceWith(fragment);
    }
}

/**
 * 把不可信 HTML 净化成可安全 `innerHTML` 的字符串。
 *
 * @param {string} html 不可信 HTML（例如 `marked.parse(...)` 的返回值）
 * @param {object} [options]
 * @param {Document} [options.document] 用于解析的文档，默认全局 `document`
 * @returns {string} 净化后的 HTML
 */
export function sanitizeHtml(html, { document: ownerDocument = typeof document !== 'undefined' ? document : undefined } = {}) {
    if (typeof html !== 'string' || html === '') {
        return '';
    }

    const inertDocument = createInertDocument(ownerDocument);
    const container = inertDocument.body;
    container.innerHTML = html;

    // 注释可能被用来拼接出意外的标记，直接全部移除
    const commentWalker = inertDocument.createTreeWalker(container, 128 /* NodeFilter.SHOW_COMMENT */);
    const comments = [];
    while (commentWalker.nextNode()) {
        comments.push(commentWalker.currentNode);
    }
    for (const comment of comments) {
        comment.remove();
    }

    for (const child of [...container.children]) {
        sanitizeNode(child, inertDocument);
    }

    return container.innerHTML;
}
