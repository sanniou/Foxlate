import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { SettingsManager } from '../common/settings-manager.js';
import { shouldTranslate } from '../common/precheck.js';

export class OptionsActions {
    constructor({
        elements,
        confirmModal,
        domainRuleModal,
        getState,
        getCurrentSettingsState,
        setInitialSettingsSnapshot,
        dispatch,
        updateSaveButtonState,
        showStatusMessage,
    }) {
        this.elements = elements;
        this.confirmModal = confirmModal;
        this.domainRuleModal = domainRuleModal;
        this.getState = getState;
        this.getCurrentSettingsState = getCurrentSettingsState;
        this.setInitialSettingsSnapshot = setInitialSettingsSnapshot;
        this.dispatch = dispatch;
        this.updateSaveButtonState = updateSaveButtonState;
        this.showStatusMessage = showStatusMessage;
    }

    validateCssSelectorInput(inputElement) {
        const field = inputElement.closest('.input-group');
        if (!field) return true;

        let errorElement = field.querySelector('.text-error');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.className = 'text-error';
            field.appendChild(errorElement);
        }

        field.classList.remove('is-invalid');
        errorElement.textContent = '';

        const selectorValue = inputElement.value.trim();
        if (!selectorValue) return true;

        const selectors = selectorValue.split(',').map(selector => selector.trim()).filter(Boolean);
        for (const selector of selectors) {
            try {
                document.querySelector(selector);
            } catch (error) {
                field.classList.add('is-invalid');
                errorElement.textContent = browser.i18n.getMessage('invalidCssSelector');
                return false;
            }
        }

