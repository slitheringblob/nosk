import { api } from './api-client.js';
import { auth } from './auth.js';
import { confirmDialog, modal, toast } from './ui.js';
import { el, formatRelativeTime, stripHTML } from './utils.js';

function errorText(error) {
    return error?.details?.[0]?.message || error?.message || 'Something went wrong';
}

function tabs(body, definitions) {
    const bar = el('div', { className: 'tabs', role: 'tablist' });
    const panel = el('div', { className: 'tabs__panel' });
    const select = (definition) => {
        bar.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.id === definition.id));
        panel.replaceChildren();
        definition.render(panel);
    };
    definitions.forEach((definition, index) => {
        const button = el(
            'button',
            { type: 'button', role: 'tab', dataset: { id: definition.id } },
            `${String(index + 1).padStart(2, '0')}/${definition.label}`,
        );
        button.addEventListener('click', () => select(definition));
        bar.append(button);
    });
    body.append(bar, panel);
    select(definitions[0]);
}

// --- Sharing --------------------------------------------------------------------------

export function openShareDialog(page) {
    modal(
        'Share page',
        async (body) => {
            const isOwner = page.role === 'owner';
            const list = el('div', { className: 'share-list' });
            const draw = async () => {
                try {
                    const shares = await api.get(`/api/pages/${page.id}/shares`);
                    list.replaceChildren(
                        el(
                            'div',
                            { className: 'share-row' },
                            el('span', {}, page.owner_email || auth.user?.email),
                            el('span', { className: 'badge' }, 'owner'),
                        ),
                        ...shares.map((share) => {
                            const row = el('div', { className: 'share-row' }, el('span', {}, share.email));
                            if (isOwner) {
                                const role = el(
                                    'select',
                                    { ariaLabel: `Role for ${share.email}` },
                                    el('option', { value: 'viewer', selected: share.role === 'viewer' }, 'can view'),
                                    el('option', { value: 'editor', selected: share.role === 'editor' }, 'can edit'),
                                );
                                role.addEventListener('change', async () => {
                                    await api.post(`/api/pages/${page.id}/shares`, {
                                        email: share.email,
                                        role: role.value,
                                    });
                                    toast(
                                        `${share.email} ${role.value === 'editor' ? 'can now edit' : 'can now view'}`,
                                    );
                                });
                                const remove = el(
                                    'button',
                                    { type: 'button', className: 'icon-btn', ariaLabel: `Remove ${share.email}` },
                                    '×',
                                );
                                remove.addEventListener('click', async () => {
                                    await api.delete(`/api/pages/${page.id}/shares/${share.user_id}`);
                                    draw();
                                });
                                row.append(role, remove);
                            } else {
                                row.append(el('span', { className: 'badge' }, share.role));
                            }
                            return row;
                        }),
                    );
                } catch (error) {
                    list.replaceChildren(el('p', { className: 'form-error' }, errorText(error)));
                }
            };
            if (isOwner) {
                const form = el('form', { className: 'share-form' });
                const email = el('input', {
                    type: 'email',
                    placeholder: 'teammate@example.com',
                    required: true,
                    ariaLabel: 'Email',
                });
                const role = el(
                    'select',
                    { ariaLabel: 'Role' },
                    el('option', { value: 'editor' }, 'can edit'),
                    el('option', { value: 'viewer' }, 'can view'),
                );
                const error = el('p', { className: 'form-error' });
                form.append(email, role, el('button', { type: 'submit', className: 'btn btn-primary' }, 'Invite'));
                form.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    error.textContent = '';
                    try {
                        await api.post(`/api/pages/${page.id}/shares`, { email: email.value.trim(), role: role.value });
                        email.value = '';
                        draw();
                    } catch (err) {
                        error.textContent = errorText(err);
                    }
                });
                body.append(
                    el('p', { className: 'muted' }, 'Invite people who already have a nosk account.'),
                    form,
                    error,
                );
            } else {
                const leave = el('button', { type: 'button', className: 'btn btn-ghost' }, 'Leave page');
                leave.addEventListener('click', async () => {
                    if (
                        !(await confirmDialog('You will lose access to this page.', {
                            confirmLabel: 'Leave',
                            danger: true,
                        }))
                    )
                        return;
                    await api.delete(`/api/pages/${page.id}/shares/${auth.user.id}`);
                    toast('You left the page');
                });
                body.append(
                    el(
                        'p',
                        { className: 'muted' },
                        `Shared with you by ${page.owner_email}. Only the owner can invite people.`,
                    ),
                    leave,
                );
            }
            body.append(el('div', { className: 'eyebrow section-label' }, 'people with access'), list);
            draw();
        },
        { eyebrow: page.title },
    );
}

