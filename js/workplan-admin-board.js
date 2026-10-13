// ════════════════════════════════════════════════════════════════════
// Work Plan → Board (WorkMate My Work, 0093). Owner + staff.
//
// Every task of the company (or one project) under the office lists
// (spec §15): waiting for your check, blocked, not acknowledged after 24
// hours, overdue, not started / in progress, drafts and proposals,
// completed in the last 30 days. A row opens the task. "New task" adds a
// standalone draft (no meeting).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;

    // Survives navigation within the session, not a reload.
    const ui = { folder: '', text: '' };

    function chip(text, tone) {
        return '<span class="wp-chip wp-chip--' + tone + '">' + esc(text) + '</span>';
    }

    function rowHtml(t) {
        const live = ['not_started', 'in_progress', 'reported_done', 'leader_checked'].includes(t.status);
        const chips = [];
        if (live && t.blocked) chips.push(chip('Blocked', 'red'));
        if (t.status === 'in_progress' && t.sent_back) chips.push(chip('Sent back', 'gold'));
        if (t.overdue) chips.push(chip('Overdue', 'red'));
        if (t.not_acknowledged_24h) chips.push(chip('Not read after 24 h', 'gold'));
        if ((t.office_flags || []).length) chips.push(chip(t.office_flags.length + ' to check', 'gold'));
        const helpers = (t.helpers || []).length;
        const people = t.responsible
            ? esc(t.responsible.name) + (helpers ? '<div class="req-muted">+' + helpers + ' helper' + (helpers === 1 ? '' : 's') + '</div>' : '')
            : '<span class="req-muted">No one yet</span>';
        return '<tr tabindex="0" data-id="' + esc(t.id) + '">' +
            '<td><strong>' + esc(t.title) + '</strong><div class="req-muted">' + esc(t.project_name) + ' · ' + esc(t.work_name) + '</div></td>' +
            '<td>' + people + '</td>' +
            '<td>' + esc(WP.plannedLabel(t)) + '</td>' +
            '<td><div class="req-status"><span class="att-pill ' + WP.statusPill(t) + '">' + esc(WP.statusLabel(t)) + '</span>' +
              chips.join('') + '</div></td>' +
            '<td class="req-go"><i data-lucide="chevron-right"></i></td>' +
            '</tr>';
    }

    function summaryHtml(list) {
        const c = WP.alertCounts(list);
        const s = (n, text, tone) => n ? '<span class="req-sum req-sum--' + tone + '"><strong>' + n + '</strong> ' + text + '</span>' : '';
        return '<div class="req-summary">' +
            '<span class="req-sum req-sum--plain"><strong>' + list.length + '</strong> task' + (list.length === 1 ? '' : 's') + '</span>' +
            s(c.check, 'waiting for your check', 'gold') +
            s(c.blocked, 'blocked', 'red') +
            s(c.unacked, 'not acknowledged after 24 hours', 'gold') +
            s(c.overdue, 'overdue', 'red') +
            s(c.proposals, c.proposals === 1 ? 'proposal' : 'proposals', 'green') +
            '</div>';
    }

    function draw(host, all) {
        const list = WP.filterBoard(all, { folder: ui.folder, text: ui.text });
        host.querySelector('[data-summary]').innerHTML = summaryHtml(list);
        host.querySelector('[data-count]').textContent = list.length !== all.length ? 'Showing ' + list.length + ' of ' + all.length : '';
        const groups = WP.boardGroups(list);
        host.querySelector('[data-groups]').innerHTML = groups.length
            ? groups.map(g =>
                '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">' + esc(g.title) +
                ' <span class="req-muted">· ' + g.tasks.length + (g.tasks.length === 1 ? ' task' : ' tasks') + '</span></div></div></div>' +
                '<div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table"><thead><tr>' +
                '<th>Task</th><th>People</th><th>Planned</th><th>Status</th><th class="req-go"><span class="req-sr">Open</span></th>' +
                '</tr></thead><tbody>' + g.tasks.map(rowHtml).join('') + '</tbody></table></div></div></div>').join('')
            : '<div class="att-card"><div class="att-empty">' +
              (all.length ? 'No task matches these filters.' : 'No tasks yet. Start from a meeting, or add a task.') + '</div></div>';
        WP.icons();
    }

    async function renderBoard(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading tasks…</div></div>';
        let all, projects;
        try {
            [all, projects] = await Promise.all([WP.rpc('wp_office_board', { p_folder: null }), WP.rpc('wp_office_destinations')]);
        } catch (e) { WP.fail(host, e); return; }
        all = all || [];
        projects = projects || [];
        if (ui.folder && !projects.some(p => p.folder_id === ui.folder)) ui.folder = '';

        host.innerHTML = '<div class="att-stack">' +
            WP.head('Work Plan', 'Tasks from meetings and the office. Workers see their own tasks in DAC\'S WorkMate (My Work).',
                '<button class="att-btn" type="button" data-meetings><i data-lucide="book-open"></i> Meetings</button>' +
                '<button class="att-btn att-btn--primary" type="button" data-new><i data-lucide="plus"></i> New task</button>') +
            '<div data-summary></div>' +
            '<div class="att-toolbar">' +
              '<select class="att-filter" data-folder aria-label="Project"><option value="">All projects</option>' +
                projects.map(p => '<option value="' + esc(p.folder_id) + '"' + (p.folder_id === ui.folder ? ' selected' : '') + '>' +
                  esc(p.name) + '</option>').join('') + '</select>' +
              '<div class="att-search-wrap"><i data-lucide="search"></i>' +
                '<input class="att-search" type="search" data-text aria-label="Search" placeholder="Search task, project, person…" value="' +
                esc(ui.text) + '"></div>' +
              '<span class="req-count" data-count aria-live="polite"></span>' +
            '</div>' +
            '<div data-groups></div>' +
            '</div>';
        draw(host, all);

        host.querySelector('[data-folder]').addEventListener('change', e => { ui.folder = e.target.value; draw(host, all); });
        host.querySelector('[data-text]').addEventListener('input', e => { ui.text = e.target.value; draw(host, all); });
        host.querySelector('[data-meetings]').addEventListener('click', () => root.switchView('wpMeetings'));
        host.querySelector('[data-new]').addEventListener('click', () =>
            WP.openTaskForm({ values: ui.folder ? { folder_id: ui.folder } : {}, onDone: () => renderBoard(host) }));
        const groups = host.querySelector('[data-groups]');
        groups.addEventListener('click', e => {
            const tr = e.target.closest('tr[data-id]');
            if (tr) WP.openTask(tr.dataset.id);
        });
        groups.addEventListener('keydown', e => {
            const tr = e.target.closest('tr[data-id]');
            if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); WP.openTask(tr.dataset.id); }
        });
        WP.icons();
    }

    WP.views.wpBoard = renderBoard;
})(window);
