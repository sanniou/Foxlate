export function bindPopupEvents({ elements, actions, browserApi }) {
    browserApi.runtime.onMessage.addListener((request) => {
        actions.handleRuntimeMessage(request);
    });

    elements.openOptionsBtn.addEventListener('click', () => browserApi.runtime.openOptionsPage());
    elements.translatePageBtn.addEventListener('click', () => actions.handleTranslateButtonClick());
    elements.swapLanguagesBtn.addEventListener('click', () => actions.handleSwapLanguages());
    elements.sourceLanguageSelect.addEventListener('change', event => actions.saveChangeToRule('sourceLanguage', event.target.value));
    elements.engineSelect.addEventListener('change', event => actions.saveChangeToRule('translatorEngine', event.target.value));
    elements.targetLanguageSelect.addEventListener('change', event => actions.saveChangeToRule('targetLanguage', event.target.value));
    elements.scrollIdleTranslationCheckbox.addEventListener('change', event => actions.saveChangeToRule('translateAfterScrollIdle', event.target.checked));
    elements.subtitleDisplayModeSelect.addEventListener('change', event => actions.saveChangeToRule('subtitleDisplayMode', event.target.value));
    elements.autoTranslateCheckbox.addEventListener('change', event => actions.handleAutoTranslateChange(event.target.checked));
    elements.displayModeSelect.addEventListener('change', event => actions.handleDisplayModeChange(event.target.value));
}
