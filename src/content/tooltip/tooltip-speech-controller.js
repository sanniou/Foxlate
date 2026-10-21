import { detectSpeechLang, loadLanguageDetector } from '../../common/lang-detect.js';
import { createTooltipIcon } from './tooltip-icons.js';

export class TooltipSpeechController {
    #speechSynthesis;
    #currentUtterance = null;
    #isPlaying = false;
    #currentLanguage = 'auto';
    #sourceLang = 'auto';
    #targetLang = null;
    // 每次朗读/停止都自增，使等待异步资源（franc）期间发生的旧调用失效。
    #speakToken = 0;

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
        void this.#speak(text, language, tooltipEl, browserApi);
    }

    stop(tooltipEl, browserApi) {
        this.#speakToken++;
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

    async #speak(text, language, tooltipEl, browserApi) {
        this.stop(tooltipEl, browserApi);
        if (!text || !text.trim() || !this.#speechSynthesis) return;

        const token = this.#speakToken;
        let resolvedLang = this.#sourceLang;
        if (language === 'target') {
            resolvedLang = this.#targetLang;
        } else if (this.#sourceLang === 'auto') {
            // franc 是按需加载资源；先等它就绪再判定语种，避免用启发式规则误报。
            await loadLanguageDetector();
            if (token !== this.#speakToken) return; // 等待期间用户已重新操作
            resolvedLang = detectSpeechLang(text);
        }

        this.#currentUtterance = new SpeechSynthesisUtterance(text);
        this.#currentUtterance.lang = resolvedLang;

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
