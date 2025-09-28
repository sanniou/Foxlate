// src/content/summary/summary.js

import browser from '../../lib/browser-polyfill.js';
import { marked } from '../../lib/marked.esm.js';
import { DEFAULT_SETTINGS } from '../../common/constants.js';

class SummaryModule {
    constructor(settings) {
        this.settings = settings;
        this.summaryButton = null;
        this.summaryDialog = null;
        this.isDragging = false;
        this.positionButtonX = 0; // Initialize
        this.positionButtonY = 0; // Initialize
        this.selectionContext = null; // { text: string, rect: DOMRect }

        // Tab management
        this.tabs = []; // { id, title, history, type, state: 'idle' | 'loading' | 'summarized' | 'error' }
        this.activeTabId = null;
        this.nextTabId = 0;
        this.nextSelectionTabNum = 1;

        this.init();
    }

    init() {
        if (document.body) {
            this.summaryButton = new SummaryButton();
            this.summaryDialog = new SummaryDialog(
                this.handleSendMessage.bind(this),
                this.handleAction.bind(this),
                this.handleRefresh.bind(this),
                this.handleInferSuggestions.bind(this),
                this.handleTabSwitch.bind(this),
                this.handleTabClose.bind(this)
            );
            this.setupEventListeners();
            this.positionInitialButton();
        } else {
            window.addEventListener('DOMContentLoaded', () => this.init());
        }
    }

    positionInitialButton() {
        const mainBodySelector = this.settings.summarySettings?.mainBodySelector;
        let targetElement = document.body;
        let initialX , initialY ;
        if (mainBodySelector) {
            const foundElement = document.querySelector(mainBodySelector);
            if (foundElement) {
                targetElement = foundElement;
                const targetRect = targetElement.getBoundingClientRect();
                initialX = targetRect.right + 10;
                initialY = targetRect.top + 50;
            }
        }
        if (!initialX || !initialY) {
            const bodyRect = document.body.getBoundingClientRect();
            initialX = bodyRect.right - 250;
            initialY = bodyRect.top + 250;
        }
        this.positionButtonX = initialX; // Store initial X
        this.positionButtonY = initialY; // Store initial Y
        this.summaryButton.setPosition(initialX, initialY);
    }

