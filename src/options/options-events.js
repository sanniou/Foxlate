import { ELEMENT_IDS } from './ui-constants.js';
import { addButtonRipple } from './components/InteractionFeedback.js';
import { parseGlossaryEntries } from '../common/translation-glossary.js';

function getEventTarget(event) {
    let target = event.target;
    if (target instanceof SVGElement && target.parentNode) {
        target = target.parentNode;
    }
    return target;
}

export function createOptionsEventHandlers({ elements, dispatch, actions }) {
    const handleClick = async (event) => {
        const target = getEventTarget(event);
        const closestButton = target.closest('button, [role="button"]');
        if (!closestButton) return;

        addButtonRipple(closestButton, event, { excludedId: ELEMENT_IDS.SAVE_SETTINGS_BTN });

        const buttonActions = {
            [ELEMENT_IDS.SAVE_SETTINGS_BTN]: actions.saveSettings,
            [ELEMENT_IDS.RESET_SETTINGS_BTN]: actions.resetSettings,
            [ELEMENT_IDS.EXPORT_BTN]: actions.exportSettings,
            [ELEMENT_IDS.IMPORT_BTN]: () => elements.importInput.click(),
            [ELEMENT_IDS.CLEAR_CACHE_BTN]: actions.clearCache,
            [ELEMENT_IDS.MANAGE_AI_ENGINES_BTN]: actions.openAiEngineManager,
            [ELEMENT_IDS.ADD_DOMAIN_RULE_BTN]: actions.addDomainRule,
            [ELEMENT_IDS.MANUAL_TEST_TRANSLATE_BTN]: actions.performTestTranslation,
            [ELEMENT_IDS.TOGGLE_LOG_BTN]: actions.toggleLogArea,
            [ELEMENT_IDS.UPLOAD_SETTINGS_BTN]: actions.uploadSettingsToCloud,
            [ELEMENT_IDS.REFRESH_CLOUD_DATA_BTN]: actions.refreshCloudData,
            [ELEMENT_IDS.REFRESH_PRODUCT_DATA_BTN]: actions.refreshProductData,
            [ELEMENT_IDS.CLEAR_HISTORY_BTN]: actions.clearTranslationHistory,
            [ELEMENT_IDS.CLEAR_PROVIDER_HEALTH_BTN]: actions.clearProviderHealth,
            [ELEMENT_IDS.CREATE_SITE_WIZARD_RULE_BTN]: actions.createSiteWizardRule,
        };
        if (buttonActions[closestButton.id]) {
            return buttonActions[closestButton.id]();
        }

        const classActions = {
            'edit-rule-btn': (button) => actions.editDomainRule(button.dataset.domain),
            'delete-rule-btn': (button) => actions.removeDomainRule(button.dataset.domain),
            'download-cloud-backup-btn': (button) => actions.downloadSettingsFromCloud(button.dataset.backupId),
            'delete-cloud-backup-btn': (button) => actions.deleteCloudBackup(button.dataset.backupId),
        };
        for (const className in classActions) {
            if (closestButton.classList.contains(className)) {
                return classActions[className](closestButton);
            }
        }
    };

    const handleInput = (event) => {
        const target = event.target;
        const id = target.id;
        const simpleStateUpdaters = {
            [ELEMENT_IDS.DEFAULT_CONTENT_SELECTOR]: (value) => dispatch({ type: 'SET_DEFAULT_SELECTOR', payload: { key: 'content', value } }),
            [ELEMENT_IDS.DEFAULT_EXCLUDE_SELECTOR]: (value) => dispatch({ type: 'SET_DEFAULT_SELECTOR', payload: { key: 'exclude', value } }),
            [ELEMENT_IDS.DEEPLX_API_URL]: (value) => dispatch({ type: 'SET_DEEPLX_URL', payload: value }),
            [ELEMENT_IDS.CACHE_SIZE_INPUT]: (value) => dispatch({ type: 'SET_CACHE_SIZE', payload: value }),
            [ELEMENT_IDS.SCROLL_IDLE_DELAY]: (value) => dispatch({ type: 'SET_SCROLL_IDLE_DELAY', payload: value }),
            [ELEMENT_IDS.GLOSSARY_ENTRIES]: (value) => dispatch({ type: 'SET_GLOSSARY_ENTRIES', payload: parseGlossaryEntries(value) }),
        };
        if (simpleStateUpdaters[id]) {
            simpleStateUpdaters[id](target.value);
            return;
        }

        const inputTranslationUpdaters = {
            [ELEMENT_IDS.INPUT_TRIGGER_WORD]: (value) => dispatch({ type: 'SET_INPUT_TRANSLATION_SETTING', payload: { key: 'triggerWord', value } }),
            [ELEMENT_IDS.INPUT_CONSECUTIVE_KEY]: (value) => dispatch({ type: 'SET_INPUT_TRANSLATION_SETTING', payload: { key: 'consecutiveKey', value } }),
            [ELEMENT_IDS.INPUT_CONSECUTIVE_KEY_PRESSES]: (value) => dispatch({ type: 'SET_INPUT_TRANSLATION_SETTING', payload: { key: 'consecutiveKeyPresses', value: parseInt(value, 10) || 3 } }),
            [ELEMENT_IDS.INPUT_BLACKLIST]: (value) => dispatch({ type: 'SET_INPUT_TRANSLATION_SETTING', payload: { key: 'blacklist', value: value.split('\n').map(item => item.trim()).filter(Boolean) } }),
        };
        if (inputTranslationUpdaters[id]) {
            inputTranslationUpdaters[id](target.value);
        }
    };

    const handleChange = (event) => {
        const target = event.target;
        const id = target.id;
        const value = target.type === 'checkbox' ? target.checked : target.value;

        const stateUpdaters = {
            [ELEMENT_IDS.TRANSLATOR_ENGINE]: (nextValue) => dispatch({ type: 'SET_TRANSLATOR_ENGINE', payload: nextValue }),
            [ELEMENT_IDS.DISPLAY_MODE_SELECT]: (nextValue) => dispatch({ type: 'SET_DISPLAY_MODE', payload: nextValue }),
            [ELEMENT_IDS.TARGET_LANGUAGE]: (nextValue) => dispatch({ type: 'SET_TARGET_LANGUAGE', payload: nextValue }),
            [ELEMENT_IDS.SYNC_ENABLED]: (nextValue) => dispatch({ type: 'SET_SYNC_ENABLED', payload: nextValue }),
            [ELEMENT_IDS.SCROLL_IDLE_TRANSLATION]: (nextValue) => dispatch({ type: 'SET_SCROLL_IDLE_TRANSLATION', payload: nextValue }),
            [ELEMENT_IDS.GLOSSARY_ENABLED]: (nextValue) => dispatch({ type: 'SET_GLOSSARY_ENABLED', payload: nextValue }),
            [ELEMENT_IDS.QUICK_ACTION_PANEL_ENABLED]: (nextValue) => dispatch({ type: 'SET_QUICK_ACTION_PANEL_SETTING', payload: { key: 'enabled', value: nextValue } }),
            [ELEMENT_IDS.QUICK_ACTION_PANEL_SELECTION]: (nextValue) => dispatch({ type: 'SET_QUICK_ACTION_PANEL_SETTING', payload: { key: 'showOnSelection', value: nextValue } }),
        };
        if (stateUpdaters[id]) {
            stateUpdaters[id](value);
            return;
        }

        const inputTranslationSwitchers = {
            [ELEMENT_IDS.INPUT_TRANSLATION_ENABLED]: (nextValue) => dispatch({ type: 'SET_INPUT_TRANSLATION_SETTING', payload: { key: 'enabled', value: nextValue } }),
            [ELEMENT_IDS.INPUT_KEY_TRIGGER_ENABLED]: (nextValue) => dispatch({ type: 'SET_INPUT_TRANSLATION_SETTING', payload: { key: 'keyTriggerEnabled', value: nextValue } }),
            [ELEMENT_IDS.INPUT_TARGET_LANGUAGE]: (nextValue) => dispatch({ type: 'SET_INPUT_TRANSLATION_SETTING', payload: { key: 'targetLanguage', value: nextValue } }),
            [ELEMENT_IDS.INPUT_TRANSLATOR_ENGINE]: (nextValue) => dispatch({ type: 'SET_INPUT_TRANSLATION_SETTING', payload: { key: 'translatorEngine', value: nextValue } }),
        };
        if (inputTranslationSwitchers[id]) {
            inputTranslationSwitchers[id](value);
            return;
        }

        if (id === ELEMENT_IDS.IMPORT_INPUT) {
            actions.importSettings(event);
        }
    };

    return { handleClick, handleInput, handleChange };
}

export function bindOptionsEvents(root, dependencies) {
    const handlers = createOptionsEventHandlers(dependencies);
    root.addEventListener('click', handlers.handleClick);
    root.addEventListener('input', handlers.handleInput);
    root.addEventListener('change', handlers.handleChange);
    return () => {
        root.removeEventListener('click', handlers.handleClick);
        root.removeEventListener('input', handlers.handleInput);
        root.removeEventListener('change', handlers.handleChange);
    };
}