        return true;
    }

    async updateCacheInfo() {
        try {
            const info = await browser.runtime.sendMessage({ type: MESSAGE_TYPES.GET_CACHE_INFO });
            if (info) this.elements.cacheInfoDisplay.textContent = `${info.count} / ${info.limit}`;
        } catch (error) {
            console.error('Failed to get cache info:', error);
            this.elements.cacheInfoDisplay.textContent = 'N/A';
        }
    }

    async clearCache() {
        const confirmed = await this.confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('clearCacheConfirm')
        );
        if (!confirmed) return;

        await browser.runtime.sendMessage({ type: MESSAGE_TYPES.CLEAR_CACHE });
        await this.updateCacheInfo();
        this.showStatusMessage(browser.i18n.getMessage('clearCacheSuccess'));
    }

    async loadSettings() {
        try {
            const initialSettings = await SettingsManager.getValidatedSettings();
            const snapshot = JSON.stringify(initialSettings);
            this.setInitialSettingsSnapshot(snapshot);
            this.dispatch({ type: 'SET_FULL_STATE', payload: JSON.parse(snapshot) });
            await this.updateCacheInfo();
        } catch (error) {
            console.error('Failed to load and validate settings:', error);
            this.showStatusMessage(browser.i18n.getMessage('loadSettingsError'), true);
        }
    }

    async saveSettings() {
        this.elements.saveSettingsBtn.dataset.state = 'loading';
        const settingsToSave = this.getCurrentSettingsState();
        const isContentValid = this.validateCssSelectorInput(this.elements.defaultContentSelector);
        const isExcludeValid = this.validateCssSelectorInput(this.elements.defaultExcludeSelector);

        if (!isContentValid || !isExcludeValid) {
            this.elements.saveSettingsBtn.dataset.state = 'error';
            const firstInvalidField = document.querySelector('.content-panel.active .input-group.is-invalid');
            if (firstInvalidField) {
                firstInvalidField.classList.add('error-shake');
                setTimeout(() => firstInvalidField.classList.remove('error-shake'), 500);
            }
            setTimeout(() => { this.elements.saveSettingsBtn.dataset.state = ''; }, 500);
            return;
        }

        try {
            await SettingsManager.saveLocalSettings(settingsToSave);
            this.setInitialSettingsSnapshot(this.getCurrentSettingsState());
            this.elements.saveSettingsBtn.dataset.state = 'success';
            setTimeout(() => {
                this.updateSaveButtonState();
                setTimeout(() => { this.elements.saveSettingsBtn.dataset.state = ''; }, 200);
            }, 1200);
        } catch (error) {
            console.error('Error saving settings:', error);
            this.elements.saveSettingsBtn.dataset.state = 'error';
            setTimeout(() => { this.elements.saveSettingsBtn.dataset.state = ''; }, 500);
        }
    }

    async resetSettings() {
        const confirmed = await this.confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('resetSettingsConfirm')
        );
        if (!confirmed) return;

        try {
            const defaultSettings = SettingsManager.generateDefaultSettings();
            this.setInitialSettingsSnapshot(defaultSettings);
            await SettingsManager.saveLocalSettings(defaultSettings);
            this.showStatusMessage(browser.i18n.getMessage('resetSettingsSuccess'));
        } catch (error) {
            console.error('Error resetting settings:', error);
            this.showStatusMessage(browser.i18n.getMessage('resetSettingsError'), true);
        }
    }

    async removeDomainRule(domainToRemove) {
        const confirmed = await this.confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('confirmDeleteRule')
        );
        if (!confirmed) return;

        try {
            const newDomainRules = { ...this.getState().domainRules };
            delete newDomainRules[domainToRemove];

            this.dispatch({ type: 'SET_DOMAIN_RULES', payload: newDomainRules });

            await SettingsManager.saveLocalSettings(this.getCurrentSettingsState());
            this.showStatusMessage(browser.i18n.getMessage('removeRuleSuccess'));
        } catch (error) {
            console.error('Failed to remove domain rule:', error);
            this.showStatusMessage('Failed to remove domain rule.', true);
        }
    }

    editDomainRule(domain) {
        const state = this.getState();
        const ruleData = state.domainRules[domain] || {};
        this.domainRuleModal.open(domain, ruleData, state);
    }

    async saveDomainRule({ rule, originalDomain }) {
        try {
            const state = this.getState();
            const newDomainRules = { ...state.domainRules };
            if (originalDomain) {
                if (newDomainRules[originalDomain]?.addedAt) {
                    rule.addedAt = newDomainRules[originalDomain].addedAt;
                }
                delete newDomainRules[originalDomain];
            }
            if (!rule.addedAt) {
                rule.addedAt = Date.now();
            }
            newDomainRules[rule.domain] = rule;

            await SettingsManager.saveLocalSettings({ ...state, domainRules: newDomainRules });
            this.showStatusMessage(browser.i18n.getMessage('saveRuleSuccess') || 'Rule saved successfully.');
        } catch (error) {
            console.error('Failed to save domain rule:', error);
            this.showStatusMessage('Failed to save domain rule.', true);
        }
    }

    async saveAiEngine(engineData) {
        try {
            await SettingsManager.saveAiEngine(engineData, engineData.id || null);
            this.showStatusMessage(browser.i18n.getMessage('saveAiEngineSuccess'));
        } catch (error) {
            console.error('Failed to save AI engine:', error);
            this.showStatusMessage('Failed to save AI engine.', true);
        }
    }

    async removeAiEngine(engineId) {
        try {
            await SettingsManager.removeAiEngine(engineId);
            this.showStatusMessage(browser.i18n.getMessage('removeAiEngineSuccess'));
        } catch (error) {
            console.error('Failed to remove AI engine:', error);
            this.showStatusMessage('Failed to remove AI engine.', true);
        }
    }

    async exportSettings() {
        const settingsJson = JSON.stringify(this.getCurrentSettingsState(), null, 2);
        const blob = new Blob([settingsJson], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'foxlate-settings.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.showStatusMessage(browser.i18n.getMessage('exportSuccess'));
    }

    importSettings(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (readerEvent) => {
            try {
                const settings = JSON.parse(readerEvent.target.result);
                this.setInitialSettingsSnapshot(settings);
                await SettingsManager.saveLocalSettings(settings);
                this.showStatusMessage(browser.i18n.getMessage('importSuccess'));
            } catch (error) {
                this.showStatusMessage(browser.i18n.getMessage('importError'), true);
                console.error(error);
            }
        };
        reader.readAsText(file);
    }

    toggleLogArea() {
        const isHidden = this.elements.logContent.style.display === 'none';
        if (isHidden) {
            this.elements.logContent.style.display = 'block';
            this.elements.toggleLogBtn.textContent = browser.i18n.getMessage('hideLogButton') || 'Hide Log';
            return;
        }

        this.elements.logContent.style.display = 'none';
        this.elements.toggleLogBtn.textContent = browser.i18n.getMessage('testLogButton') || 'Show Log';
        this.elements.logContent.textContent = '';
    }

    async performTestTranslation() {
        const sourceText = document.getElementById('test-source-text').value.trim();
        const resultArea = document.getElementById('test-result-area');

        if (this.elements.aiTestResult) this.elements.aiTestResult.style.display = 'none';
        resultArea.style.display = 'block';

        if (!sourceText) {
            resultArea.textContent = browser.i18n.getMessage('testSourceEmpty') || 'Please enter text to translate.';
            resultArea.className = 'alert alert-error mt-2';
            return;
        }

        const precheck = shouldTranslate(sourceText, { targetLanguage: this.elements.targetLanguage.value }, true);
        this.elements.logContent.textContent = precheck.log.join('\n');
        this.elements.logContent.style.display = 'block';
        this.elements.toggleLogBtn.textContent = browser.i18n.getMessage('hideLogButton') || 'Hide Log';

        if (!precheck.result) {
            resultArea.textContent = `${browser.i18n.getMessage('testNotTranslated')} ${sourceText}`;
            resultArea.className = 'alert alert-success mt-2';
            return;
        }

        resultArea.textContent = browser.i18n.getMessage('testing') || 'Translating...';
        resultArea.className = 'alert mt-2';

        try {
            const response = await browser.runtime.sendMessage({
                type: MESSAGE_TYPES.TEST_TRANSLATE_TEXT,
                payload: {
                    text: sourceText,
                    targetLang: this.elements.targetLanguage.value,
                    sourceLang: 'auto',
                    translatorEngine: this.elements.translatorEngine.value,
                },
            });

            if (response.log && response.log.length > 0) {
                this.elements.logContent.textContent += `\n${response.log.join('\n')}`;
            }

            if (response.success) {
                resultArea.textContent = response.translatedText.translated
                    ? response.translatedText.text
                    : `${browser.i18n.getMessage('testNotTranslated')} ${response.translatedText.text}`;
                resultArea.className = 'alert alert-success mt-2';
            } else {
                resultArea.textContent = `Error: ${response.error}`;
                resultArea.className = 'alert alert-error mt-2';
            }
        } catch (error) {
            console.error('Translation test error:', error);
            resultArea.textContent = `Error: ${error.message}`;
            resultArea.className = 'alert alert-error mt-2';
        }
    }

    async renderCloudDataList() {
        this.elements.cloudDataList.innerHTML = '';
        this.elements.cloudSettingsInfo.textContent = browser.i18n.getMessage('cloudSettingsStatus');

        try {
            const response = await browser.runtime.sendMessage({ type: MESSAGE_TYPES.GET_CLOUD_BACKUPS });
            if (response?.success && response.backups?.length > 0) {
                response.backups.forEach(backup => {
                    const item = document.createElement('li');
                    item.className = 'cloud-data-item';
                    const formattedDate = new Date(backup.timestamp).toLocaleString();
                    item.innerHTML = `
                        <span class="text-sm">${formattedDate}</span>
                        <div class="item-actions flex-row">
                            <button class="btn btn-text btn-sm download-cloud-backup-btn" data-backup-id="${backup.id}">${browser.i18n.getMessage('downloadSettings')}</button>
                            <button class="btn btn-text btn-sm text-error delete-cloud-backup-btn" data-backup-id="${backup.id}">${browser.i18n.getMessage('removeRule')}</button>
                        </div>
                    `;
                    this.elements.cloudDataList.appendChild(item);
                });
                this.elements.cloudSettingsInfo.textContent = browser.i18n.getMessage(
                    'lastSynced',
                    new Date(response.backups[0].timestamp).toLocaleString()
                );
                return;
            }

            this.elements.cloudSettingsInfo.textContent = browser.i18n.getMessage('cloudSettingsStatusNoData');
            const item = document.createElement('li');
            item.className = 'no-rules-message';
            item.textContent = browser.i18n.getMessage('noCloudBackupsFound');
            this.elements.cloudDataList.appendChild(item);
        } catch (error) {
            console.error('Failed to fetch cloud backups:', error);
            this.elements.cloudSettingsInfo.textContent = `Error: ${error.message}`;
            this.showStatusMessage(browser.i18n.getMessage('loadCloudDataFailed'), true);
        }
    }

    async uploadSettingsToCloud() {
        const confirmed = await this.confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('confirmUploadSettings')
        );
        if (!confirmed) return;

        try {
            await browser.runtime.sendMessage({
                type: MESSAGE_TYPES.UPLOAD_SETTINGS_TO_CLOUD,
                payload: this.getCurrentSettingsState(),
            });
            this.showStatusMessage(browser.i18n.getMessage('settingsUploadedSuccess'));
            this.renderCloudDataList();
        } catch (error) {
            console.error('Failed to upload settings to cloud:', error);
            this.showStatusMessage(browser.i18n.getMessage('uploadSettingsToCloudFailed'), true);
        }
    }

    async downloadSettingsFromCloud(backupId) {
        const confirmed = await this.confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('confirmDownloadSettings')
        );
        if (!confirmed) return;

        try {
            const response = await browser.runtime.sendMessage({
                type: MESSAGE_TYPES.DOWNLOAD_SETTINGS_FROM_CLOUD,
                payload: { backupId },
            });
            if (!response?.success) {
                this.showStatusMessage(`Failed to download settings: ${response?.error}`, true);
                return;
            }

            await SettingsManager.saveLocalSettings(response.settings);
            this.showStatusMessage(browser.i18n.getMessage('settingsDownloadedSuccess'));
            const newSettings = await SettingsManager.getValidatedSettings();
            this.setInitialSettingsSnapshot(newSettings);
            this.dispatch({ type: 'SET_FULL_STATE', payload: newSettings });
        } catch (error) {
            console.error('Failed to download settings from cloud:', error);
            this.showStatusMessage(browser.i18n.getMessage('downloadSettingsFromCloudFailed'), true);
        }
    }

    async deleteCloudBackup(backupId) {
        const confirmed = await this.confirmModal.open(
            browser.i18n.getMessage('confirmTitle'),
            browser.i18n.getMessage('confirmDeleteBackup')
        );
        if (!confirmed) return;

        try {
            await browser.runtime.sendMessage({ type: MESSAGE_TYPES.DELETE_CLOUD_BACKUP, payload: { backupId } });
            this.showStatusMessage(browser.i18n.getMessage('deleteBackupSuccess'));
            this.renderCloudDataList();
        } catch (error) {
            console.error('Failed to delete cloud backup:', error);
            this.showStatusMessage(browser.i18n.getMessage('deleteBackupFailed'), true);
        }
    }

    async refreshCloudData() {
        this.showStatusMessage(browser.i18n.getMessage('refreshingCloudData'));
        await this.renderCloudDataList();
        this.showStatusMessage(browser.i18n.getMessage('cloudDataRefreshed'));
    }
}
