// This file is intended to be used by both module and non-module scripts.
// It attaches the shouldTranslate function to the global window object.

// Ensure the function is only defined once.
if (typeof window.shouldTranslate !== 'function') {
    /**
     * 根据预检查规则判断一个文本字符串是否应该被翻译。
     * @param {string} text - 要检查的文本。
     * @param {object} settings - 包含 precheckRules 和 targetLanguage 的有效设置对象。
     * @returns {{result: boolean, log: string[]}} 一个包含翻译决策和详细日志的对象。
     */
    window.shouldTranslate = function(text, settings) {
        const log = [];
        log.push(browser.i18n.getMessage('logEntryPrecheckStart'));

        const rules = settings.precheckRules;
        const targetLang = settings.targetLanguage;

        // --- 步骤 1: 全字符串黑名单检查 ---
        // 这是一个快速通道，用于处理那些明确不应被翻译的文本，
        // 例如纯符号、纯空白字符或其他用户定义的全匹配规则。
        // 我们通过检查正则表达式是否由 ^ 和 $ 包围来识别它们。
        if (rules) {
            for (const category in rules) {
                for (const rule of rules[category]) {
                    // 只检查那些设计为匹配整个字符串的黑名单规则。
                    const isFullStringMatchRule = rule.regex.startsWith('^') && rule.regex.endsWith('$');
                    if (rule.enabled && rule.mode === 'blacklist' && isFullStringMatchRule) {
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

        // --- 步骤 2: 混合内容分析 (减法模型) ---
        // 如果文本没有被完全列入黑名单，我们将检查它是否包含任何“未知的外来”部分。
        // 我们通过从文本中移除所有已知部分（术语、目标语言、中性字符）并检查是否还有剩余来进行此操作。
        let remainingText = text;

        // 2a: 移除所有已知的术语（来自所有黑名单规则）。
        if (rules) {
            for (const category in rules) {
                for (const rule of rules[category]) {
                    // 这里我们使用所有黑名单规则作为“橡皮擦”，而不仅仅是全字符串匹配的规则。
                    if (rule.enabled && rule.mode === 'blacklist') {
                        try {
                            // 确保 'g' 标志用于全局替换。
                            const flags = rule.flags?.includes('g') ? rule.flags : (rule.flags || '') + 'g';
                            const regex = new RegExp(rule.regex, flags);
                            const textBefore = remainingText;
                            remainingText = remainingText.replace(regex, '');
                            if (textBefore !== remainingText) {
                                log.push(browser.i18n.getMessage('logEntryPrecheckEraserUsed', [rule.name, 'blacklist']));
                            }
                        } catch (e) {
                            // 忽略无效的正则表达式，但记录错误以便调试。
                            log.push(browser.i18n.getMessage('logEntryPrecheckRuleError', [rule.name, e.message]));
                        }
                    }
                }
            }
        }

        // 2b: 移除目标语言字符。
        if (rules && rules[targetLang]) {
            const langWhitelistRule = rules[targetLang].find(r => r.enabled && r.mode === 'whitelist');
            if (langWhitelistRule && langWhitelistRule.regex) {
                try {
                    const flags = langWhitelistRule.flags?.includes('g') ? langWhitelistRule.flags : (langWhitelistRule.flags || '') + 'g';
                    const regex = new RegExp(langWhitelistRule.regex, flags);
                    remainingText = remainingText.replace(regex, '');
                } catch (e) {
                    log.push(browser.i18n.getMessage('logEntryPrecheckRuleError', [langWhitelistRule.name, e.message]));
                }
            }
        }

        // 2c: 移除中性字符（数字、空格、标点、符号）。
        remainingText = remainingText.replace(/[\d\s\p{P}\p{S}]/gu, '');

        // --- 步骤 3: 最终决策 ---
        if (remainingText.length === 0) {
            // 如果经过三轮“擦除”后什么都没剩下，说明文本完全由已知部分构成，无需翻译。
            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
            return { result: false, log: log };
        } else {
            // 如果有剩余，意味着有未知内容需要翻译。
            // 我们不在此处添加额外日志，因为这意味着翻译将继续，
            // 后续的翻译日志将提供更多信息。
            return { result: true, log: log };
        }
    };
}
