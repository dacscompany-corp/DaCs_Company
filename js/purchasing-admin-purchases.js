// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → Purchases, one purchase (reqPurchase) and Owner
// approvals (0097). Buyers only.
//
//   Purchases        — newest first, a date range and a project.
//   One purchase     — its lines, what each covered on its request, extras,
//                      unit checks, receipt photos, history; Correct (the
//                      record form), Void, Check a different unit.
//   Owner approvals  — staff changes the server keeps for the owner. The
//                      owner approves (the server runs the very same
//                      correct / replace / void) or rejects with a note;
//                      staff see their own and can withdraw.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;

    function monthStart() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
    }
    function todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    const ui = { from: null, to: null, status: 'recorded' };

    async function renderPurchases(body, me) {
        if (ui.from === null) { ui.from = monthStart(); ui.to = todayKey(); }
        let rows;
        try {
            rows = await RA.rpc('pur_purchases', { p_from: ui.from || null, p_to: ui.to || null, p_folder: null, p_status: ui.status });
        } catch (e) { RA.fail(body, e); return; }
        rows = rows || [];
        // Newest first from the server; one heading per day, with that day's total.
        const days = [];
        rows.forEach(p => {
            let g = days[days.length - 1];
            if (!g || g.date !== p.purchase_date) { g = { date: p.purchase_date, rows: [] }; days.push(g); }
            g.rows.push(p);
        });
        const sum = list => list.filter(p => p.status !== 'void').reduce((t, p) => t + (Number(p.receipt_total) || 0), 0);
        const COLS = 6;
        const rowHtml = p => '<tr class="req-row" tabindex="0" data-id="' + esc(p.id) + '">' +
            '<td><strong>' + esc((p.projects || []).join(', ') + (p.warehouse ? ((p.projects || []).length ? ' · ' : '') + 'Warehouse' : '') || '—') + '</strong>' +
              '<div class="req-muted">' + esc(p.lines + (p.lines === 1 ? ' line' : ' lines') + (p.linked ? ' · ' + p.linked + ' from requests' : '')) + '</div></td>' +
            '<td>' + (p.supplier ? esc(p.supplier) : '<span class="req-muted">No supplier</span>') + '</td>' +
            '<td>' + esc(p.bought_by_name) + (p.bought_by_name !== p.recorded_by_name ? '<div class="req-muted">recorded by ' + esc(p.recorded_by_name) + '</div>' : '') + '</td>' +
            '<td class="pur-num"><strong>' + esc(PA.peso(p.receipt_total)) + '</strong></td>' +
            '<td>' + PA.purchaseFlags(p).map(f => PA.pill(f.text, f.tone)).join(' ') + '</td>' +
            '<td class="req-go"><i data-lucide="chevron-right"></i></td></tr>';
        const total = sum(rows);
        body.innerHTML =
            '<div class="pur-filters-bar">' +
              '<div class="pur-filter-fields">' +
                '<label class="att-label">From<input class="att-input" type="date" data-from value="' + esc(ui.from) + '"></label>' +
                '<label class="att-label">To<input class="att-input" type="date" data-to value="' + esc(ui.to) + '"></label>' +
                '<label class="att-label">Show<select class="att-filter" data-status aria-label="Status">' +
                  [['recorded', 'Recorded'], ['void', 'Voided'], ['all', 'All']].map(s => '<option value="' + s[0] + '"' + (s[0] === ui.status ? ' selected' : '') + '>' + s[1] + '</option>').join('') +
                '</select></label>' +
              '</div>' +
              (rows.length
                ? '<div class="pur-summary"><span class="pur-summary-label">' + rows.length + (rows.length === 1 ? ' purchase' : ' purchases') + (ui.status === 'void' ? '' : ' · total') + '</span>' +
                  (ui.status === 'void' ? '' : '<strong>' + esc(PA.peso(total)) + '</strong>') + '</div>'
                : '') +
            '</div>' +
            (rows.length >= 300 ? '<div class="req-muted">Showing the newest 300 — narrow the dates.</div>' : '') +
            (rows.length
              ? '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table pur-ptable">' +
                  '<thead><tr><th>For</th><th>Supplier</th><th>Bought by</th><th class="pur-num">Total</th><th>Status</th><th class="req-go"><span class="req-sr">Open</span></th></tr></thead><tbody>' +
                  days.map(g => '<tr class="req-group"><td colspan="' + COLS + '"><span class="req-group-title">' + esc(RA.formatDay(g.date)) + '</span>' +
                    '<span class="req-group-count">' + g.rows.length + (g.rows.length === 1 ? ' purchase' : ' purchases') +
                    (ui.status === 'void' ? '' : ' · ' + esc(PA.peso(sum(g.rows)))) + '</span></td></tr>' + g.rows.map(rowHtml).join('')).join('') +
                '</tbody></table></div></div></div>'
              : '<div class="att-card"><div class="att-empty">No purchases in these dates. Try a wider range.</div></div>');
        const reload = () => renderPurchases(body, me);
        body.querySelector('[data-from]').addEventListener('change', e => { ui.from = e.target.value; reload(); });
        body.querySelector('[data-to]').addEventListener('change', e => { ui.to = e.target.value; reload(); });
        body.querySelector('[data-status]').addEventListener('change', e => { ui.status = e.target.value; reload(); });
        body.querySelectorAll('tr[data-id]').forEach(tr => {
            tr.addEventListener('click', () => PA.openPurchase(tr.dataset.id));
            tr.addEventListener('keydown', e => { if (e.key === 'Enter') PA.openPurchase(tr.dataset.id); });
        });
        RA.icons();
    }

    function lineRow(l, doc) {
        const covers = (doc.covers || []).filter(c => c.line === l.line);
        const req = (doc.requests || []).find(r => r.line === l.line);
        let what;
        if (req) {
            what = 'For request: ' + esc(req.description) + ' · covered ' + esc(PA.qty(l.covered) + ' ' + req.unit);
            if (Number(l.extra) > 0) what += ' · <strong>extra ' + esc(PA.qty(l.extra)) + '</strong> (' + esc(l.extra_reason) + '; ' + (l.extra_location === 'warehouse' ? 'warehouse' : 'same project') + ')';
            if (l.substitute) what += '<div>' + PA.pill('Substitute', 'pc') + ' for ' + esc(req.description + (req.spec ? ' ' + req.spec : '')) + ': ' + esc(l.substitute_reason) + '</div>';
            if (l.unit_check === 'pending') what += ' · ' + PA.pill((l.substitute ? 'Substitute' : 'Different unit') + ' — office check needed', 'abandoned');
            if (l.unit_check === 'confirmed') what += ' · ' + PA.pill('Checked: covers ' + PA.qty(l.unit_covers) + ' ' + req.unit, 'done');
            if (covers.length) what += '<div class="req-muted">' + covers.map(c => esc(PA.qty(c.quantity) + ' for ' + (c.cutoff_at ? 'Cutoff ' + RA.cutoffLabel(c.cutoff_at) : 'a removed portion') + ' · bought by ' + c.buyer_name)).join('<br>') + '</div>';
        } else {
            what = l.destination === 'warehouse' ? 'Warehouse — company stock' : 'Unplanned';
            if (l.unplanned_reason) what += ': ' + esc(l.unplanned_reason);
        }
        return '<tr><td>' + esc(l.line) + '</td><td><strong>' + esc(l.item_name) + '</strong><div class="req-muted">' +
            esc(l.destination === 'warehouse' ? 'Warehouse' : l.folder_name) + '</div></td>' +
            '<td class="pur-num">' + esc(PA.qty(l.quantity) + ' ' + (l.unit || '')) + '</td><td class="pur-num">' + esc(PA.peso(l.amount)) + '</td>' +
            '<td>' + what + (l.needs_funding_review ? ' ' + PA.pill('Office review', 'working') : '') + '</td>' +
            '<td>' + (l.unit_check === 'pending' ? '<button type="button" class="att-btn att-btn--sm" data-check="' + esc(l.line) + '">' +
              (l.substitute ? 'Check substitute…' : 'Check unit…') + '</button>' : '') + '</td></tr>';
    }

    async function renderPurchase(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading…</div></div>';
        let me, doc;
        try {
            me = await PA.me();
            if (!PA.state.purchaseId) { root.switchView('reqPurchasing'); return; }
            doc = await RA.rpc('pur_purchase', { p_purchase: PA.state.purchaseId });
        } catch (e) { RA.fail(host, e); return; }
        const open = doc.status === 'recorded';
        const pending = (doc.change_requests || []).find(r => r.status === 'pending');
        const docs = Object.entries(doc.docs || {}).filter(([, v]) => v);
        const projects = Array.from(new Set((doc.lines || []).map(l => l.destination === 'warehouse' ? 'Warehouse' : l.folder_name).filter(Boolean)));
        const events = (doc.history || []).map(h => ({ at: h.at, html: '<strong>' + esc(PA.HISTORY_LABEL[h.kind] || h.kind) + '</strong> by ' + esc(h.actor_name) + (h.reason ? ': ' + esc(h.reason) : '') }))
            .concat((doc.change_requests || []).map(r => ({ at: r.requested_at, html: 'Owner approval asked by ' + esc(r.requested_by_name) + ' (' + esc(r.kind) + '): ' + esc(r.reason) +
                ' — <strong>' + esc(PA.REQUEST_STATUS[r.status] || r.status) + '</strong>' + (r.decision_note ? ': ' + esc(r.decision_note) : '') })))
            .sort((x, y) => String(y.at).localeCompare(String(x.at)));
        const metaRow = (label, value) => value ? '<div class="req-meta-row"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>' : '';
        const nLines = (doc.lines || []).length;
        const main =
            '<div class="att-card"><div class="att-card-head"><div class="att-card-title">Items</div><div class="att-card-sub">' + nLines + (nLines === 1 ? ' line' : ' lines') + '</div></div>' +
              '<div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table pur-lines">' +
                '<thead><tr><th>#</th><th>Item</th><th class="pur-num">Quantity</th><th class="pur-num">Amount</th><th>Request</th><th></th></tr></thead><tbody>' +
                (doc.lines || []).map(l => lineRow(l, doc)).join('') +
                (doc.charges || []).map(c => '<tr><td></td><td>' + esc(c.kind === 'discount' ? 'Discount' : 'Delivery fee') + '</td><td></td><td class="pur-num">' +
                  esc((c.kind === 'discount' ? '−' : '') + PA.peso(c.amount)) + '</td><td class="req-muted">' +
                  esc((c.shares || []).map(s => 'line ' + s.line + ': ' + PA.peso(s.amount)).join(' · ')) + '</td><td></td></tr>').join('') +
              '</tbody><tfoot><tr class="pur-total"><td></td><td>Total</td><td></td><td class="pur-num"><strong>' + esc(PA.peso(doc.receipt_total)) + '</strong></td><td></td><td></td></tr></tfoot>' +
              '</table></div></div></div>';
        const side =
            '<div class="att-card"><div class="att-card-head"><div class="att-card-title">Purchase</div></div>' +
              '<dl class="req-meta pur-meta">' +
                metaRow('Date', esc(RA.formatDay(doc.purchase_date))) +
                metaRow('For', esc(projects.join(', '))) +
                metaRow('Supplier', doc.supplier ? esc(doc.supplier) : '<span class="req-muted">No supplier</span>') +
                metaRow('Total', '<strong>' + esc(PA.peso(doc.receipt_total)) + '</strong>') +
                metaRow('Bought by', esc(doc.bought_by_name)) +
                (doc.bought_by_name !== doc.recorded_by_name ? metaRow('Recorded by', esc(doc.recorded_by_name)) : '') +
                metaRow('Status', (doc.status === 'void' ? PA.pill('Voided', 'hidden') : PA.pill('Recorded', 'done')) +
                  (pending ? ' ' + PA.pill('Owner approval pending', 'working') : '')) +
              '</dl></div>' +
            '<div class="att-card"><div class="att-card-head"><div class="att-card-title">Receipt photos</div></div>' +
              (docs.length
                ? '<div class="pur-docs">' + docs.map(([k, v]) => '<a class="pur-doc" href="#" data-doc-url="' + esc(v) + '"><span class="pur-doc-ico"><i data-lucide="image"></i></span>' +
                    '<span class="pur-doc-name">' + esc(k.replace(/_url$/, '').replace(/_/g, ' ')) + '</span><span class="pur-doc-open">Open <i data-lucide="external-link"></i></span></a>').join('') + '</div>'
                : '<div class="wp-pad pur-pad req-muted">No receipt photos were added.</div>') + '</div>' +
            '<details class="att-card pur-hist" open><summary>History <span class="req-muted">' + events.length + '</span></summary>' +
              '<ul class="pur-timeline">' + events.map(e => '<li><div>' + e.html + '</div><div class="req-muted">' + esc(RA.formatManila(e.at)) + '</div></li>').join('') + '</ul></details>' +
            (open && !pending ? '<div class="pur-danger"><button type="button" class="att-link att-link--danger" data-void>Void this purchase…</button></div>' : '');
        host.innerHTML =
            '<div class="att-stack pur-tab">' +
              '<div class="att-crumbs"><button type="button" class="att-link" data-back>← Purchases</button></div>' +
              RA.head('Purchase · ' + RA.formatDay(doc.purchase_date), (projects.join(', ') || 'Purchase') + ' · ' + (doc.supplier || 'No supplier') +
                ' · bought by ' + doc.bought_by_name,
                (open && !pending ? '<button type="button" class="att-btn att-btn--primary" data-correct>Correct…</button>' : '')) +
              (doc.status === 'void' ? '<div class="att-info att-info--warn"><i data-lucide="ban"></i><div>Voided — it counts for nothing in Spent or Bought. ' +
                  (doc.replaced_by ? 'It was replaced by a newer version.' : 'Its receipt and history are kept.') + '</div></div>' : '') +
              (pending ? '<div class="att-info"><i data-lucide="hourglass"></i><div>A change is waiting for the owner (' + esc(pending.kind) + ', by ' +
                  esc(pending.requested_by_name) + '): ' + esc(pending.reason) + '</div></div>' : '') +
              '<div class="pur-layout"><div class="pur-main">' + main + '</div><aside class="pur-side">' + side + '</aside></div>' +
            '</div>';

        const reload = () => renderPurchase(host);
        host.querySelector('[data-back]').addEventListener('click', () => { PA.ui.tab = 'purchases'; root.switchView('reqPurchasing'); });
        // Purchase receipts are never given a signed link: window.open (the
        // shim in supabase-config.js §11b) downloads the photo with this
        // account's session — Storage checks the Buyer rule on every
        // download — and shows a copy that lives only in the new tab.
        host.querySelectorAll('[data-doc-url]').forEach(a => a.addEventListener('click', (e) => {
            e.preventDefault();
            root.open(a.dataset.docUrl, '_blank');
        }));
        const corr = host.querySelector('[data-correct]');
        if (corr) corr.addEventListener('click', () => PA.openRecord({ purchase: doc }));
        let sentToOwner = false;
        const vd = host.querySelector('[data-void]');
        if (vd) vd.addEventListener('click', () => RA.modal({
            title: 'Void this purchase?',
            sub: 'It leaves Spent and Bought — all ' + (doc.lines || []).length + ' line(s). The receipt and history are kept; it does not say goods were returned or money refunded.',
            body: '<label class="att-label">Reason (kept in the history)<input class="att-input" name="reason" maxlength="500" required></label>',
            submitLabel: 'Void purchase', warn: true,
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                const reason = form.reason.value.trim();
                if (!reason) throw new Error('REASON_REQUIRED');
                sentToOwner = false;
                try {
                    await RA.rpc('pur_void', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_reason: reason });
                } catch (e) {
                    if (me.isOwner || !PA.needsOwner(e)) throw e;
                    await RA.rpc('pur_request_change', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_kind: 'void', p_body: null, p_reason: reason });
                    sentToOwner = true;
                }
            },
            // The modal has closed (and cleared the shared host) by now.
            onDone: () => { reload(); if (sentToOwner) PA.notice('Only the owner can void this one (completed project). It was sent to the owner for approval.', 'Sent to the owner'); },
        }));
        host.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => {
            const l = doc.lines.find(x => String(x.line) === b.dataset.check);
            const req = (doc.requests || []).find(r => r.line === l.line);
            RA.modal({
                title: l.substitute ? 'Check a substitute' : 'Check a different unit',
                sub: (l.substitute
                        ? 'Bought ' + PA.qty(l.quantity) + ' ' + l.unit + ' of ' + l.item_name + ' instead of ' + req.description + (req.spec ? ' ' + req.spec : '') +
                          ' (' + l.substitute_reason + '). If it does the job, how many ' + req.unit + ' of the request does it cover (0 if it does not)? '
                        : 'Bought ' + PA.qty(l.quantity) + ' ' + l.unit + '; the request is in ' + req.unit + '. How many ' + req.unit + ' does this cover? ') +
                     'Someone other than the buyer checks it; it is kept in the history.',
                body: '<label class="att-label">Covers (' + esc(req.unit) + ')<input class="att-input" name="covers" inputmode="decimal" required></label>' +
                      '<label class="att-label">How you know<input class="att-input" name="note" maxlength="300" required placeholder="e.g. 2 boxes of 12"></label>',
                submitLabel: 'Confirm',
                errorMessage: PA.errorMessage,
                onSubmit: async (form) => {
                    // 0 allowed (it covers none of the request); at most 3 decimals.
                    const v = form.covers.value.replace(/,/g, '').trim();
                    if (!/^\d+(\.\d{1,3})?$/.test(v)) throw new Error('BAD_QUANTITY');
                    const covers = Number(v);
                    await RA.rpc('pur_check_unit', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_line_no: l.line,
                                                     p_covers: covers, p_note: form.note.value.trim() });
                },
                onDone: reload,
            });
        }));
        RA.icons();
    }

    // Every field of the purchase as the staff member saw it, beside what
    // they asked for — changed rows marked. A void lists the whole purchase.
    function changeTable(r) {
        if (r.kind === 'void') {
            const rows = PA.changeRows(r.base, r.base, RA.cutoffLabel);
            return '<p><strong>Void the whole purchase</strong> — it leaves Spent and Bought:</p>' +
                '<div class="req-table-wrap"><table class="att-table req-table pur-change"><tbody>' +
                rows.map(x => '<tr><td class="req-muted">' + esc(x.group) + '</td><td>' + esc(x.label) + '</td><td>' + esc(x.before) + '</td></tr>').join('') +
                '</tbody></table></div>';
        }
        const rows = PA.changeRows(r.base, r.proposed, RA.cutoffLabel);
        const n = rows.filter(x => x.changed).length;
        return '<p><strong>' + n + (n === 1 ? ' change' : ' changes') + '</strong> — every field is listed; changed ones are marked.</p>' +
            '<div class="req-table-wrap"><table class="att-table req-table pur-change"><thead><tr><th></th><th></th><th>When asked</th><th>Asked for</th></tr></thead><tbody>' +
            rows.map(x => '<tr' + (x.changed ? ' class="pur-changed"' : '') + '><td class="req-muted">' + esc(x.group) + '</td><td>' + esc(x.label) +
                (x.changed ? ' ' + PA.pill('changed', 'working') : '') + '</td><td>' + esc(x.before) + '</td><td>' + esc(x.after) + '</td></tr>').join('') +
            '</tbody></table></div>';
    }

    async function renderApprovals(body, me) {
        let list;
        try { list = await RA.rpc('pur_change_requests', { p_scope: 'all' }); } catch (e) { RA.fail(body, e); return; }
        list = list || [];
        const pending = list.filter(r => r.status === 'pending');
        const decided = list.filter(r => r.status !== 'pending').slice(0, 30);
        const KIND = { void: 'Void', replace: 'Replace' };
        const card = (r) => {
            const isOpen = r.status === 'pending';
            return '<div class="att-card pur-req' + (isOpen ? ' is-pending' : '') + '">' +
              '<div class="pur-req-head">' +
                '<div class="pur-req-title"><span class="pur-req-kind pur-req-kind--' + esc(r.kind || 'correct') + '">' + esc(KIND[r.kind] || 'Correct') + '</span>' +
                  '<span class="pur-req-by">asked by <strong>' + esc(r.requested_by_name) + '</strong></span>' +
                  '<span class="req-muted">' + esc(RA.formatManila(r.requested_at)) + '</span></div>' +
                PA.pill(PA.REQUEST_STATUS[r.status] || r.status, isOpen ? 'working' : r.status === 'approved' ? 'done' : 'hidden') +
              '</div>' +
              '<div class="pur-req-body">' +
                '<div class="pur-req-reason"><span class="pur-req-label">Reason</span>' + esc(r.reason) + '</div>' +
                (r.changed_since ? '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>The purchase changed after this was asked ' +
                    '(a correction, an office check or a receipt). It cannot be approved — ask for a new request.</div></div>' : '') +
                (isOpen ? changeTable(r) : '') +
                (r.decision_note ? '<div class="pur-req-reason"><span class="pur-req-label">Note</span>' + esc(r.decision_note) + '</div>' : '') +
              '</div>' +
              '<div class="pur-req-foot">' +
                '<button type="button" class="att-link" data-open="' + esc(r.purchase_id) + '">Open purchase →</button>' +
                '<span class="pur-spacer"></span>' +
                (isOpen && me.isOwner ? '<button type="button" class="att-btn att-btn--warn" data-reject="' + esc(r.id) + '">Reject…</button>' +
                  '<button type="button" class="att-btn att-btn--primary" data-approve="' + esc(r.id) + '"' +
                    (r.changed_since ? ' disabled title="The purchase changed after this was asked"' : '') + '>Approve</button>' : '') +
                (isOpen && !me.isOwner && r.requested_by === me.userId ? '<button type="button" class="att-btn" data-withdraw="' + esc(r.id) + '">Withdraw</button>' : '') +
              '</div></div>';
        };
        body.innerHTML =
            '<div class="att-info"><i data-lucide="shield-check"></i><div>' + (me.isOwner
                ? 'Changes your staff asked for that only you can make. Approving applies exactly the "Asked for" column, through the normal correction — and only while the purchase still reads as it did when they asked.'
                : 'Changes you sent to the owner.') + '</div></div>' +
            '<div class="pur-req-section"><h3 class="pur-h3">Waiting for the owner</h3><span class="pur-req-count' + (pending.length ? ' is-on' : '') + '">' + pending.length + '</span></div>' +
            (pending.length ? pending.map(card).join('') : '<div class="att-card"><div class="att-empty">Nothing is waiting.</div></div>') +
            (decided.length ? '<div class="pur-req-section"><h3 class="pur-h3">Decided</h3><span class="pur-req-count">' + decided.length + '</span></div>' + decided.map(card).join('') : '');
        const reload = () => renderApprovals(body, me);
        body.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => PA.openPurchase(b.dataset.open)));
        body.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try {
                const res = await RA.rpc('pur_decide_change', { p_op: root.DacsReceipts.newId(), p_request: b.dataset.approve, p_approve: true, p_note: null });
                if (res && res.status === 'stale') PA.notice('The purchase changed after this was asked, so nothing was applied. Ask for a new request.', 'Out of date');
            } catch (e) { PA.notice(e); }
            reload();
        }));
        body.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => RA.modal({
            title: 'Reject this change?',
            body: '<label class="att-label">Why (the requester sees this)<input class="att-input" name="note" maxlength="500" required></label>',
            submitLabel: 'Reject', warn: true, errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                await RA.rpc('pur_decide_change', { p_op: root.DacsReceipts.newId(), p_request: b.dataset.reject, p_approve: false, p_note: form.note.value.trim() });
            },
            onDone: reload,
        })));
        body.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
            try { await RA.rpc('pur_withdraw_change', { p_request: b.dataset.withdraw }); } catch (e) { PA.notice(e); }
            reload();
        }));
        RA.icons();
    }

    PA.renderPurchases = renderPurchases;
    PA.renderApprovals = renderApprovals;
    RA.views.reqPurchase = renderPurchase;
})(typeof window !== 'undefined' ? window : globalThis);