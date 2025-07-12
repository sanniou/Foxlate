/**
 * Determines if a text string should be translated based on pre-check rules.
 * This version expects rules to have a `compiledRegex` property for performance.
 * @param {string} text - The text to check.
 * @param {object} settings - A valid settings object containing precheckRules and targetLanguage.
 * @returns {{result: boolean, reason: string}} An object containing the translation decision and a reason if not translated.
 * @param {boolean} [enableLog=false] - 是否启用详细日志记录。默认为 false
 */
export function shouldTranslate(text, settings, enableLog = false) {
    let log; // 仅在需要时初始化，进行微小优化
    if (enableLog) {
        log = [];
        log.push(browser.i18n.getMessage('logEntryPrecheckStart') || 'Pre-check started.');
    }

    const rules = settings?.precheckRules;
    const targetLang = settings?.targetLanguage;

    // --- Step 1: Full-string Blacklist Check ---
    // These rules immediately stop translation if the entire string matches.
    if (rules) {
        for (const category in rules) {
            for (const rule of rules[category]) {
                const isFullStringMatchRule = rule.regex.startsWith('^') && rule.regex.endsWith('$');
                if (rule.enabled && rule.mode === 'blacklist' && isFullStringMatchRule) {
                    if (rule.compiledRegex && rule.compiledRegex.test(text)) {
                        // Reset lastIndex for global regexes, although it's less critical for .test() on full-match regexes.
                        rule.compiledRegex.lastIndex = 0;
                        const reason = `Full-string blacklist match: ${rule.name}`;
                        if (enableLog) {
                            log.push(browser.i18n.getMessage('logEntryPrecheckMatch', [rule.name, 'blacklist']) || `Rule matched: ${rule.name}`);
                            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation') || 'Decision: Do not translate.');
                        }
                        return { result: false, reason, log };
                    }
                }
            }
        }
    }

    // --- Step 2: Mixed Content Analysis (Subtraction Model) ---
    // We "erase" parts of the string that we know shouldn't be translated.
    // If nothing is left, we skip the translation.
    let remainingText = text;

    // 2a: Remove all known terms (from all blacklist rules, not just full-string).
    if (rules) {
        for (const category in rules) {
            for (const rule of rules[category]) {
                if (rule.enabled && rule.mode === 'blacklist' && rule.compiledRegex) {
                    const textBefore = remainingText;
                    remainingText = remainingText.replace(rule.compiledRegex, '');
                    // Reset lastIndex for global regexes to ensure correct behavior in subsequent uses.
                    rule.compiledRegex.lastIndex = 0;
                    if (textBefore !== remainingText) {
                        if (enableLog) {
                            log.push(browser.i18n.getMessage('logEntryPrecheckEraserUsed', [rule.name, 'blacklist']) || `Erased content using rule: ${rule.name}`);
                        }
                    }
                }
            }
        }
    }

    // 2b: Remove target language characters.
    if (rules && targetLang && rules[targetLang]) {
        const langWhitelistRule = rules[targetLang].find(r => r.enabled && r.mode === 'whitelist');
        if (langWhitelistRule && langWhitelistRule.compiledRegex) {
            const textBefore = remainingText;
            remainingText = remainingText.replace(langWhitelistRule.compiledRegex, '');
            langWhitelistRule.compiledRegex.lastIndex = 0;
            if (textBefore !== remainingText) {
                if (enableLog) {
                    log.push(browser.i18n.getMessage('logEntryPrecheckEraserUsed', [langWhitelistRule.name, 'whitelist']) || `Erased target language content using rule: ${langWhitelistRule.name}`);
                }
            }
        }
    }

    // 2c: Remove neutral characters (digits, spaces, punctuation, symbols).
    const textBeforeNeutral = remainingText;
    const neutralRegex = /[\d\s\p{P}\p{S}]/gu;
    remainingText = remainingText.replace(neutralRegex, '');
    if (enableLog && textBeforeNeutral !== remainingText) {
        log.push(browser.i18n.getMessage('logEntryPrecheckNeutralRemoved') || 'Erased neutral characters (numbers, symbols).');
    }

    // --- Step 3: Final Decision ---
    if (enableLog) {
        log.push(browser.i18n.getMessage('logEntryPrecheckFinalCheck', [remainingText]) || `Final check on remaining text: "${remainingText}"`);
    }
    if (remainingText.length === 0) {
        const reason = 'Text contains only non-translatable content (e.g., numbers, symbols, or already in target language).';
        if (enableLog) {
            log.push(browser.i18n.getMessage('logEntryPrecheckNoTranslation') || 'Decision: Do not translate.');
        }
        return { result: false, reason, log };
    } else {
        return { result: true, reason: '', log };
    }
}
