import { MESSAGE_TYPES } from '../common/message-types.js';
import { SettingsManager } from '../common/settings-manager.js';
import { shouldTranslate } from '../common/precheck.js';
import { TranslatorManager } from './translator-manager.js';

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

export function createSelectionTranslationHandler({
    browserApi,
    ensureScriptsInjected,
    logError,
    settingsManager = SettingsManager,
    translatorManager = TranslatorManager,
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

        const { text: selectionText, coords } = selectionDetails;
        const translationId = `sel-${Date.now()}`;
        const basePayload = { coords, source, translationId, originalText: selectionText };

        browserApi.tabs.sendMessage(tab.id, {
            type: MESSAGE_TYPES.DISPLAY_SELECTION_TRANSLATION,
            payload: { ...basePayload, isLoading: true },
        }, { frameId: targetFrameId }).catch(error => logError('handleSelectionTranslation (Send Loading)', error));

        let resultPayload;
        try {
            const hostname = new URL(tab.url).hostname;
            const effectiveRule = await settingsManager.getEffectiveSettings(hostname);
            const precheckResult = shouldTranslate(selectionText, effectiveRule, true);

            if (!precheckResult.result) {
                console.log(`[Foxlate] Pre-check failed for selection: "${selectionText}". Reason:`, precheckResult.log?.join(' '));
                resultPayload = {
                    success: true,
                    translatedText: selectionText,
                    error: null,
                };
            } else {
                const result = await translatorManager.translateText(
                    selectionText,
                    effectiveRule.targetLanguage,
                    'auto',
                    effectiveRule.translatorEngine,
                    tab.id
                );
                resultPayload = {
                    success: !result.error,
                    translatedText: result.text,
                    error: result.error,
                };
            }
        } catch (error) {
            logError('handleSelectionTranslation (Translation Process)', error);
            resultPayload = {
                success: false,
                error: error.message,
            };
        }

        browserApi.tabs.sendMessage(tab.id, {
            type: MESSAGE_TYPES.DISPLAY_SELECTION_TRANSLATION,
            payload: { ...basePayload, ...resultPayload },
        }, { frameId: targetFrameId }).catch(error => logError('handleSelectionTranslation (Send Result)', error));
    };
}
