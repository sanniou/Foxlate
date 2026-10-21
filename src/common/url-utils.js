/**
 * 从 URL 中提取主机名。
 *
 * 原本 popup 与 background 各写了一份 `new URL(url).hostname` + try/catch，
 * 只是失败时的返回值不同（`null` vs `''`），调用方各自适配即可。
 *
 * @param {string | undefined | null} url 完整 URL
 * @returns {string | null} 主机名；无法解析时返回 null
 */
export function getHostnameFromUrl(url) {
    if (typeof url !== 'string' || url === '') {
        return null;
    }

    try {
        const { hostname } = new URL(url);
        return hostname || null;
    } catch {
        return null;
    }
}
