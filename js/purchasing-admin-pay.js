// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → a purchase's payments (0102, WorkMate 2A-4a).
//
// Payments say how a purchase was paid: a deposit, the rest, from petty
// cash, the buyer's own money, the company directly or a supplier credit.
// They NEVER change Spent, Earned or Profit — the purchase did that once,
// when it was recorded (CLAUDE.md). This file only shows the server's
// answer (pur_purchase_payments) and sends:
//   pur_pay              Record payment (buyers; the main owner for anyone)
//   pur_void_payment     the person who recorded it, or the main owner
//   pur_resolve_overpaid the main owner: refunds tied to the money that
//                        paid (Q10) and/or a supplier credit
// Every write carries its own operation id: a resent press records once.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;

    const opt = (map, sel) => Object.keys(map).map(k => '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(map[k]) + '</option>').join('');

    function payPill(pay) {
        const l = PA.payLabel(pay);
        return l ? PA.pill(l.text, l.tone) + (l.detail ? ' <span class="req-muted">' + esc(l.detail) + '</span>' : '') : '';
    }
    PA.payPill = payPill;

    function sourceText(p) {
        const who = p.person_name ? ' — ' + p.person_name : '';
        if (p.source === 'own_money' && !p.authorized) {
            return PA.PAY_SOURCE.own_money + who + (p.accepted_at ? ' (accepted by the owner)'
                : p.rejected_at ? ' (rejected by the owner: ' + (p.reject_reason || '') + ' — not owed)'
                : ' (not allowed at the time — owner review)');
        }
        return (PA.PAY_SOURCE[p.source] || p.source) + (p.source === 'company' ? (p.person_name ? ', handed over by ' + p.person_name : '') : who);
    }

    // The Payments card on a purchase's page.
    async function renderPayments(host, purchase, onChange) {
        host.innerHTML = '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">Payments</h3><div class="att-empty">Loading…</div></div></div>';
        let data;
        try {
            data = await RA.rpc('pur_purchase_payments', { p_purchase: purchase.id });
        } catch (e) {
            host.innerHTML = '<div class="att-card"><div class="att-card-body"><h3 class="pur-h3">Payments</h3><p class="req-muted">' +
                esc(PA.errorMessage(e)) + '</p></div></div>';
            return;
        }
        const pay = data.pay || {};
        const open = purchase.status === 'recorded';
        const live = (data.payments || []).filter(p => !p.voided_at);
        const voided = (data.payments || []).filter(p => p.voided_at);
        const owner = !!(data.me && data.me.main_owner);
        host.innerHTML =
            '<div class="att-card"><div class="att-card-body">' +
              '<div class="pur-pay-head"><h3 class="pur-h3">Payments</h3>' + payPill(pay) + '</div>' +
              '<p class="req-muted">How this receipt was paid. Payments never change Spent — the purchase counted once, when it was recorded.</p>' +
              (pay.state === 'not_tracked' ? '<p class="req-muted">Recorded before payments were tracked. Record a payment to start tracking it.</p>' : '') +
              '<div class="pur-pay-figs">' +
                '<span>Receipt <strong>' + esc(PA.peso(pay.due)) + '</strong></span>' +
                '<span>Paid <strong>' + esc(PA.peso(pay.paid)) + '</strong></span>' +
                (Number(pay.balance) > 0 ? '<span>Left to pay <strong>' + esc(PA.peso(pay.balance)) + '</strong></span>' : '') +
                (Number(pay.excess) > 0 ? '<span>Over <strong>' + esc(PA.peso(pay.excess)) + '</strong>' +
                   (Number(pay.resolved) > 0 ? ' · resolved ' + esc(PA.peso(pay.resolved)) : '') + '</span>' : '') +
              '</div>' +
              (Number(pay.over_resolved) > 0 ? '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>More was refunded or credited (' +
                  esc(PA.peso(pay.over_resolved)) + ') than is now over — the purchase total went up after it was resolved. Check the refunds and credit below.</div></div>' : '') +
              (live.length ? '<div class="req-table-wrap"><table class="att-table req-table"><thead><tr><th>Paid on</th><th>Amount</th><th>How</th><th>From</th><th>Note</th><th></th></tr></thead><tbody>' +
                live.map(p => '<tr><td>' + esc(p.paid_on) + '</td><td><strong>' + esc(PA.peso(p.amount)) + '</strong></td><td>' +
                  esc(p.source === 'credit' ? 'Credit' : (PA.PAY_METHOD[p.method] || p.method)) + '</td><td>' + esc(sourceText(p)) + '</td><td>' +
                  esc(p.note || '') + (p.proof_url ? ' <a class="att-link" href="#" data-proof="' + esc(p.proof_url) + '">proof</a>' : '') +
                  '<div class="req-muted">recorded by ' + esc(p.created_by_name) +
                    (p.moved ? ' · carried over from the earlier version of this purchase' : '') + '</div></td><td>' +
                  (p.can_void ? '<button type="button" class="att-btn att-btn--sm" data-void-pay="' + esc(p.id) + '">Void…</button>' : '') +
                  '</td></tr>').join('') + '</tbody></table></div>' : '<p class="req-muted">No payment recorded.</p>') +
              ((data.refunds || []).length || (data.credits || []).length ? '<h4 class="pur-h4">Refunds and supplier credit</h4><ul class="pur-history">' +
                (data.refunds || []).map(r => '<li' + (r.voided_at ? ' class="is-void"' : '') + '>' + esc(r.received_on) + ' — refund <strong>' +
                  esc(PA.peso(r.amount)) + '</strong>: ' + esc(PA.routeLabel(r.funded_by, r.received_by, r.person_name)) +
                  (r.voided_at ? ' — voided: ' + esc(r.void_reason) : '') +
                  (owner && !r.voided_at ? ' <button type="button" class="att-btn att-btn--sm" data-void-refund="' + esc(r.id) + '">Void…</button>' : '') + '</li>').join('') +
                (data.credits || []).map(c => '<li' + (c.voided_at ? ' class="is-void"' : '') + '>Supplier credit <strong>' + esc(PA.peso(c.amount)) +
                  '</strong> with ' + esc(c.supplier || 'the supplier') + ' — ' + esc(PA.peso(c.left)) + ' left' +
                  (c.voided_at ? ' — voided: ' + esc(c.void_reason) : '') +
                  (owner && !c.voided_at ? ' <button type="button" class="att-btn att-btn--sm" data-void-credit="' + esc(c.id) + '">Void…</button>' : '') + '</li>').join('') +
                '</ul>' : '') +
              (voided.length ? '<details class="pur-voided"><summary>Voided payments (' + voided.length + ')</summary><ul class="pur-history">' +
                voided.map(p => '<li class="is-void">' + esc(p.paid_on) + ' — ' + esc(PA.peso(p.amount)) + ' ' + esc(sourceText(p)) +
                  ' — voided: ' + esc(p.void_reason) + '</li>').join('') + '</ul></details>' : '') +
              '<div class="pur-pay-actions">' +
                (open ? '<button type="button" class="att-btn" data-record-pay>Record payment…</button>' : '') +
                (owner && Number(pay.unresolved) > 0 ? '<button type="button" class="att-btn att-btn--primary" data-resolve>Resolve overpaid…</button>' : '') +
              '</div>' +
            '</div></div>';

        // Project Control's Unpaid / Partially paid / Paid tags follow at once (F4).
        const reload = () => { if (root.expPurReloadFlags) root.expPurReloadFlags(); renderPayments(host, purchase, onChange); if (onChange) onChange(); };
        host.querySelectorAll('[data-proof]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); root.open(a.dataset.proof, '_blank'); }));
        const rec = host.querySelector('[data-record-pay]');
        if (rec) rec.addEventListener('click', () => openRecordPayment(purchase, data, reload));
        const res = host.querySelector('[data-resolve]');
        if (res) res.addEventListener('click', async () => {
            try {
                const list = await RA.rpc('pur_overpaid');
                const row = (list || []).find(x => x.id === purchase.id);
                if (row) openResolve(row, reload); else reload();
            } catch (e) { PA.notice(e); }
        });
        host.querySelectorAll('[data-void-pay]').forEach(b => b.addEventListener('click', () =>
            voidModal('Void this payment?', 'It stays in the history, marked void. Petty cash it used goes back on the buyer\'s balance; a credit it used is given back.',
                      'pur_void_payment', { p_payment: b.dataset.voidPay }, reload)));
        host.querySelectorAll('[data-void-refund]').forEach(b => b.addEventListener('click', () =>
            voidModal('Void this refund?', 'It stays in the history, marked void, and the balance it moved goes back.', 'pur_void_refund', { p_refund: b.dataset.voidRefund }, reload)));
        host.querySelectorAll('[data-void-credit]').forEach(b => b.addEventListener('click', () =>
            voidModal('Void this supplier credit?', 'Only a credit nothing has used yet can be voided.', 'pur_void_credit', { p_credit: b.dataset.voidCredit }, reload)));
        RA.icons();
    }
    PA.renderPayments = renderPayments;

    // A void with its reason (kept in the history), sent once.
    function voidModal(title, sub, fn, args, onDone) {
        const opId = root.DacsReceipts.newId();
        RA.modal({
            title, sub, warn: true, submitLabel: 'Void',
            body: '<label class="att-label">Reason (kept in the history)<input class="att-input" name="reason" maxlength="500" required></label>',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc(fn, Object.assign({ p_op: opId, p_reason: form.reason.value.trim() }, args));
            },
            onDone,
        });
    }
    PA.voidModal = voidModal;

    // Record payment (Q4–Q7). Petty cash / own money are the caller's own
    // (a staff buyer); the main owner may enter them for a buyer.
    async function openRecordPayment(purchase, data, onDone) {
        const me = data.me || {};
        let buyers = [];
        if (me.main_owner) {
            try { buyers = ((await RA.rpc('pur_cash_tracker')).buyers || []).filter(b => b.can_buy || Number(b.recorded) !== 0); } catch (_) { buyers = []; }
        }
        const opId = root.DacsReceipts.newId();
        const today = PA.localDay();
        const credits = data.open_credits || [];
        const sources = {};
        if (me.holder || buyers.length) { sources.petty_cash = PA.PAY_SOURCE.petty_cash; sources.own_money = PA.PAY_SOURCE.own_money; }
        sources.company = PA.PAY_SOURCE.company;
        if (credits.length) sources.credit = PA.PAY_SOURCE.credit;
        const balance = Number((data.pay || {}).balance || 0);
        RA.modal({
            title: 'Record payment',
            sub: (purchase.supplier || 'No supplier') + ' · receipt ' + PA.peso((data.pay || {}).due) + ' · ' + PA.peso(balance) + ' left to pay. ' +
                 'A payment never changes Spent.',
            submitLabel: 'Record payment',
            body:
                '<div class="pur-rec-row">' +
                  '<label class="att-label">Amount (₱)<input class="att-input" name="amount" inputmode="decimal" value="' + (balance > 0 ? esc(String(balance)) : '') + '" required></label>' +
                  '<label class="att-label">Paid on<input class="att-input" type="date" name="paidOn" max="' + esc(today) + '" value="' + esc(today) + '" required></label>' +
                '</div>' +
                '<label class="att-label">Paid from<select class="att-input" name="source">' + opt(sources, me.holder ? 'petty_cash' : 'company') + '</select></label>' +
                (me.main_owner && buyers.length ? '<label class="att-label" data-person-row>Whose money<select class="att-input" name="person">' +
                    buyers.map(b => '<option value="' + esc(b.buyer_id) + '">' + esc(b.name) + '</option>').join('') + '</select></label>' : '') +
                (credits.length ? '<label class="att-label" data-credit-row hidden>Credit to use<select class="att-input" name="credit">' +
                    credits.map(c => '<option value="' + esc(c.id) + '" data-left="' + esc(c.left) + '">' + esc(PA.peso(c.left) + ' left') + '</option>').join('') +
                  '</select></label>' : '') +
                '<label class="att-label" data-method-row>How<select class="att-input" name="method">' + opt(PA.PAY_METHOD, PA.methodOf(purchase.payment_method)) + '</select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>' +
                '<label class="att-label">Proof photo (optional — GCash screenshot, deposit slip)<input class="att-input" type="file" name="proof" accept="image/*"></label>' +
                '<p class="req-muted" data-own-note hidden>Own money counts as "Company owes you" once the owner has allowed it (or accepts it afterwards).</p>' +
                '<div class="att-info att-info--warn" data-cash-warn hidden></div>',
            errorMessage: PA.errorMessage,
            onOpen: (form) => {
                const sync = () => {
                    const s = form.source.value;
                    const credit = form.querySelector('[data-credit-row]');
                    if (credit) credit.hidden = s !== 'credit';
                    form.querySelector('[data-method-row]').hidden = s === 'credit';
                    const person = form.querySelector('[data-person-row]');
                    if (person) person.hidden = !(s === 'petty_cash' || s === 'own_money');
                    form.querySelector('[data-own-note]').hidden = s !== 'own_money';
                    const warn = form.querySelector('[data-cash-warn]');
                    const msg = s === 'petty_cash' && me.holder && !me.main_owner ? PA.cashWarning(form.amount.value, me.cash_held) : '';
                    warn.textContent = msg; warn.hidden = !msg;
                };
                form.source.addEventListener('change', sync);
                form.amount.addEventListener('input', sync);
                sync();
            },
            onSubmit: async (form) => {
                const s = form.source.value;
                const creditSel = form.credit;
                const p = { amount: form.amount.value, paidOn: form.paidOn.value, method: form.method.value, source: s,
                            note: form.note.value, creditId: s === 'credit' && creditSel ? creditSel.value : null,
                            personId: (s === 'petty_cash' || s === 'own_money') && form.person ? form.person.value : null };
                const left = s === 'credit' && creditSel ? Number(creditSel.selectedOptions[0].dataset.left) : null;
                const problems = PA.paymentProblems(p, { today, creditLeft: left });
                if (problems.length) throw new Error(problems[0]);
                const file = form.proof.files && form.proof.files[0];
                if (file) {
                    const blob = await root.DacsReceipts.compressToBlob(file);
                    p.proofUrl = await root.DacsReceipts.uploadReceipt('purchase', blob, root.currentDataUserId);
                }
                const r = await RA.rpc('pur_pay', { p_op: opId, p_purchase: purchase.id, p_payment: PA.paymentBody(p) });
                if (r && r.replayed) PA.notice('This payment was already recorded by an earlier press — nothing was added.', 'Already recorded');
            },
            onDone,
        });
    }
    PA.openRecordPayment = openRecordPayment;

    // Resolve overpaid (Q9–Q11, main owner): refunds tied to the money that
    // paid, and/or a supplier credit. Starts from the server's suggestion.
    function openResolve(row, onDone) {
        const opId = root.DacsReceipts.newId();
        const today = PA.localDay();
        const start = PA.defaultResolution(row, today);
        const pay = row.pay || {};
        const paidBy = row.paid_by || [];
        const people = {};
        paidBy.forEach(p => { if (p.person_id) people[p.person_id] = p.person_name; });
        // Into a buyer's hands needs a buyer who paid on this purchase to pick.
        const routeOpts = (fundedBy, sel, name) => (PA.REFUND_ROUTES[fundedBy] || [])
            .filter(r => !(r === 'petty_cash' && (fundedBy === 'company' || fundedBy === 'credit') && !Object.keys(people).length)).map(r => '<option value="' + r + '"' + (r === sel ? ' selected' : '') + '>' +
            esc(PA.routeLabel(fundedBy, r, name)) + '</option>').join('');
        const part = (r, i) =>
            '<div class="pur-resolve-part" data-part="' + i + '">' +
              '<div class="pur-rec-row">' +
                '<label class="att-label">Refund of (₱)<input class="att-input" name="amt' + i + '" inputmode="decimal" value="' + esc(String(r.amount)) + '"></label>' +
                '<label class="att-label pur-w2">Money it paid from<input class="att-input" disabled value="' + esc(PA.PAY_SOURCE[r.fundedBy] + (r.personName ? ' — ' + r.personName : '')) + '"></label>' +
                '<label class="att-label">Received on<input class="att-input" type="date" name="day' + i + '" max="' + esc(today) + '" value="' + esc(r.receivedOn) + '"></label>' +
              '</div>' +
              '<label class="att-label">Where it went<select class="att-input" name="route' + i + '">' + routeOpts(r.fundedBy, r.receivedBy, r.personName) + '</select></label>' +
              (r.fundedBy === 'company' || r.fundedBy === 'credit' ? '<label class="att-label" data-recv-row="' + i + '"' + (r.receivedBy === 'petty_cash' ? '' : ' hidden') + '>Buyer who received it<select class="att-input" name="recv' + i + '">' +
                  Object.keys(people).map(id => '<option value="' + esc(id) + '">' + esc(people[id]) + '</option>').join('') + '</select></label>' : '') +
              '<label class="att-label">Note (optional)<input class="att-input" name="note' + i + '" maxlength="300"></label>' +
            '</div>';
        // A credit-funded excess goes back to the supplier's credit unless a real
        // refund is recorded (Q10): its refund line starts at ₱0, the credit box full.
        const parts = start.refunds.slice();
        if (start.credit > 0) parts.push({ amount: 0, fundedBy: 'credit', personId: null, personName: '', receivedBy: 'company', receivedOn: today });
        RA.modal({
            title: 'Resolve overpaid',
            sub: (row.supplier || 'No supplier') + ' · ' + PA.peso(pay.unresolved) + ' over. A refund goes back to the money that paid it; ' +
                 'a credit stays with the supplier for later purchases. Nothing here changes Spent.',
            submitLabel: 'Save',
            body:
                '<p class="req-muted">Paid: ' + paidBy.map(p => esc(PA.PAY_SOURCE[p.source] + (p.person_name ? ' (' + p.person_name + ')' : '') + ' ' +
                    PA.peso(p.paid) + (Number(p.refunded) > 0 ? ', ' + PA.peso(p.refunded) + ' already refunded' : ''))).join(' · ') + '</p>' +
                '<p class="req-muted">Started from the latest payments — change any amount, or set one to 0 to leave it out.</p>' +
                parts.map(part).join('') +
                '<div class="pur-rec-row">' +
                  '<label class="att-label">Supplier credit (₱)<input class="att-input" name="credit" inputmode="decimal" value="' + (start.credit > 0 ? esc(String(start.credit)) : '') + '"></label>' +
                  '<label class="att-label pur-w2">Credit note (optional)<input class="att-input" name="creditNote" maxlength="300"' +
                    (start.credit > 0 ? ' value="Back to the supplier\'s credit (paid from credit)"' : '') + '></label>' +
                '</div>' +
                (row.supplier_id ? '' : '<p class="req-muted">This purchase has no supplier from the list, so a credit needs one — add the supplier on the purchase first.</p>'),
            errorMessage: PA.errorMessage,
            onOpen: (form) => {
                parts.forEach((r, i) => {
                    const sel = form['route' + i];
                    const recv = form.querySelector('[data-recv-row="' + i + '"]');
                    if (sel && recv) sel.addEventListener('change', () => { recv.hidden = sel.value !== 'petty_cash'; });
                });
            },
            onSubmit: async (form) => {
                const refunds = parts.map((r, i) => ({
                    amount: form['amt' + i].value, fundedBy: r.fundedBy, receivedBy: form['route' + i].value, receivedOn: form['day' + i].value,
                    personId: r.fundedBy === 'company' || r.fundedBy === 'credit'
                        ? (form['route' + i].value === 'petty_cash' && form['recv' + i] ? form['recv' + i].value : null) : r.personId,
                    note: form['note' + i].value,
                })).filter(r => String(r.amount).trim() !== '' && Number(PA.parseMoney(r.amount)) > 0);
                const credit = form.credit.value;
                const problems = PA.resolutionProblems(refunds.map(r => Object.assign({}, r, { personId: r.fundedBy === 'company' || r.fundedBy === 'credit' ? null : r.personId })),
                                                       credit, paidBy, pay.unresolved, today);
                if (problems.length) throw new Error(problems[0].code);
                await RA.rpc('pur_resolve_overpaid', {
                    p_op: opId, p_purchase: row.id,
                    p_refunds: refunds.map(r => Object.assign({ amount: String(PA.round2(PA.parseMoney(r.amount))), funded_by: r.fundedBy,
                        received_by: r.receivedBy, received_on: r.receivedOn, note: String(r.note || '').trim() }, r.personId ? { person_id: r.personId } : {})),
                    p_credit: Number(PA.parseMoney(credit)) > 0 ? { amount: String(PA.round2(PA.parseMoney(credit))), note: form.creditNote.value.trim() } : null,
                });
            },
            onDone,
        });
    }
    PA.openResolve = openResolve;
})(typeof window !== 'undefined' ? window : globalThis);
