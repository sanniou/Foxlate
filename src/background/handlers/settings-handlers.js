import { MESSAGE_TYPES } from '../../common/message-types.js';

/**
 * 设置读写类消息处理器。
 * 只做「取值 / 落值」，不做业务判断——域规则合并全部收敛在
 * `settingsManager.getEffectiveSettings()` 背后的纯函数里。
 */
export function createSettingsHandlers({ settingsManager }) {
    return {
        async [MESSAGE_TYPES.GET_EFFECTIVE_SETTINGS](request) {
            return settingsManager.getEffectiveSettings(request.payload.hostname);
        },

        async [MESSAGE_TYPES.GET_VALIDATED_SETTINGS]() {
            return settingsManager.getValidatedSettings();
        },

        async [MESSAGE_TYPES.SAVE_RULE_CHANGE](request) {
            const { hostname, ruleSource, key, value } = request.payload;
            if (!hostname || !key) throw new Error('Missing hostname or key for SAVE_RULE_CHANGE');
            await settingsManager.saveDomainRuleProperty(ruleSource === 'default' ? hostname : ruleSource, key, value);
            return { success: true };
        },
    };
}
