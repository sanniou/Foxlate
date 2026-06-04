import browser from '../../lib/browser-polyfill.js';
import * as Constants from '../../common/constants.js';
import { DisplayManager } from '../display-manager.js';
import { floatingLayoutService } from '../layout/floating-layout-service.js';
import { ResizeController } from '../layout/resize-controller.js';

class HoverStrategy {
    #tooltipEl = null;
    #hideTimeout = null;
    #activeElement = null;
    #resizeController = null;
    #userSize = null;
    #isPinned = false;
    #outsideClickHandler = null;

    constructor() {
        // 页面卸载时清理资源
        window.addEventListener('beforeunload', () => {
            this.globalCleanup();
        });
    }

    /**
     * 创建工具提示元素
     */
    #createTooltip() {
        if (this.#tooltipEl) return;

        this.#tooltipEl = document.createElement('div');
        this.#tooltipEl.className = 'foxlate-panel foxlate-hover-tooltip';
        document.body.appendChild(this.#tooltipEl);
    }

    /**
     * 更新工具提示位置
     * @param {HTMLElement} targetElement - 目标元素
     */
    #updatePosition(targetElement) {
        if (!this.#tooltipEl || !targetElement) return;
        floatingLayoutService.placeElement(this.#tooltipEl, {
            anchorElement: targetElement,
            margin: 10,
            gap: 8,
            preferredPlacements: ['top', 'bottom', 'right', 'left'],
        });
    }

    /**
     * 显示工具提示
     * @param {string} originalText - 原始文本
     * @param {string} translatedText - 翻译后的文本
     * @param {HTMLElement} targetElement - 目标元素
     * @param {boolean} isError - 是否为错误信息
     */
    #showTooltip(originalText, translatedText, targetElement, isError = false) {
        this.#createTooltip();
        if (!this.#tooltipEl) return;

        // 清除之前的隐藏超时
        if (this.#hideTimeout) {
            clearTimeout(this.#hideTimeout);
            this.#hideTimeout = null;
        }

        // 设置内容
        this.#tooltipEl.innerHTML = '';
        this.#tooltipEl.classList.remove('error', 'loading');
        
        if (isError) {
            this.#tooltipEl.classList.add('error');
            this.#tooltipEl.textContent = translatedText;
        } else {
            this.#tooltipEl.textContent = translatedText;
        }

        floatingLayoutService.applyTextBox(this.#tooltipEl, translatedText, {
            minWidth: 180,
            maxWidth: 360,
            paddingX: 32,
            paddingY: 24,
            maxReservedHeight: Math.max(80, Math.min(240, window.innerHeight - 20)),
            styleOverrides: {
                fontSize: '14px',
                lineHeight: '21px',
                whiteSpace: 'pre-wrap',
            },
        });
        if (this.#userSize) {
            this.#tooltipEl.style.width = `${this.#userSize.width}px`;
            this.#tooltipEl.style.height = `${this.#userSize.height}px`;
            this.#tooltipEl.style.minHeight = `${this.#userSize.height}px`;
        }
        this.#attachResizeController();

        // 更新位置并显示
        this.#updatePosition(targetElement);
        this.#tooltipEl.classList.add('visible');
        this.#activeElement = targetElement;

        // 添加工具提示事件监听器
        this.#attachTooltipListeners();
    }

