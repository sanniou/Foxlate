import browser from '../../lib/browser-polyfill.js';
import { BaseComponent } from './BaseComponent.js';
import { FormValidator } from '../validator.js';
import { escapeHtml } from '../../common/utils.js';
import { populateEngineSelect } from '../ui-helpers.js';

export class AIEngineModal extends BaseComponent {
    #elements;
    #confirmModal;
    #validator;
    #state = {
        isOpen: false,
        isFormVisible: false,
        isImportModalOpen: false,
        editingEngine: null,
        allEngines: [],
    };

    constructor(elements, confirmModal) {
        super();
        this.#elements = elements;
        this.#confirmModal = confirmModal;
        this.#validator = new FormValidator(this.#elements.aiEngineForm, {
            'aiEngineName': { rules: 'required', labelKey: 'aiEngineName' },
            'aiApiKey': { rules: 'required', labelKey: 'aiApiKey' },
            'aiApiUrl': { rules: 'required', labelKey: 'aiApiUrl' },
            'aiModelName': { rules: 'required', labelKey: 'aiModelName' },
            'aiCustomPrompt': { rules: 'required', labelKey: 'aiCustomPrompt' },
            'aiShortTextEngine': { rules: 'required', labelKey: 'aiShortTextEngine' }
        });
        this.#bindEvents();
    }

    isOpen() {
        return this.#state.isOpen;
    }

    open(allEngines) {
        this.#state.allEngines = allEngines;
        this.#state.isOpen = true;
        this.#render();
    }

    updateEngines(newEngines) {
        this.#state.allEngines = newEngines;
        if (this.#state.isOpen) {
            this.#renderEngineList(this.#state.allEngines);
            // Also re-populate the fallback engine select if the form is visible
            if (this.#state.isFormVisible && this.#elements.aiShortTextEngineSelect) {
                populateEngineSelect(this.#elements.aiShortTextEngineSelect, {
                    includeDefault: true,
                    excludeId: this.#state.editingEngine?.id,
                    allEngines: this.#state.allEngines
                });
            }
        }
    }

    close() {
        this.#state.isOpen = false;
        this.#state.isFormVisible = false;
        this.#state.editingEngine = null;
        this.#render();
    }

    #openImportModal() {
        this.#elements.importAiEngineConfigText.value = '';
        this.#elements.importAiEngineErrorText.textContent = '';
        this.#elements.importAiEngineConfigText.closest('.m3-form-field').classList.remove('is-invalid');
        this.#state.isImportModalOpen = true;
        this.#render();
        this.#elements.importAiEngineConfigText.focus();
    }

    #closeImportModal() {
        this.#state.isImportModalOpen = false;
        this.#render();
    }

    #showForm(engine = {}) {
        this.#state.editingEngine = JSON.parse(JSON.stringify(engine));
        this.#state.isFormVisible = true;
        this.#render();
    }

    #hideForm() {
        this.#state.isFormVisible = false;
        this.#state.editingEngine = null;
        this.#render();
    }

    #render() {
        this.#renderMainModal();
        this.#renderImportModal();
    }

    #renderMainModal() {
        const { isOpen, isFormVisible, editingEngine, allEngines } = this.#state;
        const modal = this.#elements.aiEngineModal;

        if (isOpen) {
            this.#renderEngineList(allEngines);
            this.#elements.aiEngineForm.style.display = isFormVisible ? 'block' : 'none';
            if (isFormVisible && editingEngine) {
                this.#validator.clearAllErrors();
                populateEngineSelect(this.#elements.aiShortTextEngineSelect, {
                    includeDefault: true,
                    excludeId: editingEngine.id,
                    allEngines: this.#state.allEngines
                });
                this.#elements.aiFormTitle.textContent = editingEngine.id ? browser.i18n.getMessage('edit') : browser.i18n.getMessage('add');
                this.#elements.aiTestText.value = 'Hello, world!';
                const formFields = {
                    aiEngineNameInput: 'name',
                    aiApiKeyInput: 'apiKey',
                    aiApiUrlInput: 'apiUrl',
                    aiModelNameInput: 'model',
                    aiCustomPromptInput: 'customPrompt',
                    aiShortTextThresholdInput: 'wordCountThreshold',
                    aiShortTextEngineSelect: 'fallbackEngine'
                };
                for (const [elementKey, engineKey] of Object.entries(formFields)) {
                    const element = this.#elements[elementKey];
                    if (!element) continue;
                    const defaultValue = engineKey === 'wordCountThreshold' ? 1 : (engineKey === 'fallbackEngine' ? 'default' : '');
                    element.value = editingEngine[engineKey] ?? defaultValue;
                }
            }
            this.#openModal(modal);
        } else {
            this.#closeModal(modal);
        }
    }

    #renderImportModal() {
        const modal = this.#elements.importAiEngineModal;
        if (this.#state.isImportModalOpen) {
            this.#openModal(modal);
        } else {
            this.#closeModal(modal);
        }
    }

    #renderEngineList(engines) {
        const listEl = this.#elements.aiEngineList;
        listEl.innerHTML = ''; // Clear previous content
        if (!engines || engines.length === 0) {
            listEl.innerHTML = `<p>${browser.i18n.getMessage('noAiEnginesFound') || 'No AI engines configured.'}</p>`;
            return;
        }

        const ul = document.createElement('ul');
        engines.forEach(engine => {
            const syncStatus = engine.syncStatus || 'local';
            const statusIcon = { synced: '☁️', local: '💾', syncing: '⏳' }[syncStatus] || '❓';
            const statusText = browser.i18n.getMessage(`syncStatus${syncStatus.charAt(0).toUpperCase() + syncStatus.slice(1)}`) || 'Unknown';
            const li = document.createElement('li');
            li.dataset.id = engine.id;
            li.innerHTML = `
                <div class="engine-info">
                    <span class="engine-name">${escapeHtml(engine.name)}</span>
                    <span class="sync-status ${syncStatus}" title="${statusText}">${statusIcon} ${statusText}</span>
                </div>
                <div class="actions">
                    ${syncStatus === 'local' ? `<button class="m3-button text retry-sync-btn">${browser.i18n.getMessage('retrySync')}</button>` : ''}
                    <button class="m3-button text copy-ai-engine-btn">${browser.i18n.getMessage('copy')}</button>
                    <button class="m3-button text edit-ai-engine-btn">${browser.i18n.getMessage('edit')}</button>
                    <button class="m3-button text danger remove-ai-engine-btn">${browser.i18n.getMessage('removeAiEngine')}</button>
                </div>`;
            ul.appendChild(li);
        });
        listEl.appendChild(ul);
    }

    #handleFormInputChange(e) {
        if (!this.#state.editingEngine) return;
        const target = e.target;
        const updater = {
            [this.#elements.aiEngineNameInput.id]: (val) => this.#state.editingEngine.name = val,
            [this.#elements.aiApiKeyInput.id]: (val) => this.#state.editingEngine.apiKey = val,
            [this.#elements.aiApiUrlInput.id]: (val) => this.#state.editingEngine.apiUrl = val,
            [this.#elements.aiModelNameInput.id]: (val) => this.#state.editingEngine.model = val,
            [this.#elements.aiCustomPromptInput.id]: (val) => this.#state.editingEngine.customPrompt = val,
            [this.#elements.aiShortTextThresholdInput.id]: (val) => this.#state.editingEngine.wordCountThreshold = parseInt(val, 10) || 0,
            [this.#elements.aiShortTextEngineSelect.id]: (val) => this.#state.editingEngine.fallbackEngine = val
        }[target.id];
        if (updater) {
            updater(target.type === 'checkbox' ? target.checked : target.value);
        }
    }

    async #saveEngine() {
        if (!this.#validator.validate()) return;
        this.emit('save', this.#state.editingEngine);
        this.#hideForm();
    }

    async #removeEngine(id) {
        const confirmed = await this.#confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('confirmDeleteAiEngine')
        );
        if (confirmed) {
            this.emit('remove', id);
        }
    }

    async #copyEngine(id) {
        const engine = this.#state.allEngines.find(e => e.id === id);
        if (engine) {
            try {
                const cleanEngine = { ...engine };
                delete cleanEngine.id;
                delete cleanEngine.syncStatus;
                await navigator.clipboard.writeText(JSON.stringify(cleanEngine, null, 2));
                this.emit('showStatus', browser.i18n.getMessage('copiedAiEngineSuccess'));
            } catch (err) {
                this.emit('showStatus', browser.i18n.getMessage('copyAiEngineError'), true);
                console.error('Failed to copy AI Engine:', err);
            }
        }
    }

    #handleConfirmImport() {
        const formField = this.#elements.importAiEngineConfigText.closest('.m3-form-field');
        const errorEl = this.#elements.importAiEngineErrorText;
        const configText = this.#elements.importAiEngineConfigText.value.trim();

        formField.classList.remove('is-invalid');
        errorEl.textContent = '';

        if (!configText) {
            errorEl.textContent = browser.i18n.getMessage('pasteConfigRequired');
            formField.classList.add('is-invalid');
            return;
        }

        try {
            const importedData = JSON.parse(configText);
            const engineData = Array.isArray(importedData) ? importedData[0] : importedData;

            if (!engineData || !engineData.name || !engineData.apiKey || !engineData.apiUrl || !engineData.model || !engineData.customPrompt) {
                throw new Error(browser.i18n.getMessage('invalidAiEngineData'));
            }

            const cleanEngineData = { ...engineData };
            delete cleanEngineData.id;
            delete cleanEngineData.syncStatus;

            this.#closeImportModal();
            this.#showForm(cleanEngineData);
            this.emit('showStatus', browser.i18n.getMessage('importedAiEngineSuccess'));
        } catch (err) {
            errorEl.textContent = err.message;
            formField.classList.add('is-invalid');
            console.error('Failed to import AI Engine:', err);
        }
    }

    async #testConnection() {
        if (!this.#validator.validate()) return;

        this.#elements.aiTestSection.style.display = 'block';
        const engineData = this.#state.editingEngine;
        const testText = this.#elements.aiTestText.value.trim() || 'Hello, world!';

        const resultEl = this.#elements.aiTestResult;

        resultEl.textContent = browser.i18n.getMessage('testing') || 'Testing...';
        resultEl.classList.remove('success', 'error');
        resultEl.style.display = 'block';
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        try {
            const response = await browser.runtime.sendMessage({
                type: 'TEST_CONNECTION',
                payload: { engine: 'ai', settings: { ...engineData }, text: testText }
            });

            if (response.success) {
                resultEl.innerHTML = `<strong>${browser.i18n.getMessage('testOriginal')}:</strong> ${escapeHtml(testText)}<br><strong>${browser.i18n.getMessage('testTranslated')}:</strong> ${escapeHtml(response.translatedText.text)}`;
                resultEl.classList.add('success');
            } else {
                resultEl.textContent = `${browser.i18n.getMessage('testError')}: ${response.error}`;
                resultEl.classList.add('error');
            }
        } catch (error) {
            console.error('AI connection test error:', error);
            resultEl.textContent = `${browser.i18n.getMessage('testError')}: ${error.message}`;
            resultEl.classList.add('error');
        }
    }

    #bindEvents() {
        // Main modal events
        this.#elements.aiEngineModal.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;

            const li = target.closest('li[data-id]');
            const engineId = li?.dataset.id;

            if (target.id === this.#elements.addAiEngineBtn.id) {
                this.#showForm();
            } else if (target.id === this.#elements.cancelAiEngineBtn.id) {
                this.#hideForm();
            } else if (target.id === this.#elements.saveAiEngineBtn.id) {
                this.#saveEngine();
            } else if (target.id === this.#elements.testAiEngineBtn.id) {
                this.#testConnection();
            } else if (target.id === this.#elements.openImportAiEngineModalBtn.id) {
                this.#openImportModal();
            } else if (target.classList.contains('edit-ai-engine-btn')) {
                const engine = this.#state.allEngines.find(e => e.id === engineId);
                if (engine) this.#showForm(engine);
            } else if (target.classList.contains('remove-ai-engine-btn')) {
                this.#removeEngine(engineId);
            } else if (target.classList.contains('copy-ai-engine-btn')) {
                this.#copyEngine(engineId);
            } else if (target.classList.contains('retry-sync-btn')) {
                this.emit('retrySync', engineId);
            }
        });

        this.#elements.aiEngineForm.addEventListener('input', (e) => this.#handleFormInputChange(e));
        this.#elements.aiEngineForm.addEventListener('change', (e) => this.#handleFormInputChange(e));

        // Import modal events
        this.#elements.importAiEngineModal.addEventListener('click', (e) => {
            if (e.target.id === this.#elements.confirmImportAiEngineBtn.id) {
                this.#handleConfirmImport();
            } else if (e.target.id === this.#elements.cancelImportAiEngineBtn.id || e.target.classList.contains('close-button')) {
                this.#closeImportModal();
            }
        });

        // Close buttons
        this.#elements.closeAiEngineModalBtn.addEventListener('click', () => this.close());
    }

    #openModal(modalElement) {
        document.body.classList.add('modal-open');
        modalElement.style.display = 'flex';
        modalElement.offsetWidth; // Trigger reflow
        modalElement.classList.add('is-visible');
    }

    #closeModal(modalElement) {
        if (!modalElement.classList.contains('is-visible')) return;

        modalElement.classList.remove('is-visible');
        const onTransitionEnd = () => {
            modalElement.style.display = 'none';
            modalElement.removeEventListener('transitionend', onTransitionEnd);
            if (document.querySelectorAll('.modal.is-visible').length === 0) {
                document.body.classList.remove('modal-open');
            }
        };
        modalElement.addEventListener('transitionend', onTransitionEnd);
    }
}
