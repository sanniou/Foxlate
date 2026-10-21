import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const localesDir = path.join(projectRoot, 'public/_locales');

const messageCache = new Map();

/**
 * 读取真实的本地化消息表，而不是手写一份假数据。
 * @param {'en' | 'zh_CN'} locale
 */
export function loadMessages(locale = 'en') {
    if (!messageCache.has(locale)) {
        messageCache.set(locale, JSON.parse(
            fs.readFileSync(path.join(localesDir, locale, 'messages.json'), 'utf8'),
        ));
    }
    return messageCache.get(locale);
}

/**
 * 与 WebExtension `browser.i18n.getMessage` 契约一致的实现。
 *
 * 关键点：**缺失的 key 返回空字符串**，这是真实浏览器的行为。
 * 在此之前，各测试文件普遍使用 `(key) => key` 作为 mock —— 这把
 * 「key 未定义 → 界面渲染出空文本」这一类缺陷完全遮住了，
 * 导致 15 个缺失的 i18n key 连续通过了多个版本的测试。
 *
 * @param {{ locale?: 'en' | 'zh_CN' }} [options]
 */
export function createI18nMock({ locale = 'en' } = {}) {
    const messages = loadMessages(locale);
    return {
        getMessage(key, substitutions) {
            return formatMessage(messages, key, substitutions);
        },
        getUILanguage() {
            return locale === 'zh_CN' ? 'zh-CN' : 'en-US';
        },
    };
}

function formatMessage(messages, key, substitutions) {
    const entry = messages[key];
    if (!entry) return '';

    const list = Array.isArray(substitutions)
        ? substitutions
        : (substitutions === undefined || substitutions === null ? [] : [substitutions]);

    let message = entry.message;
    list.forEach((value, index) => {
        message = message.split('$' + (index + 1)).join(String(value ?? ''));
    });
    return message;
}

/**
 * 生成一段可直接内联进 esbuild 临时入口源码的 i18n mock 表达式。
 *
 * 刻意做成**表达式**（IIFE）：这样才能既用作对象属性值（`i18n: <expr>`），
 * 又不会把 `node:fs` 之类的宿主依赖拖进 `platform: 'browser'` 的测试 bundle。
 * @param {{ locale?: 'en' | 'zh_CN', bindingName?: string }} [options]
 */
export function inlineI18nMockSource({ locale = 'en', bindingName } = {}) {
    const messages = JSON.stringify(loadMessages(locale));
    const expression = `(() => {
        const messages = ${messages};
        return {
            getMessage(key, substitutions) {
                const entry = messages[key];
                if (!entry) return '';
                const list = Array.isArray(substitutions)
                    ? substitutions
                    : (substitutions === undefined || substitutions === null ? [] : [substitutions]);
                let message = entry.message;
                list.forEach((value, index) => {
                    message = message.split('$' + (index + 1)).join(String(value ?? ''));
                });
                return message;
            },
            getUILanguage() { return '${locale === 'zh_CN' ? 'zh-CN' : 'en-US'}'; },
        };
    })()`;

    return bindingName ? `const ${bindingName} = ${expression};` : expression;
}

/** 便于断言：取出某个 key 的真实英文文本。 */
export function englishMessage(key) {
    return loadMessages('en')[key]?.message ?? '';
}
