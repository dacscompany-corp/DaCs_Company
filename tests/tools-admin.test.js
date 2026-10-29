// ════════════════════════════════════════════════════════════════════
// TOOLS SCREENS (0107, 3a):  run with  node tests/tools-admin.test.js
//
// Zero dependencies. Loads the REAL js/tools-admin.js (its pure half) and
// reads the screens' source:
//   1. The words and checks agree with the server: every refusal has a
//      sentence, every state and record kind a label, the forms refuse what
//      the server would refuse, a photo path is one the server accepts.
//   2. No money: the screens read no table and show no peso amount.
//   3. Wiring: Requests → Tools is hidden until tools are switched on (the
//      main owner sees the switch); Mark as Complete names the tools still
//      out; the shopping list shows tools issued; every write is sent once.
// ════════════════════════════════════════════════════════════════════
'use strict';
const ta = require('../js/tools-admin.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0107_tools.sql');
const JS = read('js/tools-admin.js');
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
const ME = { userId: 'u1', isOwner: false, isMainOwner: false, canRecord: true };
const OWNER = { userId: 'o1', isOwner: true, isMainOwner: true, canRecord: true };

console.log('\ntools: the words agree with the server');

test('every refusal 0107 can send has a sentence (and the helpers\' it reaches)', () => {
  const codes = [...new Set([...SQL.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))]
    .filter(c => c !== 'HISTORY_IMMUTABLE');               // a trigger on direct table writes, never an RPC answer
  ok(codes.length >= 30, 'codes read: ' + codes.length);
  for (const c of codes) ok(ta.ERRORS[c], c + ' has no sentence');
  // Reached through pur_actor_owner, pur_main_owner, pur_op_begin, pur_note, pur_reason, stk_line, stk_reader.
  for (const c of ['NOT_OFFICE', 'NOT_ALLOWED', 'BAD_OP', 'OP_CANCELLED', 'BAD_NOTE', 'REASON_REQUIRED', 'NOT_FOUND', 'ITEM_IN_USE']) ok(ta.ERRORS[c], c);
  eq(ta.errorMessage({ message: 'MORE_THAN_BOUGHT', hint: 'Still to register from this line: 1.' }),
     ta.ERRORS.MORE_THAN_BOUGHT + ' (Still to register from this line: 1.)', 'the hint says how many are left');
  eq(ta.errorMessage({ code: 'PGRST202', message: 'Could not find' }), ta.ERRORS.PGRST202);
  ok(/^Something went wrong: /.test(ta.errorMessage({ message: 'weird' })));
});

test('every state and record kind of 0107 has a label; the conditions are the server\'s', () => {
  const states = SQL.match(/state text not null check \(state in \(([^)]*)\)\)/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  eq(Object.keys(ta.STATE_LABEL).sort(), states.sort(), 'states');
  const kinds = SQL.match(/kind text not null check \(kind in \('register'[^)]*\)\)/)[0].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  eq(Object.keys(ta.KIND_LABEL).sort(), kinds.sort(), 'record kinds');
  const conds = SQL.match(/condition text not null default 'good' check \(condition in \(([^)]*)\)\)/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  eq(ta.CONDITIONS.map(c => c[0]), conds, 'conditions, in the server\'s order');
});

