export function normalizeGlossary(glossary = {}) {
    const entries = Array.isArray(glossary.entries)
        ? glossary.entries
            .map(entry => ({
                source: String(entry.source || '').trim(),
                target: String(entry.target || entry.source || '').trim(),
                caseSensitive: !!entry.caseSensitive,
            }))
            .filter(entry => entry.source && entry.target)
        : [];

    return {
        enabled: glossary.enabled !== false,
        entries,
    };
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ASCII_WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * 构造一条术语匹配的正则。
 *
 * 拉丁词必须整词匹配：以前是裸子串正则，实测在 15 万字真实语料上 `cat` 假匹配率 **100%**
 * （全部命中 `classifications` / `categories` 内部），`cat => 猫` 真的把
 * `classifications` 变成 `classifi猫ions`；`he` 假匹配 99.6%、`AI` 96.6%。
 *
 * 以拉丁字母/数字开头或结尾时才加边界断言；中文等非 ASCII 术语保持子串匹配
 * （中文没有词边界，加 `\b` 等于禁用该术语）。
 *
 * @param {string} source 术语原文
 * @param {boolean} caseSensitive 是否区分大小写
 * @returns {RegExp}
 */
function buildGlossaryPattern(source, caseSensitive) {
    const escaped = escapeRegExp(source);
    const leading = ASCII_WORD_CHAR.test(source[0]) ? '(?<![A-Za-z0-9_])' : '';
    const trailing = ASCII_WORD_CHAR.test(source[source.length - 1]) ? '(?![A-Za-z0-9_])' : '';
    return new RegExp(`${leading}${escaped}${trailing}`, caseSensitive ? 'gu' : 'giu');
}

export function applyGlossaryToText(text, glossary = {}) {
    if (typeof text !== 'string' || !text) return text || '';

    const normalized = normalizeGlossary(glossary);
    if (!normalized.enabled || normalized.entries.length === 0) {
        return text;
    }

    return normalized.entries.reduce((nextText, entry) => {
        const pattern = buildGlossaryPattern(entry.source, entry.caseSensitive);
        // 函数式替换：target 是用户数据，可能含 `$&`、`$'`、`$1`；作为字符串替换值
        // 时会被当成替换模式解析，把原文别的部分搬进结果。
        return nextText.replace(pattern, () => entry.target);
    }, text);
}

export function parseGlossaryEntries(value = '') {
    return String(value)
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const [source, ...targetParts] = line.split(/\s*(?:=>|=)\s*/);
            const target = targetParts.join(' => ').trim();
            return {
                source: source.trim(),
                target: target || source.trim(),
                caseSensitive: false,
            };
        })
        .filter(entry => entry.source);
}

export function formatGlossaryEntries(entries = []) {
    return entries
        .map(entry => `${entry.source || ''} => ${entry.target || entry.source || ''}`)
        .join('\n');
}
