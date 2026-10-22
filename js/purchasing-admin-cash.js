// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → Cash (0102, WorkMate 2A-4a).
//
// OUTSIDE THE MONEY MODEL (CLAUDE.md): petty cash, a buyer's own money,
// refunds and supplier credit track who holds or is owed company money.
// Nothing here creates an expense or changes Spent, Earned or Profit.
//
//   The main owner (pur_cash_tracker answers):  every buyer's cash held,
//     returns to confirm, "I did not receive this" flags, own-money payments
//     to accept, Overpaid purchases, supplier credits, the daily report
//     (print and CSV), giving petty cash, cash counts, repayments and the
//     "May use own money" switch.
//   A buyer (the tracker refuses them):  My cash — their own balance,
//     returns, what the company owes them, "I did not receive this" and
//     Report a return.
// Cash held never reads below ₱0: the rest is an "Unreconciled shortfall"
// (Q16). A return lowers the balance when the owner confirms it (Q18).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;
    const ui = { report: null };
    const peso = (v) => esc(PA.peso(v));
    const newOp = () => root.DacsReceipts.newId();

    async function renderCash(body, me) {
        body.innerHTML = '<div class="att-empty">Loading…</div>';
        let t;
        try {
            t = await RA.rpc('pur_cash_tracker');
        } catch (e) {
            if (/OWNER_ONLY|NOT_ALLOWED/.test(String((e && (e.message || e.code)) || ''))) return renderMyCash(body, me);
            RA.fail(body, e);
            return;
        }
        return renderTracker(body, me, t);
    }
    PA.renderCash = renderCash;

    // ── The main owner ──────────────────────────────────────────────

    function daysAgo(day, today) {
        if (!day) return '';
        const n = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000);
        return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
    }

    async function renderTracker(body, me, t) {
        let overpaid = [], credits = [];
        try {
            [overpaid, credits] = await Promise.all([RA.rpc('pur_overpaid'), RA.rpc('pur_credits', { p_supplier: null })]);
        } catch (e) { RA.fail(body, e); return; }
        const buyers = t.buyers || [];
        // Accept / reject / resolve change Project Control's payment tags too (F4).
        const reload = () => { if (root.expPurReloadFlags) root.expPurReloadFlags(); renderCash(body, me); };
        const openCredits = (credits || []).filter(c => !c.voided_at);
        body.innerHTML =
            '<div class="att-info"><i data-lucide="wallet"></i><div>Petty cash, a buyer\'s own money, refunds and supplier credit say who holds or is owed company money. ' +
              '<strong>None of it changes Spent or Profit</strong> — a purchase counted once, when it was recorded.</div></div>' +
            '<div class="att-toolbar">' +
              '<button type="button" class="att-btn att-btn--primary" data-give>Give petty cash…</button>' +
              '<button type="button" class="att-btn" data-report>Daily report…</button>' +
            '</div>' +
            '<div data-report-host></div>' +
            '<div class="att-card"><div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table">' +
              '<thead><tr><th>Buyer</th><th>Cash held</th><th>Returns waiting</th><th>Company owes</th><th>May use own money</th><th>Last given</th><th>Last count</th><th></th></tr></thead><tbody>' +
              (buyers.length ? buyers.map(b => {
                  const f = PA.cashFigures(b);
                  const lc = b.last_count;
                  const diff = lc ? PA.round2(Number(lc.counted) - Number(lc.recorded)) : 0;
                  return '<tr>' +
                    '<td><strong>' + esc(b.name) + '</strong>' + (b.can_buy ? '' : '<div class="req-muted">Buyer switch off</div>') + '</td>' +
                    '<td><strong>' + peso(f.held) + '</strong>' + (f.shortfall > 0 ? '<div>' + PA.pill('Unreconciled shortfall ' + PA.peso(f.shortfall), 'abandoned') + '</div>' : '') +
                      (Number(b.open_disputes) > 0 ? '<div>' + PA.pill('Not-received flag', 'working') + '</div>' : '') + '</td>' +
                    '<td>' + (f.pending > 0 ? peso(f.pending) : '—') + '</td>' +
                    '<td>' + (f.owes > 0 ? peso(f.owes) : '—') + (f.toReview > 0 ? '<div>' + PA.pill(PA.peso(f.toReview) + ' to review', 'working') + '</div>' : '') + '</td>' +
                    '<td><label class="att-switch"><input type="checkbox" data-own="' + esc(b.buyer_id) + '"' + (b.own_money ? ' checked' : '') + '> ' +
                      (b.own_money ? 'Allowed' : 'Off') + '</label></td>' +
                    '<td>' + (b.last_given_on ? esc(b.last_given_on) + '<div class="req-muted">' + esc(daysAgo(b.last_given_on, t.today)) + '</div>' : '—') + '</td>' +
                    '<td>' + (lc ? esc(lc.counted_on) + ': ' + peso(lc.counted) + '<div class="req-muted">' +
                      (diff === 0 ? 'matched' : diff < 0 ? 'short ' + esc(PA.peso(-diff)) : 'over ' + esc(PA.peso(diff))) + '</div>' : '—') + '</td>' +
                    '<td><button type="button" class="att-btn att-btn--sm" data-buyer="' + esc(b.buyer_id) + '">Details…</button></td>' +
                  '</tr>';
              }).join('') : '<tr><td colspan="8" class="att-empty">No staff buyer yet. Turn a staff member\'s Buyer switch on in Users.</td></tr>') +
            '</tbody></table></div></div></div>' +
            '<div data-buyer-host></div>' +
            section('Returns waiting for you', 'The buyer says they handed this back. It lowers their cash held only when you confirm it, on the day you confirm.',
              (t.pending_returns || []).map(r => '<li><strong>' + esc(r.name) + '</strong> — ' + peso(r.amount) + ', handed over ' + esc(r.handed_on) +
                (r.handed_to ? ' to ' + esc(r.handed_to) : '') + (r.note ? ' — ' + esc(r.note) : '') +
                (r.photo_url ? ' <a class="att-link" href="#" data-photo="' + esc(r.photo_url) + '">photo</a>' : '') +
                ' <button type="button" class="att-btn att-btn--sm att-btn--primary" data-confirm="' + esc(r.id) + '">Confirm received</button>' +
                ' <button type="button" class="att-btn att-btn--sm" data-reject="' + esc(r.id) + '">Reject…</button></li>')) +
            section('"I did not receive this"', 'A buyer says petty cash you recorded never reached them. Their balance is unchanged until you settle it.',
              (t.disputes || []).map(i => '<li><strong>' + esc(i.name) + '</strong> — ' + peso(i.amount) + ' given ' + esc(i.issued_on) + ': "' + esc(i.dispute_note) + '"' +
                ' <button type="button" class="att-btn att-btn--sm" data-clear="' + esc(i.id) + '">It was handed over…</button>' +
                ' <button type="button" class="att-btn att-btn--sm att-btn--warn" data-void-issue="' + esc(i.id) + '">Void the entry…</button></li>')) +
            section('Own money to review', 'Paid with a buyer\'s own money while "May use own money" was off. Kept as a real payment. ' +
                'Accept it and the company owes it; reject it, with a reason, and it is never owed (R9).',
              (t.to_review || []).map(p => '<li><strong>' + esc(p.person_name) + '</strong> — ' + peso(p.amount) + ' on ' + esc(p.paid_on) +
                (p.note ? ' — ' + esc(p.note) : '') + ' <a class="att-link" href="#" data-open="' + esc(p.purchase_id) + '">purchase</a>' +
                ' <button type="button" class="att-btn att-btn--sm att-btn--primary" data-accept="' + esc(p.id) + '">Accept</button>' +
                ' <button type="button" class="att-btn att-btn--sm" data-reject-own="' + esc(p.id) + '">Reject…</button></li>')) +
            section('Overpaid', 'More was paid than the purchase now costs (or it was voided after it was paid). Refund it to the money that paid it, or keep it as supplier credit.',
              (overpaid || []).map(o => '<li><strong>' + esc(o.supplier || 'No supplier') + '</strong> · ' + esc(RA.formatDay(o.purchase_date)) + ' · ' +
                (PA.payPill ? PA.payPill(o.pay) : '') +
                (Number(o.pay && o.pay.over_resolved) > 0 ? ' ' + PA.pill('Refunded ' + PA.peso(o.pay.over_resolved) + ' more than is over — check', 'abandoned') : '') +
                ' <a class="att-link" href="#" data-open="' + esc(o.id) + '">open</a>' +
                (Number(o.pay && o.pay.unresolved) > 0 ? ' <button type="button" class="att-btn att-btn--sm att-btn--primary" data-resolve="' + esc(o.id) + '">Resolve…</button>' : '') +
                '</li>')) +
            section('Supplier credit', 'A balance with one supplier, used in parts when paying that supplier, until it is gone. Not cash.',
              openCredits.map(c => '<li><strong>' + esc(c.supplier || 'Supplier') + '</strong> — ' + peso(c.left) + ' left of ' + peso(c.amount) +
                (c.note ? ' — ' + esc(c.note) : '') + ' <a class="att-link" href="#" data-open="' + esc(c.purchase_id) + '">from this purchase</a>' +
                (Number(c.left) === Number(c.amount) ? ' <button type="button" class="att-btn att-btn--sm" data-void-credit="' + esc(c.id) + '">Void…</button>' : '') + '</li>'));

        body.querySelector('[data-give]').addEventListener('click', () => giveModal(buyers, reload));
        body.querySelector('[data-report]').addEventListener('click', () => reportPanel(body.querySelector('[data-report-host]'), buyers, t.today));
        if (ui.report) reportPanel(body.querySelector('[data-report-host]'), buyers, t.today, ui.report);
        body.querySelectorAll('[data-own]').forEach(el => el.addEventListener('change', async () => {
            try { await RA.rpc('pur_set_own_money', { p_buyer: el.dataset.own, p_on: el.checked }); } catch (e) { PA.notice(e); }
            reload();
        }));
        body.querySelectorAll('[data-buyer]').forEach(b => b.addEventListener('click', () =>
            buyerPanel(body.querySelector('[data-buyer-host]'), buyers.find(x => x.buyer_id === b.dataset.buyer), t.today, reload)));
        body.querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try { await RA.rpc('pur_cash_decide_return', { p_op: newOp(), p_return: b.dataset.confirm, p_confirm: true, p_note: null }); } catch (e) { PA.notice(e); }
            reload();
        }));
        body.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => noteModal('Reject this return?',
            'The buyer\'s cash held stays as it is. Say why — they see it.', 'Reject', 'pur_cash_decide_return',
            { p_return: b.dataset.reject, p_confirm: false }, 'p_note', reload)));
        body.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => noteModal('The cash was handed over',
            'The flag is cleared and the entry stays. If it was NOT handed over, void the entry instead.', 'Clear the flag', 'pur_cash_clear_dispute',
            { p_issue: b.dataset.clear }, 'p_note', reload)));
        body.querySelectorAll('[data-void-issue]').forEach(b => b.addEventListener('click', () =>
            PA.voidModal('Void this petty cash entry?', 'It leaves the buyer\'s balance and stays in the history, marked void.', 'pur_cash_void_issue', { p_issue: b.dataset.voidIssue }, reload)));
        body.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try { await RA.rpc('pur_accept_own_money', { p_op: newOp(), p_payment: b.dataset.accept }); } catch (e) { PA.notice(e); }
            reload();
        }));
        body.querySelectorAll('[data-reject-own]').forEach(b => b.addEventListener('click', () => noteModal('Reject this own-money claim?',
            'The payment stays (the supplier was paid), but the company will not owe it. The buyer sees your reason.', 'Reject',
            'pur_reject_own_money', { p_payment: b.dataset.rejectOwn }, 'p_reason', reload)));
        body.querySelectorAll('[data-resolve]').forEach(b => b.addEventListener('click', () =>
            PA.openResolve((overpaid || []).find(o => o.id === b.dataset.resolve), reload)));
        body.querySelectorAll('[data-void-credit]').forEach(b => b.addEventListener('click', () =>
            PA.voidModal('Void this supplier credit?', 'Only a credit nothing has used yet can be voided.', 'pur_void_credit', { p_credit: b.dataset.voidCredit }, reload)));
        body.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); PA.openPurchase(a.dataset.open); }));
        body.querySelectorAll('[data-photo]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); root.open(a.dataset.photo, '_blank'); }));
        RA.icons();
    }

    function section(title, help, items) {
        return '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">' + esc(title) + '</h3><p class="req-muted">' + esc(help) + '</p>' +
            (items.length ? '<ul class="pur-history">' + items.join('') + '</ul>' : '<p class="req-muted">Nothing here.</p>') + '</div></div>';
    }

    // A decision that needs a note (reject, clear a flag), sent once.
    function noteModal(title, sub, label, fn, args, noteArg, onDone) {
        const opId = newOp();
        RA.modal({
            title, sub, submitLabel: label,
            body: '<label class="att-label">Note<input class="att-input" name="note" maxlength="300" required></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                if (!form.note.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc(fn, Object.assign({ p_op: opId, [noteArg]: form.note.value.trim() }, args));
            },
            onDone,
        });
    }

    const buyerOptions = (buyers, sel) => buyers.filter(b => b.can_buy || b.buyer_id === sel)
        .map(b => '<option value="' + esc(b.buyer_id) + '"' + (b.buyer_id === sel ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('');

    function giveModal(buyers, onDone) {
        const opId = newOp();
        const today = PA.localDay();
        RA.modal({
            title: 'Give petty cash',
            sub: 'Company money you hand a buyer for purchases. It counts on their balance at once; they return what is left at the end of the buying run.',
            submitLabel: 'Record',
            body: '<label class="att-label">Buyer<select class="att-input" name="buyer" required>' + buyerOptions(buyers) + '</select></label>' +
                  '<div class="pur-rec-row">' +
                    '<label class="att-label">Amount (₱)<input class="att-input" name="amount" inputmode="decimal" required></label>' +
                    '<label class="att-label">Given on<input class="att-input" type="date" name="day" max="' + esc(today) + '" value="' + esc(today) + '" required></label>' +
                    '<label class="att-label">How<select class="att-input" name="method">' +
                      ['cash', 'gcash', 'bank_transfer', 'other'].map(m => '<option value="' + m + '">' + esc(PA.PAY_METHOD[m]) + '</option>').join('') + '</select></label>' +
                  '</div>' +
                  '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                if (!(PA.parseMoney(form.amount.value) > 0)) throw new Error('BAD_AMOUNT');
                await RA.rpc('pur_cash_give', { p_op: opId, p_buyer: form.buyer.value, p_amount: String(PA.round2(PA.parseMoney(form.amount.value))),
                                                p_on: form.day.value, p_method: form.method.value, p_note: form.note.value });
            },
            onDone,
        });
    }

    // One buyer's entries (90 days), with counts and repayments — voids live here.
    async function buyerPanel(host, b, today, reload) {
        host.innerHTML = '<div class="att-card"><div class="att-card-body"><div class="att-empty">Loading…</div></div></div>';
        let d;
        try { d = await RA.rpc('pur_cash_buyer', { p_buyer: b.buyer_id }); } catch (e) { RA.fail(host, e); return; }
        const f = PA.cashFigures(d);
        const voidBtn = (attr, id) => ' <button type="button" class="att-btn att-btn--sm" ' + attr + '="' + esc(id) + '">Void…</button>';
        host.innerHTML =
            '<div class="att-card"><div class="att-card-body">' +
              '<div class="pur-pay-head"><h3 class="pur-h3">' + esc(d.name) + '</h3><button type="button" class="att-btn att-btn--sm" data-close-buyer>Close</button></div>' +
              '<div class="pur-pay-figs"><span>Cash held <strong>' + peso(f.held) + '</strong></span>' +
                (f.shortfall > 0 ? '<span>Unreconciled shortfall <strong>' + peso(f.shortfall) + '</strong></span>' : '') +
                '<span>Company owes <strong>' + peso(f.owes) + '</strong></span>' +
                (f.toReview > 0 ? '<span>To review <strong>' + peso(f.toReview) + '</strong></span>' : '') + '</div>' +
              '<div class="pur-pay-actions">' +
                '<button type="button" class="att-btn" data-count>Count cash…</button>' +
                (f.owes > 0 ? '<button type="button" class="att-btn" data-repay>Repay own money…</button>' : '') +
              '</div>' +
              '<h4 class="pur-h4">Petty cash given (90 days)</h4><ul class="pur-history">' +
                ((d.issues || []).map(i => '<li' + (i.voided_at ? ' class="is-void"' : '') + '>' + esc(i.issued_on) + ' — ' + peso(i.amount) + ' ' +
                  esc(PA.PAY_METHOD[i.method] || i.method) + (i.note ? ' — ' + esc(i.note) : '') +
                  (i.disputed_at && !i.dispute_cleared_at ? ' ' + PA.pill('Not-received flag', 'working') : '') +
                  (i.voided_at ? ' — voided: ' + esc(i.void_reason) : voidBtn('data-void-issue', i.id)) + '</li>').join('') || '<li class="req-muted">None.</li>') + '</ul>' +
              '<h4 class="pur-h4">Returns (90 days)</h4><ul class="pur-history">' +
                ((d.returns || []).map(r => '<li' + (r.voided_at ? ' class="is-void"' : '') + '>' + esc(r.handed_on) + ' — ' + peso(r.amount) + ' — ' +
                  esc({ reported: 'waiting for you', withdrawn: 'withdrawn by the buyer', confirmed: 'confirmed', rejected: 'rejected' }[r.status] || r.status) +
                  (r.decision_note ? ': ' + esc(r.decision_note) : '') + (r.voided_at ? ' — voided' : r.status === 'confirmed' ? voidBtn('data-void-return', r.id) : '') + '</li>').join('') ||
                  '<li class="req-muted">None.</li>') + '</ul>' +
              '<h4 class="pur-h4">Cash counts</h4><ul class="pur-history">' +
                ((d.counts || []).map(k => '<li' + (k.voided_at ? ' class="is-void"' : '') + '>' + esc(k.counted_on) + ' — counted ' + peso(k.counted) +
                  ', recorded ' + peso(Math.max(0, Number(k.recorded))) + (k.note ? ' — ' + esc(k.note) : '') +
                  (k.voided_at ? ' — voided' : voidBtn('data-void-count', k.id)) + '</li>').join('') || '<li class="req-muted">None.</li>') + '</ul>' +
              '<h4 class="pur-h4">Repayments of own money</h4><ul class="pur-history">' +
                ((d.repayments || []).map(x => '<li' + (x.voided_at ? ' class="is-void"' : '') + '>' + esc(x.paid_on) + ' — ' + peso(x.amount) + ' ' +
                  esc(PA.PAY_METHOD[x.method] || x.method) + (x.voided_at ? ' — voided' : voidBtn('data-void-repay', x.id)) + '</li>').join('') ||
                  '<li class="req-muted">None.</li>') + '</ul>' +
            '</div></div>';
        const again = () => { reload(); };
        host.querySelector('[data-close-buyer]').addEventListener('click', () => { host.innerHTML = ''; });
        host.querySelector('[data-count]').addEventListener('click', () => countModal(b, again));
        const rp = host.querySelector('[data-repay]');
        if (rp) rp.addEventListener('click', () => repayModal(b, f.owes, again));
        host.querySelectorAll('[data-void-issue]').forEach(x => x.addEventListener('click', () =>
            PA.voidModal('Void this petty cash entry?', 'It leaves the buyer\'s balance and stays in the history, marked void.', 'pur_cash_void_issue', { p_issue: x.dataset.voidIssue }, again)));
        host.querySelectorAll('[data-void-return]').forEach(x => x.addEventListener('click', () =>
            PA.voidModal('Void this confirmed return?', 'The amount goes back on the buyer\'s balance.', 'pur_cash_void_return', { p_return: x.dataset.voidReturn }, again)));
        host.querySelectorAll('[data-void-count]').forEach(x => x.addEventListener('click', () =>
            PA.voidModal('Void this cash count?', 'A count is a record only; voiding it changes no balance.', 'pur_cash_void_count', { p_count: x.dataset.voidCount }, again)));
        host.querySelectorAll('[data-void-repay]').forEach(x => x.addEventListener('click', () =>
            PA.voidModal('Void this repayment?', 'The company owes the buyer that amount again.', 'pur_void_repayment', { p_repayment: x.dataset.voidRepay }, again)));
        host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function countModal(b, onDone) {
        const opId = newOp();
        const today = PA.localDay();
        RA.modal({
            title: 'Count cash — ' + b.name,
            sub: 'What you counted, shown against the balance recorded that day. A record only: it changes no balance.',
            submitLabel: 'Record count',
            body: '<div class="pur-rec-row"><label class="att-label">Counted (₱)<input class="att-input" name="amount" inputmode="decimal" required></label>' +
                  '<label class="att-label">On<input class="att-input" type="date" name="day" max="' + esc(today) + '" value="' + esc(today) + '"></label></div>' +
                  '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                if (PA.parseMoney(form.amount.value) == null) throw new Error('BAD_AMOUNT');
                await RA.rpc('pur_cash_count', { p_op: opId, p_buyer: b.buyer_id, p_on: form.day.value,
                                                 p_counted: String(PA.round2(PA.parseMoney(form.amount.value))), p_note: form.note.value });
            },
            onDone,
        });
    }

    function repayModal(b, owes, onDone) {
        const opId = newOp();
        const today = PA.localDay();
        RA.modal({
            title: 'Repay ' + b.name,
            sub: 'The company owes ' + PA.peso(owes) + ' for their own money. A repayment is not an expense and not petty cash.',
            submitLabel: 'Record repayment',
            body: '<div class="pur-rec-row"><label class="att-label">Amount (₱)<input class="att-input" name="amount" inputmode="decimal" value="' + esc(String(owes)) + '" required></label>' +
                  '<label class="att-label">Paid on<input class="att-input" type="date" name="day" max="' + esc(today) + '" value="' + esc(today) + '"></label>' +
                  '<label class="att-label">How<select class="att-input" name="method">' +
                    Object.keys(PA.PAY_METHOD).map(m => '<option value="' + m + '">' + esc(PA.PAY_METHOD[m]) + '</option>').join('') + '</select></label></div>' +
                  '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                const a = PA.parseMoney(form.amount.value);
                if (!(a > 0)) throw new Error('BAD_AMOUNT');
                if (a > Number(owes)) throw new Error('OVER_OWED');
                await RA.rpc('pur_repay_buyer', { p_op: opId, p_buyer: b.buyer_id, p_amount: String(PA.round2(a)), p_on: form.day.value,
                                                  p_method: form.method.value, p_note: form.note.value });
            },
            onDone,
        });
    }

    // The daily report (Q18, Q20): one buyer, Philippine days, print and CSV.
    async function reportPanel(host, buyers, today, keep) {
        const st = keep || { buyer: (buyers.find(b => b.can_buy) || buyers[0] || {}).buyer_id || '', from: today.slice(0, 8) + '01', to: today };
        ui.report = st;
        host.innerHTML =
            '<div class="att-card"><div class="att-card-body">' +
              '<div class="pur-pay-head"><h3 class="pur-h3">Daily report</h3><button type="button" class="att-btn att-btn--sm" data-close-report>Close</button></div>' +
              '<div class="att-toolbar">' +
                '<label class="att-label">Buyer<select class="att-input" data-r="buyer">' + buyerOptions(buyers.concat([]), st.buyer) +
                  buyers.filter(b => !b.can_buy && b.buyer_id !== st.buyer).map(b => '<option value="' + esc(b.buyer_id) + '">' + esc(b.name) + '</option>').join('') + '</select></label>' +
                '<label class="att-label">From<input class="att-input" type="date" data-r="from" value="' + esc(st.from) + '"></label>' +
                '<label class="att-label">To<input class="att-input" type="date" data-r="to" value="' + esc(st.to) + '"></label>' +
                '<button type="button" class="att-btn" data-print disabled>Print</button>' +
                '<button type="button" class="att-btn" data-csv disabled>CSV</button>' +
              '</div><div data-r-body><div class="att-empty">Loading…</div></div>' +
            '</div></div>';
        host.querySelector('[data-close-report]').addEventListener('click', () => { ui.report = null; host.innerHTML = ''; });
        host.querySelectorAll('[data-r]').forEach(el => el.addEventListener('change', () => { st[el.dataset.r] = el.value; reportPanel(host, buyers, today, st); }));
        if (!st.buyer) { host.querySelector('[data-r-body]').innerHTML = '<div class="att-empty">No buyer.</div>'; return; }
        let rep;
        try { rep = await RA.rpc('pur_cash_report', { p_buyer: st.buyer, p_from: st.from, p_to: st.to }); }
        catch (e) { host.querySelector('[data-r-body]').innerHTML = '<div class="att-info att-info--warn"><div>' + esc(PA.errorMessage(e)) + '</div></div>'; return; }
        const table = reportTable(rep);
        host.querySelector('[data-r-body]').innerHTML = table +
            ((rep.pending_returns || []).length ? '<p class="req-muted">Returns waiting for your confirmation (not in the balance yet): ' +
               rep.pending_returns.map(r => esc(PA.peso(r.amount) + ' handed over ' + r.handed_on)).join(', ') + '</p>' : '') +
            '<p class="req-muted">A voided entry stays on its own day, marked; the void is a row on the day it was made, so a past day\'s closing never changes.</p>';
        const print = host.querySelector('[data-print]'), csv = host.querySelector('[data-csv]');
        print.disabled = false; csv.disabled = false;
        print.addEventListener('click', () => {
            const w = root.open('', '_blank');
            if (!w) return PA.notice('Allow pop-ups for this site to print.');
            w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Petty cash — ' + esc(rep.name) + '</title>' +
                '<style>body{font:13px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}' +
                'td.n{text-align:right}tr.k td{font-weight:600;background:#f6f6f6}</style></head><body>' +
                '<h2>Petty cash — ' + esc(rep.name) + '</h2><p>' + esc(rep.from + ' to ' + rep.to) +
                '. Petty cash is outside Spent and Profit. Returns count on the day the owner confirmed them.</p>' + table + '</body></html>');
            w.document.close();
            w.focus();
            w.print();
        });
        csv.addEventListener('click', () => {
            const blob = new Blob([PA.reportCsv(rep)], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'petty-cash-' + String(rep.name || 'buyer').replace(/[^A-Za-z0-9]+/g, '-') + '-' + rep.from + '-to-' + rep.to + '.csv';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        });
    }

    function reportTable(rep) {
        const rows = PA.reportRows(rep);
        if (!rows.length) return '<div class="att-empty">Nothing in these days. Opening and closing: ' + esc(PA.peso(Math.max(0, Number(rep.opening)))) + '.</div>';
        const money = (v) => v === '' || v == null ? '' : esc(PA.peso(v));
        return '<div class="req-table-wrap"><table class="att-table req-table"><thead><tr><th>Day</th><th>Entry</th><th>Detail</th><th>In</th><th>Out</th><th>Cash held</th></tr></thead><tbody>' +
            rows.map(r => '<tr' + (r.held != null ? ' class="k"' : '') + '><td>' + esc(r.day) + '</td><td>' + esc(r.what) + '</td><td>' + esc(r.detail) + '</td>' +
              '<td class="n">' + money(r.amountIn) + '</td><td class="n">' + money(r.amountOut) + '</td><td class="n">' +
              (r.held == null ? '' : money(r.held) + (r.shortfall > 0 ? ' <span class="att-pill att-pill--abandoned">shortfall ' + esc(PA.peso(r.shortfall)) + '</span>' : '')) +
              '</td></tr>').join('') + '</tbody></table></div>';
    }

    // ── A buyer: My cash ─────────────────────────────────────────────

    async function renderMyCash(body, me) {
        let d;
        try { d = await RA.rpc('pur_my_cash'); } catch (e) { RA.fail(body, e); return; }
        const reload = () => renderCash(body, me);
        if (!d.holder) {
            body.innerHTML = '<div class="att-empty">Petty cash is held by staff buyers. Nothing to show for this account.</div>';
            return;
        }
        const f = PA.cashFigures(d);
        body.innerHTML =
            '<div class="att-info"><i data-lucide="wallet"></i><div>Company money you hold for purchases, and what the company owes you for your own money. ' +
              'None of it changes a project\'s costs.</div></div>' +
            '<div class="pur-pay-figs pur-cash-cards">' +
              '<span>Cash held <strong>' + peso(f.held) + '</strong></span>' +
              (f.shortfall > 0 ? '<span>Unreconciled shortfall <strong>' + peso(f.shortfall) + '</strong><small>You paid more than the petty cash on record — the owner will check it.</small></span>' : '') +
              (f.pending > 0 ? '<span>Return waiting <strong>' + peso(f.pending) + '</strong><small>Counts once the owner confirms it.</small></span>' : '') +
              '<span>Company owes you <strong>' + peso(f.owes) + '</strong>' + (f.toReview > 0 ? '<small>' + peso(f.toReview) + ' waiting for the owner\'s OK.</small>' : '') + '</span>' +
            '</div>' +
            '<div class="att-toolbar"><button type="button" class="att-btn att-btn--primary" data-return>Report a return…</button>' +
              '<span class="req-muted">' + (d.own_money ? 'You may use your own money when petty cash runs short.' : 'Ask the owner before using your own money.') + '</span></div>' +
            section('Petty cash you were given (90 days)', 'If an entry never reached you, say so — the owner checks it.',
              (d.issues || []).map(i => '<li' + (i.voided_at ? ' class="is-void"' : '') + '>' + esc(i.issued_on) + ' — ' + peso(i.amount) + ' ' +
                esc(PA.PAY_METHOD[i.method] || i.method) + (i.note ? ' — ' + esc(i.note) : '') +
                (i.voided_at ? ' — voided: ' + esc(i.void_reason) :
                  i.disputed_at && !i.dispute_cleared_at ? ' ' + PA.pill('You said not received', 'working') :
                  ' <button type="button" class="att-btn att-btn--sm" data-dispute="' + esc(i.id) + '">I did not receive this…</button>') +
                (i.dispute_cleared_at ? ' <span class="req-muted">Owner: ' + esc(i.dispute_cleared_note || '') + '</span>' : '') + '</li>')) +
            section('Returns', 'Reported returns wait for the owner.',
              (d.returns || []).map(r => '<li>' + esc(r.handed_on) + ' — ' + peso(r.amount) + ' — ' +
                esc({ reported: 'waiting for the owner', withdrawn: 'withdrawn', confirmed: 'confirmed', rejected: 'rejected' }[r.status] || r.status) +
                (r.decision_note ? ': ' + esc(r.decision_note) : '') + (r.voided_at ? ' — voided by the owner' : '') +
                (r.status === 'reported' ? ' <button type="button" class="att-btn att-btn--sm" data-withdraw="' + esc(r.id) + '">Withdraw</button>' : '') + '</li>')) +
            section('Repaid to you (90 days)', 'What the company paid back for your own money.',
              (d.repayments || []).map(x => '<li' + (x.voided_at ? ' class="is-void"' : '') + '>' + esc(x.paid_on) + ' — ' + peso(x.amount) +
                (x.voided_at ? ' — voided' : '') + '</li>'));
        body.querySelector('[data-return]').addEventListener('click', () => returnModal(f.held, reload));
        body.querySelectorAll('[data-dispute]').forEach(b => b.addEventListener('click', () => noteModal('I did not receive this',
            'The owner sees your note. Your balance does not change until they settle it.', 'Send', 'pur_cash_dispute', { p_issue: b.dataset.dispute }, 'p_note', reload)));
        body.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
            b.disabled = true;
            try { await RA.rpc('pur_cash_withdraw_return', { p_op: newOp(), p_return: b.dataset.withdraw }); } catch (e) { PA.notice(e); }
            reload();
        }));
        RA.icons();
    }

    function returnModal(held, onDone) {
        const opId = newOp();
        const today = PA.localDay();
        RA.modal({
            title: 'Report a return',
            sub: 'Unused petty cash you handed back. It shows as "waiting" until the owner confirms it.',
            submitLabel: 'Report',
            body: '<div class="pur-rec-row"><label class="att-label">Amount (₱)<input class="att-input" name="amount" inputmode="decimal" value="' + (held > 0 ? esc(String(held)) : '') + '" required></label>' +
                  '<label class="att-label">Handed over on<input class="att-input" type="date" name="day" max="' + esc(today) + '" value="' + esc(today) + '"></label></div>' +
                  '<label class="att-label">To whom (optional)<input class="att-input" name="to" maxlength="120"></label>' +
                  '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>' +
                  '<label class="att-label">Photo (optional)<input class="att-input" type="file" name="photo" accept="image/*"></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                const a = PA.parseMoney(form.amount.value);
                if (!(a > 0)) throw new Error('BAD_AMOUNT');
                let photo = '';
                const file = form.photo.files && form.photo.files[0];
                // R13: its own private folder — the owner and this buyer only.
                if (file) photo = await root.DacsReceipts.uploadReceipt('petty_cash', await root.DacsReceipts.compressToBlob(file), root.currentDataUserId);
                await RA.rpc('pur_cash_report_return', { p_op: opId, p_amount: String(PA.round2(a)), p_handed_on: form.day.value,
                                                         p_handed_to: form.to.value, p_photo_url: photo, p_note: form.note.value });
            },
            onDone,
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
