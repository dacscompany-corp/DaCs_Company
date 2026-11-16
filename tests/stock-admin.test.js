// ════════════════════════════════════════════════════════════════════
// STOCK SCREENS (0104, 2B-a):  run with  node tests/stock-admin.test.js
//
// Zero dependencies. Loads the REAL js/stock-admin.js (its pure half) and
// reads the screens' source:
//   1. The words and checks agree with the server: every refusal has a
//      sentence, record kinds and count reasons match 0104, the forms refuse
//      what the server would refuse.
//   2. Quantities only: the screens read no table and show no peso amount.
//   3. Wiring: Requests → Stock is hidden until stock is switched on (the main
//      owner sees the switch); the old "Add to inventory" tick and Inventory
//      screen go once it is on; the shopping list's hint and "Issue from
//      stock"; every write is sent once.
// ════════════════════════════════════════════════════════════════════
'use strict';
const sa = require('../js/stock-admin.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0104_stock.sql');
const JS = read('js/stock-admin.js');
const BROWSER = JS.slice(JS.indexOf('// ── Browser'));

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

console.log('\nstock: the words agree with the server');

test('every refusal 0104 can send has a sentence (and the helpers\' it reaches)', () => {
  const codes = [...new Set([...SQL.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))]
    // HISTORY_IMMUTABLE: a trigger on direct table writes, never an RPC answer;
    // BUYER_REQUIRED: the shopping list's (Purchasing), redefined here unchanged;
    // OFFICE_ONLY / DUPLICATE_ITEM: the catalogue save's (0092, redefined here) —
    // the Catalogue screen words them (requests-admin-core, checked below).
    .filter(c => !['HISTORY_IMMUTABLE', 'BUYER_REQUIRED', 'OFFICE_ONLY', 'DUPLICATE_ITEM'].includes(c));
  ok(codes.length >= 30, 'codes read: ' + codes.length);
  for (const c of codes) ok(sa.ERRORS[c], c + ' has no sentence');
  // Reached through pur_actor_owner, pur_main_owner, pur_op_begin, pur_note, pur_reason, pur_past_day.
  for (const c of ['NOT_OFFICE', 'NOT_ALLOWED', 'OWNER_ONLY', 'BAD_OP', 'BAD_NOTE', 'REASON_REQUIRED', 'BAD_DATE']) ok(sa.ERRORS[c], c);
  ok(/stk_set_enabled|STOCK_OFF/.test(sa.errorMessage({ message: 'STOCK_OFF' })) || sa.errorMessage({ message: 'STOCK_OFF' }).includes('switch'), 'stock off');
  eq(sa.errorMessage({ message: 'NOT_ENOUGH', hint: 'Only 3 there.' }), sa.ERRORS.NOT_ENOUGH + ' (Only 3 there.)', 'the hint says how much is there');
  eq(sa.errorMessage({ message: 'STOCK_IN_USE', hint: 'x' }), sa.ERRORS.STOCK_IN_USE, 'no hint where the sentence says it all');
  eq(sa.errorMessage({ code: 'PGRST202', message: 'Could not find' }), sa.ERRORS.PGRST202);
  ok(/^Something went wrong: /.test(sa.errorMessage({ message: 'weird' })));
});

test('an item in use by stock keeps its kind and unit, and the Catalogue screen says why', () => {
  const ra = require('../js/requests-admin-core.js');
  ok(/stock/.test(ra.ERRORS.ITEM_IN_USE) && ra.ERRORS.ITEM_IN_USE.includes('new item'), 'the Catalogue sentence names stock');
  for (const c of ['OFFICE_ONLY', 'DUPLICATE_ITEM', 'ITEM_IN_USE']) ok(ra.ERRORS[c], c + ' worded on the Catalogue screen');
  ok(/'in_use', pr_item_in_use\(c\.id\)/.test(SQL), 'the catalogue list locks Kind and Unit for stock too');
  const save = SQL.slice(SQL.indexOf('create or replace function pr_office_save_item'), SQL.indexOf('create or replace function pr_office_catalog'));
  ok(/if \(p_kind <> v_kind or btrim\(p_unit\) <> v_unit\)\s+and pr_item_in_use\(p_item\) then\s+raise exception 'ITEM_IN_USE'/.test(save),
     'the save itself refuses before updating (the trigger is the backstop)');
  ok(/create trigger stk_item_fixed before update of kind, unit on pr_catalog_items/.test(SQL), 'no path around the save');
  for (const t of ['stk_matches', 'stk_lots', 'stk_records', 'pr_lines']) ok(new RegExp('from ' + t + ' \\w+ where \\w+\\.(item_id|catalog_item_id) = p_item').test(SQL), t);
});

