import browser from '../lib/browser-polyfill.js';
/**
 * Determines if a text string should be translated based on pre-check rules.
 * This version expects rules to have a `compiledRegex` property for performance.
 * (已优化) 此版本通过将多个擦除规则合并为单个正则表达式来优化性能，
 * 从而显著减少对长文本的字符串操作次数。
 * @param {string} text - The text to check.
 * @param {object} settings - A valid settings object containing precheckRules and targetLanguage.
 * @param {boolean} [enableLog=false] - 是否启用详细日志记录。默认为 false。
 * @returns {{result: boolean, reason: string, log?: string[]}} 包含翻译决策和原因（如果未翻译）的对象。
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

    // --- 步骤 2: 按标志对黑名单规则进行分组 (新) ---
    // (修复) 此方法解决了之前将所有规则合并为一个忽略各规则独立标志（如 'i'）的正则表达式的问题。
    // 通过按标志分组，我们可以为每个组创建具有正确标志的合并正则表达式，从而确保大小写敏感性等行为符合预期。
    const rulesByFlags = new Map();
    if (rules) {
        for (const category in rules) {
            for (const rule of rules[category]) {
                // 只收集启用的、非全字符串匹配的黑名单规则。
                const isFullStringMatchRule = rule.regex.startsWith('^') && rule.regex.endsWith('$');
                if (rule.enabled && rule.mode === 'blacklist' && !isFullStringMatchRule) {
                    const flags = rule.flags || '';
                    if (!rulesByFlags.has(flags)) {
                        rulesByFlags.set(flags, []);
                    }
                    // 将每个表达式包裹在非捕获组 `(?:...)` 中，以防止 `|` 运算符的优先级问题。
                    rulesByFlags.get(flags).push(`(?:${rule.regex})`);
                }
            }
        }
    }

    // --- 步骤 3: 混合内容分析 (优化的减法模型) ---
    let remainingText = text;

    // 3a: 对每个标志组应用合并后的正则表达式。
    if (rulesByFlags.size > 0) {
        const textBefore = remainingText;
        for (const [flags, patterns] of rulesByFlags.entries()) {
            // 确保 'g' 标志总是存在，并合并用户定义的标志。
            const combinedFlags = [...new Set('g' + flags)].join('');
            const combinedRegex = new RegExp(patterns.join('|'), combinedFlags);
            remainingText = remainingText.replace(combinedRegex, '');
        }
        if (enableLog && textBefore !== remainingText) {
            log.push(browser.i18n.getMessage('logEntryPrecheckEraserUsedCombined') || 'Erased content using combined blacklist rules.');
        }
    }

    // 3b: 擦除目标语言字符。
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

    // 3c: 擦除中性字符 (数字、空格、标点、符号)。
    const textBeforeNeutral = remainingText;
    // (优化) 增加 \p{M} (Marks) 来移除像 emoji 变体选择符 (U+FE0F) 这类非打印字符，
    // 这可以更可靠地识别仅由符号、标记和空白组成的字符串。
    const neutralRegex = /[\d\s\p{P}\p{S}\p{M}]/gu;
    remainingText = remainingText.replace(neutralRegex, '');
    if (enableLog && textBeforeNeutral !== remainingText) {
        log.push(browser.i18n.getMessage('logEntryPrecheckNeutralRemoved') || 'Erased neutral characters (numbers, symbols).');
    }

    // --- 步骤 4: 最终决策 ---
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
