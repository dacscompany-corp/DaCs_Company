// ═════════════════════════════════════════════════════════════════════
// PETTY CASH FOR LABOR AND OVERHEAD (0122):  node tests/petty-cash-labor-overhead.test.js
//
// Zero dependencies. Loads the REAL js/petty-cash-pick.js in a sandbox and
// reads the screens' source:
//   1. Who sees which "Paid from" choices, whose petty cash is sent, what the
//      form refuses before sending, and the server's refusals in words.
//   2. The payroll forms (Add / Edit), the two overhead forms, the list tags
//      and vouchers, and the petty cash screens (report, CSV, buyer card,
//      My cash).
// Spec: docs/superpowers/specs/2026-11-25-petty-cash-labor-overhead-design.md
// ═════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const PICK = read('js/petty-cash-pick.js');

let passed = 0, failed = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((label || '') + ' expected ' + y + ', got ' + x);
}

// A fresh copy of the helper with its own window.
function load(win = {}) {
  const calls = [];
  const window = Object.assign({
    currentUserRole: 'owner', currentStockMainOwner: false, currentCanBuy: true,
    sbClient: { rpc: async (name) => { calls.push(name); return win.rpcAnswer || { data: { buyers: [] }, error: null }; } },
  }, win);
  const ctx = { window, console: { log: console.log, warn: () => {} } };   // a refused list warns; expected here
  vm.createContext(ctx);
  vm.runInContext(PICK, ctx);
  return { P: window.DacsPettyCash, window, calls };
}
const BUYERS = [{ buyer_id: 'b-1', name: 'Juan', can_buy: true, recorded: 0 },
                { buyer_id: 'b-2', name: 'Pedro', can_buy: false, recorded: 1200 },
                { buyer_id: 'b-3', name: 'Gone', can_buy: false, recorded: 0 }];

console.log('\nWho chooses petty cash, and what is sent');

test('an owner account that is not the main owner: Company only', () => {
  const { P } = load();
  eq(P.choices({ role: 'owner', mainOwner: false, canBuy: true, buyers: [] }).map(c => c.value), ['company']);
});

test('the main owner with buyers: Company and Petty cash', () => {
  const { P } = load();
  eq(P.choices({ role: 'owner', mainOwner: true, canBuy: true, buyers: BUYERS.slice(0, 2) }),
     [{ value: 'company', label: 'Company (paid directly)' }, { value: 'petty_cash', label: 'Petty cash' }]);
  eq(P.choices({ role: 'owner', mainOwner: true, canBuy: true, buyers: [] }).map(c => c.value), ['company'], 'no buyers');
});

test('a staff buyer: Company and My petty cash — but not on overhead', () => {
  const { P } = load();
  eq(P.choices({ role: 'staff', mainOwner: false, canBuy: true, buyers: [] }),
     [{ value: 'company', label: 'Company (paid directly)' }, { value: 'mine', label: 'My petty cash' }]);
  eq(P.choices({ role: 'staff', mainOwner: false, canBuy: true, buyers: [], overhead: true }).map(c => c.value), ['company']);
  eq(P.choices({ role: 'staff', mainOwner: false, canBuy: false, buyers: [] }).map(c => c.value), ['company'], 'no Buyer switch');
});

test('whose petty cash is sent', () => {
  const { P } = load();
  eq(P.holderFor('mine', 'b-1', 'me'), 'me');
  eq(P.holderFor('petty_cash', 'b-1', 'me'), 'b-1');
  eq(P.holderFor('petty_cash', '', 'me'), null);
  eq(P.holderFor('company', 'b-1', 'me'), null);
});

test('what the form refuses before sending', () => {
  const { P } = load();
  eq(P.problem('company', null, ''), '');
  eq(P.problem('petty_cash', null, '2026-11-20'), 'Choose whose petty cash paid.');
  eq(P.problem('mine', 'me', ''), 'Petty cash needs the payment date.');
  eq(P.problem('mine', 'me', 'Nov 20'), 'Petty cash needs the payment date.');
  eq(P.problem('mine', 'me', '2026-11-20T08:00'), '');
});