test('layers in words: each delivery with the day it was received, oldest first', () => {
  eq(sa.layerText([{ received_on: '2026-10-02', name: 'Warehouse', quantity: 5 }, { received_on: '2026-10-17', name: 'Barlin <AW>', quantity: 2.5 }]),
     'Received 2 Oct 2026 · Warehouse 5<br>Received 17 Oct 2026 · Barlin &lt;AW&gt; 2.5');
  eq(sa.layerText([]), '');
  ok(/order by l\.received_on, l\.received_at, l\.layer/.test(SQL), 'the server issues in that order');
});

test('every record kind of 0104 has a label; count reasons are the server\'s, in order', () => {
  const kinds = SQL.match(/kind text not null check \(kind in \(('receive'[^)]*)\)\)/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  eq(Object.keys(sa.KIND_LABEL).sort(), kinds.slice().sort());
  const reasons = SQL.match(/v_reason not in \(([^)]*)\)/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
  eq(sa.COUNT_REASONS.map(r => r[0]), reasons);
});

test('quantities parse as the server\'s pur_qty: at most 3 decimals, up to 1,000,000; zero only for a count', () => {
  eq([sa.parseQty('12'), sa.parseQty('1,250.5'), sa.parseQty('0.001'), sa.parseQty(' 7 ')], [12, 1250.5, 0.001, 7]);
  eq([sa.parseQty('1.2345'), sa.parseQty('-1'), sa.parseQty('1e3'), sa.parseQty(''), sa.parseQty('0'), sa.parseQty('1000001')],
     [null, null, null, null, null, null]);
  eq(sa.parseQty('0', true), 0, 'a count of nothing');
});

test('an issue / move is refused before sending where the server would refuse it', () => {
  const ctx = { today: '2026-10-25' };
  const st = (x) => Object.assign({ itemId: 'i1', from: 'warehouse', to: 'f1', quantity: '6', on: '2026-10-25', requestLineId: 'l1' }, x);
  eq(sa.moveProblems(st(), ctx), []);
  eq(sa.moveProblems(st({ requestLineId: null }), ctx), ['UNPLANNED_REASON_REQUIRED'], 'Q8: goods into a project fill a request or say why');
  eq(sa.moveProblems(st({ requestLineId: null, unplannedReason: 'slab' }), ctx), []);
  eq(sa.moveProblems(st({ to: 'warehouse', from: 'f1' }), ctx), ['BAD_REQUEST_LINK'], 'never a request for the warehouse');
  eq(sa.moveProblems(st({ to: 'warehouse', from: 'f1', requestLineId: null }), ctx), []);
  eq(sa.moveProblems(st({ to: 'warehouse' }), ctx), ['BAD_LOCATION', 'BAD_REQUEST_LINK']);
  eq(sa.moveProblems(st({ quantity: '1.0001' }), ctx), ['BAD_QUANTITY']);
  eq(sa.moveProblems(st({ on: '2026-10-26' }), ctx), ['BAD_DATE'], 'not tomorrow');
  eq(sa.moveProblems(st({ itemId: '' }), ctx), ['BAD_ITEM']);
  eq(sa.moveProblems({ itemId: 'i1', quantity: '2', on: '2026-10-25', returnsRecord: 'r1' }, ctx), [], 'a return names only its issue');
});

