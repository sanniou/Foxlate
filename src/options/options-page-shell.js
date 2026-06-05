import browser from '../lib/browser-polyfill.js';
import { uiTextLayoutService } from '../common/ui-text-layout-service.js';
import {
    populateLanguageOptions,
    populateDisplayModeOptions,
} from './ui-helpers.js';
import { enhanceThemedSelects } from './components/ThemedSelect.js';

export function applyOptionsTranslations(root = document) {
    document.documentElement.lang = browser.i18n.getUILanguage();

    root.querySelectorAll('[i18n-text]').forEach(element => {
        const key = element.getAttribute('i18n-text');
        const message = browser.i18n.getMessage(key);
        if (message) element.textContent = message;
    });

    root.querySelectorAll('[i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('i18n-placeholder');
        const message = browser.i18n.getMessage(key);
        if (message) element.placeholder = message;
    });

    uiTextLayoutService.applyTree(root);
}

export function initializeOptionsNavigation(elements, {
    root = document,
    win = window,
} = {}) {
    const nav = elements.settingsNav;
    if (!nav) return;

    const switchTab = (hash) => {
        const targetHash = hash || '#general';
        const targetPanelId = targetHash.substring(1);
        const targetPanel = root.getElementById(targetPanelId);
        const targetLink = nav.querySelector(`a[href="${targetHash}"]`);

        nav.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
        root.querySelectorAll('.content-panel').forEach(panel => panel.classList.remove('active'));

        if (targetPanel && targetLink) {
            targetPanel.classList.add('active');
            targetLink.classList.add('active');
            return;
        }

        root.getElementById('general')?.classList.add('active');
        nav.querySelector('a[href="#general"]')?.classList.add('active');
    };

    nav.addEventListener('click', (event) => {
        const link = event.target.closest('.nav-link');
        if (!link) return;

        event.preventDefault();
        const hash = link.getAttribute('href');
        if (win.location.hash !== hash) {
            win.location.hash = hash;
        }
    });

    win.addEventListener('hashchange', () => switchTab(win.location.hash));
    switchTab(win.location.hash);
}

export function initializeOptionsControls(elements, root = document) {
    populateLanguageOptions(elements.targetLanguage);
    populateDisplayModeOptions(elements.displayModeSelect);
    enhanceThemedSelects(root);
}

export function createStatusMessenger(elements) {
    let statusMessageTimeout;

    return (message, isError = false) => {
        if (statusMessageTimeout) clearTimeout(statusMessageTimeout);
        elements.statusMessage.textContent = message;
        elements.statusMessage.className = 'toast';
        elements.statusMessage.classList.add(isError ? 'error' : 'success', 'visible');
        statusMessageTimeout = setTimeout(() => {
            elements.statusMessage.classList.remove('visible');
        }, 3000);
    };
}
