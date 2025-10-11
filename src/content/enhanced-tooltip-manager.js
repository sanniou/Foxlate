import { escapeHtml, detectSpeechLang } from '../common/utils.js';
import browser from '../lib/browser-polyfill.js';

// --- Constants ---
const POSITION_OFFSET = 10;
const COPY_FEEDBACK_DURATION = 1500;

// --- SVG Icon Creation Functions ---
const ICONS = {
    close: '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
    play: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>',
    stop: '<path d="M6 6h12v12H6z"/>',
    copy: '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>',
    check: '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>',
    expand: '<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>',
    collapse: '<path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z"/>',
    pin: '<path d="M16 9V4h1V2H7v2h1v5l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>', // 竖直图钉
    unpin: '<path d="M7 2v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2V9.83l4.29-4.29c.39-.39.39-1.02 0-1.41L18.88 2.71c-.39-.39-1.02-.39-1.41 0L16 4.12V2H7z"/>' // 斜向图钉
};

function createIcon(iconName, size = 16) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.innerHTML = ICONS[iconName];
    return svg;
}

/**
 * EnhancedTooltipManager
 * Manages an advanced tooltip with features like text-to-speech, copy, and collapsible sections.
 */
class EnhancedTooltipManager {
    #tooltipEl = null;
    #activeHideHandler = null;
    #speechSynthesis = window.speechSynthesis;
    #currentUtterance = null;
    #isPlaying = false;
    #currentLanguage = 'auto'; // 'auto', 'source', or 'target'
    #sourceLang = 'auto'; // 将由 franc 检测
    #targetLang = null; // 目标语言，必须通过 show 方法的选项进行配置
    #isPinned = false;
    // 新增：用于拖动状态的属性
    #isDragging = false;
    #dragStartX = 0;
    #dragStartY = 0;
    #dragOffsetX = 0;
    #dragOffsetY = 0;

    constructor() {
        if (!this.#speechSynthesis) {
            console.warn('[EnhancedTooltipManager] Speech Synthesis API is not supported.');
        }
    }

    #createTooltip() {
        if (this.#tooltipEl) return;

        this.#tooltipEl = document.createElement('div');
        this.#tooltipEl.className = 'foxlate-enhanced-panel';
        document.body.appendChild(this.#tooltipEl);
    }

    #updatePosition({ coords, targetElement }) {
        if (!this.#tooltipEl || this.#isPinned) return;

        const tooltipRect = this.#tooltipEl.getBoundingClientRect();
        let x, y;

        if (coords) { // Context Menu positioning
            x = coords.clientX - tooltipRect.width / 2;
            y = coords.clientY + POSITION_OFFSET;

            if (y + tooltipRect.height > window.innerHeight - POSITION_OFFSET) {
                y = coords.clientY - tooltipRect.height - POSITION_OFFSET;
            }
        } else if (targetElement) { // Hover positioning
            const targetRect = targetElement.getBoundingClientRect();
            x = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
            y = targetRect.top - tooltipRect.height - 8;

            if (y < POSITION_OFFSET) {
                y = targetRect.bottom + 8;
            }
        }

        if (x + tooltipRect.width > window.innerWidth - POSITION_OFFSET) {
            x = window.innerWidth - tooltipRect.width - POSITION_OFFSET;
        }
        if (x < POSITION_OFFSET) {
            x = POSITION_OFFSET;
        }

        this.#tooltipEl.style.left = `${x}px`;
        this.#tooltipEl.style.top = `${y}px`;
    }

    hide() {
        if (this.#isPinned) return;
        if (this.#tooltipEl) {
            this.#tooltipEl.classList.remove('visible');
        }
        this.#stopSpeech();
        this.#removeHideListeners();
    }

    #removeHideListeners() {
        if (this.#activeHideHandler) {
            document.removeEventListener('click', this.#activeHideHandler, true);
            window.removeEventListener('scroll', this.#activeHideHandler, true);
            this.#activeHideHandler = null;
        }
    }

    #stopSpeech() {
        if (this.#speechSynthesis?.speaking) {
            this.#speechSynthesis.cancel();
        }
        this.#isPlaying = false;
        this.#currentUtterance = null;
        this.#updateSpeechButtons();
    }

    #speakText(text, language = 'auto') {
        this.#stopSpeech();
        if (!text || !text.trim() || !this.#speechSynthesis) return;

        this.#currentUtterance = new SpeechSynthesisUtterance(text);
        
        // 根据类型（'source' 或 'target'）设置正确的语言代码
        if (language === 'target') {
            this.#currentUtterance.lang = this.#targetLang;
        } else {
            // 对于源文本，如果未提供语言，则动态检测
            this.#currentUtterance.lang = this.#sourceLang === 'auto' ? detectSpeechLang(text) : this.#sourceLang;
        }

        this.#currentUtterance.onstart = () => {
            this.#isPlaying = true;
            this.#updateSpeechButtons();
        };

        this.#currentUtterance.onend = () => {
            this.#isPlaying = false;
            this.#currentUtterance = null;
            this.#updateSpeechButtons();
        };

        this.#currentUtterance.onerror = (event) => {
            console.error('[EnhancedTooltipManager] Speech synthesis error:', event);
            this.#isPlaying = false;
            this.#currentUtterance = null;
            this.#updateSpeechButtons();
        };

