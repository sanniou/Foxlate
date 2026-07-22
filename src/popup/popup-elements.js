export function queryPopupElements(root = document) {
    return {
        sourceLanguageSelect: root.getElementById('sourceLanguageSelect'),
        targetLanguageSelect: root.getElementById('targetLanguageSelect'),
        engineSelect: root.getElementById('engineSelect'),
        displayModeGroup: root.getElementById('displayModeGroup'),
        displayModeButtons: Array.from(root.querySelectorAll('#displayModeGroup [data-mode]')),
        translatePageBtn: root.getElementById('translatePageBtn'),
        autoTranslateCheckbox: root.getElementById('autoTranslate'),
        scrollIdleTranslationCheckbox: root.getElementById('scrollIdleTranslation'),
        currentRuleIndicator: root.getElementById('currentRuleIndicator'),
        glossaryIndicator: root.getElementById('glossaryIndicator'),
        openOptionsBtn: root.getElementById('openOptionsBtn'),
        swapLanguagesBtn: root.getElementById('swapLanguagesBtn'),
        subtitleDisplayModeSelect: root.getElementById('subtitleDisplayModeSelect'),
        subtitleControlsSection: root.querySelector('.subtitle-section'),
        versionDisplay: root.getElementById('versionDisplay'),
        errorDisplay: root.getElementById('error-display'),
    };
}
