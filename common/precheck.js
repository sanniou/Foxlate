// This file is intended to be used by both module and non-module scripts.
// It attaches the shouldTranslate function to the global window object.

// Ensure the function is only defined once.
if (typeof window.shouldTranslate !== 'function') {
    /**
     * 根据预检查规则判断一个文本字符串是否应该被翻译。
     * @param {string} text - 要检查的文本。
     * @param {object} settings - 包含 precheckRules 和 targetLanguage 的有效设置对象。
     * @returns {{result: boolean, log: string[]}} An object containing the translation decision and a detailed log.
     */
    window.shouldTranslate = function(text, settings) {
        const log = [];
        log.push(browser.i18n.getMessage('logEntryPrecheckStart'));

        const rules = settings.precheckRules;
        const targetLang = settings.targetLanguage;

        // 1. 优先检查所有黑名单规则 (包括 'general' 和特定语言的)
        // This ensures that universal exclusions like pure symbols (e.g., '🎨') are caught first.
        if (rules) {
            // 创建一个排序后的类别列表，以确保 'general' 总是最先被检查。
            const categories = Object.keys(rules);
            const sortedCategories = ['general', ...categories.filter(c => c !== 'general').sort()];

            for (const category of sortedCategories) {
                if (rules[category]) {
                    for (const rule of rules[category]) {
                        if (rule.enabled && rule.mode === 'blacklist') {
                            try {
                                if (new RegExp(rule.regex, rule.flags).test(text)) {
                                    log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [rule.name, 'blacklist']));
                                    log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                                    return { result: false, log: log };
                                } else {
                                    log.push(browser.i18n.getMessage('logEntryPrecheckNoMatch', [rule.name, 'blacklist']));
                                }
                            } catch (e) {
                                log.push(browser.i18n.getMessage('logEntryPrecheckRuleError', [rule.name, e.message]));
                            }
                        }
                    }
                }
            }
        }

        // 2. 如果没有被黑名单拦截，再检查文本是否已经完全是目标语言。
        if (rules && rules[targetLang]) {
            const langWhitelistRule = rules[targetLang].find(r => r.enabled && r.mode === 'whitelist');
            
            if (langWhitelistRule && langWhitelistRule.regex) {
                try {
                    // 步骤 a: 移除所有“原生”语言字符。
                    const nativeScriptFlags = langWhitelistRule.flags?.includes('g') 
                        ? langWhitelistRule.flags 
                        : (langWhitelistRule.flags || '') + 'g';
                    const nativeScriptRegex = new RegExp(langWhitelistRule.regex, nativeScriptFlags);
                    let remainingText = text.replace(nativeScriptRegex, '');

                    // 步骤 b: 移除所有中性字符（数字、空格、标点、符号）。
                    remainingText = remainingText.replace(/[\d\s\p{P}\p{S}]/gu, '');

                    // 步骤 c: 如果什么都没剩下，说明文本已经是目标语言，无需翻译。
                    if (remainingText.length === 0) {
                        // 此处的日志消息被轻微地复用，但在没有新的 i18n 键的情况下功能正常。
                        // 它记录了“包含中文”规则“匹配”，这在语义上是正确的。
                        log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [langWhitelistRule.name, 'whitelist']));
                        log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                        return { result: false, log: log };
                    } else {
                        log.push(browser.i18n.getMessage('logEntryPrecheckNoMatch', [langWhitelistRule.name, 'whitelist']));
                    }
                } catch (e) {
                    log.push(browser.i18n.getMessage('logEntryPrecheckRuleError', [langWhitelistRule.name, e.message]));
                }
            } else {
                log.push(browser.i18n.getMessage('logEntryPrecheckNoWhitelistRule', targetLang));
            }
        }

        // 3. 如果通过了所有检查，则应该翻译。
        return { result: true, log: log };
    };
}
