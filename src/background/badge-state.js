// 徽标颜色只能写字面量：`action.setBadgeBackgroundColor` 不接受 CSS 变量。
// 这三个取值与 `src/common/tokens.css` 的品牌原语一一对应，由
// `test/design-system.test.mjs` 逐值门禁，防止两处各自漂移。
const BADGE_COLORS = {
    loading: '#0891b2', // --fox-color-primary
    success: '#10b981', // --fox-color-success
    empty: '#f59e0b', // --fox-color-warning
};

export async function setBadgeAndState({
    browserApi,
    tabStateManager,
}, tabId, state, { emptyCandidates = false } = {}) {
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
