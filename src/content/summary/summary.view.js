// src/content/summary/summary.view.js

import browser from '../../lib/browser-polyfill.js';
import { debounce } from '../../common/utils.js';
import { ResizeController } from '../layout/resize-controller.js';
import { summaryLayoutController } from '../layout/summary-layout-controller.js';
import { getSummaryIcon } from './summary-icons.js';
import { SummaryMessageRenderer } from './summary-message-renderer.js';
import { SummarySuggestionsView } from './summary-suggestions-view.js';
export { SummaryButton } from './summary-button.view.js';

export class SummaryDialog {
    // 定义常量
    static MARGIN = 16;
    static DEBOUNCE_DELAY = 100; // ms
    static DEFAULT_WIDTH = 440;
    static DEFAULT_HEIGHT = 520;
    static EXPANDED_WIDTH = 680;
    static EXPANDED_HEIGHT = 720;

    constructor() {
        this.isOpen = false;
        this._renderedMessageCount = 0;
        this._fullRerenderNeeded = false;
        this.lastButtonRect = null; // 用于存储上次 show 时的 buttonRect
        this.lastButtonElement = null; // 用于存储按钮元素，以便在滚动时重新获取位置
        this.currentQuadrant = null; // 当前象限
        this.userSize = null;
        this.currentLayout = null;
        this.resizeController = null;
        this.currentMessageTexts = [];
        this.currentMessageTextByIndex = new Map();
        this.currentOriginalText = '';
        this.currentSuggestions = [];
        this.messageRenderer = new SummaryMessageRenderer({
            getIcon: name => this.getIcon(name),
            getWidth: () => this.currentLayout?.width ?? SummaryDialog.DEFAULT_WIDTH,
        });

        // 绑定事件处理函数，以便在移除时使用
        this.boundHandleSendMessage = () => {
            const query = this.textarea.value.trim();
            if (query && !this.sendButton.disabled) {
                this.dispatchEvent('send-message', { query });
                this.clearInput();
            }
        };
        this.boundHandleRefresh = () => this.dispatchEvent('refresh');
        this.boundToggleSuggestions = () => this.toggleSuggestions();
        this.boundHandleTextareaKeydown = (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                const query = this.textarea.value.trim();
                if (query && !this.sendButton.disabled) {
                    this.dispatchEvent('send-message', { query });
                    this.clearInput();
                }
            }
        };
        this.boundHandleTextareaInput = () => {
            this.applyTextareaLayout();
            this.updateSendButtonState();
            if (this.isOpen && !this.userSize) {
                this.repositionDialog();
            }
        };
        this.boundHandleConversationClick = (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            const index = parseInt(target.closest('.foxlate-summary-message').dataset.index, 10);
            let payload = null;
            if (action === 'save-edit') {
                payload = target.closest('.message-edit-area').querySelector('textarea').value;
            }
            this.dispatchEvent('dialog-action', { action, index, payload });
        };
        this.boundHandleTabsAreaClick = (e) => {
            const tabEl = e.target.closest('.foxlate-summary-tab');
            if (!tabEl) return;
            const tabId = parseInt(tabEl.dataset.tabId, 10);
            if (e.target.closest('.foxlate-summary-tab-close')) {
                this.dispatchEvent('tab-close', { tabId });
            } else if (tabEl.classList.contains('active')) {
               this.dispatchEvent('tab-toggle-original', { tabId });
            } else {
                this.dispatchEvent('tab-switch', { tabId });
            }
        };

        // 动态重定位相关
        this.boundRepositionDialog = this.repositionDialog.bind(this);
        this.debouncedHandleResizeAndScroll = debounce(this.handleWindowResizeAndScroll.bind(this), SummaryDialog.DEBOUNCE_DELAY);
        
