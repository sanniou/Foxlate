import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';
import { shouldTranslate } from '../common/precheck.js';

/** Shared selection geometry for quick-action / context-menu / shortcut. */
export function getSelectionPayload(win = window) {
    const selection = win.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text || selection.rangeCount === 0) {
        return null;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
        return null;
    }

    return {
        text,
        coords: {
            clientX: rect.left + rect.width / 2,
            clientY: rect.bottom + 10,
        },
    };
}

/**
 * Single content-side path for selection translation display + I/O.
 * Used by quick-action and by SW-forwarded context menu / shortcut.
 */
export async function translateSelectionPayload({
    browserApi = browser,
    win = window,
    displaySelectionTranslation,
    selectionPayload,
    source = 'selection',
    getEffectiveSettings,
} = {}) {
    if (!selectionPayload?.text?.trim() || typeof displaySelectionTranslation !== 'function') {
        return { success: false, error: 'No selection' };
    }

    const translationId = `sel-${Date.now()}`;
    const basePayload = {
        translationId,
        coords: selectionPayload.coords,
        source,
        originalText: selectionPayload.text,
    };

    displaySelectionTranslation({ ...basePayload, isLoading: true });

    try {
        // Match SW path: skip network when precheck says no.
        if (typeof getEffectiveSettings === 'function') {
            const settings = await getEffectiveSettings();
            const precheck = shouldTranslate(selectionPayload.text, settings, false);
            if (!precheck.result) {
                displaySelectionTranslation({
                    ...basePayload,
                    success: true,
                    translatedText: selectionPayload.text,
                    error: null,
                });
                return { success: true, skipped: true };
            }
        }

        const response = await browserApi.runtime.sendMessage({
            type: MESSAGE_TYPES.TRANSLATE_BATCH,
            payload: {
                texts: [selectionPayload.text],
                hostname: win.location.hostname,
            },
        });
        const translatedText = response?.translatedTexts?.[0] || selectionPayload.text;
        const success = response?.success !== false;
        displaySelectionTranslation({
            ...basePayload,
            success,
            translatedText,
            error: success ? null : (response?.error || 'Translation failed'),
        });
        return { success, translatedText };
    } catch (error) {
        displaySelectionTranslation({
            ...basePayload,
            success: false,
            error: error.message,
        });
        return { success: false, error: error.message };
    }
}