test('the move body says exactly what the server reads, and the kind it will be', () => {
  eq(sa.moveBody({ itemId: 'i1', from: 'warehouse', to: 'f1', quantity: '1,000', on: '2026-10-25', requestLineId: 'l1', unplannedReason: 'x', note: ' n ' }),
     { item_id: 'i1', quantity: '1000', on: '2026-10-25', note: 'n', from: 'warehouse', to: 'f1', request_line_id: 'l1' });
  eq(sa.moveBody({ itemId: 'i1', from: 'f1', to: 'f2', quantity: '2', on: '2026-10-25', unplannedReason: ' slab ', lotId: 'lot1' }),
     { item_id: 'i1', quantity: '2', on: '2026-10-25', note: '', from: 'f1', to: 'f2', unplanned_reason: 'slab', lot_id: 'lot1' });
  eq(sa.moveBody({ itemId: 'i1', from: 'f1', to: 'warehouse', quantity: '2', on: '2026-10-25', requestLineId: 'l1' }),
     { item_id: 'i1', quantity: '2', on: '2026-10-25', note: '', from: 'f1', to: 'warehouse' }, 'nothing about requests to the warehouse');
  eq(sa.moveBody({ itemId: 'i1', quantity: '2', on: '2026-10-25', returnsRecord: 'r1' }),
     { item_id: 'i1', quantity: '2', on: '2026-10-25', note: '', returns_record: 'r1' });
  eq([sa.moveKind({ from: 'warehouse', to: 'f1' }), sa.moveKind({ from: 'f1', to: 'f2' }), sa.moveKind({ from: 'f1', to: 'warehouse' }),
      sa.moveKind({ returnsRecord: 'r1' })], ['issue', 'move', 'move', 'return']);
  ok(/v_kind := case when v_from = stk_warehouse\(v_owner\) then 'issue' else 'move' end/.test(SQL), 'the server decides the same way');
});

test('a match: the same unit is one for one; another unit needs a note and someone who did not buy it (Q5)', () => {
  const line = { unit: 'bag', quantity: 20, can_check: true };
  const bag = { unit: 'Bag' }, pc = { unit: 'piece' };
  eq(sa.matchProblems(line, bag, '20', ''), []);
  eq(sa.matchProblems(line, bag, '19', ''), ['BAD_QUANTITY']);
  eq(sa.matchProblems(line, pc, '1000', ''), ['REASON_REQUIRED']);
  eq(sa.matchProblems(line, pc, '1000', '20 bags = 1000 pcs'), []);
  eq(sa.matchProblems(Object.assign({}, line, { can_check: false }), pc, '1000', 'x'), ['OWN_PURCHASE']);
  eq(sa.matchProblems(line, null, '20', ''), ['BAD_ITEM']);
  eq([sa.needsMatch({ match: null, auto_item_id: null }), sa.needsMatch({ match: null, auto_item_id: 'i' }), sa.needsMatch({ match: {} })],
     [true, false, false]);
});

test('a count: a difference needs one of the server\'s reasons; zero is a count', () => {
  const ctx = { today: '2026-10-25' };
  const st = (x) => Object.assign({ itemId: 'i1', at: 'warehouse', counted: '8', on: '2026-10-25', reason: '' }, x);
  eq(sa.countProblems(st(), 8, ctx), []);
  eq(sa.countProblems(st(), 10, ctx), ['REASON_REQUIRED']);
  eq(sa.countProblems(st({ reason: 'damaged' }), 10, ctx), []);
  eq(sa.countProblems(st({ counted: '0', reason: 'lost' }), 10, ctx), []);
  eq(sa.countProblems(st({ reason: 'stolen' }), 10, ctx), ['REASON_REQUIRED']);
  eq(sa.countProblems(st(), null, ctx), [], 'books unknown on screen: the server decides');
});

test('who may reverse or withdraw (Q23): matches the server\'s rule', () => {
  const me = { userId: 'u1', isOwner: false, isMainOwner: false };
  const owner = { userId: 'o', isOwner: true, isMainOwner: true };
  const admin = { userId: 'a', isOwner: true, isMainOwner: false };
  const r = (x) => Object.assign({ kind: 'issue', status: 'done', reversed: false, recorded_by: 'u1', quantity: 5, book_quantity: null }, x);
  eq([sa.canReverse(r(), me), sa.canReverse(r({ recorded_by: 'u2' }), me), sa.canReverse(r({ recorded_by: 'u2' }), admin)], [true, false, true]);
  eq([sa.canReverse(r({ reversed: true }), owner), sa.canReverse(r({ status: 'rejected' }), owner), sa.canReverse(r({ status: 'withdrawn' }), owner)],
     [false, false, false]);
  eq([sa.canReverse(r({ status: 'pending', kind: 'count' }), me), sa.canReverse(r({ status: 'pending', kind: 'count', recorded_by: 'u2' }), owner),
      sa.canReverse(r({ status: 'pending', kind: 'count', recorded_by: 'u2' }), admin)], [true, true, false]);
  eq([sa.canReverse(r({ kind: 'opening' }), me), sa.canReverse(r({ kind: 'opening' }), admin), sa.canReverse(r({ kind: 'opening' }), owner)],
     [false, false, true], 'a confirmed opening: the main owner only');
  eq(sa.canReverse(r({ kind: 'count', quantity: 8, book_quantity: 8 }), owner), false, 'a count that changed nothing');
  ok(/r\.kind in \('count', 'opening'\)[\s\S]{0,80}pur_is_main_owner\(\)/.test(SQL), 'the server: count and opening, main owner');
  ok(/auth\.uid\(\) <> r\.recorded_by and not is_owner\(\)/.test(SQL), 'the server: recorder or an owner account');
});

