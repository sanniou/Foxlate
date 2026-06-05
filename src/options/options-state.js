import * as Constants from '../common/constants.js';

function parseNonNegativeInteger(value, fallback) {
    const parsed = parseInt(value, 10);
    return !isNaN(parsed) && parsed >= 0 ? parsed : fallback;
}

export function rootReducer(currentState, action) {
    switch (action.type) {
        case 'SET_FULL_STATE':
            return action.payload;
        case 'SET_TRANSLATOR_ENGINE':
            if (currentState.translatorEngine === action.payload) return currentState;
            return { ...currentState, translatorEngine: action.payload };
        case 'SET_TARGET_LANGUAGE':
            return { ...currentState, targetLanguage: action.payload };
        case 'SET_DISPLAY_MODE':
            return { ...currentState, displayMode: action.payload };
        case 'SET_SCROLL_IDLE_TRANSLATION':
            return { ...currentState, translateAfterScrollIdle: action.payload };
        case 'SET_SCROLL_IDLE_DELAY':
            return {
                ...currentState,
                scrollIdleDelayMs: parseNonNegativeInteger(action.payload, Constants.DEFAULT_SETTINGS.scrollIdleDelayMs),
            };
        case 'SET_DEEPLX_URL':
            return { ...currentState, deeplxApiUrl: action.payload };
        case 'SET_CACHE_SIZE': {
            const cacheSize = parseNonNegativeInteger(action.payload, Constants.DEFAULT_SETTINGS.cacheSize);
            if (currentState.cacheSize === cacheSize) return currentState;
            return { ...currentState, cacheSize };
        }
        case 'SET_SYNC_ENABLED':
            return { ...currentState, syncEnabled: action.payload };
        case 'SET_DEFAULT_SELECTOR':
            return {
                ...currentState,
                translationSelector: {
                    ...currentState.translationSelector,
                    default: {
                        ...currentState.translationSelector.default,
                        [action.payload.key]: action.payload.value,
                    },
                },
            };
        case 'SET_DOMAIN_RULES':
            return { ...currentState, domainRules: action.payload };
        case 'SET_INPUT_TRANSLATION_SETTING': {
            const { key, value } = action.payload;
            return {
                ...currentState,
                inputTranslationSettings: {
                    ...currentState.inputTranslationSettings,
                    [key]: value,
                },
            };
        }
        default:
            return currentState;
    }
}

export function diffState(oldState, newState) {
    const changes = new Set();
    if (!oldState) return new Set(Object.keys(newState));

    const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);
    for (const key of allKeys) {
        if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
            changes.add(key);
        }
    }
    return changes;
}
