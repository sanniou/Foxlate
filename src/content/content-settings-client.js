import browser from '../lib/browser-polyfill.js';
import { MESSAGE_TYPES } from '../common/message-types.js';

export function createEffectiveSettingsGetter({
    browserApi = browser,
    win = window,
} = {}) {
    return async function getEffectiveSettings() {
        return browserApi.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_EFFECTIVE_SETTINGS,
            payload: { hostname: win.location.hostname },
        });
    };
}