test('what can be done to a tool follows its state, as the server allows', () => {
  eq(ta.actionsFor({ state: 'available' }), ['issue', 'lost']);
  eq(ta.actionsFor({ state: 'issued' }), ['handover', 'return', 'lost']);
  eq(ta.actionsFor({ state: 'issued', condition: 'good' }), ['handover', 'return', 'lost']);
  for (const c of ['needs_repair', 'missing_parts']) {
    eq(ta.actionsFor({ state: 'issued', condition: c }), ['repaired', 'return', 'lost'], c + ' at its project: no handover until repaired (rev 3)');
  }
  eq(ta.actionsFor({ state: 'repair' }), ['repaired', 'retire', 'lost']);
  eq(ta.actionsFor({ state: 'lost' }), ['found']);
  for (const s of ['lost_pending', 'retire_pending', 'retired', 'cancelled']) eq(ta.actionsFor({ state: s }), [], s + ': nothing — waiting or final');
  // The server's own guards, operation by operation.
  const guard = (fn) => SQL.slice(SQL.indexOf('create or replace function ' + fn + '('), SQL.indexOf('$$;', SQL.indexOf('create or replace function ' + fn + '(')));
  ok(/if t\.state <> 'available' then\s+raise exception 'NOT_AVAILABLE'/.test(guard('tl_issue')), 'issue: available only');
  ok(/if t\.state <> 'issued' then\s+raise exception 'NOT_ISSUED'/.test(guard('tl_handover')), 'handover: issued only');
  ok(/if t\.condition <> 'good' then\s+raise exception 'NEEDS_REPAIR'/.test(guard('tl_handover')), 'handover: in good condition only (rev 3)');
  ok(/if t\.state <> 'issued' then\s+raise exception 'NOT_ISSUED'/.test(guard('tl_return')), 'return: issued only');
  ok(/if not \(t\.state = 'repair' or \(t\.state = 'issued' and t\.condition <> 'good'\)\) then\s+raise exception 'NOT_IN_REPAIR'/.test(guard('tl_repaired')),
     'repaired: under repair, or issued and not in good condition (rev 3)');
  ok(/if t\.state <> 'repair' then\s+raise exception 'NOT_IN_REPAIR'/.test(guard('tl_request_retire')), 'retire: repair only');
  ok(/if t\.state not in \('available', 'issued', 'repair'\) then\s+raise exception 'BAD_STATE'/.test(guard('tl_report_lost')), 'lost: these three');
  ok(/if t\.state <> 'lost' then\s+raise exception 'NOT_LOST'/.test(guard('tl_found')), 'found: lost only');
});

test('the Out list: a tool needing repair at its project offers Repaired, never Hand over (rev 3)', () => {
  const out = BROWSER.slice(BROWSER.indexOf('function outRow'), BROWSER.indexOf('function lineCard'));
  ok(/const broken = t\.condition && t\.condition !== 'good';/.test(out), 'not in good condition');
  ok(/\(broken \? '<button type="button" class="att-btn att-btn--sm" data-out-act="repaired">Repaired…<\/button>'\s*: '<button type="button" class="att-btn att-btn--sm" data-out-act="handover">Hand over…<\/button>'\)/.test(out),
     'Repaired… instead of Hand over…');
  ok(/data-out-act="return">Return…<\/button>/.test(out), 'Return… always');
  ok(/\(broken \? ' ' \+ pill\(conditionLabel\(t\.condition\) \+ ' — not usable', 'abandoned'\) : ''\)/.test(out), 'marked not usable');
  ok(/if \(t\) runAction\(b\.dataset\.outAct, t, reload\);/.test(BROWSER) && /return openSimple\(t, act, reload\);/.test(BROWSER),
     'the button opens the same Repaired form as the tool page');
});

