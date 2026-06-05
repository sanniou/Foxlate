export const FOXLATE_EXTENSION_SELECTOR = [
    '[data-translation-id]',
    '.foxlate-panel',
    '.foxlate-enhanced-panel',
    '.foxlate-summary-dialog',
    '.foxlate-summary-button',
    '.foxlate-summary-button-tooltip',
    '.foxlate-performance-hud',
].join(',');

export function isFoxlateExtensionElement(node) {
    return Boolean(node?.closest?.(FOXLATE_EXTENSION_SELECTOR));
}

export function isElementInViewport(element, windowRef = window, documentRef = document) {
    if (!element || !element.isConnected || typeof element.getBoundingClientRect !== 'function') {
        return false;
    }

    const rect = element.getBoundingClientRect();
    const viewportHeight = windowRef.innerHeight || documentRef.documentElement.clientHeight;
    const viewportWidth = windowRef.innerWidth || documentRef.documentElement.clientWidth;
    return rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < viewportHeight &&
        rect.left < viewportWidth;
}

export function getViewportDistance(element, windowRef = window, documentRef = document) {
    if (!element || typeof element.getBoundingClientRect !== 'function') {
        return Number.POSITIVE_INFINITY;
    }

    const rect = element.getBoundingClientRect();
    const viewportHeight = windowRef.innerHeight || documentRef.documentElement.clientHeight;
    if (rect.bottom >= 0 && rect.top <= viewportHeight) {
        return 0;
    }
    if (rect.bottom < 0) {
        return Math.abs(rect.bottom);
    }
    return rect.top - viewportHeight;
}

export function getInitialScanRoots({ documentRef = document, isExtensionElement = isFoxlateExtensionElement } = {}) {
    const roots = Array.from(documentRef.body.children)
        .filter(element => !isExtensionElement(element));
    return roots.length > 0 ? roots : [documentRef.body];
}
