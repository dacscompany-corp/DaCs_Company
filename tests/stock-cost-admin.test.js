// ════════════════════════════════════════════════════════════════════
// STOCK COST MOVES (0105, 2C):  run with  node tests/stock-cost-admin.test.js
//
// Zero dependencies. Loads the REAL js/stock-cost-admin.js and
// js/stock-admin.js (their pure halves) and reads the screens' source:
//   1. The words agree with the server: every refusal 0105 can send has a
//      sentence; the states read as the spec words them.
//   2. Pesos: only owner accounts get a value (the server leaves the keys out
//      for anyone else); the Stock screen file still shows none; Project
//      Control and Expenses never edit, delete or guess Cover for a cost-move
//      row; the browser never computes a value or writes an expense row.
//   3. Wiring: the cards in Purchasing → Owner approvals and Stock → Waiting
//      for owner, the Company stock tab for owner accounts once stock is on,
//      the script tags, every write sent once.
// ════════════════════════════════════════════════════════════════════
'use strict';
const sc = require('../js/stock-cost-admin.js');
const sa = require('../js/stock-admin.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0105_stock_cost_moves.sql');
const JS = read('js/stock-cost-admin.js');
const BROWSER = JS.slice(JS.indexOf('// ── Browser'));
const STOCK = read('js/stock-admin.js');
const EXP = read('js/expenses-module.js');

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

console.log('\ncost moves: the words agree with the server');

test('every refusal 0105 can send has a sentence where it is shown', () => {
  const codes = [...new Set([...SQL.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))];
  // Expense-row and delete guards (triggers) are worded where they surface: Expenses.
  const expensesWords = ['PURCHASE_ROW', 'PURCHASES_LIVE', 'STOCK_COST_ROW', 'STOCK_LIVE', 'STOCK_COST_IN_USE', 'STOCK_COST_FUNDING'];
  for (const c of codes) {
    if (expensesWords.includes(c)) { ok(new RegExp('\\b' + c + ':').test(EXP), c + ' has no sentence in Expenses'); continue; }
    ok(sc.ERRORS[c] || sa.ERRORS[c], c + ' has no sentence');
  }
  for (const c of ['COST_MOVED', 'STOCK_COST_IN_USE']) ok(sa.ERRORS[c], c + ' on the Stock screen');
  for (const c of ['NOTHING_LEFT', 'COMPLETED_PROJECT', 'LATER_MOVES_FIRST', 'OWNER_ONLY']) ok(sc.ERRORS[c], c + ' on the cost forms');
  ok(sc.errorMessage({ message: 'LATER_MOVES_FIRST' }).includes('Reverse those first'), 'a code becomes a sentence');
  // A correction or re-fund refused for stock reasons reads in words where it is made: Expenses and Purchasing (rev 2).
  const purchasing = read('js/purchasing-admin-core.js');
  for (const c of ['STOCK_IN_USE', 'STOCK_COST_IN_USE', 'STOCK_COST_FUNDING']) {
    ok(new RegExp('\\b' + c + ':').test(purchasing), c + ' has no sentence in Purchasing');
    ok(new RegExp('\\b' + c + ':').test(EXP), c + ' has no sentence in Expenses');
  }
});

test('the states, as the spec words them (Q11, Q12, Q10, Q27)', () => {
  const s = (kind, status, reversed) => sa.costState({ kind, status, reversed })[0];
  eq([s('assign', 'pending'), s('transfer', 'pending'), s('back', 'pending')],
     ['Cost assignment pending', 'Cost transfer pending', 'Back to company stock — pending']);
  eq([s('assign', 'approved'), s('transfer', 'approved'), s('back', 'approved'), s('loss', 'approved')],
     ['Cost assigned', 'Cost transferred', 'Cost back in company stock', 'Company stock loss']);
  eq([s('assign', 'rejected'), s('assign', 'withdrawn'), s('assign', 'approved', true)],
     ['Cost move rejected — kept with source', 'Cost request withdrawn', 'Cost move reversed']);
  eq(sa.costText({ status: 'approved', approved_quantity: 3, quantity: 5, from_name: 'Company stock', to_name: 'Barlin' }, 'bag'),
     '3 bag: Company stock → Barlin', 'an approved one shows what it charged');
});

