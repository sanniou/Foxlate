// src/content/summary/summary.js

import browser from '../../lib/browser-polyfill.js';
import { SummaryState } from './summary.state.js';
import { SummaryButton, SummaryDialog } from './summary.view.js';

class SummaryModule {
    constructor(settings) {
        this.settings = settings;
        this.state = new SummaryState();
        this.summaryButton = null;
        this.summaryDialog = null;
        this.isDragging = false;
        this.positionButtonX = 0; // Initialize
        this.positionButtonY = 0; // Initialize
        this.selectionContext = null; // { text: string, rect: DOMRect }
        this.boundHandleSelection = this.handleSelection.bind(this);

        this.init();
    }

    init() {
        if (document.body) {
            this.summaryButton = new SummaryButton();
            this.summaryDialog = new SummaryDialog();
            this.setupEventListeners();
            this.state.subscribe(state => this.updateDialogUI(state));
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
            if (!this.isDragging) this.onSummaryButtonClick();
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

        document.addEventListener('mouseup', this.boundHandleSelection);

        // 监听来自 View 的自定义事件
        this.summaryDialog.element.addEventListener('send-message', e => this.handleSendMessage(e.detail.query));
        this.summaryDialog.element.addEventListener('refresh', () => this.handleRefresh());
        this.summaryDialog.element.addEventListener('infer-suggestions', () => this.handleInferSuggestions());
        this.summaryDialog.element.addEventListener('dialog-action', e => this.handleDialogAction(e.detail.action, e.detail.index, e.detail.payload));
        this.summaryDialog.element.addEventListener('tab-switch', e => {
            this.summaryDialog.setFullRerenderNeeded(true);
            this.state.switchTab(e.detail.tabId);
        });
        this.summaryDialog.element.addEventListener('tab-close', e => this.handleTabClose(e.detail.tabId));
    }

    // 原始的事件处理器，现在由 setupEventListeners 中的监听器调用
    onSummaryButtonClick() {
        if (this.selectionContext) {
            this.fetchSelectionSummary();
            this.selectionContext = null;
        } else {
            this.togglePageSummaryDialog();
        }
    }

    handleSelection(event) {
        if (this.summaryDialog.element.contains(event.target)) return;

        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText.length > 50) {
            if (this.summaryDialog.isOpen) {
                this.summaryDialog.hide();
                this.summaryButton.element.classList.remove('rotated');
            }
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

    async togglePageSummaryDialog() {
        this.summaryButton.element.classList.toggle('rotated');
        if (this.summaryDialog.isOpen) {
            this.summaryDialog.hide();
        } else {
            const pageTab = this.state.findTabByType('page');
            if (!pageTab) {
                await this.fetchInitialPageSummary();
            } else {
                this.state.switchTab(pageTab.id);
                this.summaryDialog.show(this.summaryButton.element.getBoundingClientRect());
            }
        }
    }

    updateDialogUI(state) {
        const { tabs, activeTabId } = state;
        const activeTab = this.state.getActiveTab();
        if (!activeTab) {
            if (tabs.length === 0) this.summaryDialog.hide();
            return;
        }
        this.summaryDialog.renderTabs(tabs, activeTabId);
        this.summaryDialog.renderConversation(activeTab.history, activeTab.state === 'loading');
        this.summaryDialog.setLoading(activeTab.state === 'loading');
    }

    async fetchInitialPageSummary() {
        const newTab = this.state.addTab('page', browser.i18n.getMessage('summaryTabPageTitle') || 'Page');
        this.summaryDialog.setFullRerenderNeeded(true);
        this.summaryDialog.show(this.summaryButton.element.getBoundingClientRect());
        await this.fetchSummaryForTab(newTab);
    }

    async fetchSelectionSummary() {
        this.summaryButton.element.classList.add('rotated');
        const newTab = this.state.addTab(
            'selection',
            `${browser.i18n.getMessage('summaryTabSelectionTitle') || 'Selection'} ${this.state.getNextSelectionTabNum()}`,
            this.selectionContext.text
        );
        this.summaryDialog.setFullRerenderNeeded(true);
        this.summaryDialog.show(this.summaryButton.element.getBoundingClientRect());
        await this.fetchSummaryForTab(newTab, this.selectionContext.text);
    }

    async fetchSummaryForTab(tab, text = null) {
        this.state.updateTab(tab.id, { state: 'loading', history: [] });
        this.summaryDialog.setFullRerenderNeeded(true);
        try {
            let content = text;
            if (!content) content = await this.extractPageContent();
            if (!content.trim()) throw new Error('Failed to extract any meaningful content.');

            const response = await browser.runtime.sendMessage({
                type: 'SUMMARIZE_CONTENT',
                payload: { text: content, aiModel: this.settings.summarySettings?.aiModel, targetLang: this.settings.targetLanguage }
            });

            if (!response.success) throw new Error(response.error);
            const newHistory = [
                { role: 'user', content: content, isHidden: true },
                { role: 'assistant', contents: [response.summary], activeContentIndex: 0 }
            ];
            this.state.updateTab(tab.id, { history: newHistory, state: 'summarized' });
        } catch (error) {
            console.error('[Foxlate Summary] Error:', error);
            this.state.addErrorMessageToTab(tab.id, `**Error:** ${error.message}`);
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
        const activeTab = this.state.getActiveTab();
        if (!query || !activeTab || activeTab.state === 'loading') return;
        this.state.pushToTabHistory(activeTab.id, { role: 'user', content: query });
        await this.getAIResponseForTab(activeTab);
    }

    async getAIResponseForTab(tab, isReroll = false) {
        this.state.updateTab(tab.id, { state: 'loading' });

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

            this.state.updateLastAssistantMessage(tab.id, response.reply, isReroll);
            this.state.updateTab(tab.id, { state: 'summarized' });
        } catch (error) {
            console.error('[Foxlate Summary] AI response error:', error);
            this.state.addErrorMessageToTab(tab.id, `**Error:** ${error.message}`);
        }
    }

    async handleInferSuggestions() {
        const activeTab = this.state.getActiveTab();
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
        }
    }
    
    async handleDialogAction(action, index, payload = null) {
        const activeTab = this.state.getActiveTab();
        if (!activeTab) return;
        const message = activeTab.history[index];
        if (!message) return;

        switch (action) {
            case 'reroll':
                this.state.sliceTabHistory(activeTab.id, 0, index + 1);
                this.summaryDialog.setFullRerenderNeeded(true);
                await this.getAIResponseForTab(activeTab, true);
                break;
            case 'save-edit':
                this.state.sliceTabHistory(activeTab.id, 0, index);
                this.summaryDialog.setFullRerenderNeeded(true);
                this.state.pushToTabHistory(activeTab.id, { role: 'user', content: payload });
                await this.getAIResponseForTab(activeTab);
                break;
            case 'copy':
                navigator.clipboard.writeText(message.role === 'user' ? message.content : message.contents[message.activeContentIndex]);
                break;
            case 'edit':
                this.summaryDialog.enterEditMode(index, message.content);
                break;
            case 'cancel-edit':
                this.summaryDialog.setFullRerenderNeeded(true); // This forces a re-render from scratch
                this.summaryDialog.renderConversation(activeTab.history);
                break;
            case 'history-prev':
            case 'history-next':
                if (message.role === 'assistant') {
                    const direction = action === 'history-prev' ? -1 : 1;
                    const newIndex = message.activeContentIndex + direction;
                    if (newIndex >= 0 && newIndex < message.contents.length) {
                        this.state.updateMessageContentIndex(activeTab.id, index, newIndex);
                        this.summaryDialog.setFullRerenderNeeded(true); // Force re-render for this specific change
                        this.summaryDialog.renderConversation(activeTab.history);
                    }
                }
                break;
        }
    }

    handleRefresh() {
        const activeTab = this.state.getActiveTab();
        if (!activeTab || activeTab.state === 'loading') return;
        this.summaryDialog.setFullRerenderNeeded(true);
        this.fetchSummaryForTab(activeTab, activeTab.selectionText);
    }

    handleTabClose(tabId) {
        const isLastTab = this.state.closeTab(tabId);
        if (isLastTab) {
            this.summaryDialog.hide();
            this.summaryButton.element.classList.remove('rotated');
        }
        this.summaryDialog.resetSuggestions(); // Reset suggestion bar
    }

    destroy() {
        this.summaryButton?.destroy();
        this.summaryDialog?.destroy();
        document.removeEventListener('mouseup', this.boundHandleSelection);
    }
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