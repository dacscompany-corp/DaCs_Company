// ═════════════════════════════════════════════════
// Project Management — Billing Request and Acknowledgement Receipts (migration 0116).
//
// Both are opened from Project Management → project → Money → Payment, and both
// are owner-only:
//   · Acknowledgement Receipt: one per payment the client has paid. Saved with a
//     permanent AR-YYYYMM-NNN number from the same series as Project Control's
//     receipts. The amount is ALWAYS the payment's paid amount, and the server
//     reads it: nothing here sends an amount. If the paid amount changes, the
//     old receipt is voided with a reason, stays on record, and a new one is
//     issued with a new number. The page and the dialogs are 0114's
//     (js/billing-receipts.js), given Project Management's wording.
//   · Billing Request: a printout asking the client to release the next funds:
//     a percentage of the Project Budget, every payment received so far and the
//     Total Received. Never saved.
//
// OUTSIDE THE MONEY MODEL. Nothing here writes a payment, bill, invoice, budget
// or expense, and nothing may feed a receipt into Spent / Earned / Profit, PM
// profit sharing, the warranty reserve or cash advances. This file is the ONLY
// caller of the pmar_* server functions.
//
// Spec: docs/superpowers/specs/2026-11-18-pm-billing-documents-design.md
// Tests: tests/pm-billing-docs.test.js
// ═════════════════════════════════════════════════
(function (root) {
    'use strict';

    const BR = () => root.BillingReceipts;

    const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g,
        (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
    const cents = (value) => Math.round(num(value) * 100);
    const money = (value) => '₱' + num(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const NO_BUDGET = 'This project has no Project Budget yet, so a percentage cannot be worked out.';
    const NOT_PREPARED = 'Could not prepare the billing request. Please refresh and try again.';
    const NOT_PAID = 'This payment is not marked paid, so there is nothing to acknowledge.';
    const NEEDS_0116 = 'Acknowledgement Receipts in Project Management need database update 0116 applied first.';

    // ── Pure half ──────────────────────────────────────────

    // The browser's copy of the server's pmar_paid_amount (the Total cash receipt
    // rule, js/pm-sharing.js paid()), limited to payments the client has paid.
    function paidAmount(row) {
        const r = row || {};
        if (r.status === 'verified') return num(r.amountPaid || r.paidAmount || r.totalAmount);
        if (r.status === 'paid' || r.status === 'partial') return num(r.amountPaid);
        return 0;
    }
    function isPaidRow(row) { return cents(paidAmount(row)) > 0; }

    // What pressing a payment's receipt button should offer. `period` carries the
    // payment, so 0114's dialogs work unchanged.
    function planFor(state, paymentId) {
        const payment = ((state && state.payments) || []).find((p) => p.id === paymentId) || null;
        const own = ((state && state.receipts) || []).filter((r) => r.payment_id === paymentId);
        const live = own.find((r) => !r.voided_at) || null;
        const voided = own.filter((r) => r.voided_at);
        if (live && !payment) return { kind: 'changed', period: { id: paymentId, label: live.billing_label }, live, voided, amount: 0 };
        if (!payment || cents(payment.amount) <= 0) return { kind: 'not_paid', period: null, live, voided };
        const period = { id: payment.id, label: payment.label };
        const amount = num(payment.amount);
        if (live) return { kind: cents(live.amount) === cents(amount) ? 'issued' : 'changed', period, live, voided, amount };
        return { kind: 'new', period, voided, amount };
    }

    function requestWarning(budget, received, amount) {
        const left = cents(budget) - cents(received);
        if (cents(amount) <= left) return '';
        if (left <= 0) return 'This project has already received its full Project Budget, so this request goes over it. You can still continue.';
        return 'This request is over what is left of the Project Budget (' + money(left / 100) + '). You can still continue.';
    }

    // The same formal A4 sheet as Project Control's Billing Request (design 1b,
    // _pcBillingRequestHTML in portal-app.compiled.js), listing payments received.
    const STYLE = 'body{margin:0;background:#e9ebe8;font:13px/1.5 Arial,Helvetica,sans-serif;color:#17251d;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
        + '.toolbar{max-width:794px;margin:24px auto 0;display:flex;justify-content:flex-end}'
        + '.toolbar button{font:700 13px Arial;background:#1a5c3a;color:#fff;border:0;border-radius:6px;padding:9px 16px;cursor:pointer}'
        + '.page{max-width:794px;min-height:1123px;margin:16px auto 40px;background:#fff;box-shadow:0 2px 12px rgba(23,37,29,.12);box-sizing:border-box;padding:48px 56px 44px;display:flex;flex-direction:column}'
        + '.eb{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}.g{color:#1a5c3a}'
        + '.titlebar{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:6px}'
        + 'h1{margin:0;font-size:28px;font-weight:700;letter-spacing:-.01em}.sub{font-size:13px;color:#6b7280;margin-top:4px}'
        + '.meta{display:grid;grid-template-columns:auto auto;column-gap:16px;row-gap:3px;font-size:12px;text-align:right}.meta span:nth-child(odd){color:#6b7280}.meta span:nth-child(even){font-weight:700}'
        + '.parties{display:flex;margin-top:24px;border:1px solid #dfe5e1;border-radius:6px}.parties>div{flex:1 1 0;min-width:0;padding:14px 18px}.parties>div:not(:last-child){border-right:1px solid #dfe5e1}'
        + '.n{font-size:15px;font-weight:700;margin-top:6px}.d{color:#4b5563}'
        + '.lead{margin:22px 0 0;color:#374151}'
        + '.req{margin-top:18px;background:#f2f6f3;border:1px solid #cfd9d2;border-radius:6px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:16px}'
        + '.req .basis{font-size:20px;font-weight:700;margin-top:4px}.req .amt{font-size:26px;font-weight:700;color:#1a5c3a;font-variant-numeric:tabular-nums;white-space:nowrap}'
        + '.sec{margin-top:26px}'
        + 'table{width:100%;border-collapse:collapse;margin-top:8px;font-variant-numeric:tabular-nums}'
        + 'thead th{background:#f2f6f3;text-align:left;padding:9px 12px;font-size:11px;font-weight:700;color:#4b5563;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #cfd9d2}'
        + '.bk tbody td,.bk tbody th{padding:11px 12px;border-bottom:1px solid #e8ece9;text-align:left;vertical-align:top}.bk tbody th{font-weight:600}'
        + '.bk small{display:block;font-weight:400;color:#6b7280;font-size:12px;margin-top:2px}'
        + '.bk td:last-child,.bk thead th:last-child{text-align:right}.bk .no{width:36px}.bk td.no{color:#9ca3af}.bk td.none{text-align:left;color:#6b7280}'
        + '.bk tfoot th,.bk tfoot td{padding:13px 12px;border-top:2px solid #1a5c3a}.bk tfoot th{text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em}.bk tfoot td{text-align:right;font-size:16px;font-weight:700;color:#1a5c3a}'
        + '.spacer{flex:1;min-height:40px}'
        + '.sigs{display:grid;grid-template-columns:minmax(0,320px);justify-content:center;text-align:center}.line{border-bottom:1px solid #17251d;height:48px;box-sizing:border-box;padding-bottom:3px;display:flex;align-items:flex-end;justify-content:center;font-weight:700}.cap{display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-top:6px}'
        + '.foot{margin-top:28px;padding-top:10px;border-top:1px solid #e8ece9;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af}'
        // Tighter on paper than on screen, so the whole request fits one A4 sheet.
        + '@media print{body{background:#fff}.toolbar{display:none}.page{margin:0 auto;box-shadow:none;min-height:auto;padding:0}'
        + '.parties{margin-top:12px}.lead{margin-top:10px}.req{margin-top:10px;padding:10px 14px}.sec{margin-top:12px}table{margin-top:4px}'
        + '.bk tbody td,.bk tbody th{padding:4px 12px}.bk small{margin-top:0}.bk tfoot th,.bk tfoot td{padding:7px 12px}';

    function requestPageHTML(state, request) {
        const project = (state && state.project) || {};
        const rows = ((state && state.payments) || []).filter((p) => cents(p.amount) > 0);
        const total = rows.reduce((sum, p) => sum + cents(p.amount), 0) / 100;
        const now = request.now || new Date();
        const issued = now.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
        // Reference, like Project Control's FLD-xxxxxx: PM- and the first six characters of the project id.
        const ref = project.id ? 'PM-' + String(project.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() : '';
        const clientName = project.client_name || project.client_email || '';
        const clientEmail = project.client_name && project.client_email ? project.client_email : '';
        const letterhead = typeof root.dacsPrintHeader === 'function' ? root.dacsPrintHeader('Billing Request', 'Payments received · All time')
            : '<header><strong>DAC\'S BUILDING DESIGN SERVICES</strong></header>';
        const css = STYLE + (rows.length > 5 ? '.bk small{display:inline;margin-left:8px}' : '')
            + '.spacer{min-height:14px}.line{height:30px}.foot{margin-top:12px}'
            + '.sigs,.foot,.bk tr{break-inside:avoid}@page{size:A4 portrait;margin:10mm}}';
        const when = (p) => [BR().formatDate(p.date), p.reference ? 'Ref. ' + p.reference : ''].filter(Boolean).join(' · ');
        const body = rows.length
            ? rows.map((p, i) => '<tr><td class="no">' + String(i + 1).padStart(2, '0') + '</td><th scope="row">Payment received<small>'
                + esc(when(p)) + '</small></th><td>' + esc(money(p.amount)) + '</td></tr>').join('')
            : '<tr><td colspan="3" class="none">No payments received yet</td></tr>';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Billing Request</title><style>' + css + '</style></head><body>'
            + '<div class="toolbar"><button type="button" onclick="window.print()">Print / Save PDF</button></div>'
            + '<div class="page">' + letterhead
            + '<div class="titlebar"><div><h1>Billing Request</h1><div class="sub">Payments received</div></div>'
            + '<div class="meta">' + (ref ? '<span>Reference</span><span>' + esc(ref) + '</span>' : '')
            + '<span>Date issued</span><span>' + esc(issued) + '</span></div></div>'
            + '<div class="parties">' + (clientName ? '<div><div class="eb">Requested from</div><div class="n">' + esc(clientName) + '</div>' + (clientEmail ? '<div class="d">' + esc(clientEmail) + '</div>' : '') + '</div>' : '')
            + '<div><div class="eb">Project</div><div class="n">' + esc(project.name) + '</div>' + (project.address ? '<div class="d">' + esc(project.address) + '</div>' : '') + '</div></div>'
            + '<p class="lead">Please release the next billing funds to support continued project work. The breakdown below lists each payment received so far.</p>'
            + '<div class="req"><div><div class="eb g">Requested this billing</div><div class="basis">' + esc(request.percent) + '% of Project Budget</div></div><div class="amt">' + esc(money(request.amount)) + '</div></div>'
            + '<div class="sec eb g">Payments received</div>'
            + '<table class="bk"><thead><tr><th scope="col" class="no">No.</th><th scope="col">Payment</th><th scope="col">Amount</th></tr></thead><tbody>'
            + body
            + '</tbody><tfoot><tr><th scope="row" colspan="2">Total Received</th><td>' + esc(money(total)) + '</td></tr></tfoot></table>'
            + '<div class="spacer"></div>'
            + '<div class="sigs"><div><div class="eb">Prepared by</div><div class="line">' + esc(request.preparedBy || '') + '</div><div class="cap"><span>Signature over printed name</span><span>Date</span></div></div></div>'
            + '<div class="foot"><span>DAC\'S Building Design Services · Billing Request</span><span>Generated ' + esc(now.toLocaleString('en-PH')) + '</span></div>'
            + '</div></body></html>';
    }

    function refusalText(error) {
        const text = String((error && error.message) || error || '');
        if (/\bNOT_PAID\b/.test(text)) return NOT_PAID;
        if ((error && error.code === 'PGRST202') || /\bpmar_[a-z_]+|pm_billing_rec|proof_url/.test(text)) return NEEDS_0116;
        return BR().refusalText(error);
    }

    // ── Talking to the server ──────────────────────────────

    const isOwner = () => root.currentUserRole === 'owner';

    async function rpc(name, args) {
        const client = root.sbClient;
        if (!client) throw new Error('Not connected. Please refresh.');
        const { data, error } = await client.rpc(name, args);
        if (error) throw new Error(refusalText(error));
        return data;
    }
    function writeDoc(popup, html) {
        if (!popup || popup.closed) return;
        popup.document.open();
        popup.document.write(html);
        popup.document.close();
    }
    async function guarded(popup, work) {
        try { return await work(); }
        catch (error) { if (popup && !popup.closed) popup.close(); throw error; }
    }

    const actions = {
        state: (projectId) => rpc('pmar_state', { p_project: projectId }),
        issue(popup, paymentId, receivedFrom, receivedBy) {
            return guarded(popup, async () => {
                const receipt = await rpc('pmar_issue', { p_payment: paymentId, p_received_from: receivedFrom, p_received_by: receivedBy });
                writeDoc(popup, BR().receiptHTML(receipt));
                return receipt;
            });
        },
        reissue(popup, receiptId, reason, receivedFrom, receivedBy) {
            return guarded(popup, async () => {
                const receipt = await rpc('pmar_reissue', { p_receipt: receiptId, p_reason: reason, p_received_from: receivedFrom, p_received_by: receivedBy });
                writeDoc(popup, BR().receiptHTML(receipt));
                return receipt;
            });
        },
    };

    const OPS = {
        issue: (...args) => actions.issue(...args),
        reissue: (...args) => actions.reissue(...args),
        amountLabel: 'Amount paid',
        noAmountText: 'This payment is no longer marked paid, so no new receipt can be issued.',
    };

    function notify(message) {
        if (typeof root.showExpNotif === 'function') root.showExpNotif(message, 'error');
        else root.alert(message);
    }

    // ── What the Payment section's buttons call ────────────

    async function openReceipt(projectId, paymentId) {
        if (!isOwner()) return;
        let state;
        try { state = await actions.state(projectId); }
        catch (error) { notify(error.message); return; }
        if (!isOwner()) return;
        const plan = planFor(state, paymentId);
        if (plan.kind === 'not_paid') BR().messageDialog('Acknowledgement Receipt', '', NOT_PAID);
        else BR().openReceiptDialog(state, plan, OPS);
    }

    // Runs inside the click that confirmed the percentage, so the browser allows the window.
    async function printRequest(projectId, percent, preparedBy) {
        if (!isOwner()) return;
        const popup = root.open('', '_blank');
        if (!popup) { root.alert('Please allow pop-ups to open the billing request.'); return; }
        popup.document.write('<p>Preparing billing request…</p>');
        popup.document.close();
        try {
            const fresh = await actions.state(projectId);
            if (!isOwner()) throw new Error('Owner access is required.');
            const budget = num(fresh && fresh.project && fresh.project.budget);
            if (!(budget > 0)) throw new Error('The project has no Project Budget.');
            if (popup.closed) return;
            writeDoc(popup, requestPageHTML(fresh, { percent, amount: BR().requestAmount(budget, percent), preparedBy, now: new Date() }));
        } catch (error) {
            popup.close();
            root.alert(NOT_PREPARED);
            if (root.console) root.console.error('Billing request', error);
        }
    }

    async function openBillingRequest(projectId) {
        if (!isOwner()) return;
        let state;
        try { state = await actions.state(projectId); }
        catch (error) { root.alert(NOT_PREPARED); return; }
        if (!isOwner()) return;
        const project = (state && state.project) || {};
        const budget = num(project.budget);
        if (!(budget > 0)) { root.alert(NO_BUDGET); return; }
        BR().askRequestPercent({
            projectName: project.name || '', contract: budget, allocated: num(state.total_received),
            contractLabel: 'Project Budget', allocatedLabel: 'Total received so far', showRemaining: true, warning: requestWarning,
            onContinue: (percent, preparedBy) => printRequest(projectId, percent, preparedBy),
        });
    }

    root.PMBillingDocs = { paidAmount, isPaidRow, planFor, requestWarning, requestPageHTML, refusalText, actions,
        openReceipt, openBillingRequest };
})(typeof window !== 'undefined' ? window : globalThis);
