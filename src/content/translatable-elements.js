import { FALLBACK_TRANSLATION_CONTENT, SKIPPED_TAGS } from '../common/constants.js';

function createContentSelectorQuery(selector) {
    let invalidSelectorError = null;

    const markInvalid = (error) => {
        if (!invalidSelectorError) {
            invalidSelectorError = error;
            console.error(`[Foxlate] Invalid content selector in configuration: "${selector}". Page translation candidate extraction was skipped.`, error);
        }
    };

    return {
        isInvalid() {
            return Boolean(invalidSelectorError);
        },
        matches(element) {
            if (invalidSelectorError) return false;
            try {
                return element.matches(selector);
            } catch (error) {
                markInvalid(error);
                return false;
            }
        },
        queryAll(root) {
            if (invalidSelectorError) return [];
            try {
                return Array.from(root.querySelectorAll(selector));
            } catch (error) {
                markInvalid(error);
                return [];
            }
        },
        hasDescendant(element) {
            if (invalidSelectorError) return false;
            try {
                return Boolean(element.querySelector(selector));
            } catch (error) {
                markInvalid(error);
                return false;
            }
        }
    };
}

/**
 * 向指定的根（通常是 Shadow Root）注入 CSS。
 * @param {ShadowRoot} root 要注入 CSS 的 Shadow Root。
 * @param {HTMLElement} host 这个 Shadow Root 的宿主元素。
 * @param {string} cssFilePath 可访问的 CSS 文件 URL。
 * @param {object} logger 日志对象，默认使用 console。
 */
export function injectCSSIntoRoot(root, host, cssFilePath, logger = console) {
    if (!root || !host || host.dataset.foxlateCssInjected === 'true' || !cssFilePath) {
        return;
    }

    try {
        const styleLink = root.ownerDocument.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.type = 'text/css';
        styleLink.href = cssFilePath;

        root.prepend(styleLink);
        host.dataset.foxlateCssInjected = 'true';
        logger.log('[Foxlate] Injected CSS and marked host element:', host);
    } catch (error) {
        logger.error('[Foxlate] Failed to inject CSS into a Shadow Root:', error);
    }
}

/**
 * 递归查找并返回页面上所有的搜索根（包括初始节点和所有内部的 Shadow Root）。
 * @param {Node} rootNode - 开始搜索的节点，例如 document.body 或一个 shadowRoot。
 * @param {object} options
 * @param {string} options.cssFilePath - 注入到 Shadow Root 的 CSS URL。
 * @param {object} options.logger - 日志对象，默认使用 console。
 * @returns {(Document|DocumentFragment|Element)[]} 一个包含所有搜索根的数组。
 */
export function findAllSearchRoots(rootNode, { cssFilePath, logger = console } = {}) {
    if (!rootNode) return [];

    const roots = [rootNode];
    const doc = rootNode.ownerDocument || document;
    const nodeFilter = doc.defaultView?.NodeFilter || NodeFilter;
    const walker = doc.createTreeWalker(
        rootNode,
        nodeFilter.SHOW_ELEMENT,
        null,
        false
    );

    let currentNode;
    while (currentNode = walker.nextNode()) {
        if (currentNode.shadowRoot) {
            injectCSSIntoRoot(currentNode.shadowRoot, currentNode, cssFilePath, logger);
            roots.push(...findAllSearchRoots(currentNode.shadowRoot, { cssFilePath, logger }));
        }
    }
    return roots;
}

/**
 * 使用“自顶向下”的 CSS 选择器模型查找页面上所有可翻译的元素。
 * @param {object} effectiveSettings - 设置对象（用于预检查）。
 * @param {Node[]} rootNodes - 要在其中搜索的根节点。
 * @returns {HTMLElement[]} 一个包含最适合翻译的容器元素的数组。
 */
function isExcludedBySelector(element, excludeSelector) {
    if (!excludeSelector || !element?.closest) return false;
    try {
        return Boolean(element.closest(excludeSelector));
    } catch {
        return false;
    }
}

export function findTranslatableElements(effectiveSettings, rootNodes = [document.body], options = {}) {
    const contentSelector = effectiveSettings?.translationSelector?.content?.trim();
    const excludeSelector = effectiveSettings?.translationSelector?.exclude?.trim() || '';
    const skipFallback = options.skipFallback === true;

    if (!contentSelector) {
        return [];
    }

    const selectorQuery = createContentSelectorQuery(contentSelector);
    const allCandidates = new Set();
    for (const root of rootNodes) {
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
            continue;
        }

        if (root.nodeType === Node.ELEMENT_NODE && selectorQuery.matches(root)
            && !isExcludedBySelector(root, excludeSelector)) {
            allCandidates.add(root);
        }
        for (const el of selectorQuery.queryAll(root)) {
            if (!isExcludedBySelector(el, excludeSelector)) {
                allCandidates.add(el);
            }
        }
        if (selectorQuery.isInvalid()) {
            return [];
        }
    }

    if (allCandidates.size === 0) {
        // Empty preferred selector (e.g. pages without main/article): one-shot broader fallback.
        const fallback = (effectiveSettings?.translationSelector?.fallbackContent
            || FALLBACK_TRANSLATION_CONTENT).trim();
        if (!skipFallback && fallback && fallback !== contentSelector) {
            return findTranslatableElements({
                ...effectiveSettings,
                translationSelector: {
                    ...effectiveSettings.translationSelector,
                    content: fallback,
                },
            }, rootNodes, { skipFallback: true });
        }
        return [];
    }

    const finalCandidates = new Set();
    const potentialMixedParents = new Set();

    for (const el of allCandidates) {
        if (!selectorQuery.hasDescendant(el)) {
            finalCandidates.add(el);
        } else {
            potentialMixedParents.add(el);
        }
        if (selectorQuery.isInvalid()) {
            return [];
        }
    }

    for (const parent of potentialMixedParents) {
        let consecutiveOrphans = [];

        const wrapOrphans = () => {
            if (consecutiveOrphans.length === 0) return;

            const hasSignificantContent = consecutiveOrphans.some(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    return node.textContent.trim() !== '';
                }
                if (node.nodeType === Node.ELEMENT_NODE) {
                    return !SKIPPED_TAGS.has(node.tagName.toUpperCase()) && node.textContent.trim() !== '';
                }
                return false;
            });

            if (hasSignificantContent) {
                const wrapperElement = parent.ownerDocument.createElement('foxlate-wrapper');
                wrapperElement.dataset.foxlateGenerated = 'true';
                parent.insertBefore(wrapperElement, consecutiveOrphans[0]);
                consecutiveOrphans.forEach(node => wrapperElement.appendChild(node));
                if (!isExcludedBySelector(wrapperElement, excludeSelector)) {
                    finalCandidates.add(wrapperElement);
                }
            }
            consecutiveOrphans = [];
        };

        for (const child of Array.from(parent.childNodes)) {
            if (child.nodeType === Node.ELEMENT_NODE && child.dataset.foxlateGenerated === 'true') {
                wrapOrphans();
                continue;
            }

            const isBoundary = child.nodeType === Node.ELEMENT_NODE && (
                allCandidates.has(child) ||
                child.dataset.translationId ||
                selectorQuery.hasDescendant(child)
            );
            if (selectorQuery.isInvalid()) {
                return [];
            }

            if (isBoundary) {
                wrapOrphans();
            } else {
                consecutiveOrphans.push(child);
            }
        }

        wrapOrphans();
    }

    return Array.from(finalCandidates).filter(el =>
        !el.dataset.translationId && !isExcludedBySelector(el, excludeSelector));
}
