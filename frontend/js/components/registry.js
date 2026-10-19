import TextBlockComponent from './text-block.js';
import HeadingComponent from './heading.js';
import MarkdownComponent from './markdown.js';
import ChecklistComponent from './checklist.js';
import BulletListComponent from './bullet-list.js';
import NumberedListComponent from './numbered-list.js';
import ToggleComponent from './toggle.js';
import CalloutComponent from './callout.js';
import DividerComponent from './divider.js';
import QuoteComponent from './quote.js';
import CodeComponent from './code.js';
import TableComponent from './table.js';
import ImageComponent from './image.js';
import BookmarkComponent from './bookmark.js';
import EmbedComponent from './embed.js';
import FileComponent from './file.js';
import PropertiesComponent from './properties.js';
import DateComponent from './date.js';
import TagsComponent from './tags.js';
import ColumnsComponent from './columns.js';
import TemplateComponent from './template.js';
import MathComponent from './math.js';
import CommentComponent from './comment.js';
import PageLinkComponent from './page-link.js';
import CanvasComponent from './canvas.js';
import DatabaseComponent from './database.js';

export const CATEGORIES = [
    { id: 'basic', label: 'Basic' },
    { id: 'advanced', label: 'Advanced' },
    { id: 'media', label: 'Media' },
    { id: 'data', label: 'Data' },
];

// Slash commands from the plan, plus aliases for the extra block types.
const COMMANDS = {
    'text-block': ['text'],
    heading: ['h1', 'h2', 'h3'],
    markdown: ['md'],
    checklist: ['check', 'todo'],
    'bullet-list': ['bullet'],
    'numbered-list': ['number'],
    toggle: ['toggle'],
    callout: ['callout'],
    divider: ['divider'],
    quote: ['quote'],
    code: ['code'],
    table: ['table'],
    image: ['image'],
    bookmark: ['bookmark'],
    embed: ['embed'],
    file: ['file'],
    properties: ['props'],
    date: ['date'],
    tags: ['tags'],
    columns: ['columns'],
    template: ['template'],
    math: ['math'],
    comment: ['note'],
    'page-link': ['link'],
    canvas: ['draw'],
    database: ['db'],
};

class ComponentRegistry {
    constructor() {
        this.components = new Map();
        [
            TextBlockComponent,
            HeadingComponent,
            ChecklistComponent,
            BulletListComponent,
            NumberedListComponent,
            ToggleComponent,
            QuoteComponent,
            CalloutComponent,
            DividerComponent,
            MarkdownComponent,
            CodeComponent,
            TableComponent,
            MathComponent,
            ColumnsComponent,
            PageLinkComponent,
            TemplateComponent,
            CommentComponent,
            ImageComponent,
            BookmarkComponent,
            EmbedComponent,
            FileComponent,
            CanvasComponent,
            PropertiesComponent,
            DateComponent,
            TagsComponent,
            DatabaseComponent,
        ].forEach((ComponentClass) => this.register(ComponentClass));
    }

    register(ComponentClass) {
        this.components.set(ComponentClass.type, ComponentClass);
    }

    has(type) {
        return this.components.has(type);
    }

    get(type) {
        return this.components.get(type);
    }

    create(type, data, options) {
        const ComponentClass = this.components.get(type);
        if (!ComponentClass) throw new Error(`Unknown component type: ${type}`);
        return new ComponentClass({ ...data, type }, options);
    }

    getAvailableTypes() {
        return [...this.components.keys()];
    }

    getComponentInfo(type) {
        const ComponentClass = this.components.get(type);
        if (!ComponentClass) return { icon: '?', label: type, category: 'other', description: '', keywords: [] };
        const { icon, label, category, description, keywords, isContainer } = ComponentClass;
        return { type, icon, label, category, description, keywords, isContainer, commands: COMMANDS[type] || [] };
    }

    defaultContent(type) {
        return this.create(type, {}, {}).content;
    }

    /**
     * Entries shown in the slash/plus pickers. Headings expand into H1/H2/H3 so the plan's
     * /h1../h3 commands each map to a concrete choice.
     */
    pickerEntries() {
        const entries = [];
        for (const type of this.components.keys()) {
            const info = this.getComponentInfo(type);
            if (type === 'heading') {
                [1, 2, 3].forEach((level) =>
                    entries.push({
                        ...info,
                        key: `heading-${level}`,
                        icon: `H${level}`,
                        label: `Heading ${level}`,
                        commands: [`h${level}`],
                        content: { text: '', level },
                    }),
                );
            } else {
                entries.push({ ...info, key: type, content: null });
            }
        }
        return entries;
    }
}

export default new ComponentRegistry();