        // 阻止滚动事件传播的处理函数
        this.boundPreventScrollPropagation = (e) => {
            const target = e.target;
            
            // 检查元素是否真正可滚动
            const isScrollable = (el) => {
                if (!el) return false;
                return el.scrollHeight > el.clientHeight &&
                       window.getComputedStyle(el).overflowY !== 'hidden';
            };

            // 检查目标是否在主要的可滚动区域内
            const inConversation = this.conversationArea.contains(target) && isScrollable(this.conversationArea);
            const inTextarea = this.textarea.contains(target) && isScrollable(this.textarea);
            const inSuggestions = this.suggestionsArea.contains(target) && isScrollable(this.suggestionsArea);
            const inOriginalText = this.originalTextArea.contains(target) && isScrollable(this.originalTextArea);

            if (inConversation || inTextarea || inSuggestions || inOriginalText) {
                // 在可滚动区域内：仅阻止冒泡，让浏览器处理滚动
                // CSS overscroll-behavior: contain 会防止滚动链到页面
                e.stopPropagation();
            } else {
                // 在非滚动区域（标题栏、空隙等）：阻止默认行为，防止页面滚动
                e.preventDefault();
            }
        };

        this.create();
    }

    dispatchEvent(type, detail) {
        this.element.dispatchEvent(new CustomEvent(type, { detail }));
    }

    create() {
        this.element = document.createElement('div');
        this.element.className = 'foxlate-summary-dialog';
        this.element.style.visibility = 'hidden';
        this.element.innerHTML = `
            <div class="foxlate-summary-header">
                <h3>${browser.i18n.getMessage('summaryModalTitle') || 'Summary'}</h3>
                <button class="refresh-button" aria-label="Refresh">${this.getIcon('refresh')}</button>
            </div>
            <div class="foxlate-summary-tabs"></div>
            <div class="foxlate-summary-content-wrapper">
               <div class="foxlate-summary-original-text"></div>
               <div class="foxlate-summary-conversation"></div>
            </div>
            <div class="foxlate-summary-menubar">
                <button class="suggest-button" aria-label="Suggest">${this.getIcon('suggest')} ${browser.i18n.getMessage('summarySuggestButton')}</button>
            </div>
            <div class="foxlate-summary-suggestions"></div>
            <div class="foxlate-summary-footer">
                <textarea placeholder="${browser.i18n.getMessage('summaryInputPlaceholder') || 'Ask a follow-up...'}" rows="1"></textarea>
                <button class="send-button" aria-label="Send">${this.getIcon('send')}</button>
            </div>
        `;
        this.tabsArea = this.element.querySelector('.foxlate-summary-tabs');
        this.contentWrapper = this.element.querySelector('.foxlate-summary-content-wrapper');
        this.originalTextArea = this.element.querySelector('.foxlate-summary-original-text');
        this.conversationArea = this.element.querySelector('.foxlate-summary-conversation');
        this.suggestionsArea = this.element.querySelector('.foxlate-summary-suggestions');
        this.suggestButton = this.element.querySelector('.suggest-button');
        this.textarea = this.element.querySelector('textarea');
        this.sendButton = this.element.querySelector('button.send-button');
        this.refreshButton = this.element.querySelector('button.refresh-button');
        this.suggestionsView = new SummarySuggestionsView({
            suggestionsArea: this.suggestionsArea,
            suggestButton: this.suggestButton,
            textarea: this.textarea,
            getIcon: name => this.getIcon(name),
            getWidth: () => this.currentLayout?.width ?? SummaryDialog.DEFAULT_WIDTH,
            dispatchEvent: (type, detail) => this.dispatchEvent(type, detail),
            applyTextareaLayout: () => this.applyTextareaLayout(),
            updateSendButtonState: () => this.updateSendButtonState(),
            clearInput: () => this.clearInput(),
            onVisibilityChanged: () => {
                this.currentSuggestions = this.suggestionsView.currentSuggestions;
                if (this.isOpen && !this.userSize) {
                    requestAnimationFrame(() => this.repositionDialog());
                }
            },
        });

        // 添加事件监听器
        this.sendButton.addEventListener('click', this.boundHandleSendMessage);
        this.refreshButton.addEventListener('click', this.boundHandleRefresh);
        this.suggestButton.addEventListener('click', this.boundToggleSuggestions);
        this.textarea.addEventListener('keydown', this.boundHandleTextareaKeydown, true);
        this.textarea.addEventListener('input', this.boundHandleTextareaInput);
        this.conversationArea.addEventListener('click', this.boundHandleConversationClick);
        this.tabsArea.addEventListener('click', this.boundHandleTabsAreaClick);
        
        // 初始化发送按钮状态（输入框为空时禁用）
        this.updateSendButtonState();
    }

    renderTabs(tabs, activeTabId) {
        this.tabsArea.innerHTML = '';
        tabs.forEach(tab => {
            const tabEl = document.createElement('div');
            tabEl.className = `foxlate-summary-tab ${tab.id === activeTabId ? 'active' : ''}`;
            tabEl.dataset.tabId = tab.id;
            tabEl.style.setProperty('--foxlate-summary-tab-width', `${summaryLayoutController.measureTabTitle(tab.title)}px`);
            tabEl.innerHTML = `
                <span class="foxlate-summary-tab-title">${tab.title}</span>
                ${tabs.length > 1 ? `<button class="foxlate-summary-tab-close">${this.getIcon('cancel')}</button>` : ''}
            `;
            this.tabsArea.appendChild(tabEl);
        });
    }

    triggerSend() {
        const query = this.textarea.value.trim();
        if (query && !this.sendButton.disabled) {
            this.dispatchEvent('send-message', { query });
            this.clearInput();
        }
    }

    /**
     * 清空输入框并重置高度
     */
    clearInput() {
        this.textarea.value = '';
        this.applyTextareaLayout();
        // 清空输入后更新发送按钮状态
        this.updateSendButtonState();
        // 确保输入框保持焦点
        requestAnimationFrame(() => {
            this.textarea.focus();
        });
    }

    renderConversation(history, isLoading = false) {
        const renderState = this.messageRenderer.renderConversation({
            conversationArea: this.conversationArea,
            history,
            isLoading,
            renderedMessageCount: this._renderedMessageCount,
            fullRerenderNeeded: this._fullRerenderNeeded,
        });

        this._renderedMessageCount = renderState.renderedMessageCount;
        this._fullRerenderNeeded = renderState.fullRerenderNeeded;
        this.currentMessageTexts = renderState.currentMessageTexts;
        this.currentMessageTextByIndex = renderState.currentMessageTextByIndex;
    }

    enterEditMode(index, content) {
        this.messageRenderer.enterEditMode({
            conversationArea: this.conversationArea,
            index,
            content,
            applyEditTextareaLayout: (textarea, value) => this.applyEditTextareaLayout(textarea, value),
            updateSendButtonState: () => this.updateSendButtonState(),
        });
    }

    setLoading(isLoading) {
        // 不再禁用输入框，保持用户可以随时输入
        // this.textarea.disabled = isLoading;
        this.element.classList.toggle('loading', isLoading);
        this.suggestButton.disabled = isLoading;
        this.suggestButton.classList.toggle('loading', isLoading);
        // 更新发送按钮状态，考虑加载状态和输入内容
        this.updateSendButtonState(isLoading);
    }

    /**
     * 更新发送按钮状态
     * @param {boolean} isLoading - 是否正在加载
     */
    updateSendButtonState(isLoading = false) {
        const hasContent = this.textarea.value.trim().length > 0;
        this.sendButton.disabled = isLoading || !hasContent;
    }

    toggleSuggestions() {
        this.suggestionsView.toggleSuggestions();
    }

    renderSuggestions(suggestions) {
        this.suggestionsView.renderSuggestions(suggestions);
        this.currentSuggestions = this.suggestionsView.currentSuggestions;
    }

    applyTextareaLayout() {
        if (!this.textarea) return;
        const width = this.currentLayout?.width ?? SummaryDialog.DEFAULT_WIDTH;
        const height = summaryLayoutController.measureTextareaHeight(this.textarea.value, this.textarea, width);
        this.textarea.style.height = `${height}px`;
        this.textarea.style.overflowY = height >= 120 ? 'auto' : 'hidden';
    }

    applyEditTextareaLayout(textarea, content) {
        if (!textarea) return;
        const editWidth = Math.max(180, (this.currentLayout?.width ?? SummaryDialog.DEFAULT_WIDTH) - 80);
        const editHeight = summaryLayoutController.measureTextareaHeight(content, textarea, editWidth);
        textarea.style.height = `${editHeight}px`;
        textarea.style.overflowY = editHeight >= 120 ? 'auto' : 'hidden';
    }

    applyMessageLayouts() {
        this.messageRenderer.applyMessageLayouts({
            conversationArea: this.conversationArea,
            currentMessageTextByIndex: this.currentMessageTextByIndex,
            applyEditTextareaLayout: (textarea, value) => this.applyEditTextareaLayout(textarea, value),
        });
    }

    applySuggestionsLayout() {
        this.suggestionsView?.applySuggestionsLayout();
    }

    applyMeasuredContentLayout() {
        this.applyTextareaLayout();
        this.applyMessageLayouts();
        this.applySuggestionsLayout();
    }

    attachResizeController() {
        if (!this.element) return;
        this.resizeController?.destroy();
        const bounds = summaryLayoutController.getBounds();
        this.resizeController = new ResizeController(this.element, {
            minWidth: bounds.minWidth,
            minHeight: bounds.minHeight,
            maxWidth: bounds.maxWidth,
            maxHeight: bounds.maxHeight,
            margin: SummaryDialog.MARGIN,
            handles: ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'],
            onResize: ({ width, height }) => {
                this.userSize = { width, height };
                this.currentLayout = { ...(this.currentLayout || {}), width, height };
                this.applyMeasuredContentLayout();
            },
            onResizeEnd: ({ width, height }) => {
                this.userSize = { width, height };
                this.repositionDialog();
            },
        });
    }

    getIcon(name) {
        return getSummaryIcon(name);
    }

    show(buttonRect) {
        this.isOpen = true;
        this.lastButtonRect = buttonRect;
        this.lastButtonElement = buttonRect.sourceElement;
        
        if (!this.element.parentNode) {
            document.body.appendChild(this.element);
        }
        
        this.element.style.visibility = 'visible';
        this.element.classList.add('visible');
        this.attachResizeController();

        // 延迟执行重定位，确保DOM已更新
        requestAnimationFrame(() => {
            this.repositionDialog();
            this.applyTextareaLayout();
            this.textarea.focus();
            this.updateSendButtonState();
        });

        // 添加窗口大小和滚动监听器
        window.addEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.addEventListener('scroll', this.debouncedHandleResizeAndScroll, true);
        
        // 添加对话框内的滚动事件监听器
        this.element.addEventListener('wheel', this.boundPreventScrollPropagation, { passive: false });
        this.element.addEventListener('touchmove', this.boundPreventScrollPropagation, { passive: false });

        // 添加内容变化观察器
        this.setupContentObserver();
    }

    repositionDialog() {
        if (!this.isOpen || !this.lastButtonRect) return;
        const layout = summaryLayoutController.planDialog({
            anchorRect: this.lastButtonRect,
            userSize: this.userSize,
            messageTexts: this.currentMessageTexts,
            originalText: this.currentOriginalText,
            inputText: this.textarea?.value ?? '',
            suggestions: this.currentSuggestions,
            suggestionsVisible: this.suggestionsArea?.classList.contains('is-visible'),
        });

        this.currentLayout = layout;
        this.element.style.top = `${layout.top}px`;
        this.element.style.left = `${layout.left}px`;
        this.element.style.width = `${layout.width}px`;
        this.element.style.height = `${layout.height}px`;
        this.element.style.transformOrigin = layout.transformOrigin;
        this.element.dataset.foxlatePlacement = layout.placement;
        this.applyMeasuredContentLayout();
    }

    // 移除旧的复杂计算方法
    calculateAvailableSpaces() {}
    selectBestDirection() {}
    calculateOptimalSize() {}
    estimateContentSize() {}
    applyDialogSize() {}
    animateSizeChange() {}
    easeOutCubic() {}
    applyDialogPosition() {}

    handleWindowResizeAndScroll() {
        // 重新获取 summaryButton 的位置，因为滚动和resize会改变其位置
        if (this.lastButtonElement && document.contains(this.lastButtonElement)) {
            // 确保按钮元素仍然存在于DOM中
            const newRect = this.lastButtonElement.getBoundingClientRect();
            // 只有当矩形有效时才更新
            if (newRect.width > 0 && newRect.height > 0) {
                this.lastButtonRect = newRect;
            }
        }
        this.repositionDialog();
    }

    /**
     * 设置内容变化观察器，用于自动调整对话框尺寸
     */
    setupContentObserver() {
        // 如果已有观察器，先断开
        if (this.contentObserver) {
            this.contentObserver.disconnect();
        }

        // 创建MutationObserver监听对话内容变化
        this.contentObserver = new MutationObserver(() => {
            if (this.isOpen) {
                // 延迟执行，确保DOM更新完成
                requestAnimationFrame(() => {
                    this.adjustSizeToContent();
                });
            }
        });

        // 开始观察对话区域
        this.contentObserver.observe(this.conversationArea, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    /**
     * 根据内容调整对话框尺寸
     * 新版逻辑：内容增多时自动扩展高度，但不超过最大高度
     */
    adjustSizeToContent() {
        if (!this.isOpen) return;
        if (!this.userSize) {
            this.repositionDialog();
        }
    }

    hide() {
        this.isOpen = false;
        this.element.classList.remove('visible');
        setTimeout(() => { if (!this.isOpen) this.element.style.visibility = 'hidden'; }, 200);

        // 移除窗口大小和滚动监听器
        window.removeEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.removeEventListener('scroll', this.debouncedHandleResizeAndScroll, true);
        this.element.removeEventListener('wheel', this.boundPreventScrollPropagation);
        this.element.removeEventListener('touchmove', this.boundPreventScrollPropagation);
        this.resizeController?.destroy();
        this.resizeController = null;
    }

    resetSuggestions() {
        this.suggestionsView.resetSuggestions();
        this.currentSuggestions = [];
    }

    setFullRerenderNeeded(needed) {
        this._fullRerenderNeeded = needed;
    }

    renderOriginalText(tab) {
        if (tab && tab.isOriginalTextVisible && tab.originalContent) {
            this.originalTextArea.textContent = tab.originalContent;
            this.currentOriginalText = tab.originalContent;
            this.originalTextArea.classList.add('is-visible');
        } else {
            this.currentOriginalText = '';
            this.originalTextArea.classList.remove('is-visible');
        }
        if (this.isOpen && !this.userSize) {
            requestAnimationFrame(() => this.repositionDialog());
        }
    }

    destroy() {
        // 移除所有事件监听器
        this.sendButton?.removeEventListener('click', this.boundHandleSendMessage);
        this.refreshButton?.removeEventListener('click', this.boundHandleRefresh);
        this.suggestButton?.removeEventListener('click', this.boundToggleSuggestions);
        this.textarea?.removeEventListener('keydown', this.boundHandleTextareaKeydown, true);
        this.textarea?.removeEventListener('input', this.boundHandleTextareaInput);
        this.conversationArea?.removeEventListener('click', this.boundHandleConversationClick);
        this.tabsArea?.removeEventListener('click', this.boundHandleTabsAreaClick);

        this.suggestionsView?.destroy();

        // 移除窗口大小和滚动监听器 (确保在 hide() 之后再次调用 destroy() 时也能清理)
        window.removeEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.removeEventListener('scroll', this.debouncedHandleResizeAndScroll, true);
        this.element?.removeEventListener('wheel', this.boundPreventScrollPropagation);
        this.element?.removeEventListener('touchmove', this.boundPreventScrollPropagation);
        this.resizeController?.destroy();
        this.resizeController = null;
        
        // 断开内容观察器
        if (this.contentObserver) {
            this.contentObserver.disconnect();
            this.contentObserver = null;
        }

        // 清理缓存
        this._loadingEl = null;
        this.lastButtonRect = null;
        this.lastButtonElement = null;
        this.currentQuadrant = null;
        this.targetDimensions = { width: 0, height: 0 };
        this.currentLayout = null;
        this.currentMessageTexts = [];
        this.currentMessageTextByIndex = new Map();
        this.currentOriginalText = '';
        this.currentSuggestions = [];

        this.element?.remove();
    }
}
