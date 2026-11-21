import BaseComponent from './base-component.js';
import { el, stripHTML } from '../utils.js';

export default class QuoteComponent extends BaseComponent {
    static type = 'quote';
    static label = 'Quote';
    static icon = '❝';
    static description = 'Highlighted quotation';
    static keywords = ['quote', 'blockquote', 'citation'];

    getDefaultContent() {
        return { text: '', citation: null };
    }

    renderBody() {
        const quote = el('blockquote', { className: 'quote-container' });
        quote.append(
            this.editable({
                className: 'quote-text',
                value: this.content.text,
                placeholder: 'Quote',
                blockNavigation: true,
                onInput: (html) => this.update({ text: html }),
            }),
        );
        const citation = this.editable({
            tag: 'cite',
            className: 'quote-citation',
            rich: false,
            singleLine: true,
            value: this.content.citation || '',
            placeholder: this.readOnly ? '' : '— Source (optional)',
            onInput: (text) => this.update({ citation: text.trim() ? text.slice(0, 200) : null }),
        });
        if (this.readOnly && !this.content.citation) citation.hidden = true;
        quote.append(citation);
        return quote;
    }

    isEmpty() {
        return !stripHTML(this.content.text).trim();
    }

    getText() {
        return stripHTML(this.content.text);
    }
}
