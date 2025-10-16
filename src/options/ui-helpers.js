import browser from '../lib/browser-polyfill.js';
import * as Constants from '../common/constants.js';
import { SUBTITLE_STRATEGIES } from '../content/subtitle/strategy-manifest.js';

/**
 * Populates a select element with translator engine options.
 * @param {HTMLSelectElement} selectElement - The select element to populate.
 * @param {object} options - Configuration options.
 * @param {boolean} [options.includeDefault=false] - Whether to include a "Default" option.
 * @param {string|null} [options.excludeId=null] - An AI engine ID to exclude.
 * @param {boolean} [options.onlyAi=false] - Whether to only include AI engines.
 * @param {Array<object>} [options.allEngines=[]] - The list of all available AI engines.
 */
export function populateEngineSelect(selectElement, { includeDefault = false, excludeId = null, onlyAi = false, allEngines = [] } = {}) {
    if (!selectElement) return;
    const currentValue = selectElement.value;
    selectElement.innerHTML = '';

    if (includeDefault) {
        addOption(selectElement, browser.i18n.getMessage('useDefaultSetting'), 'default');
    }

    if (!onlyAi) {
        for (const key in Constants.SUPPORTED_ENGINES) {
            addOption(selectElement, browser.i18n.getMessage(Constants.SUPPORTED_ENGINES[key]), key);
        }
    }

    if (allEngines) {
        allEngines.forEach(engine => {
            if (engine.id !== excludeId) {
                addOption(selectElement, engine.name, `ai:${engine.id}`);
            }
        });
    }

    if (Array.from(selectElement.options).some(opt => opt.value === currentValue)) {
        selectElement.value = currentValue;
    } else if (selectElement.options.length > 0) {
        selectElement.value = selectElement.options[0].value;
    }
}

/**
 * Populates a select element with supported languages.
 * @param {HTMLSelectElement} selectElement - The select element to populate.
 * @param {object} options - Configuration options.
 * @param {boolean} [options.includeDefault=false] - Whether to include a "Default" option.
 * @param {boolean} [options.includeAuto=false] - Whether to include an "Auto-detect" option.
 */
export function populateLanguageOptions(selectElement, { includeDefault = false, includeAuto = false } = {}) {
    if (!selectElement) return;    
    const currentValue = selectElement.value;
    selectElement.innerHTML = '';

    if (includeDefault) {
        addOption(selectElement, browser.i18n.getMessage('useDefaultSetting'), 'default');
    }
    if (includeAuto) {
        addOption(selectElement, browser.i18n.getMessage(Constants.SUPPORTED_LANGUAGES['auto']), 'auto');
    }

    for (const code in Constants.SUPPORTED_LANGUAGES) {
        if (code === 'auto') continue;
        addOption(selectElement, browser.i18n.getMessage(Constants.SUPPORTED_LANGUAGES[code]) || code, code);
    }

    if (Array.from(selectElement.options).some(opt => opt.value === currentValue)) {
        selectElement.value = currentValue;
    } else if (selectElement.options.length > 0) {
        selectElement.value = selectElement.options[0].value;
    }
}

/**
 * Populates a select element with auto-translate modes.
 * @param {HTMLSelectElement} selectElement - The select element to populate.
 * @param {boolean} [includeDefault=false] - Whether to include a "Default" option.
 */
export function populateAutoTranslateOptions(selectElement, includeDefault = false) {
    populateOptionsFromMap(selectElement, Constants.AUTO_TRANSLATE_MODES, includeDefault);
}

/**
 * Populates a select element with display modes.
 * @param {HTMLSelectElement} selectElement - The select element to populate.
 * @param {boolean} [includeDefault=false] - Whether to include a "Default" option.
 */
export function populateDisplayModeOptions(selectElement, includeDefault = false) {
    if (!selectElement) return;
    selectElement.innerHTML = '';
    if (includeDefault) {
        addOption(selectElement, browser.i18n.getMessage('useDefaultSetting'), 'default');
    }
    for (const code in Constants.DISPLAY_MODES) {
        addOption(selectElement, browser.i18n.getMessage(Constants.DISPLAY_MODES[code].optionsKey) || code, code);
    }
}

/**
 * Populates a select element with subtitle display modes.
 * @param {HTMLSelectElement} selectElement - The select element to populate.
 */
export function populateSubtitleDisplayModeOptions(selectElement) {
    populateOptionsFromMap(selectElement, Constants.SUBTITLE_DISPLAY_MODES, false);
}

/**
 * Populates a select element with subtitle strategies.
 * @param {HTMLSelectElement} selectElement - The select element to populate.
 */
export function populateSubtitleStrategyOptions(selectElement) {
    if (!selectElement) return;
    selectElement.innerHTML = '';
    addOption(selectElement, browser.i18n.getMessage('subtitleStrategyNone') || '不使用', 'none');
    SUBTITLE_STRATEGIES.forEach(strategy => {
        const displayName = strategy.displayName || (strategy.name.charAt(0).toUpperCase() + strategy.name.slice(1));
        addOption(selectElement, displayName, strategy.name);
    });
}

/**
 * A generic helper to populate a select element from a map object.
 * @param {HTMLSelectElement} selectElement - The select element to populate.
 * @param {object} map - The object map { value: messageKey }.
 * @param {boolean} [includeDefault=false] - Whether to include a "Default" option.
 */
function populateOptionsFromMap(selectElement, map, includeDefault = false) {
    if (!selectElement) return;
    selectElement.innerHTML = '';
    if (includeDefault) {
        addOption(selectElement, browser.i18n.getMessage('useDefaultSetting'), 'default');
    }
    for (const code in map) {
        addOption(selectElement, browser.i18n.getMessage(map[code]) || code, code);
    }
}

/**
 * Adds a single option to a select element.
 * @param {HTMLSelectElement} select - The select element.
 * @param {string} text - The text content of the option.
 * @param {string} value - The value of the option.
 */
function addOption(select, text, value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
}
