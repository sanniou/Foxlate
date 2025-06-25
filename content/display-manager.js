// This script assumes that strategy functions (replaceStrategy, appendStrategy, hoverStrategy, showTooltip, hideTooltip)
// have already been loaded and attached to the global `window` object.

window.DisplayManager = class DisplayManager {
  static async apply(element, translatedText) {
    // 从全局作用域获取策略函数
    const strategies = {
      replace: window.replaceStrategy,
      append: window.appendStrategy,
      hover: window.hoverStrategy,
    };

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
    element.addEventListener('mouseenter', (event) => window.showTooltip(event, `Translation Error: ${element.dataset.errorMessage}`));
    element.addEventListener('mouseleave', window.hideTooltip);
  }
};

// Dispatch a custom event to signal that DisplayManager is ready.
window.dispatchEvent(new Event('DisplayManagerReady'));
