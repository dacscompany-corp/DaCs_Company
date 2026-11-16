// ═══════════════════════════════════════
// LINKED LABOR OFFICE SCREENS (migration 0113): run with  node tests/linked-labor-web.test.js
//
// Zero dependencies. Loads the real pure code and reads the screens' source.
// The server's rules are proven on a database by supabase/tests/ll_linked_labor.pglite.mjs
// and ll_concurrency.mjs; the money fences are §N and §Z of money-math.test.js.
//   1. Identity: a linked account first, then the typed name — two linked people
//      who share a name never share a card, a statement, an agreement or a merge.
//   2. Only js/linked-labor.js calls the lc_* functions; the web never calls
//      ll_my_agreements (that is the phone's).
//   3. Staff never see the account picker, the link controls or the history.
//   4. Every contract write that the server guards goes through LinkedLabor.
//   5. The form carries the picker, the reason box and the basis lock note.
// ═══════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const LL = require('../js/linked-labor.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const LLSRC = read('js/linked-labor.js');
const EXP = read('js/expenses-module.js');
const PORTAL = read('js/portal-app.compiled.js');
const INV = read('js/invoice-module.js');
const HTML = read('admin.html');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function slice(src, start, end, file) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in ' + file);
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in ' + file);
  return src.slice(i, j);
}

const J1 = { id: 'c1', workerName: 'Juan Cruz', workerId: 'acct-13', scope: 'Masonry' };
const J2 = { id: 'c2', workerName: 'Juan Cruz', workerId: 'acct-15', scope: 'Tiling' };
const J1b = { id: 'c3', workerName: 'Juan Cruz (Demolition)', workerId: 'acct-13', scope: 'Demolition' };
const U1 = { id: 'c4', workerName: ' Juan Cruz ', scope: 'Ceiling' };
const U2 = { id: 'c5', workerName: 'Juan Cruz', scope: 'Drywall' };
const V1 = { id: 'c6', workerName: 'Juan Cruz', scope: 'Windows', category: 'outsource' };

console.log('\nIdentity');

test('a linked contract is its account; an unlinked one keeps today’s key (the trimmed name)', () => {
  eq([LL.identityKey(J1), LL.identityKey(J1b), LL.identityKey(U1), LL.identityKey(U2)],
     ['acct:acct-13', 'acct:acct-13', 'Juan Cruz', 'Juan Cruz']);
  eq([LL.cardKey({ workerName: '' }), LL.cardKey(null)], ['\u2014', '\u2014']);
  ok(LL.sameIdentity(J1, J1b) && LL.sameIdentity(U1, U2), 'same person');
  ok(!LL.sameIdentity(J1, J2) && !LL.sameIdentity(J1, U2), 'two linked people, or linked and unlinked, with one name');
  ok(!LL.sameIdentity({ workerName: '' }, { workerName: ' ' }), 'nameless contracts are never the same person');
});

test('lcWorkerContracts (the agreement sheet, the merge) keeps same-name linked people apart', () => {
  const src = slice(EXP, 'function lcWorkerContracts(', '// Orientation date as it prints on the manual', 'js/expenses-module.js');
  const all = [J1, J2, J1b, U1, U2, V1];
  const f = new Function('expLaborContracts', 'lcIsOutsource', src + '\nreturn lcWorkerContracts;')(all, (c) => !!c && c.category === 'outsource');
  eq(f(J1).map(c => c.id).sort(), ['c1', 'c3'], 'account 13');
  eq(f(J2).map(c => c.id), ['c2'], 'account 15');
  eq(f(U2).map(c => c.id).sort(), ['c4', 'c5'], 'the unlinked Juan Cruz');
  eq(f(V1).map(c => c.id), ['c6'], 'the vendor stays apart');
});