test('who may do what: the main owner decides and reverses; a recorder asks again once', () => {
  const owner = { isMainOwner: true }, staff = { isMainOwner: false };
  eq(sa.costActions({ status: 'pending', kind: 'assign' }, owner, [], true), ['approve', 'reject']);
  eq(sa.costActions({ status: 'pending', kind: 'assign' }, staff, [], true), []);
  eq(sa.costActions({ status: 'approved', kind: 'transfer' }, owner, [], true), ['reverse']);
  eq(sa.costActions({ status: 'approved', kind: 'loss' }, owner, [], true), [], 'a loss goes with its count');
  const rejected = { id: 'a', move_id: 7, status: 'rejected', kind: 'assign' };
  eq(sa.costActions(rejected, staff, [rejected], true), ['resubmit']);
  eq(sa.costActions(rejected, staff, [rejected], false), [], 'not a stock recorder');
  eq(sa.costActions(rejected, staff, [rejected, { id: 'b', move_id: 7, status: 'pending' }], true), [], 'already asked again');
  eq(sa.costActions(rejected, staff, [rejected, { id: 'b', move_id: 8, status: 'pending' }], true), ['resubmit'], 'another movement');
  const reversed = { id: 'c', move_id: 9, status: 'approved', reversed: true, kind: 'assign' };
  eq(sa.costActions(reversed, owner, [reversed], true), ['resubmit'], 'reversed (say, to fix the price): ask again');
});

console.log('\ncost moves: pesos');

test('a value only when the server sent one (owner accounts); negative and estimates read plainly', () => {
  eq(sc.valueText({ value: 400 }), '₱400.00');
  eq(sc.valueText({ estimate: 328.35 }), 'about ₱328.35');
  eq(sc.valueText({ status: 'pending', quantity: 4 }), '', 'staff: no keys, nothing shown');
  eq(sc.peso(-1234.5), '−₱1,234.50');
  eq(sc.groupText({ cover: true, carries: 400 }), 'Cover carries ₱400.00');
  eq(sc.groupText({ billing_number: 2, month: 'October', year: 2026, carries: 600 }), 'Billing #2 (October 2026) carries ₱600.00');
});

