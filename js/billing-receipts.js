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
        // A bank prints the owner's way (sample of 20 Nov 2026): the bank's name, the transfer
        // account number and the account name. No Branch line.
        return [['Payment Via', p.bank || 'Bank Transfer'], ['Bank Transfer No.', p.accountNo || '—'], ['Account Name', p.accountName || '—']];
    }
    function paymentSummary(pd) {
        const p = pd || {};
        const lines = paymentLines(p);
        if (!lines.length) return '';
        return p.method === 'gcash' ? 'GCash ' + (p.gcashNumber || '') : 'Bank Transfer, ' + (p.bank || '') + ' ' + (p.accountNo || '');
    }

    // An amount in words, as a receipt states it: "One Hundred Sixty-Nine Thousand Pesos Only",
    // centavos as "and 50/100".
    const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
        'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function underThousand(n) {
        const parts = [];
        if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
        if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); }
        else if (n > 0) parts.push(ONES[n]);
        return parts.join(' ');
    }
    function pesoWords(amount) {
        const total = Math.abs(cents(amount));
        let pesos = Math.floor(total / 100);
        const centavos = total % 100;
        const groups = [];
        ['', ' Thousand', ' Million', ' Billion'].forEach((scale) => {
            const chunk = pesos % 1000;
            if (chunk) groups.unshift(underThousand(chunk) + scale);
            pesos = Math.floor(pesos / 1000);
        });
        const whole = Math.floor(total / 100);
        return (groups.join(' ') || 'Zero') + (whole === 1 ? ' Peso' : ' Pesos')
            + (centavos ? ' and ' + String(centavos).padStart(2, '0') + '/100' : '') + ' Only';
    }

    // The automatic item line (0117 / 0116) carries the payment date and reference
    // ("<billing> · Payment received (Nov 20, 2026) · Ref. X"). Layout C (owner, 22 Nov
    // 2026) prints those as plain rows under Payment Details, so on the PAGE only they
    // are lifted out of the line. A line the owner typed differently prints as typed,
    // and nothing saved changes.
    const AUTO_LINE = /^(?:(.*?) · )?Payment received \(([A-Z][a-z]{2} \d{1,2}, \d{4})\)(?: · Ref\. (.+))?$/;
    function splitLine(label, paidOn, reference) {
        const text = String(label || '');
        const m = text.match(AUTO_LINE);
        const ref = String(reference == null ? '' : reference).trim();
        const date = paidOn ? formatDate(paidOn) : '';
        if (!m || (date && m[2] !== date) || (ref && (m[3] || '') !== ref)) {
            return { item: text, paidText: date, reference: ref };
        }
        return { item: m[1] || 'Payment received', paidText: m[2], reference: m[3] || '' };
    }

    const STYLE = '*{box-sizing:border-box}'
        + "body{margin:0;background:#fff;color:#1a1d1b;font:12.5px/1.55 Inter,Arial,Helvetica,sans-serif}"
        + '.page{position:relative;max-width:210mm;margin:0 auto;padding:15mm 17mm 12mm;display:flex;flex-direction:column;min-height:297mm}'
        + '.noprint{margin:12px;padding:8px 16px;border:1px solid #1a5c3a;border-radius:8px;background:#1a5c3a;color:#fff;font:inherit;font-weight:600;cursor:pointer}'
        // Logo big on the left, company name and address beside it (owner, 22 Nov 2026).
        + '.company-block{display:flex;align-items:center;gap:22px;text-align:left}'
        + '.logo{display:block;flex:none;height:120px;width:auto;object-fit:contain}'
        + '.company-text{display:flex;flex-direction:column;gap:4px;min-width:0}'
        + ".company{margin:0;font:800 19px/1.25 Archivo,Inter,Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase}"
        + '.company-sub{color:#565d59;font-size:11.5px}'
        + '.rule{margin-top:18px;border-top:1px solid #1a1d1b;border-bottom:1px solid #1a1d1b;height:4px}'
        + ".heading h1{margin:20px 0 0;text-align:center;color:#1d6b46;font:800 18px/1.3 Archivo,Inter,Arial,sans-serif;letter-spacing:.18em}"
        + '.meta{display:flex;justify-content:space-between;gap:24px;margin-top:16px}.meta span{color:#565d59}'
        + 'table{width:100%;margin-top:20px;border-collapse:collapse}'
        + 'th{padding:8px 10px;border-top:1px solid #1a1d1b;border-bottom:1px solid #1a1d1b;font-size:10px;font-weight:700;letter-spacing:.1em;text-align:left;text-transform:uppercase;white-space:nowrap}'
        + 'td{padding:11px 10px;border-bottom:1px solid #dfe5e1;vertical-align:top}'
        + '.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.mid{text-align:center}.strong{font-weight:700}'
        + '.subtotal,.total{display:flex;justify-content:flex-end;gap:28px;padding:9px 10px 0}.subtotal{color:#565d59}.subtotal strong{color:#1a1d1b}'
        + '.total{font-weight:700}.total .value{min-width:150px;text-align:right;padding-bottom:4px;border-bottom:3px double #1a1d1b;font-variant-numeric:tabular-nums}'
        + '.words{margin-top:8px;color:#565d59;font-size:11px}.words em{color:#1a1d1b}'
        + '.pay{margin-top:26px}'
        + '.lbl{padding-bottom:6px;border-bottom:1px solid #dfe5e1;color:#3f4642;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}'
        + '.pay table{margin-top:0}.pay td{padding:6px 0;border:0}.pay td:first-child{width:170px;color:#565d59}.pay tr:last-child td{border-bottom:1px solid #dfe5e1}'
        + '.spacer{flex:1;min-height:48px}'
        + '.signs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:64px;align-items:end}'
        + '.sign,.payer{text-align:center}'
        + '.sign .stamp{display:block;height:42px;width:auto;max-width:85%;margin:0 auto 2px;object-fit:contain}.payer .blank{height:44px}'
        + '.who{padding-top:6px;border-top:1px solid #1a1d1b;font-weight:700}.sign .stamp+.who{margin-top:0}'
        + '.sign .org{color:#565d59;font-size:10.5px}'
        + '.line{color:#565d59;font-size:10px;letter-spacing:.12em;text-transform:uppercase}'
        + '.foot{margin-top:28px;padding-top:10px;border-top:1px solid #dfe5e1;color:#565d59;font-size:9.5px}'
        + '.void-banner{margin-top:18px;padding:12px 16px;border:2px solid #b4453a;border-radius:9px;color:#b4453a;font-weight:700}'
        + '.void-mark{position:absolute;top:38%;left:0;right:0;text-align:center;color:rgba(180,69,58,.16);font-size:130px;font-weight:800;letter-spacing:.1em;transform:rotate(-24deg);pointer-events:none}'
        // Tighter on paper, so a full list of billings still fits one A4 sheet.
        + '@media print{.noprint{display:none}.page{max-width:none;padding:13mm;min-height:290mm}.logo{height:105px}'
        + 'td{padding:7px 10px}.pay{margin-top:18px}.spacer{min-height:28px}.sign,.total,.pay,tr{break-inside:avoid}@page{size:A4 portrait;margin:0}}'
        // Show / hide the company details and the signature (owner, 20 Nov 2026). The switches never print.
        + '.tools{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin:12px}.tools .noprint{margin:0}.noprint.ghost{background:#fff;color:#1a5c3a}.noprint:disabled{opacity:.6;cursor:wait}'
        + '.tg{display:inline-flex;align-items:center;gap:6px;font-weight:600;cursor:pointer}'
        + 'body.hide-company .company-block{display:none}body.hide-company .rule{margin-top:0}body.hide-sign .sign{display:none}body.hide-sign .signs{display:none}'
        + '@media print{.tools{display:none}}'
        // While Download PDF captures the page: exactly one A4 sheet wide and a hair under one tall.
        + 'body.pdf .page{width:794px;max-width:none;min-height:1118px;padding:48px 60px 40px}';
    // Download PDF (owner, 22 Nov 2026): saves the page itself as a file, so no browser
    // date, title or address is printed on it. html2pdf.js comes off the CDN on first press.
    const DOWNLOAD_SCRIPT = "<script>(function(){var b=document.getElementById('dlPdf');if(!b)return;"
        + "function run(){var page=document.querySelector('.page');document.body.classList.add('pdf');"
        + "return window.html2pdf(page,{margin:0,filename:(document.title||'Acknowledgement Receipt')+'.pdf',"
        + "image:{type:'jpeg',quality:0.98},html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},"
        + "jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}})"
        + ".then(function(){document.body.classList.remove('pdf')},function(e){document.body.classList.remove('pdf');throw e})}"
        + "b.addEventListener('click',function(){b.disabled=true;var t=b.textContent;b.textContent='Preparing…';"
        + "var ready=window.html2pdf?Promise.resolve():new Promise(function(ok,no){var s=document.createElement('script');"
        + "s.src='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';s.onload=ok;"
        + "s.onerror=function(){no(new Error('load'))};document.head.appendChild(s)});"
        + "ready.then(run).catch(function(){alert('The PDF could not be made. Check the internet connection, or use Print / Save PDF.')})"
        + ".then(function(){b.disabled=false;b.textContent=t})});})();</" + "script>";
    // Remembered in this browser only; a browser that blocks storage just starts with both shown.
    const TOGGLE_SCRIPT = "<script>(function(){var k='dacs.receipt.hide',v={};"
        + "try{v=JSON.parse(localStorage.getItem(k)||'{}')||{}}catch(e){v={}}"
        + "[['company','tglCompany'],['sign','tglSign']].forEach(function(p){var el=document.getElementById(p[1]);if(!el)return;"
        + "var hide=!!v[p[0]];el.checked=!hide;document.body.classList.toggle('hide-'+p[0],hide);"
        + "el.addEventListener('change',function(){v[p[0]]=!el.checked;document.body.classList.toggle('hide-'+p[0],!el.checked);"
        + "try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}});});})();</" + "script>";

    // Layout C (owner, 22 Nov 2026): centred letterhead, one receipt sentence, a plain
    // # / Description / Amount table, Payment Details as plain rows (the reference is an
    // ordinary row, never highlighted), then Paid by / Received by.
    const amountCell = (value) => num(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    function pageHTML(o) {
        const business = o.business || {};
        const name = String(business.name || '').trim() || HOUSE_NAME;
        const sub = [business.address, business.tin ? 'TIN: ' + business.tin : ''].filter(Boolean).join(' · ');
        const saved = paymentLines(o.payment);
        // Payment date and Reference No. first, then how it was paid (Payment Via, number, account name).
        const payment = (o.payRows || []).concat(saved.slice(0, 1)).concat(saved.slice(1).reverse());
        const logo = root.location ? root.location.origin + '/assets/images/DACS-TRANSPARENT.png' : '';
        // DAC's e-signature, the same stamp the Invoice module's "e-signature" option prints.
        const stamp = root.location ? root.location.origin + '/assets/images/dacs-signature.png' : '';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + esc(o.windowTitle) + '</title>'
            + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;family=Archivo:wght@800&amp;display=swap">'
            + '<style>' + STYLE + '</style></head><body>'
            + '<div class="tools"><button type="button" class="noprint" id="dlPdf">Download PDF</button>'
            + '<button type="button" class="noprint ghost" onclick="window.print()">Print / Save PDF</button>'
            + '<label class="tg"><input type="checkbox" id="tglCompany" checked> Company details</label>'
            + '<label class="tg"><input type="checkbox" id="tglSign" checked> Signature</label></div>'
            + '<div class="page">' + (o.isVoid ? '<div class="void-mark">VOID</div>' : '')
            + '<div class="company-block">' + (logo ? '<img class="logo" alt="" src="' + esc(logo) + '" onerror="this.style.display=\'none\'">' : '')
            + '<div class="company-text"><h2 class="company">' + esc(name) + '</h2>' + (sub ? '<div class="company-sub">' + esc(sub) + '</div>' : '') + '</div></div>'
            + '<div class="rule"></div>'
            + '<div class="heading"><h1>' + esc(o.heading) + '</h1></div>'
            + '<div class="meta">' + o.meta.map((m) => '<div><span>' + esc(m[0]) + ': </span><strong>' + esc(m[1]) + '</strong></div>').join('') + '</div>'
            + (o.isVoid ? '<div class="void-banner">VOID. Reason: ' + esc(o.voidReason || '') + '</div>' : '')
            + o.tableHtml
            + (o.subtotalLabel ? '<div class="subtotal"><span>' + esc(o.subtotalLabel) + '</span><strong>' + esc(money(o.total)) + '</strong></div>' : '')
            + '<div class="total"><span class="label">' + esc(o.totalLabel) + '</span><span class="value">' + esc(money(o.total)) + '</span></div>'
            + '<div class="words">Amount in words: <em>' + esc(pesoWords(o.total)) + '</em></div>'
            + (payment.length ? '<div class="pay"><div class="lbl">Payment Details</div><table><tbody>'
                + payment.map((row) => '<tr><td>' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td></tr>').join('') + '</tbody></table></div>' : '')
            + '<div class="spacer"></div>'
            + '<div class="signs"><div class="payer"><div class="blank"></div><div class="who">' + esc(o.receivedFrom) + '</div><div class="line">Paid by</div></div>'
            + '<div class="sign">' + (stamp ? '<img class="stamp" alt="" src="' + esc(stamp) + '" onerror="this.style.display=\'none\'">' : '') + '<div class="who">' + esc(o.receivedBy) + '</div><div class="org">' + esc(name) + '</div><div class="line">Received by</div></div></div>'
            + '<div class="foot">This is an Acknowledgement Receipt and is not valid as an Official Receipt.</div>'
            + '</div>' + TOGGLE_SCRIPT + DOWNLOAD_SCRIPT + '</body></html>';
    }

    function receiptHTML(r) {
        const line = splitLine(r.billing_label, r.paid_on, r.payment_reference);
        const payRows = [];
        if (line.paidText) payRows.push(['Payment Date', line.paidText]);
        if (line.reference) payRows.push(['Reference No.', line.reference]);
        return pageHTML({
            windowTitle: 'Acknowledgement Receipt ' + r.receipt_no,
            heading: 'ACKNOWLEDGEMENT RECEIPT',
            meta: [['AR No.', r.receipt_no], ['Date', formatDate(r.issued_on)]],
            business: r.business, payment: r.payment_details, payRows, receivedFrom: r.received_from, receivedBy: r.received_by,
            isVoid: !!r.voided_at, voidReason: r.void_reason,
            tableHtml: '<table><thead><tr><th style="width:36px">#</th><th>Description</th><th class="num" style="width:150px">Amount (PHP)</th></tr></thead>'
                + '<tbody><tr><td>1</td><td>' + esc(line.item) + '</td><td class="num">' + esc(amountCell(r.amount)) + '</td></tr></tbody></table>',
            totalLabel: 'Total', total: r.amount
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
            meta: (projectName ? [['Project', projectName]] : []).concat([['Date', formatDate(dateKey)]]),
            business: state.business, payment: state.payment_details, receivedFrom, receivedBy,
            tableHtml: '<table><thead><tr><th style="width:36px">#</th><th>Description</th><th class="num" style="width:150px">Amount (PHP)</th></tr></thead><tbody>'
                + rows.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(p.label) + '</td><td class="num">' + esc(amountCell(p.amount)) + '</td></tr>').join('')
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
        PAID_ON_REQUIRED: 'Please enter the payment date.',
        PAID_ON_FUTURE: 'The payment date cannot be later than today.',
        REFERENCE_TOO_LONG: 'That reference is too long. Please keep it to 100 characters.',
        DESCRIPTION_REQUIRED: 'Please enter a description.',
        DESCRIPTION_TOO_LONG: 'That description is too long. Please keep it to 200 characters.',
    };
    function refusalText(error) {
        const text = String((error && error.message) || error || '');
        const hit = text.match(/\b(NOT_SIGNED_IN|PROFILE_MISSING|INACTIVE|OWNER_ONLY|NOT_FOUND|COVER_PERIOD|NO_FUND_ALLOCATED|NAME_REQUIRED|NAME_TOO_LONG|REASON_REQUIRED|REASON_TOO_LONG|ALREADY_VOID|PAID_ON_REQUIRED|PAID_ON_FUTURE|REFERENCE_TOO_LONG|DESCRIPTION_TOO_LONG)\b/);
        if (hit) return MESSAGES[hit[1]];
        if (/_described\b|bar_clean_description/.test(text)) {
            return 'Typed receipt descriptions need database update 0118 applied first.';
        }
        if (/_with_payment|payment_reference|\bpaid_on\b/.test(text)) {
            return 'Payment dates on receipts need database update 0117 applied first.';
        }
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
        // payment ({ paidOn, reference }, 0117): the date the client paid and its reference.
        // description (0118): the item line the owner typed. Without them, the older functions are used.
        issue(popup, periodId, receivedFrom, receivedBy, payment, description) {
            return guarded(popup, async () => {
                const args = { p_period: periodId, p_received_from: receivedFrom, p_received_by: receivedBy };
                const paid = payment ? { p_paid_on: payment.paidOn, p_reference: payment.reference } : null;
                const receipt = paid && description !== undefined
                    ? await rpc('bar_issue_described', { ...args, ...paid, p_description: description })
                    : paid ? await rpc('bar_issue_with_payment', { ...args, ...paid })
                    : await rpc('bar_issue', args);
                writeDoc(popup, receiptHTML(receipt));
                return receipt;
            });
        },
        reissue(popup, receiptId, reason, receivedFrom, receivedBy, payment, description) {
            return guarded(popup, async () => {
                const args = { p_receipt: receiptId, p_reason: reason, p_received_from: receivedFrom, p_received_by: receivedBy };
                const paid = payment ? { p_paid_on: payment.paidOn, p_reference: payment.reference } : null;
                const receipt = paid && description !== undefined
                    ? await rpc('bar_reissue_described', { ...args, ...paid, p_description: description })
                    : paid ? await rpc('bar_reissue_with_payment', { ...args, ...paid })
                    : await rpc('bar_reissue', args);
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
    // The payment date (required, never after today) and reference (optional, up to 100 characters).
    function checkPayment(paidOn, reference, today) {
        const date = String(paidOn == null ? '' : paidOn).trim();
        const ref = String(reference == null ? '' : reference).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: MESSAGES.PAID_ON_REQUIRED };
        if (date > today) return { error: MESSAGES.PAID_ON_FUTURE };
        if (ref.length > 100) return { error: MESSAGES.REFERENCE_TOO_LONG };
        return { paidOn: date, reference: ref };
    }
    const paymentFieldsHTML = (paidOn, reference, today) =>
        '<label for="brPaidOn" style="' + LABEL_STYLE + '">Payment date</label>'
        + '<input id="brPaidOn" type="date" value="' + esc(paidOn) + '" max="' + esc(today) + '" style="' + INPUT_STYLE + '">'
        + '<label for="brRef" style="' + LABEL_STYLE + '">Reference no. <span style="font-weight:500;text-transform:none;letter-spacing:0;">(optional)</span></label>'
        + '<input id="brRef" type="text" maxlength="100" value="' + esc(reference) + '" placeholder="GCash / bank reference" style="' + INPUT_STYLE + '">';
    // ops.askPayment (Project Control): the dialog asks for both; otherwise null.
    function readPayment(ov, ops) {
        if (!ops.askPayment) return { skip: true };
        const p = checkPayment(ov.querySelector('#brPaidOn').value, ov.querySelector('#brRef').value, todayKey());
        if (p.error) { showErr(ov, p.error); return null; }
        return p;
    }

    // ── The item line (0118, owner 20 Nov 2026): typed by the owner, pre-filled ──
    // Project Control's automatic line: billing name, payment date, then the reference.
    function paymentLine(label, paidOn, reference) {
        const ref = String(reference == null ? '' : reference).trim();
        return (String(label || '') + ' · Payment received (' + formatDate(paidOn) + ')' + (ref ? ' · Ref. ' + ref : '')).slice(0, 200);
    }
    function checkDescription(text) {
        const v = String(text == null ? '' : text).trim();
        if (!v) return { error: MESSAGES.DESCRIPTION_REQUIRED };
        if (v.length > 200) return { error: MESSAGES.DESCRIPTION_TOO_LONG };
        return { description: v };
    }
    const descriptionFieldHTML = (value) =>
        '<label for="brDesc" style="' + LABEL_STYLE + '">Description <span style="font-weight:500;text-transform:none;letter-spacing:0;">(prints on the receipt)</span></label>'
        + '<textarea id="brDesc" rows="2" maxlength="200" style="' + INPUT_STYLE + '">' + esc(value) + '</textarea>';
    // While the box still holds the automatic line, it follows the payment date and reference.
    function bindAutoLine(ov, plan, ops, startAuto) {
        const box = ov.querySelector('#brDesc');
        if (!box || !ops.askPayment) return;
        let last = startAuto;
        const follow = () => {
            const next = ops.autoLine(plan, ov.querySelector('#brPaidOn').value, ov.querySelector('#brRef').value);
            if (box.value === last) box.value = next;
            last = next;
        };
        ['#brPaidOn', '#brRef'].forEach((id) => ov.querySelector(id).addEventListener('input', follow));
    }
    function readDescription(ov) {
        const d = checkDescription(ov.querySelector('#brDesc').value);
        if (d.error) { showErr(ov, d.error); return null; }
        return d.description;
    }
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

    // ops: who issues and re-issues (Project Control: bar_*; Project Management: js/pm-billing-docs.js)
    // and how the amount is named. Project Control passes PC_OPS, so its wording never changes.
    function issueDialog(state, plan, ops) {
        const auto = ops.autoLine(plan, todayKey(), '');
        const { ov, close } = overlay('Acknowledgement Receipt', plan.period.label,
            amountLine(ops.amountLabel, plan.amount) + nameFields(state)
            + (ops.askPayment ? paymentFieldsHTML(todayKey(), '', todayKey()) : '')
            + descriptionFieldHTML(auto)
            + paymentNote(state) + voidedList(plan.voided) + errorLine,
            '<button type="button" class="lcm-btn" data-br-close>Cancel</button>'
            + '<button type="button" class="lcm-btn primary" id="brGo">Issue Receipt</button>');
        bindVoided(ov, plan.voided);
        bindAutoLine(ov, plan, ops, auto);
        const go = ov.querySelector('#brGo');
        go.addEventListener('click', () => {
            const names = readNames(ov);
            if (!names) return;
            const payment = readPayment(ov, ops);
            if (!payment) return;
            const description = readDescription(ov);
            if (description == null) return;
            runInWindow(ov, go, close, async (popup) => {
                const receipt = await ops.issue(popup, plan.period.id, names.from, names.by, payment.skip ? undefined : payment, description);
                notify('Receipt ' + receipt.receipt_no + ' issued.', 'success');
            });
        });
    }

    function existingDialog(state, plan, ops) {
        const changed = plan.kind === 'changed';
        const canReissue = cents(plan.amount) > 0;
        const note = changed
            ? '<div style="' + TEXT_STYLE + 'margin-top:12px;color:#8A5A00;font-weight:600;">This receipt says ' + esc(money(plan.live.amount)) + ', but ' + esc(ops.amountLabel) + ' is now ' + esc(money(plan.amount)) + '. '
              + (canReissue ? 'Void it and issue a new one to match.' : esc(ops.noAmountText)) + '</div>'
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
        if (reissue) reissue.addEventListener('click', () => reissueDialog(state, plan, ops));
    }

    function reissueDialog(state, plan, ops) {
        // Pre-filled from the old receipt. Its line follows the date and reference only if it
        // was the automatic one; a line the owner typed stays as typed.
        const oldPaidOn = plan.live.paid_on || todayKey();
        const oldRef = plan.live.payment_reference || '';
        const auto = ops.autoLine(plan, oldPaidOn, oldRef);
        const { ov, close } = overlay('Void and Re-issue', plan.live.receipt_no + ' · ' + plan.period.label,
            amountLine('New receipt amount (' + ops.amountLabel + ')', plan.amount)
            + '<label for="brReason" style="' + LABEL_STYLE + '">Reason <span style="color:#B4453A;">(required)</span></label>'
            + '<textarea id="brReason" rows="2" maxlength="500" placeholder="Why is this receipt being replaced?" style="' + INPUT_STYLE + '"></textarea>'
            + nameFields({ received_from: plan.live.received_from, received_by: plan.live.received_by })
            // Pre-filled from the old receipt; one issued before 0117 has neither, so today and blank.
            + (ops.askPayment ? paymentFieldsHTML(oldPaidOn, oldRef, todayKey()) : '')
            + descriptionFieldHTML(plan.live.billing_label || auto)
            + '<div style="' + TEXT_STYLE + 'margin-top:14px;">The old receipt stays on record, marked void. The new one gets a new number.</div>' + errorLine,
            '<button type="button" class="lcm-btn" data-br-close>Cancel</button>'
            + '<button type="button" class="lcm-btn primary" id="brGo">Void and Issue New Receipt</button>');
        bindAutoLine(ov, plan, ops, auto);
        const go = ov.querySelector('#brGo');
        go.addEventListener('click', () => {
            const reason = String(ov.querySelector('#brReason').value || '').trim();
            if (!reason) { showErr(ov, MESSAGES.REASON_REQUIRED); return; }
            const names = readNames(ov);
            if (!names) return;
            const payment = readPayment(ov, ops);
            if (!payment) return;
            const description = readDescription(ov);
            if (description == null) return;
            runInWindow(ov, go, close, async (popup) => {
                const receipt = await ops.reissue(popup, plan.live.id, reason, names.from, names.by, payment.skip ? undefined : payment, description);
                notify('Receipt ' + receipt.receipt_no + ' issued.', 'success');
            });
        });
    }

    // The receipt dialog for a plan of kind new / issued / changed.
    function openReceiptDialog(state, plan, ops) {
        if (plan.kind === 'new') issueDialog(state, plan, ops);
        else existingDialog(state, plan, ops);
    }
    const PC_OPS = {
        issue: (...args) => actions.issue(...args),
        reissue: (...args) => actions.reissue(...args),
        amountLabel: 'Fund Allocated',
        noAmountText: 'A new receipt can be issued once this billing has Fund Allocated.',
        // 0117 (owner, 20 Nov 2026): the receipt line gets the payment date and reference.
        askPayment: true,
        // 0118: the Description box starts with this line, which the owner may change.
        autoLine: (plan, paidOn, reference) => paymentLine(plan.period.label, paidOn, reference),
    };

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
        if (plan.kind === 'new' || plan.kind === 'issued' || plan.kind === 'changed') openReceiptDialog(state, plan, PC_OPS);
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

    // The share one amount is of another: "50%", "33.33%"; '' when there is no budget.
    function shareOf(part, whole) {
        const w = cents(whole);
        if (!(w > 0)) return '';
        return String(Math.round(cents(part) * 10000 / w) / 100) + '%';
    }
    // What is left of the budget now and after this request, never below zero
    // (o.showRemaining: Project Management's window, owner 18 Nov 2026).
    function requestSummary(contract, allocated, percent) {
        const amount = percent ? requestAmount(contract, percent) : 0;
        const remaining = Math.max(0, cents(contract) - cents(allocated));
        const after = Math.max(0, remaining - cents(amount));
        return { receivedPct: shareOf(allocated, contract), remaining: remaining / 100, remainingPct: shareOf(remaining / 100, contract),
                 amount, after: after / 100, afterPct: shareOf(after / 100, contract) };
    }
    const amountNote = (label, amount, note) => '<div style="' + TEXT_STYLE + '">' + esc(label) + ': <b style="font-size:16px;">' + esc(money(amount)) + '</b>'
        + (note ? ' <span style="color:#6E6E73;">(' + esc(note) + ')</span>' : '') + '</div>';
    // The figures above the percentage box. Without o.showRemaining (Project Control) they read exactly as before.
    function percentWindowTop(o) {
        const contractLabel = o.contractLabel || 'Project Budget (contract)';
        const allocatedLabel = o.allocatedLabel || 'Total Allocated so far';
        if (!o.showRemaining) {
            return amountLine(contractLabel, o.contract) + '<div style="margin-top:6px;">' + amountLine(allocatedLabel, o.allocated) + '</div>';
        }
        const s = requestSummary(o.contract, o.allocated, 0);
        const of = (pct) => (pct ? pct + ' of ' + contractLabel : '');
        return amountLine(contractLabel, o.contract)
            + '<div style="margin-top:6px;">' + amountNote(allocatedLabel, o.allocated, of(s.receivedPct)) + '</div>'
            + '<div style="margin-top:6px;">' + amountNote('Remaining', s.remaining, of(s.remainingPct)) + '</div>';
    }
    function percentPreviewText(o, percent) {
        if (!percent) return '';
        const s = requestSummary(o.contract, o.allocated, percent);
        let text = 'Requested amount: ' + money(s.amount);
        if (o.showRemaining) {
            text += '. Remaining after this request: ' + money(s.after)
                + (s.afterPct ? ' (' + s.afterPct + ' of ' + (o.contractLabel || 'Project Budget (contract)') + ')' : '');
        }
        return text;
    }

    // Billing Request: set the percentage first. onContinue runs inside the click,
    // so the browser allows the page to open.
    function askRequestPercent(o) {
        const { ov, close } = overlay('Billing Request', o.projectName,
            percentWindowTop(o)
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
            preview.textContent = percentPreviewText(o, percent);
            warn.textContent = percent ? (o.warning || requestWarning)(o.contract, o.allocated, amount) : '';
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
        requestAmount, validPercent, requestWarning, askRequestPercent, loadPreparedBy, savePreparedBy,
        openReceiptDialog, messageDialog, requestSummary, percentWindowTop, percentPreviewText, checkPayment, paymentFieldsHTML,
        paymentLine, checkDescription, descriptionFieldHTML, pesoWords, splitLine };
})(typeof window !== 'undefined' ? window : globalThis);
