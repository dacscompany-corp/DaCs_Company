// ════════════════════════════════════════════════════════════════════
// SIGN-IN ELIGIBILITY TESTS: run with  node tests/signin-eligibility.test.js
//
// Zero dependencies. Guards the attendance-signin Edge Function's one
// decision (supabase/functions/attendance-signin/eligibility.mjs), WorkMate
// Stage 2A-3a (Q1, R1, R3, R9):
//   I.   The old Attendance app (no x-dacs-app header) answers EXACTLY as
//        before 0101, for every role — buyers included.
//   II.  WorkMate admits workers and team leaders as before, and buyers
//        (pur_signin_can_buy) as "buyer"; refuses everyone else with
//        NO_WORKMATE_ACCESS; an inactive account is ACCOUNT_INACTIVE.
//   III. The buyer check is asked only when it can change the answer.
//   IV.  A refusal revokes only the session it just minted, except an
//        inactive account (every session).
//   V.   index.ts wires it: header read, RPC name, response shape.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = path.join(__dirname, '..', 'supabase/functions/attendance-signin');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }

const ROLES = ['worker', 'teamLeader', 'staff', 'owner', 'client', 'partner', null, ''];
const STATUSES = ['active', null, 'inactive', 'deleted'];

(async () => {
  const E = await import(pathToFileURL(path.join(DIR, 'eligibility.mjs')).href);
  const { decideAccess, needsBuyerCheck, revokeScope, isWorkMate } = E;
  // The function before 0101, written out: the old app must keep exactly this.
  const before = (role, status) => !['worker', 'teamLeader'].includes(role ?? '') ? { ok: false, code: 'NOT_A_WORKER' }
    : (status ?? 'active') !== 'active' ? { ok: false, code: 'ACCOUNT_INACTIVE' } : { ok: true, access: 'worker' };

  console.log('\nI. The old Attendance app is untouched');
  await test('no header: every role and status gets the pre-0101 answer, whatever the buyer check would say', () => {
    for (const role of ROLES) for (const status of STATUSES) for (const canBuy of [false, true]) for (const app of [null, '', 'attendance', 'Attendance']) {
      eq(decideAccess({ role, status, app, canBuy }), before(role, status), JSON.stringify({ role, status, app, canBuy }));
    }
  });
  await test('the old app never triggers the buyer check', () => {
    for (const role of ROLES) for (const status of STATUSES) eq(needsBuyerCheck({ role, status, app: null }), false, role + '/' + status);
  });

  console.log('\nII. WorkMate');
  await test('workers and team leaders: as before', () => {
    for (const role of ['worker', 'teamLeader']) for (const canBuy of [false, true]) {
      eq(decideAccess({ role, status: 'active', app: 'workmate', canBuy }), { ok: true, access: 'worker' }, role);
      eq(decideAccess({ role, status: null, app: 'workmate', canBuy }), { ok: true, access: 'worker' }, role + ' no status');
      eq(decideAccess({ role, status: 'inactive', app: 'workmate', canBuy }), { ok: false, code: 'ACCOUNT_INACTIVE' }, role + ' inactive');
    }
  });
  await test('an account that may buy (owner, admin with Expenses, Buyer staff) comes in as a buyer', () => {
    for (const role of ['staff', 'owner']) {
      eq(decideAccess({ role, status: 'active', app: 'workmate', canBuy: true }), { ok: true, access: 'buyer' }, role);
      eq(decideAccess({ role, status: null, app: 'workmate', canBuy: true }), { ok: true, access: 'buyer' }, role + ' no status');
    }
  });
  await test('everyone else is refused NO_WORKMATE_ACCESS; inactive is ACCOUNT_INACTIVE', () => {
    for (const role of ['staff', 'owner', 'client', 'partner', null, '']) {
      eq(decideAccess({ role, status: 'active', app: 'workmate', canBuy: false }), { ok: false, code: 'NO_WORKMATE_ACCESS' }, String(role));
      eq(decideAccess({ role, status: 'inactive', app: 'workmate', canBuy: false }), { ok: false, code: 'ACCOUNT_INACTIVE' }, role + ' inactive');
      // An inactive account is never let in, even if a stale check said it could buy.
      eq(decideAccess({ role, status: 'inactive', app: 'workmate', canBuy: true }), { ok: false, code: 'ACCOUNT_INACTIVE' }, role + ' inactive+canBuy');
    }
  });
  await test('the header is read the way the server reads it (trimmed, any case); anything else is the old app', () => {
    for (const app of ['workmate', 'WorkMate', ' workmate ', 'WORKMATE']) ok(isWorkMate(app), app);
    for (const app of [null, undefined, '', 'attendance', 'workmate2', 'work mate']) ok(!isWorkMate(app), String(app));
  });

  console.log('\nIII. The buyer check');
  await test('asked only for an active non-worker coming from WorkMate', () => {
    eq(needsBuyerCheck({ role: 'staff', status: 'active', app: 'workmate' }), true, 'staff');
    eq(needsBuyerCheck({ role: 'owner', status: null, app: 'workmate' }), true, 'owner');
    eq(needsBuyerCheck({ role: 'worker', status: 'active', app: 'workmate' }), false, 'worker');
    eq(needsBuyerCheck({ role: 'teamLeader', status: 'active', app: 'workmate' }), false, 'leader');
    eq(needsBuyerCheck({ role: 'staff', status: 'inactive', app: 'workmate' }), false, 'inactive');
  });

  console.log('\nIV. What a refusal revokes');
  await test('an inactive account loses every session; any other refusal only the one just minted', () => {
    eq(revokeScope('ACCOUNT_INACTIVE'), 'global', 'inactive');
    eq(revokeScope('NOT_A_WORKER'), 'local', 'not a worker');
    eq(revokeScope('NO_WORKMATE_ACCESS'), 'local', 'no access');
    eq(revokeScope('SERVER_ERROR'), 'local', 'server error');
  });

  console.log('\nV. index.ts wiring');
  const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
  await test('index.ts decides with eligibility.mjs, reads the x-dacs-app header and asks pur_signin_can_buy', () => {
    ok(/from "\.\/eligibility\.mjs"/.test(src), 'imports eligibility.mjs');
    ok(/req\.headers\.get\("x-dacs-app"\)/.test(src), 'reads x-dacs-app');
    ok(/admin\.rpc\(\s*"pur_signin_can_buy",\s*\{\s*p_user:\s*auth\.user\.id\s*\}/.test(src), 'calls pur_signin_can_buy with the signed-in id');
    ok(/needsBuyerCheck\(/.test(src) && /decideAccess\(/.test(src) && /revokeScope\(/.test(src), 'uses all three rules');
    ok(!/WORKER_ROLES\.includes/.test(src), 'no second copy of the role rule left in index.ts');
  });
  await test('the old app gets the old response shape; WorkMate also gets "access"', () => {
    ok(/fromWorkMate \? \{ \.\.\.payload, access: decision\.access \} : payload/.test(src), 'access only for WorkMate');
    ok(/signOut\(session\.access_token, scope\)/.test(src), 'revoke with the decided scope');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