test('records in words; places: the warehouse first, completed projects last and marked (Q16)', () => {
  eq(sa.recordText({ kind: 'issue', item_name: 'Cement', item_unit: 'bag', quantity: 6, from_name: 'Warehouse', to_name: 'Barlin' }),
     '6 bag Cement — Warehouse → Barlin');
  eq(sa.recordText({ kind: 'receive', line_item: 'Tie wire box', line_unit: 'box', quantity: 2 }), '2 box Tie wire box received at the warehouse');
  eq(sa.recordText({ kind: 'count', item_name: 'Cement', quantity: 8, book_quantity: 10, to_name: 'Warehouse' }), 'Cement at Warehouse: counted 8, books 10');
  eq(sa.countDifference({ quantity: 8, book_quantity: 10 }), '-2');
  eq(sa.countDifference({ quantity: 12.5, book_quantity: 10 }), '+2.5');
  eq(sa.requestText({ request_line_id: 'l', request_description: 'Cement' }), 'For request: Cement');
  eq(sa.requestText({ unplanned_reason: 'slab' }), 'Unplanned: slab');
  eq(sa.recordState({ status: 'pending' }), ['Waiting for the owner', 'working']);
  eq(sa.recordState({ status: 'done', reversed: true }), ['Reversed', 'abandoned']);
  eq(sa.placeOptions({ projects: [{ folder_id: 'a', name: 'Old', completed: true }, { folder_id: 'b', name: 'Barlin', completed: false }] }),
     [{ value: 'warehouse', label: 'Warehouse' }, { value: 'b', label: 'Barlin' }, { value: 'a', label: 'Old (completed)' }]);
});

console.log('\nstock: quantities only');

test('the Stock screens read no table, write only through 0104\'s functions, and show no peso amount', () => {
  ok(!/\.from\(/.test(JS), 'no direct table read');
  ok(!/₱|peso|amount|price|toFixed\(2\)/i.test(JS.replace(/\/\/[^\n]*/g, '')), 'no money on screen');
  const called = [...new Set([...BROWSER.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]))].sort();
  const granted = [...SQL.matchAll(/grant execute on function ([a-z_]+)\(/g)].map(m => m[1]);
  for (const f of called) ok(granted.includes(f), f + ' is not a granted 0104 function');
  eq(called, ['stk_choices', 'stk_count', 'stk_decide', 'stk_item', 'stk_leftover', 'stk_match', 'stk_move', 'stk_not_delivered',
              'stk_opening', 'stk_overview', 'stk_project_lines', 'stk_receive', 'stk_request_lines', 'stk_reverse', 'stk_set_enabled', 'stk_status']);
});

test('every stock write is sent once: one operation id per form, kept across retries', () => {
  const writes = ['stk_move', 'stk_leftover', 'stk_count', 'stk_opening', 'stk_match', 'stk_receive', 'stk_not_delivered', 'stk_reverse', 'stk_decide'];
  for (const w of writes) {
    ok(new RegExp("sendOnce\\(\\(opId[^)]*\\) => RA\\.rpc\\('" + w + "'").test(BROWSER), w + ' goes through sendOnce');
    ok((BROWSER.match(new RegExp("RA\\.rpc\\('" + w + "'", 'g')) || []).length === 1, w + ' is called in one place');
  }
  ok(/function sendOnce\(fn\) \{\s+const opId = newOp\(\);\s+return \(\.\.\.args\) => fn\(opId, \.\.\.args\);/.test(BROWSER), 'the id is made once per form');
  ok(/randomUUID/.test(BROWSER), 'a real uuid');
});

console.log('\nstock: wiring');

test('Requests → Stock: in the nav, the view list and the page; hidden until stock is on, except from the main owner', () => {
  const admin = read('js/admin.js');
  const html = read('admin.html');
  ok(/\{ view: 'reqStock',\s+label: 'Stock',\s+icon: 'warehouse' \}/.test(admin), 'PRIMARY_NAV entry');
  ok(/if \(!window\.currentStockOn && !window\.currentStockMainOwner\) hidden\.push\('reqStock'\);/.test(admin), 'hidden until on');
  ok(/const \{ data: stk \} = await window\.sbClient\.rpc\('stk_status'\);/.test(admin), 'the server says (before 0104: hidden)');
  ok(/window\.currentStockOn = !!\(stk && stk\.enabled\);/.test(admin) && /window\.currentStockMainOwner = !!\(stk && stk\.is_main_owner\);/.test(admin));
  ok(/const REQ_VIEWS\s+= \[[^\]]*'reqStock'[^\]]*\]/.test(html), 'REQ_VIEWS');
  ok(/<div id="reqStockView"\s+class="content-view" style="display: none;"><\/div>/.test(html), 'the page');
  ok(/reqStock:\s+'Stock',/.test(html), 'the title');
  const core = html.indexOf('js/requests-admin-core.js'), stock = html.indexOf('<script src="js/stock-admin.js?v=');
  ok(core > 0 && stock > core && stock > html.indexOf('js/purchasing-admin-list.js'), 'loaded after Requests and the shopping list');
  ok(/RA\.views\.reqStock = render;/.test(JS), 'the view is registered');
  ok(/if \(!status \|\| !status\.enabled\) return renderOff\(host, status\);/.test(BROWSER), 'off: nothing but the switch');
  ok(/form\.word\.value\.trim\(\) !== 'STOCK'/.test(BROWSER), 'the switch needs STOCK typed');
});

