// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → Reconciliation (WorkMate Stage 4, migration 0109).
// Owner accounts allowed Expenses only; the server refuses everyone else,
// and leaves the cash figures out for anyone but the main owner.
//
// It READS and POINTS. Nothing here writes an expense row, a payment, a
// billing period or a client bill; nothing feeds Spent, Earned or Profit.
// The only writes are two owner decisions that move no money (rec_*):
//   "Cover is right" (and its withdrawal) — clears one line's "Office
//     review" mark; its rows stay on Cover and in Spent (Q6);
//   "Bill checked" — a tick after the office decided, by hand, whether a
//     client's bill needs adjusting for a cost move (Q10).
//
// Sections, top to bottom:
//   Waiting                 — counts with links; decisions stay where they are (Q5)
//   Where every purchase peso is — own project · other projects · company
//                             stock · company stock loss = recorded; a
//                             difference is a bug to report (Q4); print, CSV
//   Waiting for a billing period — the "Office review" lines; "Cover is
//                             right…", and the marks with "Withdraw…" (Q6)
//   Money still out         — owed by supplier, credits; cash for the main owner (Q9)
//   Bills to check          — each approval and reversal of a stock cost move,
//                             with the months it changed on each side (Q10)
//
// Works in a browser (window.ReconciliationAdmin) and in Node for
// tests/reconciliation-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    function peso(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return (x < 0 ? '−' : '') + '₱' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // "YYYY-MM-DD" from LOCAL date parts (PH is UTC+8 — never toISOString).
    function dayKey(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    // This month so far: the default range.
    function monthRange(now) {
        const d = now || new Date();
        return { from: dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), to: dayKey(d) };
    }

    // "Adds up ✓", or the difference and how many purchases carry one.
    function addsUpText(totals) {
        const t = totals || {};
        if (!Number(t.with_difference)) return 'Adds up ✓';
        return 'Difference ' + peso(t.difference) + ' in ' + t.with_difference + (Number(t.with_difference) === 1 ? ' purchase' : ' purchases') +
            ' — please tell the developer (a difference is a bug, not a business event).';
    }

    // Waiting (Q5): one line per count above zero, with where it is decided.
    // go: {tab} = a Purchasing tab, {view} = another screen, {anchor} = a
    // section of this tab.
    const WAITING = [
        ['billing_period', 'waiting for a billing period', 'line', { anchor: 'rec-review' }],
        ['bills', 'to check on a client\'s bill', 'stock cost move', { anchor: 'rec-bills' }],
        ['cost_moves', 'waiting for approval', 'stock cost move', { tab: 'approvals' }],
        ['change_requests', 'waiting for the owner', 'purchase change', { tab: 'approvals' }],
        ['unpaid', 'Unpaid or Partly paid', 'purchase', { tab: 'purchases' }],
        ['own_money', 'to accept or reject', 'own-money payment', { tab: 'cash' }],
        ['returns', 'to confirm', 'petty-cash return', { tab: 'cash' }],
        ['disputes', 'disputed', 'petty-cash handover', { tab: 'cash' }],
        ['overpaid', 'Overpaid', 'purchase', { tab: 'cash' }],
        ['stock', 'waiting for the owner', 'stock record', { view: 'reqStock' }],
        ['tools', 'waiting for the owner (Lost or Retire)', 'tool', { view: 'reqTools' }],
    ];
    function waitingItems(w) {
        const x = w || {};
        return WAITING.filter(([k]) => Number(x[k]) > 0).map(([k, what, noun, go]) => ({
            key: k, count: Number(x[k]), go,
            label: x[k] + ' ' + noun + (Number(x[k]) === 1 ? '' : 's') + ' ' + what,
        }));
    }

    // One side of a cost move on a bill: "Barlin · October 2026 · billing #1 (Cover) −₱300.00".
    function sideText(s) {
        return s.project + ' · ' + s.period + (s.cover ? ' (Cover)' : '') + ' ' + peso(s.amount);
    }

    function placesCsv(data) {
        const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const money = (v) => (Math.round(Number(v || 0) * 100) / 100).toFixed(2);
        const head = ['Purchase date', 'Ref', 'What', 'Where', 'Supplier', 'Recorded', 'Own project', 'Other projects',
                      'Company stock', 'Company stock loss', 'Difference'];
        const lines = [head.map(cell).join(',')];
        (data.purchases || []).forEach(p => lines.push([p.purchase_date, p.ref, p.what, p.projects, p.supplier, money(p.recorded), money(p.own),
            money(p.other), money(p.company), money(p.loss), money(p.difference)].map(cell).join(',')));
        const t = data.totals || {};
        lines.push(['Total', '', t.purchases + ' purchases', '', '', money(t.recorded), money(t.own), money(t.other), money(t.company),
            money(t.loss), money(t.difference)].map(cell).join(','));
        (data.voided || []).forEach(v => lines.push([v.purchase_date, v.ref, 'VOIDED: ' + (v.what || ''), '', '', money(v.recorded), '', '', '', '', '']
            .map(cell).join(',')));
        return lines.join('\r\n') + '\r\n';
    }

    const ERRORS = {
        OWNER_ONLY: 'Only owner accounts see Reconciliation.',
        NOT_ALLOWED: 'This account is not set up for Expenses.',
        NOT_OFFICE: 'Only owner accounts see Reconciliation.',
        BAD_DATE: 'Check the dates.',
        BAD_RANGE: 'The first day must be on or before the last (at most about ten years).',
        REASON_REQUIRED: 'Please give a reason.',
        NOT_WAITING: 'This line is no longer waiting for a billing period. Reload the page.',
        NOT_COVER: 'This line is not on Cover. Reload the page.',
        CHANGED_SINCE: 'The line changed (or was marked again) after this mark, so it no longer applies.',
        BAD_STATE: 'This was already done or no longer applies. Reload the page.',
        BAD_NOTE: 'The note is too long (500 characters at most).',
        NOT_FOUND: 'That was not found. Reload the page.',
        BAD_OP: 'Something went wrong. Close the form and try again.',
        PGRST202: 'Reconciliation is not installed on the server yet (migration 0109).',
    };
    function errorMessage(error) {
        const text = String((error && (error.message || error.code || error.error_description)) || (typeof error === 'string' ? error : '') || '');
        if (error && error.code === 'PGRST202') return ERRORS.PGRST202;
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) return ERRORS[code];
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    const pure = { peso, dayKey, monthRange, addsUpText, waitingItems, sideText, placesCsv, ERRORS, errorMessage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser ─────────────────────────────────────────────────────

    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;
    const ui = { from: null, to: null };

    const newOp = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    // One operation id per opened form: a double press or a retry records once.
    function sendOnce(fn) {
        const opId = newOp();
        return (...args) => fn(opId, ...args);
    }
    function pill(text, tone) { return '<span class="att-pill att-pill--' + tone + '">' + esc(text) + '</span>'; }
    function section(id, title, sub, inner) {
        return '<section id="' + id + '" class="rec-section" style="margin-bottom:28px"><h3 class="pur-h3">' + esc(title) + '</h3>' +
            (sub ? '<p class="req-muted">' + esc(sub) + '</p>' : '') + inner + '</section>';
    }
    const when = (ts) => ts ? RA.formatManila(ts) : '';

    // ── Waiting (Q5) ────────────────────────────────────────────────
    function waitingHtml(w) {
        const items = waitingItems(w);
        if (!items.length) return '<div class="att-empty">Nothing is waiting.</div>';
        return '<div class="rec-waiting">' + items.map((it, i) =>
            '<button type="button" class="att-btn att-btn--sm" data-go="' + i + '">' + esc(it.label) + ' →</button>').join(' ') + '</div>';
    }
    function go(target, host) {
        if (target.anchor) {
            const el = host.querySelector('#' + target.anchor);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (target.tab) { PA.ui.tab = target.tab; root.switchView('reqPurchasing'); return; }
        if (target.view) root.switchView(target.view);
    }

    // ── Where every purchase peso is (Q4) ───────────────────────────
    function placesHtml(d) {
        const t = d.totals || {};
        const ok = !Number(t.with_difference);
        const num = (v) => '<td style="text-align:right">' + esc(peso(v)) + '</td>';
        return '<div class="att-toolbar" style="align-items:flex-end">' +
              '<label class="att-label">From<input class="att-input" type="date" data-from value="' + esc(ui.from) + '"></label>' +
              '<label class="att-label">To<input class="att-input" type="date" data-to value="' + esc(ui.to) + '"></label>' +
              '<button type="button" class="att-btn att-btn--sm" data-show>Show</button>' +
              '<button type="button" class="att-btn att-btn--sm" data-print>Print</button>' +
              '<button type="button" class="att-btn att-btn--sm" data-csv>CSV</button>' +
            '</div>' +
            '<div class="att-info' + (ok ? '' : ' att-info--warn') + '"><i data-lucide="' + (ok ? 'check-circle' : 'alert-triangle') + '"></i><div><strong>' +
              esc(addsUpText(t)) + '</strong> ' + esc(t.purchases + ' purchase' + (Number(t.purchases) === 1 ? '' : 's') + ', ' + peso(t.recorded) +
              ': ' + peso(t.own) + ' in their own projects, ' + peso(t.other) + ' in other projects, ' + peso(t.company) + ' company stock, ' +
              peso(t.loss) + ' company stock loss.') + '</div></div>' +
            ((d.purchases || []).length
                ? '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table"><thead><tr>' +
                  '<th>Date</th><th>Ref</th><th>What · where</th><th style="text-align:right">Recorded</th><th style="text-align:right">Own project</th>' +
                  '<th style="text-align:right">Other projects</th><th style="text-align:right">Company stock</th><th style="text-align:right">Stock loss</th>' +
                  '<th style="text-align:right">Difference</th></tr></thead><tbody>' +
                  d.purchases.map(p => '<tr class="req-row" tabindex="0" data-purchase="' + esc(p.id) + '"' +
                      (Number(p.difference) ? ' style="background:#fff4f2"' : '') + '><td style="white-space:nowrap">' + esc(RA.formatDay(p.purchase_date)) + '</td><td><code>' + esc(p.ref) +
                      '</code></td><td>' + esc(p.what) + '<div class="req-muted">' + esc(p.projects) + (p.supplier ? ' · ' + esc(p.supplier) : '') + '</div></td>' +
                      num(p.recorded) + num(p.own) + num(p.other) + num(p.company) + num(p.loss) +
                      '<td style="text-align:right"><strong>' + esc(Number(p.difference) ? peso(p.difference) : '✓') + '</strong></td></tr>').join('') +
                  '</tbody></table></div></div></div>'
                : '<div class="att-empty">No purchases in these days.</div>') +
            ((d.voided || []).length
                ? '<p class="req-muted">Voided in these days (counted nowhere): ' + d.voided.map(v => esc(v.ref + ' ' + RA.formatDay(v.purchase_date) + ' ' +
                    peso(v.recorded) + (v.reason ? ' — ' + v.reason : ''))).join(' · ') + '</p>'
                : '');
    }
    function printPlaces(d) {
        const w = root.open('', '_blank');
        if (!w) return PA.notice('Allow pop-ups for this site to print.');
        const rows = (d.purchases || []).map(p => '<tr><td>' + esc(p.purchase_date) + '</td><td>' + esc(p.ref) + '</td><td>' + esc(p.what) +
            '<br><small>' + esc(p.projects) + '</small></td>' + [p.recorded, p.own, p.other, p.company, p.loss, p.difference]
            .map(v => '<td style="text-align:right">' + esc(peso(v)) + '</td>').join('') + '</tr>').join('');
        w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Where every purchase peso is</title><style>' +
            'body{font:12px Arial,sans-serif;margin:24px}table{width:100%;border-collapse:collapse}th,td{padding:5px;border-bottom:1px solid #ccc;text-align:left}' +
            '@page{size:A4 landscape;margin:12mm}</style></head><body>' +
            (root.dacsPrintHeader ? root.dacsPrintHeader('Reconciliation', 'Printed ' + esc(new Date().toLocaleString('en-PH'))) : '') +
            '<h2>Where every purchase peso is — ' + esc(d.from + ' to ' + d.to) + '</h2><p><strong>' + esc(addsUpText(d.totals)) + '</strong></p>' +
            '<table><thead><tr><th>Date</th><th>Ref</th><th>What · where</th><th>Recorded</th><th>Own project</th><th>Other projects</th>' +
            '<th>Company stock</th><th>Stock loss</th><th>Difference</th></tr></thead><tbody>' + rows + '</tbody></table>' +
            '<p>For internal use only. A payment never changes Spent; company stock is never a project\'s Spent or company overhead.</p></body></html>');
        w.document.close();
        w.focus();
        w.print();
    }
    function downloadCsv(d) {
        const blob = new Blob([placesCsv(d)], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'purchase-reconciliation-' + d.from + '-to-' + d.to + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // ── Waiting for a billing period (Q6) ───────────────────────────
    function reviewHtml(r) {
        const wait = r.waiting || [];
        const marks = r.marks || [];
        return (wait.length ? wait.map(l => '<div class="att-card" data-line="' + esc(l.purchase_id + ':' + l.line_no) + '"><div class="att-card-body">' +
                '<div><strong>' + esc(l.item) + '</strong> · ' + esc(l.project) + ' · <strong>' + esc(peso(l.amount)) + '</strong> ' + pill('Office review', 'working') + '</div>' +
                '<div class="req-muted">Ref <code>' + esc(l.ref) + '</code> · bought ' + esc(RA.formatDay(l.purchase_date)) + ' · waiting ' + esc(l.days) +
                  ' day' + (Number(l.days) === 1 ? '' : 's') + ' · on ' + (l.rows || []).map(x => esc(x.period + (x.cover ? ' (Cover)' : '') + ' ' + peso(x.amount))).join(', ') + '</div>' +
                (l.period_now ? '<div class="att-info"><i data-lucide="info"></i><div>A billing period for that month exists now. To charge it there, open the row in ' +
                  'Project Control and save it again.</div></div>' : '') +
                '<div class="att-actions-row" style="margin-top:10px"><button type="button" class="att-btn att-btn--sm" data-cover>Cover is right…</button></div>' +
              '</div></div>').join('')
            : '<div class="att-empty">No line is waiting for a billing period.</div>') +
            (marks.length ? '<h4 class="pur-h4">"Cover is right" marks</h4><ul class="pur-history">' + marks.map(m => '<li data-mark="' + esc(m.id) + '">' +
                esc(m.item + ' · ' + m.project + ' · ' + peso(m.amount) + ' (ref ' + m.ref + ', bought ' + RA.formatDay(m.purchase_date) + ')') + ' — "' + esc(m.reason) + '" · ' +
                esc(m.marked_by + ', ' + when(m.marked_at)) + ' ' +
                (m.withdrawn_at ? pill('Withdrawn', 'abandoned') + ' <span class="req-muted">' + esc(m.withdrawn_by + ', ' + when(m.withdrawn_at) + ': ' + m.withdraw_reason) + '</span>'
                  : m.current ? pill('Applies', 'done') + ' <button type="button" class="att-btn att-btn--sm" data-withdraw>Withdraw…</button>'
                  : pill('No longer applies (the line changed)', 'abandoned')) + '</li>').join('') + '</ul>' : '');
    }
    function openCover(line, onDone) {
        const send = sendOnce((opId, reason) => RA.rpc('rec_accept_cover', { p_op: opId, p_purchase: line.purchase_id, p_line_no: line.line_no, p_reason: reason }));
        RA.modal({
            title: 'Cover is right',
            sub: line.item + ' · ' + line.project + ' · ' + peso(line.amount) + ' (ref ' + line.ref + '). This only clears the "Office review" mark: ' +
                'the cost stays on Cover and in Spent, and nothing is billed.',
            body: '<div class="stk-form"><label class="att-label">Why Cover is right (kept with the mark)<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: 'Mark Cover is right',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.reason.value.trim());
            },
            onDone,
        });
    }
    function openWithdraw(mark, onDone) {
        const send = sendOnce((opId, reason) => RA.rpc('rec_withdraw_cover', { p_op: opId, p_mark: mark.id, p_reason: reason }));
        RA.modal({
            title: 'Withdraw "Cover is right"',
            sub: mark.item + ' · ' + mark.project + ' · ' + peso(mark.amount) + '. The line goes back to waiting for a billing period; nothing moves.',
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Reason<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: 'Withdraw',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.reason.value.trim());
            },
            onDone,
        });
    }

    // ── Money still out (Q9) ────────────────────────────────────────
    function moneyHtml(m) {
        const owed = m.owed || [];
        const total = owed.reduce((s, x) => s + Number(x.balance || 0), 0);
        const nt = m.not_tracked || {};
        return (owed.length
                ? '<div class="att-card"><div class="att-card-body" style="padding:0"><table class="att-table req-table"><thead><tr><th>Supplier</th>' +
                  '<th style="text-align:right">Purchases</th><th style="text-align:right">Still owed</th></tr></thead><tbody>' +
                  owed.map(x => '<tr><td>' + esc(x.supplier) + '</td><td style="text-align:right">' + esc(x.purchases) +
                      (Number(x.partly_paid) ? ' <span class="req-muted">(' + esc(x.partly_paid) + ' partly paid)</span>' : '') + '</td><td style="text-align:right"><strong>' +
                      esc(peso(x.balance)) + '</strong></td></tr>').join('') +
                  '<tr><td><strong>Total</strong></td><td></td><td style="text-align:right"><strong>' + esc(peso(total)) + '</strong></td></tr></tbody></table></div></div>'
                : '<div class="att-empty">Nothing Unpaid or Partly paid.</div>') +
            (Number(nt.purchases) ? '<p class="req-muted">' + esc(nt.purchases + ' purchase' + (Number(nt.purchases) === 1 ? '' : 's') + ' (' + peso(nt.total) +
                ') recorded before payments were tracked — never counted as owed.') + '</p>' : '') +
            ((m.credits || []).length ? '<p><strong>Supplier credit left:</strong> ' + m.credits.map(c => esc(c.supplier + ' ' + peso(c.left))).join(' · ') + '</p>' : '') +
            (m.overpaid && Number(m.overpaid.purchases) ? '<p><strong>Overpaid:</strong> ' + esc(m.overpaid.purchases + ' purchase' +
                (Number(m.overpaid.purchases) === 1 ? '' : 's') + ', ' + peso(m.overpaid.amount) + ' to refund or keep as credit') + ' (Cash tab).</p>' : '') +
            ((m.buyers || []).length ? '<p><strong>Buyers:</strong> ' + m.buyers.map(b => esc(b.name + ' — holds ' + peso(b.cash_held) +
                (Number(b.shortfall) ? ', shortfall ' + peso(b.shortfall) : '') + (Number(b.owed_to_buyer) ? ', company owes ' + peso(b.owed_to_buyer) : '') +
                (Number(b.own_money_to_review) ? ', ' + peso(b.own_money_to_review) + ' own money to review' : ''))).join(' · ') + '</p>' : '') +
            '<p class="req-muted">Payments never change Spent. Paying, refunds and credits are recorded on each purchase and in the Cash tab.</p>';
    }

    // ── Bills to check (Q10) ────────────────────────────────────────
    function billsHtml(list) {
        if (!list.length) return '<div class="att-empty">No stock cost move has changed a project\'s months yet.</div>';
        return list.map((b, i) => '<div class="att-card" data-bill="' + i + '"><div class="att-card-body">' +
            '<div>' + (b.checked ? pill('Bill checked', 'done') : pill('To check', 'working')) + ' <strong>' + esc(b.change === 'reversed' ? 'Reversed' : 'Approved') +
              '</strong> ' + esc(when(b.at)) + ' · ' + esc(b.item + ' ' + (b.quantity || '') + ' ' + (b.unit || '') + ': ' + b.from + ' → ' + b.to + ' · ' + peso(b.value)) + '</div>' +
            '<ul class="req-muted">' + (b.sides || []).map(s => '<li>' + esc(sideText(s)) + '</li>').join('') + '</ul>' +
            (b.checked && b.note ? '<div class="req-muted">"' + esc(b.note) + '" — ' + esc(b.checked_by + ', ' + when(b.checked_at)) + '</div>' : '') +
            '<div class="att-actions-row" style="margin-top:10px"><button type="button" class="att-btn att-btn--sm" data-tick>' + (b.checked ? 'Un-tick…' : 'Bill checked…') + '</button></div>' +
            '</div></div>').join('');
    }
    function openTick(b, onDone) {
        const checked = !b.checked;
        const send = sendOnce((opId, note) => RA.rpc('rec_bill_check', { p_op: opId, p_cost_move: b.cost_move_id, p_group: b.group,
                                                                         p_checked: checked, p_note: note }));
        RA.modal({
            title: checked ? 'Bill checked' : 'Un-tick "Bill checked"',
            sub: checked ? 'You decided whether the client\'s bill needs adjusting for this cost move. This never changes a bill.'
                         : 'It goes back to the list to check.',
            body: '<div class="stk-form"><label class="att-label">Note (optional — e.g. which bill, what you did)<input class="att-input" name="note" maxlength="500"></label></div>',
            submitLabel: checked ? 'Bill checked' : 'Un-tick',
            errorMessage,
            onSubmit: async (form) => { await send(form.note.value.trim()); },
            onDone,
        });
    }

    // ── The tab ─────────────────────────────────────────────────────
    async function render(body) {
        if (!ui.from) Object.assign(ui, monthRange());
        body.innerHTML = '<div class="att-empty">Loading…</div>';
        let places, waiting, review, bills, money;
        try {
            [places, waiting, review, bills, money] = await Promise.all([
                RA.rpc('rec_purchase_places', { p_from: ui.from, p_to: ui.to }), RA.rpc('rec_waiting'), RA.rpc('rec_review_lines'),
                RA.rpc('rec_bills'), RA.rpc('rec_money_out')]);
        } catch (e) {
            body.innerHTML = '<div class="att-empty">' + esc(errorMessage(e)) + '</div>';
            return;
        }
        bills = bills || [];
        const again = () => render(body);
        // After a mark or its withdrawal, Project Control's and Expenses' "Office review" marks follow at once.
        const afterMark = () => { if (root.expPurReloadFlags) root.expPurReloadFlags(); render(body); };
        body.innerHTML =
            '<p class="req-muted">Checks, not a ledger: nothing here moves a peso or changes a bill. Owner accounts only.</p>' +
            section('rec-waiting', 'Waiting', 'What needs someone, and where it is decided.', waitingHtml(waiting)) +
            section('rec-places', 'Where every purchase peso is', 'For the purchases made in these days, where their pesos sit today. ' +
                'The two sides come from different records, so they must agree.', placesHtml(places)) +
            section('rec-review', 'Waiting for a billing period', 'Charged to Cover because the purchase month had no billing period. ' +
                'Add the period and save the row again, or mark it "Cover is right".', reviewHtml(review)) +
            section('rec-money', 'Money still out', '', moneyHtml(money || {})) +
            section('rec-bills', 'Bills to check', 'Each approved or reversed stock cost move changed these months. Client bills are never changed ' +
                'automatically: decide by hand, then tick.', billsHtml(bills));
        const items = waitingItems(waiting);
        body.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(items[Number(b.dataset.go)].go, body)));
        body.querySelector('[data-show]').addEventListener('click', () => {
            ui.from = body.querySelector('[data-from]').value; ui.to = body.querySelector('[data-to]').value;
            again();
        });
        body.querySelector('[data-print]').addEventListener('click', () => printPlaces(places));
        body.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(places));
        body.querySelectorAll('[data-purchase]').forEach(tr => tr.addEventListener('click', () => PA.openPurchase(tr.dataset.purchase)));
        body.querySelectorAll('[data-line]').forEach(card => {
            const l = (review.waiting || []).find(x => x.purchase_id + ':' + x.line_no === card.dataset.line);
            card.querySelector('[data-cover]').addEventListener('click', () => openCover(l, afterMark));
        });
        body.querySelectorAll('[data-mark] [data-withdraw]').forEach(btn => {
            const m = (review.marks || []).find(x => x.id === btn.closest('[data-mark]').dataset.mark);
            btn.addEventListener('click', () => openWithdraw(m, afterMark));
        });
        body.querySelectorAll('[data-bill]').forEach(card => {
            card.querySelector('[data-tick]').addEventListener('click', () => openTick(bills[Number(card.dataset.bill)], again));
        });
        RA.icons();
    }

    // Project Control's Reports note (Q11) reads the same list: every approval
    // and reversal of a stock cost move with the months it changed. Owner accounts.
    function costChanges() { return RA.rpc('rec_bills'); }

    root.ReconciliationAdmin = Object.assign({}, pure, { render, costChanges });
})(typeof window !== 'undefined' ? window : globalThis);