test('who may withdraw or reverse (tl_reverse): matches the server', () => {
  const r = (x) => Object.assign({ status: 'done', kind: 'issue', latest: true, recorded_by: 'u1', reversed: false }, x);
  ok(ta.canReverse(r({}), ME), 'my latest record');
  ok(!ta.canReverse(r({ recorded_by: 'x' }), ME), 'someone else\'s — not for staff');
  ok(ta.canReverse(r({ recorded_by: 'x' }), { userId: 'o2', isOwner: true }), 'an owner may');
  ok(!ta.canReverse(r({ latest: false }), ME), 'only the latest (LATER_RECORDS)');
  ok(!ta.canReverse(r({ reversed: true }), ME) && !ta.canReverse(r({ status: 'rejected' }), ME) && !ta.canReverse(r({ status: 'withdrawn' }), ME));
  ok(!ta.canReverse(r({ kind: 'lost' }), OWNER) && !ta.canReverse(r({ kind: 'retire' }), OWNER), 'a decided loss / retirement: never');
  ok(ta.canReverse(r({ status: 'pending', kind: 'lost' }), ME), 'withdraw my own request');
  ok(!ta.canReverse(r({ status: 'pending', kind: 'lost', recorded_by: 'x' }), ME), 'not someone else\'s');
  ok(ta.canReverse(r({ status: 'pending', kind: 'retire', recorded_by: 'x' }), OWNER), 'the main owner may withdraw anyone\'s');
  const rev = SQL.slice(SQL.indexOf('create or replace function tl_reverse('));
  ok(/if auth\.uid\(\) <> r\.recorded_by and not pur_is_main_owner\(\) then\s+raise exception 'NOT_YOURS'/.test(rev), 'server: pending');
  ok(/if auth\.uid\(\) <> r\.recorded_by and not is_owner\(\) then\s+raise exception 'NOT_YOURS'/.test(rev), 'server: done');
  ok(/if tl_latest\(t\.id\) <> r\.id then\s+raise exception 'LATER_RECORDS'/.test(rev), 'server: latest only');
});

test('a photo path is exactly the shape the server accepts (tl_photo), month by the local calendar', () => {
  const owner = '00000000-0000-0000-0000-00000000000A';
  const id = '11111111-2222-4333-8444-555555555555';
  const p = ta.photoPath(owner, new Date(2026, 9, 31, 23, 30), id);
  eq(p, 'tools/00000000-0000-0000-0000-00000000000a/2026-10/' + id + '.jpg');
  const re = SQL.match(/if p !~ \('\^tools\/' \|\| p_owner::text \|\| '([^']+)'\) then/)[1];
  ok(new RegExp('^tools/' + owner.toLowerCase() + re).test(p), 'matches the server\'s pattern');
  let threw = false; try { ta.photoPath(null, new Date(), id); } catch (_) { threw = true; }
  ok(threw, 'no company: refused before uploading');
});

test('register and issue forms refuse what the server would refuse — a person at a project, a photo for the opening register, damaged at the warehouse (rev 2)', () => {
  const base = { itemId: 'i', count: '1', at: 'warehouse', holderId: '', condition: 'good', details: '', fromLine: false, hasPhoto: true };
  eq(ta.registerProblems(base), []);
  eq(ta.registerProblems({ ...base, at: 'f1' }), ['PERSON_REQUIRED']);
  eq(ta.registerProblems({ ...base, at: 'f1', holderId: 'w' }), []);
  eq(ta.registerProblems({ ...base, itemId: '' }), ['BAD_ITEM']);
  for (const c of ['0', '51', '1.5', 'two', '']) eq(ta.registerProblems({ ...base, count: c }), ['BAD_QUANTITY'], c);
  eq(ta.registerProblems({ ...base, condition: 'broken' }), ['BAD_CONDITION']);
  eq(ta.registerProblems({ ...base, condition: 'damaged' }), [], 'damaged: at the warehouse');
  eq(ta.registerProblems({ ...base, condition: 'damaged', at: 'f1', holderId: 'w' }), ['DAMAGED_AT_PROJECT'], 'never at a project');
  eq(ta.registerProblems({ ...base, hasPhoto: false }), ['PHOTO_REQUIRED'], 'the opening register needs its photo');
  eq(ta.registerProblems({ ...base, hasPhoto: false, fromLine: true }), [], 'from a purchase line: optional');
  eq(ta.registerProblems({ ...base, details: 'x'.repeat(201) }), ['BAD_NOTE']);
  eq(ta.issueProblems({ holderId: '', folderId: 'f' }), ['PERSON_REQUIRED']);
  eq(ta.issueProblems({ holderId: 'w', folderId: '' }), ['BAD_PROJECT']);
  ok(/if v_count < 1 or v_count > 50 then/.test(SQL), 'server: 1–50');
  ok(/if v_cond = 'damaged' then\s+raise exception 'DAMAGED_AT_PROJECT'/.test(SQL), 'server: damaged only at the warehouse');
  ok(/if v_purchase is null and v_photo is null then\s+raise exception 'PHOTO_REQUIRED'/.test(SQL), 'server: the opening register\'s photo');
});

