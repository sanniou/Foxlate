import * as Constants from '../../common/constants.js';

export function debounce(func, wait) {
    let timeout;
    return function debouncedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function isSupportedInputElement(target) {
    return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
}

export function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
}

export function getLastSentence(fullText) {
    const lastPeriodIndex = Math.max(
        fullText.lastIndexOf('.'),
        fullText.lastIndexOf('。')
    );

    if (lastPeriodIndex === -1) {
        return { text: fullText, index: 0 };
    }

    return {
        text: fullText.substring(lastPeriodIndex + 1),
        index: lastPeriodIndex + 1,
    };
}

export function getTextContent(target) {
    return isSupportedInputElement(target) ? target.value || '' : '';
}

export function replaceTextContent(target, text, range = null) {
    if (!isSupportedInputElement(target)) return;

    if (range && typeof range.start === 'number' && typeof range.end === 'number') {
        try {
            target.setRangeText(text, range.start, range.end, 'end');
        } catch (error) {
            console.error('[Foxlate] Failed to set range text:', error);
            const original = target.value;
            target.value = original.substring(0, range.start) + text + original.substring(range.end);
        }
        return;
    }

    target.value = text;
}

export function shouldAppendKey(key) {
    return key.length === 1 || key === 'Space' || key === 'Enter';
}

export function getKeyRepresentation(key) {
    switch (key) {
        case 'Space':
            return ' ';
        case 'Enter':
            return '\n';
        case 'Tab':
            return '\t';
        default:
            return key.length === 1 ? key : '';
    }
}

export function resolveTargetLanguageOverride(langAlias, settings) {
    if (!langAlias) return null;

    if (settings.languageMapping?.[langAlias]) {
        return settings.languageMapping[langAlias];
    }

    if (Constants.SUPPORTED_LANGUAGES[langAlias]) {
        return langAlias;
    }

    if (Object.values(Constants.SUPPORTED_LANGUAGES).includes(langAlias)) {
        return Object.keys(Constants.SUPPORTED_LANGUAGES).find(
            key => Constants.SUPPORTED_LANGUAGES[key] === langAlias
        ) || null;
    }

    return null;
}
