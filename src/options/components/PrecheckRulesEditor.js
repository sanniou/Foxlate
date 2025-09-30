import { LitElement, html, css } from '../../lib/lit.js';
import { escapeHtml } from '../../common/utils.js';
import browser from '../../lib/browser-polyfill.js';

/**
 * (新) PrecheckRulesEditor
 * 一个使用 Lit 构建的 Web Component，用于管理预检查规则。
 * 它封装了所有与 UI 相关的状态（如活动标签页、输入焦点）和逻辑，
 * 仅通过属性接收数据，并通过事件向上层发出变更通知。
 * 这解决了之前因全量重绘导致的 UI 状态丢失问题。
 */
export class PrecheckRulesEditor extends LitElement {
    static styles = css`
        :host {
            display: block;
            margin-top: 16px;
            font-family: var(--md-sys-font-family); /* (修复) 继承字体 */
        }
        .tab-buttons {
            display: flex;
            border-bottom: 1px solid var(--md-sys-color-outline-variant);
            margin-bottom: 16px;
            overflow-x: auto;
        }
        .tab-button {
            padding: 8px 16px;
            cursor: pointer;
            border: none;
            background: none;
            border-bottom: 2px solid transparent;
            color: var(--md-sys-color-on-surface-variant, #49454F);
            font-size: 14px;
            font-weight: 500;
            white-space: nowrap;
        }
        .tab-button.active {
            color: var(--md-sys-color-primary);
            border-bottom-color: var(--md-sys-color-primary);
        }
        .tab-panel {
            display: none;
        }
        .tab-panel.active {
            display: block;
        }
        .rule-list {
            display: flex;
            flex-direction: column;
            gap: 24px;
        }
        .rule-item {
            display: grid;
            grid-template-columns: repeat(12, 1fr);
            gap: 16px;
            align-items: start; /* (修复) 顶部对齐以处理错误消息 */
            border: 1px solid var(--md-sys-color-outline-variant);
            padding: 16px;
            border-radius: 12px;
        }
        .rule-name-field { grid-column: 1 / 5; }
        .rule-regex-field { grid-column: 5 / 13; min-width: 0; } /* (修复) 允许收缩 */
        .rule-flags-field { grid-column: 1 / 3; }
        .rule-mode-field { grid-column: 3 / 6; }
        .rule-item-controls {
            grid-column: 6 / 13;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
        }
        .rule-test-result {
            grid-column: 1 / -1;
            margin-top: 8px;
            padding: 8px;
            border-radius: 4px;
            background-color: var(--md-sys-color-surface-container-low, #F7F2FA);
            font-size: 12px;
            display: none;
        }
        .rule-test-result.show {
            display: block;
        }
        .regex-highlight {
            background-color: var(--md-sys-color-tertiary-container);
            color: var(--md-sys-color-on-tertiary-container);
            border-radius: 3px;
        }
        .add-rule-btn {
            margin-top: 24px;
        }
        @media (max-width: 768px) {
            .rule-name-field { grid-column: 1 / 13; }
            .rule-regex-field { grid-column: 1 / 13; }
            .rule-flags-field { grid-column: 1 / 5; }
            .rule-mode-field { grid-column: 5 / 13; }
            .rule-item-controls { grid-column: 1 / 13; justify-content: flex-start; }
        }
    `;

    static properties = {
        rules: { type: Object },
        testText: { type: String },
        _activeTab: { state: true },
        _testResults: { state: true },
    };

    constructor() {
        super();
        this.rules = {};
        this.testText = '';
        this._activeTab = 'general';
        this._testResults = {}; // { "category-index": "result html" }
    }