        this.#speechSynthesis.speak(this.#currentUtterance);
    }

    #updateSpeechButtons() {
        if (!this.#tooltipEl) return;

        const updateButton = (selector, lang) => {
            const btn = this.#tooltipEl.querySelector(selector);
            if (!btn) return;

            const isThisPlaying = this.#isPlaying && this.#currentLanguage === lang;
            btn.innerHTML = ''; // Clear existing icon
            btn.appendChild(createIcon(isThisPlaying ? 'stop' : 'play'));
            btn.title = browser.i18n.getMessage(isThisPlaying ? 'tooltipStopReading' : (lang === 'source' ? 'tooltipReadSource' : 'tooltipReadTarget'));
            btn.classList.toggle('playing', isThisPlaying);
        };

        updateButton('.source-speech-btn', 'source');
        updateButton('.target-speech-btn', 'target');
    }

    #createTooltipContent(sourceText, translatedText, { isLoading, isError }) {
        const fragment = document.createDocumentFragment();
        const container = document.createElement('div');
        container.className = 'foxlate-panel-content';

        // Header
        const header = document.createElement('div');
        header.className = 'foxlate-panel-header';
        const title = document.createElement('div');
        title.className = 'foxlate-panel-title';
        title.textContent = 'Foxlate';

        const actions = document.createElement('div');
        actions.className = 'foxlate-panel-actions';
        const pinBtn = this.#createIconButton('foxlate-pin-btn', 'pin', browser.i18n.getMessage('tooltipPin') || 'Pin');
        const closeBtn = this.#createIconButton('foxlate-close-btn', 'close', browser.i18n.getMessage('tooltipClose'));
        actions.append(pinBtn, closeBtn);

        header.append(title, actions);

        // Body
        const body = document.createElement('div');
        body.className = 'foxlate-panel-body';

        if (isLoading) {
            const loadingContainer = document.createElement('div');
            loadingContainer.className = 'foxlate-loading-container';
            const spinner = document.createElement('div');
            spinner.className = 'foxlate-spinner';
            const loadingText = document.createElement('div');
            loadingText.className = 'foxlate-loading-text';
            loadingText.textContent = browser.i18n.getMessage('tooltipTranslating');
            loadingContainer.append(spinner, loadingText);
            body.appendChild(loadingContainer);
        } else if (isError) {
            const errorMsg = document.createElement('div');
            errorMsg.className = 'foxlate-error-message';
            errorMsg.textContent = sourceText;
            body.appendChild(errorMsg);
        } else {
            // Target Text Section
            const targetSection = this.#createSection('target', translatedText, false);
            // Source Text Section
            const sourceSection = this.#createSection('source', sourceText, true);
            body.append(targetSection, sourceSection);
        }

        container.append(header, body);
        fragment.appendChild(container);
        return fragment;
    }

    #createSection(type, text, isCollapsed) {
        const section = document.createElement('div');
        section.className = `foxlate-text-section ${type}-section`;

        const header = document.createElement('div');
        header.className = 'foxlate-text-header';

        const label = document.createElement('span');
        label.className = 'foxlate-text-label';
        label.textContent = browser.i18n.getMessage(type === 'source' ? 'tooltipSourceText' : 'tooltipTargetText');

        const actions = document.createElement('div');
        actions.className = 'foxlate-text-actions';

        const toggleBtn = this.#createIconButton('toggle-btn', isCollapsed ? 'expand' : 'collapse', browser.i18n.getMessage(isCollapsed ? 'tooltipExpandSource' : 'tooltipCollapseSource'));
        const speechBtn = this.#createIconButton(`${type}-speech-btn`, 'play', browser.i18n.getMessage(type === 'source' ? 'tooltipReadSource' : 'tooltipReadTarget'));
        const copyBtn = this.#createIconButton(`${type}-copy-btn`, 'copy', browser.i18n.getMessage(type === 'source' ? 'tooltipCopySource' : 'tooltipCopyTarget'));

        if (isCollapsed) {
            speechBtn.disabled = true;
            copyBtn.disabled = true;
        }

        actions.append(toggleBtn, speechBtn, copyBtn);
        header.append(label, actions);

        const content = document.createElement('div');
        content.className = 'foxlate-text-content';
        content.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');

        section.append(header, content);

        if (isCollapsed) {
            section.classList.add('collapsed');
        }

        return section;
    }

    #createIconButton(className, iconName, title) {
        const button = document.createElement('button');
        button.className = `foxlate-icon-btn ${className}`;
        button.title = title;
        button.appendChild(createIcon(iconName));
        return button;
    }

    show(sourceText, translatedText, options = {}) {
        const { coords, targetElement, isLoading = false, isError = false, onHide, sourceLang, targetLang } = options;

        // 强制要求调用者提供语言参数，移除内部默认值
        if (!sourceLang || !targetLang) {
            console.error('[EnhancedTooltipManager] `sourceLang` and `targetLang` must be provided in options.');
            return; // 或者 throw new Error(...) 以更严格地中断流程
        }

        this.#createTooltip();
        if (!this.#tooltipEl) return;

        this.#sourceLang = sourceLang;
        this.#targetLang = targetLang;

        if (this.#isPinned) {
            this.#isPinned = false;
            this.#tooltipEl.classList.remove('pinned');
        }

        this.hide();

        this.#tooltipEl.innerHTML = ''; // Clear previous content
        const content = this.#createTooltipContent(sourceText, translatedText, { isLoading, isError });
        this.#tooltipEl.appendChild(content);

        this.#attachEventListeners(sourceText, translatedText, onHide);

        this.#updatePosition({ coords, targetElement });
        this.#tooltipEl.classList.add('visible');

        if (onHide) {
            this.#activeHideHandler = (e) => {
                if (this.#isPinned || !this.#tooltipEl || this.#tooltipEl.contains(e.target)) return;
                onHide();
            };
            setTimeout(() => {
                document.addEventListener('click', this.#activeHideHandler, true);
                window.addEventListener('scroll', this.#activeHideHandler, true);
            }, 0);
        }
    }

    #attachEventListeners(sourceText, translatedText, onHide) {
        if (!this.#tooltipEl) return;

        const header = this.#tooltipEl.querySelector('.foxlate-panel-header');
        const pinBtn = this.#tooltipEl.querySelector('.foxlate-pin-btn');

        this.#tooltipEl.querySelector('.foxlate-close-btn')?.addEventListener('click', (e) => {
            // 确保关闭按钮总是能工作
            e.stopPropagation();
            this.#isPinned = false;
            onHide?.();
        });

        pinBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.#isPinned = !this.#isPinned;
            this.#tooltipEl.classList.toggle('pinned', this.#isPinned);
            // 钉住后，图标应变为“取消钉住”（斜向图钉），标题为“取消钉住”
            const iconToShow = this.#isPinned ? 'unpin' : 'pin';
            pinBtn.innerHTML = ''; // 清空旧图标
            pinBtn.appendChild(createIcon(iconToShow));
            header.classList.toggle('draggable', this.#isPinned);
            pinBtn.title = browser.i18n.getMessage(this.#isPinned ? 'tooltipUnpin' : 'tooltipPin') || (this.#isPinned ? 'Unpin' : 'Pin');
            // 取消固定时，工具提示不应主动消失
            // if (!this.#isPinned) { onHide?.(); }
        });

        header?.addEventListener('mousedown', (e) => {
            if (!this.#isPinned) return;
            this.#isDragging = true;
            const rect = this.#tooltipEl.getBoundingClientRect();
            this.#dragStartX = e.clientX;
            this.#dragStartY = e.clientY;
            this.#dragOffsetX = e.clientX - rect.left;
            this.#dragOffsetY = e.clientY - rect.top;
            header.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.#isDragging || !this.#isPinned) return;
            e.preventDefault();

            // 计算新的理想位置
            let x = e.clientX - this.#dragOffsetX;
            let y = e.clientY - this.#dragOffsetY;

            // 获取视窗和工具提示的尺寸以进行边界检查
            const tooltipRect = this.#tooltipEl.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // 将位置限制在视窗内部
            x = Math.max(0, Math.min(x, viewportWidth - tooltipRect.width));
            y = Math.max(0, Math.min(y, viewportHeight - tooltipRect.height));

            this.#tooltipEl.style.left = `${x}px`;
            this.#tooltipEl.style.top = `${y}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!this.#isDragging) return;
            this.#isDragging = false;
            header.style.cursor = 'grab';
        });

        this.#attachSectionListeners('source', sourceText);
        this.#attachSectionListeners('target', translatedText);
    }


    #attachSectionListeners(type, text) {
        const section = this.#tooltipEl.querySelector(`.${type}-section`);
        if (!section) return;

        // Toggle button and header click
        const toggleBtn = section.querySelector('.toggle-btn');
        const header = section.querySelector('.foxlate-text-header');

        const toggleCollapse = (e) => {
            e.stopPropagation();
            const isCollapsed = section.classList.toggle('collapsed');
            toggleBtn.innerHTML = '';
            toggleBtn.appendChild(createIcon(isCollapsed ? 'expand' : 'collapse'));
            toggleBtn.title = browser.i18n.getMessage(isCollapsed ? 'tooltipExpandSource' : 'tooltipCollapseSource');

            section.querySelectorAll(`.${type}-speech-btn, .${type}-copy-btn`)
                .forEach(btn => btn.disabled = isCollapsed);
        };

        toggleBtn?.addEventListener('click', toggleCollapse);
        header?.addEventListener('click', (e) => {
            if (e.target.closest('.foxlate-icon-btn')) return; // 避免点击按钮时重复触发
            toggleCollapse(e);
        });

        // Speech button
        const speechBtn = section.querySelector(`.${type}-speech-btn`);
        speechBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.#isPlaying && this.#currentLanguage === type) {
                this.#stopSpeech();
            } else {
                this.#currentLanguage = type;
                this.#speakText(text, type);
            }
        });

        // Copy button
        const copyBtn = section.querySelector(`.${type}-copy-btn`);
        copyBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(text).then(() => {
                this.#showCopyFeedback(copyBtn);
            }).catch(err => {
                console.error(`[EnhancedTooltipManager] Failed to copy ${type} text:`, err);
            });
        });
    }

    #showCopyFeedback(button) {
        const originalIcon = button.innerHTML;
        button.innerHTML = '';
        button.appendChild(createIcon('check'));
        button.classList.add('copied');
        const originalTitle = button.title;
        button.title = browser.i18n.getMessage('tooltipCopied');

        setTimeout(() => {
            button.innerHTML = originalIcon;
            button.classList.remove('copied');
            button.title = originalTitle;
        }, COPY_FEEDBACK_DURATION);
    }
}

export default new EnhancedTooltipManager();