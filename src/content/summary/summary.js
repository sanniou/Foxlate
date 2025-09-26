
// src/content/summary/summary.js

import browser from '../../lib/browser-polyfill.js';
import { marked } from '../../lib/marked.esm.js';

class SummaryModule {
    constructor(settings) {
        this.settings = settings;
        this.summaryButton = null;
        this.summaryDialog = null;
        this.isDragging = false;
        this.state = 'idle';
        this.conversationHistory = [];
        this.init();
    }

    init() {
        if (document.body) {
            this.summaryButton = new SummaryButton();
            this.summaryDialog = new SummaryDialog(this.handleSendMessage.bind(this), this.handleAction.bind(this));
            this.setupEventListeners();
            this.positionInitialButton(); // 修复：初始化按钮位置
        } else {
            window.addEventListener('DOMContentLoaded', () => this.init());
        }
    }

    // 修复：新增方法，用于根据 mainBody 定位按钮初始位置
    positionInitialButton() {
        const mainBodySelector = this.settings.summarySettings?.mainBodySelector;
        let targetElement = document.body; // 默认 fallback 到 body

        if (mainBodySelector) {
            const foundElement = document.querySelector(mainBodySelector);
            if (foundElement) {
                targetElement = foundElement;
            }
        }

        const targetRect = targetElement.getBoundingClientRect();
        const BUTTON_OFFSET_X = 10; // 按钮距离 mainBody 右侧的偏移
        const BUTTON_OFFSET_Y = 50; // 按钮距离 mainBody 顶部的偏移

        // 计算按钮的初始位置，使其位于 targetElement 的右上角外部
        const initialX = window.scrollX + targetRect.right + BUTTON_OFFSET_X;
        const initialY = window.scrollY + targetRect.top + BUTTON_OFFSET_Y;

        this.summaryButton.setPosition(initialX, initialY);
    }

