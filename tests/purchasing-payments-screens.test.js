// ════════════════════════════════════════════════════════════════════
// PAYMENTS AND PETTY CASH SCREENS (0102, 2A-4a):
//   run with  node tests/purchasing-payments-screens.test.js
//
// Zero dependencies. Loads the REAL js/purchasing-admin-core.js (its pure
// half) and reads the screens' source:
//   1. The words and checks agree with the server: payment states, what a
//      payment form must refuse, "paid now", refund routes, the Overpaid
//      split, cash held never below ₱0, the daily report and its CSV.
//   2. Outside the money model: the screens write no table, read no expense
//      row, and every server error has a sentence.
//   3. Staff never see a payment badge in Project Control; the Cash tab and
//      the badge are wired in; each write is sent once.
// ════════════════════════════════════════════════════════════════════
'use strict';
const pa = require('../js/purchasing-admin-core.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((label || '') + ' expected ' + y + ', got ' + x);
}

console.log('\npayments: the words agree with the server');

test('every payment state has a pill; the detail says what is left or over', () => {
  const states = ['not_tracked', 'unpaid', 'partial', 'paid', 'overpaid', 'void', 'void_paid'];
  const sql = read('supabase/migrations/0102_purchase_payments.sql');
  for (const s of states) ok(sql.includes("'" + s + "'"), s + ' is a server state');
  eq(Object.keys(pa.PAY_STATE).sort(), states.slice().sort());
  eq(pa.payLabel({ state: 'partial', balance: 7000 }), { text: 'Partially paid', tone: 'working', detail: '₱7,000.00 left' });
  eq(pa.payLabel({ state: 'overpaid', unresolved: 500 }).detail, '₱500.00 to recover');
  eq(pa.payLabel({ state: 'not_tracked' }).text, 'Payment not tracked', 'Q2: never "Unpaid" for an old purchase');
  eq(pa.payLabel(null), null);
});
test('a payment form is refused before sending exactly where the server would refuse it', () => {
  const p = (x) => Object.assign({ amount: '500', paidOn: '2026-10-22', method: 'cash', source: 'company' }, x);
  const ctx = { today: '2026-10-22' };
  eq(pa.paymentProblems(p(), ctx), []);
  eq(pa.paymentProblems(p({ amount: '0' }), ctx), ['BAD_AMOUNT']);
  eq(pa.paymentProblems(p({ amount: '1.005' }), ctx), ['BAD_AMOUNT'], 'three decimals');
  eq(pa.paymentProblems(p({ paidOn: '2026-10-23' }), ctx), ['BAD_DATE'], 'not in the future');
  eq(pa.paymentProblems(p({ paidOn: '2019-12-31' }), ctx), ['BAD_DATE']);
  eq(pa.paymentProblems(p({ source: 'loan' }), ctx), ['BAD_PAY_SOURCE']);
  eq(pa.paymentProblems(p({ method: 'barter' }), ctx), ['BAD_METHOD']);
  eq(pa.paymentProblems(p({ source: 'credit' }), ctx), ['CREDIT_REQUIRED']);
  eq(pa.paymentProblems(p({ source: 'credit', creditId: 'c1', method: '' }), { today: '2026-10-22', creditLeft: 300 }), ['OVER_CREDIT']);
  eq(pa.paymentProblems(p({ source: 'credit', creditId: 'c1', amount: '300', method: '' }), { today: '2026-10-22', creditLeft: 300 }), [], 'credit has no method');
});
test('the payment body: a credit is "other", not cash; a person only when given', () => {
  eq(pa.paymentBody({ amount: '1,250.5', paidOn: '2026-10-22', method: 'gcash', source: 'company', note: ' deposit ' }),
     { amount: '1250.5', paid_on: '2026-10-22', source: 'company', method: 'gcash', note: 'deposit' });
  const c = pa.paymentBody({ amount: '200', paidOn: '2026-10-22', method: 'cash', source: 'credit', creditId: 'c1' });
  eq([c.method, c.credit_id, 'person_id' in c], ['other', 'c1', false]);
  eq(pa.paymentBody({ amount: '1', paidOn: '2026-10-22', method: 'cash', source: 'petty_cash', personId: 'u2', proofUrl: 'https://x/p.jpg' }).person_id, 'u2');
});
test('Q16: paying more than the cash on record is a warning, never a refusal', () => {
  eq(pa.cashWarning('800', 800), '');
  ok(/You hold ₱800\.00[\s\S]*₱1,000\.00[\s\S]*shortfall/.test(pa.cashWarning('1000', 800)), 'warns');
  ok(/You hold ₱0\.00/.test(pa.cashWarning('10', -200)), 'never says below zero');
  eq(pa.cashWarning('10', null), '', 'unknown balance: no warning');
});
test('Q3 "paid now": none sends nothing; full sends the receipt total; part needs less than it; petty cash needs a staff buyer', () => {
  const st = (x) => Object.assign({ paidNow: 'full', paidFrom: 'company', paidMethod: 'gcash', purchaseDate: '2026-10-22' }, x);
  eq(pa.paidNowPayments(st({ paidNow: 'none' }), 1250, 'u1'), []);
  eq(pa.paidNowPayments(st(), 1250, null), [{ amount: '1250', paid_on: '2026-10-22', source: 'company', method: 'gcash', note: '' }]);
  eq(pa.paidNowPayments(st({ paidNow: 'part', paidAmount: '300', paidFrom: 'petty_cash' }), 1250, 'u1')[0].person_id, 'u1');
  eq(pa.paidNowPayments(st({ paidFrom: 'company' }), 1250, 'u1')[0].person_id, undefined, 'company: no person sent');
  eq(pa.paidNowProblems(st({ paidNow: 'part', paidAmount: '1250' }), 1250, null), ['PART_NOT_LESS']);
  eq(pa.paidNowProblems(st({ paidNow: 'part', paidAmount: '' }), 1250, null), ['PAID_AMOUNT']);
  eq(pa.paidNowProblems(st({ paidFrom: 'own_money' }), 1250, null), ['PERSON_REQUIRED']);
  eq(pa.paidNowProblems(st({ paidFrom: 'loan' }), 1250, null), ['BAD_PAY_SOURCE']);
  // R10: a supplier credit may pay at the counter — the server checks it in the purchase's own transaction.
  eq(pa.paidNowProblems(st({ paidFrom: 'credit' }), 1250, null), ['CREDIT_REQUIRED']);
  eq(pa.paidNowProblems(st({ paidFrom: 'credit', paidCredit: 'c1' }), 1250, null, 1000), ['OVER_CREDIT']);
  eq(pa.paidNowProblems(st({ paidFrom: 'credit', paidCredit: 'c1', paidNow: 'part', paidAmount: '500' }), 1250, null, 1000), []);
  const c = pa.paidNowPayments(st({ paidFrom: 'credit', paidCredit: 'c1', paidNow: 'part', paidAmount: '500' }), 1250, 'u1')[0];
  eq([c.source, c.credit_id, c.method, 'person_id' in c], ['credit', 'c1', 'other', false], 'not cash, nobody\'s money');
  eq(pa.paidNowProblems(st({ paidNow: 'none' }), 0, null), []);
});
test('Q10 refund routes match the server\'s check constraint exactly', () => {
  const sql = read('supabase/migrations/0102_purchase_payments.sql');
  const chk = sql.slice(sql.indexOf('constraint pur_refunds_route_chk'), sql.indexOf('constraint pur_refunds_void_chk'));
  // Each "(funded_by … and received_by …)" clause of the check: which money, which receivers.
  const clauses = [...chk.matchAll(/\(funded_by (?:= '([a-z_]+)'|in \(([^)]*)\)) and received_by (?:= '([a-z_]+)'|in \(([^)]*)\))/g)]
    .map(m => ({ funded: m[1] ? [m[1]] : m[2].match(/[a-z_]+/g), recv: m[3] ? [m[3]] : m[4].match(/[a-z_]+/g) }));
  ok(clauses.length >= 4, 'the route check was read: ' + clauses.length);
  const serverAllows = (f, r) => clauses.some(c => c.funded.includes(f) && c.recv.includes(r));
  for (const [funded, recvs] of Object.entries(pa.REFUND_ROUTES)) {
    for (const r of recvs) ok(serverAllows(funded, r), funded + ' → ' + r + ' allowed by the server');
  }
  for (const c of clauses) for (const f of c.funded) for (const r of c.recv) {
    ok((pa.REFUND_ROUTES[f] || []).includes(r), f + ' → ' + r + ' is allowed by the server but missing on screen');
  }
  eq(Object.keys(pa.REFUND_ROUTES).sort(), ['company', 'credit', 'own_money', 'petty_cash'], 'every funding source has routes');
  ok(/Back into Juan's petty cash/.test(pa.routeLabel('petty_cash', 'petty_cash', 'Juan')));
  ok(/Company owes/.test(pa.routeLabel('own_money', 'buyer', 'Juan')));
  ok(/no balance changes/.test(pa.routeLabel('own_money', 'company', 'Juan')));
});
test('the Overpaid screen starts from the server\'s split: credit back to credit, the rest refunded to the money that paid', () => {
  const r = pa.defaultResolution({ suggested: [
    { source: 'own_money', person_id: 'u1', person_name: 'Juan', amount: 300 },
    { source: 'petty_cash', person_id: 'u1', person_name: 'Juan', amount: 150 },
    { source: 'credit', person_id: null, amount: 50 }] }, '2026-10-22');
  eq(r.credit, 50, 'Q10 clarified: credit-funded excess goes back to the supplier\'s credit');
  eq(r.refunds.map(x => [x.fundedBy, x.receivedBy, x.amount]), [['own_money', 'buyer', 300], ['petty_cash', 'petty_cash', 150]]);
});
test('a resolution is refused before sending where the server would refuse it', () => {
  const paidBy = [{ source: 'petty_cash', person_id: 'u1', paid: 700, refunded: 0 }, { source: 'own_money', person_id: 'u1', paid: 300, refunded: 0 }];
  const part = (amount, fundedBy, receivedBy, personId) => ({ amount: String(amount), fundedBy, receivedBy, personId, receivedOn: '2026-10-22' });
  eq(pa.resolutionProblems([part(300, 'petty_cash', 'petty_cash', 'u1'), part(200, 'own_money', 'buyer', 'u1')], '', paidBy, 500, '2026-10-22'), [],
     'the agreed example');
  eq(pa.resolutionProblems([part(400, 'own_money', 'buyer', 'u1')], '', paidBy, 500, '2026-10-22').map(x => x.code), ['OVER_SOURCE']);
  eq(pa.resolutionProblems([part(300, 'petty_cash', 'petty_cash', 'u1')], '300', paidBy, 500, '2026-10-22').map(x => x.code), ['OVER_RESOLVED']);
  eq(pa.resolutionProblems([part(10, 'own_money', 'petty_cash', 'u1')], '', paidBy, 500, '2026-10-22').map(x => x.code), ['BAD_REFUND_ROUTE']);
  eq(pa.resolutionProblems([], '', paidBy, 500, '2026-10-22').map(x => x.code), ['NOTHING_TO_RESOLVE']);
  eq(pa.resolutionProblems([], '200', paidBy, 500, '2026-10-22'), [], 'a credit alone');
  eq(pa.resolutionProblems([part(10, 'petty_cash', 'company', 'u2')], '', paidBy, 500, '2026-10-22').map(x => x.code), ['OVER_SOURCE'],
     'another buyer\'s petty cash did not pay');
});
test('cash held never reads below ₱0: the rest is the shortfall', () => {
  eq(pa.cashFigures({ recorded: -200, pending_returns: 50, owes: 400, owes_to_review: 100 }),
     { held: 0, shortfall: 200, pending: 50, owes: 400, toReview: 100 });
  eq(pa.cashFigures({ recorded: 3500 }).held, 3500);
});
test('the daily report: rows add up day by day; the CSV quotes what needs quoting and never prints a negative balance', () => {
  const rep = { days: [
    { day: '2026-10-19', opening: 0, closing: 5000, received: [{ amount: 5000, method: 'cash', note: 'run 1' }], refunds_in: [], payments: [], returns: [] },
    { day: '2026-10-20', opening: 5000, closing: -300, received: [], refunds_in: [],
      payments: [{ amount: 5300, supplier: 'Wilcon, Malolos', items: ['Cement', 'Sand'], projects: ['Barlin'], warehouse: false }], returns: [] }] };
  const rows = pa.reportRows(rep);
  eq(rows.map(r => r.what), ['Opening', 'Petty cash received', 'Closing', 'Opening', 'Paid to supplier', 'Closing']);
  eq([rows[5].held, rows[5].shortfall], [0, 300]);
  const csv = pa.reportCsv(rep).split('\r\n');
  eq(csv[0], 'Day,Entry,Detail,In (PHP),Out (PHP),Cash held (PHP),Unreconciled shortfall (PHP)');
  ok(csv[5].includes('"Wilcon, Malolos — Cement, Sand · Barlin"'), 'a comma is quoted: ' + csv[5]);
  ok(!/,-\d/.test(pa.reportCsv(rep)), 'no negative amount');
  ok(csv[6].endsWith(',0.00,300.00'), 'closing ₱0 with the shortfall: ' + csv[6]);
});
test('R7 in the report: an entry voided later stays on its day, marked; the void is a row on its own day', () => {
  const rep = { days: [
    { day: '2026-10-20', opening: 1000, closing: 700, received: [], refunds_in: [], returns: [], reversals: [],
      payments: [{ amount: 300, supplier: 'Wilcon', items: ['Cement'], projects: ['Barlin'], voided_on: '2026-10-22' }] },
    { day: '2026-10-22', opening: 700, closing: 0, received: [], refunds_in: [], payments: [], returns: [],
      reversals: [{ what: 'Paid to supplier', entry_day: '2026-10-20', amount: 300, effect: 300, reason: 'double entry' },
                  { what: 'Petty cash given', entry_day: '2026-10-18', amount: 1000, effect: -1000, reason: 'given twice' }] }] };
  const rows = pa.reportRows(rep);
  ok(/\(voided on 2026-10-22\)/.test(rows[1].detail), 'marked on its day');
  eq(rows.slice(4, 6).map(r => [r.what, r.detail, r.amountIn, r.amountOut]),
     [['Void: Paid to supplier of 2026-10-20', 'double entry', 300, ''], ['Void: Petty cash received of 2026-10-18', 'given twice', '', 1000]]);
  for (const d of rep.days) {
    const day = rows.filter(r => r.day === d.day && r.held == null);
    const net = day.reduce((s, r) => s + (r.amountIn === '' ? 0 : r.amountIn) - (r.amountOut === '' ? 0 : r.amountOut), 0);
    // The voided payment still left that day: its row stays an outflow (voided later, not then).
    eq(d.opening + net, d.closing, d.day + ' adds up from its rows');
  }
});

