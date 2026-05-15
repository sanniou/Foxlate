import browser from '../lib/browser-polyfill.js';
import TabStateManager from './tab-state-manager.js';

function defaultLogError(context, error) {
    if (error instanceof Error) {
        console.error(`[Foxlate Error] in ${context}:`, error.message, error.stack);
    } else {
        console.error(`[Foxlate Error] in ${context}:`, error || 'An unknown error occurred.');
    }
}

/**
 * Creates a frame resource injector with injectable dependencies for tests.
 *
 * @param {object} dependencies
 * @param {object} dependencies.browserApi
 * @param {object} dependencies.tabStateManager
 * @param {Function} dependencies.logError
 * @returns {(tabId: number, frameId: number, filesToInject: string[]) => Promise<boolean>}
 */
export function createEnsureScriptsInjected({
    browserApi = browser,
    tabStateManager = TabStateManager,
    logError = defaultLogError,
} = {}) {
    return async function ensureScriptsInjected(tabId, frameId, filesToInject) {
        if (!filesToInject?.length) {
            return true;
        }

        const uniqueFiles = [...new Set(filesToInject)];

        const allFilesInjected = await tabStateManager.isFrameInjected(tabId, frameId, uniqueFiles);
        if (allFilesInjected) {
            return true;
        }

        try {
            const filesMissing = [];
            for (const file of uniqueFiles) {
                const fileInjected = await tabStateManager.isFrameInjected(tabId, frameId, [file]);
                if (!fileInjected) {
                    filesMissing.push(file);
                }
            }

            const cssToInject = filesMissing.filter(file => file.endsWith('.css'));
            const jsToInject = filesMissing.filter(file => file.endsWith('.js'));

            if (cssToInject.length > 0) {
                await browserApi.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, files: cssToInject });
            }
            if (jsToInject.length > 0) {
                await browserApi.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: jsToInject });
            }

            await tabStateManager.markFrameAsInjected(tabId, frameId, filesMissing);

            return true;
        } catch (error) {
            logError(
                `ensureScriptsInjected for tab ${tabId}, frame ${frameId}`,
                new Error(`Failed to inject scripts. This can happen on special pages (e.g., chrome://). Error: ${error.message}`)
            );
            return false;
        }
    };
}