test('the server\'s refusals in words', () => {
  const { P } = load();
  eq(P.errorText(new Error('NOT_A_BUYER')), 'Only a staff buyer holds petty cash.');
  eq(P.errorText({ message: 'P0001: PERSON_NOT_ALLOWED' }), 'Only the main owner can record another person\'s petty cash.');
  eq(P.errorText(new Error('PETTY_CASH_DATE')), 'Petty cash needs a payment date that is not in the future.');
  eq(P.errorText(new Error('BAD_AMOUNT')), 'Check the amount.');
  eq(P.errorText(new Error('boom')), null);
  eq(P.errorText(null), null);
});

test('the buyer list is asked for only by the main owner', async () => {
  const staff = load({ currentUserRole: 'staff', currentStockMainOwner: false });
  eq(await staff.P.loadBuyers(), []);
  eq(staff.calls, [], 'staff: no call');
  const owner = load({ currentUserRole: 'owner', currentStockMainOwner: false });
  eq(await owner.P.loadBuyers(), []);
  eq(owner.calls, [], 'not the main owner: no call');
  const main = load({ currentUserRole: 'owner', currentStockMainOwner: true, rpcAnswer: { data: { buyers: BUYERS }, error: null } });
  eq((await main.P.loadBuyers()).map(b => b.buyer_id), ['b-1', 'b-2'], 'buyers, or anyone with cash on record');
  eq(main.calls, ['pur_cash_tracker']);
  const bad = load({ currentUserRole: 'owner', currentStockMainOwner: true, rpcAnswer: { data: null, error: { message: 'NOT_ALLOWED' } } });
  eq(await bad.P.loadBuyers(), [], 'a refusal: nobody');
});

test('the tag names the person only when known — and never a peso', async () => {
  const main = load({ currentUserRole: 'owner', currentStockMainOwner: true, rpcAnswer: { data: { buyers: BUYERS }, error: null } });
  eq(main.P.tag('b-1'), 'Petty cash', 'before the list is read');
  await main.P.loadBuyers();
  eq(main.P.nameOf('b-1'), 'Juan');
  eq(main.P.tag('b-1'), 'Petty cash · Juan');
  eq(main.P.tag('zzz'), 'Petty cash');
  ok(!/₱|peso/i.test(PICK.replace(/\/\/[^\n]*/g, '')), 'no peso in the helper');
});

// ── 2. The payroll forms (Add / Edit) ───────────────────────────────
const HTML = read('admin.html');
const EXP = read('js/expenses-module.js');
// A top-level function of expenses-module.js, lifted verbatim (up to the next top-level closing brace).
function lift(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('not found: ' + head);
  const j = src.indexOf('\n}', i);
  return src.slice(i, j + 2) + (head.startsWith('window.') ? ';' : '');
}
// A stub page: elements by id, each with style, dataset, value, innerHTML, textContent.
function page(ids) {
  const els = {};
  ids.forEach(id => { els[id] = { id, style: {}, dataset: {}, value: '', innerHTML: '', textContent: '' }; });
  return { els, document: { getElementById: (id) => els[id] || null } };
}
const PAY_IDS = (p) => [p + 'PaidFromRow', p + 'PaidFrom', p + 'PaidPersonRow', p + 'PaidPerson', p + 'PettyNote'];
async function payForm(prefix, current, win) {
  const { P } = load(win);
  const pg = page(PAY_IDS(prefix));
  const ctx = Object.assign({ document: pg.document, console, _mvpEsc: (s) => String(s), _expActor: () => win.me || null,
                              _paySetupSeq: {} }, { window: Object.assign(win, { DacsPettyCash: P }) });
  vm.createContext(ctx);
  vm.runInContext(lift(EXP, 'window.payTogglePettyCash = function') + '\n' + lift(EXP, 'async function _paySetupPettyCash(') +
                  '\n' + lift(EXP, 'function _payPettyChoice(') + '\nthis._setup = _paySetupPettyCash; this._choice = _payPettyChoice;', ctx);
  await ctx._setup(prefix, current);
  return { els: pg.els, choice: (day) => ctx._choice(prefix, day) };
}
const MAIN = () => ({ currentUserRole: 'owner', currentStockMainOwner: true, currentCanBuy: true, me: 'owner-1',
                      rpcAnswer: { data: { buyers: BUYERS }, error: null } });