    setupEventListeners() {
        this.summaryButton.element.addEventListener('click', () => {
            if (!this.isDragging) this.toggleDialog();
        });

        this.summaryButton.element.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startY = e.clientY;
            const fabStartRect = this.summaryButton.element.getBoundingClientRect();
            let hasDragged = false;
            const wasOpenBeforeDrag = this.summaryDialog.isOpen;

            const handleDragMove = (moveEvent) => {
                moveEvent.preventDefault();
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (!hasDragged && Math.hypot(dx, dy) > 5) {
                    hasDragged = true;
                    this.isDragging = true;
                    if (wasOpenBeforeDrag) {
                        this.summaryDialog.hide();
                    }
                }
                if (hasDragged) {
                    this.summaryButton.setPosition(fabStartRect.left + dx, fabStartRect.top + dy);
                }
            };

            const handleDragEnd = () => {
                document.removeEventListener('mousemove', handleDragMove);
                document.removeEventListener('mouseup', handleDragEnd);

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
    }

    async toggleDialog() {
        this.summaryButton.element.classList.toggle('rotated');
        if (this.summaryDialog.isOpen) {
            this.summaryDialog.hide();
        } else {
            const buttonRect = this.summaryButton.element.getBoundingClientRect();
            this.summaryDialog.show(buttonRect);
            if (this.state === 'idle') await this.fetchInitialSummary();
        }
    }

    async fetchInitialSummary() {
        this.state = 'loading';
        this.summaryDialog.setLoading(true);
        this.summaryDialog.renderConversation(this.conversationHistory, true);
        try {
            const selector = this.settings.summarySettings?.mainBodySelector;
            if (!selector) throw new Error('Summary main body selector not configured.');
            const element = document.querySelector(selector);
            if (!element) throw new Error(`Main body element not found: "${selector}"`);

            const response = await browser.runtime.sendMessage({
                type: 'SUMMARIZE_CONTENT',
                payload: { text: element.innerText, aiModel: this.settings.summarySettings?.aiModel, targetLang: this.settings.targetLanguage }
            });
            if (!response.success) throw new Error(response.error);
            this.conversationHistory.push({ role: 'assistant', contents: [response.summary], activeContentIndex: 0 });
        } catch (error) {
            console.error('[Foxlate Summary] Error:', error);
            this.conversationHistory.push({ role: 'assistant', contents: [`**Error:** ${error.message}`], activeContentIndex: 0, isError: true });
        } finally {
            this.state = 'summarized';
            this.summaryDialog.setLoading(false);
            this.summaryDialog.renderConversation(this.conversationHistory);
        }
    }

    async handleSendMessage(query) {
        if (!query || this.state === 'loading') return;
        this.conversationHistory.push({ role: 'user', content: query });
        this.summaryDialog.renderConversation(this.conversationHistory);
        await this.getAIResponse();
    }

    async getAIResponse(isReroll = false) {
        this.state = 'loading';
        this.summaryDialog.setLoading(true);
        if (!isReroll) {
             this.summaryDialog.renderConversation(this.conversationHistory, true);
        }

        try {
            const historyForAI = this.conversationHistory.map(msg => ({
                role: msg.role,
                content: msg.role === 'user' ? msg.content : msg.contents[msg.activeContentIndex]
            }));

            const response = await browser.runtime.sendMessage({
                type: 'CONVERSE_WITH_AI',
                payload: { history: historyForAI, aiModel: this.settings.summarySettings?.aiModel, targetLang: this.settings.targetLanguage }
            });
            if (!response.success) throw new Error(response.error);

            const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
            if (isReroll && lastMessage?.role === 'assistant') {
                lastMessage.contents.push(response.reply);
                lastMessage.activeContentIndex = lastMessage.contents.length - 1;
            } else {
                this.conversationHistory.push({ role: 'assistant', contents: [response.reply], activeContentIndex: 0 });
            }
        } catch (error) {
            console.error('[Foxlate Summary] Error:', error);
            this.conversationHistory.push({ role: 'assistant', contents: [`**Error:** ${error.message}`], activeContentIndex: 0, isError: true });
        } finally {
            this.state = 'summarized';
            this.summaryDialog.setLoading(false);
            this.summaryDialog.renderConversation(this.conversationHistory);
        }
    }

    async handleAction(action, index, payload) {
        const message = this.conversationHistory[index];
        if (!message) return;

        switch (action) {
            case 'copy':
                navigator.clipboard.writeText(message.role === 'user' ? message.content : message.contents[message.activeContentIndex]);
                break;
            case 'reroll':
                this.conversationHistory = this.conversationHistory.slice(0, index + 1);
                await this.getAIResponse(true);
                break;
            case 'edit':
                this.summaryDialog.enterEditMode(index, message.content);
                break;
            case 'save-edit':
                this.conversationHistory = this.conversationHistory.slice(0, index);
                this.conversationHistory.push({ role: 'user', content: payload });
                this.summaryDialog.renderConversation(this.conversationHistory);
                await this.getAIResponse();
                break;
            case 'cancel-edit':
                this.summaryDialog.renderConversation(this.conversationHistory);
                break;
            case 'history-prev':
            case 'history-next':
                if (message.role === 'assistant') {
                    const direction = action === 'history-prev' ? -1 : 1;
                    const newIndex = message.activeContentIndex + direction;
                    if (newIndex >= 0 && newIndex < message.contents.length) {
                        message.activeContentIndex = newIndex;
                        this.summaryDialog.renderConversation(this.conversationHistory);
                    }
                }
                break;
        }
    }

    destroy() {
        this.summaryButton?.destroy();
        this.summaryDialog?.destroy();
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
        // 修复：移除这里的硬编码位置，由 SummaryModule 控制
    }
    setPosition(x, y) {
        const rect = this.element.getBoundingClientRect();
        this.element.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width))}px`;
        this.element.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height))}px`;
    }
    destroy() { this.element?.remove(); }
}

class SummaryDialog {
    constructor(sendMessageHandler, actionHandler) {
        this.isOpen = false;
        this.sendMessageHandler = sendMessageHandler;
        this.actionHandler = actionHandler;
        this.create();
    }