test('pickers: completed projects only where the tool already is; requests of this tool or none; people with their teams', () => {
  const projects = [{ folder_id: 'a', name: 'House', completed: false }, { folder_id: 'b', name: 'Old', completed: true }];
  eq(ta.projectOptions(projects).map(o => o.value), ['a']);
  eq(ta.projectOptions(projects, 'b').map(o => o.label), ['House', 'Old (completed)']);
  const lines = [{ line_id: 'l1', description: 'Grinder', catalog_item_id: 'g', still_to_buy: 1, unit: 'pc', requester_name: 'Mark' },
                 { line_id: 'l2', description: 'Drill', catalog_item_id: 'd', still_to_buy: 1, unit: 'pc', requester_name: 'Mark' },
                 { line_id: 'l3', description: 'Any grinder', catalog_item_id: null, still_to_buy: 2, unit: 'pc', requester_name: 'Rey' },
                 { line_id: 'l4', description: 'Grinder', catalog_item_id: 'g', still_to_buy: 0, unit: 'pc', requester_name: 'Rey' }];
  eq(ta.requestOptions(lines, 'g').map(o => o.value), ['l1', 'l3'], 'its item or none, with something still to fill');
  eq(ta.personLabel({ name: 'Lito', role: 'teamLeader', teams: ['Masons'] }), 'Lito · Masons');
  eq(ta.personLabel({ name: 'Ben', role: 'teamLeader', teams: [] }), 'Ben · team leader');
  eq(ta.personLabel({ name: 'Ana', role: 'staff', teams: [] }), 'Ana · office', 'office staff may hold a tool (T1 = C)');
  eq(ta.personLabel({ name: 'admin', role: 'owner' }), 'admin · owner');
  eq(ta.personLabel({ name: 'Mark', role: 'worker', teams: [] }), 'Mark');
  eq(ta.personLabel({ name: 'John Tapales (W-0007)', role: 'worker', teams: ['Team test'] }), 'John Tapales (W-0007) · Team test',
     'two crew with one name told apart by the number the server adds (0108, TF1) — no brackets inside brackets');
});

test('records and places in words', () => {
  eq(ta.recordText({ kind: 'handover', from_holder_name: 'Mark', holder_name: 'Rey', folder_name: 'House' }), 'Handed over from Mark to Rey · House');
  eq(ta.recordText({ kind: 'return', holder_name: 'Rey', condition: 'missing_parts' }), 'Returned by Rey · Missing parts');
  eq(ta.recordText({ kind: 'lost', holder_name: 'Rey', status: 'pending' }), 'Reported lost (last with Rey) (waiting for the owner)');
  eq(ta.recordText({ kind: 'register', condition: 'good' }), 'Registered at the warehouse');
  eq(ta.whereText({ state: 'issued', holder_name: 'Mark', folder_name: 'House', days: 9 }), 'Mark · House · 9 days');
  eq(ta.whereText({ state: 'repair', condition: 'needs_repair' }), 'Warehouse · Needs repair');
  eq(ta.whereText({ state: 'retire_pending', condition: 'damaged' }), 'Warehouse · Damaged beyond repair', 'waiting for a Retire: its place and condition (TF2)');
  eq(ta.whereText({ state: 'lost_pending', condition: 'good' }), 'Last at the warehouse', 'reported lost from the warehouse');
  eq(ta.whereText({ state: 'lost', condition: 'missing_parts' }), 'Last at the warehouse');
  eq(ta.whereText({ state: 'lost', holder_name: 'Rey', folder_name: 'House' }), 'Last with Rey · House');
  eq([ta.whereText({ state: 'retired' }), ta.whereText({ state: 'cancelled' })], ['', ''], 'nothing to say once retired or cancelled');
  eq(ta.whereText({ state: 'issued', holder_name: 'Mark', folder_name: 'House', days: 2, condition: 'missing_parts' }),
     'Mark · House · 2 days · Missing parts — not usable until repaired');
  eq(ta.recordText({ kind: 'repaired', holder_name: 'Mark', folder_name: 'House' }), 'Repaired — still with Mark · House');
  eq(ta.recordText({ kind: 'repaired' }), 'Repaired — available again');
  eq([ta.daysText(0), ta.daysText(1), ta.daysText(12)], ['today', '1 day', '12 days']);
});