test('F5: a reversal is named with the words of the entry it undoes', () => {
  // The server names its reversals ('what'); the report must use the entry rows' own labels.
  const sql = read('supabase/migrations/0102_purchase_payments.sql');
  const fn = sql.slice(sql.lastIndexOf('create or replace function pur_cash_report('));
  const serverWhats = [...fn.slice(0, fn.indexOf('\n$$;')).matchAll(/jsonb_build_object\('what', '([^']+)'/g)].map(m => m[1]);
  eq(serverWhats.length, 4, 'the four kinds of reversal were read');
  const entry = { day: '2026-10-22', opening: 0, closing: 0, reversals: [],
    received: [{ amount: 1, method: 'cash' }], refunds_in: [{ amount: 1 }], payments: [{ amount: 1, items: [], projects: [] }],
    returns: [{ amount: 1, handed_on: '2026-10-22' }] };
  const labels = new Set(pa.reportRows({ days: [entry] }).map(r => r.what));
  for (const what of serverWhats) {
    const rows = pa.reportRows({ days: [{ day: '2026-10-23', opening: 0, closing: 0, received: [], refunds_in: [], payments: [], returns: [],
      reversals: [{ what, entry_day: '2026-10-22', amount: 1, effect: 1, reason: '' }] }] });
    const label = rows[1].what.replace(/^Void: /, '').replace(/ of 2026-10-22$/, '');
    ok(labels.has(label), '"' + what + '" reads "' + label + '", not an entry label');
  }
});

console.log('\npayments: outside the money model, and every refusal has words');

test('every error code 0102 can raise has a sentence on screen', () => {
  const sql = read('supabase/migrations/0102_purchase_payments.sql');
  const codes = new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]));
  codes.delete('HISTORY_IMMUTABLE');   // a database rule, never reached from a screen
  for (const c of codes) ok(pa.ERRORS[c], c + ' has no sentence');
  ok(/That is more back than that money paid/.test(pa.errorMessage({ message: 'OVER_SOURCE' })), 'matched whole');
  ok(!/payment: at most five/.test(pa.errorMessage({ message: 'BAD_PAY_SOURCE' })), 'BAD_PAY never matches BAD_PAY_SOURCE');
});
test('the payment and cash screens write no table, read no expense row and name no Spent', () => {
  for (const f of ['js/purchasing-admin-pay.js', 'js/purchasing-admin-cash.js']) {
    const src = read(f);
    ok(!/\.from\(/.test(src), f + ' reads or writes a table directly');
    ok(!/\bexpenses\b|\bpayroll\b|_projSpent|buildProject|refreshOvAllData/.test(src.replace(/^\s*\/\/.*$/gm, '')), f + ' touches the money model');
  }
});
test('each write is sent once: an operation id per form, kept across retries of the same form', () => {
  for (const f of ['js/purchasing-admin-pay.js', 'js/purchasing-admin-cash.js']) {
    const src = read(f);
    const writes = [...src.matchAll(/RA\.rpc\('(pur_(?:pay|void_[a-z]+|accept_own_money|resolve_overpaid|cash_[a-z_]+|repay_buyer))'/g)];
    for (const m of writes) {
      if (/^pur_cash_(tracker|report|buyer)$/.test(m[1])) continue;
      const call = src.slice(m.index, src.indexOf(')', src.indexOf('}', m.index)) + 1);
      ok(/p_op: (opId|newOp\(\))/.test(call), f + ': ' + m[1] + ' has no operation id');
    }
    for (const m of src.matchAll(/const opId = (?:root\.DacsReceipts\.newId|newOp)\(\);/g)) {
      const modal = src.indexOf('RA.modal(', m.index), next = src.indexOf('function ', m.index);
      ok(modal !== -1 && (next === -1 || modal < next), f + ': the id is made once, when the form opens (a resent Save reuses it)');
      // Save (onSubmit … onDone) never makes a new id: a second press of the same form resends the first.
      const save = src.slice(src.indexOf('onSubmit', modal), src.indexOf('onDone', modal));
      ok(!/newId\(\)|newOp\(\)|const opId/.test(save), f + ': a new operation id made on Save');
    }
  }
});

console.log('\npayments: staff, wiring');

test('Project Control\'s payment badge: never for staff, owner list only, not part of any total', () => {
  const portal = read('js/portal-app.compiled.js');
  ok(/const payState = !_staff\(\) && typeof window\.expPurPayBadge === "function"/.test(portal), 'hidden from staff in the row');
  const em = read('js/expenses-module.js');
  ok(/window\.expPurPayBadge = id => \(id && window\.currentUserRole === 'owner' && _purPayBadges\[id\]\) \|\| null;/.test(em), 'owner only');
  ok(/if \(window\.currentUserRole === 'owner'\) \{\s*try \{\s*const \{ data, error \} = await window\.sbClient\.rpc\('pur_payment_badges'\)/.test(em),
    'loaded for owner accounts only');
  const tags = portal.slice(portal.indexOf('const purchaseTags = (m) =>'), portal.indexOf('const openReceiptThumb'));
  ok(!/amount|peso|₱/.test(tags.slice(tags.indexOf('const payState'))), 'the badge carries no amount');
});
test('the Cash tab, the Payments card and "Paid now" are wired in', () => {
  const list = read('js/purchasing-admin-list.js');
  ok(/t\('cash', 'Cash'\)/.test(list) && /ui\.tab === 'cash' && PA\.renderCash/.test(list), 'Cash tab');
  const pur = read('js/purchasing-admin-purchases.js');
  ok(/<div data-payments><\/div>/.test(pur) && /PA\.renderPayments\(host\.querySelector\('\[data-payments\]'\), doc\)/.test(pur), 'Payments card');
  ok(/<th>Payment<\/th>/.test(pur) && /PA\.payPill\(p\.pay\)/.test(pur), 'Purchases list column');
  const rec = read('js/purchasing-admin-record.js');
  ok(/\(st\.editId \? '' : paidNowHtml\(me\)\)/.test(rec), '"Paid now" on new purchases only');
  const save = rec.slice(rec.indexOf('async function save('), rec.indexOf('function refreshDocs('));
  ok(/if \(!st\.editId\) \{[\s\S]*?PA\.paidNowPayments\(st, body\.receipt_total, cashHolder\(me\)\)[\s\S]*?rpc\('pur_record'/.test(save), 'sent with pur_record');
  ok(!/payments/.test(save.slice(save.indexOf("rpc('pur_correct'"))), 'never with a correction or replacement');
  // R10: supplier credit at the counter — offered only when the supplier has some left, checked against what is left.
  ok(/RA\.rpc\('pur_credits', \{ p_supplier: st\.supplierId \}\)/.test(rec), 'the supplier\'s credits are read');
  ok(/openCredits = \(cr \|\| \[\]\)\.filter\(c => !c\.voided_at && Number\(c\.left\) > 0\);/.test(rec), 'only credits with something left');
  ok(/if \(openCredits\.length\) from\.credit = PA\.PAY_SOURCE\.credit;/.test(rec), 'credit offered in "Paid from"');
  ok(/PA\.paidNowProblems\(st, [^;]*credit \? credit\.left : null\)/.test(rec), 'checked against the credit left');
  const html = read('admin.html');
  for (const f of ['purchasing-admin-pay', 'purchasing-admin-cash']) {
    const i = html.indexOf('js/' + f + '.js?v=');
    ok(i > html.indexOf('js/purchasing-admin-purchases.js'), f + ' loads after the purchases screen');
  }
  for (const f of ['js/purchasing-admin-core.js', 'js/purchasing-admin-list.js', 'js/purchasing-admin-record.js', 'js/purchasing-admin-purchases.js',
                   'js/purchasing-admin-pay.js', 'js/purchasing-admin-cash.js', 'css/purchasing-admin.css']) {
    const m = html.match(new RegExp(f.replace(/[.\/]/g, '\\$&') + '\\?v=(\\d{8}[a-z])'));
    ok(m && m[1] >= '20261022b', f + ' cache-buster bumped');
  }
  const em = html.match(/js\/expenses-module\.js\?v=(\d{8}[a-z])/);
  ok(em && em[1] >= '20261022b', 'expenses-module.js cache-buster bumped');
});
test('the main owner\'s screens show cash held never below zero and returns as waiting until confirmed', () => {
  const cash = read('js/purchasing-admin-cash.js');
  ok(/PA\.cashFigures\(b\)/.test(cash) && /PA\.cashFigures\(d\)/.test(cash), 'every balance through cashFigures');
  ok(!/\.recorded\)?\s*\+?\s*'<\/strong>/.test(cash), 'no raw recorded balance printed');
  ok(/Confirm received/.test(cash) && /p_confirm: true/.test(cash), 'confirm');
  ok(/Report a return/.test(cash) && /pur_cash_report_return/.test(cash), 'a buyer reports');
  ok(/data-reject-own=/.test(cash) && /'pur_reject_own_money', \{ p_payment: b\.dataset\.rejectOwn \}, 'p_reason'/.test(cash), 'R9: reject with a reason');
});
test('R13: a return photo goes to the private pettyCash folder; payment proofs stay with the purchase', () => {
  ok(/petty_cash: 'pettyCash'/.test(read('js/receipt-storage.js')), 'the upload helper knows the folder');
  const cash = read('js/purchasing-admin-cash.js');
  ok(/uploadReceipt\('petty_cash'/.test(cash) && !/uploadReceipt\('purchase'/.test(cash), 'the return photo is filed under pettyCash');
  ok(/uploadReceipt\('purchase'/.test(read('js/purchasing-admin-pay.js')), 'a payment proof is a purchase document');
});
test('F1: an empty warning box stays hidden (its "hidden" is not overridden by the box style)', () => {
  const css = read('css/purchasing-admin.css');
  ok(/\.att-info\[hidden\]\s*\{\s*display:\s*none\s*(!important)?;?\s*\}/.test(css), 'hidden warning boxes are not shown');
  const m = read('admin.html').match(/css\/purchasing-admin\.css\?v=(\d{8}[a-z])/);
  ok(m && m[1] >= '20261023a', 'purchasing-admin.css cache-buster bumped');
});
test('F4: the owner\'s payment tags are re-read after every payment action and when the Materials list opens', () => {
  const pay = read('js/purchasing-admin-pay.js');
  ok(/const reload = \(\) => \{ if \(root\.expPurReloadFlags\) root\.expPurReloadFlags\(\);/.test(pay), 'the Payments card re-reads the tags');
  const cash = read('js/purchasing-admin-cash.js');
  ok(/const reload = \(\) => \{ if \(root\.expPurReloadFlags\) root\.expPurReloadFlags\(\); renderCash\(body, me\); \};/.test(cash),
    'the owner\'s Cash tab re-reads the tags (accept, reject, resolve)');
  const portal = read('js/portal-app.compiled.js');
  const eff = portal.slice(portal.indexOf('const [, setReviewTick] = React.useState(0);'), portal.indexOf('const purchaseTags = (m) =>'));
  ok(/window\.addEventListener\("dacs:pur-review-flags", onFlags\);\s*if \(typeof window\.expPurReloadFlags === "function"\) window\.expPurReloadFlags\(\);/.test(eff),
    'the Materials list asks for fresh tags when it opens');
  for (const f of ['purchasing-admin-pay', 'purchasing-admin-cash']) {
    const m = read('admin.html').match(new RegExp('js/' + f + '\\.js\\?v=(\\d{8}[a-z])'));
    ok(m && m[1] >= '20261023a', f + '.js cache-buster bumped');
  }
});
test('R4 and R9 on the Payments card: a carried-over payment and a rejected claim say so', () => {
  const pay = read('js/purchasing-admin-pay.js');
  ok(/p\.moved \? ' · carried over from the earlier version of this purchase'/.test(pay), 'carried over');
  ok(/p\.rejected_at \? ' \(rejected by the owner: '/.test(pay), 'rejected');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