    create() {
        this.element = document.createElement('div');
        this.element.className = 'foxlate-summary-dialog';
        this.element.style.visibility = 'hidden';
        this.element.innerHTML = `
            <div class="foxlate-summary-header"><h3>${browser.i18n.getMessage('summaryModalTitle') || 'Summary'}</h3></div>
            <div class="foxlate-summary-conversation"></div>
            <div class="foxlate-summary-footer">
                <textarea placeholder="${browser.i18n.getMessage('summaryInputPlaceholder') || 'Ask a follow-up...'}" rows="1"></textarea>
                <button class="send-button" aria-label="Send">${this.getIcon('send')}</button>
            </div>
        `;
        this.conversationArea = this.element.querySelector('.foxlate-summary-conversation');
        this.textarea = this.element.querySelector('textarea');
        this.sendButton = this.element.querySelector('.send-button');
        document.body.appendChild(this.element);

        this.sendButton.addEventListener('click', () => this.triggerSend());
        
        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this.triggerSend();
            }
        });

        this.textarea.addEventListener('input', () => {
            this.textarea.style.height = 'auto';
            this.textarea.style.height = `${this.textarea.scrollHeight}px`;
        });

        this.conversationArea.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            const index = parseInt(target.closest('.foxlate-summary-message').dataset.index, 10);
            this.actionHandler(action, index, action === 'save-edit' ? target.closest('.message-edit-area').querySelector('textarea').value : null);
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
        this.conversationArea.innerHTML = '';
        history.forEach((message, index) => this.renderMessage(message, index));
        if (isLoading) {
            const loadingEl = document.createElement('div');
            loadingEl.className = 'foxlate-summary-message assistant loading';
            loadingEl.innerHTML = `<div class="loading-indicator"></div>`;
            this.conversationArea.appendChild(loadingEl);
        }
        this.conversationArea.scrollTop = this.conversationArea.scrollHeight;
    }

    renderMessage(message, index) {
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
    }

    getIcon(name) {
        const icons = {
            send: '<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 0 24 24" width="20"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>',
            copy: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
            edit: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
            reroll: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>',
            save: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg',
            cancel: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
            prev: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
            next: '<svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 0 24 24" width="16"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>'
        };
        return icons[name] || '';
    }

    show(buttonRect) {
        this.isOpen = true;
        this.element.style.visibility = 'visible';

        // --- 修复后的四象限最优解算法 ---
        const DIALOG_ESTIMATED_WIDTH = 400;
        const DIALOG_ESTIMATED_HEIGHT = 450;
        const MARGIN = 16;

        const { top, left, right, bottom } = buttonRect;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;

        const spaceRight = winWidth - left - MARGIN; // 按钮左侧到屏幕右侧的距离
        const spaceLeft = right - MARGIN; // 按钮右侧到屏幕左侧的距离
        const spaceBottom = winHeight - bottom - MARGIN;
        const spaceTop = top - MARGIN;

        const quadrants = [
            { name: 'bottomRight', score: Math.min(DIALOG_ESTIMATED_WIDTH, spaceRight) * Math.min(DIALOG_ESTIMATED_HEIGHT, spaceBottom), origin: 'top left', top: `${bottom + 8}px`, left: `${left}px` },
            { name: 'bottomLeft',  score: Math.min(DIALOG_ESTIMATED_WIDTH, spaceLeft)  * Math.min(DIALOG_ESTIMATED_HEIGHT, spaceBottom), origin: 'top right', top: `${bottom + 8}px`, right: `${winWidth - right}px` },
            { name: 'topRight',    score: Math.min(DIALOG_ESTIMATED_WIDTH, spaceRight) * Math.min(DIALOG_ESTIMATED_HEIGHT, spaceTop),    origin: 'bottom left', bottom: `${winHeight - top + 8}px`, left: `${left}px` },
            { name: 'topLeft',     score: Math.min(DIALOG_ESTIMATED_WIDTH, spaceLeft)  * Math.min(DIALOG_ESTIMATED_HEIGHT, spaceTop),    origin: 'bottom right', bottom: `${winHeight - top + 8}px`, right: `${winWidth - right}px` }
        ];

        let bestQuadrant = quadrants[0];
        for (let i = 1; i < quadrants.length; i++) {
            if (quadrants[i].score > bestQuadrant.score) {
                bestQuadrant = quadrants[i];
            }
        }

        this.element.style.transformOrigin = bestQuadrant.origin;
        this.element.style.top = bestQuadrant.top || '';
        this.element.style.left = bestQuadrant.left || '';
        this.element.style.bottom = bestQuadrant.bottom || '';
        this.element.style.right = bestQuadrant.right || '';

        if (!bestQuadrant.top) this.element.style.removeProperty('top');
        if (!bestQuadrant.left) this.element.style.removeProperty('left');
        if (!bestQuadrant.bottom) this.element.style.removeProperty('bottom');
        if (!bestQuadrant.right) this.element.style.removeProperty('right');

        this.element.classList.add('visible');
        this.textarea.focus();
    }

    hide() {
        this.isOpen = false;
        this.element.classList.remove('visible');
        setTimeout(() => { if (!this.isOpen) this.element.style.visibility = 'hidden'; }, 200);
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
