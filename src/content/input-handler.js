import browser from '../lib/browser-polyfill.js';

let spacePressCount = 0;
let lastSpacePressTime = 0;
const TRIPLE_SPACE_INTERVAL = 500; // ms

async function handleTripleSpace(event) {
    if (event.code !== 'Space') {
        spacePressCount = 0;
        return;
    }

    const target = event.target;
    const isInputElement = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    // Also check for contentEditable elements, which are common in rich text editors
    const isContentEditable = target.isContentEditable;

    if (!isInputElement && !isContentEditable) {
        spacePressCount = 0;
        return;
    }

    const currentTime = Date.now();
    if (currentTime - lastSpacePressTime > TRIPLE_SPACE_INTERVAL) {
        spacePressCount = 1;
    } else {
        spacePressCount++;
    }
    lastSpacePressTime = currentTime;

    if (spacePressCount === 3) {
        spacePressCount = 0;
        event.preventDefault();

        const originalText = isContentEditable ? target.textContent : target.value;
        if (!originalText || !originalText.trim()) {
            return;
        }

        // Visually indicate translation is in progress
        const originalBackgroundColor = target.style.backgroundColor;
        target.style.backgroundColor = '#f0f8ff'; // A light blue indicator

        try {
            const result = await browser.runtime.sendMessage({
                type: 'translateInputText',
                payload: {
                    text: originalText
                }
            });

            if (result && result.translatedText) {
                if (isContentEditable) {
                    target.textContent = result.translatedText;
                } else {
                    target.value = result.translatedText;
                }
            }
        } catch (error) {
            console.error('Foxlate: Input translation failed.', error);
        } finally {
            // Restore original background color
            target.style.backgroundColor = originalBackgroundColor;
        }
    }
}

export function initializeInputHandler() {
    document.addEventListener('keydown', handleTripleSpace, true);
}
