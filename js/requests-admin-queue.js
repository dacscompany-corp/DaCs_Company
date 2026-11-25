// ════════════════════════════════════════════════════════════════════
// Requests → Queue (WorkMate, 0086). Owner + staff.
//
// Office redesign v5 (spec docs/superpowers/specs/2026-11-14-office-split-
// view-redesign-design.md rev 2): the queue is cards in groups; the chosen
// request opens in the frame's pop-up (js/requests-admin-detail.js draws
// it), drawn by the shared frame js/split-view.js. A card carries its
// "What to do now" button when the request has exactly one next step.
//
// Every request with an open item, urgent first (earliest needed-by),
// then by the earliest weekly batch still to arrange — sortQueue in the
// core still decides the order; this file only makes it visible:
//   · tabs: Needs action (the old "Needs action only" rule) · Urgent ·
//     To resolve · To arrange · Arranged · All open · Closed;
//   · rows sit under headings -- Urgent, then one heading per weekly
//     batch (its cutoff, buy and deliver days), then "Waiting on the
//     office", then "Nothing left to arrange";
//   · an urgent request whose needed-by day has passed says OVERDUE.
// The size of "Needs action" is the red count on the Requests tab.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const SV = root.SplitView;
    const esc = RA.esc;

    // Survives navigation within the session, not a reload. ui.tab is a tab
    // the USER picked (or "View in queue" chose); the automatic default is
    // visitTab, kept for one visit only so working "Needs action" down to 0
    // does not move the office to another tab mid-work.
    const ui = { scope: 'open', batchId: '', text: '', tab: null, selectedId: null };
    let visitTab = null;
    let host = null;
    let data = null;          // { all, batches, current, today, capped, openCounts }
    const loads = SV ? SV.seq() : { next() { return 0; }, isLatest() { return true; } };

    const DAY_MS = 24 * 60 * 60 * 1000;

    function daysBetween(fromKey, toKey) {
        return Math.round((Date.parse(toKey + 'T00:00:00Z') - Date.parse(fromKey + 'T00:00:00Z')) / DAY_MS);
    }

    // A team called "Team test" used to print as "Team Team test".
    function teamLabel(name) {
        return /^team\b/i.test(name) ? name : 'Team ' + name;
    }

    const STATE_TONE = { conflict: 'red', reduction: 'red', cancelled: 'none', unarranged: 'gold', partly: 'gold', arranged: 'done' };
    function statusPill(state) {
        return { text: state === 'cancelled' ? 'Closed' : RA.STATE_LABEL[state], tone: STATE_TONE[state] };
    }

    function urgentChip(s, today) {
        if (!s.urgent) return null;
        if (!s.neededBy) return { text: 'URGENT', tone: 'red' };
        const late = daysBetween(s.neededBy, today);
        if (late > 0) {
            return { text: 'OVERDUE ' + late + (late === 1 ? ' DAY' : ' DAYS') + ' · needed ' + RA.formatDay(s.neededBy), tone: 'solidRed' };
        }
        if (late === 0) return { text: 'URGENT · needed today', tone: 'red' };
        return { text: 'URGENT · by ' + RA.formatDay(s.neededBy), tone: 'red' };
    }

    // "3 items" when every item is still open; "1 of 2 open" only when it
    // says something -- "3 of 3 open" on every row was noise.
    function itemsCount(s) {
        const noun = s.totalLines === 1 ? 'item' : 'items';
        if (s.openLines === 0) return s.totalLines + ' ' + noun + ' · closed';
        if (s.openLines === s.totalLines) return s.totalLines + ' ' + noun;
        return s.openLines + ' of ' + s.totalLines + ' open';
    }

    function rowOf(r, today) {
        const s = RA.requestSummary(r);
        const state = RA.requestState(r);
        const chip = urgentChip(s, today);
        const items = (r.lines || []).map(l => l.description).slice(0, 3).join(', ') + ((r.lines || []).length > 3 ? ', …' : '');
        const step = RA.requestNextStep(r, today);
        return {
            id: r.id,
            title: r.requester_name + ' · ' + r.project_name,
            sub: items,
            meta: [r.work_name, r.team_name ? teamLabel(r.team_name) : '', itemsCount(s)].filter(Boolean).join(' · '),
            right: RA.shortDay(r.received_at),
            pill: statusPill(state),
            chips: chip ? [chip] : [],
            stripe: s.urgent ? 'red' : '',
            dim: state === 'arranged',
            nextLabel: (step && step.label) || '',
        };
    }

    // Which heading a request sits under. Mirrors sortQueue: urgent first,
    // then by the earliest cutoff still to arrange, then nothing-to-do last.
    function groupOf(r) {
        if (ui.scope === 'closed') return { key: 'all', rank: 0 };
        const s = RA.requestSummary(r);
        if (s.urgent) return { key: 'urgent', rank: 0 };
        if (s.firstCutoff) return { key: 'b' + Date.parse(s.firstCutoff), cutoff: s.firstCutoff, rank: 1, time: Date.parse(s.firstCutoff) };
        // No batch left to arrange. Only a finished request belongs under
        // "Nothing left to arrange"; one that still needs a decision (an
        // open conflict on an arranged line, say) must not hide there.
        const st = RA.requestState(r);
        return (st === 'arranged' || st === 'cancelled') ? { key: 'done', rank: 3 } : { key: 'open', rank: 2 };
    }

    function heading(g) {
        if (g.key === 'all') return { title: 'Closed requests', tone: 'muted' };
        if (g.key === 'urgent') return { title: 'Urgent', tone: 'red', meta: 'Needed soonest first' };
        if (g.key === 'open') return { title: 'Waiting on the office', tone: 'red', meta: 'No batch left to arrange' };
        if (g.key === 'done') return { title: 'Nothing left to arrange', tone: 'muted' };
        const t = Date.parse(g.cutoff);
        const b = data.batches.find(x => Date.parse(x.cutoff_at) === t);
        const isCurrent = !!(b && data.current && b.id === data.current.id);
        return {
            title: 'Cutoff ' + RA.cutoffLabel(g.cutoff),
            tone: 'ink',
            badge: isCurrent ? { text: 'This week', tone: 'done' } : null,
            meta: b ? esc('Buy ' + RA.formatDay(b.purchase_on) + ' · Deliver ' + RA.formatDay(b.delivery_on)) : '',
        };
    }

    function groupsOf(list) {
        // Bucket by heading, keeping sortQueue's order inside each bucket.
        // Buckets are looked up by key rather than assumed contiguous, so a
        // request with no batch can never split a heading in two.
        const buckets = [];
        const byKey = {};
        list.forEach(r => {
            const g = groupOf(r);
            if (!byKey[g.key]) { byKey[g.key] = { g: g, rows: [] }; buckets.push(byKey[g.key]); }
            byKey[g.key].rows.push(r);
        });
        buckets.sort((a, b) => (a.g.rank - b.g.rank) || ((a.g.time || 0) - (b.g.time || 0)));
        return buckets.map(x => Object.assign(heading(x.g), { rows: x.rows.map(r => rowOf(r, data.today)) }));
    }

    // v5: the "This week" box right under the tabs, the tab's sentence
    // and the cutoff rule on one line under it.
    function weekHtml(current, help) {
        if (!current) return '';   // the frame shows the tab's sentence itself
        return '<div class="sv-week sv-week--v5">' +
                '<span class="sv-week-k">This week</span>' +
                '<span>Cutoff <b class="sv-week-v">' + esc(RA.cutoffLabel(current.cutoff_at)) + '</b></span>' +
                '<span>Buy <b class="sv-week-v">' + esc(RA.formatDay(current.purchase_on)) + '</b></span>' +
                '<span>Deliver <b class="sv-week-v">' + esc(RA.formatDay(current.delivery_on)) + '</b></span>' +
                '<button class="att-link sv-week-link" type="button" data-go-batches>Change batch dates</button></div>' +
            '<div class="sv-tab-help">' + (help ? esc(help) + ' ' : '') +
              '<span class="sv-week-note">Requests received after the cutoff go to the next week.</span></div>';
    }

    function batchSelect() {
        return '<select class="sv-select" data-batch aria-label="Weekly batch">' +
            '<option value="">All weekly batches</option>' +
            data.batches.map(b => '<option value="' + esc(b.id) + '"' + (b.id === ui.batchId ? ' selected' : '') + '>' +
                esc('Cutoff ' + RA.cutoffLabel(b.cutoff_at)) + ' (' + b.open_portions + ')</option>').join('') +
            '</select>';
    }

    const DONE_TABS = ['attn', 'urgent', 'resolve', 'arrange'];

    // The line under the tabs. "Needs action" is the code's rule (anything
    // still to arrange or to resolve), wider than the design's sentence.
    const TAB_HELP = {
        attn: 'Requests with something still to arrange or to resolve.',
        urgent: 'Needed soonest first.',
        resolve: 'A reduction or an offline edit is waiting for your decision.',
        arrange: 'Nothing arranged yet, or only partly.',
        closed: 'Closed requests load separately.',
    };
    const HOW = {
        title: 'What the labels on a request mean',
        rows: [
            ['URGENT · needed today', 'Needed today.'],
            ['URGENT · by [date]', 'Needed by that date.'],
            ['OVERDUE N DAYS · needed [date]', 'The date it was needed has passed.'],
            ['Red bar on the left', 'An urgent request.'],
            ['Dimmed card', 'Finished — nothing left to arrange.'],
        ],
    };

    // opts.leaveSelection: a filter or tab change drops a selection that
    // is no longer in the list (its pop-up closes); a reload after an
    // action keeps it, so the office sees the result.
    function draw(opts) {
        if (!host || !data) return;
        const closed = ui.scope === 'closed';
        const tabs = RA.QUEUE_TABS.map(([id, label]) => ({
            id, label, count: data.openCounts ? data.openCounts[id] : null, needs: id === 'attn',
            help: data.current ? '' : (TAB_HELP[id] || ''),
        }));
        tabs.push({ id: 'closed', label: 'Closed', count: closed ? data.all.length : null, help: TAB_HELP.closed });
        // The user's pick wins; otherwise this visit's automatic tab, chosen
        // once (Needs action when it has something, else the first tab with
        // something in it).
        if (!closed && !ui.tab && !visitTab) visitTab = SV.pickDefaultTab(tabs.slice(0, 6), null);
        const tab = closed ? 'closed' : (ui.tab || visitTab);

        const inTab = closed ? data.all : data.all.filter(r => RA.inQueueTab(r, tab));
        const list = RA.sortQueue(RA.filterQueue(inTab, { text: ui.text, batchId: ui.batchId }));
        if (opts && opts.leaveSelection && ui.selectedId && !list.some(r => r.id === ui.selectedId)) ui.selectedId = null;
        const filtered = list.length !== inTab.length;

        let empty;
        if (!data.all.length) {
            empty = closed ? 'No closed requests yet.' : 'No open requests. New ones appear here as soon as a worker sends them.';
        } else if (filtered && !list.length) {
            empty = 'No request matches these filters. <button class="att-link" type="button" data-clear>Clear filters</button>';
        } else {
            empty = DONE_TABS.includes(tab) ? 'Nothing here. You\'re done.' : 'Nothing in this tab.';
        }
        const overdue = closed ? 0 : data.all.filter(r => RA.isOverdue(r, data.today)).length;

        root.SplitView.render(host, {
            key: 'reqQueue',
            title: 'Request queue',
            sub: 'Materials and tools from DAC\'S WorkMate · urgent first, then by weekly batch' + (overdue ? ' · ' + overdue + ' overdue' : ''),
            tabs: tabs,
            tab: tab,
            onTab: onTab,
            how: HOW,
            aside: closed ? '' : weekHtml(data.current, TAB_HELP[tab] || ''),
            notice: data.capped ? SV.notice('gold', 'list-filter', 'Showing the newest 300 requests.',
                'Requests with a reduction or an offline edit to resolve are always included.') : '',
            search: { placeholder: 'Search worker, project, item…', value: ui.text, onInput: text => { ui.text = text; draw({ leaveSelection: true }); } },
            toolbar: batchSelect(),
            onToolbar: el => {
                el.querySelector('[data-batch]').addEventListener('change', e => { ui.batchId = e.target.value; draw({ leaveSelection: true }); });
            },
            showing: list.length ? 'Showing ' + list.length + ' of ' + inTab.length : '',
            groups: groupsOf(list),
            empty: empty,
            onEmpty: el => {
                const clear = el.querySelector('[data-clear]');
                if (clear) clear.addEventListener('click', () => { ui.batchId = ''; ui.text = ''; draw({ leaveSelection: true }); });
            },
            selectedId: ui.selectedId,
            // Reload the open request only after an action or a fresh load —
            // never on a search keystroke, filter or tab change.
            refreshPanel: !!(opts && opts.refreshPanel),
            onSelect: (id, panel, opts) => {
                ui.selectedId = id;
                if (typeof RA.renderRequestPanel !== 'function') { SV.error(panel, 'This request could not be opened. Reload the page.'); return; }
                RA.renderRequestPanel(panel, id, { onChanged: () => load(), nextLabel: 'Next request', start: opts && opts.start ? cardStep(id) : null });
            },
            // The pop-up closed (✕, Escape, outside, a tab change, another
            // screen): forget the request — never redraw from here.
            onClose: () => { ui.selectedId = null; },
        });
        const goBatches = host.querySelector('[data-go-batches]');
        if (goBatches) goBatches.addEventListener('click', () => root.switchView('reqBatches'));
    }

    // The step the card showed when its button was pressed ({ act, portion }),
    // so the request view starts that exact step or none.
    function cardStep(id) {
        const r = data && data.all.find(x => x.id === id);
        const step = r ? RA.requestNextStep(r, data.today) : null;
        return step ? step.act : null;
    }

    function onTab(id) {
        if (id === 'closed') { ui.scope = 'closed'; ui.selectedId = null; load(); return; }
        ui.tab = id;
        if (ui.scope === 'closed') { ui.scope = 'open'; ui.selectedId = null; load(); return; }
        draw({ leaveSelection: true });
    }

    async function load(opts) {
        if (!host) return;
        const mine = loads.next();
        if (!data || !host.querySelector('.sv')) {
            host.innerHTML = '<div class="sv"><div class="sv-empty">Loading requests…</div></div>';
        }
        let all, batches;
        try {
            [all, batches] = await Promise.all([RA.rpc('pr_office_queue', { p_scope: ui.scope }), RA.rpc('pr_office_batches')]);
        } catch (e) {
            if (!loads.isLatest(mine)) return;
            RA.fail(host, e);
            if (ui.scope === 'open' && root.NavCounts) root.NavCounts.set('requests', null);
            return;
        }
        if (!loads.isLatest(mine)) return;
        all = all || [];
        batches = batches || [];
        const now = Date.now();
        if (ui.batchId && !batches.some(b => b.id === ui.batchId)) ui.batchId = '';
        data = {
            all: all,
            batches: batches,
            current: batches.find(b => Date.parse(b.cutoff_at) > now),
            today: RA.manilaDayKey(now),
            capped: all.length >= 300,
            openCounts: ui.scope === 'open' ? RA.queueCounts(all) : (data && data.openCounts) || null,
        };
        if (ui.scope === 'open' && root.NavCounts) root.NavCounts.set('requests', data.openCounts.attn);
        // A request opened from elsewhere: show its tab, or every open one.
        if (opts && opts.reveal && ui.selectedId && ui.scope === 'open') {
            const r = all.find(x => x.id === ui.selectedId);
            const shown = ui.tab || visitTab || 'attn';
            if (r && !RA.inQueueTab(r, shown)) ui.tab = 'all';
        }
        draw({ refreshPanel: true });
    }

    function renderQueue(el) {
        host = el;
        visitTab = null;
        let reveal = false;
        if (RA.state.detailId) {
            ui.selectedId = RA.state.detailId;
            RA.state.detailId = null;
            reveal = true;
        }
        load({ reveal: reveal });
    }

    // Weekly batches → "View in queue": open the Queue already narrowed to
    // one batch, with nothing else filtered out of sight.
    RA.showQueueForBatch = function (batchId) {
        ui.scope = 'open';
        ui.batchId = batchId || '';
        ui.text = '';
        ui.tab = 'all';
        ui.selectedId = null;
        root.switchView('reqQueue');
    };

    // The red count on the Requests tab, fetched in the background for
    // accounts that can see the Queue (js/admin.js decides who).
    if (root.NavCounts) {
        root.NavCounts.register('requests', async () =>
            RA.queueCounts((await RA.rpc('pr_office_queue', { p_scope: 'open' })) || []).attn);
    }

    RA.views.reqQueue = renderQueue;
})(typeof window !== 'undefined' ? window : globalThis);