test('the server sends values to owner accounts only, and nothing of them to anyone else', () => {
  ok(/\|\| case when coalesce\(is_owner\(\), false\) then jsonb_build_object\(\s+'value', c\.value,/.test(SQL), 'value keys only for owners');
  ok(/else '\{\}'::jsonb end\s+from stk_cost_moves c where c\.id = p_cost/.test(SQL), 'no keys otherwise');
  ok(/create or replace function stk_cost_pending\(\)[\s\S]*?declare v_owner uuid := pur_main_owner\(\);/.test(SQL), 'the cards: main owner');
  ok(/create or replace function stk_company_stock\(\)[\s\S]*?if not coalesce\(is_owner\(\), false\) then\s+raise exception 'NOT_ALLOWED'/.test(SQL), 'company stock: owners');
  for (const f of ['stk_cost_decide', 'stk_cost_reverse']) {
    ok(new RegExp('create or replace function ' + f + '\\([\\s\\S]*?v_owner uuid := pur_main_owner\\(\\);').test(SQL), f + ': main owner');
  }
});

test('the Stock screen file still holds no peso; this file computes none and writes no expense row', () => {
  ok(!/₱|peso|amount|price|toFixed\(2\)/i.test(STOCK.replace(/\/\/[^\n]*/g, '')), 'stock-admin.js shows money');
  ok(!/\.from\(/.test(JS), 'no direct table read');
  ok(!/expenses|insert|\* *Number\(c\.(value|estimate)/.test(BROWSER.replace(/\/\/[^\n]*/g, '')), 'no expense write, no value arithmetic');
  ok(/c\.value !== undefined && c\.value !== null/.test(JS), 'the value is the server\'s');
});

test('Expenses: a cost-move row is never edited, deleted or guessed into Cover', () => {
  const del = EXP.slice(EXP.indexOf('async function deleteExpense('));
  ok(del.indexOf('pe.stkCostMoveId') !== -1 && del.indexOf('pe.stkCostMoveId') < del.indexOf('pe.purchaseLineId || pe.purchaseChargeId'), 'delete refuses first');
  const edit = EXP.slice(EXP.indexOf('_editingPurchase = null;\n    _purEditOpId = null;'));
  ok(/^_editingPurchase = null;\n    _purEditOpId = null;\n    if \(e\.stkCostMoveId\) \{ showExpNotif\(/.test(edit), 'edit refuses first');
  ok(/if \(e\.purchaseLineId \|\| e\.purchaseChargeId \|\| e\.stkCostMoveId\) return;/.test(EXP), 'its Cover flag is the server\'s');
  ok(/const purBadge = e\.stkCostMoveId\s+\? '<span title="Moved from stock[^']*>Stock cost move<\/span>'/.test(EXP), 'tagged');
  const split = require('../js/expense-split-rows.js');
  eq([split.isStockCostRow({ stkCostMoveId: 'k' }), split.isStockCostRow({ _parts: [{}, { stkCostMoveId: 'k' }] }), split.isStockCostRow({ purchaseLineId: 'l' })],
     [true, true, false]);
});

console.log('\ncost moves: wiring');

test('only this file calls the cost-move functions; every cost write is sent once', () => {
  const called = [...new Set([...BROWSER.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]))].sort();
  eq(called, ['stk_company_stock', 'stk_cost_decide', 'stk_cost_pending', 'stk_cost_resubmit', 'stk_cost_reverse']);
  const granted = [...SQL.matchAll(/grant execute on function ([a-z_]+)\(/g)].map(m => m[1]);
  for (const f of called) ok(granted.includes(f), f + ' is not granted by 0105');
  for (const w of ['stk_cost_decide', 'stk_cost_resubmit', 'stk_cost_reverse']) {
    ok(new RegExp("sendOnce\\(\\(opId[^)]*\\) => RA\\.rpc\\('" + w + "'").test(BROWSER), w + ' goes through sendOnce');
    ok((BROWSER.match(new RegExp("RA\\.rpc\\('" + w + "'", 'g')) || []).length === 1, w + ' is called in one place');
  }
  const others = fs.readdirSync(path.join(__dirname, '..', 'js')).filter(f => f.endsWith('.js') && !['stock-admin.js', 'stock-cost-admin.js'].includes(f));
  for (const f of others) ok(!/rpc\(\s*'stk_(cost_|company_stock)/.test(read('js/' + f)), f + ' calls a cost-move function');
});

test('Owner approvals and Waiting for owner show the cards; Company stock is a tab for owner accounts once stock is on', () => {
  const list = read('js/purchasing-admin-list.js');
  const purchases = read('js/purchasing-admin-purchases.js');
  ok(/function companyStockTab\(\) \{\s+return !!\(root\.StockCostAdmin && root\.currentStockOn && PA\.ui\.isOwner\);/.test(list), 'the tab rule');
  ok(/\(companyStockTab\(\) \? t\('company', 'Company stock'\) : ''\)/.test(list), 'the tab');
  ok(/if \(ui\.tab === 'company' && companyStockTab\(\)\) return root\.StockCostAdmin\.renderCompanyStock\(/.test(list), 'its body');
  ok(/\(me\.isOwner && root\.StockCostAdmin \? '<div data-stock-costs><\/div>' : ''\)/.test(purchases), 'owner approvals');
  ok(/if \(costs\) root\.StockCostAdmin\.renderApprovals\(costs\);/.test(purchases), 'cards drawn');
  ok(/if \(m\.isMainOwner && root\.StockCostAdmin\) root\.StockCostAdmin\.renderApprovals\(/.test(STOCK), 'Waiting for owner');
  const html = read('admin.html');
  const a = html.indexOf('<script src="js/stock-admin.js?v='), b = html.indexOf('<script src="js/stock-cost-admin.js?v=');
  ok(a !== -1 && b > a, 'stock-cost-admin.js loads after stock-admin.js');
  ok(html.indexOf('js/requests-admin-core.js') < b, 'after RequestsAdmin');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
