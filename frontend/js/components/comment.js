import BaseComponent from './base-component.js';
import { el } from '../utils.js';

/** An inline annotation / sticky note. Threaded discussion uses the comments panel instead. */
export default class CommentComponent extends BaseComponent {
    static type = 'comment';
    static label = 'Annotation';
    static icon = '🗨';
    static category = 'advanced';
    static description = 'Sticky note left in the page';
    static keywords = ['comment', 'annotation', 'note', 'sticky', 'review'];

    getDefaultContent() {
        return { text: '', author: this.services?.user?.()?.email || '', resolved: false };
    }

    renderBody() {
        if (!this.content.author && this.services.user?.()) {
            this.content.author = this.services.user().email;
        }
        const container = el('aside', { className: `annotation${this.content.resolved ? ' is-resolved' : ''}` });
        const resolve = el(
            'label',
            { className: 'annotation-resolve' },
            el('input', { type: 'checkbox', checked: this.content.resolved, disabled: this.readOnly }),
            ' resolved',
        );
        this.addEventListener(resolve.querySelector('input'), 'change', (event) => {
            this.update({ resolved: event.target.checked });
            container.classList.toggle('is-resolved', event.target.checked);
        });
        container.append(
            el(
                'div',
                { className: 'annotation-header' },
                el('span', { className: 'eyebrow' }, this.content.author || 'annotation'),
                resolve,
            ),
            this.editable({
                className: 'annotation-text',
                rich: false,
                value: this.content.text,
                placeholder: 'Write a note…',
                onInput: (text) => this.update({ text: text.slice(0, 2000), author: this.content.author }),
            }),
        );
        return container;
    }

    getText() {
        return this.content.text;
    }
}
