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
    const when = (ts) => ts ? RA.formatManila(ts) : '';

    // ── Waiting (Q5) ────────────────────────────────────────────────
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
    // Office v5: every section is a group of cards, each opening in the
    // pop-up — Waiting, Where every purchase peso is, Waiting for a billing
    // period (and the "Cover is right" marks), Money still out, Bills to check.
    const rui = { sel: null };
    async function render(host, me, opts) {
        const SV = root.SplitView;
        if (!ui.from) Object.assign(ui, monthRange());
        let places, waiting, review, bills, money;
        try {
            [places, waiting, review, bills, money] = await Promise.all([
                RA.rpc('rec_purchase_places', { p_from: ui.from, p_to: ui.to }), RA.rpc('rec_waiting'), RA.rpc('rec_review_lines'),
                RA.rpc('rec_bills'), RA.rpc('rec_money_out')]);
        } catch (e) {
            host.innerHTML = '<div class="sv"><div class="sv-empty">' + esc(errorMessage(e)) + '</div></div>';
            return;
        }
        if (PA.ui.tab !== 'reconcile') return;   // another tab was chosen while this loaded
        bills = bills || [];
        review = review || {};
        money = money || {};
        const again = () => render(host, me, { refreshPanel: true });
        const afterMark = () => { if (root.expPurReloadFlags) root.expPurReloadFlags(); render(host, me, { refreshPanel: true }); };
        const items = waitingItems(waiting);
        const total = items.reduce((n, it) => n + it.count, 0);
        const t = places.totals || {};
        const ok = !Number(t.with_difference);
        const wait = review.waiting || [];
        const marks = review.marks || [];
        const owed = money.owed || [];
        const owedTotal = owed.reduce((n, x) => n + Number(x.balance || 0), 0);
        const lineKey = l => 'w:' + l.purchase_id + ':' + l.line_no;

        const groups = [
            { title: 'Waiting', tone: total ? 'gold' : 'muted', meta: esc('What needs someone, and where it is decided.'),
              rows: [{ id: 'waiting', title: total ? total + ' waiting' : 'Nothing is waiting.',
                       sub: items.map(it => it.label).slice(0, 3).join(' · ') + (items.length > 3 ? ' · …' : ''),
                       pill: total ? { text: items.length + (items.length === 1 ? ' kind' : ' kinds'), tone: 'gold' } : { text: 'Clear', tone: 'done' } }] },
            { title: 'Where every purchase peso is', tone: 'ink',
              meta: esc('For the purchases made in these days, where their pesos sit today. The two sides come from different records, so they must agree.') +
                    ' <span class="req-muted">' + esc(RA.formatDay(ui.from) + ' – ' + RA.formatDay(ui.to)) + '</span>',
              rows: [{ id: 'places', title: peso(t.recorded) + ' recorded',
                       sub: 'In own projects ' + peso(t.own) + ' · other projects ' + peso(t.other) + ' · company stock ' + peso(t.company) + ' · company stock loss ' + peso(t.loss),
                       meta: (t.purchases || 0) + ' purchase' + (Number(t.purchases) === 1 ? '' : 's'),
                       pill: ok ? { text: 'Adds up ✓', tone: 'done' } : { text: 'Difference', tone: 'red' } }] },
            { title: 'Waiting for a billing period', tone: wait.length ? 'gold' : 'muted',
              meta: esc('Charged to Cover because the purchase month had no billing period. Add the period and save the row again, or mark it "Cover is right".'),
              empty: 'No line is waiting for a billing period.',
              rows: wait.map(l => ({ id: lineKey(l), title: l.item + ' · ' + l.project,
                  sub: 'Ref ' + l.ref + ' · bought ' + RA.formatDay(l.purchase_date) + ' · waiting ' + l.days + ' day' + (Number(l.days) === 1 ? '' : 's') +
                       ' · on ' + (l.rows || []).map(x => x.period + (x.cover ? ' (Cover)' : '') + ' ' + peso(x.amount)).join(', '),
                  right: peso(l.amount), pill: { text: 'Office review', tone: 'gold' }, nextLabel: 'Cover is right…' }))
                .concat(marks.length ? [{ id: 'marks', title: '"Cover is right" marks', sub: marks.length + ' mark' + (marks.length === 1 ? '' : 's'),
                    pill: { text: marks.filter(m => m.current && !m.withdrawn_at).length + ' apply', tone: 'done' } }] : []) },
            { title: 'Money still out', tone: owed.length ? 'gold' : 'muted', meta: esc('Payments never change Spent.'),
              rows: [{ id: 'money', title: owed.length ? 'Still owed ' + peso(owedTotal) : 'Nothing Unpaid or Partly paid.',
                       sub: owed.reduce((n, x) => n + Number(x.purchases || 0), 0) + ' purchase(s) · ' + owed.reduce((n, x) => n + Number(x.partly_paid || 0), 0) + ' partly paid',
                       right: owed.length ? peso(owedTotal) : '', pill: owed.length ? { text: 'Owed', tone: 'gold' } : { text: 'Clear', tone: 'done' } }] },
            { title: 'Bills to check', tone: bills.some(b => !b.checked) ? 'gold' : 'muted',
              meta: esc('Each approved or reversed stock cost move changed these months. Client bills are never changed automatically: decide by hand, then tick.'),
              empty: 'No stock cost move has changed a project\'s months yet.',
              rows: bills.map((b, i) => ({ id: 'bill:' + i, title: 'Stock cost move · ' + b.item + ' · ' + b.from + ' → ' + b.to,
                  sub: (b.change === 'reversed' ? 'Reversed' : 'Approved') + ' ' + when(b.at) + ' · ' + peso(b.value),
                  meta: (b.sides || []).map(sideText).join(' · '),
                  pill: b.checked ? { text: 'Bill checked', tone: 'done' } : { text: 'To check', tone: 'gold' },
                  dim: !!b.checked, nextLabel: b.checked ? '' : 'Bill checked…' })) },
        ];
        const toolbar =
            '<label class="att-label">From<input class="att-input" type="date" data-from value="' + esc(ui.from) + '"></label>' +
            '<label class="att-label">To<input class="att-input" type="date" data-to value="' + esc(ui.to) + '"></label>' +
            '<button type="button" class="att-btn" data-show>Show</button>' +
            '<button type="button" class="att-btn" data-print>Print</button>' +
            '<button type="button" class="att-btn" data-csv>CSV</button>';

        function wire(panel, handlers) {
            panel.onclick = e => {
                const tr = e.target.closest('[data-open-purchase]');
                if (tr) { PA.openPurchase(tr.dataset.openPurchase); return; }
                const b = e.target.closest('button');
                if (!b || b.disabled) return;
                for (const [attr, fn] of handlers) if (b.hasAttribute(attr)) { fn(b); return; }
            };
        }
        function goTo(target) {
            // In this tab: open the first card of that section.
            if (target.anchor === 'rec-review') { if (wait.length) SV.open('reqPurchasing', lineKey(wait[0])); return; }
            if (target.anchor === 'rec-bills') { const i = bills.findIndex(b => !b.checked); if (i >= 0) SV.open('reqPurchasing', 'bill:' + i); return; }
            SV.closePop();
            if (target.tab) { PA.ui.tab = target.tab; root.switchView('reqPurchasing'); return; }
            if (target.view) root.switchView(target.view);
        }

        const panels = {
            waiting: panel => {
                SV.fill(panel, SV.panelHtml({
                    kicker: 'Reconciliation · Waiting', title: 'What needs someone, and where it is decided',
                    sections: [SV.section('Waiting', SV.lines(items.map((it, i) => ({ t: it.label, acts: SV.lbtn('Go →', 'data-go="' + i + '"') })), 'Nothing is waiting.'))],
                    nextLabel: 'Next',
                }));
                wire(panel, [['data-go', b => goTo(items[Number(b.dataset.go)].go)]]);
            },
            places: panel => {
                const body = SV.page(panel, { kicker: 'Reconciliation', title: 'Where every purchase peso is', wide: true,
                    sub: RA.formatDay(ui.from) + ' – ' + RA.formatDay(ui.to),
                    pills: [ok ? { text: 'Adds up ✓', tone: 'done' } : { text: 'Difference', tone: 'red' }],
                    actions: SV.lbtn('Print', 'data-print') + SV.lbtn('CSV', 'data-csv'), nextLabel: 'Next' });
                body.innerHTML = '<div class="sv-page-secs">' +
                    SV.notice(ok ? 'green' : 'red', ok ? 'check-circle' : 'alert-triangle', addsUpText(t),
                        esc(t.purchases + ' purchase' + (Number(t.purchases) === 1 ? '' : 's') + ', ' + peso(t.recorded) +
                        ': ' + peso(t.own) + ' in their own projects, ' + peso(t.other) + ' in other projects, ' + peso(t.company) + ' company stock, ' +
                        peso(t.loss) + ' company stock loss.')) +
                    ((places.purchases || []).length
                        ? SV.table(['Date', 'Ref', 'What · where', 'Recorded', 'Own project', 'Other projects', 'Company stock', 'Stock loss', 'Difference'],
                            places.purchases.map(p => [esc(RA.formatDay(p.purchase_date)), '<code>' + esc(p.ref) + '</code>',
                                esc(p.what) + '<div class="req-muted">' + esc(p.projects) + (p.supplier ? ' · ' + esc(p.supplier) : '') + '</div>',
                                esc(peso(p.recorded)), esc(peso(p.own)), esc(peso(p.other)), esc(peso(p.company)), esc(peso(p.loss)),
                                '<strong>' + esc(Number(p.difference) ? peso(p.difference) : '✓') + '</strong>']),
                            { num: [3, 4, 5, 6, 7, 8], rowAttrs: i => 'data-open-purchase="' + esc(places.purchases[i].id) + '"' +
                                (Number(places.purchases[i].difference) ? ' style="background:#fff4f2"' : '') })
                        : '<div class="sv-empty-inline">No purchases in these days.</div>') +
                    ((places.voided || []).length
                        ? SV.note('Voided in these days (counted nowhere): ' + places.voided.map(v => esc(v.ref + ' ' + RA.formatDay(v.purchase_date) + ' ' +
                            peso(v.recorded) + (v.reason ? ' — ' + v.reason : ''))).join(' · ')) : '') +
                    '</div>';
                wire(panel, [['data-print', () => printPlaces(places)], ['data-csv', () => downloadCsv(places)]]);
            },
            marks: panel => {
                SV.fill(panel, SV.panelHtml({
                    kicker: 'Waiting for a billing period', title: '"Cover is right" marks',
                    sections: [SV.section('', SV.lines(marks.map(m => ({
                        t: m.item + ' · ' + m.project + ' · ' + peso(m.amount),
                        s: '(ref ' + m.ref + ', bought ' + RA.formatDay(m.purchase_date) + ') — "' + m.reason + '" · ' + m.marked_by + ', ' + when(m.marked_at) +
                           (m.withdrawn_at ? ' · ' + m.withdrawn_by + ', ' + when(m.withdrawn_at) + ': ' + m.withdraw_reason : ''),
                        pills: [m.withdrawn_at ? { text: 'Withdrawn', tone: 'red' } : m.current ? { text: 'Applies', tone: 'done' }
                                               : { text: 'No longer applies (the line changed)', tone: 'red' }],
                        acts: !m.withdrawn_at && m.current ? SV.lbtn('Withdraw…', 'data-withdraw="' + esc(m.id) + '"') : '',
                    }))))],
                    nextLabel: 'Next',
                }));
                wire(panel, [['data-withdraw', b => { const m = marks.find(x => x.id === b.dataset.withdraw); if (m) openWithdraw(m, afterMark); }]]);
            },
            money: panel => {
                const nt = money.not_tracked || {};
                SV.fill(panel, SV.panelHtml({
                    kicker: 'Reconciliation', title: 'Money still out',
                    sections: [
                        SV.section('Purchases', owed.length
                            ? SV.table(['Supplier', 'Purchases', 'Still owed'], owed.map(x => [esc(x.supplier),
                                esc(x.purchases) + (Number(x.partly_paid) ? ' <span class="req-muted">(' + esc(x.partly_paid) + ' partly paid)</span>' : ''),
                                '<strong>' + esc(peso(x.balance)) + '</strong>']).concat([['<strong>Total</strong>', '', '<strong>' + esc(peso(owedTotal)) + '</strong>']]),
                                { num: [1, 2] })
                            : '<div class="sv-empty-inline">Nothing Unpaid or Partly paid.</div>'),
                        (Number(nt.purchases) ? SV.note(esc(nt.purchases + ' purchase' + (Number(nt.purchases) === 1 ? '' : 's') + ' (' + peso(nt.total) +
                            ') recorded before payments were tracked — never counted as owed.')) : ''),
                        SV.section('Credit and overpaid', SV.facts([
                            ['Credit', (money.credits || []).length ? '<strong>Supplier credit left:</strong> ' + money.credits.map(c => esc(c.supplier + ' ' + peso(c.left))).join(' · ') : ''],
                            ['Overpaid', money.overpaid && Number(money.overpaid.purchases) ? esc(money.overpaid.purchases + ' purchase' +
                                (Number(money.overpaid.purchases) === 1 ? '' : 's') + ', ' + peso(money.overpaid.amount) + ' to refund or keep as credit') + ' (Cash tab).' : ''],
                        ])),
                        SV.section('Buyers', SV.lines((money.buyers || []).map(b => ({ t: b.name, s: b.name + ' — holds ' + peso(b.cash_held) +
                            (Number(b.shortfall) ? ', shortfall ' + peso(b.shortfall) : '') + (Number(b.owed_to_buyer) ? ', company owes ' + peso(b.owed_to_buyer) : '') +
                            (Number(b.own_money_to_review) ? ', ' + peso(b.own_money_to_review) + ' own money to review' : ''), facts: [
                            ['Holds', esc(peso(b.cash_held))], ['Shortfall', Number(b.shortfall) ? esc(peso(b.shortfall)) : ''],
                            ['Company owes', Number(b.owed_to_buyer) ? esc(peso(b.owed_to_buyer)) : ''],
                            ['Own money to review', Number(b.own_money_to_review) ? esc(peso(b.own_money_to_review)) : ''],
                        ] })), 'None.')),
                        SV.note(esc('Payments never change Spent. Paying, refunds and credits are recorded on each purchase and in the Cash tab.')),
                    ],
                    nextLabel: 'Next',
                }));
                wire(panel, []);
            },
        };
        function reviewPanel(panel, l, o) {
            SV.fill(panel, SV.panelHtml({
                kicker: 'Waiting for a billing period', title: l.item, pills: [{ text: 'Office review', tone: 'gold' }],
                sub: l.project + ' · ' + peso(l.amount) + ' · Ref ' + l.ref,
                step: SV.nextStep('Charged to Cover because the purchase month had no billing period. Add the period and save the row again, or mark it "Cover is right".',
                    '<button type="button" class="att-btn att-btn--primary" data-cover>Cover is right…</button>'),
                sections: [
                    (l.period_now ? SV.notice('grey', 'info', 'Already possible', 'A billing period for that month exists now. To charge it there, open the row in ' +
                        'Project Control and save it again.') : ''),
                    SV.section('Line', SV.facts([['Bought', esc(RA.formatDay(l.purchase_date))], ['Waiting', esc(l.days + ' day' + (Number(l.days) === 1 ? '' : 's'))],
                        ['On', (l.rows || []).map(x => esc(x.period + (x.cover ? ' (Cover)' : '') + ' ' + peso(x.amount))).join(', ')]])),
                ],
                actions: SV.lbtn('Open purchase', 'data-open-purchase="' + esc(l.purchase_id) + '"'),
                nextLabel: 'Next',
            }));
            wire(panel, [['data-cover', () => openCover(l, afterMark)]]);
            if (o && o.start) { const go = panel.querySelector('[data-cover]'); if (go) go.click(); }
        }
        function billPanel(panel, b, o) {
            SV.fill(panel, SV.panelHtml({
                kicker: 'Bills to check', title: 'Stock cost move · ' + b.item,
                pills: [b.checked ? { text: 'Bill checked', tone: 'done' } : { text: 'To check', tone: 'gold' }],
                sub: (b.change === 'reversed' ? 'Reversed' : 'Approved') + ' ' + when(b.at),
                step: b.checked ? '' : SV.nextStep('Each approved or reversed stock cost move changed these months. Client bills are never changed automatically: decide by hand, then tick.',
                    '<button type="button" class="att-btn att-btn--primary" data-tick>Bill checked…</button>'),
                sections: [
                    SV.section('Cost move', SV.facts([['State', b.change === 'reversed' ? 'Reversed' : 'Approved'],
                        ['What', esc(b.item + ' ' + (b.quantity || '') + ' ' + (b.unit || '') + ': ' + b.from + ' → ' + b.to)], ['Value', esc(peso(b.value))],
                        ['Note', b.checked && b.note ? '"' + esc(b.note) + '" — ' + esc(b.checked_by + ', ' + when(b.checked_at)) : '']])),
                    SV.section('Months changed', SV.lines((b.sides || []).map(x => ({ t: sideText(x) })), 'None.')),
                ],
                actions: b.checked ? SV.lbtn('Un-tick…', 'data-tick') : '',
                nextLabel: 'Next',
            }));
            wire(panel, [['data-tick', () => openTick(b, again)]]);
            if (o && o.start) { const go = panel.querySelector('.sv-step [data-tick]'); if (go) go.click(); }
        }

        root.SplitView.render(host, PA.frame(host, me, {
            lede: 'Checks, not a ledger: nothing here moves a peso or changes a bill. Owner accounts only.',
            search: false,
            toolbar: toolbar,
            onToolbar: el => {
                el.querySelector('[data-show]').addEventListener('click', () => {
                    ui.from = el.querySelector('[data-from]').value; ui.to = el.querySelector('[data-to]').value;
                    again();
                });
                el.querySelector('[data-print]').addEventListener('click', () => printPlaces(places));
                el.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(places));
            },
            groups: groups,
            selectedId: rui.sel,
            refreshPanel: !!(opts && opts.refreshPanel),
            onSelect: (id, panel, o) => {
                rui.sel = id;
                if (panels[id]) return panels[id](panel);
                if (id.indexOf('w:') === 0) {
                    const l = wait.find(x => lineKey(x) === id);
                    return l ? reviewPanel(panel, l, o) : SV.error(panel, ERRORS.NOT_WAITING);
                }
                if (id.indexOf('bill:') === 0) {
                    const b = bills[Number(id.slice(5))];
                    return b ? billPanel(panel, b, o) : SV.error(panel, ERRORS.NOT_FOUND);
                }
            },
            onClose: () => { rui.sel = null; },
        }));
    }

    function costChanges() { return RA.rpc('rec_bills'); }

    root.ReconciliationAdmin = Object.assign({}, pure, { render, costChanges });
})(typeof window !== 'undefined' ? window : globalThis);