import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { bundleModule, projectRoot } from './helpers/bundle.mjs';

/**
 * 摘要错误文案必须跟着界面语言走。
 *
 * 原来的实现把中文写死在 `src/content/summary/summary-error-messages.js` 里，英文界面
 * 的用户看到的是整段中文报错。key 是否存在由 `test/i18n-integrity.test.mjs` 兜底，
 * 这里管「渲染出来的到底是哪种语言」——那是 key 存在性检查看不见的部分。
 */
async function loadMessages(locale) {
    const raw = await readFile(path.join(projectRoot, `public/_locales/${locale}/messages.json`), 'utf8');
    return JSON.parse(raw);
}

async function loadErrorMessages(locale) {
    const messages = await loadMessages(locale);
    globalThis.__foxlateBrowserMock = {
        i18n: {
            getMessage(key) {
                return messages[key]?.message ?? '';
            },
        },
    };

    return bundleModule(`
        export { generateUserFriendlySummaryError, classifySummaryError } from ${JSON.stringify(
            path.join(projectRoot, 'src/content/summary/summary-error-messages.js'),
        )};
    `);
}

const CJK = /[\u4e00-\u9fa5]/;

test('英文界面渲染英文摘要错误，且不回退成中文', async () => {
    const { generateUserFriendlySummaryError } = await loadErrorMessages('en');

    for (const error of [
        new Error('Failed to fetch'),
        new Error('Request timeout'),
        new Error('401 Unauthorized'),
        new Error('429 Too Many Requests'),
        new Error('Failed to extract any meaningful content.'),
        new Error('502 server error'),
        new Error('something odd'),
    ]) {
        const rendered = generateUserFriendlySummaryError(error);
        assert.doesNotMatch(rendered, CJK, `英文界面出现了中文: ${rendered}`);
        assert.match(rendered, /Details: /);
        assert.match(rendered, /^\\*\\*/, '标题必须是加粗的 markdown 标题');
        assert.ok(rendered.includes(error.message), `原始错误信息必须原样保留: ${rendered}`);
    }
});

test('中文界面渲染中文摘要错误', async () => {
    const { generateUserFriendlySummaryError } = await loadErrorMessages('zh_CN');

    const rendered = generateUserFriendlySummaryError(new Error('Failed to fetch'));
    assert.match(rendered, CJK);
    assert.match(rendered, /详细信息：/);
});

test('错误对象没有 message 时不渲染 undefined', async () => {
    const { generateUserFriendlySummaryError } = await loadErrorMessages('en');

    const rendered = generateUserFriendlySummaryError(new Error(''));
    assert.doesNotMatch(rendered, /undefined/);
    assert.match(rendered, /Unknown error/);
});
