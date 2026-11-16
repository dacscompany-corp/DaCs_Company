// ════════════════════════════════════════════════════════════════════
// STAGE 4 RECONCILIATION — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 4_reconcile.pglite.mjs)
//
// Same approach as 2c_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104 +
// 0105 + 0106 + 0109 VERBATIM, pairs of calls released at the same moment on
// two connections. Nothing touches the live database.
//   1. "Cover is right" while the purchase is corrected → the line is
//      waiting exactly when it has no current mark, whichever came first
//   2. two owner tabs mark the same line → one mark
//   3. one press sent twice (same operation id) → one mark, one tick
//   4. an Add Expense save's first request and a recovery at once → recorded
//      (and never cancelled) or cancelled (and never recorded)
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
const M02 = mig('0002_rls.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
const BUYER = '00000000-0000-0000-0000-000000000011';
const ROUNDS = 15;
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const LONG_AGO = new Date(Date.now() + 8 * 3600e3 - 100 * 86400e3).toISOString().slice(0, 10);
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-4-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\nStage 4 reconciliation — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 + 0105 + 0106 + 0109 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id), completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int, created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null, monthly_budget numeric not null default 0);
create table expenses (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false, split_group text, split_index int, split_total int,
  client_submission_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade, total_salary numeric);