// --- History ----------------------------------------------------------------------------

const ACTIVITY_LABELS = {
    page_created: 'created the page',
    page_updated: 'updated page details',
    page_deleted: 'moved the page to trash',
    page_restored: 'restored the page',
    page_replaced: 'restored an earlier version',
    page_shared: 'changed sharing',
    page_unshared: 'removed someone',
    component_created: 'added',
    component_updated: 'edited',
    component_moved: 'moved',
    component_deleted: 'deleted a block',
    components_reordered: 'reordered blocks',
    comment_created: 'commented',
    comment_updated: 'updated a comment',
    comment_deleted: 'deleted a comment',
};

export function openHistoryDialog(page, { onRestored }) {
    modal(
        'History',
        (body, close) => {
            tabs(body, [
                {
                    id: 'versions',
                    label: 'versions',
                    render: async (panel) => {
                        const canEdit = page.role !== 'viewer';
                        if (canEdit) {
                            const save = el(
                                'button',
                                { type: 'button', className: 'btn btn-ghost btn-sm' },
                                '+ Save current version',
                            );
                            save.addEventListener('click', async () => {
                                const label = window.prompt('Name this version (optional)') ?? null;
                                if (label === null) return;
                                await api.post(`/api/pages/${page.id}/versions`, { label: label || null });
                                toast('Version saved');
                                close();
                                openHistoryDialog(page, { onRestored });
                            });
                            panel.append(save);
                        }
                        const list = el(
                            'div',
                            { className: 'version-list' },
                            el('p', { className: 'muted' }, 'Loading…'),
                        );
                        const preview = el(
                            'div',
                            { className: 'version-preview' },
                            el('p', { className: 'muted' }, 'Select a version to preview it.'),
                        );
                        panel.append(el('div', { className: 'version-layout' }, list, preview));
                        try {
                            const versions = await api.get(`/api/pages/${page.id}/versions`);
                            if (!versions.length) {
                                list.replaceChildren(
                                    el(
                                        'p',
                                        { className: 'muted' },
                                        'No versions yet. Versions are saved automatically as you edit.',
                                    ),
                                );
                                return;
                            }
                            list.replaceChildren(
                                ...versions.map((version) => {
                                    const item = el(
                                        'button',
                                        { type: 'button', className: 'version-item' },
                                        el(
                                            'span',
                                            { className: 'version-item__label' },
                                            version.label || (version.is_auto ? 'Auto-save' : 'Saved version'),
                                        ),
                                        el(
                                            'span',
                                            { className: 'muted' },
                                            `${new Date(version.created_at).toLocaleString()} · v${version.version} · ${version.component_count} blocks`,
                                        ),
                                    );
                                    item.addEventListener('click', async () => {
                                        list.querySelectorAll('.version-item').forEach((n) =>
                                            n.classList.toggle('is-active', n === item),
                                        );
                                        const detail = await api.get(`/api/pages/${page.id}/versions/${version.id}`);
                                        const blocks = detail.data.components.map((c) =>
                                            el(
                                                'div',
                                                { className: 'version-block' },
                                                el('span', { className: 'eyebrow' }, c.type),
                                                ' ',
                                                summarize(c),
                                            ),
                                        );
                                        const restore = el(
                                            'button',
                                            { type: 'button', className: 'btn btn-primary btn-sm', disabled: !canEdit },
                                            'Restore this version',
                                        );
                                        restore.addEventListener('click', async () => {
                                            if (
                                                !(await confirmDialog(
                                                    'The current page will be replaced. A copy of it is kept in history.',
                                                    { confirmLabel: 'Restore' },
                                                ))
                                            )
                                                return;
                                            const result = await api.post(
                                                `/api/pages/${page.id}/versions/${version.id}/restore`,
                                            );
                                            close();
                                            onRestored?.(result);
                                            toast('Version restored');
                                        });
                                        preview.replaceChildren(
                                            el('h3', {}, detail.title),
                                            restore,
                                            el('div', { className: 'version-blocks' }, ...blocks),
                                        );
                                    });
                                    return item;
                                }),
                            );
                        } catch (error) {
                            list.replaceChildren(el('p', { className: 'form-error' }, errorText(error)));
                        }
                    },
                },
                {
                    id: 'activity',
                    label: 'activity',
                    render: async (panel) => {
                        panel.append(el('p', { className: 'muted' }, 'Loading…'));
                        try {
                            const { activity } = await api.get(`/api/pages/${page.id}/activity`, { limit: 100 });
                            panel.replaceChildren(
                                el(
                                    'ol',
                                    { className: 'activity-list' },
                                    ...activity.map((entry) =>
                                        el(
                                            'li',
                                            {},
                                            el(
                                                'span',
                                                { className: 'activity__who' },
                                                entry.user_id === auth.user?.id ? 'You' : entry.user_email,
                                            ),
                                            ` ${ACTIVITY_LABELS[entry.type] || entry.type}${entry.component_type ? ` a ${entry.component_type}` : ''}`,
                                            el(
                                                'span',
                                                { className: 'muted' },
                                                ` · ${formatRelativeTime(entry.timestamp)}`,
                                            ),
                                        ),
                                    ),
                                ),
                            );
                        } catch (error) {
                            panel.replaceChildren(el('p', { className: 'form-error' }, errorText(error)));
                        }
                    },
                },
            ]);
        },
        { wide: true, eyebrow: page.title },
    );
}

