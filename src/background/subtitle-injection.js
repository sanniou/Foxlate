import { SettingsManager } from '../common/settings-manager.js';
import {
    DEFAULT_STRATEGY_MAP,
    SUBTITLE_MANAGER_SCRIPT,
    SUBTITLE_STRATEGIES,
} from '../content/subtitle/strategy-manifest.js';

const STRATEGY_FILE_MAP = new Map(
    SUBTITLE_STRATEGIES.map(strategy => [strategy.name, strategy.file])
);

export function createSubtitleInjector({
    ensureScriptsInjected,
    logError,
    settingsManager = SettingsManager,
}) {
    return async function handleSubtitleInjection(tabId, frameId, url) {
        if (frameId !== 0 || !url || !url.startsWith('http')) {
            return;
        }

        try {
            const currentUrl = new URL(url);
            const hostname = currentUrl.hostname;
            const settings = await settingsManager.getValidatedSettings();
            const userRules = settings.domainRules || {};

            let strategyToInject = null;
            if (userRules[hostname]?.subtitleStrategy) {
                const userChoice = userRules[hostname].subtitleStrategy;
                if (userChoice === 'none') {
                    console.log(`[Subtitle Injector] User has disabled subtitle translation for ${hostname}.`);
                    return;
                }
                strategyToInject = userChoice;
            } else if (DEFAULT_STRATEGY_MAP.has(hostname)) {
                strategyToInject = DEFAULT_STRATEGY_MAP.get(hostname);
            }

            if (!strategyToInject) return;

            const scriptFile = STRATEGY_FILE_MAP.get(strategyToInject);
            if (!scriptFile) {
                logError('handleSubtitleInjection', new Error(`Strategy '${strategyToInject}' is defined but no script file was found.`));
                return;
            }

            console.log(`[Subtitle Injector] Rule matched. Attempting to inject strategy '${strategyToInject}' for ${hostname}.`);
            await ensureScriptsInjected(tabId, frameId, [SUBTITLE_MANAGER_SCRIPT, scriptFile]);
        } catch (error) {
            logError('handleSubtitleInjection', error);
        }
    };
}