const STAFF_BUYER = () => ({ currentUserRole: 'staff', currentStockMainOwner: false, currentCanBuy: true, me: 'b-1' });

console.log('\nThe payroll forms');

test('the form has "Paid from" and "Whose petty cash", hidden until set up', () => {
  for (const p of ['pay', 'editPay']) {
    ok(new RegExp('<div[^>]*id="' + p + 'PaidFromRow"[^>]*style="display:none;').test(HTML), p + ': row hidden');
    ok(HTML.includes('<select id="' + p + 'PaidFrom" onchange="payTogglePettyCash(\'' + p + '\')">'), p + ': choice');
    ok(new RegExp('<div[^>]*id="' + p + 'PaidPersonRow"[^>]*style="display:none;').test(HTML), p + ': person row hidden');
    ok(HTML.includes('<select id="' + p + 'PaidPerson">'), p + ': person');
  }
  ok(/<p[^>]*id="editPayPettyNote"[^>]*style="display:none;/.test(HTML), 'the read-only note on Edit');
  const a = HTML.indexOf('<script src="js/petty-cash-pick.js?v='), b = HTML.indexOf('<script src="js/expenses-module.js?v=');
  ok(a !== -1 && a < b, 'the helper loads before Project Control');
});

test('a staff buyer adds: Company or My petty cash, and their own id is sent', async () => {
  const f = await payForm('pay', null, STAFF_BUYER());
  eq([f.els.payPaidFromRow.style.display, f.els.payPaidFrom.dataset.shown, f.els.payPaidFrom.value], ['', '1', 'company']);
  ok(f.els.payPaidFrom.innerHTML.includes('value="mine"'), 'My petty cash offered');
  eq(f.choice('2026-11-20T08:00'), { shown: true, holder: null, problem: '', changed: false }, 'company');
  f.els.payPaidFrom.value = 'mine';
  eq(f.choice('2026-11-20T08:00'), { shown: true, holder: 'b-1', problem: '', changed: true }, 'mine');
  eq(f.choice('').problem, 'Petty cash needs the payment date.', 'no date');
});

test('the main owner adds: Petty cash, then whose', async () => {
  const f = await payForm('pay', null, MAIN());
  ok(f.els.payPaidFrom.innerHTML.includes('value="petty_cash"') && f.els.payPaidPerson.innerHTML.includes('value="b-2"'), 'list');
  f.els.payPaidFrom.value = 'petty_cash'; f.els.payPaidPerson.value = 'b-2';
  eq(f.choice('2026-11-20').holder, 'b-2');
});

test('an owner account that is not the main owner sees nothing to choose', async () => {
  const f = await payForm('pay', null, { currentUserRole: 'owner', currentStockMainOwner: false, currentCanBuy: true, me: 'o-2' });
  eq([f.els.payPaidFromRow.style.display, f.els.payPaidFrom.dataset.shown], ['none', undefined]);
  eq(f.choice('2026-11-20'), { shown: false, holder: null, problem: '', changed: false });
});

test('edit: the main owner reopens a row paid from a buyer\'s petty cash', async () => {
  const f = await payForm('editPay', 'b-2', MAIN());
  eq([f.els.editPayPaidFrom.value, f.els.editPayPaidPerson.value, f.els.editPayPaidPersonRow.style.display], ['petty_cash', 'b-2', '']);
  eq(f.choice('2026-11-20'), { shown: true, holder: 'b-2', problem: '', changed: false }, 'saved unchanged: nothing sent');
  f.els.editPayPaidFrom.value = 'company';
  eq(f.choice('2026-11-20'), { shown: true, holder: null, problem: '', changed: true }, 'switched to Company: sent');
});

test('edit: a staff buyer reopens their own row', async () => {
  const f = await payForm('editPay', 'b-1', STAFF_BUYER());
  eq([f.els.editPayPaidFrom.value, f.els.editPayPaidFrom.dataset.shown], ['mine', '1']);
});

test('edit: someone who cannot choose it sees a note and sends nothing', async () => {
  for (const win of [STAFF_BUYER(), { currentUserRole: 'owner', currentStockMainOwner: false, currentCanBuy: true, me: 'o-2' },
                     { currentUserRole: 'staff', currentStockMainOwner: false, currentCanBuy: false, me: 's-9' }]) {
    const f = await payForm('editPay', 'b-2', win);
    eq([f.els.editPayPaidFromRow.style.display, f.els.editPayPaidFrom.dataset.shown, f.els.editPayPettyNote.style.display],
       ['none', undefined, ''], win.me);
    ok(/^Paid from Petty cash.* — only the main owner can change this\.$/.test(f.els.editPayPettyNote.textContent), 'note');
    eq(f.choice('2026-11-20'), { shown: false, holder: null, problem: '', changed: false }, 'nothing sent');
  }
});

test('the saves: every split row carries the person; an edit only when the choice was shown', () => {
  const add = EXP.slice(EXP.indexOf('async function handleAddPayroll('), EXP.indexOf('\nasync function handleEditPayroll('));
  ok(/const _pc = _payPettyChoice\('pay', paymentDate\);/.test(add), 'add reads the choice');
  ok(/if \(_pc\.problem\) \{ showExpNotif\(_pc\.problem, 'error'\); return; \}/.test(add), 'add refuses before sending');
  ok(/\.\.\.\(_pc\.holder && \{ pettyCashBy: _pc\.holder \}\),/.test(add), 'each split row');
  const edit = EXP.slice(EXP.indexOf('async function handleEditPayroll('), EXP.indexOf('// MODAL HELPERS'));
  ok(/const _ePc = _payPettyChoice\('editPay', document\.getElementById\('editPayDate'\)\.value\);/.test(edit), 'edit reads the choice');
  ok(/\.\.\.\(_ePc\.changed && \{ pettyCashBy: _ePc\.holder \}\),/.test(edit), 'edit sends it only when it changed (review I2)');
  for (const [n, s] of [['add', add], ['edit', edit]])
    ok(/showExpNotif\('Error: ' \+ \(window\.DacsPettyCash && window\.DacsPettyCash\.errorText\(err\) \|\| err\.message\), 'error'\)/.test(s), n + ': refusals in words');
});

test('set up each time a payroll form opens', () => {
  ok(/if \(id === 'addPayrollModal'\) _paySetupPettyCash\('pay', null\);/.test(EXP), 'Add');
  ok(/_paySetupPettyCash\('editPay', p\.pettyCashBy \|\| null\);/.test(EXP), 'Edit');
});

// ── 3. The overhead forms (Overhead section, Project Control's Overhead tab) ──
const OVH = read('js/overhead-module.js');
const APP = read('js/portal-app.compiled.js');
const OVH_IDS = ['ovhdPaidFromRow', 'ovhdPaidFrom', 'ovhdPaidPersonRow', 'ovhdPaidPerson', 'ovhdExpStatus'];
async function ovhForm(current, win) {
  const { P } = load(win);
  const pg = page(OVH_IDS);
  pg.els.ovhdExpStatus.value = 'pending';
  const ctx = { document: pg.document, console, _esc: (s) => String(s), _ovhdPcSeq: 0, window: Object.assign(win, { DacsPettyCash: P }) };
  vm.createContext(ctx);
  vm.runInContext(lift(OVH, 'function ovhdTogglePettyCash(') + '\n' + lift(OVH, 'async function _ovhdSetupPettyCash(') +
                  '\n' + lift(OVH, 'function _ovhdPettyChoice(') +
                  '\nthis._setup = _ovhdSetupPettyCash; this._choice = _ovhdPettyChoice; this._toggle = ovhdTogglePettyCash;', ctx);
  await ctx._setup(current);
  return { els: pg.els, choice: (day) => ctx._choice(day), toggle: () => ctx._toggle() };
}

console.log('\nThe overhead forms');

test('Overhead section: "Paid from" and "Whose petty cash", hidden until set up', () => {
  ok(/<div[^>]*id="ovhdPaidFromRow"[^>]*style="display:none;/.test(HTML), 'row hidden');
  ok(HTML.includes('<select id="ovhdPaidFrom" onchange="ovhdTogglePettyCash()">'), 'choice');
  ok(/<div[^>]*id="ovhdPaidPersonRow"[^>]*style="display:none;/.test(HTML), 'person row hidden');
  ok(HTML.includes('<select id="ovhdPaidPerson">'), 'person');
});

test('Overhead section: the main owner picks a buyer\'s petty cash, and it becomes Paid', async () => {
  const f = await ovhForm(null, MAIN());
  eq([f.els.ovhdPaidFromRow.style.display, f.els.ovhdPaidFrom.dataset.shown, f.els.ovhdPaidFrom.value], ['', '1', 'company']);
  ok(!f.els.ovhdPaidFrom.innerHTML.includes('value="mine"'), 'no My petty cash on overhead');
  f.els.ovhdPaidFrom.value = 'petty_cash'; f.els.ovhdPaidPerson.value = 'b-1';
  f.toggle();
  eq([f.els.ovhdPaidPersonRow.style.display, f.els.ovhdExpStatus.value], ['', 'paid']);
  eq(f.choice('2026-11-20'), { shown: true, holder: 'b-1', problem: '', changed: true });
});

test('Overhead section: staff buyers and other owners see nothing; an edit sends nothing', async () => {
  for (const win of [STAFF_BUYER(), { currentUserRole: 'owner', currentStockMainOwner: false, currentCanBuy: true, me: 'o-2' }]) {
    const f = await ovhForm('b-2', win);
    eq([f.els.ovhdPaidFromRow.style.display, f.els.ovhdPaidFrom.dataset.shown], ['none', undefined], win.me);
    eq(f.choice('2026-11-20'), { shown: false, holder: null, problem: '', changed: false });
  }
});

test('Overhead section: an edit reopens whose petty cash — or shows nothing for an unknown person', async () => {
  const f = await ovhForm('b-2', MAIN());
  eq([f.els.ovhdPaidFrom.value, f.els.ovhdPaidPerson.value], ['petty_cash', 'b-2']);
  eq(f.choice('2026-11-20').changed, false, 'saved unchanged: nothing sent');
  const g = await ovhForm('zzz', MAIN());
  eq([g.els.ovhdPaidFromRow.style.display, g.els.ovhdPaidFrom.dataset.shown], ['none', undefined], 'never switches the person silently');
});

test('Overhead section: the save sends it only when shown, Paid for petty cash, refusals in words', () => {
  const save = OVH.slice(OVH.indexOf('async function handleSaveOverheadExpense('), OVH.indexOf('// ── Category Detail Modal'));
  ok(/const _opc = _ovhdPettyChoice\(date\);/.test(save), 'reads the choice');
  ok(/if \(_opc\.problem\) \{ _ovhdToast\(_opc\.problem, 'error'\); return; \}/.test(save), 'refuses before sending');
  ok(/status: _opc\.holder \? 'paid' : status,/.test(save), 'petty cash = Paid');
  ok(/\.\.\.\(_opc\.changed && \{ pettyCashBy: _opc\.holder \}\),/.test(save), 'only when it changed (review I2)');
  ok(/_ovhdToast\('Error saving expense: ' \+ \(window\.DacsPettyCash && window\.DacsPettyCash\.errorText\(err\) \|\| err\.message\), 'error'\)/.test(save), 'refusals');
  ok(/_ovhdSetupPettyCash\(null\);/.test(OVH.slice(OVH.indexOf('function openOverheadModal('), OVH.indexOf('function openOverheadEditModal('))), 'Add sets it up');
  ok(/_ovhdSetupPettyCash\(ex\.pettyCashBy \|\| null\);/.test(OVH), 'Edit sets it up');
});

test('Project Control\'s Overhead tab: the main owner only, Paid for petty cash, sent only when shown', () => {
  const drill = APP.slice(APP.indexOf('function OverheadDrill('), APP.indexOf('\nfunction ', APP.indexOf('function OverheadDrill(') + 10));
  ok(/window\.DacsPettyCash\.loadBuyers\(\)\.then\(/.test(drill), 'the buyer list');
  ok(/window\.DacsPettyCash\.choices\(\{[^}]*overhead: true \}\)/.test(drill), 'overhead choices');
  ok(/const pcShown = pcOpts\.length > 1;/.test(drill), 'shown only with something to choose');
  ok(/\.\.\.\(pcShown && _pcHolder !== \(form\.pcOpened \|\| null\) && \{ pettyCashBy: _pcHolder \}\)/.test(drill.slice(drill.indexOf('const patch = {'), drill.indexOf('const patch = {') + 400)), 'edit: only when it changed (review I2)');
  ok(/\.\.\.\(_pcHolder && \{ pettyCashBy: _pcHolder, status: "paid" \}\),/.test(drill), 'add: only petty cash is sent, and it is Paid (review I2)');
  ok(/if \(_pcHolder\) patch\.status = "paid";/.test(drill), 'edit, Paid');
  ok(/paidFrom: x\.pettyCashBy \? "petty_cash" : "company", pettyPerson: x\.pettyCashBy \|\| "", pcOpened: x\.pettyCashBy \|\| null/.test(drill), 'an edit reopens it and remembers it');
  ok(/alert\("Save failed: " \+ \(window\.DacsPettyCash && window\.DacsPettyCash\.errorText\(err\) \|\| err\.message \|\| err\)\)/.test(drill), 'refusals');
});

test('no overhead form offers "My petty cash"', () => {
  for (const [n, src] of [['overhead-module', OVH], ['portal-app', APP]]) {
    const calls = src.match(/DacsPettyCash\.choices\(\{[^}]*\}\)|P\.choices\(\{[^}]*\}\)/g) || [];
    ok(calls.length >= 1 && calls.every(c => /overhead: true/.test(c)), n + ': ' + calls.join(' | '));
  }
});

// ── 4. Showing it: list tags and payroll vouchers (no pesos) ────────
const INV = read('js/invoice-module.js');
console.log('\nShowing it');

test('Project Control: one tag helper, carried on labor rows and overhead rows', () => {
  ok(/function _pcTag\(uid\) \{ return window\.DacsPettyCash \? window\.DacsPettyCash\.tag\(uid\) : "Petty cash"; \}/.test(APP), '_pcTag');
  ok(/paymentMethod: \(d\.paymentMethod \|\| ""\)\.toString\(\),\n    pettyCashBy: d\.pettyCashBy \|\| null,/.test(APP), 'mapPayrollDoc carries it');
  ok(/receiptUrl: e\.receiptUrl \|\| "", pettyCashBy: e\.pettyCashBy \|\| null \}/.test(APP), 'overhead rows carry it');
});

