export class SubtitleRenderer {
    constructor({ documentRef = document } = {}) {
        this.document = documentRef;
    }

    displayTranslatedSubtitle(originalElement, translatedText, isError = false) {
        if (!originalElement || !this.document.body.contains(originalElement)) return;

        const containerClass = 'foxlate-subtitle-translation-container';
        let translationContainer = originalElement.querySelector(`.${containerClass}`);

        if (!translationContainer) {
            translationContainer = this.document.createElement('div');
            translationContainer.className = containerClass;
            translationContainer.style.cssText = 'text-align: center; font-size: 0.9em; opacity: 0.85; margin-top: 4px; pointer-events: none;';
            originalElement.appendChild(translationContainer);
        }

        translationContainer.textContent = translatedText;
        translationContainer.classList.toggle('error', isError);
        translationContainer.style.color = isError ? '#FF5252' : '#42a5f5';
    }
}
