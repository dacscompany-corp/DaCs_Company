// ════════════════════════════════════════════════════════════════════
// Requests → Queue (WorkMate, 0086). Owner + staff.
//
// Every request with an open item, urgent first (earliest needed-by),
// then by the earliest weekly batch still to arrange. A row opens the
// request (js/requests-admin-detail.js). Closed = no open item left.
// Read-only here: every action lives on the detail screen.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;

    // Survives navigation within the session, not a reload.
    const ui = { scope: 'open', batchId: '', text: '', actionOnly: false };

    function statusPill(req, s) {
        let state;
        if (s.conflicts) state = 'conflict';
        else if (s.reductions) state = 'reduction';
        else if (s.openLines === 0) state = 'cancelled';
        else if (s.actionLines === 0) state = 'arranged';
        else state = (req.lines || []).some(l => RA.lineState(l) === 'partly' || RA.lineState(l) === 'arranged') ? 'partly' : 'unarranged';
        const label = state === 'cancelled' ? 'Closed' : RA.STATE_LABEL[state];
        return '<span class="att-pill ' + RA.STATE_PILL[state] + '">' + esc(label) + '</span>';
    }

    function rowHtml(r) {
        const s = RA.requestSummary(r);
        const urgent = s.urgent
            ? '<span class="req-urgent">URGENT' + (s.neededBy ? ' · by ' + esc(RA.formatDay(s.neededBy)) : '') + '</span>'
            : '';
        const items = (r.lines || []).map(l => esc(l.description)).slice(0, 3).join(', ') +
            ((r.lines || []).length > 3 ? ', …' : '');
        return '<tr class="req-row" tabindex="0" data-id="' + esc(r.id) + '">' +
            '<td>' + urgent + '</td>' +
            '<td>' + esc(RA.formatManila(r.received_at)) + '</td>' +
            '<td><strong>' + esc(r.requester_name) + '</strong>' +
              (r.team_name ? '<div class="req-muted">Team ' + esc(r.team_name) + '</div>' : '') + '</td>' +
            '<td>' + esc(r.project_name) + '<div class="req-muted">' + esc(r.work_name) + '</div></td>' +
            '<td>' + items + '<div class="req-muted">' + s.openLines + ' of ' + s.totalLines + ' open</div></td>' +
            '<td>' + (s.firstCutoff ? esc(RA.shortDay(s.firstCutoff)) : '—') + '</td>' +
            '<td>' + statusPill(r, s) + '</td>' +
            '</tr>';
    }

    function drawTable(host, all) {
        const list = RA.sortQueue(RA.filterQueue(all, { text: ui.text, batchId: ui.batchId, actionOnly: ui.actionOnly }));
        const body = host.querySelector('[data-rows]');
        const empty = host.querySelector('[data-empty]');
        body.innerHTML = list.map(rowHtml).join('');
        empty.style.display = list.length ? 'none' : 'block';
        empty.textContent = all.length
            ? 'No request matches these filters.'
            : (ui.scope === 'open' ? 'No open requests. New ones appear here as soon as a worker sends them.' : 'No closed requests yet.');
    }

    async function renderQueue(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading requests…</div></div>';
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

        host.innerHTML =
            '<div class="att-stack">' +
              '<div class="att-head"><div>' +
                '<h2 class="att-title">Request queue</h2>' +
                '<p class="att-sub">Materials and tools requested in DAC\'S WorkMate. Urgent first, then by weekly batch.</p>' +
              '</div></div>' +
              (current
                ? '<div class="att-info"><i data-lucide="calendar-clock"></i><div><strong>This week:</strong> ' +
                  esc(RA.batchLabel(current)) + '. Requests received after the cutoff go to the next week. ' +
                  '<button class="att-link" type="button" data-go-batches>Change batch dates</button></div></div>'
                : '') +
              (capped
                ? '<div class="att-info att-info--warn"><i data-lucide="list-filter"></i><div>Showing the newest 300 requests. ' +
                  'Requests with a reduction or an offline edit to resolve are always included.</div></div>'
                : '') +
              '<div class="att-toolbar">' +
                '<div class="att-seg" role="group" aria-label="Open or closed">' +
                  '<button type="button" class="att-seg-btn' + (ui.scope === 'open' ? ' is-on' : '') + '" data-scope="open">Open</button>' +
                  '<button type="button" class="att-seg-btn' + (ui.scope === 'closed' ? ' is-on' : '') + '" data-scope="closed">Closed</button>' +
                '</div>' +
                '<select class="att-filter" data-batch aria-label="Weekly batch">' +
                  '<option value="">All weekly batches</option>' +
                  batches.map(b => '<option value="' + esc(b.id) + '"' + (b.id === ui.batchId ? ' selected' : '') + '>' +
                    esc('Cutoff ' + RA.cutoffLabel(b.cutoff_at)) + ' (' + b.open_portions + ')</option>').join('') +
                '</select>' +
                '<div class="att-search-wrap"><i data-lucide="search"></i>' +
                  '<input class="att-search" type="search" data-text aria-label="Search" placeholder="Search worker, project, item…" value="' + esc(ui.text) + '"></div>' +
                '<label class="req-toggle"><input type="checkbox" data-action-only' + (ui.actionOnly ? ' checked' : '') + '> Needs action only</label>' +
              '</div>' +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<div class="req-table-wrap"><table class="att-table"><thead><tr>' +
                  '<th></th><th>Received</th><th>Requested by</th><th>For</th><th>Items</th><th>Batch</th><th>Status</th>' +
                '</tr></thead><tbody data-rows></tbody></table></div>' +
                '<div class="att-empty" data-empty style="display:none"></div>' +
              '</div></div>' +
            '</div>';

        drawTable(host, all);

        host.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
            if (ui.scope === b.dataset.scope) return;
            ui.scope = b.dataset.scope;
            renderQueue(host);
        }));
        host.querySelector('[data-batch]').addEventListener('change', e => { ui.batchId = e.target.value; drawTable(host, all); });
        host.querySelector('[data-text]').addEventListener('input', e => { ui.text = e.target.value; drawTable(host, all); });
        host.querySelector('[data-action-only]').addEventListener('change', e => { ui.actionOnly = e.target.checked; drawTable(host, all); });
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

    RA.views.reqQueue = renderQueue;
})(typeof window !== 'undefined' ? window : globalThis);
