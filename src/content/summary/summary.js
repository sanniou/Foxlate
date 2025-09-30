// src/content/summary/summary.js

import browser from '../../lib/browser-polyfill.js';
import { debounce } from '../../common/utils.js';
import './SummaryDialog.js'; // (新) 引入 Lit 组件


class SummaryModule {
    constructor(settings) {
        this.settings = settings;
        this.summaryButton = null;
        this.summaryDialog = null;
        this.isDragging = false;
        this.positionButtonX = 0;
        this.positionButtonY = 0;
        this.selectionContext = null; // { text: string, rect: DOMRect }

        // Tab management
        this.tabs = []; // { id, title, history, type, state: 'idle' | 'loading' | 'summarized' | 'error' }
        this.activeTabId = null;
        this.nextTabId = 0;
        this.nextSelectionTabNum = 1;
        this.boundHandleSelection = this.handleSelection.bind(this);

        this.init();
    }

    init() {
        if (document.body) {
            this.summaryButton = new SummaryButton();
            this.summaryDialog = document.createElement('summary-dialog');
            document.body.appendChild(this.summaryDialog);
            this.setupEventListeners();
            this.positionInitialButton();
        } else {
            window.addEventListener('DOMContentLoaded', () => this.init());
        }
    }

    positionInitialButton() {
        const mainBodySelector = this.settings.summarySettings?.mainBodySelector;
        let targetElement = document.body;
        let initialX, initialY;
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
            const wasOpenBeforeDrag = this.summaryDialog.isOpen; // (新) Lit 组件属性

            const handleDragMove = (moveEvent) => {
                moveEvent.preventDefault();
                const dx = moveEvent.clientX - startX, dy = moveEvent.clientY - startY;
                if (!hasDragged && Math.hypot(dx, dy) > 5) {
                    hasDragged = true;
                    this.isDragging = true;
                    this.summaryButton.element.classList.add('dragging');
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

        document.addEventListener('mouseup', this.boundHandleSelection);

        // (新) 监听来自 Lit 组件的事件
        this.summaryDialog.addEventListener('send-message', e => this.handleSendMessage(e.detail.query));
        this.summaryDialog.addEventListener('refresh-summary', () => this.handleRefresh());
        this.summaryDialog.addEventListener('request-suggestions', () => this.handleInferSuggestions());
        this.summaryDialog.addEventListener('dialog-action', e => this.handleDialogAction(e.detail.action, e.detail.index, e.detail.payload));
        this.summaryDialog.addEventListener('tab-switch', e => this.handleTabSwitch(e.detail.tabId));
        this.summaryDialog.addEventListener('tab-close', e => this.handleTabClose(e.detail.tabId));
        this.summaryDialog.addEventListener('hide-dialog', () => {
            this.summaryButton.element.classList.remove('rotated');
        });
        this.summaryDialog.addEventListener('suggestion-click', e => {
            this.handleSendMessage(e.detail.suggestion);
            this.summaryDialog.resetSuggestions();
        });
        this.summaryDialog.addEventListener('suggestion-edit', e => {
            this.summaryDialog.setQuery(e.detail.suggestion);
            this.summaryDialog.resetSuggestions();
        });
    }

    setDialogProps() {
        const activeTab = this.getActiveTab();
        this.summaryDialog.setProps({ tabs: this.tabs, activeTabId: this.activeTabId, activeTab });
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
                this.handleTabSwitch(pageTab.id);
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
            if (this.tabs.length === 0) this.summaryDialog.hide(); // (新) Lit 组件方法
            return;
        }
        this.setDialogProps();
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

    preProcessDOM(doc) {
        // 移除常见的不必要元素
        const selectorsToRemove = ['header', 'footer', 'nav', 'aside', '.ad', '#ad', '[class*="advert"]'];
        selectorsToRemove.forEach(selector => {
            doc.querySelectorAll(selector).forEach(el => el.remove());
        });

        // 清理所有元素的class，避免Readability的误判
        doc.querySelectorAll('*').forEach(el => {
            el.removeAttribute('class');
        });
    }

    async extractPageContent() {
        const selector = this.settings.summarySettings?.mainBodySelector;
        let content = '';

        const getReadabilityContent = async (doc) => {
            try {
                const { default: Readability } = await import('../../lib/readability.esm.js');
                this.preProcessDOM(doc); // 预处理DOM
                const reader = new Readability(doc);
                const article = reader.parse();
                return article?.textContent || '';
            } catch (e) {
                console.warn('[Foxlate Summary] Readability processing failed.', e);
                return '';
            }
        };

        if (selector) {
            const element = document.querySelector(selector);
            if (element) {
                const doc = document.implementation.createHTMLDocument('');
                doc.body.innerHTML = element.innerHTML;
                content = await getReadabilityContent(doc);
                if (!content) {
                    content = element.innerText;
                }
            }
        }

        if (!content) {
            const docClone = document.cloneNode(true);
            content = await getReadabilityContent(docClone);
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
        await this.getAIResponseForTab(activeTab, false);
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



    async handleInferSuggestions() {
        const activeTab = this.getActiveTab();
        if (!activeTab) return [];
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
            return response.suggestions;
        } catch (error) {
            console.error('[Foxlate Summary] Suggestion error:', error);
            return [`**Error:** ${error.message}`];
        }
    }

    async handleDialogAction(action, index, payload = null) {
        const activeTab = this.getActiveTab();
        if (!activeTab) return;
        const message = activeTab.history[index];
        if (!message) return;

        switch (action) {
            case 'reroll':
                activeTab.history = activeTab.history.slice(0, index + 1);
                await this.getAIResponseForTab(activeTab, true);
                break;
            case 'save-edit':
                activeTab.history = activeTab.history.slice(0, index);
                activeTab.history.push({ role: 'user', content: payload });
                await this.getAIResponseForTab(activeTab);
                break;
            case 'copy':
                navigator.clipboard.writeText(message.role === 'user' ? message.content : message.contents[message.activeContentIndex]);
                break;
            case 'edit': // 'edit' 和 'cancel-edit' 现在由 Lit 组件内部处理
            case 'cancel-edit': // 不再需要模块级别的操作
                break;
            case 'history-prev':
            case 'history-next':
                if (message.role === 'assistant') {
                    const direction = action === 'history-prev' ? -1 : 1;
                    const newIndex = message.activeContentIndex + direction;
                    if (newIndex >= 0 && newIndex < message.contents.length) {
                        message.activeContentIndex = newIndex;
                        this.updateDialogUI();
                    }
                }
                break;
        }
    }

    handleRefresh() {
        const activeTab = this.getActiveTab();
        if (!activeTab || activeTab.state === 'loading') return;
        this.fetchSummaryForTab(activeTab, activeTab.type === 'selection' ? activeTab.selectionText : null);
    }

    handleTabSwitch(tabId) {
        if (this.activeTabId === tabId) return;
        this.activeTabId = tabId; // Bug 1 Fix
        this.updateDialogUI();
        this.summaryDialog.resetSuggestions();
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
        this.updateDialogUI();
    }

    createNewTab(type, title) {
        return { id: this.nextTabId++, title, history: [], type, state: 'idle', selectionText: null };
    }

    destroy() {
        this.summaryButton?.destroy();
        this.summaryDialog?.destroy();
        document.removeEventListener('mouseup', this.boundHandleSelection);
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