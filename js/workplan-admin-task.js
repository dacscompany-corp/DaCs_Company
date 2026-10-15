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
//
// Layout (same pattern as the Requests detail page): what needs the office
// is said first, in a banner; the main column holds the problems, the
// instructions and the photos; the side column holds the task's facts, the
// people (and who has read the current version) and the history, collapsed
// when long. Cancel / Decline sits apart, away from Edit and Approve.
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

    const LIVE = ['not_started', 'in_progress', 'reported_done', 'leader_checked'];

    // The decisions in the header: the one the office is here to make, then Edit.
    // Cancel is NOT here (see dangerHtml): it sat next to Edit and Approve.
    function actionsHtml(t) {
        const out = [];
        if (t.status === 'reported_done' || t.status === 'leader_checked') {
            out.push(btn('approve', 'Approve — completed', 'att-btn--primary'));
            out.push(btn('send_back', 'Send back'));
        }
        if (t.status === 'draft') out.push(btn('publish', 'Publish', 'att-btn--primary'));
        if (t.status === 'completed') out.push(btn('reopen', 'Reopen'));
        if (t.status !== 'completed' && t.status !== 'cancelled') out.push(btn('edit', 'Edit'));
        return out.join('');
    }

    function dangerHtml(t) {
        if (t.status === 'completed' || t.status === 'cancelled') return '';
        const decline = t.status === 'draft' && t.proposed_by;
        return '<div class="wp-danger"><button class="att-link att-link--danger" type="button" data-act="cancel">' +
            (decline ? 'Decline this proposal…' : 'Cancel this task…') + '</button></div>';
    }

    // What needs the office, said once and first.
    function alertsHtml(t) {
        const out = [];
        const blockers = (t.blockers || []).length;
        if (t.status === 'reported_done' || t.status === 'leader_checked') {
            out.push('<div class="wp-alert wp-alert--gold"><i data-lucide="clipboard-check"></i><div><strong>' +
                (t.status === 'leader_checked' ? 'Checked by the team leader, waiting for your approval' : 'Reported done, waiting for your approval') +
                '</strong><div>Approve it as completed, or send it back with what needs fixing.' +
                (t.status === 'leader_checked' ? ' A leader\'s check never replaces the office approval.' : '') + '</div></div></div>');
        }
        if (LIVE.includes(t.status) && t.blocked) {
            out.push('<div class="wp-alert wp-alert--red"><i data-lucide="octagon-alert"></i><div><strong>This task is blocked</strong>' +
                '<div>' + (blockers ? blockers + (blockers === 1 ? ' open problem' : ' open problems') + ' below. Clear each one after checking it is really solved.' :
                    'It waits for another task to be approved.') + '</div></div></div>');
        }
        if (t.status === 'draft' && t.proposed_by) {
            out.push('<div class="wp-alert wp-alert--gold"><i data-lucide="lightbulb"></i><div><strong>Proposed by a team leader</strong>' +
                '<div>Publish it to make it a task, or decline it with a reason the leader will see.</div></div></div>');
        }
        if ((t.office_flags || []).length) {
            out.push('<div class="wp-alert wp-alert--gold"><i data-lucide="flag"></i><div><strong>To check before publishing</strong>' +
                '<ul class="wp-flags">' + t.office_flags.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></div></div>');
        }
        return out.join('');
    }

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    function peopleHtml(t) {
        const acks = (t.acks || []).slice().sort((a, b) => (a.role === 'responsible' ? 0 : 1) - (b.role === 'responsible' ? 0 : 1));
        if (!acks.length) {
            return '<div class="wp-pad req-muted">No one is assigned yet. Use Edit to choose the responsible person.</div>';
        }
        const showRead = t.status !== 'draft';
        const read = acks.filter(a => a.acked).length;
        return (showRead
                ? '<div class="wp-readline' + (read === acks.length ? ' is-all' : '') + '">' +
                  (read === acks.length ? 'Everyone has read version ' : read + ' of ' + acks.length + ' have read version ') + esc(t.version) + '</div>'
                : '') +
            '<ul class="wp-people">' + acks.map(a =>
                '<li><span class="wp-avatar" aria-hidden="true">' + esc(initials(a.name)) + '</span>' +
                '<span class="wp-person"><strong>' + esc(a.name) + '</strong>' +
                  '<span class="req-muted">' + (a.role === 'responsible' ? 'Responsible' : 'Helper') + '</span></span>' +
                (showRead ? (a.acked
                    ? '<span class="att-pill att-pill--done">Read</span>'
                    : '<span class="att-pill att-pill--working">Not read yet</span>') : '') +
                '</li>').join('') + '</ul>';
    }

    function problemsHtml(t) {
        const blockers = t.blockers || [];
        const waits = t.waiting_for || [];
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
        return '<div class="req-photos">' + photos.map(p =>
            '<div class="wp-photo"><img class="req-photo" alt="Task photo" data-sign-bucket="task-photos" data-sign-path="' + esc(p.path) + '">' +
            '<div class="req-muted">' + esc(WP.formatManila(p.created_at)) + (p.blocker_id ? ' · problem photo' : '') +
            '</div></div>').join('') + '</div>';
    }

    function historyHtml(t) {
        const events = (t.history || []).slice().reverse();
        if (!events.length) return '<div class="wp-pad req-muted">No history yet.</div>';
        return '<ul class="wp-timeline">' + events.map(e =>
            '<li><div class="wp-tl-text">' + esc(WP.eventText(e)) + '</div>' +
            '<div class="req-muted">' + esc(e.by) + ' · ' + esc(WP.formatManila(e.at)) + '</div></li>').join('') + '</ul>';
    }

    function metaRow(label, value) {
        return value ? '<div class="req-meta-row"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>' : '';
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
        host.innerHTML = '<div class="att-stack wp wp-task"><div class="att-empty">Loading the task…</div></div>';
        let t;
        try { t = await WP.rpc('wp_office_task', { p_task: id }); } catch (e) { if (current()) WP.fail(host, e); return; }
        if (!current()) return;   // an older load answered late: draw nothing
        const live = LIVE.includes(t.status);
        const editable = t.status !== 'completed' && t.status !== 'cancelled';
        const sub = t.project_name + ' · ' + t.work_name + (t.planned_start || t.planned_end ? ' · ' + WP.plannedLabel(t) : '');
        const problems = (t.blockers || []).length + (t.waiting_for || []).length;
        const photos = (t.photos || []).length;
        const events = (t.history || []).length;
        const team = t.team_name ? (/^team\b/i.test(t.team_name) ? t.team_name : 'Team ' + t.team_name) : 'Individual task (no team)';

        const main =
            (problems
                ? card('Problems and waiting', problemsHtml(t))
                : '<div class="wp-clear"><i data-lucide="circle-check"></i> Nothing is holding this task.</div>') +
            card('Instructions', t.instructions
                ? '<p class="wp-text">' + esc(t.instructions) + '</p>'
                : '<div class="req-muted">No instructions yet.' + (editable ? ' Use Edit to add them.' : '') + '</div>') +
            (t.source_passage ? card('From the meeting notes', '<blockquote class="wp-passage">' + esc(t.source_passage) + '</blockquote>') : '') +
            (photos ? card('Photos (' + photos + ')', photosHtml(t)) : '');

        const side =
            '<div class="att-card"><div class="att-card-head"><div class="att-card-title">Task</div></div>' +
              '<dl class="req-meta wp-meta">' +
                metaRow('Project', esc(t.project_name)) +
                metaRow('Work', esc(t.work_name)) +
                metaRow('Planned', (t.planned_start || t.planned_end) ? esc(WP.plannedLabel(t)) : '') +
                metaRow('Team', esc(team)) +
                metaRow('Version', t.version ? esc(t.version) : '') +
              '</dl></div>' +
            '<div class="att-card"><div class="att-card-head"><div class="att-card-title">People</div></div>' + peopleHtml(t) + '</div>' +
            '<details class="att-card wp-hist"' + (events <= 6 ? ' open' : '') + '>' +
              '<summary>History <span class="req-muted">' + events + '</span></summary>' + historyHtml(t) + '</details>' +
            dangerHtml(t);

        host.innerHTML = '<div class="att-stack wp wp-task">' +
            '<div class="att-crumbs"><button class="att-link" type="button" data-back>← Work Plan</button>' +
              (t.meeting_id ? '<span class="wp-dot">·</span><button class="att-link" type="button" data-meeting>See its meeting</button>' : '') +
            '</div>' +
            WP.head(t.title, sub, actionsHtml(t)) +
            '<div class="req-summary"><span class="att-pill ' + WP.statusPill(t) + '">' + esc(WP.statusLabel(t)) + '</span>' +
              (live && t.blocked ? '<span class="wp-chip wp-chip--red">Blocked</span>' : '') +
              (t.status === 'in_progress' && t.sent_back ? '<span class="wp-chip wp-chip--gold">Sent back</span>' : '') +
            '</div>' +
            alertsHtml(t) +
            '<div class="wp-layout"><div class="wp-main">' + main + '</div><aside class="wp-side">' + side + '</aside></div>' +
            '</div>';
        wire(host, t, () => renderTask(host));
        WP.signImages(host);
        WP.icons();
    }

    WP.views.wpTask = renderTask;
})(window);