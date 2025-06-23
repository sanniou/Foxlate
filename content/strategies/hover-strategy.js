// A single tooltip element for the entire page to improve performance.
let tooltip = null;

/**
 * Creates a single tooltip element and appends it to the body if it doesn't exist.
 */
function createTooltip() {
    // Check if the tooltip already exists to avoid creating duplicates.
    if (document.querySelector('.universal-translator-tooltip')) return;
    
    tooltip = document.createElement('div');
    tooltip.className = 'universal-translator-tooltip';
    document.body.appendChild(tooltip);
}

/**
 * Shows and positions the tooltip with the provided text.
 * @param {MouseEvent} event - The mouse event to position the tooltip.
 * @param {string} text - The text to display in the tooltip.
 */
export function showTooltip(event, text) {
    createTooltip(); // Ensure the tooltip element exists
    const tooltipEl = document.querySelector('.universal-translator-tooltip');
    if (!tooltipEl) return;

    tooltipEl.textContent = text;
    tooltipEl.style.display = 'block';

    // Position the tooltip near the mouse cursor using pageX/pageY to account for scrolling.
    // Add a small offset to prevent the tooltip from flickering by being under the cursor.
    let x = event.pageX + 15;
    let y = event.pageY + 15;

    // Adjust position to prevent the tooltip from going off-screen.
    const tooltipRect = tooltipEl.getBoundingClientRect();
    if (event.clientX + 15 + tooltipRect.width > window.innerWidth) {
        x = event.pageX - tooltipRect.width - 15; // Move to the left of the cursor
    }
    if (event.clientY + 15 + tooltipRect.height > window.innerHeight) {
        y = event.pageY - tooltipRect.height - 15; // Move above the cursor
    }

    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
}

/**
 * Hides the tooltip.
 */
export function hideTooltip() {
    const tooltipEl = document.querySelector('.universal-translator-tooltip');
    if (tooltipEl) {
        tooltipEl.style.display = 'none';
    }
}

export function hoverStrategy(element, translatedText) {
    // Store original and translated text in the element's dataset for easy access.
    if (!element.dataset.originalText) {
        element.dataset.originalText = element.textContent;
    }
    element.dataset.translatedText = translatedText;

    // Add event listeners for mouse enter and leave to show/hide the tooltip.
    element.addEventListener('mouseenter', (event) => showTooltip(event, element.dataset.translatedText));
    element.addEventListener('mouseleave', hideTooltip);
}