test('a focused account the server lets record stock gets Requests → Stock, menu and view guard — and nothing else of Requests', () => {
  const vm = require('vm');
  const src = read('js/admin.js');
  const slice = src.slice(src.indexOf('const PRIMARY_NAV = ['), src.indexOf('function findPrimaryForView('));
  // As admin.js sets them at sign-in: currentCanBuy from pur_me, currentStockOn /
  // currentStockMainOwner from stk_status (enabled = may record AND switched on).
  const run = ({ role = 'staff', modules = ['expenses'], buyer = false, on = false, mainOwner = false }) => {
    const sb = { window: { currentCanBuy: buyer, currentStockOn: on, currentStockMainOwner: mainOwner },
                 currentUserRole: role, currentAllowedModules: modules };
    vm.createContext(sb);
    vm.runInContext(slice + '\nthis.__nav = _visibleNav(); this.__views = window.focusAllowedViews();', sb);
    const req = sb.__nav.find(p => p.id === 'requests');
    return { req: req ? { sub: req.sub, def: req.defaultView, views: req.modules.map(m => m.view) } : null,
             views: sb.__views, ids: sb.__nav.map(p => p.id) };
  };
  const NOT_REQUESTS = ['reqQueue', 'reqDetail', 'reqBatches', 'reqTeams', 'reqCatalog', 'reqHistory', 'reqProjects'];
  const noneOf = (views, list) => list.every(v => !views.includes(v));

  // Expenses-only staff, no Buyer switch.
  let r = run({ buyer: false, on: false });
  eq(r.req, null, 'stock off, not a buyer: no Requests tab');
  ok(!r.views.includes('reqStock') && !r.views.includes('reqPurchasing'), 'and the view guard keeps them out');
  r = run({ buyer: false, on: true });
  eq(r.req, { sub: 'Stock', def: 'reqStock', views: ['reqStock'] }, 'stock on: Requests holding Stock alone');
  ok(r.views.includes('reqStock') && noneOf(r.views, NOT_REQUESTS.concat(['reqPurchasing', 'reqPurchase'])), 'the guard lets Stock in, nothing else of Requests');
  ok(r.ids.includes('expenses'), 'their own section stays');

  // Expenses-only staff WITH the Buyer switch.
  r = run({ buyer: true, on: false });
  eq(r.req, { sub: 'Purchasing', def: 'reqPurchasing', views: ['reqPurchasing', 'reqPurchase'] }, 'stock off: Purchasing only, as before');
  ok(!r.views.includes('reqStock'), 'no Stock while it is off');
  r = run({ buyer: true, on: true });
  eq(r.req, { sub: 'Purchasing & Stock', def: 'reqPurchasing', views: ['reqPurchasing', 'reqStock', 'reqPurchase'] }, 'stock on: Purchasing and Stock');
  ok(r.views.includes('reqStock') && r.views.includes('reqPurchasing') && noneOf(r.views, NOT_REQUESTS), 'the guard: both, nothing else');

  // Existing restrictions stay.
  eq(run({ modules: ['pm'], on: false }).req, null, 'a PM-only account (the server says it may not record): no Requests');
  eq(run({ role: 'worker', modules: ['construction'], on: true }).req, null, 'a worker never gets Requests, even if a flag were wrong');
  eq(run({ role: 'teamLeader', modules: ['construction'], on: true, buyer: true }).req, null, 'nor a team leader');
  const focusedReq = run({ modules: ['requests'], on: false }).req;
  ok(focusedReq && focusedReq.views.includes('reqQueue') && !focusedReq.views.includes('reqStock'), 'focused on Requests: all of it, Stock only once on');
  const onReq = run({ modules: ['requests'], on: true, buyer: true }).req;
  ok(onReq.views.includes('reqStock') && onReq.views.includes('reqQueue') && onReq.views.includes('reqPurchasing')
     && onReq.sub === 'Materials & Tools' && onReq.def === 'reqQueue', '…and Stock once on, with all the rest — never narrowed to Stock');
  const full = run({ modules: null, on: false }).req;
  ok(full.views.includes('reqQueue') && !full.views.includes('reqStock'), 'unfocused staff: Requests as before, no Stock while off');
  eq(run({ modules: null, on: false }).views, [], 'an unfocused account has no view guard list (all views)');
  // The main owner, focused on Expenses, before launch: Stock with the switch.
  eq(run({ role: 'owner', modules: ['expenses'], mainOwner: true, on: false }).req, { sub: 'Stock', def: 'reqStock', views: ['reqStock'] }, 'the main owner can reach the switch');
  // The Stock view itself asks the server again (stk_status / stk_reader): staff without Expenses are refused there.
  ok(/if \(!status \|\| !status\.enabled\) return renderOff\(host, status\);/.test(JS), 'the view re-checks with the server');
});

