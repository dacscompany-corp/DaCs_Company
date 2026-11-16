// ═════════════════════════════════════════════════
// Billing Periods — Acknowledgement Receipts (migration 0114).
//
// Two documents, both owner-only, both opened from Project Control → Billing
// Periods:
//   · Acknowledgement Receipt: one per client billing period. Saved with a
//     permanent AR-YYYYMM-NNN number. The amount is ALWAYS that period's Fund
//     Allocated, and the server reads it: nothing here sends an amount. If
//     Fund Allocated changes, the old receipt is voided with a reason, stays on
//     record, and a new one is issued with a new number.
//   · Overall Billing Acknowledgement: one grand total for the project's client
//     billings. Not saved and not numbered; it always shows the current total.
//
// The Billing Request page is a different document and lives in
// portal-app.compiled.js (_pcBillingRequestHTML). Only its "set the percentage"
// window and the one formula for the requested amount are here.
//
// OUTSIDE THE MONEY MODEL. Nothing here writes an expense, payroll row, invoice,
// payment, budget or billing period, and nothing may feed a receipt into Spent /
// Earned / Profit. This file is the ONLY caller of the bar_* server functions.
//
// Works in a browser (window.BillingReceipts); tests load it in a sandbox with
// a pretend window (tests/billing-receipts.test.js).
// ═════════════════════════════════════════════════
(function (root) {
    'use strict';

    const HOUSE_NAME = "DAC'S Building Design Services";

    // ── Pure half ──────────────────────────────────────────

    const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g,
        (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
    const cents = (value) => Math.round(num(value) * 100);
    const money = (value) => '₱' + num(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // A date key is built from local parts: the Philippines is UTC+8, so a UTC
    // key rolls back a day.
    function todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function formatDate(key) {
        const parts = String(key || '').split('-').map(Number);
        if (parts.length < 3 || parts.some((p) => !p)) return String(key || '');
        return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function paymentLines(pd) {
        const p = pd || {};
        if (p.method === 'gcash') {
            if (!p.gcashNumber && !p.gcashName) return [];
            return [['Payment Via', 'GCash'], ['GCash No.', p.gcashNumber || '—'], ['Account Name', p.gcashName || '—']];
        }
        if (!p.bank && !p.accountNo && !p.accountName) return [];
        return [['Payment Via', 'Bank Transfer'], ['Bank', p.bank || '—'], ['Account No.', p.accountNo || '—'],
                ['Account Name', p.accountName || '—'], ['Branch', p.branch || '—']];
    }
    function paymentSummary(pd) {
        const p = pd || {};
        const lines = paymentLines(p);
        if (!lines.length) return '';
        return p.method === 'gcash' ? 'GCash ' + (p.gcashNumber || '') : 'Bank Transfer, ' + (p.bank || '') + ' ' + (p.accountNo || '');
    }

    const STYLE = '*{box-sizing:border-box}'
        + "body{margin:0;background:#fff;color:#1c1c1a;font:13px/1.5 'IBM Plex Sans',Arial,Helvetica,sans-serif}"
        + '.page{position:relative;max-width:210mm;margin:0 auto;padding:16mm 16mm 14mm}'
        + '.noprint{margin:12px;padding:8px 16px;border:1px solid #1a5c3a;border-radius:8px;background:#1a5c3a;color:#fff;font:inherit;font-weight:600;cursor:pointer}'
        + '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:20px;border-bottom:3px solid #1c1c1a}'
        + '.logo{display:block;height:92px;width:auto;object-fit:contain}'
        + '.company{margin:10px 0 0;font-size:19px;line-height:1.25;letter-spacing:.03em;text-transform:uppercase}'
        + '.company-sub{margin-top:4px;color:#666;font-size:12px}'
        + '.heading{text-align:right;max-width:55%}'
        + '.heading h1{margin:0 0 12px;color:#14704a;font-size:23px;line-height:1.25;letter-spacing:.16em}'
        + '.meta{color:#555;line-height:1.9}.meta strong{color:#1c1c1a}'
        + '.party{padding:20px 0;border-bottom:1px solid #e4e4de}'
        + '.lbl{color:#8a8a82;font-size:10.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}'
        + '.party .name{margin-top:6px;font-size:16px;font-weight:700}'
        + 'table{width:100%;margin-top:22px;border-collapse:collapse}'
        + 'th{padding:11px 12px;background:#f7f7f4;border-bottom:1px solid #e4e4de;color:#8a8a82;font-size:10.5px;font-weight:600;letter-spacing:.1em;text-align:left;text-transform:uppercase;white-space:nowrap}'
        + 'td{padding:12px;border-bottom:1px solid #eeeeea}'
        + '.num{text-align:right}.mid{text-align:center}.strong{font-weight:700}'
        + '.subtotal{display:flex;justify-content:space-between;gap:20px;width:48%;margin:16px 0 0 auto;padding:0 16px;color:#555}.subtotal strong{color:#1c1c1a}.subtotal+.total{margin-top:8px}'
        + '.total{display:flex;justify-content:space-between;align-items:center;gap:20px;width:48%;margin:18px 0 0 auto;padding:14px 16px;border-radius:9px;background:#e7f2ec;color:#14704a;font-weight:700}'
        + '.total .label{font-size:15px;line-height:1.25;text-transform:uppercase}.total .value{font-size:18px;white-space:nowrap}'
        + '.pay{margin-top:24px;padding:16px 20px;border:1px solid #e8e8e2;border-radius:10px;background:#f9f9f6}'
        + '.pay-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-top:10px}.pay-grid span{color:#666}'
        + '.sign{width:250px;margin:64px auto 0;text-align:center}'
        + '.sign .stamp{display:block;height:42px;width:auto;max-width:85%;margin:0 auto 2px;object-fit:contain}'
        + '.sign .who{font-weight:700}.sign .org{color:#666;font-size:11.5px}'
        + '.sign .line{margin-top:6px;border-top:2px solid #1c1c1a;padding-top:6px;color:#666}'
        + '.void-banner{margin-top:18px;padding:12px 16px;border:2px solid #b4453a;border-radius:9px;color:#b4453a;font-weight:700}'
        + '.void-mark{position:absolute;top:38%;left:0;right:0;text-align:center;color:rgba(180,69,58,.16);font-size:130px;font-weight:800;letter-spacing:.1em;transform:rotate(-24deg);pointer-events:none}'
        // Tighter on paper, so a full list of billings still fits one A4 sheet.
        + '@media print{.noprint{display:none}.page{padding:0}.top{padding-bottom:14px}.logo{height:72px}.party{padding:14px 0}'
        + 'td{padding:8px 12px}.pay{margin-top:16px}.sign{margin-top:36px}.sign,.total,.pay,tr{break-inside:avoid}@page{size:A4 portrait;margin:12mm}}';

    function pageHTML(o) {
        const business = o.business || {};
        const name = String(business.name || '').trim() || HOUSE_NAME;
        const sub = [business.address, business.tin ? 'TIN: ' + business.tin : ''].filter(Boolean).join(' · ');
        const payment = paymentLines(o.payment);
        const logo = root.location ? root.location.origin + '/assets/images/DACS-TRANSPARENT.png' : '';
        // DAC's e-signature, the same stamp the Invoice module's "e-signature" option prints.
        const stamp = root.location ? root.location.origin + '/assets/images/dacs-signature.png' : '';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + esc(o.windowTitle) + '</title>'
            + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&amp;display=swap">'
            + '<style>' + STYLE + '</style></head><body>'
            + '<button type="button" class="noprint" onclick="window.print()">Print / Save PDF</button>'
            + '<div class="page">' + (o.isVoid ? '<div class="void-mark">VOID</div>' : '')
            + '<div class="top"><div>' + (logo ? '<img class="logo" alt="" src="' + esc(logo) + '" onerror="this.style.display=\'none\'">' : '')
            + '<h2 class="company">' + esc(name) + '</h2>' + (sub ? '<div class="company-sub">' + esc(sub) + '</div>' : '') + '</div>'
            + '<div class="heading"><h1>' + esc(o.heading) + '</h1><div class="meta">' + o.metaHtml + '</div></div></div>'
            + (o.isVoid ? '<div class="void-banner">VOID. Reason: ' + esc(o.voidReason || '') + '</div>' : '')
            + '<div class="party"><div class="lbl">Received From</div><div class="name">' + esc(o.receivedFrom) + '</div></div>'
            + o.tableHtml
            + (o.subtotalLabel ? '<div class="subtotal"><span>' + esc(o.subtotalLabel) + '</span><strong>' + esc(money(o.total)) + '</strong></div>' : '')
            + '<div class="total"><div class="label">' + esc(o.totalLabel) + '</div><div class="value">' + esc(money(o.total)) + '</div></div>'
            + (payment.length ? '<div class="pay"><div class="lbl">Payment Details</div><div class="pay-grid">'
                + payment.map((row) => '<div><span>' + esc(row[0]) + ':</span> <strong>' + esc(row[1]) + '</strong></div>').join('') + '</div></div>' : '')
            + '<div class="sign">' + (stamp ? '<img class="stamp" alt="" src="' + esc(stamp) + '" onerror="this.style.display=\'none\'">' : '') + '<div class="who">' + esc(o.receivedBy) + '</div><div class="org">' + esc(name) + '</div><div class="line">Received by</div></div>'
            + '</div></body></html>';
    }

    function receiptHTML(r) {
        const amount = esc(money(r.amount));
        return pageHTML({
            windowTitle: 'Acknowledgement Receipt ' + r.receipt_no,
            heading: 'ACKNOWLEDGEMENT RECEIPT',
            metaHtml: 'Acknowledgement No: <strong>' + esc(r.receipt_no) + '</strong><br>Date: <strong>' + esc(formatDate(r.issued_on)) + '</strong>',
            business: r.business, payment: r.payment_details, receivedFrom: r.received_from, receivedBy: r.received_by,
            isVoid: !!r.voided_at, voidReason: r.void_reason,
            tableHtml: '<table><thead><tr><th style="width:36px">#</th><th>Item Description / Service</th><th class="mid" style="width:60px">Qty</th>'
                + '<th class="num" style="width:130px">Unit Price</th><th class="num" style="width:130px">Amount</th></tr></thead>'
                + '<tbody><tr><td>1</td><td>' + esc(r.billing_label) + '</td><td class="mid">1</td><td class="num">' + amount + '</td><td class="num strong">' + amount + '</td></tr></tbody></table>',
            totalLabel: 'Full Payment Amount', total: r.amount
        });
    }

    // The server's billing labels end in "(Month Year)", and progress billings carry their number:
    // that is the date order the page lists them in.
    const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    function billingOrder(label) {
        const text = String(label || '');
        const when = text.match(/\((\w+) (\d{4})\)$/);
        const number = text.match(/Progress Billing (\d+)/);
        const month = when ? MONTH_NAMES.indexOf(when[1].toLowerCase()) : -1;
        return [when ? Number(when[2]) : 9999, month < 0 ? 99 : month, number ? Number(number[1]) : 0];
    }
    const byBillingDate = (a, b) => {
        const x = billingOrder(a.label), y = billingOrder(b.label);
        return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    };

    // Every client billing that has Fund Allocated, laid out like the invoice, then the total.
    function overallHTML(state, receivedFrom, receivedBy, dateKey) {
        const projectName = (state.folder && state.folder.name) || '';
        const rows = (state.periods || []).filter((p) => cents(p.amount) > 0).slice().sort(byBillingDate);
        const total = rows.reduce((sum, p) => sum + cents(p.amount), 0) / 100;
        return pageHTML({
            windowTitle: 'Proof of Payments',
            heading: 'PROOF OF PAYMENTS',
            metaHtml: (projectName ? 'Project: <strong>' + esc(projectName) + '</strong><br>' : '') + 'Date: <strong>' + esc(formatDate(dateKey)) + '</strong>',
            business: state.business, payment: state.payment_details, receivedFrom, receivedBy,
            tableHtml: '<table><thead><tr><th style="width:36px">#</th><th>Item Description / Service</th><th class="mid" style="width:56px">Qty</th>'
                + '<th class="num" style="width:130px">Unit Price</th><th class="num" style="width:140px">Amount</th></tr></thead><tbody>'
                + rows.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(p.label) + '</td><td class="mid">1</td><td class="num">' + esc(money(p.amount))
                    + '</td><td class="num strong">' + esc(money(p.amount)) + '</td></tr>').join('')
                + '</tbody></table>',
            subtotalLabel: 'Total Billings', totalLabel: 'Total Received', total
        });
    }

    // What pressing a billing's button should offer.
    function planFor(state, periodId) {
        const period = (state.periods || []).find((p) => p.id === periodId) || null;
        const own = (state.receipts || []).filter((r) => r.period_id === periodId);
        const live = own.find((r) => !r.voided_at) || null;
        const voided = own.filter((r) => r.voided_at);
        if (!period) return { kind: 'unavailable', live, voided };
        const amount = num(period.amount);
        if (live) return { kind: cents(live.amount) === cents(amount) ? 'issued' : 'changed', period, live, voided, amount };
        if (cents(amount) <= 0) return { kind: 'no_fund', period, voided };
        return { kind: 'new', period, voided, amount };
    }

    // ── Billing Request: the percentage of the contract being requested ──
    function requestAmount(contract, percent) {
        return Math.round(num(contract) * num(percent)) / 100;
    }
    function validPercent(typed) {
        const text = String(typed == null ? '' : typed).trim();
        if (!/^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
        const value = Number(text);
        return value > 0 && value <= 100 ? value : null;
    }
    function requestWarning(contract, allocated, amount) {
        const left = cents(contract) - cents(allocated);
        if (cents(amount) <= left) return '';
        if (left <= 0) return 'This project has already billed its full contract, so this request goes over it. You can still continue.';
        return 'This request is over what is left of the contract (' + money(left / 100) + '). You can still continue.';
    }

    // The Prepared by name is kept in this browser only, so it is typed once.
    const PREPARED_BY_KEY = 'dacs.billingRequest.preparedBy';
    function loadPreparedBy() {
        try { return (root.localStorage && root.localStorage.getItem(PREPARED_BY_KEY)) || ''; }
        catch (error) { return ''; }
    }
    function savePreparedBy(name) {
        const value = String(name == null ? '' : name).trim();
        try {
            if (!root.localStorage) return;
            if (value) root.localStorage.setItem(PREPARED_BY_KEY, value);
            else root.localStorage.removeItem(PREPARED_BY_KEY);
        } catch (error) { /* a browser that blocks storage just asks again next time */ }
    }

    const MESSAGES = {
        NOT_SIGNED_IN: 'Please sign in again.',
        PROFILE_MISSING: 'Your account could not be found. Please sign in again.',
        INACTIVE: 'This account is switched off.',
        OWNER_ONLY: 'Only owner accounts can do this.',
        NOT_FOUND: 'That billing or project is no longer available. Please refresh.',
        COVER_PERIOD: 'Cover periods do not get an Acknowledgement Receipt.',
        NO_FUND_ALLOCATED: 'This billing has no Fund Allocated yet, so there is nothing to acknowledge.',
        NAME_REQUIRED: 'Please fill in both Received from and Received by.',
        NAME_TOO_LONG: 'That name is too long. Please keep it under 200 characters.',
        REASON_REQUIRED: 'Please write a short reason first.',
        REASON_TOO_LONG: 'That reason is too long. Please keep it under 500 characters.',
        ALREADY_VOID: 'This receipt was already voided. Please press the button again to see the current one.',
    };
    function refusalText(error) {
        const text = String((error && error.message) || error || '');
        const hit = text.match(/\b(NOT_SIGNED_IN|PROFILE_MISSING|INACTIVE|OWNER_ONLY|NOT_FOUND|COVER_PERIOD|NO_FUND_ALLOCATED|NAME_REQUIRED|NAME_TOO_LONG|REASON_REQUIRED|REASON_TOO_LONG|ALREADY_VOID)\b/);
        if (hit) return MESSAGES[hit[1]];
        if ((error && error.code === 'PGRST202') || /\bbar_[a-z_]+\b|billing_receipt/.test(text)) {
            return 'Acknowledgement Receipts need database update 0114 applied first.';
        }
        return 'Something went wrong: ' + (text || 'unknown error');
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
        // Must run inside the click itself, or the browser blocks the window.
        openWindow() {
            const popup = root.open('', '_blank');
            if (!popup) throw new Error('Please allow pop-ups to open this document.');
            popup.document.write('<p>Preparing…</p>');
            popup.document.close();
            return popup;
        },
        show(popup, receipt) { writeDoc(popup, receiptHTML(receipt)); },
        issue(popup, periodId, receivedFrom, receivedBy) {
            return guarded(popup, async () => {
                const receipt = await rpc('bar_issue', { p_period: periodId, p_received_from: receivedFrom, p_received_by: receivedBy });
                writeDoc(popup, receiptHTML(receipt));
                return receipt;
            });
        },
        reissue(popup, receiptId, reason, receivedFrom, receivedBy) {
            return guarded(popup, async () => {
                const receipt = await rpc('bar_reissue', { p_receipt: receiptId, p_reason: reason, p_received_from: receivedFrom, p_received_by: receivedBy });
                writeDoc(popup, receiptHTML(receipt));
                return receipt;
            });
        },
        overall(popup, state, receivedFrom, receivedBy) {
            return guarded(popup, async () => {
                await rpc('bar_set_parties', { p_folder: state.folder.id, p_received_from: receivedFrom, p_received_by: receivedBy });
                writeDoc(popup, overallHTML(state, receivedFrom, receivedBy, todayKey()));
            });
        },
    };

    // ── Dialogs (the app's small overlay, in the lcm- style) ──

    const OVERLAY_ID = 'brReceiptOverlay';
    const LABEL_STYLE = 'display:block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A1A1A6;margin:14px 0 6px;';
    const INPUT_STYLE = 'width:100%;box-sizing:border-box;border:1.5px solid #D1D5DB;border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;';
    const TEXT_STYLE = 'font-size:13px;line-height:1.6;color:#3A3A3C;';
    const errorLine = '<div data-br-err style="display:none;margin-top:10px;font-size:12.5px;font-weight:600;color:#B4453A;"></div>';

    function notify(message, kind) {
        if (typeof root.showExpNotif === 'function') root.showExpNotif(message, kind);
        else if (kind === 'error') root.alert(message);
    }
    function overlay(title, sub, bodyHtml, footHtml) {
        const old = document.getElementById(OVERLAY_ID);
        if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = OVERLAY_ID;
        ov.className = 'lcm-ov';
        ov.innerHTML = '<div class="lcm-card" style="max-width:480px;">'
            + '<div class="lcm-head"><div><h3 class="lcm-title">' + esc(title) + '</h3>'
            + (sub ? '<div class="lcm-sub">' + esc(sub) + '</div>' : '') + '</div>'
            + '<button type="button" class="lcm-x" data-br-close aria-label="Close">&times;</button></div>'
            + '<div class="lcm-body">' + bodyHtml + '</div>'
            + '<div class="lcm-foot">' + footHtml + '</div></div>';
        document.body.appendChild(ov);
        const close = () => ov.remove();
        ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
        ov.querySelectorAll('[data-br-close]').forEach((b) => b.addEventListener('click', close));
        return { ov, close };
    }
    function showErr(ov, message) {
        const el = ov.querySelector('[data-br-err]');
        if (el) { el.textContent = message; el.style.display = ''; }
    }
    const nameField = (id, label, value, placeholder) => '<label for="' + id + '" style="' + LABEL_STYLE + '">' + esc(label) + '</label>'
        + '<input id="' + id + '" type="text" maxlength="200" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '" style="' + INPUT_STYLE + '">';
    const nameFields = (state) => nameField('brFrom', 'Received from', state.received_from, 'Client or company name')
        + nameField('brBy', 'Received by', state.received_by, 'Name of the person receiving');
    const paymentNote = (state) => {
        const summary = paymentSummary(state.payment_details);
        return '<div style="' + TEXT_STYLE + 'margin-top:14px;">' + (summary
            ? 'Payment details on the page: <b>' + esc(summary) + '</b>. Change them in Acknowledgement Settings.'
            : 'No payment details are saved in Acknowledgement Settings, so none will print.') + '</div>';
    };
    const amountLine = (label, amount) => '<div style="' + TEXT_STYLE + '">' + esc(label) + ': <b style="font-size:16px;">' + esc(money(amount)) + '</b></div>';
    function readNames(ov) {
        const from = String(ov.querySelector('#brFrom').value || '').trim();
        const by = String(ov.querySelector('#brBy').value || '').trim();
        if (!from || !by) { showErr(ov, MESSAGES.NAME_REQUIRED); return null; }
        return { from, by };
    }
    function voidedList(voided) {
        if (!voided || !voided.length) return '';
        return '<div style="' + LABEL_STYLE + '">Voided receipts</div>' + voided.map((r) =>
            '<div style="' + TEXT_STYLE + 'display:flex;justify-content:space-between;gap:10px;align-items:center;padding:4px 0;">'
            + '<span><b>' + esc(r.receipt_no) + '</b> · ' + esc(money(r.amount)) + '<br><span style="color:#6E6E73;">' + esc(r.void_reason) + '</span></span>'
            + '<button type="button" class="lcm-btn" data-br-open="' + esc(r.id) + '">Open</button></div>').join('');
    }
    // Opens the window inside the click, then runs the work; the dialog stays
    // open with the reason if the server refuses.
    function runInWindow(ov, button, close, work) {
        let popup;
        try { popup = actions.openWindow(); } catch (error) { showErr(ov, error.message); return; }
        button.disabled = true;
        Promise.resolve().then(() => work(popup)).then(close).catch((error) => {
            button.disabled = false;
            showErr(ov, error.message);
        });
    }
    function bindVoided(ov, voided) {
        ov.querySelectorAll('[data-br-open]').forEach((button) => button.addEventListener('click', () => {
            const receipt = voided.find((r) => r.id === button.getAttribute('data-br-open'));
            let popup;
            try { popup = actions.openWindow(); } catch (error) { showErr(ov, error.message); return; }
            actions.show(popup, receipt);
        }));
    }
    function messageDialog(title, sub, text) {
        overlay(title, sub, '<div style="' + TEXT_STYLE + '">' + esc(text) + '</div>', '<button type="button" class="lcm-btn" data-br-close>Close</button>');
    }

    function issueDialog(state, plan) {
        const { ov, close } = overlay('Acknowledgement Receipt', plan.period.label,
            amountLine('Fund Allocated', plan.amount) + nameFields(state) + paymentNote(state) + voidedList(plan.voided) + errorLine,
            '<button type="button" class="lcm-btn" data-br-close>Cancel</button>'
            + '<button type="button" class="lcm-btn primary" id="brGo">Issue Receipt</button>');
        bindVoided(ov, plan.voided);
        const go = ov.querySelector('#brGo');
        go.addEventListener('click', () => {
            const names = readNames(ov);
            if (!names) return;
            runInWindow(ov, go, close, async (popup) => {
                const receipt = await actions.issue(popup, plan.period.id, names.from, names.by);
                notify('Receipt ' + receipt.receipt_no + ' issued.', 'success');
            });
        });
    }

    function existingDialog(state, plan) {
        const changed = plan.kind === 'changed';
        const canReissue = cents(plan.amount) > 0;
        const note = changed
            ? '<div style="' + TEXT_STYLE + 'margin-top:12px;color:#8A5A00;font-weight:600;">This receipt says ' + esc(money(plan.live.amount)) + ', but Fund Allocated is now ' + esc(money(plan.amount)) + '. '
              + (canReissue ? 'Void it and issue a new one to match.' : 'A new receipt can be issued once this billing has Fund Allocated.') + '</div>'
            : '';
        const { ov, close } = overlay('Acknowledgement Receipt', plan.period.label,
            '<div style="' + TEXT_STYLE + '"><b>' + esc(plan.live.receipt_no) + '</b> · ' + esc(formatDate(plan.live.issued_on)) + '<br>Received from ' + esc(plan.live.received_from) + '</div>'
            + '<div style="margin-top:10px;">' + amountLine('Amount', plan.live.amount) + '</div>' + note + voidedList(plan.voided) + errorLine,
            (canReissue ? '<button type="button" class="lcm-btn' + (changed ? ' primary' : '') + '" id="brReissue">Void and Re-issue</button>' : '')
            + '<button type="button" class="lcm-btn' + (changed ? '' : ' primary') + '" id="brOpen">' + (changed ? 'Open Old Receipt' : 'Open Receipt') + '</button>');
        bindVoided(ov, plan.voided);
        ov.querySelector('#brOpen').addEventListener('click', () => {
            let popup;
            try { popup = actions.openWindow(); } catch (error) { showErr(ov, error.message); return; }
            actions.show(popup, plan.live);
            close();
        });
        const reissue = ov.querySelector('#brReissue');
        if (reissue) reissue.addEventListener('click', () => reissueDialog(state, plan));
    }

    function reissueDialog(state, plan) {
        const { ov, close } = overlay('Void and Re-issue', plan.live.receipt_no + ' · ' + plan.period.label,
            amountLine('New receipt amount (Fund Allocated)', plan.amount)
            + '<label for="brReason" style="' + LABEL_STYLE + '">Reason <span style="color:#B4453A;">(required)</span></label>'
            + '<textarea id="brReason" rows="2" maxlength="500" placeholder="Why is this receipt being replaced?" style="' + INPUT_STYLE + '"></textarea>'
            + nameFields({ received_from: plan.live.received_from, received_by: plan.live.received_by })
            + '<div style="' + TEXT_STYLE + 'margin-top:14px;">The old receipt stays on record, marked void. The new one gets a new number.</div>' + errorLine,
            '<button type="button" class="lcm-btn" data-br-close>Cancel</button>'
            + '<button type="button" class="lcm-btn primary" id="brGo">Void and Issue New Receipt</button>');
        const go = ov.querySelector('#brGo');
        go.addEventListener('click', () => {
            const reason = String(ov.querySelector('#brReason').value || '').trim();
            if (!reason) { showErr(ov, MESSAGES.REASON_REQUIRED); return; }
            const names = readNames(ov);
            if (!names) return;
            runInWindow(ov, go, close, async (popup) => {
                const receipt = await actions.reissue(popup, plan.live.id, reason, names.from, names.by);
                notify('Receipt ' + receipt.receipt_no + ' issued.', 'success');
            });
        });
    }

    // ── What the Billing Periods buttons call ──────────────

    async function loadState(project) {
        if (!isOwner()) return null;
        let state;
        try { state = await rpc('bar_state', { p_folder: project.id }); }
        catch (error) { notify(error.message, 'error'); return null; }
        return isOwner() ? state : null;
    }

    async function openReceipt(project, periodId) {
        const state = await loadState(project);
        if (!state) return;
        const plan = planFor(state, periodId);
        if (plan.kind === 'new') issueDialog(state, plan);
        else if (plan.kind === 'issued' || plan.kind === 'changed') existingDialog(state, plan);
        else if (plan.kind === 'no_fund') messageDialog('Acknowledgement Receipt', plan.period.label, MESSAGES.NO_FUND_ALLOCATED);
        else messageDialog('Acknowledgement Receipt', '', 'Acknowledgement Receipts are only for client billing periods.');
    }

    async function openOverall(project) {
        const state = await loadState(project);
        if (!state) return;
        const name = state.folder.name || '';
        if (cents(state.total_received) <= 0) {
            messageDialog('Overall Billing Acknowledgement', name, 'None of this project’s client billings has Fund Allocated yet.');
            return;
        }
        const { ov, close } = overlay('Overall Billing Acknowledgement', name,
            amountLine('Total received', state.total_received) + nameFields(state) + paymentNote(state) + errorLine,
            '<button type="button" class="lcm-btn" data-br-close>Cancel</button>'
            + '<button type="button" class="lcm-btn primary" id="brGo">Open Acknowledgement</button>');
        const go = ov.querySelector('#brGo');
        go.addEventListener('click', () => {
            const names = readNames(ov);
            if (!names) return;
            runInWindow(ov, go, close, (popup) => actions.overall(popup, state, names.from, names.by));
        });
    }

    // Billing Request: set the percentage first. onContinue runs inside the click,
    // so the browser allows the page to open.
    function askRequestPercent(o) {
        const { ov, close } = overlay('Billing Request', o.projectName,
            amountLine('Project Budget (contract)', o.contract)
            + '<div style="margin-top:6px;">' + amountLine('Total Allocated so far', o.allocated) + '</div>'
            + '<label for="brPct" style="' + LABEL_STYLE + '">Percentage to request</label>'
            + '<input id="brPct" type="text" inputmode="decimal" placeholder="For example 10" style="' + INPUT_STYLE + '">'
            + '<div data-br-preview style="' + TEXT_STYLE + 'margin-top:12px;font-weight:600;"></div>'
            + '<div data-br-warn style="' + TEXT_STYLE + 'margin-top:8px;color:#8A5A00;font-weight:600;"></div>'
            + '<label for="brPreparedBy" style="' + LABEL_STYLE + '">Prepared by <span style="font-weight:500;text-transform:none;letter-spacing:0;">(optional)</span></label>'
            + '<input id="brPreparedBy" type="text" maxlength="200" value="' + esc(loadPreparedBy()) + '" placeholder="Name to print on the signature line" style="' + INPUT_STYLE + '">'
            + errorLine,
            '<button type="button" class="lcm-btn" data-br-close>Cancel</button>'
            + '<button type="button" class="lcm-btn primary" id="brGo">Open Billing Request</button>');
        const input = ov.querySelector('#brPct');
        const preview = ov.querySelector('[data-br-preview]');
        const warn = ov.querySelector('[data-br-warn]');
        input.addEventListener('input', () => {
            const percent = validPercent(input.value);
            const amount = percent ? requestAmount(o.contract, percent) : 0;
            preview.textContent = percent ? 'Requested amount: ' + money(amount) : '';
            warn.textContent = percent ? requestWarning(o.contract, o.allocated, amount) : '';
        });
        ov.querySelector('#brGo').addEventListener('click', () => {
            const percent = validPercent(input.value);
            if (!percent) { showErr(ov, 'Enter a percentage from 0.01 to 100, with up to 2 decimals.'); return; }
            const preparedBy = String(ov.querySelector('#brPreparedBy').value || '').trim();
            savePreparedBy(preparedBy);
            close();
            o.onContinue(percent, preparedBy);
        });
        input.focus();
    }

    root.BillingReceipts = { receiptHTML, overallHTML, planFor, refusalText, formatDate, paymentLines, actions, openReceipt, openOverall,
        requestAmount, validPercent, requestWarning, askRequestPercent, loadPreparedBy, savePreparedBy };
})(typeof window !== 'undefined' ? window : globalThis);
