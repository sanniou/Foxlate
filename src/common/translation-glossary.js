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

export function applyGlossaryToText(text, glossary = {}) {
    if (typeof text !== 'string' || !text) return text || '';

    const normalized = normalizeGlossary(glossary);
    if (!normalized.enabled || normalized.entries.length === 0) {
        return text;
    }

    return normalized.entries.reduce((nextText, entry) => {
        const flags = entry.caseSensitive ? 'g' : 'gi';
        const pattern = new RegExp(escapeRegExp(entry.source), flags);
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
