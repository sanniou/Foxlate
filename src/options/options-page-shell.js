import browser from '../lib/browser-polyfill.js';
import { applyI18nAttributes } from '../common/i18n-dom.js';
import { uiTextLayoutService } from '../common/ui-text-layout-service.js';
import {
    populateLanguageOptions,
    populateDisplayModeOptions,
} from './ui-helpers.js';
import { enhanceThemedSelects } from './components/ThemedSelect.js';
import { ELEMENT_IDS } from './ui-constants.js';

export function applyOptionsTranslations(root = document) {
    document.documentElement.lang = browser.i18n.getUILanguage();
    applyI18nAttributes(root);
    uiTextLayoutService.applyTree(root);
}

export function initializeOptionsNavigation(elements, {
    root = document,
    win = window,
} = {}) {
    const nav = elements.settingsNav;
    if (!nav) return;

    /**
     * 按 href 属性找导航链接。
     *
     * 不用 `querySelector(`a[href="${hash}"]`)`：`hash` 来自 `location.hash`，
     * 外部链接或用户手改地址栏都可能带动引号、反斜杠等字符，
     * 拼进选择器会直接抛 DOMException，把整块导航切到无法工作。
     */
    const findNavLink = (hash) => [...nav.querySelectorAll('a[href]')]
        .find(link => link.getAttribute('href') === hash);

    const switchTab = (hash) => {
        const targetHash = hash || '#general';
        const targetPanelId = targetHash.substring(1);
        const targetPanel = root.getElementById(targetPanelId);
        const targetLink = findNavLink(targetHash);

        nav.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
        root.querySelectorAll('.content-panel').forEach(panel => panel.classList.remove('active'));

        if (targetPanel && targetLink) {
            targetPanel.classList.add('active');
            targetLink.classList.add('active');
            return;
        }

        root.getElementById(ELEMENT_IDS.GENERAL_PANEL)?.classList.add('active');
        findNavLink(`#${ELEMENT_IDS.GENERAL_PANEL}`)?.classList.add('active');
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
