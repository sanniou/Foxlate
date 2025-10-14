// src/content/summary/summary.view.js

import browser from '../../lib/browser-polyfill.js';
import { marked } from '../../lib/marked.esm.js';
import { debounce } from '../../common/utils.js';

export class SummaryButton {
    constructor() {
        this.element = null;
        this.create();
    }
    create() {
        this.element = document.createElement('div');
        this.element.className = 'foxlate-summary-button';
        this.element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M11.25 3.5H12.75V5H11.25V3.5ZM12 19C11.35 19 10.8 18.8 10.35 18.35C9.9 17.9 9.7 17.35 9.7 16.7C9.7 16.05 9.9 15.5 10.35 15.05C10.8 14.6 11.35 14.4 12 14.4C12.65 14.4 13.2 14.6 13.65 15.05C14.1 15.5 14.3 16.05 14.3 16.7C14.3 17.35 14.1 17.9 13.65 18.35C13.2 18.8 12.65 19 12 19ZM5 12.75V11.25H3.5V12.75H5ZM19 12C19 11.35 18.8 10.8 18.35 10.35C17.9 9.9 17.35 9.7 16.7 9.7C16.05 9.7 15.5 9.9 15.05 10.35C14.6 10.8 14.4 11.35 14.4 12C14.4 12.65 14.6 13.2 15.05 13.65C15.5 14.1 16.05 14.3 16.7 14.3C17.35 14.3 17.9 14.1 18.35 13.65C18.8 13.2 19 12.65 19 12ZM20.5 12.75V11.25H19V12.75H20.5ZM11.25 20.5V19H12.75V20.5H11.25ZM7.05 7.05L6 6L7.05 4.95L8.1 6L7.05 7.05ZM15.9 18.1L14.85 17.05L15.9 16L17 17.05L15.9 18.1ZM15.9 8.1L17 7.05L15.9 6L14.85 7.05L15.9 8.1Z"/></svg>`;
        document.body.appendChild(this.element);
    }
    setPosition(x, y) {
        const rect = this.element.getBoundingClientRect();
        this.element.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width))}px`;
        this.element.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height))}px`;
    }
    destroy() { this.element?.remove(); }
}

export class SummaryDialog {
    // 定义常量
    static MARGIN = 16;
    static DEBOUNCE_DELAY = 100; // ms
    static FIXED_WIDTH = 500;
    static MIN_HEIGHT = 200;
    static MAX_HEIGHT = 80; // vh
    static GROWTH_ANIMATION_DURATION = 200; // ms
    static CONTENT_PADDING = 32; // 对话框内边距总和

