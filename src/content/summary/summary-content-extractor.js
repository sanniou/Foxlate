export class SummaryContentExtractor {
    constructor({ settings, documentRef = document } = {}) {
        this.settings = settings;
        this.document = documentRef;
    }

    async extractPageContent() {
        const selector = this.settings.summarySettings?.mainBodySelector;
        let content = '';

        if (selector) {
            const element = this.document.querySelector(selector);
            if (element) {
                const doc = this.document.implementation.createHTMLDocument('');
                doc.body.innerHTML = element.innerHTML;
                content = await this.#getReadabilityContent(doc);
                if (!content) {
                    content = element.innerText;
                }
            }
        }

        if (!content) {
            const docClone = this.document.cloneNode(true);
            content = await this.#getReadabilityContent(docClone);
        }

        if (!content) {
            console.warn('[Foxlate Summary] Fallback to body.innerText.');
            content = this.document.body.innerText;
        }

        return content;
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
        const selectorsToRemove = ['header', 'footer', 'nav', 'aside', '.ad', '#ad', '[class*="advert"]'];
        selectorsToRemove.forEach(selector => {
            doc.querySelectorAll(selector).forEach(element => element.remove());
        });

        doc.querySelectorAll('*').forEach(element => {
            element.removeAttribute('class');
        });
    }
}
