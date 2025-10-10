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
            margin-top: 24px;
            font-family: var(--md-sys-font-family);
        }
        
        /* M3 Form Field 样式 - 从全局样式复制 */
        .m3-form-field {
            position: relative;
        }
        
        .m3-form-field.filled {
            border-radius: 4px 4px 0 0;
            background-color: var(--md-sys-color-surface-container-highest);
        }
        
        .m3-form-field.filled:hover {
            background-color: color-mix(in srgb, var(--md-sys-color-surface-container-highest), var(--md-sys-color-on-surface) 4%);
        }
        
        .m3-form-field.filled input,
        .m3-form-field.filled textarea,
        .m3-form-field.filled select {
            width: 100%;
            padding: 24px 16px 8px;
            border: none;
            border-bottom: 1px solid var(--md-sys-color-outline);
            border-radius: 4px 4px 0 0;
            font-size: var(--md-sys-typescale-body-large-font-size);
            background-color: transparent;
            color: var(--md-sys-color-on-surface);
            box-sizing: border-box;
            line-height: 1.2;
            transition: border-color 0.2s ease, padding-bottom 0.2s ease, border-width 0.2s ease;
        }
        
        .m3-form-field.filled select {
            -webkit-appearance: none;
            -moz-appearance: none;
            appearance: none;
            background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2345464F'%3e%3cpath d='M7 10l5 5 5-5z'/%3e%3c/svg%3e");
            background-repeat: no-repeat;
            background-position: right 16px center;
            background-size: 24px;
            padding-right: 48px;
        }
        
        .m3-form-field.filled label {
            position: absolute;
            left: 16px;
            top: 24px;
            font-size: var(--md-sys-typescale-body-large-font-size);
            color: var(--md-sys-color-on-surface-variant);
            pointer-events: none;
            transition: top 0.3s ease, font-size 0.3s ease, color 0.3s ease;
            display: block;
            margin-bottom: 0;
            padding-left: 0;
        }
        
        .m3-form-field.filled select + label {
            top: 18px;
        }
        
        .m3-form-field.filled input:focus + label,
        .m3-form-field.filled textarea:focus + label,
        .m3-form-field.filled select:focus + label,
        .m3-form-field.filled input:not(:placeholder-shown) + label,
        .m3-form-field.filled textarea:not(:placeholder-shown) + label,
        .m3-form-field.filled.is-filled > label {
            top: 8px;
            font-size: var(--md-sys-typescale-body-small-font-size);
            color: var(--md-sys-color-primary);
        }
        
        .m3-form-field.filled input::placeholder,
        .m3-form-field.filled textarea::placeholder {
            color: transparent;
            transition: color 0.3s ease;
        }
        
        .m3-form-field.filled input:focus::placeholder,
        .m3-form-field.filled textarea:focus::placeholder {
            color: var(--md-sys-color-on-surface-variant);
        }
        
        .m3-form-field.is-invalid input,
        .m3-form-field.is-invalid textarea,
        .m3-form-field.is-invalid select {
            border-bottom-color: var(--md-sys-color-error);
            box-shadow: 0 1px 0 0 var(--md-sys-color-error);
        }
        
        .m3-form-field.filled input:focus,
        .m3-form-field.filled textarea:focus,
        .m3-form-field.filled select:focus {
            outline: none;
            border-bottom-color: var(--md-sys-color-primary);
            box-shadow: 0 1px 0 0 var(--md-sys-color-primary);
        }
        
        .m3-form-field.is-invalid label {
            color: var(--md-sys-color-error);
        }
        
        .m3-form-field .error-message {
            color: var(--md-sys-color-error);
            font-size: var(--md-sys-typescale-body-small-font-size);
            margin-top: 4px;
            padding-left: 16px;
            display: none;
        }
        
        .m3-form-field.is-invalid .error-message {
            display: block;
        }
        
        /* M3 Button 样式 - 从全局样式复制 */
        button, .m3-button {
            padding: 10px 24px;
            border: none;
            border-radius: 20px;
            cursor: pointer;
            font-size: var(--md-sys-typescale-label-large-font-size);
            font-weight: 600;
            transition: background-color 0.2s, box-shadow 0.2s, transform 0.1s;
            flex-shrink: 0;
            position: relative;
            overflow: hidden;
        }
        
        .m3-button.filled {
            background-color: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
        }
        
        .m3-button.filled:hover {
            background-color: color-mix(in srgb, var(--md-sys-color-primary), var(--md-sys-state-hover-on-primary));
            box-shadow: 0 1px 3px 1px rgba(0,0,0,0.15);
        }
        
        .m3-button.text {
            background-color: transparent;
            color: var(--md-sys-color-primary);
            padding: 6px 8px;
        }
        
        .m3-button.text:hover {
            background-color: var(--md-sys-state-hover-on-surface);
        }
        
        .m3-button.text.danger {
            color: var(--md-sys-color-error);
            background-color: transparent;
        }
        
        .m3-button.text.danger:hover {
            background-color: rgba(var(--md-sys-color-error-rgb), 0.08);
        }
        
        .m3-button.filled-tonal {
            background-color: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-on-primary-container);
        }
        
        .m3-button.filled-tonal:hover {
            background-color: color-mix(in srgb, var(--md-sys-color-primary-container), var(--md-sys-color-on-primary-container) 8%);
        }
        
        /* 标签按钮样式 - 与全局样式保持一致 */
        .tab-buttons {
            display: flex;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--md-sys-color-outline-variant);
            overflow-x: auto;
        }
        
        .tab-button {
            position: relative;
            padding: 12px 20px;
            cursor: pointer;
            border: none;
            background-color: transparent;
            font-size: var(--md-sys-typescale-label-large-font-size);
            font-weight: 600;
            color: var(--md-sys-color-on-surface-variant);
            border-radius: 8px 8px 0 0;
            transition: color 0.3s ease, background-color 0.3s ease;
            white-space: nowrap;
        }
        
        .tab-button::after {
            content: '';
            position: absolute;
            bottom: -1px;
            left: 0;
            right: 0;
            height: 3px;
            background-color: var(--md-sys-color-primary);
            border-radius: 3px 3px 0 0;
            transform: scaleX(0);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .tab-button.active {
            color: var(--md-sys-color-primary);
            background-color: var(--md-sys-state-hover-on-surface);
        }
        
        .tab-button.active::after {
            transform: scaleX(1);
        }
        
        .tab-button:hover:not(.active) {
            background-color: var(--md-sys-state-hover-on-surface);
        }
        
        .tab-button:focus-visible {
            outline: 2px solid var(--md-sys-color-primary);
            outline-offset: -2px;
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
            gap: 15px;
        }
        
        .rule-item {
            display: grid;
            grid-template-columns: 1.2fr 2.5fr 0.8fr 1fr 1.5fr;
            grid-template-areas:
                "name regex flags mode controls"
                "result result result result result";
            gap: 12px;
            align-items: center;
            padding: 12px 16px;
            border-radius: 12px;
            background-color: var(--md-sys-color-surface-container-highest);
            border: 1px solid var(--md-sys-color-outline-variant);
        }
        
        /* 表单字段样式调整 */
        .rule-item .m3-form-field > label {
            top: 20px;
            left: 12px;
        }
        
        .rule-item .m3-form-field.filled input,
        .rule-item .m3-form-field.filled select {
            padding: 20px 12px 6px;
            font-size: var(--md-sys-typescale-body-medium-font-size);
            border-bottom: 1px solid var(--md-sys-color-outline);
        }
        
        .rule-item .m3-form-field.filled select {
            background-position: right 10px center;
            padding-right: 32px;
        }
        
        .rule-item .m3-form-field.filled select + label {
            top: 10px;
        }
        
        .rule-item .m3-form-field.filled select:focus + label,
        .rule-item .m3-form-field.filled.is-filled > label {
            top: 4px;
        }
        
        .rule-name-field { grid-area: name; }
        .rule-regex-field { grid-area: regex; min-width: 0; }
        .rule-flags-field { grid-area: flags; }
        .rule-mode-field { grid-area: mode; }
        .rule-item-controls { grid-area: controls; }
        .rule-test-result { grid-area: result; }
        
        .rule-item-controls {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 8px;
            padding-bottom: 0;
        }
        
        .rule-test-result {
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
            background-color: var(--md-sys-color-primary-container);
            color: var(--md-sys-color-on-primary-container);
            font-weight: bold;
            padding: 1px 4px;
            border-radius: 4px;
        }
        
        .add-rule-btn {
            margin-top: 15px;
        }
        
        /* 图标按钮样式 */
        button.m3-icon-button {
            background-color: transparent;
            border: none;
            border-radius: 50%;
            width: 36px;
            height: 36px;
            padding: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--md-sys-color-on-surface-variant);
            transition: background-color 0.2s;
        }
        
        button.m3-icon-button:hover {
            background-color: var(--md-sys-state-hover-on-surface);
        }
        
        button.m3-icon-button.danger:hover {
            background-color: rgba(186, 26, 26, 0.08);
        }
        
        button.m3-icon-button.danger {
            color: var(--md-sys-color-error);
        }
        
        /* 开关样式 */
        .m3-switch {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
        }
        
        .m3-switch .switch-label {
            font-size: var(--md-sys-typescale-body-medium-font-size);
            color: var(--md-sys-color-on-surface-variant);
            user-select: none;
            white-space: nowrap;
        }
        
        .m3-switch input[type="checkbox"] {
            display: none;
        }
        
        .m3-switch .switch-track {
            position: relative;
            width: 40px;
            height: 24px;
            background-color: var(--md-sys-color-surface-variant);
            border: 2px solid var(--md-sys-color-outline);
            border-radius: 12px;
            transition: background-color 0.2s, border-color 0.2s;
            display: flex;
            align-items: center;
        }
        
        .m3-switch .switch-thumb {
            position: absolute;
            left: 3px;
            width: 12px;
            height: 12px;
            background-color: var(--md-sys-color-outline);
            border-radius: 50%;
            transition: transform 0.2s ease, width 0.2s ease, height 0.2s ease, background-color 0.2s ease;
        }
        
        .m3-switch input:checked + .switch-track {
            background-color: var(--md-sys-color-primary);
            border-color: var(--md-sys-color-primary);
        }
        
        .m3-switch input:checked + .switch-track .switch-thumb {
            transform: translateX(16px);
            width: 18px;
            height: 18px;
            background-color: var(--md-sys-color-on-primary);
        }
        
        @media (max-width: 768px) {
            .rule-item {
                grid-template-columns: 1fr;
                grid-template-areas:
                    "name"
                    "regex"
                    "flags"
                    "mode"
                    "controls"
                    "result";
            }
            
            .rule-item-controls {
                justify-content: flex-start;
            }
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