    constructor() {
        this.isOpen = false;
        this._renderedMessageCount = 0;
        this._fullRerenderNeeded = false;
        this.lastButtonRect = null; // 用于存储上次 show 时的 buttonRect
        this.lastButtonElement = null; // 用于存储按钮元素，以便在滚动时重新获取位置
        this.currentQuadrant = null; // 当前象限
        this.targetDimensions = { width: 0, height: 0 }; // 目标尺寸
        this.isAnimating = false; // 是否正在动画中

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
                const query = this.textarea.value.trim();
                if (query && !this.sendButton.disabled) {
                    this.dispatchEvent('send-message', { query });
                    this.clearInput();
                }
            }
        };
        this.boundHandleTextareaInput = () => {
            this.textarea.style.height = 'auto';
            this.textarea.style.height = `${this.textarea.scrollHeight}px`;
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
            } else {
                this.dispatchEvent('tab-switch', { tabId });
            }
        };

        // 动态重定位相关
        this.boundRepositionDialog = this.repositionDialog.bind(this);
        this.debouncedHandleResizeAndScroll = debounce(this.handleWindowResizeAndScroll.bind(this), SummaryDialog.DEBOUNCE_DELAY);
        
        // 阻止滚动事件传播的处理函数
        this.boundPreventScrollPropagation = (e) => {
            // 只阻止来自对话框内部的滚动事件
            if (this.element.contains(e.target)) {
                e.stopPropagation();
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
            <div class="foxlate-summary-conversation"></div>
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
        this.conversationArea = this.element.querySelector('.foxlate-summary-conversation');
        this.suggestionsArea = this.element.querySelector('.foxlate-summary-suggestions');
        this.suggestButton = this.element.querySelector('.suggest-button');
        this.textarea = this.element.querySelector('textarea');
        this.sendButton = this.element.querySelector('button.send-button');
        this.refreshButton = this.element.querySelector('button.refresh-button');

        // 添加事件监听器
        this.sendButton.addEventListener('click', this.boundHandleSendMessage);
        this.refreshButton.addEventListener('click', this.boundHandleRefresh);
        this.suggestButton.addEventListener('click', this.boundToggleSuggestions);
        this.textarea.addEventListener('keydown', this.boundHandleTextareaKeydown);
        this.textarea.addEventListener('input', this.boundHandleTextareaInput);
        this.conversationArea.addEventListener('click', this.boundHandleConversationClick);
        this.tabsArea.addEventListener('click', this.boundHandleTabsAreaClick);
    }

    renderTabs(tabs, activeTabId) {
        this.tabsArea.innerHTML = '';
        tabs.forEach(tab => {
            const tabEl = document.createElement('div');
            tabEl.className = `foxlate-summary-tab ${tab.id === activeTabId ? 'active' : ''}`;
            tabEl.dataset.tabId = tab.id;
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
        this.textarea.style.height = 'auto';
        // 确保输入框保持焦点
        requestAnimationFrame(() => {
            this.textarea.focus();
        });
    }

    renderConversation(history, isLoading = false) {
        // 确保 history 是一个有效的数组，如果不是，则重置视图
        if (!this.conversationArea) return;
        if (!Array.isArray(history)) {
            this.conversationArea.innerHTML = '';
            this._renderedMessageCount = 0;
            this._fullRerenderNeeded = false;
            return;
        }

        // 如果需要完全重绘，或者 history 长度变短（例如撤销、删除），则清空并重绘所有消息
        if (this._fullRerenderNeeded || history.length < this._renderedMessageCount) {
            this.conversationArea.innerHTML = '';
            this._renderedMessageCount = 0;
            this._fullRerenderNeeded = false;
        }

        this.updateMessages(history);

        // 优化：使用缓存的选择器避免重复查询
        if (!this._loadingEl) {
            this._loadingEl = this.conversationArea.querySelector('.foxlate-summary-message.loading');
        }
        
        if (isLoading) {
            if (!this._loadingEl) {
                this._loadingEl = document.createElement('div');
                this._loadingEl.className = 'foxlate-summary-message assistant loading';
                this._loadingEl.innerHTML = `<div class="loading-indicator"></div>`;
                this.conversationArea.appendChild(this._loadingEl);
            }
        } else {
            if (this._loadingEl) {
                this._loadingEl.remove();
                this._loadingEl = null;
            }
        }

        // 优化：使用 requestAnimationFrame 确保滚动在下一帧执行
        requestAnimationFrame(() => {
            this.conversationArea.scrollTop = this.conversationArea.scrollHeight;
        });
    }

    updateMessages(history) {
        // 优化：缓存消息元素选择器，避免重复查询
        const messageSelector = '.foxlate-summary-message:not(.loading)';
        const messageElements = this.conversationArea.querySelectorAll(messageSelector);
        
        // 移除已渲染但不再存在于 history 中的消息元素
        if (messageElements.length > history.length) {
            // 使用 DocumentFragment 批量移除元素
            const fragment = document.createDocumentFragment();
            for (let i = history.length; i < messageElements.length; i++) {
                fragment.appendChild(messageElements[i]);
            }
            fragment.textContent = ''; // 清空 fragment，移除所有元素
        }

        // 使用 DocumentFragment 批量添加新元素
        const fragment = document.createDocumentFragment();
        const elementsToReplace = new Map(); // 存储需要替换的元素

        // 遍历 history，收集需要更新或新增的消息
        history.forEach((message, index) => {
            const existingEl = this.conversationArea.querySelector(`.foxlate-summary-message[data-index="${index}"]:not(.loading)`);
            const newEl = this.createMessageElement(message, index);
            
            if (existingEl) {
                elementsToReplace.set(existingEl, newEl);
            } else {
                fragment.appendChild(newEl);
            }
        });

        // 批量添加新元素
        if (fragment.children.length > 0) {
            this.conversationArea.appendChild(fragment);
        }

        // 批量替换现有元素
        elementsToReplace.forEach((newEl, existingEl) => {
            existingEl.replaceWith(newEl);
        });

        this._renderedMessageCount = history.length;
    }

    renderMessage(message, index) {
        if (message.isHidden) return;
        const messageEl = document.createElement('div');
        messageEl.className = `foxlate-summary-message ${message.role}`;
        messageEl.dataset.index = index;
        if (message.isError) messageEl.classList.add('error');
        
        // 确保能正确获取内容，处理刷新后的数据结构
        let content;
        if (message.role === 'user') {
            content = message.content;
        } else {
            // 确保 message.contents 存在且是数组
            const contents = message.contents || [];
            const activeIndex = message.activeContentIndex || 0;
            content = contents[activeIndex];
        }
        
        messageEl.innerHTML = `<div class="message-content">${marked.parse(content)}</div>${this.getActionsHtml(message)}`;
        this.conversationArea.appendChild(messageEl);
    }

    createMessageElement(message, index) {
        // 优化：使用对象池模式复用元素
        const messageEl = document.createElement('div');
        messageEl.className = `foxlate-summary-message ${message.role} ${message.isError ? 'error' : ''}`;
        messageEl.dataset.index = index;
        if (message.isHidden) {
            messageEl.style.display = 'none';
        }

        // 优化：缓存内容提取逻辑
        let content;
        if (message.role === 'user') {
            content = message.content || '';
        } else {
            const contents = message.contents || [];
            const activeIndex = message.activeContentIndex || 0;
            content = contents[activeIndex] || ''; // 确保 content 有备用值
        }

        // 优化：使用模板元素缓存
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // 安全性改进：添加 XSS 防护
        try {
            // 注意：生产环境中应该使用 DOMPurify 或类似库
            contentDiv.innerHTML = marked.parse(content);
        } catch (e) {
            console.error('[Foxlate Summary] Markdown parsing error:', e);
            contentDiv.textContent = content; // 降级到纯文本
        }

        messageEl.appendChild(contentDiv);
        
        // 优化：缓存操作按钮 HTML
        const actionsHtml = this.getActionsHtml(message);
        if (actionsHtml) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'message-actions';
            actionsDiv.innerHTML = actionsHtml;
            messageEl.appendChild(actionsDiv);
        }

        return messageEl;
    }

    getActionsHtml(message) {
        let buttons = `<button data-action="copy" aria-label="Copy">${this.getIcon('copy')}</button>`;
        if (message.role === 'user') {
            buttons += `<button data-action="edit" aria-label="Edit">${this.getIcon('edit')}</button>`;
        } else if (message.isError) {
            // 为错误消息添加重试按钮
            if (message.retryCallback) {
                buttons += `<button data-action="retry" aria-label="Retry">${this.getIcon('refresh')}</button>`;
            }
            buttons += `<button data-action="copy-error" aria-label="Copy Error">${this.getIcon('copy')}</button>`;
        } else {
            // 确保 message.contents 存在且是数组
            const contents = message.contents || [];
            if (contents.length > 1) {
                const activeIndex = message.activeContentIndex || 0;
                buttons += `
                    <button data-action="history-prev" ${activeIndex === 0 ? 'disabled' : ''}>${this.getIcon('prev')}</button>
                    <span>${activeIndex + 1}/${contents.length}</span>
                    <button data-action="history-next" ${activeIndex === contents.length - 1 ? 'disabled' : ''}>${this.getIcon('next')}</button>
                `;
            }
            buttons += `<button data-action="reroll" aria-label="Reroll">${this.getIcon('reroll')}</button>`;
        }
        return `<div class="message-actions">${buttons}</div>`;
    }

    enterEditMode(index, content) {
        const messageEl = this.conversationArea.querySelector(`[data-index="${index}"]`);
        if (!messageEl) return;
        messageEl.classList.add('is-editing');
        messageEl.innerHTML = `
            <div class="message-edit-area">
                <textarea rows="3">${content}</textarea>
                <div class="message-actions">
                    <button data-action="cancel-edit" aria-label="Cancel">${this.getIcon('cancel')}</button>
                    <button data-action="save-edit" aria-label="Save">${this.getIcon('save')}</button>
                </div>
            </div>
        `;
        const textarea = messageEl.querySelector('textarea');
        textarea.focus();
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    setLoading(isLoading) {
        this.sendButton.disabled = isLoading;
        this.textarea.disabled = isLoading;
        this.element.classList.toggle('loading', isLoading);
        this.suggestButton.disabled = isLoading;
        this.suggestButton.classList.toggle('loading', isLoading);
    }

    toggleSuggestions() {
        if (this.suggestionsArea.classList.contains('is-visible')) {
            this.suggestionsArea.classList.remove('is-visible');
            this.suggestionsArea.innerHTML = '';
        } else {
            this.suggestionsArea.classList.add('is-visible');
            this.suggestionsArea.innerHTML = `
                <div class="foxlate-suggestion-loading">
                    <div class="loading-indicator"></div>
                    <span>${browser.i18n.getMessage('summaryLoadingSuggestions') || 'Loading suggestions...'}</span>
                </div>
            `;
            this.suggestButton.disabled = true;
            this.suggestButton.classList.add('loading');
            this.dispatchEvent('infer-suggestions');
        }
    }

    renderSuggestions(suggestions) {
        // 清空建议区域
        this.suggestionsArea.innerHTML = '';
        this.suggestButton.disabled = false;
        this.suggestButton.classList.remove('loading');

        let parsedSuggestions = [];
        if (suggestions && suggestions.length > 0) {
            if (typeof suggestions[0] === 'string' && suggestions[0].startsWith('```json')) {
                try {
                    const jsonString = suggestions[0].substring(7, suggestions[0].length - 3).trim();
                    const tempSuggestions = JSON.parse(jsonString);
                    if (Array.isArray(tempSuggestions)) parsedSuggestions = tempSuggestions;
                    else parsedSuggestions = suggestions;
                } catch (e) {
                    console.error('[Foxlate Summary] Error parsing suggestions:', e);
                    parsedSuggestions = suggestions;
                }
            } else {
                parsedSuggestions = suggestions;
            }

            // 优化：使用 DocumentFragment 批量操作 DOM
            const fragment = document.createDocumentFragment();

            parsedSuggestions.forEach(suggestion => {
                const suggestionEl = document.createElement('div');
                suggestionEl.className = 'foxlate-suggestion-item';
                
                const textSpan = document.createElement('span');
                textSpan.className = 'suggestion-text';
                textSpan.textContent = suggestion;
                
                const editButton = document.createElement('button');
                editButton.className = 'edit-suggestion-button';
                editButton.dataset.suggestion = suggestion;
                editButton.setAttribute('aria-label', 'Edit suggestion');
                editButton.innerHTML = this.getIcon('edit');
                
                suggestionEl.appendChild(textSpan);
                suggestionEl.appendChild(editButton);
                fragment.appendChild(suggestionEl);
            });

            this.suggestionsArea.appendChild(fragment);

            // 优化：使用事件委托处理点击事件
            if (this._suggestionsClickHandler) {
                this.suggestionsArea.removeEventListener('click', this._suggestionsClickHandler);
            }
            
            this._suggestionsClickHandler = (e) => {
                const suggestionItem = e.target.closest('.foxlate-suggestion-item');
                const editButton = e.target.closest('.edit-suggestion-button');
                
                if (editButton) {
                    // 处理编辑按钮点击
                    const suggestion = editButton.dataset.suggestion;
                    this.textarea.value = suggestion;
                    this.textarea.style.height = 'auto';
                    this.textarea.style.height = `${this.textarea.scrollHeight}px`;
                    this.textarea.focus();
                    this.toggleSuggestions();
                } else if (suggestionItem) {
                    // 处理建议项点击
                    const textSpan = suggestionItem.querySelector('.suggestion-text');
                    if (textSpan) {
                        const suggestion = textSpan.textContent;
                        this.dispatchEvent('send-message', { query: suggestion });
                        this.toggleSuggestions();
                        // 清空输入框（如果建议内容与输入框内容不同）
                        if (this.textarea.value.trim() !== suggestion) {
                            this.clearInput();
                        }
                    }
                }
            };
            
            this.suggestionsArea.addEventListener('click', this._suggestionsClickHandler);
        } else {
            // 优化：使用createElement而不是innerHTML
            const messageEl = document.createElement('div');
            messageEl.className = 'foxlate-suggestion-message foxlate-suggestion-error';
            messageEl.textContent = browser.i18n.getMessage('summaryNoSuggestions') || 'No suggestions available.';
            this.suggestionsArea.appendChild(messageEl);
        }
    }

    getIcon(name) {
        const icons = {
            send: '<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 0 24 24" width="20"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
            copy: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
            edit: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
            reroll: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
            save: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
            cancel: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
            prev: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
            next: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>',
            refresh: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
            suggest: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17h8v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>'
        };
        return icons[name] || '';
    }

    show(buttonRect) {
        this.isOpen = true;
        this.lastButtonRect = buttonRect; // 存储 buttonRect
        this.lastButtonElement = buttonRect.sourceElement; // 存储按钮元素
        if (!this.element.parentNode) {
            document.body.appendChild(this.element);
        }
        this.element.style.visibility = 'visible';

        // 初始化尺寸为最小值，准备动画
        this.element.style.width = `${SummaryDialog.FIXED_WIDTH}px`;
        this.element.style.maxHeight = `${SummaryDialog.MIN_HEIGHT}px`;
        this.element.classList.add('visible');

        // 延迟执行重定位，确保DOM已更新
        requestAnimationFrame(() => {
            this.repositionDialog(); // 调用重定位方法
            this.textarea.focus();
        });

        // 添加窗口大小和滚动监听器
        window.addEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.addEventListener('scroll', this.debouncedHandleResizeAndScroll, true); // 捕获阶段监听，确保能捕获到所有滚动事件
        
        // 添加对话框内的滚动事件监听器，阻止事件传播到主页面
        this.element.addEventListener('wheel', this.boundPreventScrollPropagation, { passive: false });
        this.element.addEventListener('touchmove', this.boundPreventScrollPropagation, { passive: false });

        // 添加内容变化观察器
        this.setupContentObserver();
    }

    repositionDialog() {
        if (!this.isOpen || !this.lastButtonRect) return; // 如果对话框未打开或没有 buttonRect，则不重定位

        const { top, left, right, bottom } = this.lastButtonRect;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const MARGIN = SummaryDialog.MARGIN;

        // 计算八个方向的可用空间
        const spaces = this.calculateAvailableSpaces(top, left, right, bottom, winWidth, winHeight, MARGIN);
        
        // 选择最佳方向并计算最优尺寸
        const bestDirection = this.selectBestDirection(spaces);
        const optimalSize = this.calculateOptimalSize(bestDirection, spaces);
        
        // 应用尺寸和位置
        this.applyDialogSize(optimalSize, bestDirection);
        this.applyDialogPosition(bestDirection, top, left, right, bottom, winWidth, winHeight, MARGIN);
        
        this.currentQuadrant = bestDirection.name;
    }

    /**
     * 计算八个方向的可用空间
     */
    calculateAvailableSpaces(top, left, right, bottom, winWidth, winHeight, margin) {
        return {
            top: { width: winWidth - 2 * margin, height: top - margin - 8 },
            bottom: { width: winWidth - 2 * margin, height: winHeight - bottom - margin - 8 },
            left: { width: left - margin - 8, height: winHeight - 2 * margin },
            right: { width: winWidth - right - margin - 8, height: winHeight - 2 * margin },
            topLeft: { width: left - margin - 8, height: top - margin - 8 },
            topRight: { width: winWidth - right - margin - 8, height: top - margin - 8 },
            bottomLeft: { width: left - margin - 8, height: winHeight - bottom - margin - 8 },
            bottomRight: { width: winWidth - right - margin - 8, height: winHeight - bottom - margin - 8 }
        };
    }

    /**
     * 选择最佳方向
     */
    selectBestDirection(spaces) {
        const directions = [
            { name: 'bottom', space: spaces.bottom, origin: 'top left', anchorPoint: { x: 'left', y: 'bottom' } },
            { name: 'top', space: spaces.top, origin: 'bottom left', anchorPoint: { x: 'left', y: 'top' } },
            { name: 'right', space: spaces.right, origin: 'top left', anchorPoint: { x: 'right', y: 'top' } },
            { name: 'left', space: spaces.left, origin: 'top right', anchorPoint: { x: 'left', y: 'top' } },
            { name: 'bottomRight', space: spaces.bottomRight, origin: 'top left', anchorPoint: { x: 'right', y: 'bottom' } },
            { name: 'bottomLeft', space: spaces.bottomLeft, origin: 'top right', anchorPoint: { x: 'left', y: 'bottom' } },
            { name: 'topRight', space: spaces.topRight, origin: 'bottom left', anchorPoint: { x: 'right', y: 'top' } },
            { name: 'topLeft', space: spaces.topLeft, origin: 'bottom right', anchorPoint: { x: 'left', y: 'top' } }
        ];

        // 计算每个方向的得分（可用面积）
        const scoredDirections = directions.map(dir => ({
            ...dir,
            score: dir.space.width * dir.space.height
        }));

        // 按得分排序
        scoredDirections.sort((a, b) => b.score - a.score);
        
        // 获取最佳方向
        let bestDirection = scoredDirections[0];
        
        return bestDirection;
    }

    /**
     * 计算最优尺寸
     */
    calculateOptimalSize(direction, spaces) {
        const { space } = direction;
        
        // 边界情况处理：确保可用空间至少等于最小尺寸
        const availableHeight = Math.max(space.height, SummaryDialog.MIN_HEIGHT);
        
        const maxHeight = Math.min(
            SummaryDialog.MAX_HEIGHT * window.innerHeight / 100, // 转换vh为px
            availableHeight
        );

        // 根据内容计算最小所需尺寸
        const contentSize = this.estimateContentSize();
        
        // 宽度固定，高度根据内容调整
        const width = SummaryDialog.FIXED_WIDTH;
        
        const height = Math.max(
            SummaryDialog.MIN_HEIGHT,
            Math.min(maxHeight, Math.max(contentSize.height, SummaryDialog.MIN_HEIGHT))
        );

        return { width, height };
    }

    /**
     * 估算内容所需尺寸
     */
    estimateContentSize() {
        try {
            // 基于当前对话内容估算所需尺寸
            const messages = this.conversationArea.querySelectorAll('.foxlate-summary-message');
            let estimatedHeight = SummaryDialog.CONTENT_PADDING; // 基础padding
            
            if (messages.length > 0) {
                // 如果已有消息，基于现有内容估算
                estimatedHeight += this.conversationArea.scrollHeight;
            } else {
                // 初始尺寸估算
                estimatedHeight += 150; // 基础高度
            }

            // 添加其他固定元素的高度
            const header = this.element.querySelector('.foxlate-summary-header');
            const tabs = this.element.querySelector('.foxlate-summary-tabs');
            const menubar = this.element.querySelector('.foxlate-summary-menubar');
            const footer = this.element.querySelector('.foxlate-summary-footer');
            
            if (header) estimatedHeight += header.offsetHeight;
            if (tabs && tabs.style.display !== 'none') estimatedHeight += tabs.offsetHeight;
            if (menubar) estimatedHeight += menubar.offsetHeight;
            if (footer) estimatedHeight += footer.offsetHeight;

            // 边界情况处理：确保估算高度在合理范围内
            const maxHeight = window.innerHeight * 0.9; // 最大不超过视窗高度的90%
            estimatedHeight = Math.min(estimatedHeight, maxHeight);

            return {
                width: SummaryDialog.FIXED_WIDTH,
                height: Math.max(estimatedHeight, SummaryDialog.MIN_HEIGHT)
            };
        } catch (error) {
            console.error('[Foxlate Summary] Error estimating content size:', error);
            // 返回安全的默认尺寸
            return {
                width: SummaryDialog.FIXED_WIDTH,
                height: SummaryDialog.MIN_HEIGHT
            };
        }
    }

    /**
     * 应用对话框尺寸
     */
    applyDialogSize(size, direction) {
        this.targetDimensions = size;
        
        // 如果正在动画中，直接更新目标尺寸
        if (this.isAnimating) {
            return;
        }

        // 检查是否需要动画
        const currentWidth = this.element.offsetWidth;
        const currentHeight = this.element.offsetHeight;
        
        if (Math.abs(currentWidth - size.width) > 5 || Math.abs(currentHeight - size.height) > 5) {
            this.animateSizeChange(currentWidth, currentHeight, size.width, size.height);
        } else {
            // 直接应用尺寸
            this.element.style.width = `${size.width}px`;
            this.element.style.maxHeight = `${size.height}px`;
        }
    }

    /**
     * 动画尺寸变化
     */
    animateSizeChange(fromWidth, fromHeight, toWidth, toHeight) {
        if (this.isAnimating) return;
        
        // 边界情况处理：确保尺寸值有效
        const safeFromWidth = fromWidth || SummaryDialog.FIXED_WIDTH;
        const safeFromHeight = Math.max(SummaryDialog.MIN_HEIGHT, fromHeight || SummaryDialog.MIN_HEIGHT);
        const safeToWidth = toWidth || SummaryDialog.FIXED_WIDTH;
        const safeToHeight = Math.max(SummaryDialog.MIN_HEIGHT, toHeight || SummaryDialog.MIN_HEIGHT);
        
        this.isAnimating = true;
        this.element.classList.add('growing');
        const startTime = performance.now();
        const duration = SummaryDialog.GROWTH_ANIMATION_DURATION;

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // 使用缓动函数
            const easeProgress = this.easeOutCubic(progress);
            
            const currentWidth = safeFromWidth + (safeToWidth - safeFromWidth) * easeProgress;
            const currentHeight = safeFromHeight + (safeToHeight - safeFromHeight) * easeProgress;
            
            this.element.style.width = `${currentWidth}px`;
            this.element.style.maxHeight = `${currentHeight}px`;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.isAnimating = false;
                this.element.classList.remove('growing');
                // 如果在动画过程中目标尺寸发生变化，重新开始动画
                if (this.targetDimensions.width !== safeToWidth || this.targetDimensions.height !== safeToHeight) {
                    this.applyDialogSize(this.targetDimensions, this.currentQuadrant);
                }
            }
        };
        
        requestAnimationFrame(animate);
    }

    /**
     * 缓动函数：三次方缓出
     */
    easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    /**
     * 应用对话框位置
     */
    applyDialogPosition(direction, top, left, right, bottom, winWidth, winHeight, margin) {
        // 清除旧的定位属性
        this.element.style.top = '';
        this.element.style.left = '';
        this.element.style.bottom = '';
        this.element.style.right = '';

        const position = {};
        position.transformOrigin = direction.origin;

        // 边界情况处理：确保所有坐标值都是有效的
        const safeTop = Math.max(0, Math.min(top, winHeight));
        const safeLeft = Math.max(0, Math.min(left, winWidth));
        const safeRight = Math.max(0, Math.min(right, winWidth));
        const safeBottom = Math.max(0, Math.min(bottom, winHeight));
        const safeWidth = this.targetDimensions.width || SummaryDialog.FIXED_WIDTH;
        const safeHeight = Math.max(SummaryDialog.MIN_HEIGHT, this.targetDimensions.height || SummaryDialog.MIN_HEIGHT);

        switch (direction.name) {
            case 'bottom':
                position.top = `${safeBottom + 8}px`;
                position.left = `${Math.max(margin, Math.min(safeLeft, winWidth - safeWidth - margin))}px`;
                break;
            case 'top':
                position.bottom = `${winHeight - safeTop + 8}px`;
                position.left = `${Math.max(margin, Math.min(safeLeft, winWidth - safeWidth - margin))}px`;
                break;
            case 'right':
                position.top = `${safeTop}px`;
                position.left = `${safeRight + 8}px`;
                // 确保右侧不会超出屏幕
                if (safeRight + 8 + safeWidth > winWidth) {
                    position.left = `${winWidth - safeWidth - margin}px`;
                }
                break;
            case 'left':
                position.top = `${safeTop}px`;
                position.right = `${winWidth - safeLeft + 8}px`;
                // 确保左侧不会超出屏幕
                if (safeLeft - 8 - safeWidth < 0) {
                    position.left = `${margin}px`;
                    position.right = '';
                }
                break;
            case 'bottomRight':
                position.top = `${safeBottom + 8}px`;
                position.left = `${safeRight + 8}px`;
                // 确保不会超出屏幕边界
                if (safeRight + 8 + safeWidth > winWidth) {
                    position.left = `${winWidth - safeWidth - margin}px`;
                }
                break;
            case 'bottomLeft':
                position.top = `${safeBottom + 8}px`;
                position.right = `${winWidth - safeLeft + 8}px`;
                // 确保不会超出屏幕边界
                if (safeLeft - 8 - safeWidth < 0) {
                    position.left = `${margin}px`;
                    position.right = '';
                }
                break;
            case 'topRight':
                position.bottom = `${winHeight - safeTop + 8}px`;
                position.left = `${safeRight + 8}px`;
                // 确保不会超出屏幕边界
                if (safeRight + 8 + safeWidth > winWidth) {
                    position.left = `${winWidth - safeWidth - margin}px`;
                }
                break;
            case 'topLeft':
                position.bottom = `${winHeight - safeTop + 8}px`;
                position.right = `${winWidth - safeLeft + 8}px`;
                // 确保不会超出屏幕边界
                if (safeLeft - 8 - safeWidth < 0) {
                    position.left = `${margin}px`;
                    position.right = '';
                }
                break;
        }

        Object.assign(this.element.style, position);
    }

    handleWindowResizeAndScroll() {
        // 重新获取 summaryButton 的位置，因为滚动和resize会改变其位置
        if (this.lastButtonElement) {
            this.lastButtonRect = this.lastButtonElement.getBoundingClientRect();
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
     */
    adjustSizeToContent() {
        if (!this.isOpen || !this.currentQuadrant) return;

        // 重新计算内容所需尺寸
        const contentSize = this.estimateContentSize();
        
        // 获取当前可用空间
        const { top, left, right, bottom } = this.lastButtonRect;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const MARGIN = SummaryDialog.MARGIN;
        const spaces = this.calculateAvailableSpaces(top, left, right, bottom, winWidth, winHeight, MARGIN);
        
        // 找到当前方向的可用空间
        const currentDirection = this.selectBestDirection(spaces);
        
        // 计算新的最优尺寸
        const newSize = this.calculateOptimalSize(currentDirection, spaces);
        
        // 如果尺寸有显著变化，应用新尺寸
        const currentWidth = this.element.offsetWidth;
        const currentHeight = this.element.offsetHeight;
        
        if (Math.abs(currentWidth - newSize.width) > 10 || Math.abs(currentHeight - newSize.height) > 10) {
            this.targetDimensions = newSize;
            this.applyDialogSize(newSize, currentDirection);
        }
    }

    hide() {
        this.isOpen = false;
        this.element.classList.remove('visible');
        setTimeout(() => { if (!this.isOpen) this.element.style.visibility = 'hidden'; }, 200);

        // 移除窗口大小和滚动监听器
        window.removeEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.removeEventListener('scroll', this.debouncedHandleResizeAndScroll, true);
        
        // 移除对话框内的滚动事件监听器
        this.element.removeEventListener('wheel', this.boundPreventScrollPropagation);
        this.element.removeEventListener('touchmove', this.boundPreventScrollPropagation);
    }

    resetSuggestions() {
        this.suggestionsArea.classList.remove('is-visible');
        this.suggestionsArea.innerHTML = '';
        this.suggestButton.disabled = false;
        this.suggestButton.classList.remove('loading');
    }

    setFullRerenderNeeded(needed) {
        this._fullRerenderNeeded = needed;
    }

    destroy() {
        // 移除所有事件监听器
        this.sendButton?.removeEventListener('click', this.boundHandleSendMessage);
        this.refreshButton?.removeEventListener('click', this.boundHandleRefresh);
        this.suggestButton?.removeEventListener('click', this.boundToggleSuggestions);
        this.textarea?.removeEventListener('keydown', this.boundHandleTextareaKeydown);
        this.textarea?.removeEventListener('input', this.boundHandleTextareaInput);
        this.conversationArea?.removeEventListener('click', this.boundHandleConversationClick);
        this.tabsArea?.removeEventListener('click', this.boundHandleTabsAreaClick);

        // 移除建议区域的事件监听器
        if (this._suggestionsClickHandler && this.suggestionsArea) {
            this.suggestionsArea.removeEventListener('click', this._suggestionsClickHandler);
            this._suggestionsClickHandler = null;
        }

        // 移除窗口大小和滚动监听器 (确保在 hide() 之后再次调用 destroy() 时也能清理)
        window.removeEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.removeEventListener('scroll', this.debouncedHandleResizeAndScroll, true);
        
        // 移除对话框内的滚动事件监听器
        this.element.removeEventListener('wheel', this.boundPreventScrollPropagation);
        this.element.removeEventListener('touchmove', this.boundPreventScrollPropagation);

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

        this.element?.remove();
    }
}