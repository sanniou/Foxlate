import { marked } from '../../lib/marked.esm.js';
import { summaryLayoutController } from '../layout/summary-layout-controller.js';

export class SummaryMessageRenderer {
    constructor({ getIcon, getWidth }) {
        this.getIcon = getIcon;
        this.getWidth = getWidth;
    }

    renderConversation({ conversationArea, history, isLoading, renderedMessageCount, fullRerenderNeeded }) {
        if (!conversationArea) {
            return {
                renderedMessageCount,
                fullRerenderNeeded,
                currentMessageTexts: [],
                currentMessageTextByIndex: new Map(),
            };
        }

        const validHistory = Array.isArray(history) ? history : [];
        const currentMessageTexts = validHistory
            .filter(message => !message?.isHidden)
            .map(message => this.getMessageText(message));
        const currentMessageTextByIndex = new Map(validHistory.map((message, index) => [index, this.getMessageText(message)]));
        const messageCountChanged = validHistory.length !== renderedMessageCount;

        if (fullRerenderNeeded || validHistory.length < renderedMessageCount) {
            conversationArea.innerHTML = '';
            renderedMessageCount = 0;
            fullRerenderNeeded = false;
        }

        this.#updateMessages(conversationArea, validHistory);
        this.#updateLoadingIndicator(conversationArea, isLoading);

        if (isLoading || messageCountChanged) {
            requestAnimationFrame(() => {
                conversationArea.scrollTop = conversationArea.scrollHeight;
            });
        }

        return {
            renderedMessageCount: validHistory.length,
            fullRerenderNeeded,
            currentMessageTexts,
            currentMessageTextByIndex,
        };
    }

    enterEditMode({ conversationArea, index, content, applyEditTextareaLayout, updateSendButtonState }) {
        const messageEl = conversationArea.querySelector(`[data-index="${index}"]`);
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
        applyEditTextareaLayout(textarea, content);
        textarea.addEventListener('input', () => {
            applyEditTextareaLayout(textarea, textarea.value);
            updateSendButtonState();
        });
    }

    applyMessageLayouts({ conversationArea, currentMessageTextByIndex, applyEditTextareaLayout }) {
        if (!conversationArea) return;

        const width = this.getWidth();
        conversationArea.querySelectorAll('.foxlate-summary-message:not(.loading)').forEach(messageEl => {
            if (messageEl.classList.contains('is-editing')) {
                const textarea = messageEl.querySelector('textarea');
                applyEditTextareaLayout(textarea, textarea?.value ?? '');
                return;
            }

            const index = Number.parseInt(messageEl.dataset.index, 10);
            const text = Number.isFinite(index) ? currentMessageTextByIndex.get(index) : messageEl.textContent;
            summaryLayoutController.applyMessageLayout(messageEl, text, {
                width,
                role: messageEl.classList.contains('user') ? 'user' : 'assistant',
            });
        });
    }

    getMessageText(message) {
        if (!message) return '';
        if (message.role === 'user') {
            return message.content || '';
        }
        const contents = message.contents || [];
        const activeIndex = message.activeContentIndex || 0;
        return contents[activeIndex] || '';
    }

    #updateMessages(conversationArea, history) {
        const messageSelector = '.foxlate-summary-message:not(.loading)';
        const messageElements = conversationArea.querySelectorAll(messageSelector);

        if (messageElements.length > history.length) {
            for (let index = history.length; index < messageElements.length; index++) {
                messageElements[index].remove();
            }
        }

        const fragment = document.createDocumentFragment();
        const elementsToReplace = new Map();

        history.forEach((message, index) => {
            const existingEl = conversationArea.querySelector(`.foxlate-summary-message[data-index="${index}"]:not(.loading)`);
            const newEl = this.#createMessageElement(message, index);

            if (existingEl) {
                elementsToReplace.set(existingEl, newEl);
            } else {
                fragment.appendChild(newEl);
            }
        });

        if (fragment.children.length > 0) {
            conversationArea.appendChild(fragment);
        }

        elementsToReplace.forEach((newEl, existingEl) => {
            existingEl.replaceWith(newEl);
        });
    }

    #updateLoadingIndicator(conversationArea, isLoading) {
        const loadingEl = conversationArea.querySelector('.foxlate-summary-message.loading');
        if (isLoading && !loadingEl) {
            const indicator = document.createElement('div');
            indicator.className = 'foxlate-summary-message assistant loading';
            indicator.innerHTML = '<div class="loading-indicator"></div>';
            conversationArea.appendChild(indicator);
        } else if (!isLoading && loadingEl) {
            loadingEl.remove();
        }
    }

    #createMessageElement(message, index) {
        const messageEl = document.createElement('div');
        messageEl.className = `foxlate-summary-message ${message.role} ${message.isError ? 'error' : ''}`;
        messageEl.dataset.index = index;
        if (message.isHidden) {
            messageEl.style.display = 'none';
        }

        const content = this.getMessageText(message);
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        try {
            contentDiv.innerHTML = marked.parse(content);
        } catch (error) {
            console.error('[Foxlate Summary] Markdown parsing error:', error);
            contentDiv.textContent = content;
        }

        messageEl.appendChild(contentDiv);

        const actionsHtml = this.#getActionsHtml(message);
        if (actionsHtml) {
            const template = document.createElement('template');
            template.innerHTML = actionsHtml;
            messageEl.appendChild(template.content);
        }

        summaryLayoutController.applyMessageLayout(messageEl, content, {
            width: this.getWidth(),
            role: message.role,
        });

        return messageEl;
    }

    #getActionsHtml(message) {
        let buttons = `<button data-action="copy" aria-label="Copy">${this.getIcon('copy')}</button>`;
        if (message.role === 'user') {
            buttons += `<button data-action="edit" aria-label="Edit">${this.getIcon('edit')}</button>`;
        } else if (message.isError) {
            if (message.retryCallback) {
                buttons += `<button data-action="retry" aria-label="Retry">${this.getIcon('refresh')}</button>`;
            }
            buttons += `<button data-action="copy-error" aria-label="Copy Error">${this.getIcon('copy')}</button>`;
        } else {
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
}
