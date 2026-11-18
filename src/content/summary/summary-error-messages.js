import browser from '../../lib/browser-polyfill.js';

/**
 * 摘要/追问失败时的用户可见文案。
 *
 * 这些文案曾经以中文字面量写死在本文件里——英文界面用户看到的是中文报错。
 * 现在统一走 `browser.i18n`，文案实体在 `public/_locales/<locale>/messages.json`。
 * `errorKey` 的写法是刻意的：`test/i18n-integrity.test.mjs` 会扫描
 * `errorKey: '...'` 处的字面量，保证 key 在 en 与 zh_CN 两侧都存在。
 */
const ERROR_MESSAGES = {
    network: { errorKey: 'summaryErrorNetwork' },
    timeout: { errorKey: 'summaryErrorTimeout' },
    auth: { errorKey: 'summaryErrorAuth' },
    rate_limit: { errorKey: 'summaryErrorRateLimit' },
    content_empty: { errorKey: 'summaryErrorContentEmpty' },
    server_error: { errorKey: 'summaryErrorServer' },
    unknown: { errorKey: 'summaryErrorUnknown' },
};

export function classifySummaryError(error) {
    const message = String(error?.message || '').toLowerCase();

    if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
        return 'network';
    }
    if (message.includes('timeout') || message.includes('time out')) {
        return 'timeout';
    }
    if (message.includes('unauthorized') || message.includes('auth') || message.includes('401') || message.includes('403')) {
        return 'auth';
    }
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
        return 'rate_limit';
    }
    if (message.includes('empty') || message.includes('no content') || message.includes('failed to extract')) {
        return 'content_empty';
    }
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('server error')) {
        return 'server_error';
    }

    return 'unknown';
}

function getMessage(key) {
    // key 缺失时直接暴露 key 本身，而不是渲染成空白提示——空白会让「翻译文件漏了一行」
    // 看起来像「请求成功但没有内容」。
    return browser.i18n.getMessage(key) || key;
}

export function generateUserFriendlySummaryError(error) {
    const errorType = classifySummaryError(error);
    const body = getMessage(ERROR_MESSAGES[errorType].errorKey);
    const details = error?.message || getMessage('summaryErrorNoMessage');
    return `${body}\n\n${getMessage('summaryErrorDetails')}${details}`;
}
