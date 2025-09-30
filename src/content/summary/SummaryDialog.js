import { LitElement, html, css, unsafeCSS } from '../../lib/lit.js';
import { marked } from '../../lib/marked.esm.js';
import { debounce } from '../../common/utils.js';
import browser from '../../lib/browser-polyfill.js';

// (修复) 使用顶层 await 同步加载 CSS，防止对话框出现时闪烁 (FOUC)。
const commonCssPromise = fetch(browser.runtime.getURL('common/common.css')).then(r => r.ok ? r.text() : '');
const summaryCssPromise = fetch(browser.runtime.getURL('content/summary/summary.css')).then(r => r.ok ? r.text() : '');

export class SummaryDialog extends LitElement {
    static styles = [
        unsafeCSS(await commonCssPromise),
        unsafeCSS(await summaryCssPromise),
        css`
            :host {
                display: block;
                position: fixed;
                z-index: 2147483641;
                visibility: hidden;
            }
            :host([open]) .foxlate-summary-dialog {
                transform: scale(1);
                opacity: 1;
                visibility: visible;
            }
        `
    ];

    static properties = {
        isOpen: { type: Boolean, reflect: true, attribute: 'open' },
        tabs: { type: Array },
        activeTabId: { type: Number },
        activeTab: { type: Object, state: true },
        _editingMessageIndex: { state: true },
        _suggestions: { state: true },
        _suggestionsVisible: { state: true },
        _suggestionsLoading: { state: true },
        _query: { state: true },
    };

    constructor() {
        super();
        this.isOpen = false;
        this.tabs = [];
        this.activeTabId = null;
        this.activeTab = null;
        this._editingMessageIndex = -1;
        this._suggestions = [];
        this._suggestionsVisible = false;
        this._suggestionsLoading = false;
        this._query = '';
        this.lastButtonRect = null;

        this.debouncedReposition = debounce(() => this.repositionDialog(), 100);
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('resize', this.debouncedReposition);
        window.addEventListener('scroll', this.debouncedReposition, true);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener('resize', this.debouncedReposition);
        window.removeEventListener('scroll', this.debouncedReposition, true);
    }

    setProps({ tabs, activeTabId, activeTab }) {
        this.tabs = tabs;
        this.activeTabId = activeTabId;
        this.activeTab = active - tab;
    }

    show(buttonRect) {
        this.isOpen = true;
        this.lastButtonRect = buttonRect;
        this.repositionDialog();
        this.updateComplete.then(() => {
            this.shadowRoot.querySelector('textarea')?.focus();
        });
    }

    hide() {
        this.isOpen = false;
        this._dispatchEvent('hide-dialog');
    }

    setQuery(text) {
        this._query = text;
        const textarea = this.shadowRoot.querySelector('textarea');
        if (textarea) {
            textarea.value = text;
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
            textarea.focus();
        }
    }

    resetSuggestions() {
        this._suggestionsVisible = false;
        this._suggestionsLoading = false;
        this._suggestions = [];
    }

    repositionDialog() {
        if (!this.isOpen || !this.lastButtonRect) return;
        const dialog = this.shadowRoot.querySelector('.foxlate-summary-dialog');
        if (!dialog) return;

        const dialogWidth = dialog.offsetWidth;
        const dialogHeight = dialog.offsetHeight;
        const { top, left, right, bottom } = this.lastButtonRect;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const MARGIN = 16;

        const quadrants = [
            { name: 'bottomAlignLeft', score: Math.min(dialogWidth, winWidth - left - MARGIN) * Math.min(dialogHeight, winHeight - bottom - MARGIN), origin: 'top left', top: `${bottom + 8}px`, left: `${left}px` },
            { name: 'bottomAlignRight', score: Math.min(dialogWidth, right - MARGIN) * Math.min(dialogHeight, winHeight - bottom - MARGIN), origin: 'top right', top: `${bottom + 8}px`, right: `${winWidth - right}px` },
            { name: 'topAlignLeft', score: Math.min(dialogWidth, winWidth - left - MARGIN) * Math.min(dialogHeight, top - MARGIN), origin: 'bottom left', bottom: `${winHeight - top + 8}px`, left: `${left}px` },
            { name: 'topAlignRight', score: Math.min(dialogWidth, right - MARGIN) * Math.min(dialogHeight, top - MARGIN), origin: 'bottom right', bottom: `${winHeight - top + 8}px`, right: `${winWidth - right}px` },
        ];

        const bestQuadrant = quadrants.sort((a, b) => b.score - a.score)[0];

        this.style.top = bestQuadrant.top || 'auto';
        this.style.left = bestQuadrant.left || 'auto';
        this.style.bottom = bestQuadrant.bottom || 'auto';
        this.style.right = bestQuadrant.right || 'auto';
        dialog.style.transformOrigin = bestQuadrant.origin;
    }

