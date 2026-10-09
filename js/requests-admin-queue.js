// ════════════════════════════════════════════════════════════════════
// Requests → Queue (WorkMate, 0086). Owner + staff.
//
// Every request with an open item, urgent first (earliest needed-by),
// then by the earliest weekly batch still to arrange. A row opens the
// request (js/requests-admin-detail.js). Closed = no open item left.
// Read-only here: every action lives on the detail screen.
//
// Layout (the order is unchanged -- sortQueue in the core still decides
// it; this file only makes the order visible):
//   · a summary line says how much is waiting and how much is late;
//   · rows sit under headings -- Urgent, then one heading per weekly
//     batch (its cutoff, buy and deliver days), then "Nothing left to
//     arrange" -- so the batch is read once instead of on every row;
//   · an urgent request whose needed-by day has passed says OVERDUE.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;

    // Survives navigation within the session, not a reload.
    const ui = { scope: 'open', batchId: '', text: '', actionOnly: false };

    const DAY_MS = 24 * 60 * 60 * 1000;
    const MANILA_MS = 8 * 60 * 60 * 1000;

    // Today in Manila as 'YYYY-MM-DD'. needed_by is a calendar day in the
    // same zone, so the two compare as plain strings.
    function todayKey() {
        return new Date(Date.now() + MANILA_MS).toISOString().slice(0, 10);
    }
    function daysBetween(fromKey, toKey) {
        return Math.round((Date.parse(toKey + 'T00:00:00Z') - Date.parse(fromKey + 'T00:00:00Z')) / DAY_MS);
    }

    // "Wed 7 Oct · 6:21 PM". The year is dropped while it is this year --
    // it only repeated itself on every row.
    function receivedLabel(iso) {
        const full = RA.formatManila(iso);
        const year = new Date(Date.now() + MANILA_MS).getUTCFullYear();
        return full.replace(' ' + year + ',', ' ·');
    }

    // A team called "Team test" used to print as "Team Team test".
    function teamLabel(name) {
        return /^team\b/i.test(name) ? name : 'Team ' + name;
    }

    function requestState(req, s) {
        if (s.conflicts) return 'conflict';
        if (s.reductions) return 'reduction';
        if (s.openLines === 0) return 'cancelled';
        if (s.actionLines === 0) return 'arranged';
        return (req.lines || []).some(l => RA.lineState(l) === 'partly' || RA.lineState(l) === 'arranged') ? 'partly' : 'unarranged';
    }

    function statusPill(state) {
        const label = state === 'cancelled' ? 'Closed' : RA.STATE_LABEL[state];
        return '<span class="att-pill ' + RA.STATE_PILL[state] + '">' + esc(label) + '</span>';
    }

    function urgentChip(s, today) {
        if (!s.urgent) return '';
        if (!s.neededBy) return '<span class="req-urgent">URGENT</span>';
        const late = daysBetween(s.neededBy, today);
        if (late > 0) {
            return '<span class="req-urgent req-urgent--late">OVERDUE ' + late + (late === 1 ? ' DAY' : ' DAYS') +
                   ' · needed ' + esc(RA.formatDay(s.neededBy)) + '</span>';
        }
        if (late === 0) return '<span class="req-urgent">URGENT · needed today</span>';
        return '<span class="req-urgent">URGENT · by ' + esc(RA.formatDay(s.neededBy)) + '</span>';
    }

    // "3 items" when every item is still open; "1 of 2 open" only when it
    // says something -- "3 of 3 open" on every row was noise.
    function itemsCount(s) {
        const noun = s.totalLines === 1 ? 'item' : 'items';
        if (s.openLines === 0) return s.totalLines + ' ' + noun + ' · closed';
        if (s.openLines === s.totalLines) return s.totalLines + ' ' + noun;
        return '<strong>' + s.openLines + ' of ' + s.totalLines + ' open</strong>';
    }

    function rowHtml(r, ctx) {
        const s = RA.requestSummary(r);
        const state = requestState(r, s);
        const late = s.urgent && s.neededBy && s.neededBy < ctx.today;
        const cls = 'req-row' + (s.urgent ? ' is-urgent' : '') + (late ? ' is-overdue' : '') +
                    (state === 'arranged' ? ' is-done' : '');
        const items = (r.lines || []).map(l => esc(l.description)).slice(0, 3).join(', ') +
            ((r.lines || []).length > 3 ? ', …' : '');
        return '<tr class="' + cls + '" tabindex="0" data-id="' + esc(r.id) + '">' +
            '<td class="req-received">' + esc(receivedLabel(r.received_at)) + '</td>' +
            '<td><strong>' + esc(r.requester_name) + '</strong>' +
              (r.team_name ? '<div class="req-muted">' + esc(teamLabel(r.team_name)) + '</div>' : '') + '</td>' +
            '<td>' + esc(r.project_name) + '<div class="req-muted">' + esc(r.work_name) + '</div></td>' +
            '<td>' + items + '<div class="req-muted">' + itemsCount(s) + '</div></td>' +
            '<td class="req-status-cell"><div class="req-status">' + statusPill(state) + urgentChip(s, ctx.today) + '</div></td>' +
            '<td class="req-go"><i data-lucide="chevron-right"></i></td>' +
            '</tr>';
    }

    // Which heading a request sits under. Mirrors sortQueue: urgent first,
    // then by the earliest cutoff still to arrange, then nothing-to-do last.
    function groupOf(r, ctx) {
        if (ctx.scope === 'closed') return { key: 'all', rank: 0 };
        const s = RA.requestSummary(r);
        if (s.urgent) return { key: 'urgent', rank: 0 };
        if (s.firstCutoff) return { key: 'b' + Date.parse(s.firstCutoff), cutoff: s.firstCutoff, rank: 1, time: Date.parse(s.firstCutoff) };
        // No batch left to arrange. Only a finished request belongs under
        // "Nothing left to arrange"; one that still needs a decision (an
        // open conflict on an arranged line, say) must not hide there.
        const st = requestState(r, s);
        return (st === 'arranged' || st === 'cancelled') ? { key: 'done', rank: 3 } : { key: 'open', rank: 2 };
    }

    function headingHtml(g, count, ctx) {
        const n = '<span class="req-group-count">' + count + (count === 1 ? ' request' : ' requests') + '</span>';
        if (g.key === 'urgent') {
            return '<tr class="req-group req-group--urgent"><td colspan="6">' +
                '<span class="req-group-title">Urgent</span>' +
                '<span class="req-group-meta">Needed soonest first</span>' + n + '</td></tr>';
        }
        if (g.key === 'open') {
            return '<tr class="req-group req-group--urgent"><td colspan="6">' +
                '<span class="req-group-title">Waiting on the office</span>' +
                '<span class="req-group-meta">No batch left to arrange</span>' + n + '</td></tr>';
        }
        if (g.key === 'done') {
            return '<tr class="req-group req-group--done"><td colspan="6">' +
                '<span class="req-group-title">Nothing left to arrange</span>' + n + '</td></tr>';
        }
        const t = Date.parse(g.cutoff);
        const b = ctx.batches.find(x => Date.parse(x.cutoff_at) === t);
        const isCurrent = !!(b && ctx.current && b.id === ctx.current.id);
        return '<tr class="req-group"><td colspan="6">' +
            '<span class="req-group-title">Cutoff ' + esc(RA.cutoffLabel(g.cutoff)) + '</span>' +
            (isCurrent ? '<span class="att-pill att-pill--done">This week</span>' : '') +
            (b ? '<span class="req-group-meta">Buy ' + esc(RA.formatDay(b.purchase_on)) +
                 ' · Deliver ' + esc(RA.formatDay(b.delivery_on)) + '</span>' : '') + n + '</td></tr>';
    }

    // The one-line picture: how much is waiting, how much is late.
    function summaryHtml(all, ctx) {
        if (ctx.scope === 'closed') {
            return '<div class="req-summary"><span class="req-sum req-sum--plain"><strong>' + all.length +
                   '</strong> closed request' + (all.length === 1 ? '' : 's') + '</span></div>';
        }
        let urgent = 0, overdue = 0, toArrange = 0, resolve = 0, arranged = 0;
        all.forEach(function (r) {
            const s = RA.requestSummary(r);
            const st = requestState(r, s);
            if (s.urgent) urgent++;
            if (s.urgent && s.neededBy && s.neededBy < ctx.today) overdue++;
            if (st === 'unarranged' || st === 'partly') toArrange++;
            else if (st === 'conflict' || st === 'reduction') resolve++;
            else if (st === 'arranged') arranged++;
        });
        const chip = (n, text, tone) => n
            ? '<span class="req-sum req-sum--' + tone + '"><strong>' + n + '</strong> ' + text + '</span>' : '';
        return '<div class="req-summary">' +
            '<span class="req-sum req-sum--plain"><strong>' + all.length + '</strong> open request' +
              (all.length === 1 ? '' : 's') + '</span>' +
            chip(overdue, 'overdue', 'red') +
            chip(urgent - overdue, 'urgent', 'red') +
            chip(resolve, 'to resolve', 'red') +
            chip(toArrange, 'to arrange', 'gold') +
            chip(arranged, 'arranged', 'green') +
            '</div>';
    }

    function drawTable(host, all, ctx) {
        const list = RA.sortQueue(RA.filterQueue(all, { text: ui.text, batchId: ui.batchId, actionOnly: ui.actionOnly }));
        const body = host.querySelector('[data-rows]');
        const empty = host.querySelector('[data-empty]');
        const count = host.querySelector('[data-count]');

        // Bucket by heading, keeping sortQueue's order inside each bucket.
        // Buckets are looked up by key rather than assumed contiguous, so a
        // request with no batch can never split a heading in two.
        const groups = [];
        const byKey = {};
        list.forEach(function (r) {
            const g = groupOf(r, ctx);
            if (!byKey[g.key]) { byKey[g.key] = { g: g, rows: [] }; groups.push(byKey[g.key]); }
            byKey[g.key].rows.push(r);
        });
        groups.sort((a, b) => (a.g.rank - b.g.rank) || ((a.g.time || 0) - (b.g.time || 0)));
        body.innerHTML = groups.map(function (grp) {
            return (grp.g.key === 'all' ? '' : headingHtml(grp.g, grp.rows.length, ctx)) +
                   grp.rows.map(r => rowHtml(r, ctx)).join('');
        }).join('');

        const filtered = list.length !== all.length;
        count.textContent = filtered ? 'Showing ' + list.length + ' of ' + all.length : '';
        host.querySelector('[data-table]').style.display = list.length ? '' : 'none';
        empty.style.display = list.length ? 'none' : 'block';
        if (all.length) {
            empty.innerHTML = 'No request matches these filters. <button class="att-link" type="button" data-clear>Clear filters</button>';
            const clear = empty.querySelector('[data-clear]');
            clear.addEventListener('click', function () {
                ui.batchId = ''; ui.text = ''; ui.actionOnly = false;
                renderQueue(host.closest('[data-queue-host]') || host.parentNode);
            });
        } else {
            empty.textContent = ui.scope === 'open'
                ? 'No open requests. New ones appear here as soon as a worker sends them.'
                : 'No closed requests yet.';
        }
        RA.icons();
    }

    async function renderQueue(host) {
        host.setAttribute('data-queue-host', '');
        host.innerHTML = '<div class="att-stack req-queue"><div class="att-empty">Loading requests…</div></div>';
        let all, batches;
        try {
            [all, batches] = await Promise.all([RA.rpc('pr_office_queue', { p_scope: ui.scope }), RA.rpc('pr_office_batches')]);
        } catch (e) { RA.fail(host, e); return; }
        all = all || [];
        batches = batches || [];
        const capped = all.length >= 300;
        const now = Date.now();
        const current = batches.find(b => Date.parse(b.cutoff_at) > now);
        if (ui.batchId && !batches.some(b => b.id === ui.batchId)) ui.batchId = '';
        const ctx = { scope: ui.scope, batches: batches, current: current, today: todayKey() };

        host.innerHTML =
            '<div class="att-stack req-queue">' +
              '<div class="att-head"><div>' +
                '<h2 class="att-title">Request queue</h2>' +
                '<p class="att-sub">Materials and tools requested in DAC\'S WorkMate. Urgent first, then by weekly batch.</p>' +
              '</div></div>' +
              (current
                ? '<div class="att-info req-week"><i data-lucide="calendar-clock"></i>' +
                  '<div class="req-week-main"><span class="req-week-title">This week</span>' +
                    '<span class="req-steps">' +
                      '<span class="req-step"><em>Cutoff</em><strong>' + esc(RA.cutoffLabel(current.cutoff_at)) + '</strong></span>' +
                      '<span class="req-arrow">→</span>' +
                      '<span class="req-step"><em>Buy</em><strong>' + esc(RA.formatDay(current.purchase_on)) + '</strong></span>' +
                      '<span class="req-arrow">→</span>' +
                      '<span class="req-step"><em>Deliver</em><strong>' + esc(RA.formatDay(current.delivery_on)) + '</strong></span>' +
                    '</span>' +
                    '<span class="req-week-note">Requests received after the cutoff go to the next week.</span>' +
                    '<button class="att-link req-week-edit" type="button" data-go-batches>Change batch dates</button>' +
                  '</div></div>'
                : '') +
              (capped
                ? '<div class="att-info att-info--warn"><i data-lucide="list-filter"></i><div>Showing the newest 300 requests. ' +
                  'Requests with a reduction or an offline edit to resolve are always included.</div></div>'
                : '') +
              summaryHtml(all, ctx) +
              '<div class="att-toolbar">' +
                '<div class="att-seg" role="group" aria-label="Open or closed">' +
                  '<button type="button" class="att-seg-btn' + (ui.scope === 'open' ? ' is-on' : '') + '" data-scope="open">Open' +
                    (ui.scope === 'open' ? ' <span class="req-tabn">' + all.length + '</span>' : '') + '</button>' +
                  '<button type="button" class="att-seg-btn' + (ui.scope === 'closed' ? ' is-on' : '') + '" data-scope="closed">Closed' +
                    (ui.scope === 'closed' ? ' <span class="req-tabn">' + all.length + '</span>' : '') + '</button>' +
                '</div>' +
                '<select class="att-filter" data-batch aria-label="Weekly batch">' +
                  '<option value="">All weekly batches</option>' +
                  batches.map(b => '<option value="' + esc(b.id) + '"' + (b.id === ui.batchId ? ' selected' : '') + '>' +
                    esc('Cutoff ' + RA.cutoffLabel(b.cutoff_at)) + ' (' + b.open_portions + ')</option>').join('') +
                '</select>' +
                '<div class="att-search-wrap"><i data-lucide="search"></i>' +
                  '<input class="att-search" type="search" data-text aria-label="Search" placeholder="Search worker, project, item…" value="' + esc(ui.text) + '"></div>' +
                '<label class="req-toggle"><input type="checkbox" data-action-only' + (ui.actionOnly ? ' checked' : '') + '> Needs action only</label>' +
                '<span class="req-count" data-count aria-live="polite"></span>' +
              '</div>' +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<div class="req-table-wrap"><table class="att-table req-table" data-table><thead><tr>' +
                  '<th>Received</th><th>Requested by</th><th>For</th><th>Items</th><th>Status</th>' +
                  '<th class="req-go"><span class="req-sr">Open</span></th>' +
                '</tr></thead><tbody data-rows></tbody></table></div>' +
                '<div class="att-empty" data-empty style="display:none"></div>' +
              '</div></div>' +
            '</div>';

        drawTable(host, all, ctx);

        host.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
            if (ui.scope === b.dataset.scope) return;
            ui.scope = b.dataset.scope;
            renderQueue(host);
        }));
        host.querySelector('[data-batch]').addEventListener('change', e => { ui.batchId = e.target.value; drawTable(host, all, ctx); });
        host.querySelector('[data-text]').addEventListener('input', e => { ui.text = e.target.value; drawTable(host, all, ctx); });
        host.querySelector('[data-action-only]').addEventListener('change', e => { ui.actionOnly = e.target.checked; drawTable(host, all, ctx); });
        const goBatches = host.querySelector('[data-go-batches]');
        if (goBatches) goBatches.addEventListener('click', () => root.switchView('reqBatches'));
        const rows = host.querySelector('[data-rows]');
        rows.addEventListener('click', e => {
            const tr = e.target.closest('tr[data-id]');
            if (tr) RA.openRequest(tr.dataset.id);
        });
        rows.addEventListener('keydown', e => {
            const tr = e.target.closest('tr[data-id]');
            if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); RA.openRequest(tr.dataset.id); }
        });
        RA.icons();
    }

    // Weekly batches → "View in queue": open the Queue already narrowed to
    // one batch, with nothing else filtered out of sight.
    RA.showQueueForBatch = function (batchId) {
        ui.scope = 'open';
        ui.batchId = batchId || '';
        ui.text = '';
        ui.actionOnly = false;
        root.switchView('reqQueue');
    };

    RA.views.reqQueue = renderQueue;
})(typeof window !== 'undefined' ? window : globalThis);