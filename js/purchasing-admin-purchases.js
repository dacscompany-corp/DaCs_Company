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
        body.innerHTML =
            '<div class="att-toolbar">' +
              '<label class="att-label">From<input class="att-input" type="date" data-from value="' + esc(ui.from) + '"></label>' +
              '<label class="att-label">To<input class="att-input" type="date" data-to value="' + esc(ui.to) + '"></label>' +
              '<select class="att-filter" data-status aria-label="Status">' +
                [['recorded', 'Recorded'], ['void', 'Voided'], ['all', 'All']].map(s => '<option value="' + s[0] + '"' + (s[0] === ui.status ? ' selected' : '') + '>' + s[1] + '</option>').join('') +
              '</select>' +
              (rows.length >= 300 ? '<span class="req-muted">Showing the newest 300 — narrow the dates.</span>' : '') +
            '</div>' +
            (rows.length
              ? '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table">' +
                  '<thead><tr><th>Date</th><th>Supplier</th><th>For</th><th>Total</th><th>Bought by</th><th>Status</th></tr></thead><tbody>' +
                  rows.map(p => '<tr class="req-row" tabindex="0" data-id="' + esc(p.id) + '">' +
                    '<td>' + esc(RA.formatDay(p.purchase_date)) + '</td>' +
                    '<td>' + esc(p.supplier || '—') + '</td>' +
                    '<td>' + esc((p.projects || []).join(', ') + (p.warehouse ? ((p.projects || []).length ? ' · ' : '') + 'Warehouse' : '')) +
                      '<div class="req-muted">' + esc(p.lines + (p.lines === 1 ? ' line' : ' lines') + (p.linked ? ' · ' + p.linked + ' from requests' : '')) + '</div></td>' +
                    '<td><strong>' + esc(PA.peso(p.receipt_total)) + '</strong></td>' +
                    '<td>' + esc(p.bought_by_name) + (p.bought_by_name !== p.recorded_by_name ? '<div class="req-muted">recorded by ' + esc(p.recorded_by_name) + '</div>' : '') + '</td>' +
                    '<td>' + PA.purchaseFlags(p).map(f => PA.pill(f.text, f.tone)).join(' ') + '</td>' +
                  '</tr>').join('') +
                '</tbody></table></div></div></div>'
              : '<div class="att-empty">No purchases in these dates.</div>');
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
            '<td>' + esc(PA.qty(l.quantity) + ' ' + (l.unit || '')) + '</td><td>' + esc(PA.peso(l.amount)) + '</td>' +
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
        host.innerHTML =
            '<div class="att-stack pur-tab">' +
              RA.head('Purchase · ' + RA.formatDay(doc.purchase_date), (doc.supplier || 'No supplier') + ' · ' + PA.peso(doc.receipt_total) +
                ' · bought by ' + doc.bought_by_name + (doc.bought_by_name !== doc.recorded_by_name ? ', recorded by ' + doc.recorded_by_name : ''),
                '<button type="button" class="att-btn" data-back>← Purchases</button>' +
                (open && !pending ? '<button type="button" class="att-btn" data-correct>Correct…</button><button type="button" class="att-btn att-btn--warn" data-void>Void…</button>' : '')) +
              (doc.status === 'void' ? '<div class="att-info att-info--warn"><i data-lucide="ban"></i><div>Voided — it counts for nothing in Spent or Bought. ' +
                  (doc.replaced_by ? 'It was replaced by a newer version.' : 'Its receipt and history are kept.') + '</div></div>' : '') +
              (pending ? '<div class="att-info"><i data-lucide="hourglass"></i><div>A change is waiting for the owner (' + esc(pending.kind) + ', by ' +
                  esc(pending.requested_by_name) + '): ' + esc(pending.reason) + '</div></div>' : '') +
              '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table">' +
                '<thead><tr><th>#</th><th>Item</th><th>Quantity</th><th>Amount</th><th>Request</th><th></th></tr></thead><tbody>' +
                (doc.lines || []).map(l => lineRow(l, doc)).join('') +
                (doc.charges || []).map(c => '<tr><td></td><td>' + esc(c.kind === 'discount' ? 'Discount' : 'Delivery fee') + '</td><td></td><td>' +
                  esc((c.kind === 'discount' ? '−' : '') + PA.peso(c.amount)) + '</td><td class="req-muted">' +
                  esc((c.shares || []).map(s => 'line ' + s.line + ': ' + PA.peso(s.amount)).join(' · ')) + '</td><td></td></tr>').join('') +
              '</tbody></table></div></div></div>' +
              (docs.length ? '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">Receipt photos</h3><div class="pur-docs">' +
                  docs.map(([k, v]) => '<a class="att-link" href="#" data-doc-url="' + esc(v) + '">' + esc(k.replace(/_url$/, '').replace(/_/g, ' ')) + '</a>').join(' · ') +
                '</div></div></div>' : '') +
              '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">History</h3><ul class="pur-history">' +
                (doc.history || []).map(h => '<li>' + esc(RA.formatManila(h.at)) + ' — <strong>' + esc(PA.HISTORY_LABEL[h.kind] || h.kind) + '</strong> by ' +
                  esc(h.actor_name) + (h.reason ? ': ' + esc(h.reason) : '') + '</li>').join('') +
                (doc.change_requests || []).map(r => '<li>' + esc(RA.formatManila(r.requested_at)) + ' — owner approval asked by ' + esc(r.requested_by_name) +
                  ' (' + esc(r.kind) + '): ' + esc(r.reason) + ' — <strong>' + esc(PA.REQUEST_STATUS[r.status] || r.status) + '</strong>' +
                  (r.decision_note ? ': ' + esc(r.decision_note) : '') + '</li>').join('') +
              '</ul></div></div>' +
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
        const card = (r) => '<div class="att-card"><div class="att-card-body">' +
            '<div><strong>' + esc(r.kind === 'void' ? 'Void' : r.kind === 'replace' ? 'Replace' : 'Correct') + '</strong> — asked by ' +
              esc(r.requested_by_name) + ', ' + esc(RA.formatManila(r.requested_at)) + ' · ' + PA.pill(PA.REQUEST_STATUS[r.status] || r.status,
              r.status === 'pending' ? 'working' : r.status === 'approved' ? 'done' : 'hidden') + '</div>' +
            '<div>Reason: ' + esc(r.reason) + '</div>' +
            (r.changed_since ? '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>The purchase changed after this was asked ' +
                '(a correction, an office check or a receipt). It cannot be approved — ask for a new request.</div></div>' : '') +
            (r.status === 'pending' ? changeTable(r) : '') +
            (r.decision_note ? '<div class="req-muted">Note: ' + esc(r.decision_note) + '</div>' : '') +
            '<div class="pur-rec-row">' +
              '<button type="button" class="att-btn att-btn--sm" data-open="' + esc(r.purchase_id) + '">Open purchase</button>' +
              (r.status === 'pending' && me.isOwner ? '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-approve="' + esc(r.id) + '"' +
                  (r.changed_since ? ' disabled title="The purchase changed after this was asked"' : '') + '>Approve</button>' +
                '<button type="button" class="att-btn att-btn--sm att-btn--warn" data-reject="' + esc(r.id) + '">Reject…</button>' : '') +
              (r.status === 'pending' && !me.isOwner && r.requested_by === me.userId ? '<button type="button" class="att-btn att-btn--sm" data-withdraw="' + esc(r.id) + '">Withdraw</button>' : '') +
            '</div></div></div>';
        body.innerHTML =
            '<p class="req-muted">' + (me.isOwner
                ? 'Changes your staff asked for that only you can make. Approving applies exactly the "Asked for" column, through the normal correction — and only while the purchase still reads as it did when they asked.'
                : 'Changes you sent to the owner.') + '</p>' +
            (pending.length ? pending.map(card).join('') : '<div class="att-empty">Nothing is waiting.</div>') +
            (decided.length ? '<h3 class="pur-h3">Decided</h3>' + decided.map(card).join('') : '');
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
