import { SettingsManager } from '../common/settings-manager.js';
import {
    DEFAULT_STRATEGY_MAP,
    SUBTITLE_MANAGER_SCRIPT,
    SUBTITLE_STRATEGIES,
} from '../common/subtitle-strategy-manifest.js';

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
            // 域名规则的叠加只有一处权威实现：`settingsManager.getEffectiveSettings()` →
            // `resolveEffectiveSettings`（最长后缀匹配 + applyToSubdomains）。
            // 这里曾自己遍历 `domainRules[hostname]`（精确等值匹配）并读一个全仓库零写入的
            // 幽灵字段 `subtitleStrategy`，于是站点规则既命不中子域，也永远读不到真正的
            // `subtitleSettings.strategy` —— 用户选「不使用」等于没选。
            const effective = await settingsManager.getEffectiveSettings(hostname);
            const subtitleSettings = effective?.subtitleSettings || {};

            // `enabled:false` 与 `strategy:'none'` 是同一个意思的两种写法（选项页把
            // 「不使用」写成 strategy:'none' 且把 enabled 置真，因为规则本身存在就代表用户
            // 已经配置过这个站点）。两者都必须短路，否则 'none' 会掉进默认表又注一次。
            if (subtitleSettings.enabled === false || subtitleSettings.strategy === 'none') {
                console.log(`[Subtitle Injector] Subtitle translation is off for ${hostname}.`);
                return;
            }

            const strategyToInject = subtitleSettings.strategy || DEFAULT_STRATEGY_MAP.get(hostname);

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
