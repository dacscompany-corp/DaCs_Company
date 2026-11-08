// ════════════════════════════════════════════════════════════════════
// LINKED LABOR (0113) — RACES ON REAL POSTGRESQL
//   npm run test:sql
// A throwaway PostgreSQL (embedded-postgres), 0098 + 0113 VERBATIM over
// ll_base.mjs. Each race holds the first transaction open, confirms the
// second is waiting on a lock, then commits the first.
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LL_PRE, LL_TABLES, LL_HELPERS, M98, M113, IDS, seed } from './ll_base.mjs';

const ROUNDS = 5;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-ll-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };
const FOLDER = '00000000-0000-0000-0000-0000000f0001';

console.log('\nLinked Labor — races (0113 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(LL_PRE);
  await admin.query(LL_TABLES);
  await admin.query(LL_HELPERS);
  await admin.query(M98);
  await admin.query(M113);
  await seed((sql) => admin.query(sql));
  await admin.query(`insert into folders (id, owner_id, name) values ('${FOLDER}', '${IDS.OWNER}', 'Race site')`);

  const asOwner = async (sql, params) => {
    await admin.query(`select set_config('test.uid', '${IDS.OWNER}', false)`);
    return (await admin.query(sql, params)).rows[0];
  };
  const newContract = async (o = {}) => (await asOwner(
    `insert into labor_contracts (owner_id, folder_id, worker_name, scope, agreed_amount, pay_basis, category, cap_history)
     values ($1, $2, $3, $4, $5, 'fixed', 'labor', '[]'::jsonb) returning id`,
    [IDS.OWNER, FOLDER, o.name || 'Racer', o.scope || 'Race job', o.amount ?? 1000])).id;
  const PAY = `insert into payroll (owner_id, worker_name, labor_type, total_salary, payment_date, contract_id)
               values ('${IDS.OWNER}', 'Racer', 'direct', $2, '2026-11-02', $1) returning id`;
  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  const resultOf = async (promise) => {
    try { return { ok: true, r: (await promise).rows[0] }; }
    catch (e) { return { ok: false, code: e.code, msg: e.message }; }
  };
  // a runs first and stays open; b must wait on a lock until a commits.
  const pair = async (uidA, a, uidB, b) => {
    let s1, s2;
    try {
      s1 = await session(uidA);
      s2 = await session(uidB);
      await s1.query('begin');
      const first = await resultOf(s1.query(...a));
      await s2.query('begin');
      const pid2 = (await s2.query('select pg_backend_pid() pid')).rows[0].pid;
      let done = false, lockWait = false;
      const secondP = resultOf(s2.query(...b)).finally(() => { done = true; });
      for (let i = 0; i < 300 && !done; i++) {
        const w = (await admin.query('select wait_event_type from pg_stat_activity where pid = $1', [pid2])).rows[0]?.wait_event_type;
        if (w === 'Lock') { lockWait = true; break; }
        await new Promise(r => setTimeout(r, 10));
      }
      await s1.query(first.ok ? 'commit' : 'rollback');
      const second = await secondP;
      await s2.query(second.ok ? 'commit' : 'rollback');
      return { first, second, lockWait };
    } finally {
      await Promise.allSettled([s1?.end(), s2?.end()]);
    }
  };
  let deadlock = false;
  const note = (...rs) => { if (rs.some(r => r.code === '40P01')) deadlock = true; };

  // 1. A payment is saved while someone edits the draft's terms with no reason.
  let r1 = true, d1 = '';
  for (let i = 0; i < ROUNDS; i++) {
    const c = await newContract();
    const { first, second, lockWait } = await pair(
      IDS.OWNER, [PAY, [c, 500]],
      IDS.OWNER, [`update labor_contracts set scope = 'changed without a reason' where id = $1 returning id`, [c]]);
    note(first, second);
    const scope = (await admin.query('select scope from labor_contracts where id = $1', [c])).rows[0].scope;
    if (!lockWait || !first.ok || second.ok || !second.msg.includes('LC_REASON_NEEDED') || scope !== 'Race job') {
      r1 = false; d1 = JSON.stringify({ lockWait, first, second, scope });
    }
  }
  check('payment vs reasonless edit: the edit waits, then is refused (LC_REASON_NEEDED)', r1, d1);

  // 2. The other order: the draft edit commits first, then the payment saves.
  let r2 = true, d2 = '';
  for (let i = 0; i < ROUNDS; i++) {
    const c = await newContract();
    const { first, second, lockWait } = await pair(
      IDS.OWNER, [`update labor_contracts set scope = 'draft edit' where id = $1 returning id`, [c]],
      IDS.OWNER, [PAY, [c, 500]]);
    note(first, second);
    const ev = (await admin.query(`select count(*)::int n from lc_events where contract_id = $1 and kind = 'edited'`, [c])).rows[0].n;
    if (!lockWait || !first.ok || !second.ok || ev !== 1) { r2 = false; d2 = JSON.stringify({ lockWait, first, second, ev }); }
  }
  check('draft edit vs payment: the payment waits, then both stand, one edit logged', r2, d2);

  // 3. An account is switched off while the main owner links it.
  let r3 = true, d3 = '';
  for (let i = 0; i < ROUNDS; i++) {
    await admin.query(`update profiles set status = 'active' where id = $1`, [IDS.W1]);
    const c = await newContract();
    const { first, second, lockWait } = await pair(
      IDS.OWNER, [`update profiles set status = 'inactive' where id = $1 returning id`, [IDS.W1]],
      IDS.OWNER, [`select lc_link($1, $2, 13, '') r`, [c, IDS.W1]]);
    note(first, second);
    const w = (await admin.query('select worker_id from labor_contracts where id = $1', [c])).rows[0].worker_id;
    if (!lockWait || second.ok || !second.msg.includes('NOT_ELIGIBLE') || w !== null) { r3 = false; d3 = JSON.stringify({ lockWait, second, w }); }
  }
  await admin.query(`update profiles set status = 'active' where id = $1`, [IDS.W1]);
  check('switch-off vs link: the link waits, then is refused (NOT_ELIGIBLE)', r3, d3);

  // 4. Two links at once: the second sees the first and needs a reason.
  let r4 = true, d4 = '';
  for (let i = 0; i < ROUNDS; i++) {
    const c = await newContract();
    const { first, second, lockWait } = await pair(
      IDS.OWNER, [`select lc_link($1, $2, 13, '') r`, [c, IDS.W1]],
      IDS.OWNER, [`select lc_link($1, $2, 15, '') r`, [c, IDS.W2]]);
    note(first, second);
    const w = (await admin.query('select worker_id from labor_contracts where id = $1', [c])).rows[0].worker_id;
    if (!lockWait || !first.ok || second.ok || !second.msg.includes('REASON_REQUIRED') || w !== IDS.W1) {
      r4 = false; d4 = JSON.stringify({ lockWait, first, second, w });
    }
  }
  check('two links at once: no silent overwrite (REASON_REQUIRED)', r4, d4);

  // 5. A payment is saved on a contract while it is merged away.
  let r5 = true, d5 = '';
  for (let i = 0; i < ROUNDS; i++) {
    const a = await newContract({ scope: 'A', amount: 1000 });
    const b = await newContract({ scope: 'B', amount: 2000 });
    await asOwner(PAY, [a, 100]);
    const { first, second, lockWait } = await pair(
      IDS.OWNER, [PAY, [b, 250]],
      IDS.OWNER, [`select lc_merge(array[$1, $2]::uuid[], $1, 'Package', 'one agreement') r`, [a, b]]);
    note(first, second);
    const paid = Number((await admin.query('select coalesce(sum(total_salary), 0) s from payroll where contract_id = $1', [a])).rows[0].s);
    const left = Number((await admin.query('select count(*)::int n from payroll where contract_id is null', [])).rows[0].n);
    if (!lockWait || !first.ok || !second.ok || paid !== 350 || left !== 0) { r5 = false; d5 = JSON.stringify({ lockWait, first, second, paid, left }); }
  }
  check('payment vs merge: the merge waits, and the new payment lands on the keeper', r5, d5);
  check('no deadlock in any round', !deadlock, '40P01 seen');
} finally {
  await admin.end();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
