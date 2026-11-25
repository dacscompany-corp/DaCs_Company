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
    // A return's photo (pettyCash/, R13): opened through the shim, which downloads it (F2) — never a signed link.
    const photoLink = (url) => (url ? ' <a class="att-link" href="#" data-photo="' + esc(url) + '">photo</a>' : '');
    const ui = { report: null };
    const peso = (v) => esc(PA.peso(v));
    const newOp = () => root.DacsReceipts.newId();

    const SV = root.SplitView;
    const NO_BUYER = 'No staff buyer yet. Turn a staff member\'s Buyer switch on in Users.';
    const REPORT = '__report';
    const cui = { sel: null };

    // Office v5: Cash is cards in groups, each opening in the pop-up. The
    // main owner sees every buyer; a buyer sees My cash.
    async function renderCash(host, me, opts) {
        let t;
        try {
            t = await RA.rpc('pur_cash_tracker');
        } catch (e) {
            if (/OWNER_ONLY|NOT_ALLOWED/.test(String((e && (e.message || e.code)) || ''))) return renderMyCash(host, me, opts);
            RA.fail(host, e);
            return;
        }
        return renderTracker(host, me, t, opts);
    }
    PA.renderCash = renderCash;

    // ── The main owner ──────────────────────────────────────────────

    function daysAgo(day, today) {
        if (!day) return '';
        const n = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000);
        return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
    }

    async function renderTracker(host, me, t, opts) {
        let overpaid = [], credits = [];
        try {
            [overpaid, credits] = await Promise.all([RA.rpc('pur_overpaid'), RA.rpc('pur_credits', { p_supplier: null })]);
        } catch (e) { RA.fail(host, e); return; }
        if (PA.ui.tab !== 'cash') return;   // another tab was chosen while this loaded
        const buyers = t.buyers || [];
        // Accept / reject / resolve change Project Control's payment tags too (F4).
        const reload = () => { if (root.expPurReloadFlags) root.expPurReloadFlags(); renderCash(host, me, { refreshPanel: true }); };
        const openCredits = (credits || []).filter(c => !c.voided_at);
        const help = (text) => esc(text);

        const buyerCard = b => {
            const f = PA.cashFigures(b);
            const lc = b.last_count;
            const chips = [];
            if (f.shortfall > 0) chips.push({ text: 'Unreconciled shortfall ' + PA.peso(f.shortfall), tone: 'red' });
            if (Number(b.open_disputes) > 0) chips.push({ text: 'Not-received flag', tone: 'red' });
            if (f.toReview > 0) chips.push({ text: PA.peso(f.toReview) + ' to review', tone: 'gold' });
            return {
                id: 'b:' + b.buyer_id,
                title: b.name,
                sub: 'Cash held ' + PA.peso(f.held) + (f.pending > 0 ? ' · Returns waiting ' + PA.peso(f.pending) : ''),
                meta: (f.owes > 0 ? 'Company owes ' + PA.peso(f.owes) + ' · ' : '') +
                      'Last given ' + (b.last_given_on ? b.last_given_on + ' (' + daysAgo(b.last_given_on, t.today) + ')' : '—') +
                      ' · Last count ' + (lc ? lc.counted_on : '—') + (b.can_buy ? '' : ' · Buyer switch off'),
                right: PA.peso(f.held),
                pill: b.can_buy ? (b.own_money ? { text: 'May use own money', tone: 'none' } : null) : { text: 'Buyer switch off', tone: 'none' },
                chips: chips,
            };
        };
        const groups = [
            { title: 'Buyers', tone: 'ink', rows: buyers.map(buyerCard) },
            { title: 'Returns waiting for you', tone: 'gold',
              meta: help('The buyer says they handed this back. It lowers their cash held only when you confirm it, on the day you confirm.'),
              rows: (t.pending_returns || []).map(r => ({ id: 'r:' + r.id, title: r.name + ' returned ' + PA.peso(r.amount),
                  sub: 'Handed over ' + r.handed_on + (r.handed_to ? ' to ' + r.handed_to : '') + (r.note ? ' — ' + r.note : ''),
                  right: PA.peso(r.amount), pill: { text: 'To confirm', tone: 'gold' }, nextLabel: 'Confirm received' })) },
            { title: '"I did not receive this"', tone: 'red',
              meta: help('A buyer says petty cash you recorded never reached them. Their balance is unchanged until you settle it.'),
              rows: (t.disputes || []).map(i => ({ id: 'd:' + i.id, title: PA.peso(i.amount) + ' given ' + i.issued_on, sub: i.name,
                  meta: '"' + i.dispute_note + '"', right: PA.peso(i.amount), pill: { text: 'Flagged', tone: 'red' }, nextLabel: 'It was handed over…' })) },
            { title: 'Own money to review', tone: 'gold',
              meta: help('Paid with a buyer\'s own money while "May use own money" was off. Kept as a real payment. ' +
                  'Accept it and the company owes it; reject it, with a reason, and it is never owed (R9).'),
              rows: (t.to_review || []).map(p => ({ id: 'o:' + p.id, title: PA.peso(p.amount) + ' paid by ' + p.person_name,
                  sub: 'on ' + p.paid_on + (p.note ? ' — ' + p.note : ''), right: PA.peso(p.amount), pill: { text: 'To review', tone: 'gold' }, nextLabel: 'Accept' })) },
            { title: 'Overpaid', tone: 'red',
              meta: help('More was paid than the purchase now costs (or it was voided after it was paid). Refund it to the money that paid it, or keep it as supplier credit.'),
              rows: (overpaid || []).map(o => {
                  const pl = PA.payLabel(o.pay);
                  return { id: 'p:' + o.id, title: (o.supplier || 'No supplier') + ' · ' + RA.formatDay(o.purchase_date),
                      sub: pl ? pl.text + (pl.detail ? ' · ' + pl.detail : '') : '',
                      right: PA.peso(o.pay && o.pay.unresolved), pill: { text: 'Overpaid', tone: 'red' },
                      chips: Number(o.pay && o.pay.over_resolved) > 0 ? [{ text: 'Refunded ' + PA.peso(o.pay.over_resolved) + ' more than is over — check', tone: 'red' }] : [],
                      nextLabel: Number(o.pay && o.pay.unresolved) > 0 ? 'Resolve…' : '' };
              }) },
            { title: 'Supplier credit', tone: 'ink',
              meta: help('A balance with one supplier, used in parts when paying that supplier, until it is gone. Not cash.'),
              rows: openCredits.map(c => ({ id: 'c:' + c.id, title: c.supplier || 'Supplier', sub: PA.peso(c.left) + ' left of ' + PA.peso(c.amount),
                  meta: c.note || '', right: PA.peso(c.left), pill: { text: 'Credit', tone: 'none' } })) },
        ];
        const toolbar = '<button type="button" class="att-btn att-btn--primary" data-give>Give petty cash…</button>' +
                        '<button type="button" class="att-btn" data-report>Daily report…</button>';

        root.SplitView.render(host, PA.frame(host, me, {
            strips: ['Petty cash, a buyer\'s own money, refunds and supplier credit say who holds or is owed company money. ' +
                     'None of it changes Spent or Profit — a purchase counted once, when it was recorded.'],
            notice: buyers.length ? '' : SV.notice('grey', 'users', NO_BUYER, ''),
            search: false,
            toolbar: toolbar,
            onToolbar: el => {
                el.querySelector('[data-give]').addEventListener('click', () => giveModal(buyers, reload));
                el.querySelector('[data-report]').addEventListener('click', () => SV.open('reqPurchasing', REPORT));
            },
            groups: groups,
            empty: buyers.length ? 'Nothing here.' : NO_BUYER,
            selectedId: cui.sel,
            refreshPanel: !!(opts && opts.refreshPanel),
            onSelect: (id, panel, o) => {
                cui.sel = id;
                const [kind, key] = [id.slice(0, 2), id.slice(2)];
                if (id === REPORT) {
                    const body = SV.page(panel, { kicker: 'Cash', title: 'Daily report', wide: true });
                    return reportPanel(body, buyers, t.today, ui.report);
                }
                if (kind === 'b:') return buyerPanel(panel, buyers.find(x => x.buyer_id === key), t.today, reload, o);
                if (kind === 'r:') return returnPanel(panel, (t.pending_returns || []).find(x => x.id === key), reload, o);
                if (kind === 'd:') return disputePanel(panel, (t.disputes || []).find(x => x.id === key), reload, o);
                if (kind === 'o:') return ownMoneyPanel(panel, (t.to_review || []).find(x => x.id === key), reload, o);
                if (kind === 'p:') return overpaidPanel(panel, (overpaid || []).find(x => x.id === key), reload, o);
                if (kind === 'c:') return creditPanel(panel, openCredits.find(x => x.id === key), reload);
            },
            onClose: was => { cui.sel = null; if (was === REPORT) ui.report = null; },
        }));
    }

    // The links every Cash pop-up shares: a purchase, a photo.
    function wire(panel, handlers) {
        panel.onclick = e => {
            const a = e.target.closest('[data-open]');
            if (a) { e.preventDefault(); PA.openPurchase(a.dataset.open); return; }
            const ph = e.target.closest('[data-photo]');
            if (ph) { e.preventDefault(); root.open(ph.dataset.photo, '_blank'); return; }
            const b = e.target.closest('button');
            if (!b || b.disabled) return;
            for (const [attr, fn] of handlers) if (b.hasAttribute(attr)) { fn(b); return; }
        };
    }
    function start(panel, o) {
        if (o && o.start) { const go = panel.querySelector('.sv-step button'); if (go) go.click(); }
    }
    const missing = panel => SV.error(panel, 'This is no longer waiting. Reload the page.');
    const primary = (label, attrs) => '<button type="button" class="att-btn att-btn--primary" ' + attrs + '>' + esc(label) + '</button>';

    function returnPanel(panel, r, reload, o) {
        if (!r) return missing(panel);
        SV.fill(panel, SV.panelHtml({
            kicker: 'Return waiting for you', title: PA.peso(r.amount) + ' from ' + r.name, pills: [{ text: 'To confirm', tone: 'gold' }],
            step: SV.nextStep('The buyer says they handed this back. Confirm once you have the cash.', primary('Confirm received', 'data-confirm="' + esc(r.id) + '"')),
            sections: [SV.section('Return', SV.facts([['Amount', peso(r.amount)], ['Handed over on', esc(r.handed_on)], ['To whom', esc(r.handed_to || '')],
                ['Note', esc(r.note || '')], ['Photo', r.photo_url ? photoLink(r.photo_url).trim() : '']]))],
            actions: SV.lbtn('Reject…', 'data-reject="' + esc(r.id) + '"', 'warn'),
            nextLabel: 'Next',
        }));
        wire(panel, [
            ['data-confirm', async b => { b.disabled = true;
                try { await RA.rpc('pur_cash_decide_return', { p_op: newOp(), p_return: b.dataset.confirm, p_confirm: true, p_note: null }); SV.toast('Return confirmed'); } catch (e) { PA.notice(e); }
                reload(); }],
            ['data-reject', b => noteModal('Reject this return?', 'The buyer\'s cash held stays as it is. Say why — they see it.', 'Reject', 'pur_cash_decide_return',
                { p_return: b.dataset.reject, p_confirm: false }, 'p_note', reload)],
        ]);
        start(panel, o);
    }

    function disputePanel(panel, i, reload, o) {
        if (!i) return missing(panel);
        SV.fill(panel, SV.panelHtml({
            kicker: '"I did not receive this"', title: PA.peso(i.amount) + ' given ' + i.issued_on, pills: [{ text: 'Flagged', tone: 'red' }],
            sub: i.name,
            step: SV.nextStep('A buyer says petty cash you recorded never reached them. Their balance is unchanged until you settle it.',
                primary('It was handed over…', 'data-clear="' + esc(i.id) + '"')),
            sections: [SV.section('Note from the buyer', '<p class="sv-text">' + esc(i.dispute_note) + '</p>')],
            actions: SV.lbtn('Void the entry…', 'data-void-issue="' + esc(i.id) + '"', 'danger'),
            nextLabel: 'Next',
        }));
        wire(panel, [
            ['data-clear', b => noteModal('The cash was handed over',
                'The flag is cleared and the entry stays. If it was NOT handed over, void the entry instead.', 'Clear the flag', 'pur_cash_clear_dispute',
                { p_issue: b.dataset.clear }, 'p_note', reload)],
            ['data-void-issue', b => PA.voidModal('Void this petty cash entry?', 'It leaves the buyer\'s balance and stays in the history, marked void.',
                'pur_cash_void_issue', { p_issue: b.dataset.voidIssue }, reload)],
        ]);
        start(panel, o);
    }

    function ownMoneyPanel(panel, p, reload, o) {
        if (!p) return missing(panel);
        SV.fill(panel, SV.panelHtml({
            kicker: 'Own money to review', title: PA.peso(p.amount) + ' paid by ' + p.person_name, pills: [{ text: 'To review', tone: 'gold' }],
            sub: 'Paid with a buyer\'s own money while "May use own money" was off. Kept as a real payment.',
            step: SV.nextStep('Accept it and the company owes it; reject it, with a reason, and it is never owed (R9).', primary('Accept', 'data-accept="' + esc(p.id) + '"')),
            sections: [SV.section('Payment', SV.facts([['Amount', peso(p.amount)], ['Paid on', esc(p.paid_on)], ['Note', esc(p.note || '')]]))],
            actions: SV.lbtn('Reject…', 'data-reject-own="' + esc(p.id) + '"', 'warn') + SV.lbtn('Open purchase', 'data-open="' + esc(p.purchase_id) + '"'),
            nextLabel: 'Next',
        }));
        wire(panel, [
            ['data-accept', async b => { b.disabled = true;
                try { await RA.rpc('pur_accept_own_money', { p_op: newOp(), p_payment: b.dataset.accept }); SV.toast('Accepted — the company owes it'); } catch (e) { PA.notice(e); }
                reload(); }],
            ['data-reject-own', b => noteModal('Reject this own-money claim?',
                'The payment stays (the supplier was paid), but the company will not owe it. The buyer sees your reason.', 'Reject',
                'pur_reject_own_money', { p_payment: b.dataset.rejectOwn }, 'p_reason', reload)],
        ]);
        start(panel, o);
    }

    function overpaidPanel(panel, row, reload, o) {
        if (!row) return missing(panel);
        const pay = row.pay || {};
        SV.fill(panel, SV.panelHtml({
            kicker: 'Overpaid', title: PA.peso(pay.unresolved) + ' over', pills: [{ text: 'Overpaid', tone: 'red' }],
            sub: (row.supplier || 'No supplier') + ' · ' + RA.formatDay(row.purchase_date),
            step: Number(pay.unresolved) > 0 ? SV.nextStep('More was paid than the purchase now costs. Refund it to the money that paid it, or keep it as supplier credit.',
                primary('Resolve…', 'data-resolve="' + esc(row.id) + '"')) : '',
            sections: [
                (Number(pay.over_resolved) > 0 ? SV.notice('red', 'alert-triangle', 'Refunded ' + PA.peso(pay.over_resolved) + ' more than is over — check', '') : ''),
                SV.section('Purchase', SV.facts([['Purchase', esc((row.supplier || 'No supplier') + ' · ' + RA.formatDay(row.purchase_date))],
                    ['Payment status', PA.payPill ? PA.payPill(pay) : ''], ['Over', peso(pay.unresolved)]])),
            ],
            actions: SV.lbtn('Open purchase', 'data-open="' + esc(row.id) + '"'),
            nextLabel: 'Next',
        }));
        wire(panel, [['data-resolve', () => PA.openResolve(row, reload)]]);
        start(panel, o);
    }

    function creditPanel(panel, c, reload) {
        if (!c) return missing(panel);
        SV.fill(panel, SV.panelHtml({
            kicker: 'Supplier credit', title: (c.supplier || 'Supplier') + ' · ' + PA.peso(c.left) + ' left',
            sections: [
                SV.note(esc('A balance with one supplier, used in parts when paying that supplier, until it is gone. Not cash.')),
                SV.section('Credit', SV.facts([['Left', peso(c.left)], ['Of', peso(c.amount)], ['Note', esc(c.note || '')]])),
            ],
            actions: (Number(c.left) === Number(c.amount) ? SV.lbtn('Void…', 'data-void-credit="' + esc(c.id) + '"', 'danger') : '') +
                     SV.lbtn('From this purchase', 'data-open="' + esc(c.purchase_id) + '"'),
            nextLabel: 'Next',
        }));
        wire(panel, [['data-void-credit', b => PA.voidModal('Void this supplier credit?', 'Only a credit nothing has used yet can be voided.',
            'pur_void_credit', { p_credit: b.dataset.voidCredit }, reload)]]);
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

    // One labor / overhead payment from petty cash (0122), as a line (t and s are
    // escaped by SV.lines). A spend is voided by editing or deleting its entry in
    // Project Control — never from here, so it carries no button.
    function spendLine(x) {
        return { t: PA.peso(x.amount) + ' · ' + (PA.SPEND_LABEL[x.kind] || x.kind),
                 s: x.spent_on + ' — ' + [x.label, x.place].filter(Boolean).join(' · ') + (x.voided_at ? ' — voided: ' + x.void_reason : ''),
                 dim: !!x.voided_at, pills: x.voided_at ? [{ text: 'Voided', tone: 'red' }] : [] };
    }

    // One buyer's details in the pop-up (90 days), with counts and
    // repayments — voids live here; "May use own money" is its switch.
    async function buyerPanel(panel, b, today, reload, o) {
        if (!b) return missing(panel);
        const mine = panel.dataset.svId;
        if (!panel.dataset.svRestore) panel.innerHTML = '<div class="sv-panel-empty">Loading…</div>';
        let d;
        try { d = await RA.rpc('pur_cash_buyer', { p_buyer: b.buyer_id }); } catch (e) { SV.error(panel, PA.errorMessage(e)); return; }
        if (!panel.isConnected || panel.dataset.svId !== mine) return;
        const f = PA.cashFigures(d);
        const lc = b.last_count;
        const diff = lc ? PA.round2(Number(lc.counted) - Number(lc.recorded)) : 0;
        const voidBtn = (attr, id) => SV.lbtn('Void…', attr + '="' + esc(id) + '"');
        const RET = { reported: 'waiting for you', withdrawn: 'withdrawn by the buyer', confirmed: 'confirmed', rejected: 'rejected' };
        SV.fill(panel, SV.panelHtml({
            kicker: 'Buyer details',
            title: d.name,
            pills: [].concat(f.shortfall > 0 ? [{ text: 'Unreconciled shortfall', tone: 'red' }] : [],
                Number(b.open_disputes) > 0 ? [{ text: 'Not-received flag', tone: 'red' }] : [],
                f.toReview > 0 ? [{ text: PA.peso(f.toReview) + ' to review', tone: 'gold' }] : [],
                b.can_buy ? [] : [{ text: 'Buyer switch off', tone: 'none' }]),
            sub: b.can_buy ? 'Staff buyer' : 'Buyer switch off',
            sections: [
                SV.section('Now', SV.facts([
                    ['Cash held', peso(f.held)],
                    ['Unreconciled shortfall', f.shortfall > 0 ? peso(f.shortfall) : ''],
                    ['Returns waiting', f.pending > 0 ? peso(f.pending) : ''],
                    ['Company owes', peso(f.owes)],
                    ['To review', f.toReview > 0 ? peso(f.toReview) : ''],
                    ['Last given', b.last_given_on ? esc(b.last_given_on) + ' <span class="req-muted">' + esc(daysAgo(b.last_given_on, today)) + '</span>' : '—'],
                    ['Last count', lc ? esc(lc.counted_on) + ': ' + peso(lc.counted) + ' <span class="req-muted">' +
                        (diff === 0 ? 'matched' : diff < 0 ? 'short ' + esc(PA.peso(-diff)) : 'over ' + esc(PA.peso(diff))) + '</span>' : '—'],
                ])),
                '<div class="sv-switch-row"><div><div class="sv-switch-label">May use own money</div>' +
                  '<div class="sv-switch-help">Allowed / Off. While off, own-money payments wait for you to accept or reject.</div></div>' +
                  '<label class="att-switch"><input type="checkbox" data-own="' + esc(b.buyer_id) + '"' + (b.own_money ? ' checked' : '') + '> ' +
                    (b.own_money ? 'Allowed' : 'Off') + '</label></div>',
                SV.section('Petty cash given (90 days)', SV.lines((d.issues || []).map(i => ({
                    t: PA.peso(i.amount) + ' · ' + (PA.PAY_METHOD[i.method] || i.method), s: 'Given on ' + i.issued_on + (i.note ? ' — ' + i.note : '') +
                        (i.voided_at ? ' — voided: ' + i.void_reason : ''),
                    dim: !!i.voided_at,
                    pills: [].concat(i.disputed_at && !i.dispute_cleared_at ? [{ text: 'Not-received flag', tone: 'gold' }] : [], i.voided_at ? [{ text: 'Voided', tone: 'red' }] : []),
                    acts: i.voided_at ? '' : voidBtn('data-void-issue', i.id) })), 'None.')),
                SV.section('Returns (90 days)', SV.lines((d.returns || []).map(r => ({
                    t: PA.peso(r.amount), s: 'Handed over ' + r.handed_on + (r.decision_note ? ' · ' + r.decision_note : ''),
                    dim: !!r.voided_at,
                    pills: [{ text: r.voided_at ? 'voided' : (RET[r.status] || r.status), tone: r.voided_at ? 'red' : r.status === 'reported' ? 'gold' : r.status === 'confirmed' ? 'done' : 'none' }],
                    note: '', facts: r.photo_url ? [['Photo', photoLink(r.photo_url).trim()]] : [],
                    acts: !r.voided_at && r.status === 'confirmed' ? voidBtn('data-void-return', r.id) : '' })), 'None.')),
                SV.section('Paid labor and overhead (90 days)', SV.lines(PA.groupSpends(d.spends || []).map(spendLine), 'None.')),
                SV.section('Cash counts', SV.lines((d.counts || []).map(k => ({
                    t: 'Counted ' + PA.peso(k.counted), s: k.counted_on + ' — counted ' + PA.peso(k.counted) + ', recorded ' + PA.peso(Math.max(0, Number(k.recorded))) +
                        (k.note ? ' — ' + k.note : '') + ' · A record only',
                    dim: !!k.voided_at, pills: k.voided_at ? [{ text: 'Voided', tone: 'red' }] : [],
                    acts: k.voided_at ? '' : voidBtn('data-void-count', k.id) })), 'None.')),
                SV.section('Repayments of own money', SV.lines((d.repayments || []).map(x => ({
                    t: PA.peso(x.amount) + ' · ' + (PA.PAY_METHOD[x.method] || x.method), s: 'Paid on ' + x.paid_on,
                    dim: !!x.voided_at, pills: x.voided_at ? [{ text: 'Voided', tone: 'red' }] : [],
                    acts: x.voided_at ? '' : voidBtn('data-void-repay', x.id) })), 'None.')),
            ],
            actions: SV.lbtn('Count cash…', 'data-count') + (f.owes > 0 ? SV.lbtn('Repay own money…', 'data-repay') : ''),
            nextLabel: 'Next',
        }));
        const again = () => { reload(); };
        const own = panel.querySelector('[data-own]');
        if (own) own.addEventListener('change', async () => {
            try { await RA.rpc('pur_set_own_money', { p_buyer: own.dataset.own, p_on: own.checked }); } catch (e) { PA.notice(e); }
            reload();
        });
        wire(panel, [
            ['data-count', () => countModal(b, again)],
            ['data-repay', () => repayModal(b, f.owes, again)],
            ['data-void-issue', x => PA.voidModal('Void this petty cash entry?', 'It leaves the buyer\'s balance and stays in the history, marked void.', 'pur_cash_void_issue', { p_issue: x.dataset.voidIssue }, again)],
            ['data-void-return', x => PA.voidModal('Void this confirmed return?', 'The amount goes back on the buyer\'s balance.', 'pur_cash_void_return', { p_return: x.dataset.voidReturn }, again)],
            ['data-void-count', x => PA.voidModal('Void this cash count?', 'A count is a record only; voiding it changes no balance.', 'pur_cash_void_count', { p_count: x.dataset.voidCount }, again)],
            ['data-void-repay', x => PA.voidModal('Void this repayment?', 'The company owes the buyer that amount again.', 'pur_void_repayment', { p_repayment: x.dataset.voidRepay }, again)],
        ]);
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
            '<div class="pur-report">' +
              '<div class="att-toolbar">' +
                '<label class="att-label">Buyer<select class="att-input" data-r="buyer">' + buyerOptions(buyers.concat([]), st.buyer) +
                  buyers.filter(b => !b.can_buy && b.buyer_id !== st.buyer).map(b => '<option value="' + esc(b.buyer_id) + '">' + esc(b.name) + '</option>').join('') + '</select></label>' +
                '<label class="att-label">From<input class="att-input" type="date" data-r="from" value="' + esc(st.from) + '"></label>' +
                '<label class="att-label">To<input class="att-input" type="date" data-r="to" value="' + esc(st.to) + '"></label>' +
                '<button type="button" class="att-btn" data-print disabled>Print</button>' +
                '<button type="button" class="att-btn" data-csv disabled>CSV</button>' +
              '</div><div data-r-body><div class="att-empty">Loading…</div></div>' +
            '</div>';
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

    // A buyer (office v5): one "Your cash" card; its pop-up holds the
    // balance, what was given, returns and repayments, and Report a return….
    async function renderMyCash(host, me, opts) {
        let d;
        try { d = await RA.rpc('pur_my_cash'); } catch (e) { RA.fail(host, e); return; }
        if (PA.ui.tab !== 'cash') return;
        const reload = () => renderCash(host, me, { refreshPanel: true });
        const f = d.holder ? PA.cashFigures(d) : null;
        const card = d.holder ? {
            id: 'me',
            title: 'Company money you hold',
            sub: 'Company money you hold for purchases, and what the company owes you for your own money. None of it changes a project\'s costs.',
            meta: 'Company owes you ' + PA.peso(f.owes),
            right: PA.peso(f.held),
            pill: f.pending > 0 ? { text: 'Return waiting', tone: 'gold' } : null,
            chips: f.shortfall > 0 ? [{ text: 'Unreconciled shortfall', tone: 'red' }] : [],
            nextLabel: 'Report a return…',
        } : null;
        root.SplitView.render(host, PA.frame(host, me, {
            search: false,
            groups: [{ title: 'Your cash', tone: 'ink', rows: card ? [card] : [] }],
            empty: 'Petty cash is held by staff buyers. Nothing to show for this account.',
            selectedId: cui.sel,
            refreshPanel: !!(opts && opts.refreshPanel),
            onSelect: (id, panel, o) => {
                cui.sel = id;
                SV.fill(panel, SV.panelHtml({
                    kicker: 'Your cash',
                    title: 'Company money you hold',
                    sub: 'None of it changes a project\'s costs.',
                    sections: [
                        (f.shortfall > 0 ? SV.notice('gold', 'alert-triangle', 'Unreconciled shortfall ' + PA.peso(f.shortfall),
                            'You paid more than the petty cash on record — the owner will check it.') : ''),
                        SV.notice('grey', 'info', d.own_money ? 'You may use your own money when petty cash runs short.' : 'Ask the owner before using your own money.', ''),
                        SV.section('Now', SV.facts([
                            ['Cash held', peso(f.held)],
                            ['Return waiting', f.pending > 0 ? peso(f.pending) + ' <span class="req-muted">Counts once the owner confirms it.</span>' : ''],
                            ['Company owes you', peso(f.owes) + (f.toReview > 0 ? ' <span class="req-muted">' + peso(f.toReview) + ' waiting for the owner\'s OK.</span>' : '')],
                        ])),
                        SV.section('Petty cash you were given (90 days)', SV.note(esc('If an entry never reached you, say so — the owner checks it.')) +
                          SV.lines((d.issues || []).map(i => ({
                            t: PA.peso(i.amount) + ' · ' + (PA.PAY_METHOD[i.method] || i.method), s: 'Given ' + i.issued_on + (i.note ? ' — ' + i.note : '') +
                                (i.voided_at ? ' — voided: ' + i.void_reason : '') +
                                (i.dispute_cleared_at ? ' · Owner: ' + (i.dispute_cleared_note || '') : ''),
                            dim: !!i.voided_at,
                            pills: !i.voided_at && i.disputed_at && !i.dispute_cleared_at ? [{ text: 'You said not received', tone: 'gold' }] : [],
                            acts: !i.voided_at && !(i.disputed_at && !i.dispute_cleared_at) ? SV.lbtn('I did not receive this…', 'data-dispute="' + esc(i.id) + '"') : '',
                          })), 'Nothing here.')),
                        SV.section('Paid labor and overhead (90 days)', SV.note(esc('Labor and overhead you paid from your petty cash. Edited or deleted in Project Control, never here.')) +
                          SV.lines(PA.groupSpends(d.spends || []).map(spendLine), 'Nothing here.')),
                        SV.section('Returns', SV.note(esc('Reported returns wait for the owner.')) + SV.lines((d.returns || []).map(r => ({
                            t: PA.peso(r.amount), s: 'Handed over ' + r.handed_on + (r.decision_note ? ' · ' + r.decision_note : '') + (r.voided_at ? ' — voided by the owner' : ''),
                            pills: [{ text: { reported: 'waiting for the owner', withdrawn: 'withdrawn', confirmed: 'confirmed', rejected: 'rejected' }[r.status] || r.status,
                                      tone: r.status === 'reported' ? 'gold' : r.status === 'confirmed' ? 'done' : 'none' }],
                            facts: r.photo_url ? [['Photo', photoLink(r.photo_url).trim()]] : [],
                            acts: r.status === 'reported' ? SV.lbtn('Withdraw', 'data-withdraw="' + esc(r.id) + '"') : '',
                          })), 'Nothing here.')),
                        SV.section('Repaid to you (90 days)', SV.note(esc('What the company paid back for your own money.')) + SV.lines((d.repayments || []).map(x => ({
                            t: PA.peso(x.amount), s: x.paid_on + (x.voided_at ? ' — voided' : ''), dim: !!x.voided_at,
                          })), 'Nothing here.')),
                    ],
                    actions: SV.lbtn('Report a return…', 'data-return', 'primary'),
                    nextLabel: '',
                }));
                wire(panel, [
                    ['data-return', () => returnModal(f.held, reload)],
                    ['data-dispute', b => noteModal('I did not receive this',
                        'The owner sees your note. Your balance does not change until they settle it.', 'Send', 'pur_cash_dispute', { p_issue: b.dataset.dispute }, 'p_note', reload)],
                    ['data-withdraw', async b => { b.disabled = true;
                        try { await RA.rpc('pur_cash_withdraw_return', { p_op: newOp(), p_return: b.dataset.withdraw }); } catch (e) { PA.notice(e); }
                        reload(); }],
                ]);
                if (o && o.start) returnModal(f.held, reload);
            },
            onClose: () => { cui.sel = null; },
        }));
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