function summarize(component) {
    const c = component.content || {};
    const text =
        c.text ??
        c.title ??
        c.source ??
        c.code ??
        c.latex ??
        (c.items ? c.items.map((i) => i.text ?? `${i.key}: ${i.value}`).join(' · ') : '') ??
        '';
    return stripHTML(String(text)).slice(0, 140);
}

// --- Trash ------------------------------------------------------------------------------

export function openTrashDialog({ storage, sync, onChanged }) {
    modal(
        'Trash',
        async (body) => {
            const draw = async () => {
                const pages = (await storage.getPages()).filter((p) => p.deleted && p.role === 'owner');
                body.replaceChildren(
                    pages.length
                        ? el(
                              'div',
                              { className: 'trash-list' },
                              ...pages.map((page) => {
                                  const restore = el(
                                      'button',
                                      { type: 'button', className: 'btn btn-ghost btn-sm' },
                                      'Restore',
                                  );
                                  restore.addEventListener('click', async () => {
                                      await storage.updatePage(page.id, (stored) => {
                                          stored.deleted = false;
                                      });
                                      await sync.queue({ type: 'restore_page', page_id: page.id });
                                      onChanged();
                                      draw();
                                  });
                                  const purge = el(
                                      'button',
                                      { type: 'button', className: 'btn btn-danger btn-sm' },
                                      'Delete forever',
                                  );
                                  purge.addEventListener('click', async () => {
                                      if (
                                          !(await confirmDialog(
                                              `Permanently delete "${page.title}"? This cannot be undone.`,
                                              { confirmLabel: 'Delete forever', danger: true },
                                          ))
                                      )
                                          return;
                                      await sync.queue({
                                          type: 'delete_page',
                                          page_id: page.id,
                                          data: { permanent: true },
                                      });
                                      await storage.deletePage(page.id);
                                      onChanged();
                                      draw();
                                  });
                                  return el(
                                      'div',
                                      { className: 'trash-row' },
                                      el('span', {}, `${page.icon || '📄'} ${page.title}`),
                                      el('span', { className: 'muted' }, formatRelativeTime(page.updated_at)),
                                      restore,
                                      purge,
                                  );
                              }),
                          )
                        : el('p', { className: 'muted' }, 'Trash is empty.'),
                );
            };
            draw();
        },
        { eyebrow: 'deleted pages' },
    );
}

// --- Conflicts --------------------------------------------------------------------------

function describe(data) {
    if (!data) return '(deleted)';
    if (data.content) return summarize(data) || `(${data.type})`;
    return data.title || '(page)';
}

