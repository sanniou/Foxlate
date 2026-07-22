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
            badgeColor = '#0891b2';
            break;
        case 'translated':
            if (emptyCandidates) {
                // Job finished but extract matched nothing — not a hard error.
                badgeText = '0';
                badgeColor = '#f59e0b';
            } else {
                badgeText = '✓';
                badgeColor = '#10b981';
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
