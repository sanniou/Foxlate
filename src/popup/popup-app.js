import browser from '../lib/browser-polyfill.js';
import { queryPopupElements } from './popup-elements.js';
import { PopupRenderer } from './popup-renderer.js';
import { PopupActions } from './popup-actions.js';
import { bindPopupEvents } from './popup-events.js';

export class PopupApp {
    constructor({ documentRef = document, browserApi = browser } = {}) {
        this.document = documentRef;
        this.browser = browserApi;
        this.elements = queryPopupElements(this.document);
        this.state = {
            activeTabId: null,
            currentHostname: null,
            currentRuleSource: 'default',
        };
        this.renderer = new PopupRenderer(this.elements, { browserApi: this.browser });
        this.actions = new PopupActions({
            elements: this.elements,
            renderer: this.renderer,
            state: this.state,
            browserApi: this.browser,
        });
    }

    async initialize() {
        this.renderer.applyTranslations(this.document);
        this.renderer.renderVersion(this.browser.runtime.getManifest().version);
        this.renderer.populateStaticSelects();
        await this.actions.loadAndApplySettings();
        bindPopupEvents({
            elements: this.elements,
            actions: this.actions,
            browserApi: this.browser,
        });
    }
}

export function bootPopupApp() {
    document.addEventListener('DOMContentLoaded', () => {
        const app = new PopupApp();
        app.initialize();
    });
}
