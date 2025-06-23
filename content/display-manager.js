import { replaceStrategy } from './strategies/replace-strategy.js';
import { appendStrategy } from './strategies/append-strategy.js';
import { hoverStrategy, showTooltip, hideTooltip } from './strategies/hover-strategy.js';

const strategies = {
  replace: replaceStrategy,
  append: appendStrategy,
  hover: hoverStrategy,
};

export class DisplayManager {
  static async apply(element, translatedText) {
    const { settings } = await browser.storage.sync.get('settings');
    const displayMode = settings?.displayMode || 'replace'; // 默认替换
    const strategy = strategies[displayMode];

    if (strategy) {
      strategy(element, translatedText);
    }
  }

  /**
   * Displays a visual error indicator on an element when translation fails.
   * @param {HTMLElement} element - The element that failed to translate.
   * @param {string} errorMessage - The error message to display.
   */
  static showError(element, errorMessage) {
    // Add a CSS class to visually indicate the error.
    element.classList.add('universal-translator-error');

    // Store the error message in a data attribute for the tooltip.
    element.dataset.errorMessage = errorMessage;

    // Use the tooltip to show the detailed error on hover.
    element.addEventListener('mouseenter', (event) => showTooltip(event, `Translation Error: ${element.dataset.errorMessage}`));
    element.addEventListener('mouseleave', hideTooltip);
  }
}
