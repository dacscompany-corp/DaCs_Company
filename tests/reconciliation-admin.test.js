// ════════════════════════════════════════════════════════════════════
// RECONCILIATION (0109, Stage 4):  run with  node tests/reconciliation-admin.test.js
//
// Zero dependencies. Loads the REAL js/reconciliation-admin.js (its pure
// half), lifts the real Project Control functions out of
// js/expenses-module.js, and reads the screens' source:
//   1. The tab: its words agree with the server; the checks, the waiting
//      links, the CSV; only owner accounts get the tab; it reads and points
//      — the only writes are the three owner decisions that move no money.
//   2. "Paid now?" on Add Expense (Q7): a payment goes only from the person's
//      own choice — never from "Paid with"; only accounts that may record
//      payments see it; the supplier is a listed one by id, or the typed name.
//   3. The Reports note (Q11): a month changed by a cost move approved after
//      it ended is named, with the day and the amount; nothing else is.
// ════════════════════════════════════════════════════════════════════
'use strict';
const rc = require('../js/reconciliation-admin.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0109_reconciliation.sql');
const JS = read('js/reconciliation-admin.js');
const BROWSER = JS.slice(JS.indexOf('// ── Browser'));
const EXP = read('js/expenses-module.js');
const HTML = read('admin.html');

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
// A top-level function of expenses-module.js, lifted verbatim.
function lift(name) {
  const i = EXP.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('SLICE NOT FOUND: function ' + name + ' in js/expenses-module.js');
  const j = EXP.indexOf('\n}\n', i);
  return EXP.slice(i, j + 3);
}
function load(names, ctx) {
  const src = names.map(lift).join('\n');
  return new Function('ctx', 'with(ctx){' + src + '\nreturn {' + names.join(',') + '};}')(ctx);
}

console.log('\nReconciliation: the words agree with the server');

test('every refusal 0109 can send has a sentence', () => {
  const codes = [...new Set([...SQL.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))];
  ok(codes.length >= 10, 'found the codes: ' + codes.join(' '));
  for (const c of codes) {
    if (c === 'HISTORY_LOCKED') continue;          // a trigger: the screens never touch the tables
    ok(rc.ERRORS[c], c + ' has no sentence');
  }
  for (const c of ['NOT_ALLOWED', 'NOT_OFFICE', 'BAD_OP', 'PGRST202']) ok(rc.ERRORS[c], c);
  eq(rc.errorMessage({ message: 'CHANGED_SINCE' }), rc.ERRORS.CHANGED_SINCE);
  eq(rc.errorMessage({ code: 'PGRST202' }), rc.ERRORS.PGRST202);
  ok(rc.errorMessage({ message: 'something new' }).startsWith('Something went wrong'), 'unknown kept');
});