test('Project Control: the Labor list and the Overhead tab show the tag', () => {
  const payRows = APP.slice(APP.indexOf('const payRows = (list, agreed, paidTotal, daily) =>'), APP.indexOf('const payRows = (list, agreed, paidTotal, daily) =>') + 1600);
  ok(/p\.pettyCashBy \? rc\("span", \{ className: "lc2-mile lc2-petty", title: "Paid from a staff buyer's petty cash" \}, _pcTag\(p\.pettyCashBy\)\) : null/.test(payRows), 'labor');
  ok(/x\.pettyCashBy \? h\("span", \{ className: "lc2-mile lc2-petty", title: "Paid from a staff buyer's petty cash", style: \{ marginLeft: 6 \} \}, _pcTag\(x\.pettyCashBy\)\) : null/.test(APP), 'overhead');
});

test('the Overhead section shows the tag', () => {
  ok(/\$\{ex\.pettyCashBy \? ' <span class="ovhd-src-badge" title="Paid from a staff buyer\\'s petty cash">' \+ _esc\(window\.DacsPettyCash \? window\.DacsPettyCash\.tag\(ex\.pettyCashBy\) : 'Petty cash'\) \+ '<\/span>' : ''\}/.test(OVH), 'row');
});

test('both payroll vouchers say it was paid from petty cash', () => {
  ok(/\$\{p\.pettyCashBy \? '<span class="k">Galing sa \/ Paid from<\/span><span class="v">' \+ esc\(window\.DacsPettyCash \? window\.DacsPettyCash\.tag\(p\.pettyCashBy\) : 'Petty cash'\) \+ '<\/span>' : ''\}/.test(INV), 'acknowledge invoice');
  ok(/\$\{record\.pettyCashBy \? `<tr><td class="rc-label">Paid from<\/td><td class="rc-value">\$\{_mvpEsc\(window\.DacsPettyCash \? window\.DacsPettyCash\.tag\(record\.pettyCashBy\) : 'Petty cash'\)\}<\/td><\/tr>` : ''\}/.test(EXP), 'payroll receipt');
});

test('no tag ever carries a peso', () => {
  for (const [n, src] of [['portal-app', APP], ['overhead-module', OVH], ['invoice-module', INV], ['expenses-module', EXP]]) {
    const lines = src.split('\n').filter(l => /pettyCashBy \?/.test(l));
    ok(lines.length >= 1, n + ': a tag');
    ok(lines.every(l => !/peso\(|₱|\\u20B1|formatNum|_fmtAmt/.test(l)), n + ': ' + lines.find(l => /peso\(|₱|\\u20B1|formatNum|_fmtAmt/.test(l)));
  }
});

// ── 5. The petty cash screens: daily report, print, CSV, buyer card, My cash ──
const PA = require('../js/purchasing-admin-core.js');
const CASH = read('js/purchasing-admin-cash.js');
console.log('\nThe petty cash screens');

const DAY = '2026-11-22';
const REP = { name: 'Juan', from: DAY, to: DAY, opening: 5000, closing: 1700, days: [{
  day: DAY, opening: 5000, received: [], refunds_in: [], payments: [], returns: [], reversals: [], closing: 1700,
  spends: [
    { id: 's1', kind: 'payroll', amount: 1500, label: 'Mario · Mason', place: 'Sample Residence', split_group: null, voided_on: null },
    { id: 's2', kind: 'payroll', amount: 400, label: 'Pedro · Helper', place: 'Sample Residence', split_group: 'g1', voided_on: null },
    { id: 's3', kind: 'payroll', amount: 400, label: 'Pedro · Helper', place: 'Sample Residence', split_group: 'g1', voided_on: null },
    { id: 's4', kind: 'overhead', amount: 800, label: 'Diesel', place: 'Company overhead', split_group: null, voided_on: '2026-11-25' }] }] };

test('split rows show as one line', () => {
  const g = PA.groupSpends(REP.days[0].spends);
  eq(g.map(x => [x.kind, x.amount, x.ids]), [['payroll', 1500, ['s1']], ['payroll', 800, ['s2', 's3']], ['overhead', 800, ['s4']]]);
  eq(PA.groupSpends([{ id: 'a', kind: 'payroll', amount: 400, split_group: 'g1', voided_at: null },
                     { id: 'b', kind: 'payroll', amount: 400, split_group: 'g1', voided_at: '2026-11-25T01:00:00Z', void_reason: 'Payroll entry changed' }]).length,
     2, 'a voided part never merges with a live one');
  eq(PA.SPEND_LABEL, { payroll: 'Paid labor', overhead: 'Paid overhead' });
});

test('the daily report: "Paid labor" / "Paid overhead" lines, money out, voids marked', () => {
  const rows = PA.reportRows(REP).map(r => [r.what, r.detail, r.amountIn, r.amountOut]);
  eq(rows, [
    ['Opening', '', '', ''],
    ['Paid labor', 'Mario · Mason · Sample Residence', '', 1500],
    ['Paid labor', 'Pedro · Helper · Sample Residence', '', 800],
    ['Paid overhead', 'Diesel · Company overhead (voided on 2026-11-25)', '', 800],
    ['Closing', '', '', '']]);
  ok(PA.reportCsv(REP).includes('Paid overhead,Diesel · Company overhead (voided on 2026-11-25),,800.00'), 'the CSV');
});

test('a void of a spend reads as one, on the day it was made', () => {
  const rep = { days: [{ day: '2026-11-25', opening: 0, received: [], refunds_in: [], payments: [], spends: [], returns: [], closing: 800,
    reversals: [{ what: 'Paid overhead', entry_day: DAY, amount: 800, effect: 800, reason: 'Overhead entry deleted' }] }] };
  eq(PA.reportRows(rep)[1], { day: '2026-11-25', what: 'Void: Paid overhead of ' + DAY, detail: 'Overhead entry deleted', amountIn: 800, amountOut: '' });
});

test('the buyer card and My cash list them, with no void button', () => {
  const panel = CASH.slice(CASH.indexOf('async function buyerPanel('), CASH.indexOf('async function buyerPanel(') + 6000);
  ok(/SV\.section\('Paid labor and overhead \(90 days\)', SV\.lines\(PA\.groupSpends\(d\.spends \|\| \[\]\)\.map\(spendLine\), 'None\.'\)\)/.test(panel), 'buyer card');
  const mine = CASH.slice(CASH.indexOf('async function renderMyCash('), CASH.indexOf('async function renderMyCash(') + 6000);
  ok(/SV\.section\('Paid labor and overhead \(90 days\)', SV\.note\(esc\('Labor and overhead you paid from your petty cash\. Edited or deleted in Project Control, never here\.'\)\) \+\s*SV\.lines\(PA\.groupSpends\(d\.spends \|\| \[\]\)\.map\(spendLine\), 'Nothing here\.'\)\)/.test(mine), 'My cash');
  ok(!/data-void-spend/.test(CASH), 'a spend is voided by editing or deleting its entry');
  ok(/function spendLine\(x\) \{/.test(CASH), 'one line renderer');
});

test('one line: day, amount, what, who and where; a voided one says why', () => {
  // A line item for SV.lines (which escapes t and s).
  const ctx = { PA: { peso: (n) => 'P' + n, SPEND_LABEL: PA.SPEND_LABEL } };
  vm.createContext(ctx);
  const at = CASH.indexOf('    function spendLine(x) {');
  ok(at >= 0, 'spendLine exists');
  vm.runInContext(CASH.slice(at, CASH.indexOf('\n    }\n', at) + 6) + '\nthis.f = spendLine;', ctx);
  eq(ctx.f({ kind: 'payroll', amount: 800, spent_on: DAY, label: 'Pedro · Helper', place: 'Sample Residence', voided_at: null }),
     { t: 'P800 · Paid labor', s: DAY + ' — Pedro · Helper · Sample Residence', dim: false, pills: [] });
  eq(ctx.f({ kind: 'overhead', amount: 50, spent_on: DAY, label: 'Ice', place: '', voided_at: 'x', void_reason: 'Overhead entry deleted' }),
     { t: 'P50 · Paid overhead', s: DAY + ' — Ice — voided: Overhead entry deleted', dim: true, pills: [{ text: 'Voided', tone: 'red' }] });
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
