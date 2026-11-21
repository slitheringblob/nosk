// Shared UI primitives: popover menus, toasts and modal dialogs.
import { el } from './utils.js';

let openMenu = null;

export function closeMenu() {
    openMenu?.close();
    openMenu = null;
}

function positionNear(popover, anchor) {
    const rect = anchor instanceof DOMRect ? anchor : anchor.getBoundingClientRect();
    const { innerWidth, innerHeight } = window;
    popover.style.left = '0px';
    popover.style.top = '0px';
    const { width, height } = popover.getBoundingClientRect();
    let left = Math.min(rect.left, innerWidth - width - 12);
    let top = rect.bottom + 6;
    if (top + height > innerHeight - 12) top = Math.max(12, rect.top - height - 6);
    left = Math.max(12, left);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

/**
 * Show a menu of items near `anchor`. Items: { label, icon?, hint?, danger?, disabled?, onSelect }
 * or { separator: true } or { heading: 'Label' }. Arrow keys / Enter / Escape navigate.
 */
export function showMenu(anchor, items, { className = '' } = {}) {
    closeMenu();
    const menu = el('div', { className: `menu ${className}`.trim(), role: 'menu', tabIndex: -1 });
    const buttons = [];
    for (const item of items) {
        if (item.separator) {
            menu.append(el('div', { className: 'menu__separator', role: 'separator' }));
        } else if (item.heading) {
            menu.append(el('div', { className: 'menu__heading' }, item.heading));
        } else {
            const button = el(
                'button',
                {
                    type: 'button',
                    role: 'menuitem',
                    className: `menu__item${item.danger ? ' menu__item--danger' : ''}`,
                    disabled: item.disabled,
                },
                el('span', { className: 'menu__icon' }, item.icon || ''),
                el('span', { className: 'menu__label' }, item.label),
                item.hint ? el('kbd', { className: 'menu__hint' }, item.hint) : null,
            );
            button.addEventListener('click', () => {
                closeMenu();
                item.onSelect?.();
            });
            buttons.push(button);
            menu.append(button);
        }
    }
    document.body.append(menu);
    positionNear(menu, anchor);

    const onKey = (event) => {
        const index = buttons.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const next = buttons[(index + step + buttons.length) % buttons.length];
            next?.focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu();
        }
    };
    const onOutside = (event) => {
        if (!menu.contains(event.target)) closeMenu();
    };
    menu.addEventListener('keydown', onKey);
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
    openMenu = {
        element: menu,
        close: () => {
            document.removeEventListener('mousedown', onOutside);
            menu.remove();
        },
    };
    buttons.find((b) => !b.disabled)?.focus();
    return openMenu;
}

export function toast(message, { type = 'info', timeout = 3500, action } = {}) {
    let region = document.querySelector('.toast-region');
    if (!region) {
        region = el('div', { className: 'toast-region', role: 'status', ariaLive: 'polite' });
        document.body.append(region);
    }
    const item = el('div', { className: `toast toast--${type}` }, el('span', {}, message));
    if (action) {
        const button = el('button', { type: 'button', className: 'toast__action' }, action.label);
        button.addEventListener('click', () => {
            action.onSelect();
            item.remove();
        });
        item.append(button);
    }
    region.append(item);
    setTimeout(() => item.remove(), timeout);
}

/**
 * Modal dialog. `render(body, close)` fills the body. Returns { close, element }.
 * Escape and backdrop clicks close it; focus returns to the previously focused element.
 */
export function modal(title, render, { wide = false, eyebrow = '' } = {}) {
    const previous = document.activeElement;
    const backdrop = el('div', { className: 'modal-backdrop' });
    const body = el('div', { className: 'modal__body' });
    const closeButton = el('button', { type: 'button', className: 'icon-btn', ariaLabel: 'Close' }, '×');
    const dialog = el(
        'div',
        {
            className: `modal${wide ? ' modal--wide' : ''}`,
            role: 'dialog',
            ariaModal: 'true',
            ariaLabel: title,
        },
        el(
            'header',
            { className: 'modal__header' },
            el(
                'div',
                {},
                eyebrow ? el('div', { className: 'eyebrow' }, eyebrow) : null,
                el('h2', { className: 'modal__title' }, title),
            ),
            closeButton,
        ),
        body,
    );
    backdrop.append(dialog);
    const close = () => {
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
        previous?.focus?.();
    };
    const onKey = (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    };
    closeButton.addEventListener('click', close);
    backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    render(body, close);
    (body.querySelector('input, textarea, select, button') || closeButton).focus();
    return { close, element: dialog };
}

export function confirmDialog(message, { confirmLabel = 'Confirm', danger = false } = {}) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value, close) => {
            settled = true;
            close();
            resolve(value);
        };
        const handle = modal('Are you sure?', (body, close) => {
            const cancel = el('button', { type: 'button', className: 'btn btn-ghost' }, 'Cancel');
            const ok = el(
                'button',
                { type: 'button', className: `btn ${danger ? 'btn-danger' : 'btn-primary'}` },
                confirmLabel,
            );
            cancel.addEventListener('click', () => finish(false, close));
            ok.addEventListener('click', () => finish(true, close));
            body.append(el('p', {}, message), el('div', { className: 'modal__actions' }, cancel, ok));
            setTimeout(() => ok.focus(), 0);
        });
        const observer = new MutationObserver(() => {
            if (!handle.element.isConnected) {
                observer.disconnect();
                if (!settled) resolve(false);
            }
        });
        observer.observe(document.body, { childList: true });
    });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', confirmLabel = 'Save' } = {}) {
    return new Promise((resolve) => {
        let settled = false;
        const handle = modal(title, (body, close) => {
            const form = el('form', { className: 'form' });
            const input = el('input', { value, placeholder, ariaLabel: label || title });
            form.append(
                label ? el('label', { className: 'field' }, el('span', { className: 'eyebrow' }, label), input) : input,
                el(
                    'div',
                    { className: 'modal__actions' },
                    el(
                        'button',
                        {
                            type: 'button',
                            className: 'btn btn-ghost',
                            onclick: () => {
                                settled = true;
                                close();
                                resolve(null);
                            },
                        },
                        'Cancel',
                    ),
                    el('button', { type: 'submit', className: 'btn btn-primary' }, confirmLabel),
                ),
            );
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                settled = true;
                close();
                resolve(input.value);
            });
            body.append(form);
            setTimeout(() => input.select(), 0);
        });
        const observer = new MutationObserver(() => {
            if (!handle.element.isConnected) {
                observer.disconnect();
                if (!settled) resolve(null);
            }
        });
        observer.observe(document.body, { childList: true });
    });
}
