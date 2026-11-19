/**
 * 注入到宿主页面的 CSS。顺序有意义：`common/tokens.css` 必须最先注入，
 * 它提供 `--fox-*` 设计 token，后续三份样式全部依赖它。
 *
 * 注意 tokens.css 只含 `:root` 上的 `--fox-*` 自定义属性，不含任何会改变
 * 宿主页面渲染的规则（例如 `color-scheme`）—— 那些留在 common.css，
 * 只给扩展页面使用。
 */
export const CSS_FILES = [
    'common/tokens.css',
    'content/control-reset.css',
    'content/style.css',
    'content/enhanced-style.css',
];

export const CORE_SCRIPT_FILES = ['content/content-script.js'];

/**
 * 摘要模块（UI + readability 正文抽取 + marked 渲染）**按需注入**。
 *
 * 这三块曾经跟着 `content/content-script.js` 静态打包：即使用户从没点过摘要，
 * 每个被翻译的页面还是要下载 200KB+ 的 readability 与 markdown 渲染器。摘要默认
 * 是关闭的，所以绝大多数会话在为空功能付费。
 *
 * 现在它跟字幕模块同一套模式：独立的注入入口，内容运行时只在
 * `summarySettings.enabled` 为真时请求注入。样式也一起挪出来——摘要面板的
 * 样式对非摘要页面毫无作用。
 */
export const SUMMARY_SCRIPT_FILES = ['content/summary/summary-entry.js'];

export const SUMMARY_CSS_FILES = [
    // tokens.css 必须跟着走：快捷键路径（`force`）是在没翻译过的页面上直接注入摘要包的，
    // 那时 `content/style.css` 与 tokens 都还没注入——只给 summary.css 会让里面所有
    // `var(--fox-color-*)` 变成无效值，面板直接透明。
    'common/tokens.css',
    'content/control-reset.css',
    'content/summary/summary.css',
];
