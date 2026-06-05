import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { SettingsManager } from '../common/settings-manager.js';
import { shouldTranslate } from '../common/precheck.js';
import * as Constants from '../common/constants.js';
import { TranslatorManager } from './translator-manager.js';

export function createBackgroundMessageHandlers({
    browserApi = browser,
    settingsManager = SettingsManager,
    translatorManager = TranslatorManager,
    tabStateManager,
    ensureScriptsInjected,
    setBadgeAndState,
    cloudBackups,
    logError,
    cssFiles,
    coreScriptFiles,
}) {
    return {
        async [MESSAGE_TYPES.TRANSLATE_TEXT](request, sender) {
            const { text, targetLang, sourceLang, elementId, translatorEngine, tabId } = request.payload;
            const originTabId = sender.tab?.id || tabId;

            if (!originTabId || !elementId) {
                logError('TRANSLATE_TEXT', new Error('Invalid TRANSLATE_TEXT call: Missing originTabId or elementId. This handler is for content scripts only.'));
                return;
            }

            try {
                const result = await translatorManager.translateText(text, targetLang, sourceLang, translatorEngine, originTabId);
                await browserApi.tabs.sendMessage(originTabId, {
                    type: MESSAGE_TYPES.TRANSLATE_TEXT_RESULT,
                    payload: {
                        elementId,
                        success: !result.error,
                        translatedText: result.text,
                        wasTranslated: result.translated,
                        error: result.error || null,
                    },
                });
            } catch (error) {
                logError('TRANSLATE_TEXT (execution)', error);
                try {
                    await browserApi.tabs.sendMessage(originTabId, {
                        type: MESSAGE_TYPES.TRANSLATE_TEXT_RESULT,
                        payload: { elementId, success: false, translatedText: '', wasTranslated: false, error: error.message },
                    });
                } catch (sendError) {
                    if (!sendError.message.includes('Receiving end does not exist')) {
                        logError('TRANSLATE_TEXT (sending error)', sendError);
                    }
                }
            }
        },

        async [MESSAGE_TYPES.TRANSLATE_TEXT_BATCH](request, sender) {
            const { batchId, items, targetLang, sourceLang = 'auto', translatorEngine, tabId } = request.payload;
            const originTabId = sender.tab?.id || tabId;

            if (!originTabId || !Array.isArray(items)) {
                logError('TRANSLATE_TEXT_BATCH', new Error('Invalid TRANSLATE_TEXT_BATCH call: Missing originTabId or items.'));
                return;
            }

            try {
                const texts = items.map(item => item.text);
                const results = await translatorManager.translateBatch(texts, targetLang, sourceLang, translatorEngine, originTabId);
                await browserApi.tabs.sendMessage(originTabId, {
                    type: MESSAGE_TYPES.TRANSLATE_TEXT_BATCH_RESULT,
                    payload: {
                        batchId,
                        items: items.map((item, index) => {
                            const result = results[index] || {};
                            return {
                                elementId: item.elementId,
                                success: !result.error,
                                translatedText: result.text || '',
                                wasTranslated: !!result.translated,
                                error: result.error || null,
                            };
                        }),
                    },
                });
            } catch (error) {
                logError('TRANSLATE_TEXT_BATCH (execution)', error);
                try {
                    await browserApi.tabs.sendMessage(originTabId, {
                        type: MESSAGE_TYPES.TRANSLATE_TEXT_BATCH_RESULT,
                        payload: {
                            batchId,
                            items: items.map(item => ({
                                elementId: item.elementId,
                                success: false,
                                translatedText: '',
                                wasTranslated: false,
                                error: error.message,
                            })),
                        },
                    });
                } catch (sendError) {
                    if (!sendError.message.includes('Receiving end does not exist')) {
                        logError('TRANSLATE_TEXT_BATCH (sending error)', sendError);
                    }
                }
            }
        },

        async [MESSAGE_TYPES.TEST_TRANSLATE_TEXT](request) {
            const { text, targetLang, sourceLang, translatorEngine } = request.payload;
            const result = await translatorManager.translateText(text, targetLang, sourceLang, translatorEngine);
            return {
                success: !result.error,
                translatedText: { text: result.text, translated: result.translated },
                error: result.error || null,
                log: result.log || [],
            };
        },

        async [MESSAGE_TYPES.TRANSLATE_BATCH](request) {
            const { texts, targetLanguage, translatorEngine, hostname } = request.payload;
            if (!Array.isArray(texts)) {
                throw new Error("Invalid payload: 'texts' must be an array.");
            }

            let finalTargetLang = targetLanguage;
            let finalEngine = translatorEngine;
            if (!finalTargetLang || !finalEngine) {
                const settings = await settingsManager.getEffectiveSettings(hostname);
                finalTargetLang = finalTargetLang || settings.targetLanguage;
                finalEngine = finalEngine || settings.translatorEngine;
            }

            const results = await translatorManager.translateBatch(texts, finalTargetLang, 'auto', finalEngine);
            return { success: true, translatedTexts: results.map(result => result.text) };
        },

        async [MESSAGE_TYPES.SUMMARIZE_CONTENT](request, sender) {
            const { text, aiModel, targetLang } = request.payload;
            return translatorManager.summarize(text, aiModel, targetLang, sender.tab?.id);
        },

        async [MESSAGE_TYPES.CONVERSE_WITH_AI](request, sender) {
            const { history, aiModel, targetLang } = request.payload;
            return translatorManager.converse(history, aiModel, targetLang, sender.tab?.id);
        },

        async [MESSAGE_TYPES.INFER_SUGGESTIONS](request, sender) {
            const { history, aiModel, targetLang } = request.payload;
            const result = await translatorManager.inferSuggestions(history, aiModel, targetLang, sender.tab?.id);
            if (!result.success) return result;

            try {
                if (!Array.isArray(result.suggestions)) {
                    throw new Error('AI did not return a JSON array of suggestions.');
                }
                return { success: true, suggestions: result.suggestions };
            } catch (parseError) {
                logError('INFER_SUGGESTIONS (JSON parse)', parseError);
                return { success: true, suggestions: [result.text] };
            }
        },

        async [MESSAGE_TYPES.TRANSLATE_INPUT_TEXT](request, sender) {
            const { text, targetLang } = request.payload;
            const tabId = sender.tab?.id;
            const tabUrl = sender.tab?.url;
            if (!tabId || !tabUrl) {
                logError('translateInputText', new Error('Request must come from a tab with a URL.'));
                return { success: false, error: 'Invalid sender context.' };
            }

            try {
                const hostname = new URL(tabUrl).hostname;
                const effectiveRule = await settingsManager.getEffectiveSettings(hostname);
                const inputSettings = effectiveRule.inputTranslationSettings || {};
                const finalTargetLang = targetLang || (inputSettings.targetLanguage !== 'auto' ? inputSettings.targetLanguage : effectiveRule.targetLanguage);
                const finalEngine = inputSettings.translatorEngine !== 'default' ? inputSettings.translatorEngine : effectiveRule.translatorEngine;
                const result = await translatorManager.translateText(text, finalTargetLang, 'auto', finalEngine, tabId);
                return { success: !result.error, translatedText: result.text, error: result.error || null };
            } catch (error) {
                logError('translateInputText (execution)', error);
                return { success: false, error: error.message };
            }
        },

        async [MESSAGE_TYPES.TEST_CONNECTION](request) {
            const { engine, settings, text } = request.payload;
            if (engine !== 'ai') {
                return { success: false, error: `Connection test is only supported for AI engines, but got: ${engine}` };
            }
            const { AITranslator } = await import('../background/translators/ai-translator.js');
            const translator = new AITranslator();
            try {
                const result = await translator.translate(text, 'EN', 'auto', settings);
                return { success: true, translatedText: { text: result.text, translated: true } };
            } catch (error) {
                logError('TEST_CONNECTION handler', error);
                return { success: false, error: error.message };
            }
        },

        async [MESSAGE_TYPES.GET_EFFECTIVE_SETTINGS](request) {
            return settingsManager.getEffectiveSettings(request.payload.hostname);
        },

        async [MESSAGE_TYPES.GET_VALIDATED_SETTINGS]() {
            return settingsManager.getValidatedSettings();
        },

        async [MESSAGE_TYPES.TOGGLE_TRANSLATION_REQUEST](request) {
            const { tabId } = request.payload;
            console.log('[Foxlate] TOGGLE_TRANSLATION_REQUEST: Received from background script.', tabId);
            const scriptsReady = await ensureScriptsInjected(tabId, 0, [...cssFiles, ...coreScriptFiles]);
            if (!scriptsReady) {
                await setBadgeAndState(tabId, 'original');
                throw new Error(`Failed to inject scripts into tab ${tabId}.`);
            }
            await browserApi.tabs.sendMessage(tabId, {
                type: MESSAGE_TYPES.TOGGLE_TRANSLATION_REQUEST_AT_CONTENT,
                payload: { tabId },
            });
            return { success: true };
        },

        async [MESSAGE_TYPES.TOGGLE_DISPLAY_MODE](request) {
            const { tabId, hostname } = request.payload;
            if (!tabId || !hostname) throw new Error('Missing tabId or hostname for TOGGLE_DISPLAY_MODE');

            const displayModes = Object.keys(Constants.DISPLAY_MODES);
            const effectiveSettings = await settingsManager.getEffectiveSettings(hostname);
            const currentIndex = displayModes.indexOf(effectiveSettings.displayMode);
            const newMode = displayModes[(currentIndex + 1) % displayModes.length];

            await settingsManager.saveDomainRuleProperty(
                effectiveSettings.source === 'default' ? hostname : effectiveSettings.source,
                'displayMode',
                newMode
            );

            try {
                await browserApi.tabs.sendMessage(tabId, {
                    type: MESSAGE_TYPES.UPDATE_DISPLAY_MODE,
                    payload: { displayMode: newMode },
                });
            } catch (error) {
                if (!error.message.includes('Receiving end does not exist')) {
                    logError('TOGGLE_DISPLAY_MODE (sending update)', error);
                }
            }

            return { success: true, newMode };
        },

        async [MESSAGE_TYPES.SAVE_RULE_CHANGE](request) {
            const { hostname, ruleSource, key, value } = request.payload;
            if (!hostname || !key) throw new Error('Missing hostname or key for SAVE_RULE_CHANGE');
            await settingsManager.saveDomainRuleProperty(ruleSource === 'default' ? hostname : ruleSource, key, value);
            return { success: true };
        },

        async [MESSAGE_TYPES.UPDATE_SUBTITLE_TRANSLATION_STATUS](request) {
            const { tabId, enabled } = request.payload;
            try {
                await browserApi.action.setIcon({ tabId, path: enabled ? 'icons/icon48.png' : 'icons/icon48-disabled.png' });
                await browserApi.action.setTitle({ tabId, title: enabled ? 'Foxlate (Subtitles Enabled)' : 'Foxlate (Subtitles Disabled)' });
            } catch (error) {
                logError('UPDATE_SUBTITLE_TRANSLATION_STATUS', error);
            }
            return { success: true };
        },

        async [MESSAGE_TYPES.STOP_TRANSLATION]() {
            await translatorManager.interruptAll();
            return { success: true };
        },

        async [MESSAGE_TYPES.TRANSLATION_STATUS_UPDATE](request, sender) {
            const { status, tabId } = request.payload;
            if (!tabId) {
                logError('TRANSLATION_STATUS_UPDATE', new Error('Missing tabId in status update payload.'));
                return { success: true };
            }

            await setBadgeAndState(tabId, status);
            if (sender.tab?.url) {
                try {
                    const hostname = new URL(sender.tab.url).hostname;
                    if (status === 'translated' || status === 'loading') {
                        await tabStateManager.registerTabForAutoTranslation(tabId, hostname);
                    } else if (status === 'original') {
                        await tabStateManager.unregisterTabForAutoTranslation(tabId);
                    }
                } catch (error) {
                    logError('TRANSLATION_STATUS_UPDATE (session management)', error);
                }
            }
            return { success: true };
        },

        [MESSAGE_TYPES.PING]() {
            return { status: 'PONG' };
        },

        [MESSAGE_TYPES.GET_TAB_ID](_request, sender) {
            if (sender.tab) {
                return Promise.resolve({ tabId: sender.tab.id });
            }
            return browserApi.tabs.query({ active: true, currentWindow: true }).then(([tab]) => ({ tabId: tab?.id }));
        },

        async [MESSAGE_TYPES.GET_CACHE_INFO]() {
            return translatorManager.getCacheInfo();
        },

        async [MESSAGE_TYPES.CLEAR_CACHE]() {
            await translatorManager.clearCache();
            return { success: true };
        },

        async [MESSAGE_TYPES.GET_CLOUD_BACKUPS]() {
            return cloudBackups.list();
        },

        async [MESSAGE_TYPES.UPLOAD_SETTINGS_TO_CLOUD](request) {
            return cloudBackups.upload(request.payload);
        },

        async [MESSAGE_TYPES.DOWNLOAD_SETTINGS_FROM_CLOUD](request) {
            return cloudBackups.download(request.payload.backupId);
        },

        async [MESSAGE_TYPES.DELETE_CLOUD_BACKUP](request) {
            return cloudBackups.delete(request.payload.backupId);
        },
    };
}
