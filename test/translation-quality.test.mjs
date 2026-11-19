import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { bundleModule } from './helpers/bundle.mjs';

/**
 * 三处「静默丢内容」的缺陷回归：术语表无词边界、非拉丁脚本检测不到、
 * 「检测不出语言」被当成「不需要翻译」。
 *
 * 全部来自 19 个真实页面 / 6.8 MB 语料的实测（阿语页 33 候选 → 0 条送翻；
 * `cat` 术语假匹配 100%）。这些缺陷的共同点是**界面看起来一切正常**，
 * 只是内容没被翻——所以必须由断言守住，而不是靠人眼。
 */

const projectRoot = path.resolve(import.meta.dirname, '..');

// `precheck` 走 i18n 取日志文案；测试里给一个只回答空字符串的浏览器替身。
globalThis.__foxlateBrowserMock = { i18n: { getMessage: () => '' } };

const MODULE_EXPORTS = `
    export { applyGlossaryToText } from '${projectRoot}/src/common/translation-glossary.js';
    export { detectProjectLang } from '${projectRoot}/src/common/lang-detect.js';
    export { shouldTranslate } from '${projectRoot}/src/common/precheck.js';
    export { getProjectCodeFromBcp47 } from '${projectRoot}/src/common/language-config.js';
`;

async function loadModules() {
    return bundleModule(MODULE_EXPORTS, { prefix: 'foxlate-quality-test-' });
}

test('术语表按整词匹配：不再把 classifications 变成 classifi猫ions', async () => {
    const { applyGlossaryToText } = await loadModules();
    const glossary = { enabled: true, entries: [{ source: 'cat', target: '猫', caseSensitive: false }] };

    assert.equal(applyGlossaryToText('classifications and categories', glossary), 'classifications and categories');
    assert.equal(applyGlossaryToText('the cat sat', glossary), 'the 猫 sat');
    assert.equal(applyGlossaryToText('Cat.', glossary), '猫.');
    assert.equal(applyGlossaryToText('concat(1, 2)', glossary), 'concat(1, 2)');
});

test('术语表不会破坏 <tN> 这类翻译占位标签', async () => {
    const { applyGlossaryToText } = await loadModules();
    // 单字母术语 t 以前会把 `<t0>` 打成 `<X0>`，整段译文随后因无 translator 标签退化成纯文本。
    const glossary = { enabled: true, entries: [{ source: 't', target: 'X', caseSensitive: false }] };

    assert.equal(applyGlossaryToText('a <t0>b</t0> c', glossary), 'a <t0>b</t0> c');
});

test('中文术语仍然按子串匹配（中文没有词边界）', async () => {
    const { applyGlossaryToText } = await loadModules();
    const glossary = { enabled: true, entries: [{ source: '机器学习', target: 'machine learning', caseSensitive: false }] };

    assert.equal(applyGlossaryToText('深度机器学习框架', glossary), '深度machine learning框架');
});

test('阿拉伯语/泰语文本能被识别成受支持语言', async () => {
    const { detectProjectLang } = await loadModules();

    // 阿语页实测 33 个候选全部因为「检测不出 → 不支持」被跳过。
    assert.equal(detectProjectLang('مرحبا بالعالم، هذا نص عربي طويل بما يكفي').projectCode, 'AR');
    assert.equal(detectProjectLang('สวัสดีชาวโลก นี่คือข้อความภาษาไทย').projectCode, 'TH');
    assert.equal(detectProjectLang('שלום עולם זהו טקסט בעברית').projectCode, 'HE');
});

test('含符号的英文不再被误判为「不可识别」', async () => {
    const { detectProjectLang } = await loadModules();

    // 此前字符集兜底只允许 \p{P}，`$` `|` `~` `+` `<` `>` 全落进 und → 整条被跳过。
    assert.equal(detectProjectLang('Price $5 | shipping + tax').projectCode, 'EN');
    assert.equal(detectProjectLang('a ~ b < c > d').projectCode, 'EN');
});

test('检测不出语言时按用户意图翻译，而不是静默跳过', async () => {
    const { shouldTranslate } = await loadModules();
    const settings = { targetLanguage: 'ZH' };

    // 混合脚本的正字法检测不出语言；用户点了翻译就该翻。
    assert.equal(shouldTranslate('ᚠᚢᚦᚨᚱᚲ ᚷᚨᚹᛁᛞᚨ', settings).result, true);
});

test('页面声明语言等于目标语言时，检测不出的碎片才跳过', async () => {
    const { shouldTranslate } = await loadModules();
    const settings = { targetLanguage: 'ZH' };

    assert.equal(
        shouldTranslate('ᚠᚢᚦᚨᚱᚲ', settings, false, { pageLanguage: 'ZH' }).result,
        false,
    );
    assert.equal(
        shouldTranslate('ᚠᚢᚦᚨᚱᚲ', settings, false, { pageLanguage: 'EN' }).result,
        true,
    );
});

test('目标语言文本不会被送去翻译', async () => {
    const { shouldTranslate } = await loadModules();

    assert.equal(shouldTranslate('这是一段中文文本内容', { targetLanguage: 'ZH' }).result, false);
    assert.equal(shouldTranslate('This is English text', { targetLanguage: 'EN' }).result, false);
    assert.equal(shouldTranslate('This is English text', { targetLanguage: 'ZH' }).result, true);
});

test('页面 lang 属性映射到项目语言代码', async () => {
    const { getProjectCodeFromBcp47 } = await loadModules();

    assert.equal(getProjectCodeFromBcp47('zh-CN'), 'ZH');
    assert.equal(getProjectCodeFromBcp47('zh-TW'), 'ZH');
    assert.equal(getProjectCodeFromBcp47('en'), 'EN');
    assert.equal(getProjectCodeFromBcp47('ar-SA'), 'AR');
    assert.equal(getProjectCodeFromBcp47('klingon'), null);
    assert.equal(getProjectCodeFromBcp47(''), null);
});
