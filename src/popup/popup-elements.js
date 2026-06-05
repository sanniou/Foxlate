export function queryPopupElements(root = document) {
    return {
        sourceLanguageSelect: root.getElementById('sourceLanguageSelect'),
        targetLanguageSelect: root.getElementById('targetLanguageSelect'),
        engineSelect: root.getElementById('engineSelect'),
        displayModeSelect: root.getElementById('displayModeSelect'),
        translatePageBtn: root.getElementById('translatePageBtn'),
        autoTranslateCheckbox: root.getElementById('autoTranslate'),
        scrollIdleTranslationCheckbox: root.getElementById('scrollIdleTranslation'),
        currentRuleIndicator: root.getElementById('currentRuleIndicator'),
        openOptionsBtn: root.getElementById('openOptionsBtn'),
        swapLanguagesBtn: root.getElementById('swapLanguagesBtn'),
        subtitleDisplayModeSelect: root.getElementById('subtitleDisplayModeSelect'),
        subtitleControlsSection: root.querySelector('.subtitle-section'),
        versionDisplay: root.getElementById('versionDisplay'),
        errorDisplay: root.getElementById('error-display'),
    };
}
