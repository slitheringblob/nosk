import { api } from './api-client.js';
import { toast } from './ui.js';
import { el, formatRelativeTime } from './utils.js';

/** Right-hand drawer with comment threads for the open page. */
export class CommentsPanel {
    constructor({ container, getUser, getPage, isPendingCreate = async () => false, onCountsChanged, onFocusBlock }) {
        this.container = container;
        this.getUser = getUser;
        this.getPage = getPage;
        this.isPendingCreate = isPendingCreate;
        this.onCountsChanged = onCountsChanged;
        this.onFocusBlock = onFocusBlock;
        this.comments = [];
        this.filterComponentId = null;
        this.showResolved = false;
        this.isOpen = false;
    }

    async load() {
        const page = this.getPage();
        this.comments = [];
        // A page created offline doesn't exist on the server until its create op syncs.
        if (!page || (await this.isPendingCreate(page.id))) {
            this.publishCounts();
            return;
        }
        try {
            this.comments = await api.get(`/api/pages/${page.id}/comments`);
        } catch {
            this.comments = [];
        }
        this.publishCounts();
        if (this.isOpen) this.render();
    }

    publishCounts() {
        const counts = new Map();
        for (const comment of this.comments) {
            if (comment.component_id && !comment.resolved)
                counts.set(comment.component_id, (counts.get(comment.component_id) || 0) + 1);
        }
        this.onCountsChanged(counts);
    }

    open(componentId = null) {
        this.filterComponentId = componentId;
        this.isOpen = true;
        this.container.hidden = false;
        document.body.classList.add('has-drawer');
        this.render();
        this.container.querySelector('textarea')?.focus();
    }

    close() {
        this.isOpen = false;
        this.container.hidden = true;
        document.body.classList.remove('has-drawer');
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    applyRemote(change) {
        const page = this.getPage();
        if (!page || change.page_id !== page.id) return;
        const data = change.data || {};
        if (change.type === 'comment_deleted') {
            this.comments = this.comments.filter((c) => c.id !== data.id);
        } else {
            const index = this.comments.findIndex((c) => c.id === data.id);
            if (index >= 0) this.comments[index] = data;
            else this.comments.push(data);
        }
        this.publishCounts();
        if (this.isOpen) this.render();
    }

    render() {
        const page = this.getPage();
        const user = this.getUser();
        const visible = this.comments.filter(
            (c) =>
                (this.showResolved || !c.resolved) &&
                (!this.filterComponentId || c.component_id === this.filterComponentId),
        );
        const header = el(
            'header',
            { className: 'drawer__header' },
            el(
                'div',
                {},
                el('div', { className: 'eyebrow' }, this.filterComponentId ? 'block thread' : 'page comments'),
                el('h2', {}, `Comments (${visible.length})`),
            ),
            el(
                'button',
                { type: 'button', className: 'icon-btn', ariaLabel: 'Close comments', onclick: () => this.close() },
                '×',
            ),
        );
        const controls = el('div', { className: 'drawer__controls' });
        if (this.filterComponentId) {
            controls.append(
                el(
                    'button',
                    {
                        type: 'button',
                        className: 'btn btn-ghost btn-sm',
                        onclick: () => {
                            this.filterComponentId = null;
                            this.render();
                        },
                    },
                    '← All comments',
                ),
            );
        }
        const resolvedToggle = el(
            'label',
            { className: 'checkbox-label' },
            el('input', {
                type: 'checkbox',
                checked: this.showResolved,
                onchange: (e) => {
                    this.showResolved = e.target.checked;
                    this.render();
                },
            }),
            ' show resolved',
        );
        controls.append(resolvedToggle);

        const list = el(
            'div',
            { className: 'comment-list' },
            ...(visible.length
                ? visible.map((comment) => this.renderComment(comment, page, user))
                : [el('p', { className: 'muted' }, 'No comments yet.')]),
        );

        const form = el('form', { className: 'comment-form' });
        const textarea = el('textarea', {
            placeholder: this.filterComponentId ? 'Reply on this block…' : 'Comment on this page…',
            required: true,
            maxLength: 5000,
        });
        form.append(
            textarea,
            el(
                'div',
                { className: 'comment-form__actions' },
                el('span', { className: 'muted' }, 'mod+enter to send'),
                el('button', { type: 'submit', className: 'btn btn-primary btn-sm' }, 'Comment'),
            ),
        );
        textarea.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
        });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const body = textarea.value.trim();
            if (!body) return;
            try {
                const comment = await api.post(`/api/pages/${page.id}/comments`, {
                    body,
                    component_id: this.filterComponentId,
                });
                if (!this.comments.some((c) => c.id === comment.id)) this.comments.push(comment);
                textarea.value = '';
                this.publishCounts();
                this.render();
            } catch (error) {
                toast(`Could not post comment: ${error.message}`, { type: 'error' });
            }
        });
        this.container.replaceChildren(header, controls, list, form);
    }

    renderComment(comment, page, user) {
        const mine = comment.user_id === user?.id;
        const canModerate = mine || page.role === 'owner';
        const actions = el('div', { className: 'comment__actions' });
        const resolve = el(
            'button',
            { type: 'button', className: 'link-btn' },
            comment.resolved ? 'Reopen' : 'Resolve',
        );
        resolve.addEventListener('click', () => this.update(comment, { resolved: !comment.resolved }));
        if (page.role !== 'viewer' || mine) actions.append(resolve);
        if (mine) {
            const edit = el('button', { type: 'button', className: 'link-btn' }, 'Edit');
            edit.addEventListener('click', () => {
                const body = window.prompt('Edit comment', comment.body);
                if (body?.trim()) this.update(comment, { body: body.trim() });
            });
            actions.append(edit);
        }
        if (canModerate) {
            const remove = el('button', { type: 'button', className: 'link-btn link-btn--danger' }, 'Delete');
            remove.addEventListener('click', async () => {
                await api.delete(`/api/comments/${comment.id}`);
                this.comments = this.comments.filter((c) => c.id !== comment.id);
                this.publishCounts();
                this.render();
            });
            actions.append(remove);
        }
        const meta = el(
            'div',
            { className: 'comment__meta' },
            el('span', { className: 'comment__author' }, comment.author_email),
            el('span', { className: 'muted' }, formatRelativeTime(comment.created_at)),
        );
        const blockLink =
            comment.component_id && !this.filterComponentId
                ? el(
                      'button',
                      {
                          type: 'button',
                          className: 'link-btn eyebrow',
                          onclick: () => this.onFocusBlock(comment.component_id),
                      },
                      '↳ on block',
                  )
                : null;
        return el(
            'article',
            { className: `comment${comment.resolved ? ' is-resolved' : ''}` },
            meta,
            blockLink,
            el('p', { className: 'comment__body' }, comment.body),
            actions,
        );
    }

    async update(comment, changes) {
        try {
            const updated = await api.put(`/api/comments/${comment.id}`, changes);
            const index = this.comments.findIndex((c) => c.id === comment.id);
            this.comments[index] = updated;
            this.publishCounts();
            this.render();
        } catch (error) {
            toast(error.message, { type: 'error' });
        }
    }
}
