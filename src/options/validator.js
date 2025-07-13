/**
 * 一个通用的、基于配置的表单验证器。
 */
export class FormValidator {
    /**
     * @param {HTMLElement} formElement - 要验证的表单或容器元素。
     * @param {Object.<string, {rules: string, labelKey: string}>} fieldConfigs - 字段配置，键为元素ID。
     */
    constructor(formElement, fieldConfigs) {
        this.form = formElement;
        this.configs = fieldConfigs;
    }

    /**
     * 执行验证。
     * @returns {boolean} 如果所有字段都有效，则返回 true。
     */
    validate() {
        this.clearAllErrors();
        let isValid = true;

        for (const elementId in this.configs) {
            const config = this.configs[elementId];
            const element = this.form.querySelector(`#${elementId}`);
            if (!element) {
                console.warn(`Validator: Element with id #${elementId} not found.`);
                continue;
            }

            const value = element.value.trim();
            const rules = config.rules.split('|');

            for (const rule of rules) {
                if (rule === 'required' && !value) {
                    this.setError(element, this._getErrorMessage(config.labelKey, 'isRequired'));
                    isValid = false;
                    break; // 停止检查此字段的其他规则
                }
            }
        }

        if (!isValid) {
            this._shakeFirstError();
        }

        return isValid;
    }

    setError(element, message) {
        const field = element.closest('.m3-form-field');
        if (!field) return;

        field.classList.add('is-invalid');
        const errorDiv = field.querySelector('.error-message');
        if (errorDiv) {
            errorDiv.textContent = message;
        }
    }

    clearAllErrors() {
        this.form.querySelectorAll('.m3-form-field.is-invalid').forEach(field => {
            field.classList.remove('is-invalid');
            const errorDiv = field.querySelector('.error-message');
            if (errorDiv) errorDiv.textContent = '';
        });
    }

    _getErrorMessage(labelKey, errorKey) {
        const label = (browser.i18n.getMessage(labelKey) || labelKey).replace(':', '');
        const errorMsg = browser.i18n.getMessage(errorKey) || 'is required.';
        return `${label} ${errorMsg}`;
    }

    _shakeFirstError() {
        const firstInvalidField = this.form.querySelector('.m3-form-field.is-invalid');
        if (firstInvalidField) {
            firstInvalidField.classList.add('error-shake');
            setTimeout(() => firstInvalidField.classList.remove('error-shake'), 500);
        }
    }
}