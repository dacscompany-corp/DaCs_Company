// ════════════════════════════════════════════════════════════════════
// Work Plan → one task (WorkMate My Work, 0093). Owner + staff.
//
// Who is on it and who has read the CURRENT version; open problems (the
// office clears them, with a note, after checking — delivered materials
// never clear a problem by themselves, spec §8); what it waits for;
// photos (private task-photos, signed links); the history (a revision
// says what changed); and the decisions: publish a draft, approve
// reported work, send back, reopen, cancel or decline a proposal (a
// reason is required where the server asks). A leader's check never
// replaces the office approval.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;
    const tickets = WP.loadTickets();   // only the newest task load may draw

    function card(title, body) {
        return '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">' + esc(title) +
            '</div></div></div><div class="att-card-body">' + body + '</div></div>';
    }
    function btn(act, label, cls) {
        return '<button class="att-btn' + (cls ? ' ' + cls : '') + '" type="button" data-act="' + act + '">' + esc(label) + '</button>';
    }

    function actionsHtml(t) {
        const out = [];
        if (t.status === 'reported_done' || t.status === 'leader_checked') {
            out.push(btn('approve', 'Approve — completed', 'att-btn--primary'));
            out.push(btn('send_back', 'Send back'));
        }
        if (t.status === 'draft') out.push(btn('publish', 'Publish', 'att-btn--primary'));
        if (t.status === 'completed') out.push(btn('reopen', 'Reopen'));
        if (t.status !== 'completed' && t.status !== 'cancelled') {
            out.push(btn('edit', 'Edit'));
            out.push(btn('cancel', t.status === 'draft' && t.proposed_by ? 'Decline' : 'Cancel task', 'att-btn--warn'));
        }
        return out.join('');
    }

    function peopleHtml(t) {
        const acks = t.acks || [];
        const team = t.team_name ? 'Team: ' + esc(t.team_name) : 'Individual task (no team)';
        if (!acks.length) return '<div class="req-muted">No one assigned yet — edit the task to choose the responsible person.</div>' +
            '<div class="req-muted">' + team + '</div>';
        return '<ul class="wp-list">' + acks.map(a =>
            '<li><strong>' + esc(a.name) + '</strong> <span class="req-muted">' + (a.role === 'responsible' ? 'Responsible' : 'Helper') + '</span> ' +
            (t.status === 'draft' ? '' : a.acked
                ? '<span class="att-pill att-pill--done">Read version ' + esc(t.version) + '</span>'
                : '<span class="att-pill att-pill--working">Has not read version ' + esc(t.version) + '</span>') +
            '</li>').join('') + '</ul><div class="req-muted">' + team + '</div>';
    }

    function problemsHtml(t) {
        const blockers = t.blockers || [];
        const waits = t.waiting_for || [];
        if (!blockers.length && !waits.length) return '<div class="req-muted">Nothing is holding this task.</div>';
        return blockers.map(b =>
                '<div class="wp-row"><div><strong>' + esc(WP.blockerKind(b.kind)) + '</strong> — ' + esc(b.description) +
                '<div class="req-muted">' + esc(b.reported_by) + ' · ' + esc(WP.formatManila(b.reported_at)) + '</div></div>' +
                '<button class="att-btn" type="button" data-clear="' + esc(b.id) + '">Clear…</button></div>').join('') +
            waits.map(w =>
                '<div class="wp-row"><div>Waits for <strong>' + esc(w.title) + '</strong> <span class="req-muted">(' +
                esc(WP.STATUS_LABEL[w.status] || w.status) + ')</span></div>' +
                '<button class="att-link" type="button" data-open="' + esc(w.task_id) + '">Open</button></div>').join('');
    }

    function photosHtml(t) {
        const photos = t.photos || [];
        if (!photos.length) return '<div class="req-muted">No photos.</div>';
        return '<div class="req-photos">' + photos.map(p =>
            '<div class="wp-photo"><img class="req-photo" alt="Task photo" data-sign-bucket="task-photos" data-sign-path="' + esc(p.path) + '">' +
            '<div class="req-muted">' + esc(WP.formatManila(p.created_at)) + (p.blocker_id ? ' · problem photo' : '') +
            '</div></div>').join('') + '</div>';
    }

    function historyHtml(t) {
        const events = (t.history || []).slice().reverse();
        if (!events.length) return '<div class="req-muted">No history yet.</div>';
        return '<ul class="wp-list">' + events.map(e =>
            '<li><div class="req-muted">' + esc(WP.formatManila(e.at)) + ' · ' + esc(e.by) + '</div><div>' + esc(WP.eventText(e)) +
            '</div></li>').join('') + '</ul>';
    }

    function textModal(o) {
        WP.modal({
            title: o.title, sub: o.sub, warn: !!o.warn, submitLabel: o.submitLabel,
            body: '<div class="att-field att-span"><label for="wpReason">' + esc(o.label) + '</label>' +
                  '<textarea class="att-input" id="wpReason" name="reason" rows="3" maxlength="500"></textarea></div>',
            onSubmit: form => o.call(form.reason.value.trim()),
            onDone: o.onDone,
        });
    }

    function wire(host, t, rerender) {
        host.querySelector('[data-back]').addEventListener('click', () => root.switchView('wpBoard'));
        const meeting = host.querySelector('[data-meeting]');
        if (meeting) meeting.addEventListener('click', () => WP.openMeeting(t.meeting_id));
        host.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => WP.openTask(b.dataset.open)));
        host.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => textModal({
            title: 'Clear this problem', sub: 'Only after checking the materials, tool or preparation really are ready for this task.',
            label: 'What was checked', submitLabel: 'Clear problem', onDone: rerender,
            call: note => WP.rpc('wp_office_clear_blocker', { p_blocker: b.dataset.clear, p_note: note }),
        })));
        host.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
            const id = t.id;
            switch (b.dataset.act) {
                case 'edit':
                    WP.openTaskForm({ taskId: id, doc: t, onDone: rerender });
                    break;
                case 'publish':
                    WP.modal({
                        title: 'Publish this task?', sub: 'Everyone on it sees it in My Work and must read it.', submitLabel: 'Publish',
                        body: '', onDone: rerender,
                        onSubmit: () => WP.rpc('wp_office_publish', { p_meeting: null, p_tasks: [id], p_shared_notes: null,
                                                                      p_recipients: null, p_change_note: null }),
                    });
                    break;
                case 'approve':
                    textModal({ title: 'Approve as completed', sub: 'Tasks that wait for this one can then start.',
                        label: 'Note (optional)', submitLabel: 'Approve', onDone: rerender,
                        call: note => WP.rpc('wp_office_approve', { p_task: id, p_note: note }) });
                    break;
                case 'send_back':
                    textModal({ title: 'Send back', sub: 'The task returns to In progress, marked Sent back.',
                        label: 'What needs fixing (the workers see this)', submitLabel: 'Send back', onDone: rerender,
                        call: reason => WP.rpc('wp_office_send_back', { p_task: id, p_reason: reason }) });
                    break;
                case 'reopen':
                    textModal({ title: 'Reopen this task', sub: 'Tasks that wait for it are held again until it is approved.',
                        label: 'Why (the workers see this)', submitLabel: 'Reopen', onDone: rerender,
                        call: reason => WP.rpc('wp_office_reopen', { p_task: id, p_reason: reason }) });
                    break;
                case 'cancel':
                    textModal({ title: t.status === 'draft' && t.proposed_by ? 'Decline this proposal' : 'Cancel this task', warn: true,
                        sub: t.proposed_by ? 'The team leader who proposed it sees this reason.' : 'It leaves the Board; its history stays.',
                        label: 'Reason', submitLabel: t.status === 'draft' && t.proposed_by ? 'Decline' : 'Cancel task', onDone: rerender,
                        call: reason => WP.rpc('wp_office_cancel', { p_task: id, p_reason: reason }) });
                    break;
            }
        }));
    }

    async function renderTask(host) {
        const id = WP.state.taskId;
        if (!id) { root.switchView('wpBoard'); return; }
        const ticket = tickets.take();
        const current = () => tickets.isLatest(ticket) && WP.state.taskId === id;
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the task…</div></div>';
        let t;
        try { t = await WP.rpc('wp_office_task', { p_task: id }); } catch (e) { if (current()) WP.fail(host, e); return; }
        if (!current()) return;   // an older load answered late: draw nothing
        const live = ['not_started', 'in_progress', 'reported_done', 'leader_checked'].includes(t.status);
        const sub = t.project_name + ' · ' + t.work_name + (t.planned_start || t.planned_end ? ' · ' + WP.plannedLabel(t) : '');
        host.innerHTML = '<div class="att-stack">' +
            '<div class="req-actions"><button class="att-btn" type="button" data-back><i data-lucide="arrow-left"></i> Work Plan</button>' +
              (t.meeting_id ? '<button class="att-btn" type="button" data-meeting><i data-lucide="book-open"></i> Its meeting</button>' : '') +
            '</div>' +
            WP.head(t.title, sub, actionsHtml(t)) +
            '<div class="req-summary"><span class="att-pill ' + WP.statusPill(t) + '">' + esc(WP.statusLabel(t)) + '</span>' +
              (live && t.blocked ? '<span class="wp-chip wp-chip--red">Blocked</span>' : '') +
              (t.status === 'in_progress' && t.sent_back ? '<span class="wp-chip wp-chip--gold">Sent back</span>' : '') +
              (t.version ? '<span class="req-muted">Version ' + esc(t.version) + '</span>' : '') +
            '</div>' +
            ((t.office_flags || []).length
                ? '<div class="att-info att-info--warn"><i data-lucide="flag"></i><div><strong>To check before publishing:</strong>' +
                  '<ul class="wp-flags">' + t.office_flags.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></div></div>'
                : '') +
            card('Instructions', t.instructions ? '<p class="wp-text">' + esc(t.instructions) + '</p>' : '<div class="req-muted">No instructions.</div>') +
            card('People', peopleHtml(t)) +
            card('Problems and waiting', problemsHtml(t)) +
            card('Photos', photosHtml(t)) +
            (t.source_passage ? card('From the meeting notes', '<blockquote class="wp-passage">' + esc(t.source_passage) + '</blockquote>') : '') +
            card('History', historyHtml(t)) +
            '</div>';
        wire(host, t, () => renderTask(host));
        WP.signImages(host);
        WP.icons();
    }

    WP.views.wpTask = renderTask;
})(window);
