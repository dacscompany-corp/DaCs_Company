// ════════════════════════════════════════════════════════════════════
// Stock cost moves (WorkMate Stage 2C, migration 0105).
//
// Moving goods never moves their cost by itself. When goods arrive where
// someone else holds their cost — company stock issued to a project, one
// project's goods moved to another, a company lot brought back to the
// warehouse — the server asks the MAIN OWNER (stk_cost_*):
//   Owner approvals (Purchasing tab) — renderApprovals: one card per
//     pending cost move, with what it would cost each side; Approve /
//     Reject with a reason;
//   Company stock (Purchasing tab, owner accounts) — renderCompanyStock:
//     in the warehouse, issued with the assignment pending, awaiting
//     delivery, and company stock loss;
//   the Stock screen's records (js/stock-admin.js) show each cost move's
//     state and offer Approve / Reject / Ask again / Reverse cost through
//     openDecide / openResubmit / openReverse below.
//
// PESOS: the server sends a value only to owner accounts (Q28); for anyone
// else the keys are missing and nothing is shown. Approval writes ordinary
// expense rows (expenses.stk_cost_move_id) — the server's, never this
// file's; company stock is never in a project's Spent. Every rule is the
// server's (0105); this file only explains. Each form sends one operation
// id, kept across retries of the same form, so a double press records once.
//
// Works in a browser (window.StockCostAdmin) and in Node for
// tests/stock-cost-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    function peso(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return (x < 0 ? '−' : '') + '₱' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function qty(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }

    // What a cost move is worth, for an owner account: the approved value,
    // or the estimate for what a pending one still covers. '' otherwise.
    function valueText(c) {
        if (!c) return '';
        if (c.value !== undefined && c.value !== null) return peso(c.value);
        if (c.estimate !== undefined && c.estimate !== null) return 'about ' + peso(c.estimate);
        return '';
    }

    // Each billing period (or Cover) the giving project's cost comes off.
    function groupText(g) {
        const where = g.cover ? 'Cover' : (g.billing_number ? 'Billing #' + g.billing_number : 'Billing period') +
            (g.month ? ' (' + g.month + (g.year ? ' ' + g.year : '') + ')' : '');
        return where + ' carries ' + peso(g.carries);
    }

    const ERRORS = {
        STOCK_OFF: 'Stock is not switched on yet.',
        OWNER_ONLY: 'Only the main owner approves, rejects or reverses cost moves.',
        NOT_ALLOWED: 'Only the main owner approves, rejects or reverses cost moves.',
        NOTHING_LEFT: 'These goods are no longer there, so there is nothing to charge. Reject it with a reason.',
        COMPLETED_PROJECT: 'One of the projects is completed. Reopen it first — the goods\' record stays as it is.',
        LATER_MOVES_FIRST: 'Later movements or cost moves rely on this one. Reverse those first.',
        COST_BASIS: 'The cost is not where the server expected. Reload the page.',
        REASON_REQUIRED: 'Please give a reason.',
        BAD_STATE: 'This was already decided, withdrawn or reversed. Reload the page.',
        NOT_FOUND: 'That was not found. Reload the page.',
        NOT_OFFICE: 'Only owner and office accounts can ask again.',
        BAD_OP: 'Something went wrong. Close the form and try again.',
        PGRST202: 'Cost moves are not installed on the server yet.',
    };

    function errorMessage(error) {
        const text = String((error && (error.message || error.code || error.error_description)) || (typeof error === 'string' ? error : '') || '');
        if (error && error.code === 'PGRST202') return ERRORS.PGRST202;
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) return ERRORS[code];
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    const pure = { peso, qty, valueText, groupText, ERRORS, errorMessage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser ─────────────────────────────────────────────────────

    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const SA = () => root.StockAdmin || {};

    const newOp = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    function sendOnce(fn) {
        const opId = newOp();
        return (...args) => fn(opId, ...args);
    }

    function pill(text, tone) { return '<span class="att-pill att-pill--' + tone + '">' + esc(text) + '</span>'; }
    const stateOf = (c) => (SA().costState ? SA().costState(c) : null);
    const lineOf = (c, unit) => (SA().costText ? SA().costText(c, unit) : '');

    // Approve (the whole of what is still there) or reject with a reason.
    function openDecide(c, approve, onDone, unit) {
        const send = sendOnce((opId, note) => RA.rpc('stk_cost_decide', { p_op: opId, p_cost: c.id, p_approve: approve, p_note: note }));
        const v = valueText(c);
        RA.modal({
            title: approve ? 'Approve cost move' : 'Reject cost move',
            sub: lineOf(c, unit) + (approve && v ? ' — ' + v : '') +
                (approve ? '. The whole of what is still there; it cannot be edited afterwards, only reversed.'
                         : '. The goods stay recorded where they are; the cost stays where it was.'),
            warn: !approve,
            body: '<div class="stk-form"><label class="att-label">' + (approve ? 'Note (optional)' : 'Reason (the recorder sees this)') +
                '<input class="att-input" name="note" maxlength="500"></label></div>',
            submitLabel: approve ? 'Approve' : 'Reject',
            errorMessage,
            onSubmit: async (form) => {
                if (!approve && !form.note.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.note.value.trim());
            },
            onDone,
        });
    }

    // A stock recorder asks again for the same movement (after a rejection
    // or a reversal) — no second physical record.
    function openResubmit(c, onDone, unit) {
        const send = sendOnce((opId, note) => RA.rpc('stk_cost_resubmit', { p_op: opId, p_cost: c.id, p_note: note }));
        RA.modal({
            title: 'Ask the owner again',
            sub: lineOf(c, unit) + '. Say what changed (the evidence, the right project).',
            body: '<div class="stk-form"><label class="att-label">Note<input class="att-input" name="note" maxlength="500"></label></div>',
            submitLabel: 'Ask again',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.note.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.note.value.trim());
            },
            onDone,
        });
    }

    // The main owner takes an approved cost move back: its expense rows leave
    // Spent; the record and the reason stay.
    function openReverse(c, onDone, unit) {
        const send = sendOnce((opId, reason) => RA.rpc('stk_cost_reverse', { p_op: opId, p_cost: c.id, p_reason: reason }));
        RA.modal({
            title: 'Reverse cost move',
            sub: lineOf(c, unit) + (valueText(c) ? ' — ' + valueText(c) : '') + '. Its rows leave Spent; the record stays, marked reversed.',
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Reason<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: 'Reverse',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.reason.value.trim());
            },
            onDone,
        });
    }

    // ── Purchasing → Owner approvals: pending cost moves ────────────

    function approvalCard(c) {
        const st = stateOf(c);
        const shrunk = Number(c.effective) < Number(c.quantity);
        return '<div class="att-card" data-cost="' + esc(c.id) + '"><div class="att-card-body">' +
            '<div><strong>' + esc(c.item_name) + '</strong> ' + (st ? pill(st[0], st[1]) : '') + '</div>' +
            '<div>' + esc(qty(c.effective)) + ' ' + esc(c.item_unit || '') + ': ' + esc(c.from_name) + ' → ' + esc(c.to_name) +
              (valueText(c) ? ' · <strong>' + esc(valueText(c)) + '</strong>' : '') + '</div>' +
            (shrunk ? '<div class="att-info att-info--warn"><i data-lucide="info"></i><div>' +
                (Number(c.effective) > 0 ? 'Only ' + esc(qty(c.effective)) + ' of the ' + esc(qty(c.quantity)) + ' are still there — approving charges those only.'
                                         : 'None of these goods are still there. Reject it with a reason.') + '</div></div>' : '') +
            (c.to_folder ? '<div class="req-muted">' + esc(c.to_name) + ': funded like a purchase for ' + esc(RA.formatDay(c.received_on)) +
                ' — its billing periods for that month, earliest first, the rest Cover.</div>' : '') +
            ((c.from_groups || []).length ? '<div class="req-muted">Off ' + esc(c.from_name) + ', in proportion: ' +
                c.from_groups.map(g => esc(groupText(g))).join(' · ') + '</div>' : '') +
            '<div class="req-muted">' + esc((SA().KIND_LABEL || {})[c.kind_record] || c.kind_record) + ' ' + esc(RA.formatDay(c.record_on)) +
              ' by ' + esc(c.record_by_name) + (c.record_note ? ' · ' + esc(c.record_note) : '') +
              (c.note ? ' · Asked again: ' + esc(c.note) : '') + '</div>' +
            (c.completed ? '<div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' + esc(ERRORS.COMPLETED_PROJECT) + '</div></div>' : '') +
            '<div class="pur-rec-row">' +
              '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-cost-approve' +
                (c.completed || !(Number(c.effective) > 0) ? ' disabled' : '') + '>Approve</button>' +
              '<button type="button" class="att-btn att-btn--sm att-btn--warn" data-cost-reject>Reject…</button>' +
            '</div></div></div>';
    }

    // host: an element to fill. Draws nothing when stock is off or nothing waits.
    async function renderApprovals(host, onChange) {
        let list;
        try { list = await RA.rpc('stk_cost_pending'); } catch (e) {
            host.innerHTML = /PGRST202|STOCK_OFF/.test(String((e && (e.code || e.message)) || '')) ? '' : '<div class="att-empty">' + esc(errorMessage(e)) + '</div>';
            return;
        }
        list = list || [];
        if (!list.length) { host.innerHTML = ''; return; }
        const reload = () => { renderApprovals(host, onChange); if (onChange) onChange(); };
        host.innerHTML = '<h3 class="pur-h3">Stock cost moves</h3>' +
            '<p class="req-muted">Goods moved where someone else holds their cost. Until you approve, the cost stays where it was.</p>' +
            list.map(approvalCard).join('');
        host.querySelectorAll('[data-cost]').forEach(card => {
            const c = list.find(x => x.id === card.dataset.cost);
            card.querySelector('[data-cost-approve]').addEventListener('click', () => openDecide(c, true, reload, c.item_unit));
            card.querySelector('[data-cost-reject]').addEventListener('click', () => openDecide(c, false, reload, c.item_unit));
        });
        RA.icons();
    }

    // ── Purchasing → Company stock (owner accounts) ─────────────────

    // Purchasing → Company stock (office v5): one card per item, its value
    // in the warehouse, issued (assignment pending), awaiting delivery and
    // lost; the card opens the same figures, with quantities, in the pop-up.
    const csUi = { sel: null };
    async function renderCompanyStock(host, me, opts) {
        const PA = root.PurchasingAdmin, SV = root.SplitView;
        let items;
        try { items = await RA.rpc('stk_company_stock'); } catch (e) {
            host.innerHTML = '<div class="sv"><div class="sv-empty">' + esc(errorMessage(e)) + '</div></div>';
            return;
        }
        if (PA.ui.tab !== 'company') return;   // another tab was chosen while this loaded
        items = items || [];
        const total = items.reduce((s, i) => s + (Number(i.total_value) || 0), 0);
        const cell = (x, unit) => esc(peso(x.value)) + ' <span class="req-muted">· ' + esc(qty(x.quantity)) + ' ' + esc(unit || '') + '</span>';
        const keyOf = i => i.item_id || i.id || i.name;
        root.SplitView.render(host, PA.frame(host, me, {
            lede: 'Goods bought for the warehouse that no project carries yet. Never in a project\'s Spent, and not company overhead. ' +
                  'Issued goods stay here until the main owner approves their cost assignment.',
            aside: items.length ? '<div class="sv-tab-help"><strong>Company stock: ' + esc(peso(total)) + '</strong> ' +
                '<span class="req-muted">(warehouse + pending assignments + awaiting delivery; losses not included)</span></div>' : '',
            search: false,
            groups: [{ title: '', rows: items.map(i => ({
                id: String(keyOf(i)),
                title: i.name + (i.spec ? ' · ' + i.spec : ''),
                sub: 'In the warehouse ' + peso(i.in_warehouse && i.in_warehouse.value),
                meta: 'Issued, assignment pending ' + peso(i.issued_pending && i.issued_pending.value) +
                      ' · Awaiting delivery ' + peso(i.awaiting && i.awaiting.value) + ' · Company stock loss ' + peso(i.loss && i.loss.value),
                right: peso(i.total_value),
            })) }],
            empty: 'No company stock.',
            selectedId: csUi.sel,
            refreshPanel: !!(opts && opts.refreshPanel),
            onSelect: (id, panel) => {
                csUi.sel = id;
                const i = items.find(x => String(keyOf(x)) === id);
                if (!i) { SV.error(panel, 'This item is no longer in company stock. Reload the page.'); return; }
                SV.fill(panel, SV.panelHtml({
                    kicker: 'Company stock',
                    title: i.name + (i.spec ? ' · ' + i.spec : ''),
                    sub: i.unit,
                    sections: [SV.section('Value', SV.facts([
                        ['In the warehouse', cell(i.in_warehouse || {}, i.unit)],
                        ['Issued, assignment pending', cell(i.issued_pending || {}, i.unit)],
                        ['Awaiting delivery', cell(i.awaiting || {}, i.unit)],
                        ['Company stock loss', cell(i.loss || {}, i.unit)],
                        ['Total', '<strong>' + esc(peso(i.total_value)) + '</strong>'],
                    ])), SV.note(esc('Never in a project\'s Spent, and not company overhead.'))],
                    nextLabel: 'Next',
                }));
            },
            onClose: () => { csUi.sel = null; },
        }));
    }

    root.StockCostAdmin = Object.assign({}, pure, { openDecide, openResubmit, openReverse, renderApprovals, renderCompanyStock });
})(typeof window !== 'undefined' ? window : globalThis);