console.log('\ntools: no money');

test('the Tools screens read no table, call only 0107\'s functions, and show no peso amount', () => {
  ok(!/\.from\((?!'uploads'\))/.test(JS), 'no direct table read (only the uploads bucket for photos)');
  ok(!/₱|peso|amount|price|toFixed\(2\)/i.test(JS.replace(/\/\/[^\n]*/g, '').replace(/No prices here/, '')), 'no money on screen');
  const called = [...new Set([...BROWSER.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]))].sort();
  const granted = [...SQL.matchAll(/grant execute on function ([a-z_]+)\(/g)].map(m => m[1]);
  for (const f of called) ok(granted.includes(f), f + ' is not a granted 0107 function');
  eq(called, ['tl_choices', 'tl_decide', 'tl_found', 'tl_handover', 'tl_issue', 'tl_overview', 'tl_register', 'tl_repaired',
              'tl_report_lost', 'tl_request_lines', 'tl_request_retire', 'tl_return', 'tl_reverse', 'tl_set_enabled', 'tl_status', 'tl_tool']);
  ok(!/amount|price|gross|cost_/.test(SQL.slice(SQL.indexOf('-- ════ 7. Reading'), SQL.indexOf('-- 0104\'s Stock screen'))), 'the readers send no money');
});

test('every write is sent once: one operation id per form, kept across retries — and its photo uploaded once', () => {
  const writes = ['tl_register', 'tl_issue', 'tl_handover', 'tl_return', 'tl_found', 'tl_reverse', 'tl_decide'];
  for (const w of writes) {
    ok(new RegExp("sendOnce\\(\\(opId[^)]*\\) => RA\\.rpc\\('" + w + "'").test(BROWSER), w + ' goes through sendOnce');
    ok((BROWSER.match(new RegExp("RA\\.rpc\\('" + w + "'", 'g')) || []).length === 1, w + ' is called in one place');
  }
  for (const w of ['tl_repaired', 'tl_request_retire', 'tl_report_lost']) ok(new RegExp("\\(op, text\\) => RA\\.rpc\\('" + w + "', \\{ p_op: op").test(BROWSER), w + ': the form\'s one id');
  ok(/const send = sendOnce\(cfg\[4\]\);/.test(BROWSER), '…through sendOnce');
  ok(/function sendOnce\(fn\) \{\s+const opId = newOp\(\);\s+return \(\.\.\.args\) => fn\(opId, \.\.\.args\);/.test(BROWSER), 'the id is made once per form');
  ok(/if \(done && done\.file === file\) return done\.path;/.test(BROWSER), 'a retried form does not upload the photo again');
  ok(/upload\(path, blob, \{ upsert: false, contentType: 'image\/jpeg' \}\)/.test(BROWSER), 'never overwrites a photo');
});

console.log('\ntools: wiring');

test('Requests → Tools: in the nav, the view list and the page; hidden until tools are on, except from the main owner', () => {
  const admin = read('js/admin.js');
  const html = read('admin.html');
  ok(/\{ view: 'reqTools',\s+label: 'Tools',\s+icon: 'wrench' \}/.test(admin), 'PRIMARY_NAV entry');
  ok(/if \(!window\.currentToolsOn && !window\.currentToolsMainOwner\) hidden\.push\('reqTools'\);/.test(admin), 'hidden until on');
  ok(/const \{ data: tl \} = await window\.sbClient\.rpc\('tl_status'\);/.test(admin), 'the server says (before 0107: hidden)');
  ok(/window\.currentToolsOn = !!\(tl && tl\.enabled\);/.test(admin) && /window\.currentToolsMainOwner = !!\(tl && tl\.is_main_owner\);/.test(admin));
  ok(/const REQ_VIEWS\s+= \[[^\]]*'reqTools'[^\]]*\]/.test(html), 'REQ_VIEWS');
  ok(/<div id="reqToolsView"\s+class="content-view" style="display: none;"><\/div>/.test(html), 'the page');
  ok(/reqTools:\s+'Tools',/.test(html), 'the title');
  const core = html.indexOf('js/requests-admin-core.js'), tools = html.indexOf('<script src="js/tools-admin.js?v=');
  ok(core > 0 && tools > core && tools > html.indexOf('js/receipt-storage.js'), 'loaded after Requests and the photo helper');
  ok(/RA\.views\.reqTools = render;/.test(JS), 'the view is registered');
  ok(/if \(!status \|\| !status\.enabled\) return renderOff\(host, status\);/.test(BROWSER), 'off: nothing but the switch');
  ok(/form\.word\.value\.trim\(\) !== 'TOOLS'/.test(BROWSER), 'on: TOOLS typed');
  ok(/form\.word\.value\.trim\(\) !== 'OFF'/.test(BROWSER) && /RA\.rpc\('tl_set_enabled', \{ p_on: false \}\)/.test(BROWSER), 'off again: OFF typed (a failed pilot)');
  ok(/\(status\.is_main_owner \? '<div class="stk-switch-off"><button[^']*data-switch-off>Switch tools off…<\/button><\/div>' : ''\)/.test(BROWSER),
     'the off switch is the main owner\'s only');
  ok(/v_owner uuid := pur_main_owner\(\);/.test(SQL.slice(SQL.indexOf('function tl_set_enabled'), SQL.indexOf('function tl_set_enabled') + 300)), 'the server checks it is the main owner');
});

