import { detectSpeechLang } from '../../common/utils.js';
import { createTooltipIcon } from './tooltip-icons.js';

export class TooltipSpeechController {
    #speechSynthesis;
    #currentUtterance = null;
    #isPlaying = false;
    #currentLanguage = 'auto';
    #sourceLang = 'auto';
    #targetLang = null;

    constructor({ speechSynthesis = window.speechSynthesis } = {}) {
        this.#speechSynthesis = speechSynthesis;
    }

    configure({ sourceLang = 'auto', targetLang }) {
        this.#sourceLang = sourceLang;
        this.#targetLang = targetLang;
    }

    toggle(text, language, tooltipEl, browserApi) {
        if (this.#isPlaying && this.#currentLanguage === language) {
            this.stop(tooltipEl, browserApi);
            return;
        }

        this.#currentLanguage = language;
        this.#speak(text, language, tooltipEl, browserApi);
    }

    stop(tooltipEl, browserApi) {
        if (this.#speechSynthesis?.speaking) {
            this.#speechSynthesis.cancel();
        }
        this.#isPlaying = false;
        this.#currentUtterance = null;
        this.updateButtons(tooltipEl, browserApi);
    }

    updateButtons(tooltipEl, browserApi) {
        if (!tooltipEl) return;

        const updateButton = (selector, lang) => {
            const btn = tooltipEl.querySelector(selector);
            if (!btn) return;

            const isThisPlaying = this.#isPlaying && this.#currentLanguage === lang;
            btn.innerHTML = '';
            btn.appendChild(createTooltipIcon(isThisPlaying ? 'stop' : 'play'));
            btn.title = browserApi.i18n.getMessage(isThisPlaying ? 'tooltipStopReading' : (lang === 'source' ? 'tooltipReadSource' : 'tooltipReadTarget'));
            btn.classList.toggle('playing', isThisPlaying);
        };

        updateButton('.source-speech-btn', 'source');
        updateButton('.target-speech-btn', 'target');
    }

    #speak(text, language, tooltipEl, browserApi) {
        this.stop(tooltipEl, browserApi);
        if (!text || !text.trim() || !this.#speechSynthesis) return;

        this.#currentUtterance = new SpeechSynthesisUtterance(text);
        this.#currentUtterance.lang = language === 'target'
            ? this.#targetLang
            : (this.#sourceLang === 'auto' ? detectSpeechLang(text) : this.#sourceLang);

        this.#currentUtterance.onstart = () => {
            this.#isPlaying = true;
            this.updateButtons(tooltipEl, browserApi);
        };

        this.#currentUtterance.onend = () => {
            this.#isPlaying = false;
            this.#currentUtterance = null;
            this.updateButtons(tooltipEl, browserApi);
        };

        this.#currentUtterance.onerror = (event) => {
            console.error('[EnhancedTooltipManager] Speech synthesis error:', event);
            this.#isPlaying = false;
            this.#currentUtterance = null;
            this.updateButtons(tooltipEl, browserApi);
        };

        this.#speechSynthesis.speak(this.#currentUtterance);
    }
}