    render() {
        const categories = Object.keys(this.rules || {});
        const sortedCategories = ['general', ...categories.filter(c => c !== 'general').sort()];

        return html`
            <div class="tab-buttons">
                ${sortedCategories.map(category => html`
                    <button
                        class="tab-button ${this._activeTab === category ? 'active' : ''}"
                        @click=${() => this._activeTab = category}>
                        ${browser.i18n.getMessage(`precheckTab_${category}`) || category}
                    </button>
                `)}
            </div>

            <div class="tab-content">
                ${sortedCategories.map(category => html`
                    <div class="tab-panel ${this._activeTab === category ? 'active' : ''}">
                        <div class="rule-list">
                            ${(this.rules[category] || []).map((rule, index) => this._renderRuleItem(rule, category, index))}
                        </div>
                        <button
                            class="add-rule-btn m3-button filled-tonal"
                            @click=${() => this._handleAddRule(category)}>
                            ${browser.i18n.getMessage('addPrecheckRule')}
                        </button>
                    </div>
                `)}
            </div>
        `;
    }

    _renderRuleItem(rule, category, index) {
        const resultKey = `${category}-${index}`;
        const testResult = this._testResults[resultKey];
        const validationError = this._validateRegex(rule.regex, rule.flags);
        return html`
            <div class="rule-item" data-category=${category} data-index=${index}>
                <div class="m3-form-field filled rule-name-field">
                    <input
                        type="text"
                        class="rule-name"
                        .value=${rule.name || ''}
                        @input=${(e) => this._handleInput(e, category, index, 'name')}
                        placeholder=" ">
                    <label>${browser.i18n.getMessage('ruleNamePlaceholder')}</label>
                </div>
                <div class="m3-form-field filled rule-regex-field ${validationError ? 'is-invalid' : ''}">
                    <input
                        type="text"
                        class="rule-regex"
                        .value=${rule.regex || ''}
                        @input=${(e) => this._handleInput(e, category, index, 'regex')}
                        placeholder=" ">
                    <label>${browser.i18n.getMessage('regexPlaceholder')}</label>
                    <div class="error-message">${validationError}</div>
                </div>
                <div class="m3-form-field filled rule-flags-field">
                    <input
                        type="text"
                        class="rule-flags"
                        .value=${rule.flags || ''}
                        @input=${(e) => this._handleInput(e, category, index, 'flags')}
                        placeholder=" ">
                    <label>${browser.i18n.getMessage('flagsPlaceholder')}</label>
                </div>
                <div class="m3-form-field filled rule-mode-field">
                    <select class="rule-mode" .value=${rule.mode} @change=${(e) => this._handleChange(e, category, index, 'mode')}>
                        <option value="blacklist">${browser.i18n.getMessage('blacklist')}</option>
                        <option value="whitelist">${browser.i18n.getMessage('whitelist')}</option>
                    </select>
                    <label>${browser.i18n.getMessage('rule')}</label>
                </div>
                <div class="rule-item-controls">
                    <div class="m3-switch">
                        <input
                            type="checkbox"
                            class="rule-enabled-checkbox"
                            .checked=${!!rule.enabled}
                            @change=${(e) => this._handleChange(e, category, index, 'enabled')}>
                        <label class="switch-track"><span class="switch-thumb"></span></label>
                        <label class="switch-label">${browser.i18n.getMessage('enabled')}</label>
                    </div>
                    <button class="test-rule-btn m3-button text" @click=${() => this._handleTestRule(rule, category, index)}>${browser.i18n.getMessage('test')}</button>
                    <button class="remove-rule-btn m3-icon-button danger" @click=${() => this._handleRemoveRule(category, index)}>
                        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                </div>
                <div class="rule-test-result ${testResult ? 'show' : ''}" .innerHTML=${testResult || ''}></div>
            </div>
        `;
    }

    _validateRegex(regex, flags) {
        if (!regex) return '';
        try {
            new RegExp(regex, flags);
            return '';
        } catch (e) {
            return e.message;
        }
    }

    _handleInput(e, category, index, key) {
        this._dispatchEvent('rule-update', { category, index, key, value: e.target.value });
    }

    _handleChange(e, category, index, key) {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        this._dispatchEvent('rule-update', { category, index, key, value });
    }

    _handleAddRule(category) {
        this._dispatchEvent('rule-add', { category });
        // 焦点将在 options.js 中处理，因为它需要等待 Lit 更新 DOM
    }

    _handleRemoveRule(category, index) {
        this._dispatchEvent('rule-remove', { category, index });
    }