test('a focused account the server lets record gets Requests → Tools beside Stock and Purchasing — and nothing else of Requests', () => {
  const vm = require('vm');
  const src = read('js/admin.js');
  const slice = src.slice(src.indexOf('const PRIMARY_NAV = ['), src.indexOf('function findPrimaryForView('));
  const run = ({ role = 'staff', modules = ['expenses'], buyer = false, stock = false, tools = false, mainOwner = false }) => {
    const sb = { window: { currentCanBuy: buyer, currentStockOn: stock, currentStockMainOwner: mainOwner,
                           currentToolsOn: tools, currentToolsMainOwner: mainOwner },
                 currentUserRole: role, currentAllowedModules: modules };
    vm.createContext(sb);
    vm.runInContext(slice + '\nthis.__nav = _visibleNav(); this.__views = window.focusAllowedViews();', sb);
    const req = sb.__nav.find(p => p.id === 'requests');
    return { req: req ? { sub: req.sub, def: req.defaultView, views: req.modules.map(m => m.view) } : null, views: sb.__views };
  };
  eq(run({ tools: true }).req, { sub: 'Tools', def: 'reqTools', views: ['reqTools'] }, 'tools on: Requests holding Tools alone');
  eq(run({ tools: true, stock: true }).req, { sub: 'Stock & Tools', def: 'reqStock', views: ['reqStock', 'reqTools'] });
  eq(run({ tools: true, stock: true, buyer: true }).req,
     { sub: 'Purchasing & Stock & Tools', def: 'reqPurchasing', views: ['reqPurchasing', 'reqStock', 'reqTools', 'reqPurchase'] });
  eq(run({ stock: true, buyer: true }).req, { sub: 'Purchasing & Stock', def: 'reqPurchasing', views: ['reqPurchasing', 'reqStock', 'reqPurchase'] },
     'tools off: exactly as before');
  ok(!run({ stock: true }).views.includes('reqTools'), 'off: the guard keeps Tools out');
  ok(run({ tools: true }).views.includes('reqTools') && !run({ tools: true }).views.includes('reqQueue'), 'on: Tools in, nothing else of Requests');
  eq(run({ role: 'worker', modules: ['construction'], tools: true }).req, null, 'never a worker');
  eq(run({ role: 'owner', modules: ['expenses'], mainOwner: true }).req.views.includes('reqTools'), true, 'the main owner reaches the switch');
  const full = run({ modules: ['requests'], tools: false }).req;
  ok(full.views.includes('reqQueue') && !full.views.includes('reqTools'), 'focused on Requests: Tools only once on');
});