export function openConflictsDialog({ storage, sync }) {
    modal(
        'Sync conflicts',
        async (body) => {
            const draw = async () => {
                const conflicts = await storage.getConflicts();
                if (!conflicts.length) {
                    body.replaceChildren(el('p', { className: 'muted' }, 'No conflicts. Everything is in sync.'));
                    return;
                }
                body.replaceChildren(
                    el(
                        'p',
                        { className: 'muted' },
                        'These changes were made here while the same thing changed on another device. Choose which version to keep — nothing is discarded until you decide.',
                    ),
                    ...conflicts.map((conflict) => {
                        const deleted = conflict.reason === 'entity_deleted';
                        const mine = el(
                            'button',
                            { type: 'button', className: 'btn btn-primary btn-sm' },
                            deleted ? 'Restore mine' : 'Keep mine',
                        );
                        const theirs = el(
                            'button',
                            { type: 'button', className: 'btn btn-ghost btn-sm' },
                            deleted ? 'Accept deletion' : 'Keep theirs',
                        );
                        mine.addEventListener('click', async () => {
                            await sync.resolveConflict(conflict, 'mine');
                            draw();
                        });
                        theirs.addEventListener('click', async () => {
                            await sync.resolveConflict(conflict, 'theirs');
                            draw();
                        });
                        return el(
                            'div',
                            { className: 'conflict' },
                            el(
                                'div',
                                { className: 'eyebrow' },
                                `${conflict.entity_type} · ${conflict.reason.replace('_', ' ')}`,
                            ),
                            el(
                                'div',
                                { className: 'conflict__compare' },
                                el(
                                    'div',
                                    {},
                                    el('div', { className: 'eyebrow' }, 'this device'),
                                    el('p', {}, describe(conflict.local_data)),
                                ),
                                el(
                                    'div',
                                    {},
                                    el('div', { className: 'eyebrow' }, 'server'),
                                    el(
                                        'p',
                                        {},
                                        deleted ? '(deleted on another device)' : describe(conflict.server_data),
                                    ),
                                ),
                            ),
                            el('div', { className: 'modal__actions' }, theirs, mine),
                        );
                    }),
                );
            };
            draw();
        },
        { wide: true, eyebrow: 'review' },
    );
}

// --- Import & templates -----------------------------------------------------------------

export function openImportDialog({ onImported }) {
    modal(
        'Import',
        (body, close) => {
            const file = el('input', { type: 'file', accept: '.md,.markdown,.txt,.json' });
            const text = el('textarea', { className: 'import-text', placeholder: 'Or paste Markdown here…', rows: 10 });
            const error = el('p', { className: 'form-error' });
            const go = el('button', { type: 'button', className: 'btn btn-primary' }, 'Import');
            go.addEventListener('click', async () => {
                error.textContent = '';
                let content = text.value;
                let format = 'markdown';
                let title;
                if (file.files[0]) {
                    content = await file.files[0].text();
                    format = file.files[0].name.endsWith('.json') ? 'json' : 'markdown';
                    title = file.files[0].name.replace(/\.(md|markdown|txt|json)$/i, '');
                }
                if (!content.trim()) {
                    error.textContent = 'Choose a file or paste some Markdown.';
                    return;
                }
                try {
                    const page = await api.post('/api/pages/import', {
                        format,
                        content,
                        title: format === 'markdown' && !/^#\s/m.test(content) ? title : undefined,
                    });
                    close();
                    onImported(page);
                } catch (err) {
                    error.textContent = errorText(err);
                }
            });
            body.append(
                el(
                    'p',
                    { className: 'muted' },
                    'Markdown files (including Notion and Obsidian exports) or nosk JSON exports.',
                ),
                el('label', { className: 'field' }, el('span', { className: 'eyebrow' }, 'file'), file),
                text,
                error,
                el('div', { className: 'modal__actions' }, go),
            );
        },
        { eyebrow: 'markdown · json' },
    );
}

export function openTemplatesDialog({ onCreated }) {
    modal(
        'New from template',
        async (body, close) => {
            body.append(el('p', { className: 'muted' }, 'Loading…'));
            try {
                const { templates } = await api.get('/api/templates');
                body.replaceChildren(
                    el(
                        'div',
                        { className: 'template-grid' },
                        ...templates.map((template) => {
                            const card = el(
                                'button',
                                { type: 'button', className: 'template-card' },
                                el('span', { className: 'template-card__icon' }, template.icon || '📄'),
                                el('span', { className: 'template-card__title' }, template.title),
                                el(
                                    'span',
                                    { className: 'muted' },
                                    template.description || (template.builtin ? '' : 'Your template'),
                                ),
                                el('span', { className: 'eyebrow' }, template.builtin ? 'built-in' : 'yours'),
                            );
                            card.addEventListener('click', async () => {
                                try {
                                    const page = await api.post('/api/pages/from-template', {
                                        template_id: template.id,
                                    });
                                    close();
                                    onCreated(page);
                                } catch (error) {
                                    toast(errorText(error), { type: 'error' });
                                }
                            });
                            return card;
                        }),
                    ),
                );
            } catch (error) {
                body.replaceChildren(
                    el('p', { className: 'form-error' }, `Templates need a connection. ${errorText(error)}`),
                );
            }
        },
        { wide: true, eyebrow: 'templates' },
    );
}

