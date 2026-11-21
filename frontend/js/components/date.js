import BaseComponent from './base-component.js';
import { el } from '../utils.js';

export function describeDate(value, includeTime) {
    if (!value) return '';
    const date = new Date(includeTime ? value : `${value.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const days = Math.round((day - today) / 86_400_000);
    const relative =
        days === 0
            ? 'today'
            : days === 1
              ? 'tomorrow'
              : days === -1
                ? 'yesterday'
                : days > 0
                  ? `in ${days} days`
                  : `${-days} days ago`;
    const formatted =
        date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) +
        (includeTime ? ` ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '');
    return `${formatted} · ${relative}`;
}

export default class DateComponent extends BaseComponent {
    static type = 'date';
    static label = 'Date';
    static icon = '📅';
    static category = 'data';
    static description = 'Date or date & time';
    static keywords = ['date', 'time', 'deadline', 'due', 'calendar', 'reminder'];

    getDefaultContent() {
        return { date: null, include_time: false, label: '' };
    }

    renderBody() {
        const container = el('div', { className: 'date-container' });
        const label = this.editable({
            className: 'date-label',
            rich: false,
            singleLine: true,
            value: this.content.label,
            placeholder: this.readOnly ? '' : 'Label',
            onInput: (text) => this.update({ label: text.slice(0, 100) }),
        });
        const summary = el(
            'span',
            { className: 'date-summary' },
            describeDate(this.content.date, this.content.include_time) || 'No date',
        );
        container.append(el('span', { className: 'date-icon' }, '📅'), label);
        if (!this.readOnly) {
            const toLocalInput = (iso) => {
                if (!iso) return '';
                if (!this.content.include_time) return iso.slice(0, 10);
                const d = new Date(iso);
                const pad = (n) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };
            const input = el('input', {
                type: this.content.include_time ? 'datetime-local' : 'date',
                value: toLocalInput(this.content.date),
                ariaLabel: 'Date',
            });
            this.addEventListener(input, 'change', () => {
                const value = !input.value
                    ? null
                    : this.content.include_time
                      ? new Date(input.value).toISOString()
                      : input.value;
                this.update({ date: value });
                summary.textContent = describeDate(value, this.content.include_time) || 'No date';
            });
            const time = el(
                'label',
                { className: 'date-time-toggle' },
                el('input', { type: 'checkbox', checked: this.content.include_time }),
                ' time',
            );
            this.addEventListener(time.querySelector('input'), 'change', (event) => {
                const includeTime = event.target.checked;
                let { date } = this.content;
                if (date && includeTime) date = new Date(`${date.slice(0, 10)}T09:00`).toISOString();
                if (date && !includeTime) date = toLocalInput(date).slice(0, 10) || date.slice(0, 10);
                this.update({ include_time: includeTime, date });
                this.refresh();
            });
            container.append(input, time);
        }
        container.append(summary);
        return container;
    }

    getText() {
        return [this.content.label, this.content.date].filter(Boolean).join(' ');
    }
}