test('Project Control’s worker cards and statement list use the same key', () => {
  ok(/const _cardKey = \(c\) => \(_LL \? _LL\.cardKey\(c\)/.test(PORTAL), 'the card key');
  ok(/const w = _cardKey\(r\.c\);/.test(PORTAL), 'cards group by it');
  ok(/_cWorkerById\[r\.c\.id\] = _cardKey\(r\.c\);/.test(PORTAL), 'a contract’s payments follow its card');
  ok(/const n = linked \? _cardKey\(lc\) : \(t\.name \|\| "\\u2014"\);/.test(PORTAL), 'the statement list');
  ok(/window\.lcOpenMerge\(crows\[0\]\.c\.id\)/.test(PORTAL), 'merge is opened by contract, not by name');
});

test('a linked statement takes that account’s contracts only; a name statement leaves linked payments out', () => {
  const s = slice(INV, 'async function _writeWorkerLaborSOA(', 'const role    =', 'js/invoice-module.js');
  ok(/workerName\.indexOf\('acct:'\) === 0/.test(s), 'the account key is read');
  ok(/\? c\.workerId === _acct/.test(s), 'account contracts by account');
  ok(/!c\.workerId && \(c\.workerName \|\| ''\) === workerName/.test(s), 'name contracts are unlinked ones');
  ok(/!\(p\.contractId && _linked\.has\(p\.contractId\)\)/.test(s), 'a linked payment never joins a name statement');
});

console.log('\nWho calls what');

test('only js/linked-labor.js calls the lc_* functions; nothing on the web calls ll_my_agreements', () => {
  const dir = path.join(__dirname, '..', 'js');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (f !== 'linked-labor.js' && /['"]lc_(link|link_candidates|edit|end|reopen|delete|merge)['"]/.test(src)) offenders.push(f);
    if (/ll_my_agreements/.test(src)) offenders.push(f + ' (ll_my_agreements)');
  }
  eq(offenders, []);
});

test('the guarded contract writes go through LinkedLabor', () => {
  const save = slice(EXP, 'async function handleSaveLaborContract(', '// Raise cap.', 'js/expenses-module.js');
  ok(/await window\.LinkedLabor\.edit\(id, update, window\.LinkedLabor\.formReason\(\)\)/.test(save), 'Edit contract');
  ok(/window\.LinkedLabor\.formAccountId\(\)/.test(save) && /\.\.\.\(workerId \? \{ workerId \} : \{\}\)/.test(save), 'New contract: the chosen account');
  const cap = slice(EXP, 'function lcOpenRaiseCap(', 'async function lcDelete(', 'js/expenses-module.js');
  ok(/window\.LinkedLabor\.edit\(id, \{ agreedAmount: next, capHistory: h \}, reason\)/.test(cap), 'Raise cap');
  const del = slice(EXP, 'async function lcDelete(', '// ── Merge a worker', 'js/expenses-module.js');
  ok(/await LL\.remove\(id, reason\)/.test(del) && /c && c\.workerId/.test(del), 'Delete (and a linked one is refused first)');
  const merge = slice(EXP, 'async function lcMergeToLumpsum(', '// Confirm-and-name dialog.', 'js/expenses-module.js');
  ok(/await LL\.merge\(cs\.map\(c => c\.id\), keeper\.id, title, reason \|\| ''\)/.test(merge), 'Merge');
  ok(!/collection\(/.test(merge), 'the merge writes nothing itself');
});

console.log('\nStaff');

test('staff never see the account picker, the link controls, the account line or the history', () => {
  const opened = slice(LLSRC, 'async function formOpened(', 'function onFormAccountChange(', 'js/linked-labor.js');
  ok(/if \(isStaff\(\) \|\| cat === 'outsource'\) return;/.test(opened), 'the picker stays hidden for staff and Out Source');
  ok(/if \(!isMainOwnerNow\(\) \|\| !grp \|\| !sel\) return;/.test(opened), 'the picker is the main owner’s');
  ok(/const _lcJobActions = \(w, r\) => _staff\(\) \? null :/.test(PORTAL), 'the contract toolbar (Account, End, History) is not drawn for staff');
  ok(/\(!_staff\(\) && _LL && !_isOutsourceC\(r\.c\)\) \? rc\("div", \{ className: "lc2-link"/.test(PORTAL), 'the account line');
  ok(/\(_LL\.isMainOwnerNow\(\) && !_isOutsourceC\(r\.c\)\)/.test(PORTAL), 'the Account button is the main owner’s');
});

console.log('\nThe pure helpers');

test('form changes map to lc_edit’s keys; anything else is dropped; dates become ISO', () => {
  const d = new Date('2026-11-08T01:02:03.000Z');
  eq(LL.toChanges({ workerName: 'A', agreedAmount: 5, capHistory: [], agreementSignedAt: d, updatedAt: 'TS', bogus: 1, notes: undefined }),
     { worker_name: 'A', agreed_amount: 5, cap_history: [], agreement_signed_at: '2026-11-08T01:02:03.000Z', notes: null });
});

test('merge pre-check mirrors the server: one person, one project, one kind, one basis', () => {
  eq(LL.mergeProblem([J1, J1b]), null);
  eq(LL.mergeProblem([U1, U2]), null);
  eq(LL.mergeProblem([J1]), 'FEW');
  eq(LL.mergeProblem([J1, J2]), 'MIXED');
  eq(LL.mergeProblem([J1, U2]), 'MIXED');
  eq(LL.mergeProblem([U2, V1]), 'MIXED');
  eq(LL.mergeProblem([U1, Object.assign({}, U2, { payBasis: 'daily' })]), 'BASIS');
  const on = (c, f) => Object.assign({}, c, { folderId: f });
  eq(LL.mergeProblem([on(J1, 'alpha'), on(J1b, 'beta')]), 'FOLDER', 'one linked worker, two projects');
  eq(LL.mergeProblem([on(U1, 'alpha'), on(U2, 'alpha-additional-works')]), 'FOLDER', 'a project and its Additional Works');
  eq(LL.mergeProblem([on(J1, 'alpha'), on(J1b, 'alpha')]), null, 'one project');
  ok(/if \(problem === 'FOLDER'\) \{ showExpNotif\(LL\.MESSAGES\.LC_MERGE_FOLDER, 'error'\); return; \}/.test(EXP), 'the merge stops and says why');
});

test('server refusals read in plain words', () => {
  eq(LL.codeOf({ code: 'P0001', message: 'LC_REASON_NEEDED' }), 'LC_REASON_NEEDED');
  ok(/signed or paid/.test(LL.errorText({ code: 'P0001', message: 'REASON_REQUIRED' })), 'reason');
  ok(/main owner/.test(LL.errorText({ message: 'OWNER_ONLY' })), 'owner only');
  ok(/End it instead/.test(LL.errorText(new Error('LC_LINKED'))), 'linked');
  ok(/migration 0113/.test(LL.errorText(new Error('column "worker_id" of relation "labor_contracts" does not exist'))), 'missing migration');
  ok(Object.keys(LL.MESSAGES).length >= 20, 'messages');
});

test('established = signed, or paid at least once', () => {
  ok(LL.isEstablished({ id: 'x', agreementSigned: true }, []), 'signed');
  ok(LL.isEstablished({ id: 'x' }, [{ contractId: 'x' }]), 'paid');
  ok(!LL.isEstablished({ id: 'x' }, [{ contractId: 'y' }]), 'draft');
});

test('history lines say what changed, from what to what, and why', () => {
  const h = LL.historyLine({ kind: 'edited', before: { agreed_amount: 50000 }, after: { agreed_amount: 60000 }, reason: 'Added the rear wall', at: '2026-11-08' });
  eq([h.label, h.what, h.reason], ['Terms changed', 'Agreed amount: 50000 → 60000', 'Added the rear wall']);
  const l = LL.historyLine({ kind: 'relinked', before: { worker_id: 'a', worker_no: 13, name: 'Juan Cruz' }, after: { worker_id: 'b', worker_no: 15, name: 'Juan Cruz' }, reason: 'wrong Juan' });
  eq(l.what, 'Juan Cruz · W-0013 → Juan Cruz · W-0015');
  eq(LL.historyLine({ kind: 'unlinked', before: { worker_id: 'a', worker_no: 13, name: 'J' }, after: { worker_id: null } }).what, 'J · W-0013 → no account');
});

console.log('\nThe form');

test('admin.html loads linked-labor.js before the expenses module, and the form has its three parts', () => {
  ok(HTML.indexOf('js/linked-labor.js') > 0 && HTML.indexOf('js/linked-labor.js') < HTML.indexOf('js/expenses-module.js'), 'script order');
  ok(/<div class="exp-form-group" id="lcAccountGroup" style="display:none;">/.test(HTML), 'the picker, hidden until the main owner opens New');
  ok(/onchange="LinkedLabor\.onFormAccountChange\(\)"/.test(HTML), 'choosing an account fills the defaults');
  ok(/id="lcReasonGroup" style="display:none;"/.test(HTML) && /id="lcReason"/.test(HTML), 'the reason box');
  ok(/id="lcBasisLockNote"/.test(HTML), 'the daily↔fixed lock note');
  ok(/LinkedLabor\.formOpened\(null\)/.test(EXP) && /LinkedLabor\.formOpened\(c, expPayroll\)/.test(EXP), 'New and Edit tell the module');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