// --- Settings ---------------------------------------------------------------------------

export function openSettingsDialog({ onLogout, theme, journal, storage }) {
    modal(
        'Settings',
        (body) => {
            tabs(body, [
                {
                    id: 'account',
                    label: 'account',
                    render: (panel) => {
                        const user = auth.user;
                        panel.append(
                            el(
                                'dl',
                                { className: 'kv' },
                                el('dt', {}, 'email'),
                                el('dd', {}, user?.email || ''),
                                el('dt', {}, 'status'),
                                el('dd', {}, user?.is_verified ? 'verified' : 'not verified'),
                                el('dt', {}, 'device'),
                                el('dd', {}, auth.deviceId || ''),
                            ),
                        );
                        if (!user?.is_verified) {
                            const resend = el(
                                'button',
                                { type: 'button', className: 'btn btn-ghost btn-sm' },
                                'Resend verification email',
                            );
                            resend.addEventListener('click', async () => {
                                await api.post('/api/auth/request-verification', { email: user.email });
                                toast('Verification email sent');
                            });
                            panel.append(resend);
                        }
                        const form = el('form', { className: 'form' });
                        const current = el('input', {
                            type: 'password',
                            autocomplete: 'current-password',
                            required: true,
                        });
                        const next = el('input', {
                            type: 'password',
                            autocomplete: 'new-password',
                            minLength: 8,
                            maxLength: 100,
                            required: true,
                        });
                        const error = el('p', { className: 'form-error' });
                        form.append(
                            el('div', { className: 'eyebrow section-label' }, 'change password'),
                            el('label', { className: 'field' }, el('span', {}, 'Current password'), current),
                            el('label', { className: 'field' }, el('span', {}, 'New password (8+ characters)'), next),
                            error,
                            el('button', { type: 'submit', className: 'btn btn-primary' }, 'Update password'),
                        );
                        form.addEventListener('submit', async (event) => {
                            event.preventDefault();
                            error.textContent = '';
                            try {
                                await api.post('/api/auth/change-password', {
                                    current_password: current.value,
                                    new_password: next.value,
                                });
                                form.reset();
                                toast('Password updated. Other devices were signed out.');
                            } catch (err) {
                                error.textContent = errorText(err);
                            }
                        });
                        const logout = el('button', { type: 'button', className: 'btn btn-ghost' }, 'Sign out');
                        logout.addEventListener('click', onLogout);
                        panel.append(form, el('div', { className: 'modal__actions' }, logout));
                    },
                },
                {
                    id: 'journal',
                    label: 'journal',
                    render: async (panel) => {
                        const settings = journal.cachedSettings();
                        let builtins = [];
                        try {
                            builtins = JSON.parse(localStorage.getItem('nosk.templates.builtin') || '[]');
                        } catch {
                            builtins = [];
                        }
                        const mine = (await storage.getPages()).filter(
                            (p) => p.is_template && p.role === 'owner' && !p.deleted,
                        );
                        const select = el(
                            'select',
                            { id: 'journal-template', ariaLabel: 'Journal template' },
                            el('option', { value: '', selected: !settings.journal_template_id }, 'Blank page'),
                            ...builtins.map((t) =>
                                el(
                                    'option',
                                    { value: t.id, selected: t.id === settings.journal_template_id },
                                    `${t.title} (built-in)`,
                                ),
                            ),
                            ...mine.map((p) =>
                                el('option', { value: p.id, selected: p.id === settings.journal_template_id }, p.title),
                            ),
                        );
                        const status = el('p', { className: 'muted' });
                        select.addEventListener('change', async () => {
                            status.textContent = 'Saving…';
                            try {
                                await journal.saveSettings({ journal_template_id: select.value || null });
                                await journal.warmTemplate(select.value || null);
                                status.textContent = 'Saved. New journal days will use this template.';
                            } catch (error) {
                                status.textContent = `Not saved: ${errorText(error)}`;
                            }
                        });
                        panel.append(
                            el(
                                'label',
                                { className: 'field', htmlFor: 'journal-template' },
                                el('span', { className: 'eyebrow' }, 'template for new days'),
                                select,
                            ),
                            el(
                                'p',
                                { className: 'muted' },
                                'Each day gets its own page, created the first time you open it with "today" (Ctrl/⌘+Alt+J). Existing days are not changed. To make your own, build a page and use "Save as template" from its ⋯ menu.',
                            ),
                            status,
                        );
                    },
                },
                {
                    id: 'devices',
                    label: 'devices',
                    render: async (panel) => {
                        const draw = async () => {
                            const { sessions } = await api.get('/api/auth/sessions');
                            panel.replaceChildren(
                                el(
                                    'div',
                                    { className: 'session-list' },
                                    ...sessions.map((session) => {
                                        const row = el(
                                            'div',
                                            { className: 'session-row' },
                                            el(
                                                'div',
                                                {},
                                                el(
                                                    'div',
                                                    {},
                                                    session.device_name || session.device_id,
                                                    session.current
                                                        ? el('span', { className: 'badge' }, 'this device')
                                                        : null,
                                                ),
                                                el(
                                                    'div',
                                                    { className: 'muted' },
                                                    `last active ${formatRelativeTime(session.last_used_at || session.issued_at)}${session.ip_address ? ` · ${session.ip_address}` : ''}`,
                                                ),
                                            ),
                                        );
                                        if (!session.current) {
                                            const revoke = el(
                                                'button',
                                                { type: 'button', className: 'btn btn-ghost btn-sm' },
                                                'Sign out',
                                            );
                                            revoke.addEventListener('click', async () => {
                                                await api.delete(`/api/auth/sessions/${session.session_id}`);
                                                draw();
                                            });
                                            row.append(revoke);
                                        }
                                        return row;
                                    }),
                                ),
                            );
                        };
                        try {
                            await draw();
                        } catch (error) {
                            panel.append(el('p', { className: 'form-error' }, errorText(error)));
                        }
                    },
                },
                {
                    id: 'appearance',
                    label: 'appearance',
                    render: (panel) => {
                        const choices = ['system', 'dark', 'light'];
                        const group = el('div', { className: 'segmented', role: 'radiogroup' });
                        choices.forEach((choice) => {
                            const button = el(
                                'button',
                                {
                                    type: 'button',
                                    className: theme.get() === choice ? 'is-active' : '',
                                    role: 'radio',
                                    ariaChecked: String(theme.get() === choice),
                                },
                                choice,
                            );
                            button.addEventListener('click', () => {
                                theme.set(choice);
                                group
                                    .querySelectorAll('button')
                                    .forEach((b) => b.classList.toggle('is-active', b === button));
                            });
                            group.append(button);
                        });
                        panel.append(el('div', { className: 'eyebrow section-label' }, 'theme'), group);
                    },
                },
                {
                    id: 'shortcuts',
                    label: 'shortcuts',
                    render: (panel) => {
                        const rows = [
                            ['mod+K', 'Quick actions'],
                            ['mod+F', 'Search all pages'],
                            ['mod+S', 'Sync now'],
                            ['mod+Z / mod+shift+Z', 'Undo / redo block changes'],
                            ['/', 'Insert block (in an empty line)'],
                            ['mod+B / I / E', 'Bold / italic / inline code'],
                            ['mod+K (in text)', 'Add link'],
                            ['mod+shift+S', 'Strikethrough'],
                            ['mod+shift+H', 'Highlight'],
                            ['mod+↑ / mod+↓', 'Move block up / down'],
                            ['mod+D', 'Duplicate block'],
                            ['mod+Enter', 'New text block / exit list'],
                            ['Tab / shift+Tab', 'Indent / outdent list item'],
                            ['mod+alt+N', 'New page'],
                            ['mod+shift+C', 'Toggle comments'],
                        ];
                        panel.append(
                            el(
                                'table',
                                { className: 'shortcut-table' },
                                ...rows.map(([keys, action]) =>
                                    el(
                                        'tr',
                                        {},
                                        el(
                                            'td',
                                            {},
                                            ...keys
                                                .split(' / ')
                                                .flatMap((combo, i) => [i ? ' / ' : '', el('kbd', {}, combo)]),
                                        ),
                                        el('td', {}, action),
                                    ),
                                ),
                            ),
                        );
                    },
                },
            ]);
        },
        { wide: true, eyebrow: 'nosk' },
    );
}
