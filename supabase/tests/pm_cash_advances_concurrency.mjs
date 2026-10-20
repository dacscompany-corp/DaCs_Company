// ════════════════════════════════════════════════════════════════════
// PM WORKER CASH ADVANCES (0100) — RACES ON REAL POSTGRESQL
//   npm run test:sql
// A throwaway PostgreSQL (embedded-postgres), 0098 + 0100 VERBATIM. Two
// owner sessions act on the SAME advance at the same moment; the advance
// row lock (R13) must serialise them and the op id (R16) must make a
// doubled submission record once. Then a real-role pass as `authenticated`.
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PM_BASE, IDS, seedProfiles, M98, M100, PAYROLL_STANDIN, SUPABASE_DEFAULT_GRANTS } from './pm_cash_advances_base.mjs';

const ROUNDS = 12;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-pmca-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

const REPAY = `select pm_ca_record_repayment($1, $2, '2026-10-08', $3::numeric, null, null) r`;
const EDIT  = `select pm_ca_edit_advance($1, $2, $3, 'Racer', '2026-10-01', $4::numeric, 30, null) r`;
const VOIDA = `select pm_ca_void_advance($1, $2, 'race') r`;

console.log('\nPM worker cash advances — races (0100 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(PM_BASE);
  await admin.query(SUPABASE_DEFAULT_GRANTS);
  await admin.query(PAYROLL_STANDIN);
  await admin.query(M98);
  await admin.query(M100);
  await seedProfiles((sql) => admin.query(sql));

  const asOwner = async (sql, params) => {
    await admin.query(`select set_config('test.uid', '${IDS.OWNER}', false)`);
    return (await admin.query(sql, params)).rows[0];
  };
  const pid = (await asOwner(`insert into construction_projects (project_name, status) values ('Race site', 'active') returning id`)).id;
  const newAdvance = async (amount) => (await asOwner(
    `select pm_ca_record_advance($1, $2, 'Racer', '2026-10-01', $3::numeric, 30, null) r`, [randomUUID(), pid, amount])).r.advance.id;
  const repaid = async (id) => Number((await admin.query(
    `select coalesce(sum(amount), 0) s from pm_cash_advance_repayments where advance_id = $1 and voided_at is null`, [id])).rows[0].s);
  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    try {
      await c.query(`select set_config('test.uid', '${uid}', false)`);
      return c;
    } catch (e) {
      try { await c.end(); } catch {}
      throw e;
    }
  };
  // Hold the first transaction open after its function returns. Start the
  // second call against the same rows / operation id and confirm PostgreSQL
  // reports that backend waiting on a lock before releasing the first.
  const resultOf = async (promise) => {
    try { return { ok: true, r: (await promise).rows[0].r }; }
    catch (e) { return { ok: false, code: e.code, msg: e.message }; }
  };
  const pair = async (a, b) => {
    let s1, s2;
    let first;
    let secondPromise;
    let lockWait = false;
    try {
      s1 = await session(IDS.OWNER);
      s2 = await session(IDS.OWNER);
      await s1.query('begin');
      first = await resultOf(s1.query(...a));
      await s2.query('begin');
      const pid2 = (await s2.query('select pg_backend_pid() pid')).rows[0].pid;
      let secondDone = false;
      secondPromise = resultOf(s2.query(...b)).finally(() => { secondDone = true; });
      for (let i = 0; i < 200 && !secondDone; i++) {
        const wait = (await admin.query(
          `select wait_event_type from pg_stat_activity where pid = $1`, [pid2])).rows[0]?.wait_event_type;
        if (wait === 'Lock') { lockWait = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await s1.query('commit');
      const second = await secondPromise;
      if (second.ok) await s2.query('commit');
      else await s2.query('rollback');
      return { out: [first, second], lockWait };
    } catch (e) {
      try { await s1?.query('rollback'); } catch {}
      try { await s2?.query('rollback'); } catch {}
      throw e;
    } finally {
      await Promise.allSettled([s1?.end(), s2?.end()]);
    }
  };
  let deadlock = false;
  const noteDeadlock = (rs) => { if (rs.some(r => r.code === '40P01')) deadlock = true; };

  // 1. Two repayments race for the last of a balance.
  let r1 = true, r1b = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newAdvance('1000');
    const { out: rs, lockWait } = await pair([REPAY, [randomUUID(), id, '600']], [REPAY, [randomUUID(), id, '600']]);
    noteDeadlock(rs);
    if (!lockWait || rs.filter(r => r.ok).length !== 1 || !rs.find(r => !r.ok)?.msg.includes('OVER_BALANCE')) r1 = false;
    if (await repaid(id) !== 600) r1b = false;
  }
  check('two repayments for the last of a balance: exactly one wins, the other OVER_BALANCE', r1, 'a round broke the rule');
  check('repaid never exceeds the advance', r1b, 'repaid ≠ 600');

  // 2. A repayment races an amount reduction.
  let r2 = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newAdvance('1000');
    const { out: rs, lockWait } = await pair([REPAY, [randomUUID(), id, '600']], [EDIT, [randomUUID(), id, pid, '500']]);
    noteDeadlock(rs);
    const loser = rs.find(r => !r.ok);
    const amount = Number((await admin.query(`select amount from pm_cash_advances where id = $1`, [id])).rows[0].amount);
    if (!lockWait || rs.filter(r => r.ok).length !== 1 || !loser || !/BELOW_REPAID|OVER_BALANCE/.test(loser.msg) || await repaid(id) > amount) r2 = false;
  }
  check('repayment vs amount reduction: one wins, repaid ≤ amount', r2, 'a round broke the rule');

  // 3. A repayment races voiding the advance.
  let r3 = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newAdvance('1000');
    const { out: rs, lockWait } = await pair([REPAY, [randomUUID(), id, '600']], [VOIDA, [randomUUID(), id]]);
    noteDeadlock(rs);
    const loser = rs.find(r => !r.ok);
    if (!lockWait || rs.filter(r => r.ok).length !== 1 || !loser || !/HAS_REPAYMENTS|VOIDED/.test(loser.msg)) r3 = false;
  }
  check('repayment vs void advance: exactly one wins', r3, 'a round broke the rule');

  // 4. The same op id submitted twice at once (R16).
  let r4 = true;
  for (let i = 0; i < ROUNDS; i++) {
    const id = await newAdvance('1000');
    const op = randomUUID();
    const { out: rs, lockWait } = await pair([REPAY, [op, id, '300']], [REPAY, [op, id, '300']]);
    noteDeadlock(rs);
    const n = Number((await admin.query(`select count(*) n from pm_cash_advance_repayments where advance_id = $1`, [id])).rows[0].n);
    const ev = Number((await admin.query(`select count(*) n from pm_cash_advance_events where advance_id = $1 and kind = 'repaid'`, [id])).rows[0].n);
    if (!lockWait || !rs.every(r => r.ok) || JSON.stringify(rs[0].r) !== JSON.stringify(rs[1].r) || n !== 1 || ev !== 1) r4 = false;
  }
  check('same op id twice at once: one repayment, one event, identical results', r4, 'a round broke the rule');
  check('no deadlock in any round', !deadlock, '40P01 seen');

  // ── Real-role pass: `authenticated` / `anon` with Supabase-like grants ──
  await admin.query(`grant usage on schema public to authenticated, anon;
    grant select, insert, update on construction_projects, profiles to authenticated;`);
  const asRole = async (role, uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query('set role ' + role);
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  const errOf = async (c, sql, params) => { try { await c.query(sql, params); return null; } catch (e) { return e; } };
  const someId = await newAdvance('100');
  const own = await asRole('authenticated', IDS.OWNER);
  let listed = null;
  try { listed = (await own.query('select pm_ca_list() r')).rows[0].r; } catch (e) { listed = { err: e.message }; }
  check('(a) owner lists through pm_ca_list as authenticated', Array.isArray(listed) && listed.some(a => a.id === someId), JSON.stringify(listed).slice(0, 200));
  let rec = null;
  try { rec = (await own.query(`select pm_ca_record_advance($1, $2, 'Role pass', '2026-10-01', 50, 30, null) r`, [randomUUID(), pid])).rows[0].r; }
  catch (e) { rec = { err: e.message }; }
  check('(b) owner records through the function as authenticated', rec && rec.advance && rec.advance.worker_name === 'Role pass', JSON.stringify(rec));
  for (const [label, sql] of [['(c) direct select on pm_cash_advances', 'select * from pm_cash_advances'],
                              ['(d) direct insert into pm_cash_advance_ops', `insert into pm_cash_advance_ops (op_id, company_owner_id, action, actor_id) values (gen_random_uuid(), '${IDS.OWNER}', 'void_advance', '${IDS.OWNER}')`],
                              ['(e) private helper pm_ca_advance_json', `select pm_ca_advance_json('${someId}')`]]) {
    const e = await errOf(own, sql);
    check(label + ' fails 42501', e && e.code === '42501', e ? e.code + ' ' + e.message : 'no error');
  }
  await own.end();
  const stf = await asRole('authenticated', IDS.STAFF);
  const eS = await errOf(stf, 'select pm_ca_list()');
  check('(f) staff pm_ca_list raises OWNER_ONLY', eS && /OWNER_ONLY/.test(eS.message), eS ? eS.message : 'no error');
  await stf.end();
  const anon = await asRole('anon', '');
  const eA = await errOf(anon, 'select pm_ca_list()');
  check('(g) anon cannot execute pm_ca_list (42501)', eA && eA.code === '42501', eA ? eA.code + ' ' + eA.message : 'no error');
  await anon.end();
} finally {
  await admin.end();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log(failures.join('\n')); process.exit(1); }
