// src/content/summary/summary.state.js

export class SummaryState {
    constructor() {
        this.tabs = []; // { id, title, history, type, state, selectionText }
        this.activeTabId = null;
        this.nextTabId = 0;
        this.nextSelectionTabNum = 1;
        this.listeners = [];
    }

    // --- Subscription ---
    subscribe(listener) {
        this.listeners.push(listener);
    }

    notify() {
        const state = this.getState();
        this.listeners.forEach(listener => listener(state));
    }

    // --- Getters ---
    getState() {
        return {
            tabs: this.tabs,
            activeTabId: this.activeTabId,
        };
    }

    getActiveTab() {
        return this.tabs.find(t => t.id === this.activeTabId);
    }

    findTabByType(type) {
        return this.tabs.find(t => t.type === type);
    }

    getNextSelectionTabNum() {
        return this.nextSelectionTabNum;
    }

    // --- Mutations ---
    addTab(type, title, selectionText = null) {
        const newTab = {
            id: this.nextTabId++,
            title,
            history: [],
            type,
            state: 'idle',
            selectionText
        };
        this.tabs.push(newTab);
        this.activeTabId = newTab.id;
        if (type === 'selection') {
            this.nextSelectionTabNum++;
        }
        this.notify();
        return newTab;
    }

    updateTab(tabId, updates) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
            Object.assign(tab, updates);
            this.notify();
        }
    }

    pushToTabHistory(tabId, message) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
            tab.history.push(message);
            this.notify();
        }
    }

    sliceTabHistory(tabId, start, end) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab) {
            tab.history = tab.history.slice(start, end);
            // Note: This doesn't notify immediately, assuming another action will follow.
        }
    }

    updateLastAssistantMessage(tabId, newContent, isReroll) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;
        const lastMessage = tab.history[tab.history.length - 1];
        if (isReroll && lastMessage?.role === 'assistant') {
            lastMessage.contents.push(newContent);
            lastMessage.activeContentIndex = lastMessage.contents.length - 1;
        } else {
            tab.history.push({ role: 'assistant', contents: [newContent], activeContentIndex: 0 });
        }
        this.notify();
    }

    addErrorMessageToTab(tabId, errorMessage) {
        this.updateTab(tabId, { state: 'error' });
        this.pushToTabHistory(tabId, { role: 'assistant', contents: [errorMessage], activeContentIndex: 0, isError: true });
    }

    updateMessageContentIndex(tabId, messageIndex, newContentIndex) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (tab && tab.history[messageIndex]) {
            tab.history[messageIndex].activeContentIndex = newContentIndex;
            this.notify();
        }
    }

    switchTab(tabId) {
        if (this.activeTabId === tabId) return;
        this.activeTabId = tabId;
        this.notify();
    }

    closeTab(tabId) {
        const tabIndex = this.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return false;
        this.tabs.splice(tabIndex, 1);
        if (this.activeTabId === tabId) {
            if (this.tabs.length > 0) {
                const newIndex = Math.max(0, tabIndex - 1);
                this.activeTabId = this.tabs[newIndex].id;
            } else {
                this.activeTabId = null;
            }
        }
        this.notify();
        return this.tabs.length === 0;
    }
}