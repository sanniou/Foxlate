// This file is intended to be used by both module and non-module scripts.
// It attaches the shouldTranslate function to the global window object.

// Ensure the function is only defined once.
if (typeof window.shouldTranslate !== 'function') {
    /**
     * Determines if a text string should be translated based on pre-check rules.
     * This version expects rules to have a `compiledRegex` property for performance.
     * @param {string} text - The text to check.
     * @param {object} settings - A valid settings object containing precheckRules and targetLanguage.
     * @returns {{result: boolean, log: string[]}} An object containing the translation decision and a detailed log.
     */
    window.shouldTranslate = function(text, settings) {
        const log = [];
        log.push(browser.i18n.getMessage('logEntryPrecheckStart'));

        const rules = settings.precheckRules;
        const targetLang = settings.targetLanguage;

        // --- Step 1: Full-string Blacklist Check ---
        if (rules) {
            for (const category in rules) {
                for (const rule of rules[category]) {
                    const isFullStringMatchRule = rule.regex.startsWith('^') && rule.regex.endsWith('$');
                    if (rule.enabled && rule.mode === 'blacklist' && isFullStringMatchRule) {
                        console.log(`checking rule ${rule.name}...`,rule.compiledRegex);
                        if (rule.compiledRegex && rule.compiledRegex.test(text)) {
                            log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [rule.name, 'blacklist']));
                            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
                            return { result: false, log: log };
                        } else if (rule.compiledRegex) {
                            log.push(browser.i18n.getMessage('logEntryPrecheckNoMatch', [rule.name, 'blacklist']));
                        }
                    }
                }
            }
        }

        // --- Step 2: Mixed Content Analysis (Subtraction Model) ---
        let remainingText = text;

        // 2a: Remove all known terms (from all blacklist rules).
        if (rules) {
            for (const category in rules) {
                for (const rule of rules[category]) {
                    console.log(`checking rule ${rule.name}...`,rule.compiledRegex);
                    if (rule.enabled && rule.mode === 'blacklist' && rule.compiledRegex) {
                        const textBefore = remainingText;
                        remainingText = remainingText.replace(rule.compiledRegex, '');
                        // Reset lastIndex for global regexes to ensure correct behavior in subsequent uses.
                        rule.compiledRegex.lastIndex = 0;
                        if (textBefore !== remainingText) {
                            log.push(browser.i18n.getMessage('logEntryPrecheckEraserUsed', [rule.name, 'blacklist']));
                        }
                    }
                }
            }
        }

        // 2b: Remove target language characters.
        if (rules && rules[targetLang]) {
            const langWhitelistRule = rules[targetLang].find(r => r.enabled && r.mode === 'whitelist');
            if (langWhitelistRule && langWhitelistRule.compiledRegex) {
                const textBefore = remainingText;
                remainingText = remainingText.replace(langWhitelistRule.compiledRegex, '');
                langWhitelistRule.compiledRegex.lastIndex = 0;
                if (textBefore !== remainingText) {
                    log.push(browser.i18n.getMessage('logEntryPrecheckEraserUsed', [langWhitelistRule.name, 'whitelist']));
                }
            }
        }

        // 2c: Remove neutral characters (digits, spaces, punctuation, symbols).
        const textBeforeNeutral = remainingText;
        // This regex is static and can be defined once.
        const neutralRegex = /[\d\s\p{P}\p{S}]/gu;
        remainingText = remainingText.replace(neutralRegex, '');
        if (textBeforeNeutral !== remainingText) {
            log.push(browser.i18n.getMessage('logEntryPrecheckNeutralRemoved'));
        }

        // --- Step 3: Final Decision ---
        log.push(browser.i18n.getMessage('logEntryPrecheckFinalCheck', [remainingText]));
        if (remainingText.length === 0) {
            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation'));
            return { result: false, log: log };
        } else {
            return { result: true, log: log };
        }
    };
}