create table inventory (id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid, created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}`);
  await admin.query(mig('0096_purchase_recording.sql'));
  await admin.query(prBase(ROOT));
  await admin.query(CATALOG_0085);
  await admin.query(mig('0097_purchasing_office.sql'));
  await admin.query(mig('0101_purchasing_phone.sql'));
  await admin.query(fnText(mig('0098_pm_profit_sharing.sql'), 'pm_main_owner_id'));
  await admin.query(mig('0102_purchase_payments.sql'));
  await admin.query(fnText(mig('0090_workmate_item_history.sql'), 'pr_clean_aliases'));
  await admin.query(mig('0104_stock.sql'));
  await admin.query(mig('0105_stock_cost_moves.sql'));
  // 0106 (pur_op_cancel, and pur_op_begin refusing a cancelled id): its
  // pr_my_requests reads request tables this harness does not build, so its
  // bodies are not checked here (2bb_phone.pglite.mjs runs it).
  await admin.query(`set check_function_bodies = off`);
  await admin.query(mig('0106_workmate_phone_stock.sql'));
  await admin.query(`set check_function_bodies = on`);
  await admin.query(mig('0109_reconciliation.sql'));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${STAFF}', 'staff', '${OWNER}', 'active', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true);
    select stk_set_enabled(true);`);

  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const as = (uid) => admin.query(`select set_config('test.uid', '${uid}', false)`);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // A project whose only billing period is ~100 days ago, and a purchase today: Cover + "Office review".
  const body = (f) => ({ source: 'purchasing', purchase_date: TODAY, receipt_total: 344, supplier: 'Wilcon',
    lines: [{ destination: 'project', folder_id: f, item_name: 'PAINTING MATERIALS', category: 'Materials', unit: 'lot', quantity: 1,
              amount: 344, unplanned_reason: 'test' }] });
  const uncovered = async (name) => {
    const f = (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
    const d = new Date(LONG_AGO + 'T00:00:00Z');
    const p = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                          values ($1, $2, $3, $4, 'progress', 1) returning id`, [OWNER, f, months[d.getUTCMonth()], d.getUTCFullYear()])).id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
    await as(BUYER);
    const pid = (await one(`select pur_record(gen_random_uuid(), $1::jsonb) r`, [JSON.stringify(body(f))])).r.purchase_id;
    return { f, pid };
  };
  const flag = async (pid) => (await one(`select needs_funding_review x from purchase_lines where purchase_id = $1 and line_no = 1`, [pid])).x;
  const currentMarks = async (pid) => Number((await one(`select count(*) n from rec_cover_marks m where m.purchase_id = $1 and rec_mark_current(m.id)`, [pid])).n);
  const marks = async (pid) => Number((await one(`select count(*) n from rec_cover_marks where purchase_id = $1`, [pid])).n);

  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  // delayA: start A's call that many ms after B's (0: together).
  async function pair(uidA, sqlA, argsA, uidB, sqlB, argsB, delayA = 0) {
    const [a, b] = [await session(uidA), await session(uidB)];
    const run = async (c, sql, args, wait = 0) => {
      try {
        if (wait) await new Promise(r => setTimeout(r, wait));
        await c.query('begin');
        const r = await c.query(sql, args);
        await c.query('select pg_sleep(0.03)');
        await c.query('commit');
        return { ok: true, r: r.rows[0] && r.rows[0].r };
      } catch (e) {
        try { await c.query('rollback'); } catch {}
        return { ok: false, code: e.code, msg: e.message };
      }
    };
    const out = await Promise.all([run(a, sqlA, argsA, delayA), run(b, sqlB, argsB)]);
    await a.end(); await b.end();
    return out;
  }
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');
  const ACCEPT = `select rec_accept_cover($1, $2, 1, 'No client allocation this month') r`;
  const CORRECT = `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'photo added') r`;

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const { f, pid } = await uncovered('race1 ' + i);
      const out = await pair(OWNER, ACCEPT, [crypto.randomUUID(), pid], BUYER, CORRECT, [pid, JSON.stringify(body(f))]);
      if (deadlock(out)) dead++;
      // Mark first, then the correction re-checks the line (waiting again, the mark no longer current);
      // or the correction first, then the mark on the line as it is now (not waiting, the mark current).
      const fl = await flag(pid), cur = await currentMarks(pid);
      const ok = out[1].ok && ((fl === true && cur === 0) || (fl === false && cur === 1)) && (out[0].ok || /NOT_WAITING/.test(out[0].msg));
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out), fl, cur);
    }
    check('1. "Cover is right" while the purchase is corrected: waiting exactly when no mark applies — never a cleared line without its mark',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 2
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const { pid } = await uncovered('race2 ' + i);
      const out = await pair(OWNER, ACCEPT, [crypto.randomUUID(), pid], OWNER, ACCEPT, [crypto.randomUUID(), pid]);
      if (deadlock(out)) dead++;
      const okCount = out.filter(o => o.ok).length;
      const ok = okCount === 1 && out.some(o => !o.ok && /NOT_WAITING/.test(o.msg)) && await marks(pid) === 1
        && await flag(pid) === false && await currentMarks(pid) === 1;
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('2. two owner tabs mark the same line at once: one mark, the other told it is no longer waiting',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 3
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const { pid } = await uncovered('race3 ' + i);
      const id = crypto.randomUUID();
      const out = await pair(OWNER, ACCEPT, [id, pid], OWNER, ACCEPT, [id, pid]);
      if (deadlock(out)) dead++;
      const ok = out.every(o => o.ok) && out[0].r.mark_id === out[1].r.mark_id && await marks(pid) === 1;
      if (!ok && bad++ === 0) console.log('       first bad:', JSON.stringify(out));
    }
    check('3. one "Cover is right" press sent twice (same operation id): one mark, the same answer both times',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 4
  {
    let bad = 0, dead = 0;
    const seen = { recorded: 0, cancelled: 0 };
    const RECORD = `select pur_record($1, $2::jsonb) r`;
    const RECOVER = `select pur_op_recover() r`;
    for (let i = 0; i < ROUNDS; i++) {
      const f = (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, 'race4 ' + i])).id;
      const id = crypto.randomUUID();
      await as(OWNER);
      await admin.query(`select pur_op_reserve($1)`, [id]);
      const b = { source: 'expenses_form', purchase_date: TODAY, receipt_total: 60, no_receipt_reason: 'test',
        lines: [{ destination: 'project', folder_id: f, item_name: 'Glue', category: 'Materials', unit: 'pc', quantity: 1, amount: 60 }] };
      // Even rounds: released together; odd rounds: the first request 15 ms after the recovery began (it holds
      // the operation's lock 30 ms), so both orders are exercised.
      const out = await pair(OWNER, RECORD, [id, JSON.stringify(b)], OWNER, RECOVER, [], i % 2 ? 15 : 0);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select count(distinct l.purchase_id) n from purchase_lines l where l.folder_id = $1`, [f])).n);
      const kind = (await one(`select kind from pur_ops where actor_id = $1 and op_id = $2`, [OWNER, id]))?.kind;
      // Recorded first: one purchase, and recovery found it recorded (or settled already) — nothing cancelled.
      // Recovery first: cancelled for good, the first request refused, no purchase.
      const recorded = out[0].ok && n === 1 && kind === 'record' && out[1].ok && out[1].r.cancelled === 0;
      const cancelled = !out[0].ok && /OP_CANCELLED/.test(out[0].msg) && n === 0 && kind === 'cancelled' && out[1].ok && out[1].r.cancelled === 1;
      if (recorded) seen.recorded++; else if (cancelled) seen.cancelled++;
      else if (bad++ === 0) console.log('       first bad:', JSON.stringify(out), n, kind);
    }
    console.log(`       (${seen.recorded} rounds recorded first, ${seen.cancelled} cancelled first)`);
    check('4. an Add Expense save\'s first request and a recovery at once: recorded or cancelled — never both, never neither (both orders seen)',
      bad === 0 && dead === 0 && seen.recorded > 0 && seen.cancelled > 0,
      `wrong outcome ${bad}, deadlocks ${dead}, recorded first ${seen.recorded}, cancelled first ${seen.cancelled}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