test('Mark as Complete names the tools still out — never blocks (Q20)', () => {
  const exp = read('js/expenses-module.js');
  const mark = exp.slice(exp.indexOf('async function markFolderComplete'), exp.indexOf('async function reopenFolder'));
  ok(/\+ await _toolsOutNote\(id\),/.test(mark), 'the note joins the confirm message');
  const note = exp.slice(exp.indexOf('async function _toolsOutNote'), exp.indexOf('async function markFolderComplete'));
  ok(/if \(!window\.currentToolsOn\) return '';/.test(note), 'nothing while tools are off');
  ok(/rpc\('tl_project_out', \{ p_folder: id \}\)/.test(note), 'the server lists them (the project and its jobs)');
  ok(/catch \(_\) \{ out = \[\]; \}/.test(note), 'a failed read never blocks completing');
  ok(/out\.map\(t => t\.label \+ ' with ' \+ t\.holder_name\)\.join\(', '\)/.test(note), '"TOOL-0004 with John Tapales (W-0007)" — no brackets inside brackets');
  ok(!/return;|throw/.test(note.replace(/return '';/g, '').replace(/return '\\n\\n'/, '')), 'no way to stop the completion');
  ok(/document\.getElementById\('deleteConfirmMsg'\)\.textContent = message;/.test(exp), 'shown as text (names cannot inject markup)');
  ok(/t\.folder_id in \(select f\.id from folders f where f\.owner_id = v_owner\s+and \(f\.id = p_folder or f\.parent_folder_id = p_folder\)\)/.test(SQL), 'server: the project and its Additional Works');
});

test('the shopping list shows tools issued for a line (bought for it, or counted on their own) and what they filled', () => {
  const list = read('js/purchasing-admin-list.js');
  ok(/if \(root\.currentToolsOn && lines\.length\) \{\s+try \{ tools = \(await RA\.rpc\('tl_line_tools', \{ p_lines: lines\.map\(l => l\.line_id\) \}\)\) \|\| \{\}; \} catch \(_\) \{ tools = \{\}; \}/.test(list),
     'asked only while tools are on; a failure shows nothing');
  ok(/stat\('Tools issued', l\._tools\.filled\)/.test(list), 'the line\'s figure');
  ok(/' tools issued · '/.test(list), 'each weekly portion\'s');
  ok(/\(t\.counted \? '' : ', bought for this'\)/.test(list), 'a tool bought for the line says so (counted through its purchase)');
  ok(/esc\(t\.label\)/.test(list) && /esc\(t\.holder_name\)/.test(list), 'escaped');
  ok(/'<\/strong> with ' \+\s+esc\(t\.holder_name\) \+ \(t\.counted \? '' : ', bought for this'\)\)\.join\('; '\)/.test(list),
     '"TOOL-0004 with John Tapales (W-0007), bought for this" — tools set apart by semicolons');
});

test('tool photos: their own folder, office only, in the storage map', () => {
  const st = read('tests/storage-access.test.js');
  ok(/tools: 'admin',/.test(st), 'classified');
  ok(/const path = photoPath\(root\.currentDataUserId, new Date\(\), newOp\(\)\);/.test(BROWSER), 'the company the server checks against');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
