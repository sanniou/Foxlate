import * as Constants from '../../common/constants.js';

export function isSupportedInputElement(target) {
    if (target?.tagName === 'TEXTAREA') return true;
    return target?.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel'].includes(target.type || 'text');
}

export function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
}

const SENTENCE_END_PUNCTUATION = new Set(['。', '！', '？']);

/**
 * 判断某个位置是否是真正的句子边界。
 *
 * ASCII 的 `.` / `!` / `?` 只有在后面是空白或文本末尾时才算边界，
 * 否则 `example.com`、`3.14`、`v1.2.3` 都会被错误切断。
 */
function isSentenceBoundary(text, index, end) {
    const char = text[index];
    if (char === '\n' || SENTENCE_END_PUNCTUATION.has(char)) return true;
    if (char !== '.' && char !== '!' && char !== '?') return false;

    const next = text[index + 1];
    return index + 1 === end || /\s/.test(next);
}

export function getLastSentence(fullText) {
    const text = fullText || '';

    // 触发键本身可能还没进入 value，末尾会带空格；先去掉再找句子边界，
    // 这样 `Hello.  ` 不会因为句号后只剩空白而丢掉整句。
    let end = text.length;
    while (end > 0 && /\s/.test(text[end - 1])) end--;
    if (end === 0) return { text: '', index: text.length };

    const boundaries = [];
    for (let i = 0; i < end; i++) {
        if (isSentenceBoundary(text, i, end)) boundaries.push(i);
    }

    // 取最后一个“后面确实还有正文”的边界；如果句号就在末尾，
    // 说明它是上一句的结束符，不能返回空字符串。
    let start = 0;
    for (let i = boundaries.length - 1; i >= 0; i--) {
        const boundary = boundaries[i];
        if (text.slice(boundary + 1, end).trim()) {
            start = boundary + 1;
            break;
        }
    }

    return {
        text: text.substring(start, end),
        index: start,
    };
}

export function getTextContent(target) {
    return isSupportedInputElement(target) ? target.value || '' : '';
}

export function replaceTextContent(target, text, range = null) {
    if (!isSupportedInputElement(target)) return;

    if (range && typeof range.start === 'number' && typeof range.end === 'number') {
        try {
            target.setRangeText(text, range.start, range.end, 'end');
        } catch (error) {
            console.error('[Foxlate] Failed to set range text:', error);
            const original = target.value;
            target.value = original.substring(0, range.start) + text + original.substring(range.end);
        }
        return;
    }

    target.value = text;
}

export function shouldAppendKey(key) {
    return key.length === 1 || key === 'Space' || key === 'Enter';
}

/** 光标位置；部分 input 类型（如 number）读它会抛异常，此时返回 null。 */
export function getSelectionStart(target) {
    try {
        return target.selectionStart;
    } catch {
        return null;
    }
}

export function getKeyRepresentation(key) {
    switch (key) {
        case 'Space':
            return ' ';
        case 'Enter':
            return '\n';
        case 'Tab':
            return '\t';
        default:
            return key.length === 1 ? key : '';
    }
}

export function resolveTargetLanguageOverride(langAlias, settings) {
    if (!langAlias) return null;

    if (settings.languageMapping?.[langAlias]) {
        return settings.languageMapping[langAlias];
    }

    if (Constants.SUPPORTED_LANGUAGES[langAlias]) {
        return langAlias;
    }

    if (Object.values(Constants.SUPPORTED_LANGUAGES).includes(langAlias)) {
        return Object.keys(Constants.SUPPORTED_LANGUAGES).find(
            key => Constants.SUPPORTED_LANGUAGES[key] === langAlias
        ) || null;
    }

    return null;
}
