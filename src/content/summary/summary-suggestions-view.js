import browser from '../../lib/browser-polyfill.js';
import { summaryLayoutController } from '../layout/summary-layout-controller.js';

export class SummarySuggestionsView {
    constructor({
        suggestionsArea,
        suggestButton,
        textarea,
        getIcon,
        getWidth,
        dispatchEvent,
        applyTextareaLayout,
        updateSendButtonState,
        clearInput,
        onVisibilityChanged,
    }) {
        this.suggestionsArea = suggestionsArea;
        this.suggestButton = suggestButton;
        this.textarea = textarea;
        this.getIcon = getIcon;
        this.getWidth = getWidth;
        this.dispatchEvent = dispatchEvent;
        this.applyTextareaLayout = applyTextareaLayout;
        this.updateSendButtonState = updateSendButtonState;
        this.clearInput = clearInput;
        this.onVisibilityChanged = onVisibilityChanged;
        this.currentSuggestions = [];
        this.clickHandler = null;
    }

    toggleSuggestions() {
        if (this.suggestionsArea.classList.contains('is-visible')) {
            this.hide();
            return;
        }

        this.suggestionsArea.classList.add('is-visible');
        this.currentSuggestions = [];
        this.suggestionsArea.innerHTML = `
            <div class="foxlate-suggestion-loading">
                <div class="loading-indicator"></div>
                <span>${browser.i18n.getMessage('summaryLoadingSuggestions') || 'Loading suggestions...'}</span>
            </div>
        `;
        this.suggestButton.disabled = true;
        this.suggestButton.classList.add('loading');
        this.dispatchEvent('infer-suggestions');
        this.onVisibilityChanged();
    }

    hide() {
        this.suggestionsArea.classList.remove('is-visible');
        this.suggestionsArea.innerHTML = '';
        this.currentSuggestions = [];
        this.onVisibilityChanged();
    }

    resetSuggestions() {
        this.hide();
        this.suggestButton.disabled = false;
        this.suggestButton.classList.remove('loading');
    }

    renderSuggestions(suggestions) {
        this.suggestionsArea.innerHTML = '';
        this.currentSuggestions = [];
        this.suggestButton.disabled = false;
        this.suggestButton.classList.remove('loading');

        const parsedSuggestions = this.#parseSuggestions(suggestions);
        if (parsedSuggestions.length === 0) {
            const messageEl = document.createElement('div');
            messageEl.className = 'foxlate-suggestion-message foxlate-suggestion-error';
            messageEl.textContent = browser.i18n.getMessage('summaryNoSuggestions') || 'No suggestions available.';
            this.suggestionsArea.appendChild(messageEl);
            this.onVisibilityChanged();
            return;
        }

        this.currentSuggestions = parsedSuggestions.map(suggestion => String(suggestion ?? ''));
        const fragment = document.createDocumentFragment();

        parsedSuggestions.forEach(suggestion => {
            const suggestionEl = document.createElement('div');
            suggestionEl.className = 'foxlate-suggestion-item';
            suggestionEl.dataset.suggestionText = String(suggestion ?? '');

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
        this.applySuggestionsLayout();
        this.#bindClickHandler();
        this.onVisibilityChanged();
    }

    applySuggestionsLayout() {
        const width = this.getWidth();
        this.suggestionsArea.querySelectorAll('.foxlate-suggestion-item').forEach(suggestionEl => {
            const suggestionText = suggestionEl.dataset.suggestionText || suggestionEl.querySelector('.suggestion-text')?.textContent || '';
            suggestionEl.style.minHeight = `${summaryLayoutController.estimateSuggestionHeight(suggestionText, width)}px`;
        });
    }

    destroy() {
        if (this.clickHandler) {
            this.suggestionsArea.removeEventListener('click', this.clickHandler);
            this.clickHandler = null;
        }
    }

    #parseSuggestions(suggestions) {
        if (!suggestions || suggestions.length === 0) {
            return [];
        }

        if (typeof suggestions[0] === 'string' && suggestions[0].startsWith('```json')) {
            try {
                const jsonString = suggestions[0].substring(7, suggestions[0].length - 3).trim();
                const parsed = JSON.parse(jsonString);
                return Array.isArray(parsed) ? parsed : suggestions;
            } catch (error) {
                console.error('[Foxlate Summary] Error parsing suggestions:', error);
                return suggestions;
            }
        }

        return suggestions;
    }

    #bindClickHandler() {
        if (this.clickHandler) {
            this.suggestionsArea.removeEventListener('click', this.clickHandler);
        }

        this.clickHandler = event => {
            const suggestionItem = event.target.closest('.foxlate-suggestion-item');
            const editButton = event.target.closest('.edit-suggestion-button');

            if (editButton) {
                this.textarea.value = editButton.dataset.suggestion;
                this.applyTextareaLayout();
                this.updateSendButtonState();
                this.textarea.focus();
                this.toggleSuggestions();
            } else if (suggestionItem) {
                const suggestion = suggestionItem.querySelector('.suggestion-text')?.textContent;
                if (!suggestion) return;

                this.dispatchEvent('send-message', { query: suggestion });
                this.toggleSuggestions();
                if (this.textarea.value.trim() !== suggestion) {
                    this.clearInput();
                }
            }
        };

        this.suggestionsArea.addEventListener('click', this.clickHandler);
    }
}