    setupEventListeners() {
        this.summaryButton.element.addEventListener('click', () => {
            if (!this.isDragging) this.handleSummaryButtonClick();
        });

        this.summaryButton.element.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const fabStartRect = this.summaryButton.element.getBoundingClientRect();
            let hasDragged = false;
            const wasOpenBeforeDrag = this.summaryDialog.isOpen;

            const handleDragMove = (moveEvent) => {
                moveEvent.preventDefault();
                const dx = moveEvent.clientX - startX, dy = moveEvent.clientY - startY;
                if (!hasDragged && Math.hypot(dx, dy) > 5) {
                    hasDragged = true;
                    this.isDragging = true;
                    this.summaryButton.element.classList.add('dragging'); // Bug 4 Fix
                    if (wasOpenBeforeDrag) this.summaryDialog.hide();
                }
                if (hasDragged) this.summaryButton.setPosition(fabStartRect.left + dx, fabStartRect.top + dy);
            };

            const handleDragEnd = () => {
                document.removeEventListener('mousemove', handleDragMove);
                document.removeEventListener('mouseup', handleDragEnd);
                this.summaryButton.element.classList.remove('dragging');

                // Save the final position after dragging
                const finalRect = this.summaryButton.element.getBoundingClientRect();
                this.positionButtonX = finalRect.left;
                this.positionButtonY = finalRect.top;

                if (hasDragged && wasOpenBeforeDrag) {
                    requestAnimationFrame(() => {
                        const buttonRect = this.summaryButton.element.getBoundingClientRect();
                        this.summaryDialog.show(buttonRect);
                    });
                }
                setTimeout(() => { this.isDragging = false; }, 0);
            };

            document.addEventListener('mousemove', handleDragMove);
            document.addEventListener('mouseup', handleDragEnd);
        });

        document.addEventListener('mouseup', this.handleSelection.bind(this));
    }

    handleSelection(event) {
        if (this.summaryDialog.element.contains(event.target)) return;

        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText.length > 50) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            this.selectionContext = { text: selectedText, rect };
            // Apply offset
            this.summaryButton.setPosition(rect.right + 10, rect.top - 10);
        } else {
            this.selectionContext = null;
            // Only reset position if not currently dragging the button
            if (!this.isDragging) {
                this.summaryButton.setPosition(this.positionButtonX, this.positionButtonY);
            }
        }
    }

    async handleSummaryButtonClick() {
        if (this.selectionContext) {
            await this.fetchSelectionSummary();
            this.selectionContext = null;
        } else {
            await this.togglePageSummaryDialog();
        }
    }

    async togglePageSummaryDialog() {
        this.summaryButton.element.classList.toggle('rotated');
        if (this.summaryDialog.isOpen) {
            this.summaryDialog.hide();
        } else {
            const pageTab = this.tabs.find(t => t.type === 'page');
            if (!pageTab) {
                await this.fetchInitialPageSummary();
            } else {
                this.activeTabId = pageTab.id;
                this.updateDialogUI();
                this.summaryDialog.show(this.summaryButton.element.getBoundingClientRect());
            }
        }
    }

    getActiveTab() {
        return this.tabs.find(t => t.id === this.activeTabId);
    }

    updateDialogUI() {
        const activeTab = this.getActiveTab();
        if (!activeTab) {
            if (this.tabs.length === 0) this.summaryDialog.hide();
            return;
        }
        this.summaryDialog.renderTabs(this.tabs, this.activeTabId);
        this.summaryDialog.renderConversation(activeTab.history, activeTab.state === 'loading'); // Bug 2 Fix
        this.summaryDialog.setLoading(activeTab.state === 'loading');
    }

    async fetchInitialPageSummary() {
        const newTab = this.createNewTab('page', browser.i18n.getMessage('summaryTabPageTitle') || 'Page');
        this.tabs.push(newTab);
        this.activeTabId = newTab.id;
        this.summaryDialog.show(this.summaryButton.element.getBoundingClientRect());
        await this.fetchSummaryForTab(newTab);
    }

    async fetchSelectionSummary() {
        this.summaryButton.element.classList.add('rotated'); // Bug 3 Fix
        const newTab = this.createNewTab('selection', `${browser.i18n.getMessage('summaryTabSelectionTitle') || 'Selection'} ${this.nextSelectionTabNum++}`);
        newTab.selectionText = this.selectionContext.text;
        this.tabs.push(newTab);
        this.activeTabId = newTab.id;
        this.summaryDialog.show(this.summaryButton.element.getBoundingClientRect());
        await this.fetchSummaryForTab(newTab, this.selectionContext.text);
    }

    async fetchSummaryForTab(tab, text = null) {
        tab.state = 'loading';
        tab.history = [];
        this.summaryDialog._fullRerenderNeeded = true;
        this.updateDialogUI();

        try {
            let content = text;
            if (!content) content = await this.extractPageContent();
            if (!content.trim()) throw new Error('Failed to extract any meaningful content.');

            const response = await browser.runtime.sendMessage({
                type: 'SUMMARIZE_CONTENT',
                payload: { text: content, aiModel: this.settings.summarySettings?.aiModel, targetLang: this.settings.targetLanguage }
            });

            if (!response.success) throw new Error(response.error);
            tab.history.push({ role: 'user', content: content, isHidden: true });
            tab.history.push({ role: 'assistant', contents: [response.summary], activeContentIndex: 0 });
            tab.state = 'summarized';
        } catch (error) {
            console.error('[Foxlate Summary] Error:', error);
            tab.history.push({ role: 'assistant', contents: [`**Error:** ${error.message}`], activeContentIndex: 0, isError: true });
            tab.state = 'error';
        } finally {
            this.updateDialogUI();
        }
    }

    async extractPageContent() {
        const selector = this.settings.summarySettings?.mainBodySelector;
        const charThreshold = this.settings.summarySettings?.charThreshold || DEFAULT_SETTINGS.summarySettings.charThreshold;
        let content = '';
        if (selector) {
            const element = document.querySelector(selector);
            if (element) {
                try {
                    const { default: Readability } = await import('../../lib/readability.esm.js');
                    const doc = document.implementation.createHTMLDocument('');
                    doc.body.innerHTML = element.innerHTML;
                    const reader = new Readability(doc, { charThreshold: charThreshold });
                    const article = reader.parse();
                    content = article?.textContent || '';
                } catch (e) { console.warn('[Foxlate Summary] Readability on selector failed.', e); }
                if (!content) content = element.innerText;
            }
        }

        if (!content) {
            try {
                const { default: Readability } = await import('../../lib/readability.esm.js');
                const docClone = document.cloneNode(true);
                const reader = new Readability(docClone, { charThreshold: charThreshold });
                const article = reader.parse();
                content = article?.textContent || '';
            } catch (e) { console.warn('[Foxlate Summary] Global Readability failed.', e); }
        }

        if (!content) {
            console.warn('[Foxlate Summary] Fallback to body.innerText.');
            content = document.body.innerText;
        }
        return content;
    }

    async handleSendMessage(query) {
        const activeTab = this.getActiveTab();
        if (!query || !activeTab || activeTab.state === 'loading') return;
        activeTab.history.push({ role: 'user', content: query });
        await this.getAIResponseForTab(activeTab);
    }

    async getAIResponseForTab(tab, isReroll = false) {
        tab.state = 'loading';
        this.updateDialogUI();

        try {
            const historyForAI = tab.history.map(msg => ({
                role: msg.role,
                content: msg.role === 'user' ? msg.content : msg.contents[msg.activeContentIndex]
            }));

            const response = await browser.runtime.sendMessage({
                type: 'CONVERSE_WITH_AI',
                payload: { history: historyForAI, aiModel: this.settings.summarySettings?.aiModel, targetLang: this.settings.targetLanguage }
            });
            if (!response.success) throw new Error(response.error);

            const lastMessage = tab.history[tab.history.length - 1];
            if (isReroll && lastMessage?.role === 'assistant') {
                lastMessage.contents.push(response.reply);
                lastMessage.activeContentIndex = lastMessage.contents.length - 1;
            } else {
                tab.history.push({ role: 'assistant', contents: [response.reply], activeContentIndex: 0 });
            }
            tab.state = 'summarized';
        } catch (error) {
            console.error('[Foxlate Summary] AI response error:', error);
            tab.history.push({ role: 'assistant', contents: [`**Error:** ${error.message}`], activeContentIndex: 0, isError: true });
            tab.state = 'error';
        } finally {
            this.updateDialogUI();
        }
    }

    async handleAction(action, index, payload) {
        const activeTab = this.getActiveTab();
        if (!activeTab) return;
        const message = activeTab.history[index];
        if (!message) return;

        switch (action) {
            case 'reroll':
                activeTab.history = activeTab.history.slice(0, index + 1);
                this.summaryDialog._fullRerenderNeeded = true;
                await this.getAIResponseForTab(activeTab, true);
                break;
            case 'save-edit':
                activeTab.history = activeTab.history.slice(0, index);
                activeTab.history.push({ role: 'user', content: payload });
                this.summaryDialog._fullRerenderNeeded = true;
                await this.getAIResponseForTab(activeTab);
                break;
            default:
                this.summaryDialog.handleAction(action, message, index);
                break;
        }
    }

    async handleInferSuggestions() {
        const activeTab = this.getActiveTab();
        if (!activeTab) return;
        this.summaryDialog.setLoading(true);
        try {
            const historyForAI = activeTab.history.map(msg => ({
                role: msg.role,
                content: msg.role === 'user' ? msg.content : msg.contents[msg.activeContentIndex]
            }));
            const response = await browser.runtime.sendMessage({
                type: 'INFER_SUGGESTIONS',
                payload: {
                    history: historyForAI,
                    aiModel: this.settings.summarySettings?.aiModel,
                    targetLang: this.settings.targetLanguage
                }
            });
            if (!response.success) throw new Error(response.error);
            this.summaryDialog.renderSuggestions(response.suggestions);
        } catch (error) {
            console.error('[Foxlate Summary] Suggestion error:', error);
            this.summaryDialog.renderSuggestions([`**Error:** ${error.message}`]);
        } finally {
            this.summaryDialog.setLoading(false);
        }
    }

    handleRefresh() {
        const activeTab = this.getActiveTab();
        if (!activeTab || activeTab.state === 'loading') return;
        this.fetchSummaryForTab(activeTab, activeTab.type === 'selection' ? activeTab.selectionText : null);
    }

    handleTabSwitch(tabId) {
        if (this.activeTabId === tabId) return;
        this.activeTabId = tabId;
        this.summaryDialog._fullRerenderNeeded = true; // Bug 1 Fix
        this.updateDialogUI();
        this.summaryDialog.resetSuggestions(); // Reset suggestion bar
    }

    handleTabClose(tabId) {
        const tabIndex = this.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return;

        this.tabs.splice(tabIndex, 1);

        if (this.activeTabId === tabId) {
            if (this.tabs.length > 0) {
                const newIndex = Math.max(0, tabIndex - 1);
                this.activeTabId = this.tabs[newIndex].id;
            } else {
                this.activeTabId = null;
                this.summaryDialog.hide();
                this.summaryButton.element.classList.remove('rotated');
            }
        }
        this.summaryDialog._fullRerenderNeeded = true;
        this.updateDialogUI();
    }

    createNewTab(type, title) {
        return { id: this.nextTabId++, title, history: [], type, state: 'idle', selectionText: null };
    }

    destroy() {
        this.summaryButton?.destroy();
        this.summaryDialog?.destroy();
        document.removeEventListener('mouseup', this.handleSelection.bind(this));
    }
}

