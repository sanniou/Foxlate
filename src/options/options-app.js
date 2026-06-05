import { SettingsManager } from '../common/settings-manager.js';
import { AIEngineModal } from './components/AIEngineModal.js';
import { DomainRuleModal } from './components/DomainRuleModal.js';
import { ConfirmModal } from './components/ConfirmModal.js';
import { rootReducer, diffState } from './options-state.js';
import { queryOptionsElements } from './options-elements.js';
import { OptionsRenderer } from './options-renderer.js';
import { bindOptionsEvents } from './options-events.js';
import { OptionsActions } from './options-actions.js';
import {
    applyOptionsTranslations,
    createStatusMessenger,
    initializeOptionsControls,
    initializeOptionsNavigation,
} from './options-page-shell.js';

export class OptionsApp {
    constructor(root = document) {
        this.root = root;
        this.state = {};
        this.initialSettingsSnapshot = undefined;
        this.elements = {};
        this.renderer = null;
        this.actions = null;
        this.aiEngineModal = null;
        this.domainRuleModal = null;
        this.confirmModal = null;
        this.showStatusMessage = () => {};
    }

    getCurrentSettingsState() {
        return { ...this.state };
    }

    setInitialSettingsSnapshot(settingsOrSnapshot) {
        this.initialSettingsSnapshot = typeof settingsOrSnapshot === 'string'
            ? settingsOrSnapshot
            : JSON.stringify(settingsOrSnapshot);
    }

    dispatch(action) {
        const newState = rootReducer(this.state, action);
        const changes = diffState(this.state, newState);
        this.state = newState;
        this.render(changes);
        this.updateSaveButtonState();
    }

    render(changes) {
        this.renderer.render({
            state: this.state,
            changes,
            isInitialRender: !this.initialSettingsSnapshot,
            aiEngineModal: this.aiEngineModal,
            domainRuleModal: this.domainRuleModal,
        });
    }

    updateSaveButtonState() {
        const currentSettingsString = JSON.stringify(this.getCurrentSettingsState());
        const hasChanges = currentSettingsString !== this.initialSettingsSnapshot;
        this.elements.saveSettingsBtn.classList.toggle('visible', hasChanges);
    }

    bindModalEvents() {
        this.aiEngineModal.on('save', (engineData) => this.actions.saveAiEngine(engineData));
        this.aiEngineModal.on('remove', (engineId) => this.actions.removeAiEngine(engineId));
        this.aiEngineModal.on('showStatus', (message, isError) => {
            this.showStatusMessage(message, isError);
        });
        this.domainRuleModal.on('save', (payload) => this.actions.saveDomainRule(payload));
    }

    bindPageEvents() {
        bindOptionsEvents(this.root, {
            elements: this.elements,
            dispatch: (action) => this.dispatch(action),
            actions: {
                saveSettings: () => this.actions.saveSettings(),
                resetSettings: () => this.actions.resetSettings(),
                exportSettings: () => this.actions.exportSettings(),
                importSettings: (event) => this.actions.importSettings(event),
                clearCache: () => this.actions.clearCache(),
                openAiEngineManager: () => this.aiEngineModal.open(this.state.aiEngines),
                addDomainRule: () => this.domainRuleModal.open(null, {}, this.state),
                performTestTranslation: () => this.actions.performTestTranslation(),
                toggleLogArea: () => this.actions.toggleLogArea(),
                uploadSettingsToCloud: () => this.actions.uploadSettingsToCloud(),
                refreshCloudData: () => this.actions.refreshCloudData(),
                refreshProductData: () => this.actions.refreshProductData(),
                clearTranslationHistory: () => this.actions.clearTranslationHistory(),
                clearFailureQueue: () => this.actions.clearFailureQueue(),
                clearProviderHealth: () => this.actions.clearProviderHealth(),
                retryFailure: (failureId) => this.actions.retryFailure(failureId),
                editDomainRule: (domain) => this.actions.editDomainRule(domain),
                removeDomainRule: (domain) => this.actions.removeDomainRule(domain),
                downloadSettingsFromCloud: (backupId) => this.actions.downloadSettingsFromCloud(backupId),
                deleteCloudBackup: (backupId) => this.actions.deleteCloudBackup(backupId),
            },
        });
    }

    bindSettingsEvents() {
        SettingsManager.on('settingsChanged', ({ newValue }) => {
            this.setInitialSettingsSnapshot(newValue);
            this.dispatch({
                type: 'SET_FULL_STATE',
                payload: JSON.parse(this.initialSettingsSnapshot),
            });
        });

        window.addEventListener('beforeunload', (event) => {
            const currentSettingsString = JSON.stringify(this.getCurrentSettingsState());
            if (currentSettingsString === this.initialSettingsSnapshot) return;

            event.preventDefault();
            event.returnValue = '';
            return '';
        });
    }

    async initialize() {
        this.elements = queryOptionsElements(this.root);
        this.showStatusMessage = createStatusMessenger(this.elements);

        this.renderer = new OptionsRenderer(this.elements, {
            renderCloudDataList: () => this.actions?.renderCloudDataList(),
        });

        applyOptionsTranslations(this.root);
        initializeOptionsNavigation(this.elements, { root: this.root });
        initializeOptionsControls(this.elements, this.root);

        this.confirmModal = new ConfirmModal(this.elements);
        this.aiEngineModal = new AIEngineModal(this.elements, this.confirmModal);
        this.domainRuleModal = new DomainRuleModal(this.elements);

        this.actions = new OptionsActions({
            elements: this.elements,
            confirmModal: this.confirmModal,
            domainRuleModal: this.domainRuleModal,
            getState: () => this.state,
            getCurrentSettingsState: () => this.getCurrentSettingsState(),
            setInitialSettingsSnapshot: (settings) => this.setInitialSettingsSnapshot(settings),
            dispatch: (action) => this.dispatch(action),
            updateSaveButtonState: () => this.updateSaveButtonState(),
            showStatusMessage: (message, isError) => this.showStatusMessage(message, isError),
        });

        this.bindModalEvents();
        await this.actions.loadSettings();
        await this.actions.refreshProductData();
        this.bindPageEvents();
        this.bindSettingsEvents();
    }
}

export async function bootstrapOptionsPage(root = document) {
    const app = new OptionsApp(root);
    await app.initialize();
    return app;
}
