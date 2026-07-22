import { MESSAGE_TYPES } from '../common/message-types.js';

async function getSelectionDetailsFromTab({
    browserApi,
    logError,
}, tabId, frameId) {
    try {
        const injectionResults = await browserApi.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            func: () => {
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    return {
                        text: selection.toString(),
                        coords: {
                            clientX: rect.left + rect.width / 2,
                            clientY: rect.bottom + 10,
                        },
                    };
                }
                return null;
            },
        });
        return injectionResults?.[0]?.result || null;
    } catch (error) {
        logError('getSelectionDetailsFromTab', error);
        return null;
    }
}

/**
 * SW only finds the frame + injects scripts, then hands off to content
 * `translateSelectionPayload` (single display/I/O path).
 */
export function createSelectionTranslationHandler({
    browserApi,
    ensureScriptsInjected,
    logError,
    cssFiles,
    coreScriptFiles,
}) {
    return async function handleSelectionTranslation(tab, source, frameId) {
        let targetFrameId = frameId;

        if (typeof targetFrameId !== 'number') {
            const results = await browserApi.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => window.getSelection().toString().trim() ? window.getSelection().toString() : null,
            });

            const frameWithSelection = results.find(result => result.result);
            if (!frameWithSelection) {
                console.log('No text selected in any frame.');
                return;
            }
            targetFrameId = frameWithSelection.frameId;
        }

        const scriptsReady = await ensureScriptsInjected(tab.id, targetFrameId, [...cssFiles, ...coreScriptFiles]);
        if (!scriptsReady) {
            logError('handleSelectionTranslation', new Error(`Could not inject scripts into tab ${tab.id}, frame ${targetFrameId}.`));
            return;
        }

        const selectionDetails = await getSelectionDetailsFromTab({ browserApi, logError }, tab.id, targetFrameId);
        if (!selectionDetails?.text?.trim()) {
            console.log('No text selected or could not retrieve selection.');
            return;
        }

        try {
            await browserApi.tabs.sendMessage(tab.id, {
                type: MESSAGE_TYPES.TRANSLATE_SELECTION_REQUEST,
                payload: {
                    text: selectionDetails.text,
                    coords: selectionDetails.coords,
                    source: source || 'contextMenu',
                },
            }, { frameId: targetFrameId });
        } catch (error) {
            logError('handleSelectionTranslation (content handoff)', error);
        }
    };
}