class SummaryButton {
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

class SummaryDialog {
    constructor(sendMessageHandler, actionHandler, refreshHandler, inferSuggestionsHandler, tabSwitchHandler, tabCloseHandler) {
        this.isOpen = false;
        this.sendMessageHandler = sendMessageHandler;
        this.actionHandler = actionHandler;
        this.refreshHandler = refreshHandler;
        this.inferSuggestionsHandler = inferSuggestionsHandler;
        this.tabSwitchHandler = tabSwitchHandler;
        this.tabCloseHandler = tabCloseHandler;
        this._renderedMessageCount = 0;
        this._fullRerenderNeeded = false;
        this.create();
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
        this.sendButton = this.element.querySelector('.send-button');
        this.refreshButton = this.element.querySelector('.refresh-button');
        document.body.appendChild(this.element);

        this.sendButton.addEventListener('click', () => this.triggerSend());
        this.refreshButton.addEventListener('click', () => this.refreshHandler());
        this.suggestButton.addEventListener('click', () => this.toggleSuggestions());
        this.textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); this.triggerSend(); } });
        this.textarea.addEventListener('input', () => { this.textarea.style.height = 'auto'; this.textarea.style.height = `${this.textarea.scrollHeight}px`; });

        this.conversationArea.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            const index = parseInt(target.closest('.foxlate-summary-message').dataset.index, 10);
            this.actionHandler(action, index, action === 'save-edit' ? target.closest('.message-edit-area').querySelector('textarea').value : null);
        });

        this.tabsArea.addEventListener('click', (e) => {
            const tabEl = e.target.closest('.foxlate-summary-tab');
            if (!tabEl) return;
            const tabId = parseInt(tabEl.dataset.tabId, 10);
            if (e.target.closest('.foxlate-summary-tab-close')) {
                this.tabCloseHandler(tabId);
            } else {
                this.tabSwitchHandler(tabId);
            }
        });
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
            this.sendMessageHandler(query);
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

    handleAction(action, message, index) {
        switch (action) {
            case 'copy':
                navigator.clipboard.writeText(message.role === 'user' ? message.content : message.contents[message.activeContentIndex]);
                break;
            case 'edit':
                this.enterEditMode(index, message.content);
                break;
            case 'cancel-edit':
                this._fullRerenderNeeded = true;
                this.renderConversation(this.getActiveTab().history);
                break;
            case 'history-prev':
            case 'history-next':
                if (message.role === 'assistant') {
                    const direction = action === 'history-prev' ? -1 : 1;
                    const newIndex = message.activeContentIndex + direction;
                    if (newIndex >= 0 && newIndex < message.contents.length) {
                        message.activeContentIndex = newIndex;
                        this._fullRerenderNeeded = true;
                        this.renderConversation(this.getActiveTab().history);
                    }
                }
                break;
        }
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
            this.inferSuggestionsHandler().finally(() => {
                this.suggestButton.disabled = false;
                this.suggestButton.classList.remove('loading');
            });
        }
    }

    renderSuggestions(suggestions) {
        this.suggestionsArea.innerHTML = '';
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
                        this.sendMessageHandler(suggestion);
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
        this.element.style.visibility = 'visible';
        const MARGIN = 16;
        const dialogWidth = this.element.offsetWidth;
        const dialogHeight = this.element.offsetHeight;
        const { top, left, right, bottom } = buttonRect;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const spaceRight = winWidth - right - MARGIN;
        const spaceLeft = left - MARGIN;
        const spaceBelow = winHeight - bottom - MARGIN;
        const spaceAbove = top - MARGIN;

        const quadrants = [
            { name: 'bottomAlignLeft', score: Math.min(dialogWidth, winWidth - left - MARGIN) * Math.min(dialogHeight, spaceBelow), origin: 'top left', top: `${bottom + 8}px`, left: `${left}px` },
            { name: 'bottomAlignRight', score: Math.min(dialogWidth, right - MARGIN) * Math.min(dialogHeight, spaceBelow), origin: 'top right', top: `${bottom + 8}px`, right: `${winWidth - right}px` },
            { name: 'topAlignLeft', score: Math.min(dialogWidth, winWidth - left - MARGIN) * Math.min(dialogHeight, spaceAbove), origin: 'bottom left', bottom: `${winHeight - top + 8}px`, left: `${left}px` },
            { name: 'topAlignRight', score: Math.min(dialogWidth, right - MARGIN) * Math.min(dialogHeight, spaceAbove), origin: 'bottom right', bottom: `${winHeight - top + 8}px`, right: `${winWidth - right}px` },
            { name: 'rightTop', score: Math.min(dialogWidth, spaceRight) * Math.min(dialogHeight, winHeight - top - MARGIN), origin: 'top left', top: `${top}px`, left: `${right + 8}px` },
            { name: 'rightBottom', score: Math.min(dialogWidth, spaceRight) * Math.min(dialogHeight, bottom - MARGIN), origin: 'bottom left', bottom: `${winHeight - bottom}px`, left: `${right + 8}px` },
            { name: 'leftTop', score: Math.min(dialogWidth, spaceLeft) * Math.min(dialogHeight, winHeight - top - MARGIN), origin: 'top right', top: `${top}px`, right: `${winWidth - left + 8}px` },
            { name: 'leftBottom', score: Math.min(dialogWidth, spaceLeft) * Math.min(dialogHeight, bottom - MARGIN), origin: 'bottom right', bottom: `${winHeight - bottom}px`, right: `${winWidth - left + 8}px` },
        ];

        let bestQuadrant = quadrants.sort((a, b) => b.score - a.score)[0];

        Object.assign(this.element.style, { transformOrigin: bestQuadrant.origin, top: bestQuadrant.top || '', left: bestQuadrant.left || '', bottom: bestQuadrant.bottom || '', right: bestQuadrant.right || '' });

        this.element.classList.add('visible');
        this.textarea.focus();
    }

    hide() {
        this.isOpen = false;
        this.element.classList.remove('visible');
        setTimeout(() => { if (!this.isOpen) this.element.style.visibility = 'hidden'; }, 200);
    }

    resetSuggestions() {
        this.suggestionsArea.classList.remove('is-visible');
        this.suggestionsArea.innerHTML = '';
        this.suggestButton.disabled = false;
        this.suggestButton.classList.remove('loading');
    }

    destroy() { this.element?.remove(); }
}

let summaryModuleInstance = null;

export function initializeSummary(settings) {
    if (summaryModuleInstance) summaryModuleInstance.destroy();
    if (settings?.summarySettings?.enabled) {
        summaryModuleInstance = new SummaryModule(settings);
    }
}

export function destroySummary() {
    if (summaryModuleInstance) {
        summaryModuleInstance.destroy();
        summaryModuleInstance = null;
    }
}