    #attachResizeController() {
        if (!this.#tooltipEl) return;
        this.#resizeController?.destroy();
        this.#resizeController = new ResizeController(this.#tooltipEl, {
            minWidth: 160,
            minHeight: 48,
            maxWidth: Math.max(180, Math.min(520, window.innerWidth - 20)),
            maxHeight: Math.max(80, window.innerHeight - 20),
            margin: 10,
            handles: ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'],
            onResizeStart: () => {
                this.#pinTooltip();
            },
            onResize: ({ width, height }) => {
                this.#userSize = { width, height };
            },
            onResizeEnd: ({ width, height }) => {
                this.#userSize = { width, height };
                if (this.#activeElement) {
                    this.#updatePosition(this.#activeElement);
                }
            },
        });
    }

    /**
     * 隐藏工具提示
     */
    #hideTooltip() {
        if (!this.#tooltipEl) return;
        if (this.#isPinned) return;

        // 使用短暂延迟，以便鼠标移动到工具提示上时不会立即隐藏
        this.#hideTimeout = setTimeout(() => {
            if (this.#tooltipEl) {
                this.#tooltipEl.classList.remove('visible');
                this.#detachTooltipListeners();
            }
            this.#resizeController?.destroy();
            this.#resizeController = null;
            this.#hideTimeout = null;
            this.#activeElement = null;
        }, 100);
    }

    #pinTooltip() {
        if (!this.#tooltipEl) return;
        this.#isPinned = true;
        this.#tooltipEl.classList.add('pinned');
        if (this.#hideTimeout) {
            clearTimeout(this.#hideTimeout);
            this.#hideTimeout = null;
        }
        if (!this.#outsideClickHandler) {
            this.#outsideClickHandler = (event) => {
                if (this.#tooltipEl?.contains(event.target)) return;
                this.#isPinned = false;
                this.#tooltipEl?.classList.remove('pinned');
                this.#detachOutsideClickHandler();
                this.#hideTooltip();
            };
        }
        setTimeout(() => {
            document.addEventListener('mousedown', this.#outsideClickHandler, true);
        }, 0);
    }

    #detachOutsideClickHandler() {
        if (!this.#outsideClickHandler) return;
        document.removeEventListener('mousedown', this.#outsideClickHandler, true);
    }

    /**
     * 为工具提示添加事件监听器
     */
    #attachTooltipListeners() {
        if (!this.#tooltipEl) return;

        // 鼠标进入工具提示时取消隐藏
        const handleTooltipMouseEnter = () => {
            if (this.#hideTimeout) {
                clearTimeout(this.#hideTimeout);
                this.#hideTimeout = null;
            }
        };

        // 鼠标离开工具提示时隐藏
        const handleTooltipMouseLeave = () => {
            this.#hideTooltip();
        };

        // 窗口滚动时更新位置
        const handleScroll = () => {
            if (this.#activeElement && this.#tooltipEl?.classList.contains('visible')) {
                this.#updatePosition(this.#activeElement);
            }
        };

        this.#tooltipEl.addEventListener('mouseenter', handleTooltipMouseEnter);
        this.#tooltipEl.addEventListener('mouseleave', handleTooltipMouseLeave);
        window.addEventListener('scroll', handleScroll, { passive: true });

        // 保存引用以便后续移除
        this.#tooltipEl._foxlateTooltipListeners = {
            handleTooltipMouseEnter,
            handleTooltipMouseLeave,
            handleScroll
        };
    }

    /**
     * 移除工具提示事件监听器
     */
    #detachTooltipListeners() {
        if (!this.#tooltipEl?._foxlateTooltipListeners) return;

        const { handleTooltipMouseEnter, handleTooltipMouseLeave, handleScroll } = this.#tooltipEl._foxlateTooltipListeners;
        
        this.#tooltipEl.removeEventListener('mouseenter', handleTooltipMouseEnter);
        this.#tooltipEl.removeEventListener('mouseleave', handleTooltipMouseLeave);
        window.removeEventListener('scroll', handleScroll);
        
        delete this.#tooltipEl._foxlateTooltipListeners;
    }

    /**
     * 为元素添加悬停事件，以显示包含译文的工具提示。
     * @param {HTMLElement} element - 目标元素。
     * @param {string} originalText - 原始文本。
     * @param {string} translatedText - 翻译后的文本。
     * @param {boolean} isError - 指示文本是否为错误信息。
     */
    displayTranslation(element, originalText, translatedText, isError = false) {
        element.classList.add('foxlate-hover-highlight');

        const handleMouseEnter = () => {
            this.#showTooltip(originalText, translatedText, element, isError);
        };

        const handleMouseLeave = () => {
            this.#hideTooltip();
        };

        // 将处理函数附加到元素上，以便 revert 时可以精确移除
        element._foxlateHoverHandlers = { handleMouseEnter, handleMouseLeave };

        element.addEventListener('mouseenter', handleMouseEnter);
        element.addEventListener('mouseleave', handleMouseLeave);
    }

    /**
     * 移除元素的悬停事件监听器并清理状态。
     * @param {HTMLElement} element - 目标元素。
     */
    revert(element) {
        // 移除所有可能由该策略添加的样式。
        element.classList.remove('foxlate-hover-highlight', 'foxlate-loading-highlight');

        if (element._foxlateHoverHandlers) {
            element.removeEventListener('mouseenter', element._foxlateHoverHandlers.handleMouseEnter);
            element.removeEventListener('mouseleave', element._foxlateHoverHandlers.handleMouseLeave);
            delete element._foxlateHoverHandlers;
        }
        
        // 如果当前元素是活动元素，隐藏工具提示
        if (this.#activeElement === element) {
            this.#hideTooltip();
        }
    }

    /**
     * Implements the global cleanup interface for DisplayManager.
     * This ensures any visible hover tooltip is hidden during a full page revert.
     */
    globalCleanup() {
        if (this.#tooltipEl) {
            this.#tooltipEl.classList.remove('visible');
            this.#detachTooltipListeners();
        }
        this.#resizeController?.destroy();
        this.#resizeController = null;
        this.#isPinned = false;
        this.#detachOutsideClickHandler();
        if (this.#hideTimeout) {
            clearTimeout(this.#hideTimeout);
            this.#hideTimeout = null;
        }
        this.#activeElement = null;
    }

    updateUI(element, state) {
        // 在应用新状态前，先清理旧状态，确保元素处于干净状态。
        this.revert(element);

        const data = DisplayManager.getElementData(element);

        switch (state) {
            case Constants.DISPLAY_MANAGER_STATES.ORIGINAL:
                // revert 已在 switch 外部调用，此处无需操作。
                break;
            case Constants.DISPLAY_MANAGER_STATES.LOADING:
                // 使用一个不同的高亮样式来表示正在加载
                element.classList.add('foxlate-loading-highlight');
                break;
            case Constants.DISPLAY_MANAGER_STATES.TRANSLATED:
                if (data && data.plainText && data.originalContent) {
                    this.displayTranslation(element, data.originalContent, data.plainText, false);
                } else {
                    this.revert(element);
                }
                break;
            case Constants.DISPLAY_MANAGER_STATES.ERROR:
                const errorPrefix = browser.i18n.getMessage('contextMenuErrorPrefix') || 'Error';
                const errorMessage = data?.errorMessage || 'Translation Error';
                const fullErrorMessage = `⚠️ ${errorPrefix}: ${errorMessage}`;
                // 当发生错误时，原文和译文都显示错误信息
                this.displayTranslation(element, data.originalContent, fullErrorMessage, true);
                break;
            default:
                console.warn(`[Hover Strategy] Unknown state: ${state}`);
        }
    }
}

// 导出该类的一个实例，以保持单例模式
export default new HoverStrategy();
