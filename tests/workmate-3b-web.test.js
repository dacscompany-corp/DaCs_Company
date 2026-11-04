// ═══════════════════════════════════════
// STAGE 3b-a OFFICE SCREENS: run with  node tests/workmate-3b-web.test.js
//
// Zero dependencies. Loads the real pure code and reads the screens' source.
// (scratch real-Chrome checks drive the same screens end to end.)
//   1. Attendance → Workers: the two buttons are the main owner's, a role change
//      and a reset each confirm first, and a temporary password is shown once.
//   2. Requests → Teams: a named leader who cannot lead counts as no leader, and
//      an old mark on a turned-off team can be cleared.
//   3. Requests → Tools: reported problems, closed with a note. No money.
//   4. Users → Edit: a worker's role is not offered where it cannot save.
//   5. Nothing here reads a labor contract or payroll.
// ═══════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ta = require('../js/tools-admin.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const ATT = read('js/attendance-admin.js');
const SETUP = read('js/requests-admin-setup.js');
const TOOLS = read('js/tools-admin.js');
const NAV = read('js/user-navigator.js');
const HTML = read('admin.html');
const CONFIG = read('js/supabase-config.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

const engine = () => {
  const start = ATT.indexOf('// ==== ATT REPORT ENGINE START ====');
  const end = ATT.indexOf('// ==== ATT REPORT ENGINE END ====');
  ok(start > 0 && end > start, 'SLICE NOT FOUND: the attendance engine markers');
  const names = ['attLeaderButtonLabel', 'attLeaderNote', 'attTempPasswordConfirmed', 'attWorkerAdminMessage'];
  const ctx = { window: {}, console };
  vm.runInNewContext(ATT.slice(start, end) + '\nthis.__x = {' + names.join(',') + '};', ctx);
  return ctx.__x;
};

console.log('\nAttendance → Workers: the main owner\'s two buttons');

test('the words follow the role', () => {
  const M = engine();
  eq(M.attLeaderButtonLabel({ role: 'worker' }), 'Make Team Leader');
  eq(M.attLeaderButtonLabel({ role: 'teamLeader' }), 'Remove Team Leader');
  eq(M.attLeaderNote({ role: 'teamLeader' }), 'Can lead a team', 'the role alone leads nothing');
  eq(M.attLeaderNote({ role: 'worker' }), '');
  ok(!/Leads a team on site/.test(ATT), 'the old line is gone');
});

test('a reset is confirmed by the worker number, in any way it is written', () => {
  const M = engine();
  for (const typed of ['W-0007', 'w-0007', '7', '0007', ' W-7 ']) ok(M.attTempPasswordConfirmed(typed, 7), typed);
  for (const typed of ['', 'W-0008', '70', 'seven', '7 7', null, undefined]) ok(!M.attTempPasswordConfirmed(typed, 7), String(typed));
  ok(!M.attTempPasswordConfirmed('7', null), 'no worker number, no confirmation');
});

test('every refusal has a sentence, and the teams a leader still leads are named', () => {
  const M = engine();
  for (const code of ['OWNER_ONLY', 'NOT_A_WORKER', 'ACCOUNT_INACTIVE', 'RESET_FAILED', 'AUTH_REQUIRED', 'BAD_SWITCH', 'SERVER_ERROR', 'BAD_REQUEST']) {
    const s = M.attWorkerAdminMessage(code);
    ok(s && !s.includes(code), code + ' has a sentence');
  }
  const m = M.attWorkerAdminMessage('LEADS_A_TEAM', 'Slab crew, Roof crew');
  ok(m.includes('Slab crew, Roof crew') && /another leader/.test(m), m);
  ok(/could not|try again/i.test(M.attWorkerAdminMessage('SOMETHING_NEW')), 'an unknown answer still reads as a failure');
});

test('the buttons show only for the main owner, from the server\'s answer', () => {
  ok(/window\.sbClient\.rpc\('wk_me'\)/.test(ATT), 'asks the server');
  ok(/isMainOwner = !!\(me && me\.is_main_owner\)/.test(ATT), 'its answer decides');
  ok(/\$\{isMainOwner && \(w\._active \|\| w\.role === 'teamLeader'\)/.test(ATT), 'the role button');
  ok(/\$\{isMainOwner && w\._active/.test(ATT), 'the password button, active accounts only');
});

test('a role change goes through the switch; a reset through the Edge Function; both confirm first', () => {
  ok(/rpc\('wk_set_team_leader', \{ p_worker: worker\.id, p_on: turnOn \}\)/.test(ATT), 'the switch');
  ok(/function attOpenLeaderSwitch\(host, worker, onSaved\)/.test(ATT), 'a confirmation');
  ok(/function attOpenTempPassword\(host, worker, onSaved\)/.test(ATT), 'a confirmation');
  ok(/if \(!attTempPasswordConfirmed\(/.test(ATT), 'the number is checked first');
  ok(/window\.adminSetWorkerPassword\(worker\.id\)/.test(ATT), 'the Edge Function');
  ok(/ADMIN_SET_WORKER_PASSWORD_FN = SUPABASE_URL \+ '\/functions\/v1\/admin-set-worker-password'/.test(CONFIG), 'its address');
  ok(/window\.adminSetWorkerPassword = adminSetWorkerPassword/.test(CONFIG), 'exposed');
});

test('a temporary password is shown once and never kept', () => {
  const start = ATT.indexOf('function attOpenTempPassword(');
  const body = ATT.slice(start, ATT.indexOf('\n    }\n', start));
  ok(/temporary_password/.test(body), 'shown');
  ok(!/localStorage|sessionStorage|console\.|setItem|\.update\(|\.insert\(/.test(body), 'never kept or logged');
  ok(/Shown once/.test(body), 'the screen says so');
  ok(/out\.marked === false/.test(body), 'an unrecorded "must change" is said aloud');
  ok(/Not sent yet/.test(body), 'it warns about unsent attendance first');
  ok(/signs them out/i.test(body), 'and about being signed out');
});

test('the edit form no longer says role and password cannot be changed anywhere', () => {
  ok(!/Role, email and password are not editable here/.test(ATT), 'old wording');
  ok(/Role and temporary password have their own buttons/.test(ATT), 'new wording');
});

console.log('\nRequests → Teams: leaders who cannot lead, and turned-off teams');

test('a named leader counts only with no leader_problem', () => {
  ok(/const validLeader = \(m\) => m\.is_leader && !m\.leader_problem;/.test(SETUP), 'one rule');
  ok(/const leader = t\.members\.find\(validLeader\) \|\| null;/.test(SETUP), 'the card');
  ok(/const leaderless = active\.filter\(t => !t\.members\.some\(validLeader\)\)\.length;/.test(SETUP), 'the "need a leader" count');
  ok(!/t\.members\.find\(m => m\.is_leader\)/.test(SETUP), 'no other reading of the mark');
  ok(/const LEADER_PROBLEM = \{/.test(SETUP) && /no_role:/.test(SETUP) && /inactive:/.test(SETUP), 'says why');
});

test('the office can clear a mark, on an active or a turned-off team', () => {
  ok(/data-act="clear-mark"/.test(SETUP), 'a button');
  ok(/act === 'clear-mark'/.test(SETUP) && /\['pr_office_set_leader', \{ p_team: team\.id, p_worker: null \}\]/.test(SETUP), 'clears through the office function');
});

console.log('\nRequests → Tools: reported problems');

test('words for each kind, and a report reads plainly', () => {
  eq(ta.problemLabel('dont_have'), "I don't have this");
  eq(ta.problemLabel('broken'), "It's broken");
  eq(ta.problemLabel('unknown'), 'Problem');
  const s = ta.problemText({ reported_by_name: 'Amy (W-0001)', folder_name: 'House', note: 'Cord cut' });
  ok(s.includes('Amy (W-0001)') && s.includes('House') && s.includes('Cord cut'), s);
});

test('its own tab, with a count, and closing needs a note and is sent once', () => {
  ok(/t\('problems', 'Problems' \+ n\(problems\)\)/.test(TOOLS), 'the tab and count');
  ok(/RA\.rpc\('tl_problems', \{ p_open_only: !ui\.showClosed \}\)/.test(TOOLS), 'reads the server');
  ok(/sendOnce\(\(opId, note\) => RA\.rpc\('tl_close_problem', \{ p_op: opId, p_problem: p\.id, p_note: note \}\)\)/.test(TOOLS), 'one operation id');
  ok(/if \(!form\.note\.value\.trim\(\)\) throw new Error\('REASON_REQUIRED'\);/.test(TOOLS.slice(TOOLS.indexOf('function openCloseProblem'))), 'a note is required');
  ok(ta.errorMessage({ message: 'ALREADY_CLOSED' }).includes('already closed'), 'a sentence for its refusal');
});

test('no money: the Problems code shows no peso and reads no table', () => {
  const start = TOOLS.indexOf('function problemRow(');
  const part = TOOLS.slice(start, TOOLS.indexOf('function tabs(', start) > start ? TOOLS.indexOf('function tabs(', start) : TOOLS.indexOf('function openCloseProblem', start));
  ok(!/₱|peso|amount|\.from\(/i.test(part), 'no money or table read');
});

console.log('\nUsers → Edit: a worker\'s role');

test('worker accounts: the role is shown locked, with where to change it, and not sent', () => {
  ok(/const crew = user\.role === 'worker' \|\| user\.role === 'teamLeader';/.test(NAV), 'knows crew accounts');
  ok(/roleEl\.disabled = crew;/.test(NAV), 'locked');
  ok(/const updates = roleLocked \? \{ displayName, position \} : \{ displayName, role, position \};/.test(NAV), 'not sent');
  ok(/id="un-edit-role-note"/.test(HTML), 'the note is on the form');
  ok(/Attendance → Workers/.test(HTML.slice(HTML.indexOf('id="un-edit-role-note"'), HTML.indexOf('id="un-edit-role-note"') + 300)), 'it says where');
});

test('other accounts keep the form as it was', () => {
  ok(/if \(roleEl\) roleEl\.value = user\.role \|\| '';/.test(NAV), 'still shown');
  ok(/if \(!role\)\s+_fe\('err-un-edit-role'/.test(NAV), 'still checked');
});

console.log('\nStaying out of it');

test('nothing in these screens reads a labor contract or payroll to decide a role, a team or a reset', () => {
  const parts = [ATT.slice(ATT.indexOf('function attOpenLeaderSwitch('), ATT.indexOf('function attOpenEditWorker(')),
                 SETUP.slice(SETUP.indexOf('// ── Teams'), SETUP.indexOf('// ── Catalogue') > 0 ? SETUP.indexOf('// ── Catalogue') : undefined)];
  for (const p of parts) ok(p.length > 200 && !/labor_contracts|laborContracts|payroll/i.test(p), 'a contract or payroll read');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
