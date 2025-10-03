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

    constructor() {
        this.isOpen = false;
        this._renderedMessageCount = 0;
        this._fullRerenderNeeded = false;
        this.lastButtonRect = null; // 用于存储上次 show 时的 buttonRect
        this.lastButtonElement = null; // 用于存储按钮元素，以便在滚动时重新获取位置

        // 绑定事件处理函数，以便在移除时使用
        this.boundHandleSendMessage = () => this.dispatchEvent('send-message', { query: this.textarea.value.trim() });
        this.boundHandleRefresh = () => this.dispatchEvent('refresh');
        this.boundToggleSuggestions = () => this.toggleSuggestions();
        this.boundHandleTextareaKeydown = (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this.dispatchEvent('send-message', { query: this.textarea.value.trim() });
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
            this.textarea.value = '';
            this.textarea.style.height = 'auto';
        }
    }

    renderConversation(history, isLoading = false) {
        if (!this.conversationArea) return;

        if (!history || this._fullRerenderNeeded) {
            this.conversationArea.innerHTML = '';
            this._renderedMessageCount = 0;
            this._fullRerenderNeeded = false;
        }

        if (!history) return;

        for (let i = this._renderedMessageCount; i < history.length; i++) {
            this.renderMessage(history[i], i);
        }
        this._renderedMessageCount = history.length;

        const existingLoadingEl = this.conversationArea.querySelector('.foxlate-summary-message.assistant.loading');
        if (isLoading) {
            if (!existingLoadingEl) {
                const loadingEl = document.createElement('div');
                loadingEl.className = 'foxlate-summary-message assistant loading';
                loadingEl.innerHTML = `<div class="loading-indicator"></div>`;
                this.conversationArea.appendChild(loadingEl);
            }
        } else {
            if (existingLoadingEl) existingLoadingEl.remove();
        }

        this.conversationArea.scrollTop = this.conversationArea.scrollHeight;
    }

    renderMessage(message, index) {
        if (message.isHidden) return;
        const messageEl = document.createElement('div');
        messageEl.className = `foxlate-summary-message ${message.role}`;
        messageEl.dataset.index = index;
        if (message.isError) messageEl.classList.add('error');
        const content = message.role === 'user' ? message.content : message.contents[message.activeContentIndex];
        messageEl.innerHTML = `<div class="message-content">${marked.parse(content)}</div>${this.getActionsHtml(message)}`;
        this.conversationArea.appendChild(messageEl);
    }

    getActionsHtml(message) {
        let buttons = `<button data-action="copy" aria-label="Copy">${this.getIcon('copy')}</button>`;
        if (message.role === 'user') {
            buttons += `<button data-action="edit" aria-label="Edit">${this.getIcon('edit')}</button>`;
        } else if (!message.isError) {
            if (message.contents.length > 1) {
                buttons += `
                    <button data-action="history-prev" ${message.activeContentIndex === 0 ? 'disabled' : ''}>${this.getIcon('prev')}</button>
                    <span>${message.activeContentIndex + 1}/${message.contents.length}</span>
                    <button data-action="history-next" ${message.activeContentIndex === message.contents.length - 1 ? 'disabled' : ''}>${this.getIcon('next')}</button>
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

            parsedSuggestions.forEach(suggestion => {
                const suggestionEl = document.createElement('div');
                suggestionEl.className = 'foxlate-suggestion-item';
                suggestionEl.innerHTML = `
                    <span class="suggestion-text">${suggestion}</span>
                    <button class="edit-suggestion-button" data-suggestion="${suggestion}" aria-label="Edit suggestion">${this.getIcon('edit')}</button>
                `;
                this.suggestionsArea.appendChild(suggestionEl);
            });

            this.suggestionsArea.querySelectorAll('.foxlate-suggestion-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (!e.target.closest('.edit-suggestion-button')) {
                        const suggestion = item.querySelector('.suggestion-text').textContent;
                        this.dispatchEvent('send-message', { query: suggestion });
                        this.toggleSuggestions();
                    }
                });
            });

            this.suggestionsArea.querySelectorAll('.edit-suggestion-button').forEach(button => {
                button.addEventListener('click', (e) => {
                    const suggestion = e.currentTarget.dataset.suggestion;
                    this.textarea.value = suggestion;
                    this.textarea.style.height = 'auto';
                    this.textarea.style.height = `${this.textarea.scrollHeight}px`;
                    this.textarea.focus();
                    this.toggleSuggestions();
                });
            });
        } else {
            this.suggestionsArea.innerHTML = `
                <div class="foxlate-suggestion-message foxlate-suggestion-error">
                    ${browser.i18n.getMessage('summaryNoSuggestions') || 'No suggestions available.'}
                </div>
            `;
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

        this.repositionDialog(); // 调用重定位方法

        // 添加窗口大小和滚动监听器
        window.addEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.addEventListener('scroll', this.debouncedHandleResizeAndScroll, true); // 捕获阶段监听，确保能捕获到所有滚动事件

        this.element.classList.add('visible');
        this.textarea.focus();
    }

    repositionDialog() {
        if (!this.isOpen || !this.lastButtonRect) return; // 如果对话框未打开或没有 buttonRect，则不重定位

        const dialogWidth = this.element.offsetWidth;
        const dialogHeight = this.element.offsetHeight;
        const { top, left, right, bottom } = this.lastButtonRect;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const MARGIN = SummaryDialog.MARGIN; // 使用常量

        const quadrants = [
            { name: 'bottomAlignLeft', score: Math.min(dialogWidth, winWidth - left - MARGIN) * Math.min(dialogHeight, winHeight - bottom - MARGIN), origin: 'top left', top: `${bottom + 8}px`, left: `${left}px` },
            { name: 'bottomAlignRight', score: Math.min(dialogWidth, right - MARGIN) * Math.min(dialogHeight, winHeight - bottom - MARGIN), origin: 'top right', top: `${bottom + 8}px`, right: `${winWidth - right}px` },
            { name: 'topAlignLeft', score: Math.min(dialogWidth, winWidth - left - MARGIN) * Math.min(dialogHeight, top - MARGIN), origin: 'bottom left', bottom: `${winHeight - top + 8}px`, left: `${left}px` },
            { name: 'topAlignRight', score: Math.min(dialogWidth, right - MARGIN) * Math.min(dialogHeight, top - MARGIN), origin: 'bottom right', bottom: `${winHeight - top + 8}px`, right: `${winWidth - right}px` },
            { name: 'rightTop', score: Math.min(dialogWidth, winWidth - right - MARGIN) * Math.min(dialogHeight, winHeight - top - MARGIN), origin: 'top left', top: `${top}px`, left: `${right + 8}px` },
            { name: 'rightBottom', score: Math.min(dialogWidth, winWidth - right - MARGIN) * Math.min(dialogHeight, bottom - MARGIN), origin: 'bottom left', bottom: `${winHeight - bottom}px`, left: `${right + 8}px` },
            { name: 'leftTop', score: Math.min(dialogWidth, left - MARGIN) * Math.min(dialogHeight, winHeight - top - MARGIN), origin: 'top right', top: `${top}px`, right: `${winWidth - left + 8}px` },
            { name: 'leftBottom', score: Math.min(dialogWidth, left - MARGIN) * Math.min(dialogHeight, bottom - MARGIN), origin: 'bottom right', bottom: `${winHeight - bottom}px`, right: `${winWidth - left + 8}px` },
        ];

        let bestQuadrant = quadrants.sort((a, b) => b.score - a.score)[0];

        // 清除旧的定位属性，避免冲突
        this.element.style.top = '';
        this.element.style.left = '';
        this.element.style.bottom = '';
        this.element.style.right = '';

        Object.assign(this.element.style, { transformOrigin: bestQuadrant.origin, top: bestQuadrant.top || '', left: bestQuadrant.left || '', bottom: bestQuadrant.bottom || '', right: bestQuadrant.right || '' });
    }

    handleWindowResizeAndScroll() {
        // 重新获取 summaryButton 的位置，因为滚动和resize会改变其位置
        if (this.lastButtonElement) {
            this.lastButtonRect = this.lastButtonElement.getBoundingClientRect();
        }
        this.repositionDialog();
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
    }

    setFullRerenderNeeded(needed) {
        this._fullRerenderNeeded = needed;
    }

    destroy() {
        // 移除所有事件监听器
        this.sendButton.removeEventListener('click', this.boundHandleSendMessage);
        this.refreshButton.removeEventListener('click', this.boundHandleRefresh);
        this.suggestButton.removeEventListener('click', this.boundToggleSuggestions);
        this.textarea.removeEventListener('keydown', this.boundHandleTextareaKeydown);
        this.textarea.removeEventListener('input', this.boundHandleTextareaInput);
        this.conversationArea.removeEventListener('click', this.boundHandleConversationClick);
        this.tabsArea.removeEventListener('click', this.boundHandleTabsAreaClick);

        // 移除窗口大小和滚动监听器 (确保在 hide() 之后再次调用 destroy() 时也能清理)
        window.removeEventListener('resize', this.debouncedHandleResizeAndScroll);
        window.removeEventListener('scroll', this.debouncedHandleResizeAndScroll, true);

        this.element?.remove();
    }
}