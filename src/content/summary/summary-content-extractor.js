import { DEFAULT_SUMMARY_MAIN_BODY } from '../../common/constants.js';

export class SummaryContentExtractor {
    constructor({ settings, documentRef = document } = {}) {
        this.settings = settings;
        this.document = documentRef;
    }

    async extractPageContent() {
        const selector = (
            this.settings.summarySettings?.mainBodySelector
            || DEFAULT_SUMMARY_MAIN_BODY
        ).trim();

        let content = '';
        const scopedRoot = this.#pickMainBody(selector);

        if (scopedRoot) {
            const doc = this.document.implementation.createHTMLDocument('');
            doc.body.innerHTML = scopedRoot.innerHTML;
            content = await this.#getReadabilityContent(doc);
            if (!content) {
                content = this.#textOf(scopedRoot);
            }
        }

        if (!content) {
            const docClone = this.document.cloneNode(true);
            content = await this.#getReadabilityContent(docClone);
        }

        if (!content) {
            console.warn('[Foxlate Summary] Fallback to body text.');
            content = this.#textOf(this.document.body);
        }

        return content;
    }

    #textOf(node) {
        if (!node) return '';
        // jsdom: innerText is often empty; prefer it when present, else textContent.
        return (node.innerText || node.textContent || '').trim();
    }

    /**
     * Prefer the largest matching main-body node (querySelector alone takes the first
     * match, which is often a tiny header/nav article).
     */
    #pickMainBody(selector) {
        if (!selector) return null;
        let nodes = [];
        try {
            nodes = Array.from(this.document.querySelectorAll(selector));
        } catch (error) {
            console.warn('[Foxlate Summary] Invalid mainBodySelector:', selector, error);
            return null;
        }
        if (nodes.length === 0) return null;
        if (nodes.length === 1) return nodes[0];

        let best = nodes[0];
        let bestScore = this.#textOf(best).length;
        for (let i = 1; i < nodes.length; i++) {
            const score = this.#textOf(nodes[i]).length;
            if (score > bestScore) {
                best = nodes[i];
                bestScore = score;
            }
        }
        return best;
    }

    async #getReadabilityContent(doc) {
        try {
            const { default: Readability } = await import('../../lib/readability.esm.js');
            this.#preProcessDOM(doc);
            const reader = new Readability(doc);
            const article = reader.parse();
            if (!article?.textContent) {
                return '';
            }
            return article.textContent.replace(/(\s*\n\s*){2,}/g, '\n').trim();
        } catch (error) {
            console.warn('[Foxlate Summary] Readability processing failed.', error);
            return '';
        }
    }

    #preProcessDOM(doc) {
        const selectorsToRemove = [
            'header', 'footer', 'nav', 'aside',
            '.ad', '#ad', '[class*="advert"]',
            '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
            'script', 'style', 'noscript',
        ];
        selectorsToRemove.forEach(selector => {
            doc.querySelectorAll(selector).forEach(element => element.remove());
        });

        doc.querySelectorAll('*').forEach(element => {
            element.removeAttribute('class');
        });
    }
}
