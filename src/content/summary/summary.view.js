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
        
        // Tooltip text
        const tooltipText = browser.i18n.getMessage('summaryButtonTooltip') || 'Summarize';
        this.element.setAttribute('data-tooltip', tooltipText);

        // Icons: Sparkles (Default) and Close (Active)
        const sparklesIcon = `<svg class="icon-sparkles" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 2l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z"/></svg>`;
        const closeIcon = `<svg class="icon-close" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

        this.element.innerHTML = sparklesIcon + closeIcon;
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
    static DEFAULT_WIDTH = 400;
    static DEFAULT_HEIGHT = 500;
    static EXPANDED_WIDTH = 600;
    static EXPANDED_HEIGHT = 700;

    constructor() {
        this.isOpen = false;
        this._renderedMessageCount = 0;
        this._fullRerenderNeeded = false;
        this.lastButtonRect = null; // 用于存储上次 show 时的 buttonRect
        this.lastButtonElement = null; // 用于存储按钮元素，以便在滚动时重新获取位置
        this.currentQuadrant = null; // 当前象限

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
            this.textarea.style.height = 'auto';
            this.textarea.style.overflowY = 'hidden'; // 先隐藏以正确计算 scrollHeight
            
            const scrollHeight = this.textarea.scrollHeight;
            const maxHeight = 120; // matches CSS max-height

            if (scrollHeight > maxHeight) {
                this.textarea.style.height = `${maxHeight}px`;
                this.textarea.style.overflowY = 'auto';
            } else {
                this.textarea.style.height = `${scrollHeight}px`;
                this.textarea.style.overflowY = 'hidden';
            }

            // 根据输入内容启用/禁用发送按钮
            this.updateSendButtonState();
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
        this.textarea.style.overflowY = 'hidden';
        // 清空输入后更新发送按钮状态
        this.updateSendButtonState();
        // 确保输入框保持焦点
        requestAnimationFrame(() => {
            this.textarea.focus();
        });
    }

    renderConversation(history, isLoading = false) {
        if (!this.conversationArea) return;

        // 确保 history 是一个数组
        const validHistory = Array.isArray(history) ? history : [];
        const messageCountChanged = validHistory.length !== this._renderedMessageCount;

        // 完全重绘逻辑
        if (this._fullRerenderNeeded || validHistory.length < this._renderedMessageCount) {
            this.conversationArea.innerHTML = '';
            this._renderedMessageCount = 0;
            this._fullRerenderNeeded = false;
        }

        // 从历史记录更新消息
        this.updateMessages(validHistory);

        // 处理加载指示器
        const loadingEl = this.conversationArea.querySelector('.foxlate-summary-message.loading');
        if (isLoading) {
            if (!loadingEl) {
                const indicator = document.createElement('div');
                indicator.className = 'foxlate-summary-message assistant loading';
                indicator.innerHTML = `<div class="loading-indicator"></div>`;
                this.conversationArea.appendChild(indicator);
            }
        } else {
            if (loadingEl) {
                loadingEl.remove();
            }
        }

        // 仅在加载中或消息数量变化时滚动到底部
        if (isLoading || messageCountChanged) {
            requestAnimationFrame(() => {
                this.conversationArea.scrollTop = this.conversationArea.scrollHeight;
            });
        }
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
        // 为编辑模式的输入框添加输入事件监听，以更新发送按钮状态
        textarea.addEventListener('input', () => {
            this.updateSendButtonState();
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
            // 只禁用建议按钮，不禁用发送按钮和输入框
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

        // 确保发送按钮在建议加载完成后保持启用状态
        // 建议过程不应该影响发送按钮状态，只有在 AI 回复时才禁用
        // 这里不直接修改发送按钮状态，让 updateDialogUI 来统一管理

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
                    // 更新发送按钮状态，因为现在有内容了
                    this.updateSendButtonState();
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
        this.lastButtonRect = buttonRect;
        this.lastButtonElement = buttonRect.sourceElement;
        
        if (!this.element.parentNode) {
            document.body.appendChild(this.element);
        }
        
        this.element.style.visibility = 'visible';
        this.element.classList.add('visible');

        // 延迟执行重定位，确保DOM已更新
        requestAnimationFrame(() => {
            this.repositionDialog();
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

        const { top, left, right, bottom, width: btnWidth, height: btnHeight } = this.lastButtonRect;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const MARGIN = SummaryDialog.MARGIN;

        // 按钮中心点
        const btnCenterX = left + btnWidth / 2;
        const btnCenterY = top + btnHeight / 2;

        // 判断象限 (1:右上, 2:左上, 3:左下, 4:右下)
        const isRight = btnCenterX > winWidth / 2;
        const isBottom = btnCenterY > winHeight / 2;

        // 目标尺寸
        const targetWidth = SummaryDialog.DEFAULT_WIDTH;
        const targetHeight = SummaryDialog.DEFAULT_HEIGHT;

        // 计算位置
        let finalTop, finalLeft, transformOrigin;

        if (isBottom) {
            // 底部：向上展开
            finalTop = top - targetHeight - MARGIN;
            transformOrigin = isRight ? 'bottom right' : 'bottom left';
        } else {
            // 顶部：向下展开
            finalTop = bottom + MARGIN;
            transformOrigin = isRight ? 'top right' : 'top left';
        }

        if (isRight) {
            // 右侧：向左展开
            finalLeft = right - targetWidth;
        } else {
            // 左侧：向右展开
            finalLeft = left;
        }

        // 边界修正
        if (finalTop < MARGIN) finalTop = MARGIN;
        if (finalTop + targetHeight > winHeight - MARGIN) finalTop = winHeight - MARGIN - targetHeight;
        if (finalLeft < MARGIN) finalLeft = MARGIN;
        if (finalLeft + targetWidth > winWidth - MARGIN) finalLeft = winWidth - MARGIN - targetWidth;

        // 应用样式
        this.element.style.top = `${finalTop}px`;
        this.element.style.left = `${finalLeft}px`;
        this.element.style.width = `${targetWidth}px`;
        this.element.style.height = `${targetHeight}px`;
        this.element.style.transformOrigin = transformOrigin;
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
        // 暂时保持固定尺寸，后续可根据需求添加动态扩展逻辑
    }

    hide() {
        this.isOpen = false;
        this.element.classList.remove('visible');
        setTimeout(() => { if (!this.isOpen) this.element.style.visibility = 'hidden'; }, 200);

        // 移除窗口大小和滚动监听器
        window.removeEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.removeEventListener('scroll', this.debouncedHandleResizeAndScroll, true);
    }

    resetSuggestions() {
        this.suggestionsArea.classList.remove('is-visible');
        this.suggestionsArea.innerHTML = '';
        this.suggestButton.disabled = false;
        this.suggestButton.classList.remove('loading');
        // 重置建议时不影响发送按钮状态，让 updateDialogUI 统一管理
    }

    setFullRerenderNeeded(needed) {
        this._fullRerenderNeeded = needed;
    }

    renderOriginalText(tab) {
        if (tab && tab.isOriginalTextVisible && tab.originalContent) {
            this.originalTextArea.textContent = tab.originalContent;
            this.originalTextArea.classList.add('is-visible');
        } else {
            this.originalTextArea.classList.remove('is-visible');
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

        // 移除建议区域的事件监听器
        if (this._suggestionsClickHandler && this.suggestionsArea) {
            this.suggestionsArea.removeEventListener('click', this._suggestionsClickHandler);
            this._suggestionsClickHandler = null;
        }

        // 移除窗口大小和滚动监听器 (确保在 hide() 之后再次调用 destroy() 时也能清理)
        window.removeEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.removeEventListener('scroll', this.debouncedHandleResizeAndScroll, true);
        
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