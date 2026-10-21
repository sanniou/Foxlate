import { getSpeechCode } from '../../common/language-config.js';

export async function resolveDisplayLanguageContext(displayMode, {
    getEffectiveSettings = () => window.getEffectiveSettings?.(),
} = {}) {
    if (displayMode !== 'enhancedContextMenu') {
        return {};
    }

    const settings = await getEffectiveSettings();
    return {
        langConfig: {
            sourceLang: !settings.sourceLanguage || settings.sourceLanguage === 'auto'
                ? 'auto'
                : getSpeechCode(settings.sourceLanguage),
            targetLang: getSpeechCode(settings.targetLanguage),
        },
    };
}