test('every rec_ call the tab makes exists in 0109 and is granted to signed-in accounts, never to anon', () => {
  const calls = [...new Set([...BROWSER.matchAll(/RA\.rpc\('(rec_[a-z_]+)'/g)].map(m => m[1]))].sort();
  eq(calls, ['rec_accept_cover', 'rec_bill_check', 'rec_bills', 'rec_money_out', 'rec_purchase_places', 'rec_review_lines',
             'rec_waiting', 'rec_withdraw_cover']);
  for (const f of calls) {
    ok(new RegExp('create or replace function ' + f + '\\(').test(SQL), f + ' not in 0109');
    ok(new RegExp('grant execute on function ' + f + '\\([^)]*\\) to authenticated;').test(SQL), f + ' not granted');
    ok(new RegExp('revoke all on function ' + f + '\\([^)]*\\) from public, anon;').test(SQL), f + ' open to anon');
  }
});

console.log('\nReconciliation: the checks, links and CSV');

test('adds up / a difference: the words say a difference is a bug to report', () => {
  eq(rc.addsUpText({ with_difference: 0, difference: 0 }), 'Adds up ✓');
  const d = rc.addsUpText({ with_difference: 1, difference: -25 });
  ok(d.startsWith('Difference −₱25.00 in 1 purchase') && /tell the developer/.test(d) && /bug, not a business event/.test(d), d);
  ok(/in 2 purchases/.test(rc.addsUpText({ with_difference: 2, difference: 3 })), 'plural');
});

test('waiting: only counts above zero, each pointing where it is decided', () => {
  const items = rc.waitingItems({ billing_period: 2, unpaid: 18, cost_moves: 0, bills: 1, returns: 1, stock: 0, tools: 3 });
  eq(items.map(i => [i.key, i.label, i.go]), [
    ['billing_period', '2 lines waiting for a billing period', { anchor: 'rec-review' }],
    ['bills', '1 stock cost move to check on a client\'s bill', { anchor: 'rec-bills' }],
    ['unpaid', '18 purchases Unpaid or Partly paid', { tab: 'purchases' }],
    ['returns', '1 petty-cash return to confirm', { tab: 'cash' }],
    ['tools', '3 tools waiting for the owner (Lost or Retire)', { view: 'reqTools' }]]);
  eq(rc.waitingItems({}), []);
  eq(rc.waitingItems(null), []);
});

test('the default range is this month, from local date parts', () => {
  eq(rc.monthRange(new Date(2026, 9, 30, 23, 59)), { from: '2026-10-01', to: '2026-10-30' });
  eq(rc.monthRange(new Date(2026, 10, 1, 0, 5)), { from: '2026-11-01', to: '2026-11-01' });
  ok(!/\.toISOString\(/.test(JS), 'never toISOString');
});

test('a side of a bill names the project, the month and Cover', () => {
  eq(rc.sideText({ project: 'Barlin', period: 'October 2026 · billing #1', cover: true, amount: -200 }), 'Barlin · October 2026 · billing #1 (Cover) −₱200.00');
  eq(rc.sideText({ project: 'Bagong', period: 'No billing period', cover: false, amount: 500 }), 'Bagong · No billing period ₱500.00');
});

test('the CSV: every purchase, the total, the voided apart; commas and quotes kept safe', () => {
  const csv = rc.placesCsv({
    purchases: [{ purchase_date: '2026-10-24', ref: '7a03382a', what: 'Materials', projects: 'Eagle Residence', supplier: 'A "B", C',
                  recorded: 500, own: 500, other: 0, company: 0, loss: 0, difference: 0 }],
    totals: { purchases: 1, recorded: 500, own: 500, other: 0, company: 0, loss: 0, difference: 0 },
    voided: [{ purchase_date: '2026-10-20', ref: 'ffffffff', what: 'Gravel', recorded: 100 }] });
  const lines = csv.trim().split('\r\n');
  eq(lines[0], 'Purchase date,Ref,What,Where,Supplier,Recorded,Own project,Other projects,Company stock,Company stock loss,Difference');
  eq(lines[1], '2026-10-24,7a03382a,Materials,Eagle Residence,"A ""B"", C",500.00,500.00,0.00,0.00,0.00,0.00');
  eq(lines[2], 'Total,,1 purchases,,,500.00,500.00,0.00,0.00,0.00,0.00');
  eq(lines[3], '2026-10-20,ffffffff,VOIDED: Gravel,,,100.00,,,,,');
});

console.log('\nReconciliation: it reads and points');

test('the tab never writes a row: only the three owner decisions, each sent once', () => {
  ok(!/\.from\(|\.collection\(|sbClient/.test(BROWSER), 'no direct table access');
  for (const w of ['pur_record', 'pur_pay', 'pur_correct', 'pur_void', 'stk_cost_', 'stk_move', 'expenses']) {
    ok(!new RegExp("rpc\\('" + w).test(BROWSER), 'calls ' + w);
  }
  for (const w of ['rec_accept_cover', 'rec_withdraw_cover', 'rec_bill_check']) {
    ok(new RegExp("const send = sendOnce\\(\\(opId, (reason|note)\\) => RA\\.rpc\\('" + w + "', \\{ p_op: opId").test(BROWSER), w + ' sent once');
  }
});

test('only js/reconciliation-admin.js calls the rec_ functions', () => {
  const dir = path.join(__dirname, '..', 'js');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'reconciliation-admin.js')) {
    ok(!/['"]rec_[a-z_]+['"]/.test(read('js/' + f)), f + ' calls a rec_ function');
  }
});

test('the tab is for owner accounts, beside Company stock, after Purchasing loads', () => {
  const list = read('js/purchasing-admin-list.js');
  ok(/function reconcileTab\(\) \{\s+return !!\(root\.ReconciliationAdmin && PA\.ui\.isOwner\);/.test(list), 'the tab rule');
  ok(/\(reconcileTab\(\) \? t\('reconcile', 'Reconciliation'\) : ''\)/.test(list), 'the tab');
  ok(/if \(ui\.tab === 'reconcile' && reconcileTab\(\)\) return root\.ReconciliationAdmin\.render\(/.test(list), 'its body');
  const a = HTML.indexOf('<script src="js/purchasing-admin-core.js?v='), b = HTML.indexOf('<script src="js/reconciliation-admin.js?v=');
  ok(a !== -1 && b > a, 'reconciliation-admin.js loads after purchasing-admin-core.js');
  ok(HTML.indexOf('<script src="js/purchasing-admin-list.js?v=') < b + 1e9, 'and is on the page');
});

console.log('\nProject Control: "Paid now?" (Q7)');

const pay = load(['_expPayHowOf', '_expPaidNowPayments', '_expPaidNowProblem', '_expSupplierLabel', '_expSupplierBody'],
  { _EXP_PAY_HOW: { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank transfer', check: 'Check', other: 'Other' } });
const PAID_WITH = [...HTML.slice(HTML.indexOf('<select id="expPaymentMethod"'), HTML.indexOf('</select>', HTML.indexOf('<select id="expPaymentMethod"')))
  .matchAll(/<option value="([^"]*)">/g)].map(m => m[1]);

test('"Paid with" alone never records a payment — whatever it says', () => {
  ok(PAID_WITH.length >= 10 && PAID_WITH.includes('GCash') && PAID_WITH.includes('Bank Transfer'), 'the form\'s list: ' + PAID_WITH);
  for (const m of PAID_WITH) {
    eq(pay._expPaidNowPayments('none', 28120, '', 'company', pay._expPayHowOf(m), '2026-10-24'), [], '"' + m + '" with Not paid yet');
    eq(pay._expPaidNowPayments(undefined, 28120, '', 'company', pay._expPayHowOf(m), '2026-10-24'), [], '"' + m + '" with nothing chosen');
  }
  // In the save: payments come only from the person's choice, read only for accounts that may record them.
  const add = EXP.slice(EXP.indexOf('async function handleAddExpense('), EXP.indexOf('\nasync function deleteExpense('))
    .replace(/\/\/[^\n]*/g, '');   // the code, not its comments
  ok(/const paidNow  = window\.currentCanBuy \? \(document\.getElementById\('expPaidNow'\)\?\.value \|\| 'none'\) : 'none';/.test(add), 'the choice');
  ok(/const payments = _expPaidNowPayments\(paidNow, totalAmt, paidPart, document\.getElementById\('expPaidFrom'\)\?\.value,\s+document\.getElementById\('expPaidHow'\)\?\.value, purchaseDate\);/.test(add), 'payments from the choice');
  ok(/if \(payments\.length\) body\.payments = payments;/.test(add), 'sent only when chosen');
  eq((add.match(/payments/g) || []).length, 4, 'no other payment in the save');
  ok(!/paymentMethod[^\n]*payments|payments[^\n]*paymentMethod/.test(add), '"Paid with" never feeds a payment');
});

test('Paid in full / Paid part: the amount, the day bought, where the money came from and how', () => {
  eq(pay._expPaidNowPayments('full', 28120, '', 'company', 'bank_transfer', '2026-10-24'),
     [{ amount: '28120', paid_on: '2026-10-24', method: 'bank_transfer', source: 'company', note: '' }]);
  eq(pay._expPaidNowPayments('part', 500, '1,20.5', 'petty_cash', 'gcash', '2026-10-24'),
     [{ amount: '120.5', paid_on: '2026-10-24', method: 'gcash', source: 'petty_cash', note: '' }]);
  eq(pay._expPaidNowPayments('full', 80, '', 'credit', 'zelle', '2026-10-24')[0].source, 'company', 'only company / petty cash / own money');
  eq(pay._expPaidNowPayments('full', 80, '', 'company', 'zelle', '2026-10-24')[0].method, 'other');
  eq(pay._expPaidNowProblem('none', 0, ''), '');
  eq(pay._expPaidNowProblem('full', 0, ''), 'Enter the total first.');
  eq(pay._expPaidNowProblem('part', 500, ''), 'Enter the amount paid.');
  ok(/Paid in full/.test(pay._expPaidNowProblem('part', 500, '500')), 'a part is less than the total');
  eq(pay._expPaidNowProblem('part', 500, '499.99'), '');
});

test('"How" starts from "Paid with" as a hint only; the person can change it', () => {
  eq(['GCash', 'Cash', 'Bank Transfer', 'BDO', 'BPI', 'Metrobank', 'Cheque', 'Maya', 'Lalamove', 'Credit Card', 'Other', ''].map(pay._expPayHowOf),
     ['gcash', 'cash', 'bank_transfer', 'bank_transfer', 'bank_transfer', 'bank_transfer', 'check', 'other', 'other', 'other', 'other', 'other']);
  ok(/<select id="expPaidHow" onchange="this\.dataset\.touched = '1'">/.test(HTML), 'a hand-picked How is kept');
  ok(/if \(how && !how\.dataset\.touched\) how\.value = _expPayHowOf\(/.test(EXP), 'the hint fills it only when untouched');
});

test('only accounts that may record payments see it; every opening starts at "Not paid yet"', () => {
  const setup = EXP.slice(EXP.indexOf('async function _expSetupPaidNow('), EXP.indexOf('\n}\n', EXP.indexOf('async function _expSetupPaidNow(')));
  ok(/const can = !!window\.currentCanBuy;\s+wrap\.style\.display = can \? '' : 'none';/.test(setup), 'shown to buyers only');
  ok(/choice\.value = 'none'/.test(setup), 'reset to Not paid yet');
  ok(/'<option value="company">Company \(paid directly\)<\/option>' \+ \(window\.currentUserRole === 'staff'/.test(setup), 'owner pays as the company');
  ok(/_expSetupPaidNow\(\);\n        _expCheckPending\(\);\n    \}/.test(EXP), 'set up when Add Expense opens (and any unsettled save checked)');
  const sel = HTML.slice(HTML.indexOf('<select id="expPaidNow"'), HTML.indexOf('</select>', HTML.indexOf('<select id="expPaidNow"')));
  ok(/^<select id="expPaidNow" onchange="expTogglePaidNow\(\)">\s+<option value="none">Not paid yet \/ record later<\/option>/.test(sel), 'first and default: Not paid yet');
  ok(/<div id="expPaidNowWrap" style="display:none;">/.test(HTML), 'hidden until set up');
});

test('the supplier: one from the list by its id (any case), else the typed name', () => {
  const list = [{ id: 's1', name: 'Wilcon Depot', branch: 'Pasig' }, { id: 's2', name: 'Citi Hardware', branch: '' }];
  eq(pay._expSupplierBody('wilcon depot · PASIG', list), { supplier: '', supplier_id: 's1' });
  eq(pay._expSupplierBody(' Citi Hardware ', list), { supplier: '', supplier_id: 's2' });
  eq(pay._expSupplierBody('Wilcon', list), { supplier: 'Wilcon' });
  eq(pay._expSupplierBody('', list), { supplier: '' });
  eq(pay._expSupplierBody('x'.repeat(250), list).supplier.length, 200);
  // A correction from Project Control keeps the listed supplier: the server inherits supplier_id (0097 pur_inherit).
  ok(/if not \(v_body \? 'supplier_id'\) and pu\.supplier_id is not null then/.test(read('supabase/migrations/0097_purchasing_office.sql')), 'kept on edit');
});

test('the server\'s payment refusals read in words on Add Expense', () => {
  for (const c of ['BAD_PAY_SOURCE', 'PERSON_REQUIRED', 'NOT_A_BUYER', 'BAD_METHOD', 'BAD_SUPPLIER', 'BAD_PAY', 'BUYER_REQUIRED']) {
    ok(new RegExp('\\b' + c + ':').test(EXP), c + ' has no sentence');
  }
  ok(EXP.indexOf('BAD_PAY_SOURCE:') < EXP.indexOf('BAD_PAY:'), 'the longer code is matched first');
});

test('"office review" on no-billing-period Cover follows the flag: "Cover is right" clears it there too (words only)', () => {
  const lines = new Set(['L1']);
  const f = load(['_pcNoPeriodStatus'], { _purReviewLines: lines })._pcNoPeriodStatus;
  eq(f([{ folderId: 'f', purchaseLineId: 'L1', amount: 344 }]), 'No billing period — office review');
  lines.delete('L1');
  eq(f([{ folderId: 'f', purchaseLineId: 'L1', amount: 344 }]), 'No billing period — Cover', 'marked Cover is right');
  eq(f([{ projectId: 'p', purchaseLineId: 'L2' }]), 'No billing period — Cover', 'a row on a period is not "no billing period"');
  eq((EXP.match(/status:_pcNoPeriodStatus\(model\.expenses\)/g) || []).length, 2, 'the screen and the CSV');
  ok(!/No billing period — office review' \}\)\);/.test(EXP), 'no fixed "office review" left');
  const portal = read('js/portal-app.compiled.js');
  ok(/const noPeriodReview = typeof window\.expPurNeedsReview === "function"\s+&& expensesRaw\.some\(e => !e\.projectId && e\.folderId === project\.id && window\.expPurNeedsReview\(e\.purchaseLineId\)\);/.test(portal), 'the billing-periods page reads the flag');
  ok(/noPeriodReview \? "; office review needed\." : "\."\]/.test(portal) && /\(noPeriodReview \? " — office review needed\." : "\."\)/.test(portal), 'both wordings');
  ok(/const afterMark = \(\) => \{ if \(root\.expPurReloadFlags\) root\.expPurReloadFlags\(\); render\(body\); \};/.test(BROWSER)
     && /openCover\(l, afterMark\)/.test(BROWSER) && /openWithdraw\(m, afterMark\)/.test(BROWSER), 'the tab reloads the flags after a mark');
});

console.log('\nReports: a month changed after it ended (Q11)');

// The note reads rec_bills' items — the server's lasting log of cost-move
// rows (0109). Each side names its billing period; a reversal is its own item.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const OCT = { id: 'p10', folderId: 'f1', month: 'October', year: 2026 };
const NOV = { id: 'p11', folderId: 'f1', month: 'November', year: 2026 };
const iso = (y, m, d, h = 9) => new Date(y, m, d, h).toISOString();
// An October cost (₱300 on the period, ₱200 Cover) moved to Bagong on 5 Nov; reversed on 3 Dec.
const MOVED = { cost_move_id: 'K1', change: 'approved', at: iso(2026, 10, 5), item: 'Cement', from: 'Barlin', to: 'Bagong',
                sides: [{ period_id: 'p10', amount: -300, cover: false }, { period_id: 'p10', amount: -200, cover: true },
                        { period_id: 'b11', amount: 500, cover: false }] };
const REVERSED = { cost_move_id: 'K1', change: 'reversed', at: iso(2026, 11, 3), item: 'Cement', from: 'Barlin', to: 'Bagong',
                   sides: [{ period_id: 'p10', amount: 300, cover: false }, { period_id: 'p10', amount: 200, cover: true },
                           { period_id: 'b11', amount: -500, cover: false }] };
function notesFor(changes, periods) {
  return load(['_pcLateCostMoveNotes'], { _MONTHS: MONTHS })._pcLateCostMoveNotes(changes, periods);
}

test('an October cost moved in November and reversed in December: two notes on October — the move, then its reversal', () => {
  const n = notesFor([REVERSED, MOVED], [OCT, NOV]);
  eq(n.map(x => [x.period, x.day, x.change, x.amount, x.what]),
     [['October 2026', '2026-11-05', 'approved', -500, 'Cement: Barlin → Bagong'],
      ['October 2026', '2026-12-03', 'reversed', 500, 'Cement: Barlin → Bagong']]);
});

test('nothing is named for a move inside its own month, a side with no period, another project\'s period, or no time', () => {
  eq(notesFor([
    { cost_move_id: 'K2', change: 'approved', at: iso(2026, 10, 5), sides: [{ period_id: 'p11', amount: 400 }] },   // November, in November
    { cost_move_id: 'K3', change: 'approved', at: iso(2026, 11, 1), sides: [{ period_id: null, amount: 150 }] },    // Cover, no period
    { cost_move_id: 'K4', change: 'reversed', at: iso(2026, 11, 1), sides: [{ period_id: 'zz', amount: 50 }] },     // not in this report
    { cost_move_id: 'K5', change: 'approved', sides: [{ period_id: 'p10', amount: -50 }] },                          // no time
    { cost_move_id: 'K6', change: 'approved', at: new Date(2026, 9, 31, 23, 59).toISOString(), sides: [{ period_id: 'p10', amount: -50 }] },
  ], [OCT, NOV]), []);
});

// The real _pcPrintReport, with what it calls around it stubbed: the printed page itself.
function printed(kind, owner = true) {
  let html = '';
  const win = { document: { write: (h) => { html += h; }, close() {} }, focus() {}, print() {} };
  const ctx = {
    _MONTHS: MONTHS, expProjects: [OCT, NOV], expFolders: [{ id: 'f1', name: 'Barlin' }], _pcCostChanges: [MOVED, REVERSED],
    _pcIsOwner: () => owner, _mvpEsc: (s) => String(s), formatNum: (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    _pcReportTable: () => '', _pcAllocationReportHtml: () => '<!--allocation-->', _pcReportDetails: () => '', _pcReportCategories: () => [],
    _pcPrintFundingSummary: () => '', _pcFundingLabel: () => '', _pcPrintPeriodLabel: () => '', showExpNotif: () => {},
    window: { dacsPrintHeader: () => '', open: () => win },
  };
  const f = load(['_pcReportFolderIds', '_pcLateCostMoveNotes', '_pcLateCostMoveHtml', '_pcPrintReport'], ctx);
  const t = { cover: 0, budget: 0, mats: 0, labor: 0, overhead: 0, totalSpent: 0, remaining: 0, usedPct: 0, txCount: 0, workerCount: 0 };
  f._pcPrintReport('Barlin · 2026', { rows: [], totals: t, expenses: [] }, [], { kind, folderId: 'f1', dateLabel: '2026', periodLabel: 'Monthly' });
  return html;
}

test('the printed Reports page carries both notes; a billing summary print, and a staff account, carry none', () => {
  const page = printed('dashboard');
  ok(page.includes('Changed after the month ended'), 'the heading');
  ok(page.includes('October 2026: changed Nov 5, 2026 by a stock cost move: −₱500.00 (Cement: Barlin → Bagong)'), 'the move: ' + page.slice(page.indexOf('Changed after'), page.indexOf('Changed after') + 400));
  ok(page.includes('October 2026: changed again Dec 3, 2026 — a stock cost move was reversed: +₱500.00 (Cement: Barlin → Bagong)'), 'the reversal');
  ok(page.indexOf('<!--allocation-->') < page.indexOf('Changed after the month ended'), 'under Billing Allocation Performance');
  ok(!printed('receipt').includes('Changed after the month ended'), 'not on a billing summary print');
  ok(!printed('dashboard', false).includes('Changed after the month ended'), 'not for staff');
});

test('the note reads the lasting log through the tab module, fresh each Reports visit — never the expense rows, never a total', () => {
  ok(/allocation\.innerHTML = _pcAllocationReportHtml\(report\.model\) \+ _pcLateCostMoveHtml\(_rptState\.folderId\);/.test(EXP), 'on the screen');
  ok(/if \(options\.kind === 'dashboard'\) body \+= _pcLateCostMoveHtml\(options\.folderId\);/.test(EXP), 'on the Reports print only');
  ok(/function renderReportsDashboard\(\) \{\n    if \(_pcEnsureReportOverhead\(renderReportsDashboard\)\) return;\n    if \(_pcEnsureCostChanges\(renderReportsDashboard\)\) return;/.test(EXP)
     && /if \(_pcEnsureCostChanges\(printReportsDashboard\)\) return;/.test(EXP), 'loaded before the screen and the print');
  ok(/window\.ReconciliationAdmin\.costChanges\(\)/.test(lift('_pcEnsureCostChanges')) && /function costChanges\(\) \{ return RA\.rpc\('rec_bills'\); \}/.test(BROWSER), 'rec_bills, through the tab module');
  ok(/_pcCostChanges = null;\n    _pcCostChangesPromise = null;/.test(lift('loadRptData')), 'fresh on each visit');
  const notes = lift('_pcLateCostMoveNotes');
  ok(!/stkCostMoveId|createdAt|\.expenses/.test(notes), 'never from the expense rows (a reversal deletes them)');
  ok(!/_pcLateCostMove|_pcCostChanges/.test(lift('_pcReportModel')), 'the totals never read the note');
  ok(!/\.toISOString\(/.test(notes), 'local date parts');
  ok(/if \(!_pcIsOwner\(\)\) return '';/.test(lift('_pcLateCostMoveHtml')), 'owner only');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
