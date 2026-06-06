export async function resolveDisplayLanguageContext(displayMode, {
    getEffectiveSettings = () => window.getEffectiveSettings?.(),
} = {}) {
    if (displayMode !== 'enhancedContextMenu') {
        return {};
    }

    const settings = await getEffectiveSettings();
    const { getSpeechCode } = await import('../../common/utils.js');
    return {
        langConfig: {
            sourceLang: !settings.sourceLanguage || settings.sourceLanguage === 'auto'
                ? 'auto'
                : getSpeechCode(settings.sourceLanguage),
            targetLang: getSpeechCode(settings.targetLanguage),
        },
    };
}
