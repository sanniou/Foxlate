export async function setBadgeAndState({
    browserApi,
    tabStateManager,
}, tabId, state) {
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
            badgeColor = '#6750A4';
            break;
        case 'translated':
            badgeText = '✓';
            badgeColor = '#006D3D';
            break;
        default:
            break;
    }

    await browserApi.action.setBadgeText({ tabId, text: badgeText });
    if (badgeText) {
        await browserApi.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
    }
}