test('one stock path (Q29): once stock is on, the old tick is hidden and never sent, and the old Inventory screen goes', () => {
  const exp = read('js/expenses-module.js');
  ok(/const toInventory = !window\.currentStockOn && !!document\.getElementById\('expToInventory'\)\?\.checked;/.test(exp), 'never sent');
  const open = exp.slice(exp.indexOf('function openExpModal'), exp.indexOf('function closeExpModal'));
  ok(/box\.style\.display = window\.currentStockOn \? 'none' : ''/.test(open), 'hidden whenever the Add Expense form opens (Expenses and Project Control)');
  const admin = read('js/admin.js');
  ok(/p\.id === 'construction' && window\.currentStockOn\)[\s\S]{0,300}m\.view !== 'consInventory'/.test(admin), 'old Inventory screen hidden');
  ok(/create trigger stk_inventory_frozen before insert or update or delete on inventory/.test(SQL), 'and the server refuses both');
});

test('the shopping list: "In warehouse" as a hint, "Issue from stock" only once stock is on', () => {
  const list = read('js/purchasing-admin-list.js');
  ok(/canBuy && Number\(l\.in_warehouse\) > 0/.test(list), 'the hint, for a line with something to buy');
  ok(/root\.StockAdmin && root\.currentStockOn[\s\S]{0,140}data-issue=/.test(list), 'the button needs stock on');
  ok(/root\.StockAdmin\.openIssue\(line, reload\)/.test(list), 'opens the issue form');
  ok(/Number\(p\.from_stock\) > 0 \? esc\(PA\.qty\(p\.from_stock\)\) \+ ' from stock · '/.test(list), 'a portion says what stock filled');
  ok(/function openIssue\(line, onDone\)[\s\S]{0,300}to: line\.work_id, requestLineId: line\.line_id/.test(BROWSER), 'to the request\'s own project (Main Contract or Additional Works)');
  ok(/'bought', pr_line_purchased\(l\.id\),\s+'from_stock', pr_line_from_stock\(l\.id\),/.test(SQL), 'Bought = purchases; From stock beside it');
});

