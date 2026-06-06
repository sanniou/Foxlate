import browser from '../lib/browser-polyfill.js';
import { floatingLayoutService } from './layout/floating-layout-service.js';
import { createTooltipContent } from './tooltip/tooltip-content-view.js';
import { createTooltipIcon } from './tooltip/tooltip-icons.js';
import { TooltipDragController } from './tooltip/tooltip-drag-controller.js';
import { TooltipResizeController } from './tooltip/tooltip-resize-controller.js';
import { TooltipSpeechController } from './tooltip/tooltip-speech-controller.js';

// --- Constants ---
const POSITION_OFFSET = 10;
const COPY_FEEDBACK_DURATION = 1500;

/**
 * EnhancedTooltipManager
 * Manages an advanced tooltip with features like text-to-speech, copy, and collapsible sections.
 */
class EnhancedTooltipManager {
    #tooltipEl = null;
    #activeHideHandler = null;
    #sourceLang = 'auto'; // 将由 franc 检测
    #targetLang = null; // 目标语言，必须通过 show 方法的选项进行配置
    #isPinned = false;
    #lastPositionContext = null;
    #dragController = new TooltipDragController();
    #resizeController = new TooltipResizeController();
    #speechController = new TooltipSpeechController();

    constructor() {}

    #createTooltip() {
        if (this.#tooltipEl) return;

        this.#tooltipEl = document.createElement('div');
        this.#tooltipEl.className = 'foxlate-enhanced-panel';
        document.body.appendChild(this.#tooltipEl);
    }

    #getLayoutText(sourceText, translatedText, { isLoading, isError }) {
        if (isLoading) {
            return browser.i18n.getMessage('tooltipTranslating') || 'Translating...';
        }
        if (isError) {
            return sourceText || translatedText || 'Error';
        }
        return translatedText || sourceText || '';
    }

    #applyLayout(sourceText, translatedText, options) {
        if (!this.#tooltipEl) return null;
        const layoutText = this.#getLayoutText(sourceText, translatedText, options);
        const box = floatingLayoutService.applyTextBox(this.#tooltipEl, layoutText, {
            minWidth: 280,
            maxWidth: 420,
            paddingX: 34,
            paddingY: options.isLoading ? 72 : 104,
            maxReservedHeight: Math.max(180, Math.min(420, window.innerHeight - 40)),
            styleOverrides: {
                fontSize: '14px',
                lineHeight: '22px',
                whiteSpace: 'pre-wrap',
            },
        });

        const body = this.#tooltipEl.querySelector('.foxlate-panel-body');
        if (body && box?.height) {
            const maxBodyHeight = Math.max(160, Math.min(360, window.innerHeight - 140));
            body.style.maxHeight = `${maxBodyHeight}px`;
        }
        if (this.#resizeController.userSize) {
            const { width, height } = this.#resizeController.userSize;
            this.#tooltipEl.style.width = `${width}px`;
            this.#tooltipEl.style.height = `${height}px`;
            this.#tooltipEl.style.minHeight = `${height}px`;
        }
        return box;
    }

    #updatePosition({ coords, targetElement }) {
        this.#lastPositionContext = { coords, targetElement };
        if (!this.#tooltipEl || this.#isPinned) return;
        floatingLayoutService.placeElement(this.#tooltipEl, {
            anchorElement: targetElement,
            point: coords,
            margin: POSITION_OFFSET,
            gap: POSITION_OFFSET,
            preferredPlacements: coords ? ['bottom', 'top', 'right', 'left'] : ['top', 'bottom', 'right', 'left'],
        });
    }

    #setPinned(isPinned) {
        if (!this.#tooltipEl) return;
        this.#isPinned = isPinned;
        this.#tooltipEl.classList.toggle('pinned', this.#isPinned);
        const pinBtn = this.#tooltipEl.querySelector('.foxlate-pin-btn');
        this.#dragController.setPinned(this.#isPinned);
        if (pinBtn) {
            pinBtn.innerHTML = '';
            pinBtn.appendChild(createTooltipIcon(this.#isPinned ? 'unpin' : 'pin'));
            pinBtn.title = browser.i18n.getMessage(this.#isPinned ? 'tooltipUnpin' : 'tooltipPin') || (this.#isPinned ? 'Unpin' : 'Pin');
        }
        if (this.#isPinned) {
            this.#removeHideListeners();
        }
    }

    #attachResizeController() {
        if (!this.#tooltipEl) return;
        this.#resizeController.attach(this.#tooltipEl, {
            minWidth: 280,
            minHeight: 140,
            maxWidth: Math.max(280, Math.min(560, window.innerWidth - 20)),
            maxHeight: Math.max(140, window.innerHeight - 20),
            margin: POSITION_OFFSET,
            onResizeStart: () => {
                this.#setPinned(true);
            },
            onResize: ({ width, height }) => {
                const body = this.#tooltipEl.querySelector('.foxlate-panel-body');
                if (body) {
                    body.style.maxHeight = `${Math.max(80, height - 96)}px`;
                }
            },
            onResizeEnd: () => {
                if (!this.#isPinned && this.#lastPositionContext) {
                    this.#updatePosition(this.#lastPositionContext);
                }
            },
        });
    }

    hide() {
        if (this.#isPinned) return;
        if (this.#tooltipEl) {
            this.#tooltipEl.classList.remove('visible');
        }
        this.#speechController.stop(this.#tooltipEl, browser);
        this.#removeHideListeners();
    }

    #removeHideListeners() {
        if (this.#activeHideHandler) {
            document.removeEventListener('click', this.#activeHideHandler, true);
            window.removeEventListener('scroll', this.#activeHideHandler, true);
            this.#activeHideHandler = null;
        }
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
        this.#speechController.configure({ sourceLang, targetLang });

        if (this.#isPinned) {
            this.#isPinned = false;
            this.#tooltipEl.classList.remove('pinned');
        }

        this.hide();

        this.#tooltipEl.innerHTML = ''; // Clear previous content
        const content = createTooltipContent(browser, sourceText, translatedText, { isLoading, isError });
        this.#tooltipEl.appendChild(content);
        this.#applyLayout(sourceText, translatedText, { isLoading, isError });
        this.#attachResizeController();

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
        this.#dragController.attach(this.#tooltipEl, header);
        this.#dragController.setPinned(this.#isPinned);

        this.#tooltipEl.querySelector('.foxlate-close-btn')?.addEventListener('click', (e) => {
            // 确保关闭按钮总是能工作
            e.stopPropagation();
            this.#isPinned = false;
            onHide?.();
        });

        pinBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.#setPinned(!this.#isPinned);
            // 取消固定时，工具提示不应主动消失
            // if (!this.#isPinned) { onHide?.(); }
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
            toggleBtn.appendChild(createTooltipIcon(isCollapsed ? 'expand' : 'collapse'));
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
            this.#speechController.toggle(text, type, this.#tooltipEl, browser);
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
        button.appendChild(createTooltipIcon('check'));
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
