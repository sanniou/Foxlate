/**
 * 字幕片段的拼接策略。
 *
 * YouTube 与 Bilibili 都会把一句话切成多个片段（逐个 timedtext event / 逐个 span）。
 * 这些片段之间的边界是「渲染换行」而不是「词边界」，因此不能无脑补空格：
 * 中文句子里逐段加空格会渲染成「第一句 结束。」，看上去像输入法漏字。
 *
 * 注意这里和 `text-measurement.js` 的 `CJK_CHAR_REGEX` 是两件事，故意不合并：
 * 那边判断的是「能否在任意字间断行」（韩文谚文按词断行，不算），
 * 这边判断的是「该脚本在片段边界会不会用到空格」（韩文同样不用，算）。
 */

/** 片段边界不补空格的脚本：中日韩表意文字、假名、谚文、全角标点与 CJK 标点。 */
const NO_SPACE_SCRIPT = /[\u1100-\u11FF\u2E80-\u9FFF\uA960-\uA97F\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;

/**
 * 拼接同一句话的多个片段，只在确实需要词间空格时才补一个空格。
 *
 * @param {Array<string|null|undefined>} fragments 按显示顺序排列的片段
 * @returns {string} 拼接并去掉首尾空白的结果
 */
export function joinSubtitleFragments(fragments) {
    let result = '';

    for (const fragment of fragments) {
        const text = String(fragment ?? '');
        if (!text) continue;

        const needsSpace = result
            && !/\s$/.test(result)
            && !/^\s/.test(text)
            && !NO_SPACE_SCRIPT.test(result[result.length - 1])
            && !NO_SPACE_SCRIPT.test(text[0]);

        result += needsSpace ? ` ${text}` : text;
    }

    return result.trim();
}