test('a project purchase line can be matched on the web (F1, found in the 2B-b pilot)', () => {
  // The server allows it: stk_match takes any purchase line of the company
  // (only warehouse lines make a lot on matching), and stk_project_lines
  // sends each line with everything the match form reads.
  const match = SQL.slice(SQL.indexOf('create or replace function stk_match('), SQL.indexOf('$$;', SQL.indexOf('create or replace function stk_match(')));
  ok(!/NOT_WAREHOUSE|destination <> 'warehouse'|destination != 'warehouse'/.test(match), 'stk_match does not refuse a project line');
  ok(/elsif v_line\.destination = 'warehouse' then\s+perform stk_lot_for_line/.test(match), 'only a warehouse line gets its lot on matching');
  ok(/function stk_project_lines[\s\S]{0,400}stk_line_json\(l\)[\s\S]{0,300}l\.destination = 'project'/.test(SQL), 'project lines as stk_line_json');
  const lineJson = SQL.slice(SQL.indexOf('function stk_line_json'), SQL.indexOf('function stk_overview'));
  for (const k of ['item_name', 'unit', 'quantity', 'purchase_date', 'bought_by_name', 'match', 'auto_item_id', 'suggested_item_id', 'can_check'])
    ok(lineJson.includes("'" + k + "'"), 'the match form reads ' + k);
  // Record leftovers: an unmatched line offers Match…, then comes back to the same project and line.
  const left = BROWSER.slice(BROWSER.indexOf('async function openLeftover'), BROWSER.indexOf('async function openCount'));
  ok(/async function openLeftover\(onDone, preset\)/.test(left), 'takes a preset');
  ok(/if \(!needsMatch\(l\)\) \{/.test(left), 'the same "needs a match" rule as Receiving');
  ok(/data-match-line>Match…<\/button>/.test(left), 'a Match… button on an unmatched line');
  ok(/openMatch\(l, \(\) => openLeftover\(onDone, \{ folder: form\.folder\.value, line: l\.purchase_id \+ ':' \+ l\.line_no \}\)\)/.test(left),
     'the match form, then back to this project and line');
  ok(/form\.folder\.value = preset\.folder;\s+await loadLines\(\);/.test(left), 'reloads the lines (fresh match and stock)');
  ok(!/ask the office to match it \(Receiving tab\)/.test(JS), 'no longer sends people to a tab that cannot show the line');
  // Receiving: where the phone sends the office (Dacs Web → Stock → Receiving).
  ok(/data-project-match>Match a project purchase line…<\/button>/.test(BROWSER), 'Receiving has the button');
  ok(/\[data-project-match\]'\)\.addEventListener\('click', \(\) => openProjectMatch\(reload\)\)/.test(BROWSER), 'wired');
  const pm = BROWSER.slice(BROWSER.indexOf('async function openProjectMatch'), BROWSER.indexOf('function openReceive'));
  ok(/RA\.rpc\('stk_project_lines', \{ p_folder: form\.folder\.value \}\)/.test(pm), 'lists the project\'s lines');
  ok(/onDone: \(\) => openMatch\(picked, onDone\)/.test(pm), 'then the one match form');
  ok(!/RA\.rpc\('stk_match'/.test(pm) && !/RA\.rpc\('stk_match'/.test(left), 'stk_match stays in openMatch alone (one operation id per form)');
  ok(/Receiving tab — a project's line: "Match a project purchase line…"/.test(sa.ERRORS.TO_MATCH), 'the refusal says where');
});

test('the pilot\'s way back (2B-b): the main owner alone may switch stock off again, typed, and nothing is undone', () => {
  ok(/\(status\.is_main_owner \? '<div class="stk-switch-off"><button[^']*data-switch-off>Switch stock off…<\/button><\/div>' : ''\)/.test(BROWSER),
     'the button is the main owner\'s only');
  const fn = BROWSER.slice(BROWSER.indexOf('function openSwitchOff'), BROWSER.indexOf('function renderOff'));
  ok(/if \(form\.word\.value\.trim\(\) !== 'OFF'\) throw/.test(fn), 'typed OFF first');
  ok(/RA\.rpc\('stk_set_enabled', \{ p_on: false \}\)/.test(fn), 'the server\'s own switch');
  ok(/root\.currentStockOn = false;/.test(fn), 'the old tick comes back at once');
  ok(/nothing is undone or deleted/.test(fn), 'says records stay');
  eq((BROWSER.match(/RA\.rpc\('stk_set_enabled'/g) || []).length, 2, 'on and off, nowhere else');
  const server = SQL.slice(SQL.indexOf('function stk_set_enabled'));
  ok(/v_owner uuid := pur_main_owner\(\);/.test(server.slice(0, 300)), 'the server checks it is the main owner');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
