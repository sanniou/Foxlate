const path = require('node:path');

/**
 * 构建入口的唯一清单。
 *
 * `build.js` 用它决定打包哪些文件，`test/bundle-budget.test.mjs` 用它决定哪些产物
 * 必须受体积预算约束。这两处曾经各写一份，结果 subtitle 的三个入口从来没被预算覆盖
 * ——新入口加上去也不会有人发现它把整包拖大了。
 */
const SOURCE_DIR = path.join(__dirname, 'src');

const ENTRY_FILES = [
    'background/service-worker.js',
    'content/content-script.js',
    'content/subtitle/subtitle-manager.js',
    'content/subtitle/youtube-subtitle-strategy.js',
    'content/subtitle/bilibili-subtitle-strategy.js',
    // 摘要按需注入入口：不与 content-script 同包，见 background-constants.js
    'content/summary/summary-entry.js',
    'options/options.js',
    'popup/popup.js',
];

function entryFilePaths() {
    return ENTRY_FILES.map((file) => file.replace(/\\/g, '/')).map((file) => path.join(SOURCE_DIR, file));
}

module.exports = { ENTRY_FILES, SOURCE_DIR, entryFilePaths };