    /**
     * (新) 将测试逻辑封装在组件内部。
     */
    _handleTestRule(rule, category, index) {
        const resultKey = `${category}-${index}`;
        const regexValue = rule.regex;
        const flagsValue = rule.flags || '';

        if (!regexValue) {
            this._setTestResult(resultKey, browser.i18n.getMessage('enterRegex'));
            return;
        }
        if (!this.testText) {
            this._setTestResult(resultKey, browser.i18n.getMessage('enterTestText'));
            return;
        }

        try {
            const effectiveFlags = flagsValue.includes('g') ? flagsValue : flagsValue + 'g';
            const regex = new RegExp(regexValue, effectiveFlags);
            const matches = [...this.testText.matchAll(regex)];

            if (matches.length === 0) {
                this._setTestResult(resultKey, browser.i18n.getMessage('regexTestNoMatch'));
            } else {
                let lastIndex = 0;
                let highlightedHtml = '';
                matches.forEach(match => {
                    const startIndex = match.index;
                    const endIndex = startIndex + match[0].length;
                    highlightedHtml += escapeHtml(this.testText.substring(lastIndex, startIndex));
                    highlightedHtml += `<span class="regex-highlight">${escapeHtml(match[0])}</span>`;
                    lastIndex = endIndex;
                });
                highlightedHtml += escapeHtml(this.testText.substring(lastIndex));
                this._setTestResult(resultKey, highlightedHtml);
            }
        } catch (e) {
            this._setTestResult(resultKey, `${browser.i18n.getMessage('invalidRegex')}: ${e.message}`);
        }
    }

    _setTestResult(key, resultHtml) {
        this._testResults = { ...this._testResults, [key]: resultHtml };
        // 设置一个计时器来清除结果，避免 UI 混乱
        setTimeout(() => {
            const newResults = { ...this._testResults };
            delete newResults[key];
            this._testResults = newResults;
        }, 5000);
    }

    _dispatchEvent(type, detail) {
        const event = new CustomEvent(type, {
            detail,
            bubbles: true,
            composed: true,
        });
        this.dispatchEvent(event);
    }

    /**
     * (新) 公开一个方法，用于在添加新规则后设置焦点。
     * @param {string} category
     * @param {number} index
     */
    async focusNewRule(category, index) {
        // 确保在尝试聚焦之前，Lit 已经完成了 DOM 的更新
        await this.updateComplete;

        // 切换到正确的标签页
        this._activeTab = category;
        await this.updateComplete;

        const ruleItem = this.shadowRoot.querySelector(`.rule-item[data-category="${category}"][data-index="${index}"]`);
        if (ruleItem) {
            const input = ruleItem.querySelector('.rule-name');
            if (input) {
                input.focus();
            }
        }
    }

    /**
     * (新) 公开一个方法，用于在全局测试时清除所有测试结果。
     */
    clearAllTestResults() {
        this._testResults = {};
    }

    /**
     * (新) 公开一个方法，用于运行全局测试。
     */
    runAllTests() {
        this.clearAllTestResults();
        const categories = Object.keys(this.rules || {});
        categories.forEach(category => {
            (this.rules[category] || []).forEach((rule, index) => {
                if (rule.enabled) {
                    this._handleTestRule(rule, category, index);
                }
            });
        });
    }
}

customElements.define('precheck-rules-editor', PrecheckRulesEditor);

/**
 * (新) 引入 lit.js
 * Lit 是一个轻量级的库，用于构建快速、轻量级的 Web Components。
 * 它不需要复杂的构建步骤，可以直接作为 ES 模块使用。
 * 我们将它放在 `src/lib` 目录下，以便与项目一起管理。
 *
 * 获取方式:
 * 1. `npm install lit`
 * 2. 从 `node_modules/lit/` 目录中复制 `lit.js` 和 `lit.js.map` 到 `src/lib/`。
 *
 * 这样做的好处是：
 * - 保持了项目的极简构建流程，无需为 Lit 添加任何特殊的 esbuild 配置。
 * - 依赖是自包含的，便于版本控制和离线开发。
 */