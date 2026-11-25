// ═════════════════════════════════════════════════
// PM BILLING DOCUMENTS (0116) — RACES ON REAL POSTGRESQL
//   npm run test:sql
// A throwaway PostgreSQL (embedded-postgres), 0114 + 0116 VERBATIM over
// pmar_base.mjs. Each race holds the first transaction open, confirms the
// second is waiting on a lock, then commits the first.
// ═════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PMAR_SETUP, M114, M116, IDS, seed, seedReceipts, seedPm, F, PM } from './pmar_base.mjs';

const ROUNDS = 5;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-pmar-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

// --with-0118: the same races through 0118's pmar_issue_described / pmar_reissue_described.
const WITH118 = process.argv.includes('--with-0118');
const M117 = WITH118 ? fs.readFileSync(new URL('../migrations/0117_pc_receipt_payment_line.sql', import.meta.url), 'utf8') : '';
const M118 = WITH118 ? fs.readFileSync(new URL('../migrations/0118_receipt_description.sql', import.meta.url), 'utf8') : '';
console.log('\nPM Billing Documents — races (0116' + (WITH118 ? ' + 0118' : '') + ' on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  for (const part of PMAR_SETUP) await admin.query(part);
  await admin.query(M114);
  await admin.query(M116);
  if (WITH118) { await admin.query(M117); await admin.query(M118); }
  await seed((sql) => admin.query(sql));
  await seedReceipts((sql) => admin.query(sql));
  await seedPm((sql) => admin.query(sql));

  const newPayment = async (amount = 1000) => (await admin.query(`insert into payment_requests
      (construction_project_id, kind, source, status, amount, total_amount, amount_paid, paid_amount, week_ending_date)
      values ('${PM.A}', 'construction', 'manual_payment', 'verified', $1, $1, $1, $1, '2026-11-18') returning id`, [amount])).rows[0].id;
  const newPeriod = async (amount = 1000) => {
    const id = (await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
      values ('${IDS.OWNER}', '${F.A}', 'November', 2026, 'progress', 1) returning id`)).rows[0].id;
    await admin.query(`insert into project_budgets (project_id, owner_id, monthly_budget) values ($1, '${IDS.OWNER}', $2)`, [id, amount]);
    return id;
  };
  const session = async () => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${IDS.OWNER}', false)`);
    return c;
  };
  const resultOf = async (promise) => {
    try { return { ok: true, r: (await promise).rows[0].r }; }
    catch (e) { return { ok: false, code: e.code, msg: e.message }; }
  };
  const ISSUE = WITH118 ? `select pmar_issue_described($1, 'Sample Client', 'Ana', 'Typed line') r` : `select pmar_issue($1, 'Sample Client', 'Ana') r`;
  const REISSUE = WITH118 ? `select pmar_reissue_described($1, 'changed', 'Sample Client', 'Ana', 'Typed line') r` : `select pmar_reissue($1, 'changed', 'Sample Client', 'Ana') r`;
  const BAR_ISSUE = `select bar_issue($1, 'MH', 'Ana') r`;
  // a runs first and stays open; b must wait on a lock until a commits.
  const pair = async (a, b) => {
    let s1, s2;
    try {
      s1 = await session();
      s2 = await session();
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

  let r1 = true, d1 = '';
  for (let i = 0; i < ROUNDS; i++) {
    const p = await newPayment();
    const { first, second, lockWait } = await pair([ISSUE, [p]], [ISSUE, [p]]);
    note(first, second);
    const live = Number((await admin.query('select count(*) n from pm_billing_receipts where payment_id = $1', [p])).rows[0].n);
    if (!lockWait || !first.ok || !second.ok || first.r.id !== second.r.id || live !== 1) { r1 = false; d1 = JSON.stringify({ lockWait, first, second, live }); }
  }
  check('two presses at once give one receipt', r1, d1);

  let r2 = true, d2 = '';
  for (let i = 0; i < ROUNDS * 2; i++) {
    const [period, pay] = [await newPeriod(), await newPayment()];
    const order = i % 2 ? [[BAR_ISSUE, [period]], [ISSUE, [pay]]] : [[ISSUE, [pay]], [BAR_ISSUE, [period]]];
    const { first, second, lockWait } = await pair(...order);
    note(first, second);
    if (!lockWait || !first.ok || !second.ok || first.r.receipt_no === second.r.receipt_no) { r2 = false; d2 = JSON.stringify({ lockWait, first, second }); }
  }
  const all = (await admin.query(`select receipt_no from billing_receipts union all select receipt_no from pm_billing_receipts`)).rows
    .map(x => x.receipt_no).sort();
  const seq = all.map(x => Number(x.split('-')[2]));
  const consecutive = seq.every((v, i) => v === i + 1);
  check('PC and PM issuing at the same moment never share a number', r2 && new Set(all).size === all.length && consecutive,
        d2 || all.join());

  let r3 = true, d3 = '';
  for (let i = 0; i < ROUNDS; i++) {
    const p = await newPayment();
    const s = await session();
    const old = (await s.query(ISSUE, [p])).rows[0].r;
    await s.end();
    const { first, second, lockWait } = await pair([REISSUE, [old.id]], [ISSUE, [p]]);
    note(first, second);
    const live = Number((await admin.query('select count(*) n from pm_billing_receipts where payment_id = $1 and voided_at is null', [p])).rows[0].n);
    if (!lockWait || !first.ok || !second.ok || second.r.id !== first.r.id || live !== 1) { r3 = false; d3 = JSON.stringify({ lockWait, first, second, live }); }
  }
  check('re-issue racing an issue leaves exactly one live receipt', r3, d3);
  check('no deadlocks', !deadlock, 'a race ended in 40P01');
} finally {
  await admin.end();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
