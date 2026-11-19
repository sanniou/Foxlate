// 徽标颜色只能写字面量：`action.setBadgeBackgroundColor` 不接受 CSS 变量。
// 这三个取值与 `src/common/tokens.css` 的品牌原语一一对应，由
// `test/design-system.test.mjs` 逐值门禁，防止两处各自漂移。
export const BADGE_COLORS = {
    loading: '#0e7490', // --fox-color-primary
    success: '#047857', // --fox-color-success
    empty: '#b45309', // --fox-color-warning
    failed: '#be123c', // --fox-color-error
};

export async function setBadgeAndState({
    browserApi,
    tabStateManager,
}, tabId, state, { emptyCandidates = false, failedCount = 0, completedCount = 0 } = {}) {
    await tabStateManager.setTabStatus(tabId, state);

    if (state === 'original' || !state) {
        await browserApi.action.setBadgeText({ tabId, text: '' });
        return;
    }

    let badgeText = '';
    let badgeColor = '';
    switch (state) {
        case 'loading':
            badgeText = '...';
            badgeColor = BADGE_COLORS.loading;
            break;
        case 'translated':
            if (emptyCandidates) {
                // Job finished but extract matched nothing — not a hard error.
                badgeText = '0';
                badgeColor = BADGE_COLORS.empty;
            } else if (failedCount > 0 && completedCount === 0) {
                // 每一段都失败了（密钥无效、网络不通、被限流……）。打勾会让用户以为
                // 页面已经翻译好，结果只看到满屏红色下划线而不知道为什么。
                badgeText = '!';
                badgeColor = BADGE_COLORS.failed;
            } else {
                badgeText = '✓';
                badgeColor = BADGE_COLORS.success;
            }
            break;
        default:
            break;
    }

    await browserApi.action.setBadgeText({ tabId, text: badgeText });
    if (badgeText) {
        await browserApi.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
    }
}