    _dispatchEvent(type, detail = {}) {
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }

    _handleTextareaKeydown(e) {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            this._handleSendMessage();
        }
    }

    _handleTextareaInput(e) {
        this._query = e.target.value;
        e.target.style.height = 'auto';
        e.target.style.height = `${e.target.scrollHeight}px`;
    }

    _handleSendMessage() {
        const query = this._query.trim();
        if (query) {
            this._dispatchEvent('send-message', { query });
            this._query = '';
            const textarea = this.shadowRoot.querySelector('textarea');
            textarea.value = '';
            textarea.style.height = 'auto';
        }
    }

    async _toggleSuggestions() {
        if (this._suggestionsVisible) {
            this.resetSuggestions();
        } else {
            this._suggestionsVisible = true;
            this._suggestionsLoading = true;
            this._dispatchEvent('request-suggestions');
            // This is a bit of a hack. The parent will receive the event and fetch suggestions.
            // We need a way for the parent to push the suggestions back.
            // A better way would be for the parent to set a property on this component.
            // For now, we assume the parent will call a method like `renderSuggestions`.
        }
    }

    // This method is called by the parent SummaryModule
    async renderSuggestions() {
        this._suggestionsLoading = true;
        this._suggestionsVisible = true;
        const suggestions = await this.summaryModule.handleInferSuggestions();
        this._suggestions = suggestions;
        this._suggestionsLoading = false;
    }

    _getIcon(name) {
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
        return unsafeHTML(icons[name] || '');
    }

    render() {
        const isLoading = this.activeTab?.state === 'loading';
        return html`
            <div class="foxlate-summary-dialog ${isLoading ? 'loading' : ''}">
                ${this._renderHeader()}
                ${this._renderTabs()}
                ${this._renderConversation()}
                ${this._renderMenubar()}
                ${this._renderSuggestions()}
                ${this._renderFooter()}
            </div>
        `;
    }

    _renderHeader() {
        return html`
            <div class="foxlate-summary-header">
                <h3>${browser.i18n.getMessage('summaryModalTitle') || 'Summary'}</h3>
                <button class="refresh-button" aria-label="Refresh" @click=${() => this._dispatchEvent('refresh-summary')}>
                    ${this._getIcon('refresh')}
                </button>
            </div>
        `;
    }

    _renderTabs() {
        return html`
            <div class="foxlate-summary-tabs">
                ${this.tabs.map(tab => html`
                    <div class="foxlate-summary-tab ${tab.id === this.activeTabId ? 'active' : ''}"
                         @click=${() => this._dispatchEvent('tab-switch', { tabId: tab.id })}>
                        <span class="foxlate-summary-tab-title">${tab.title}</span>
                        ${this.tabs.length > 1 ? html`
                            <button class="foxlate-summary-tab-close" @click=${(e) => { e.stopPropagation(); this._dispatchEvent('tab-close', { tabId: tab.id }); }}>
                                ${this._getIcon('cancel')}
                            </button>
                        ` : ''}
                    </div>
                `)}
            </div>
        `;
    }

    _renderConversation() {
        const history = this.activeTab?.history || [];
        return html`
            <div class="foxlate-summary-conversation">
                ${history.map((msg, index) => this._renderMessage(msg, index))}
                ${this.activeTab?.state === 'loading' ? html`<div class="foxlate-summary-message assistant loading"><div class="loading-indicator"></div></div>` : ''}
            </div>
        `;
    }

    _renderMessage(message, index) {
        if (message.isHidden) return '';

        if (this._editingMessageIndex === index) {
            return this._renderEditMode(message, index);
        }

        const content = message.role === 'user' ? message.content : message.contents[message.activeContentIndex];
        return html`
            <div class="foxlate-summary-message ${message.role} ${message.isError ? 'error' : ''}" data-index=${index}>
                <div class="message-content">${unsafeHTML(marked.parse(content))}</div>
                ${this._renderMessageActions(message, index)}
            </div>
        `;
    }

    _renderMessageActions(message, index) {
        const copyButton = html`<button @click=${() => this._dispatchEvent('dialog-action', { action: 'copy', index })} aria-label="Copy">${this._getIcon('copy')}</button>`;
        let userButtons = '', assistantButtons = '';

        if (message.role === 'user') {
            userButtons = html`<button @click=${() => this._editingMessageIndex = index} aria-label="Edit">${this._getIcon('edit')}</button>`;
        } else if (!message.isError) {
            const historyControls = message.contents.length > 1 ? html`
                <button @click=${() => this._dispatchEvent('dialog-action', { action: 'history-prev', index })} ?disabled=${message.activeContentIndex === 0}>${this._getIcon('prev')}</button>
                <span>${message.activeContentIndex + 1}/${message.contents.length}</span>
                <button @click=${() => this._dispatchEvent('dialog-action', { action: 'history-next', index })} ?disabled=${message.activeContentIndex === message.contents.length - 1}>${this._getIcon('next')}</button>
            ` : '';
            assistantButtons = html`${historyControls}<button @click=${() => this._dispatchEvent('dialog-action', { action: 'reroll', index })} aria-label="Reroll">${this._getIcon('reroll')}</button>`;
        }

        return html`<div class="message-actions">${copyButton}${userButtons}${assistantButtons}</div>`;
    }

    _renderEditMode(message, index) {
        return html`
            <div class="foxlate-summary-message user is-editing" data-index=${index}>
                <div class="message-edit-area">
                    <textarea rows="3" .value=${message.content}></textarea>
                    <div class="message-actions">
                        <button @click=${() => this._editingMessageIndex = -1} aria-label="Cancel">${this._getIcon('cancel')}</button>
                        <button @click=${(e) => {
                const newContent = e.target.closest('.message-edit-area').querySelector('textarea').value;
                this._dispatchEvent('dialog-action', { action: 'save-edit', index, payload: newContent });
                this._editingMessageIndex = -1;
            }} aria-label="Save">${this._getIcon('save')}</button>
                    </div>
                </div>
            </div>
        `;
    }

    _renderMenubar() {
        const isLoading = this.activeTab?.state === 'loading';
        return html`
            <div class="foxlate-summary-menubar">
                <button class="suggest-button ${this._suggestionsLoading ? 'loading' : ''}" ?disabled=${isLoading} @click=${this._toggleSuggestions}>
                    ${this._getIcon('suggest')} ${browser.i18n.getMessage('summarySuggestButton')}
                </button>
            </div>
        `;
    }

    _renderSuggestions() {
        if (!this._suggestionsVisible) return '';
        return html`
            <div class="foxlate-summary-suggestions is-visible">
                ${this._suggestionsLoading ? html`
                    <div class="foxlate-suggestion-loading">
                        <div class="loading-indicator"></div>
                        <span>${browser.i18n.getMessage('summaryLoadingSuggestions') || 'Loading suggestions...'}</span>
                    </div>
                ` : this._suggestions.map(suggestion => html`
                    <div class="foxlate-suggestion-item" @click=${() => this._dispatchEvent('suggestion-click', { suggestion })}>
                        <span class="suggestion-text">${suggestion}</span>
                        <button class="edit-suggestion-button" @click=${(e) => { e.stopPropagation(); this._dispatchEvent('suggestion-edit', { suggestion }); }} aria-label="Edit suggestion">
                            ${this._getIcon('edit')}
                        </button>
                    </div>
                `)}
            </div>
        `;
    }

    _renderFooter() {
        const isLoading = this.activeTab?.state === 'loading';
        return html`
            <div class="foxlate-summary-footer">
                <textarea placeholder="${browser.i18n.getMessage('summaryInputPlaceholder') || 'Ask a follow-up...'}"
                          rows="1"
                          .value=${this._query}
                          ?disabled=${isLoading}
                          @input=${this._handleTextareaInput}
                          @keydown=${this._handleTextareaKeydown}></textarea>
                <button class="send-button" ?disabled=${isLoading || !this._query.trim()} @click=${this._handleSendMessage}>
                    ${this._getIcon('send')}
                </button>
            </div>
        `;
    }
}

customElements.define('summary-dialog', SummaryDialog);