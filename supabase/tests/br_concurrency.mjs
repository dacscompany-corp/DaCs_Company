// ═════════════════════════════════════════════════
// BILLING ACKNOWLEDGEMENT RECEIPTS (0114) — RACES ON REAL POSTGRESQL
//   npm run test:sql
// A throwaway PostgreSQL (embedded-postgres), 0114 VERBATIM over br_base.mjs.
// Each race holds the first transaction open, confirms the second is waiting
// on a lock, then commits the first.
// ═════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BR_SETUP, M114, IDS, seed, seedReceipts, F } from './br_base.mjs';

const ROUNDS = 5;
// --with-0117: the same races through 0117's bar_issue_with_payment / bar_reissue_with_payment.
// --with-0118: the same races through 0118's bar_issue_described / bar_reissue_described.
const WITH118 = process.argv.includes('--with-0118');
const WITH117 = WITH118 || process.argv.includes('--with-0117');
const M118 = WITH118 ? fs.readFileSync(new URL('../migrations/0118_receipt_description.sql', import.meta.url), 'utf8') : '';
const M117 = WITH117 ? fs.readFileSync(new URL('../migrations/0117_pc_receipt_payment_line.sql', import.meta.url), 'utf8') : '';
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-br-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\nBilling Acknowledgement Receipts — races (0114' + (WITH117 ? ' + 0117' : '') + (WITH118 ? ' + 0118' : '') + ' on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  // 0118 also defines the Project Management functions, so that mode needs 0116's tables too.
  const setup = WITH118 ? (await import('./pmar_base.mjs')).PMAR_SETUP : BR_SETUP;
  for (const part of setup) await admin.query(part);
  await admin.query(M114);
  if (WITH117) await admin.query(M117);
  if (WITH118) { await admin.query((await import('./pmar_base.mjs')).M116); await admin.query(M118); }
  await seed((sql) => admin.query(sql));
  await seedReceipts((sql) => admin.query(sql));

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
  const PAID = `(now() at time zone 'Asia/Manila')::date - 1, 'REF-1'`;
  const ISSUE = WITH118 ? `select bar_issue_described($1, 'MH', 'Ana', ${PAID}, 'Typed line') r` : WITH117 ? `select bar_issue_with_payment($1, 'MH', 'Ana', ${PAID}) r` : `select bar_issue($1, 'MH', 'Ana') r`;
  const REISSUE = WITH118 ? `select bar_reissue_described($1, 'changed', 'MH', 'Ana', ${PAID}, 'Typed line') r` : WITH117 ? `select bar_reissue_with_payment($1, 'changed', 'MH', 'Ana', ${PAID}) r` : `select bar_reissue($1, 'changed', 'MH', 'Ana') r`;
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
    const p = await newPeriod();
    const { first, second, lockWait } = await pair([ISSUE, [p]], [ISSUE, [p]]);
    note(first, second);
    const live = Number((await admin.query('select count(*) n from billing_receipts where period_id = $1', [p])).rows[0].n);
    if (!lockWait || !first.ok || !second.ok || first.r.id !== second.r.id || live !== 1) { r1 = false; d1 = JSON.stringify({ lockWait, first, second, live }); }
  }
  check('same billing pressed twice at once: the second waits and gets the same receipt', r1, d1);

  let r2 = true, d2 = '';
  for (let i = 0; i < ROUNDS; i++) {
    const [p, q] = [await newPeriod(), await newPeriod()];
    const { first, second, lockWait } = await pair([ISSUE, [p]], [ISSUE, [q]]);
    note(first, second);
    if (!lockWait || !first.ok || !second.ok || first.r.receipt_no === second.r.receipt_no) { r2 = false; d2 = JSON.stringify({ lockWait, first, second }); }
  }
  check('two billings at once: the second waits for the number and gets the next one', r2, d2);

  let r3 = true, d3 = '';
  for (let i = 0; i < ROUNDS; i++) {
    const p = await newPeriod();
    const s = await session();
    const old = (await s.query(ISSUE, [p])).rows[0].r;
    await s.end();
    const { first, second, lockWait } = await pair([REISSUE, [old.id]], [REISSUE, [old.id]]);
    note(first, second);
    const live = Number((await admin.query('select count(*) n from billing_receipts where period_id = $1 and voided_at is null', [p])).rows[0].n);
    if (!lockWait || !first.ok || second.ok || !second.msg.includes('ALREADY_VOID') || live !== 1) { r3 = false; d3 = JSON.stringify({ lockWait, first, second, live }); }
  }
  check('the same receipt re-issued twice at once: the second is refused, one live receipt', r3, d3);

  let r4 = true, d4 = '';
  for (let i = 0; i < ROUNDS; i++) {
    const p = await newPeriod();
    const s = await session();
    const old = (await s.query(ISSUE, [p])).rows[0].r;
    await s.end();
    const { first, second, lockWait } = await pair([REISSUE, [old.id]], [ISSUE, [p]]);
    note(first, second);
    const live = Number((await admin.query('select count(*) n from billing_receipts where period_id = $1 and voided_at is null', [p])).rows[0].n);
    if (!lockWait || !first.ok || !second.ok || second.r.id !== first.r.id || live !== 1) { r4 = false; d4 = JSON.stringify({ lockWait, first, second, live }); }
  }
  check('a re-issue and a new press at once: the press waits and gets the new receipt', r4, d4);

  const nos = (await admin.query('select receipt_no from billing_receipts')).rows.map(x => x.receipt_no);
  check('every number issued in these races is different', new Set(nos).size === nos.length, nos.join());
  check('no deadlocks', !deadlock, 'a race ended in 40P01');
} finally {
  await admin.end();
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
