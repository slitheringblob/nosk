import ListComponent from './list-base.js';
import { el } from '../utils.js';

const BULLETS = ['•', '◦', '▪', '▫'];

export default class BulletListComponent extends ListComponent {
    static type = 'bullet-list';
    static label = 'Bulleted list';
    static icon = '•';
    static description = 'Simple bulleted list';
    static keywords = ['bullet', 'list', 'ul', 'unordered'];

    containerClass() {
        return 'list-container bullet-list-container';
    }

    renderMarker(item) {
        return el(
            'span',
            { className: 'list-marker bullet', contentEditable: 'false' },
            BULLETS[item.indent_level % BULLETS.length],
        );
    }
}
