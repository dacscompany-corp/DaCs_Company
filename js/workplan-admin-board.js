// ════════════════════════════════════════════════════════════════════
// Work Plan → Board (WorkMate My Work, 0093). Owner + staff.
//
// Office redesign v5 (spec docs/superpowers/specs/2026-11-14-office-split-
// view-redesign-design.md rev 2): cards under the office lists (spec §15)
// — waiting for your check, blocked, not acknowledged after 24 hours,
// overdue, not started / in progress, drafts and proposals, completed in
// the last 30 days — in tabs Needs you · In progress · Drafts · Completed ·
// All. A card opens the task in the frame's pop-up (js/workplan-admin-
// task.js); its button is the task's one next step (WP.taskNextStep).
// "New task" adds a standalone draft (no meeting). A board with no tasks
// says how a task starts.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const SV = root.SplitView;
    const esc = WP.esc;

    // Survives navigation within the session, not a reload. ui.tab is a tab
    // the USER picked; the automatic default (visitTab) lasts one visit.
    const ui = { folder: '', text: '', tab: null, selectedId: null };
    let visitTab = null;
    let host = null;
    let data = null;           // { all, projects }
    const loads = SV && SV.seq ? SV.seq() : { next() { return 0; }, isLatest() { return true; } };

    // The lists that ask something of the office get a colour; the quiet
    // ones stay plain.
    const GROUP_TONE = { check: 'gold', blocked: 'red', unacked: 'gold', overdue: 'red', active: 'ink', drafts: 'ink', done: 'muted' };
    const PILL_TONE = { 'att-pill--done': 'done', 'att-pill--working': 'gold', 'att-pill--abandoned': 'red', 'att-pill--pc': 'check', 'att-pill--pm': 'pm' };
    const TAB_HELP = {
        needs: 'Tasks waiting for your check, blocked, not read after 24 hours, or overdue.',
        prog: 'Not started and in progress.',
        drafts: 'Drafts and proposals. Only the office sees a draft.',
        done: 'Completed in the last 30 days.',
    };
    // v5: always on the Board, folded — it says where a task starts and how it moves.
    const HOW = {
        title: 'How a task moves',
        text: 'A task starts in one of two places.',
        rows: [
            ['From a meeting', 'Record a meeting and turn its notes into draft tasks. (Open Meetings)'],
            ['Directly', 'Add a one-off task for a project. (New task)'],
            ['1 · Draft', 'Only the office sees it.'],
            ['2 · Publish', 'Workers see it in My Work and read it.'],
            ['3 · Check', 'When they report it done, you check it.'],
        ],
    };

    function toneOf(t) { return PILL_TONE[WP.statusPill(t)] || 'none'; }

    function chipsOf(t) {
        const live = ['not_started', 'in_progress', 'reported_done', 'leader_checked'].includes(t.status);
        const chips = [];
        if (live && t.blocked) chips.push({ text: 'Blocked', tone: 'red' });
        if (t.status === 'in_progress' && t.sent_back) chips.push({ text: 'Sent back', tone: 'gold' });
        if (t.overdue) chips.push({ text: 'Overdue', tone: 'red' });
        if (t.not_acknowledged_24h) chips.push({ text: 'Not read after 24 h', tone: 'gold' });
        if ((t.office_flags || []).length) chips.push({ text: t.office_flags.length + ' to check', tone: 'gold' });
        return chips;
    }

    function cardOf(t) {
        const helpers = (t.helpers || []).length;
        const people = t.responsible
            ? t.responsible.name + (helpers ? ' +' + helpers + ' helper' + (helpers === 1 ? '' : 's') : '')
            : 'No one yet';
        const step = WP.taskNextStep(t);
        return {
            id: t.id,
            title: t.title,
            sub: t.project_name + ' · ' + t.work_name,
            meta: people + ' · ' + WP.plannedLabel(t),
            pill: { text: WP.statusLabel(t), tone: toneOf(t) },
            chips: chipsOf(t),
            stripe: t.overdue ? 'red' : '',
            dim: t.status === 'completed',
            nextLabel: step ? step.label : '',
        };
    }

    // The board's status sentence (it was a row of chips).
    function summaryText(list) {
        const c = WP.alertCounts(list);
        const parts = [list.length + ' task' + (list.length === 1 ? '' : 's')];
        if (c.check) parts.push(c.check + ' waiting for your check');
        if (c.blocked) parts.push(c.blocked + ' blocked');
        if (c.unacked) parts.push(c.unacked + ' not acknowledged after 24 hours');
        if (c.overdue) parts.push(c.overdue + ' overdue');
        if (c.proposals) parts.push(c.proposals + ' ' + (c.proposals === 1 ? 'proposal' : 'proposals'));
        return parts.join(' · ');
    }

    // A board with no task at all (v5): one short message and both ways to
    // start; the How box above carries the steps.
    function emptyHtml() {
        return '<div class="wp-empty-body"><strong>No tasks yet</strong> — A task starts in one of two places: ' +
            'from a meeting, or directly with New task.</div>' +
            '<div class="wp-actions wp-empty-actions">' +
              '<button class="att-btn" type="button" data-meetings>Open Meetings</button>' +
              '<button class="att-btn att-btn--primary" type="button" data-new>New task</button>' +
            '</div>';
    }

    function newTask() {
        WP.openTaskForm({ values: ui.folder ? { folder_id: ui.folder } : {}, onDone: () => load() });
    }

    // The step the card showed when its button was pressed ({ act }), so the
    // task starts that exact step or none.
    function cardStep(id) {
        const t = data && data.all.find(x => x.id === id);
        const step = t ? WP.taskNextStep(t) : null;
        return step ? { act: step.act } : null;
    }

    function folderSelect() {
        return '<select class="sv-select" data-folder aria-label="Project"><option value="">All projects</option>' +
            data.projects.map(p => '<option value="' + esc(p.folder_id) + '"' + (p.folder_id === ui.folder ? ' selected' : '') + '>' +
              esc(p.name) + '</option>').join('') + '</select>';
    }

    function draw(opts) {
        if (!host || !data) return;
        const all = data.all;
        const list = WP.filterBoard(all, { folder: ui.folder, text: ui.text });
        const tabs = WP.BOARD_TABS.map(([id, label]) => ({
            id, label, count: list.filter(t => WP.boardTab(t, id)).length, needs: id === 'needs', help: TAB_HELP[id] || '',
        }));
        if (!ui.tab && !visitTab) visitTab = SV.pickDefaultTab(tabs, null);
        const tab = ui.tab || visitTab;
        const inTab = list.filter(t => WP.boardTab(t, tab));
        if (opts && opts.leaveSelection && ui.selectedId && !inTab.some(t => t.id === ui.selectedId)) ui.selectedId = null;
        const groups = WP.boardGroups(inTab).map(g => ({ title: g.title, tone: GROUP_TONE[g.key] || 'ink', rows: g.tasks.map(cardOf) }));
        const filtered = list.length !== all.length;

        let empty;
        if (!all.length) empty = emptyHtml();
        else if (filtered && !inTab.length) empty = 'No task matches these filters. <button class="att-link" type="button" data-clear>Clear filters</button>';
        else empty = tab === 'needs' ? 'Nothing here. You\'re done.' : 'Nothing in this tab.';

        root.SplitView.render(host, {
            key: 'wpBoard',
            title: 'Work Plan',
            sub: 'Tasks from meetings and the office. Workers see their own tasks in DAC\'S WorkMate (My Work).',
            // v5: the header, the How box and the project filter are always
            // there; an empty board says so in the list (emptyHtml).
            // v5: no More menu here — Meetings is in the module row, and the
            // empty board's message has Open Meetings.
            primary: { label: 'New task', onClick: newTask },
            lede: all.length ? summaryText(list) : '',
            how: HOW,
            tabs: tabs,
            tab: tab,
            onTab: id => { ui.tab = id; draw({ leaveSelection: true }); },
            search: { placeholder: 'Search task, project, person…', value: ui.text, onInput: text => { ui.text = text; draw({ leaveSelection: true }); } },
            toolbar: folderSelect(),
            onToolbar: el => {
                const sel = el.querySelector('[data-folder]');
                if (sel) sel.addEventListener('change', e => { ui.folder = e.target.value; draw({ leaveSelection: true }); });
            },
            showing: filtered ? 'Showing ' + list.length + ' of ' + all.length : '',
            groups: groups,
            empty: empty,
            onEmpty: el => {
                const meet = el.querySelector('[data-meetings]');
                if (meet) meet.addEventListener('click', () => root.switchView('wpMeetings'));
                const add = el.querySelector('[data-new]');
                if (add) add.addEventListener('click', newTask);
                const clear = el.querySelector('[data-clear]');
                if (clear) clear.addEventListener('click', () => { ui.folder = ''; ui.text = ''; draw({ leaveSelection: true }); });
            },
            selectedId: ui.selectedId,
            refreshPanel: !!(opts && opts.refreshPanel),
            onSelect: (id, panel, o) => {
                ui.selectedId = id;
                WP.renderTaskPanel(panel, id, { onChanged: () => load(), nextLabel: 'Next task', start: o && o.start ? cardStep(id) : null });
            },
            // The pop-up closed: forget the task — never redraw from here.
            onClose: () => { ui.selectedId = null; },
        });
    }

    async function load(opts) {
        if (!host) return;
        const mine = loads.next();
        if (!data) host.innerHTML = '<div class="sv"><div class="sv-empty">Loading tasks…</div></div>';
        let all, projects;
        try {
            [all, projects] = await Promise.all([WP.rpc('wp_office_board', { p_folder: null }), WP.rpc('wp_office_destinations')]);
        } catch (e) { if (loads.isLatest(mine)) WP.fail(host, e); return; }
        if (!loads.isLatest(mine)) return;
        data = { all: all || [], projects: projects || [] };
        if (root.NavCounts) root.NavCounts.set('board', data.all.filter(t => WP.boardTab(t, 'needs')).length);
        if (ui.folder && !data.projects.some(p => p.folder_id === ui.folder)) ui.folder = '';
        // A task opened from elsewhere: show its tab, or every task.
        if (opts && opts.reveal && ui.selectedId) {
            const t = data.all.find(x => x.id === ui.selectedId);
            const shown = ui.tab || visitTab || 'needs';
            if (t && !WP.boardTab(t, shown)) ui.tab = 'all';
        }
        draw({ refreshPanel: true });
    }

    function renderBoard(el) {
        host = el;
        visitTab = null;
        let reveal = false;
        if (WP.state.taskId) {
            ui.selectedId = WP.state.taskId;
            WP.state.taskId = null;
            reveal = true;
        }
        load({ reveal: reveal });
    }

    WP.views.wpBoard = renderBoard;

    // D5: the red count on Board — tasks in "Needs you" (everyone who sees it).
    if (root.NavCounts) {
        root.NavCounts.register('board', async () =>
            ((await WP.rpc('wp_office_board', { p_folder: null })) || []).filter(t => WP.boardTab(t, 'needs')).length);
    }
})(window);
