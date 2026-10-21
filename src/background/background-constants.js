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
    'content/style.css',
    'content/enhanced-style.css',
    'content/summary/summary.css',
];

export const CORE_SCRIPT_FILES = ['content/content-script.js'];
