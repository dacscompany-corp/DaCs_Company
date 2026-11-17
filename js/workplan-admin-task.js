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
// Office redesign v5: the task opens in the Board's pop-up
// (WP.renderTaskPanel, called by js/workplan-admin-board.js) through the
// frame's page shell — kicker, title, pills, "What to do now" (the one
// decision: approve reported work, publish a draft or proposal), and the
// task's buttons in the footer beside Next. Inside, one column of the
// frame's sections (v5): what needs the office (notices), Problems and
// waiting, Instructions, From the meeting notes, Photos, People (and who
// has read the current version), the facts, and the history, folded when
// long. Cancel / Decline sits apart at the bottom, away from Edit and
// Approve. Its forms (WP.modal) take the task's place in the pop-up.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;
    const SV = root.SplitView;
    const tickets = WP.loadTickets();   // only the newest task load may draw
    const PILL_TONE = { 'att-pill--done': 'done', 'att-pill--working': 'gold', 'att-pill--abandoned': 'red', 'att-pill--pc': 'check', 'att-pill--pm': 'pm' };

    function btn(act, label, cls) {
        return '<button class="att-btn' + (cls ? ' ' + cls : '') + '" type="button" data-act="' + act + '">' + esc(label) + '</button>';
    }

    const LIVE = ['not_started', 'in_progress', 'reported_done', 'leader_checked'];

    // The task's buttons, in the pop-up's footer: the decision the office is
    // here to make, then Edit, then its meeting. Cancel is NOT here (see
    // dangerHtml): it sat next to Edit and Approve.
    function actionsHtml(t) {
        const out = [];
        if (t.status === 'reported_done' || t.status === 'leader_checked') {
            out.push(btn('approve', 'Approve — completed', 'att-btn--primary'));
            out.push(btn('send_back', 'Send back'));
        }
        if (t.status === 'draft') out.push(btn('publish', 'Publish', 'att-btn--primary'));
        if (t.status === 'completed') out.push(btn('reopen', 'Reopen'));
        if (t.status !== 'completed' && t.status !== 'cancelled') out.push(btn('edit', 'Edit'));
        if (t.meeting_id) out.push('<button class="att-btn" type="button" data-meeting>See its meeting</button>');
        return out.join('');
    }

    function dangerHtml(t) {
        if (t.status === 'completed' || t.status === 'cancelled') return '';
        const decline = t.status === 'draft' && t.proposed_by;
        return '<div class="wp-danger"><button class="att-link att-link--danger" type="button" data-act="cancel">' +
            (decline ? 'Decline this proposal…' : 'Cancel this task…') + '</button></div>';
    }

    // What needs the office, said once and first, as the frame's notices.
    // A decision the "What to do now" box already says (step) is not repeated.
    function alertsHtml(t, step) {
        const out = [];
        const blockers = (t.blockers || []).length;
        if (!step && (t.status === 'reported_done' || t.status === 'leader_checked')) {
            out.push(SV.notice('gold', 'clipboard-check',
                t.status === 'leader_checked' ? 'Checked by the team leader, waiting for your approval' : 'Reported done, waiting for your approval',
                esc('Approve it as completed, or send it back with what needs fixing.' +
                    (t.status === 'leader_checked' ? ' A leader\'s check never replaces the office approval.' : ''))));
        }
        if (LIVE.includes(t.status) && t.blocked) {
            out.push(SV.notice('red', 'octagon-alert', 'This task is blocked',
                esc(blockers ? blockers + (blockers === 1 ? ' open problem' : ' open problems') + ' below. Clear each one after checking it is really solved.' :
                    'It waits for another task to be approved.')));
        }
        if (!step && t.status === 'draft' && t.proposed_by) {
            out.push(SV.notice('gold', 'lightbulb', 'Proposed by a team leader',
                esc('Publish it to make it a task, or decline it with a reason the leader will see.')));
        }
        if ((t.office_flags || []).length) {
            out.push(SV.notice('gold', 'flag', 'To check before publishing',
                '<ul class="wp-flags">' + t.office_flags.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>'));
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

    function historySection(t) {
        const events = (t.history || []).slice().reverse();
        if (!events.length) return SV.section('History', '<div class="wp-pad req-muted">No history yet.</div>');
        return SV.history(events.map(e => ({ when: e.by + ' · ' + WP.formatManila(e.at), html: esc(WP.eventText(e)) })), 6);
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

    // scope: the pop-up's panel (the shell's "What to do now" button is the
    // same data-act as the decision buttons, so it runs the same form).
    function wire(host, t, rerender) {
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

    // One task in the pop-up's panel. hooks: { onChanged(): reload the Board
    // and this task, nextLabel, start: { act } the card showed, or null }.
    async function renderTaskPanel(panel, id, hooks) {
        const ticket = tickets.take();
        // Only the newest load may draw, and only while the pop-up still
        // shows this task (not closed, not replaced by another item).
        const current = () => tickets.isLatest(ticket) && panel.isConnected && panel.dataset.svId === id;
        if (!panel.dataset.svRestore) panel.innerHTML = '<div class="sv-panel-empty">Loading the task…</div>';
        let t;
        try { t = await WP.rpc('wp_office_task', { p_task: id }); } catch (e) { if (current()) SV.error(panel, WP.errorMessage(e)); return; }
        if (!current()) return;   // an older load answered late, or the pop-up moved on: draw nothing
        const live = LIVE.includes(t.status);
        const editable = t.status !== 'completed' && t.status !== 'cancelled';
        const sub = t.work_name + (t.planned_start || t.planned_end ? ' · ' + WP.plannedLabel(t) : '');
        const problems = (t.blockers || []).length + (t.waiting_for || []).length;
        const photos = (t.photos || []).length;
        const team = t.team_name ? (/^team\b/i.test(t.team_name) ? t.team_name : 'Team ' + t.team_name) : 'Individual task (no team)';
        const step = WP.taskNextStep(t);
        const pills = [{ text: WP.statusLabel(t), tone: PILL_TONE[WP.statusPill(t)] || 'none' }];
        if (live && t.blocked) pills.push({ text: 'Blocked', tone: 'red' });
        if (t.status === 'in_progress' && t.sent_back) pills.push({ text: 'Sent back', tone: 'gold' });

        const sections = [
            alertsHtml(t, step),
            SV.section('Problems and waiting', problems
                ? problemsHtml(t)
                : '<div class="wp-clear"><i data-lucide="circle-check"></i> Nothing is holding this task.</div>'),
            SV.section('Instructions', t.instructions
                ? '<p class="wp-text">' + esc(t.instructions) + '</p>'
                : '<div class="req-muted">No instructions yet.' + (editable ? ' Use Edit to add them.' : '') + '</div>'),
            t.source_passage ? SV.section('From the meeting notes', '<blockquote class="wp-passage">' + esc(t.source_passage) + '</blockquote>') : '',
            photos ? SV.section('Photos (' + photos + ')', photosHtml(t)) : '',
            SV.section('People', peopleHtml(t)),
            SV.facts([
                ['Task', esc(t.title)],
                ['Project', esc(t.project_name)],
                ['Work', esc(t.work_name)],
                ['Team', esc(team)],
                ['Planned', (t.planned_start || t.planned_end) ? esc(WP.plannedLabel(t)) : ''],
                ['Version', t.version ? esc(t.version) : ''],
            ]),
            historySection(t),
            dangerHtml(t),
        ];

        const body = SV.page(panel, {
            kicker: 'Task · ' + t.project_name,
            title: t.title,
            pills: pills,
            sub: sub,
            step: step ? SV.nextStep(step.text, '<button class="att-btn att-btn--primary" type="button" data-act="' + esc(step.act) + '">' + esc(step.label) + '</button>') : '',
            actions: actionsHtml(t),
            nextLabel: hooks.nextLabel,
        });
        body.innerHTML = '<div class="wp wp-task">' + sections.filter(Boolean).join('') + '</div>';
        wire(panel, t, hooks.onChanged);
        // Opened by the card's next-step button: press the task's own "What
        // to do now" button — only the step the card showed, only once.
        if (hooks.start) {
            const want = hooks.start;
            hooks.start = null;
            const go = panel.querySelector('.sv-step [data-act]');
            if (go && current() && want.act === go.dataset.act) go.click();
        }
        WP.signImages(panel);
        WP.icons();
    }

    WP.renderTaskPanel = renderTaskPanel;

})(window);