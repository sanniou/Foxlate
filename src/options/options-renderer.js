import browser from '../lib/browser-polyfill.js';
import { escapeHtml } from '../common/utils.js';
import * as Constants from '../common/constants.js';
import { uiTextLayoutService } from '../common/ui-text-layout-service.js';
import { enhanceThemedSelects } from './components/ThemedSelect.js';
import {
    populateEngineSelect,
    populateLanguageOptions,
} from './ui-helpers.js';

export class OptionsRenderer {
    constructor(elements, {
        renderCloudDataList = () => {},
    } = {}) {
        this.elements = elements;
        this.renderCloudDataList = renderCloudDataList;
    }

    render({
        state,
        changes,
        isInitialRender,
        aiEngineModal,
        domainRuleModal,
    }) {
        const { elements } = this;

        if (isInitialRender || changes.has('aiEngines') || changes.has('translatorEngine')) {
            populateEngineSelect(elements.translatorEngine, { allEngines: state.aiEngines });
            elements.translatorEngine.value = state.translatorEngine;
        }

        elements.targetLanguage.value = state.targetLanguage;
        const defaultSelector = state.translationSelector.default || {};
        elements.defaultContentSelector.value = defaultSelector.content || '';
        elements.defaultExcludeSelector.value = defaultSelector.exclude || '';
        elements.deeplxApiUrl.value = state.deeplxApiUrl;
        elements.displayModeSelect.value = state.displayMode;
        elements.scrollIdleTranslation.checked = state.translateAfterScrollIdle !== false;
        elements.scrollIdleDelay.value = state.scrollIdleDelayMs ?? Constants.DEFAULT_SETTINGS.scrollIdleDelayMs;
        elements.cacheSizeInput.value = state.cacheSize ?? Constants.DEFAULT_SETTINGS.cacheSize;
        elements.syncEnabled.checked = !!state.syncEnabled;

        if (isInitialRender || changes.has('translatorEngine') || changes.has('aiEngines')) {
            this.updateApiFieldsVisibility(state);
            this.checkDefaultEngineAvailability(state);
        }

        if (isInitialRender || changes.has('syncEnabled')) {
            this.updateSyncControlsVisibility(state);
        }

        if (isInitialRender || changes.has('domainRules')) {
            this.renderDomainRules(state);
        }

        if (isInitialRender || changes.has('inputTranslationSettings')) {
            populateLanguageOptions(elements.inputTargetLanguage, { includeAuto: false });
            populateEngineSelect(elements.inputTranslatorEngine, { includeDefault: true, allEngines: state.aiEngines });

            const inputSettings = state.inputTranslationSettings || {};
            elements.inputTranslationEnabled.checked = !!inputSettings.enabled;
            elements.inputTargetLanguage.value = inputSettings.targetLanguage || browser.i18n.getUILanguage().split('-')[0];
            elements.inputTranslatorEngine.value = inputSettings.translatorEngine || 'default';
            elements.inputTriggerWord.value = inputSettings.triggerWord || '';
            elements.inputKeyTriggerEnabled.checked = !!inputSettings.keyTriggerEnabled;
            elements.inputConsecutiveKey.value = inputSettings.consecutiveKey || '';
            elements.inputConsecutiveKeyPresses.value = inputSettings.consecutiveKeyPresses || 3;
            elements.inputBlacklist.value = (inputSettings.blacklist || []).join('\n');
        }

        if (changes.has('aiEngines')) {
            if (aiEngineModal?.isOpen()) aiEngineModal.updateEngines(state.aiEngines || []);
            if (domainRuleModal?.isOpen()) domainRuleModal.updateEngines(state.aiEngines);
        }

        enhanceThemedSelects(document);
        uiTextLayoutService.applyTree(document);
    }

    renderDomainRules(state) {
        const { elements } = this;
        elements.domainRulesList.innerHTML = '';
        const rulesArray = Object.entries(state.domainRules || {}).map(([domain, rule]) => ({ domain, ...rule }));

        if (rulesArray.length === 0) {
            const li = document.createElement('li');
            li.className = 'no-rules-message';
            li.textContent = browser.i18n.getMessage('noDomainRulesFound') || 'No domain rules configured.';
            elements.domainRulesList.appendChild(li);
            return;
        }

        rulesArray.sort((a, b) => {
            const timeA = a.addedAt || Date.now();
            const timeB = b.addedAt || Date.now();
            return timeA - timeB;
        });

        rulesArray.forEach(rule => {
            const li = document.createElement('li');
            li.className = 'domain-rule-item';
            li.dataset.domain = rule.domain;
            li.innerHTML = `
                <span class="text-sm font-medium">${escapeHtml(rule.domain)}</span>
                <div class="rule-actions flex-row">
                    <button class="btn btn-text btn-sm edit-rule-btn" data-domain="${rule.domain}">${browser.i18n.getMessage('edit') || 'Edit'}</button>
                    <button class="btn btn-text btn-sm text-error delete-rule-btn" data-domain="${rule.domain}">${browser.i18n.getMessage('removeRule') || 'Delete'}</button>
                </div>
            `;
            elements.domainRulesList.appendChild(li);
            uiTextLayoutService.applyElement(li, { minWidth: 160, paddingX: 32 });
        });
    }

    checkDefaultEngineAvailability(state) {
        if (!state.translatorEngine || !state.translatorEngine.startsWith('ai:')) {
            this.hideDefaultEngineWarning();
            return true;
        }
        const engineId = state.translatorEngine.substring(3);
        const engineExists = state.aiEngines.some(engine => engine.id === engineId);
        if (!engineExists) {
            this.showDefaultEngineWarning();
        } else {
            this.hideDefaultEngineWarning();
        }
        return engineExists;
    }

    showDefaultEngineWarning() {
        const warningElement = document.getElementById('defaultEngineWarning');
        if (warningElement) {
            warningElement.style.display = 'block';
            warningElement.innerHTML = `<div class="warning-message">⚠️ ${browser.i18n.getMessage('defaultEngineNotFound')}</div>`;
        }
    }

    hideDefaultEngineWarning() {
        const warningElement = document.getElementById('defaultEngineWarning');
        if (warningElement) {
            warningElement.style.display = 'none';
        }
    }

    updateApiFieldsVisibility(state) {
        const { elements } = this;
        const engine = elements.translatorEngine.value;
        elements.deeplxUrlGroup.style.display = 'none';
        elements.aiEngineManagementGroup.style.display = 'none';
        if (engine === 'deeplx') {
            elements.deeplxUrlGroup.style.display = 'block';
        } else if (engine.startsWith('ai:') || state.aiEngines?.length > 0) {
            elements.aiEngineManagementGroup.style.display = 'block';
        }
    }

    updateSyncControlsVisibility(state) {
        const isEnabled = state.syncEnabled;
        this.elements.syncManagementControls.style.display = isEnabled ? 'block' : 'none';
        if (isEnabled) {
            this.renderCloudDataList();
        }
    }
}
