// ════════════════════════════════════════════════════════════════════
// STAGE 2A-4a PAYMENTS — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2a4_payments.pglite.mjs)
//
// Same approach as 2a3_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 VERBATIM
// over the same minimal tables, pairs of calls released at the same moment
// on two connections. Nothing touches the live database.
//   1. two buyers use the same supplier credit at once → never past what is left
//   2. two refunds of the same overpayment at once → the same peso resolved once
//   3. two repayments at once → never repaid past what is owed
//   4. the same "paid now" press twice at once → one purchase, one payment
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const M02 = read(path.join(ROOT, 'supabase/migrations/0002_rls.sql'));
const M94 = read(path.join(ROOT, 'supabase/migrations/0094_workmate_work_plan_office.sql'));

const OWNER = '00000000-0000-0000-0000-00000000000a';
const BUYER = '00000000-0000-0000-0000-000000000011';
const BUYER2 = '00000000-0000-0000-0000-000000000012';
const ROUNDS = 15;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2a4-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2A-4a payments — two sessions at once (0096 + 0097 + 0101 + 0102 on PostgreSQL)');
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
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql')));
  await admin.query(prBase(ROOT));
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql')));
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql')));
  await admin.query(fnText(read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')), 'pm_main_owner_id'));
  await admin.query(read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sql')));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', 'Pedro');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true); select pur_set_buyer('${BUYER2}', true);`);

  const mkFolder = async (name, parent = null) =>
    (await admin.query(`insert into folders (owner_id, name, parent_folder_id) values ($1, $2, $3) returning id`, [OWNER, name, parent])).rows[0].id;
  const mkPeriod = async (f) => {
    const p = (await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                                  values ($1, $2, 'October', 2026, 'progress', 1) returning id`, [OWNER, f])).rows[0].id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
  };
  const buy = (f, amount) => JSON.stringify({ source: 'workmate', purchase_date: '2026-10-14', receipt_total: amount,
    docs: { po_image_url: 'https://example.test/receipt.jpg' },
    lines: [{ destination: 'project', folder_id: f, item_name: 'Lumber', unit: 'pc', amount, unplanned_reason: 'test' }] });
  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  async function pair(uidA, sqlA, argsA, uidB, sqlB, argsB) {
    const [a, b] = [await session(uidA), await session(uidB)];
    const run = async (c, sql, args) => {
      try {
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
    const out = await Promise.all([run(a, sqlA, argsA), run(b, sqlB, argsB)]);
    await a.end(); await b.end();
    return out;
  }
  const REC = `select pur_record(gen_random_uuid(), $1::jsonb) r`;
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');
  const periods = async (f) => Number((await admin.query(`select count(*) n from projects where folder_id = $1`, [f])).rows[0].n);
  const spent = async (f) => Number((await admin.query(`select coalesce(sum(e.amount), 0) s from expenses e join projects p on p.id = e.project_id
                                                          where p.folder_id = $1`, [f])).rows[0].s);

  const PAY = `select pur_pay(gen_random_uuid(), $1, $2::jsonb) r`;
  const RESOLVE = `select pur_resolve_overpaid(gen_random_uuid(), $1, $2::jsonb, null) r`;
  const REPAY = `select pur_repay_buyer(gen_random_uuid(), $1, $2, '2026-10-14', 'cash', '') r`;
  const asOwner = () => admin.query(`select set_config('test.uid', '${OWNER}', false)`);
  const asBuyer = () => admin.query(`select set_config('test.uid', '${BUYER}', false)`);
  const supplier = (await admin.query(`insert into suppliers (owner_id, name, created_by) values ($1, 'Wilcon', $1) returning id`, [OWNER])).rows[0].id;
  const recordFor = async (f, amount, extra = {}) => {
    await asBuyer();
    const b = JSON.parse(buy(f, amount));
    return (await admin.query(`select pur_record(gen_random_uuid(), $1::jsonb) r`, [JSON.stringify({ ...b, supplier_id: supplier, ...extra })])).rows[0].r.purchase_id;
  };
  const P = (amount, extra = {}) => JSON.stringify({ amount: String(amount), paid_on: '2026-10-14', method: 'cash', source: 'company', ...extra });
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('credit ' + i); await mkPeriod(f);
      const over = await recordFor(f, 100);
      await admin.query(`select pur_pay(gen_random_uuid(), $1, $2::jsonb)`, [over, P(600)]);
      await asOwner();
      const credit = (await one(`select pur_resolve_overpaid(gen_random_uuid(), $1, '[]'::jsonb, '{"amount":"500"}'::jsonb) r`, [over])).r.created[0].credit_id;
      const a = await recordFor(f, 300);
      const b = await recordFor(f, 300);
      const out = await pair(BUYER, PAY, [a, P(300, { source: 'credit', credit_id: credit })],
                             BUYER2, PAY, [b, P(300, { source: 'credit', credit_id: credit })]);
      if (deadlock(out)) dead++;
      const left = Number((await one(`select pur_credit_left($1) v`, [credit])).v);
      const oks = out.filter(o => o.ok).length;
      if (oks !== 1 || left !== 200 || !out.some(o => !o.ok && /OVER_CREDIT/.test(o.msg))) bad++;
    }
    check('1. two buyers use the same ₱500 credit for ₱300 each at once: exactly one is accepted, ₱200 left, never below zero',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 2
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('over ' + i); await mkPeriod(f);
      const p = await recordFor(f, 100);
      await admin.query(`select pur_pay(gen_random_uuid(), $1, $2::jsonb)`, [p, P(400)]);
      const part = JSON.stringify([{ amount: '200', funded_by: 'company', received_by: 'company', received_on: '2026-10-14' }]);
      const out = await pair(OWNER, RESOLVE, [p, part], OWNER, RESOLVE, [p, part]);
      if (deadlock(out)) dead++;
      const st = (await one(`select pur_pay_state($1) s`, [p])).s;
      if (out.filter(o => o.ok).length !== 1 || Number(st.resolved) !== 200 || Number(st.unresolved) !== 100) bad++;
    }
    check('2. two ₱200 refunds of the same ₱300 overpayment at once: one is accepted, the same peso is never resolved twice',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 3
  {
    let bad = 0, dead = 0;
    await asOwner();
    await admin.query(`select pur_set_own_money($1, true)`, [BUYER]);
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('own ' + i); await mkPeriod(f);
      const p = await recordFor(f, 1000);
      await admin.query(`select pur_pay(gen_random_uuid(), $1, $2::jsonb)`, [p, P(1000, { source: 'own_money' })]);
      await asOwner();
      const owedBefore = Number((await one(`select pur_owes($1, $2) v`, [OWNER, BUYER])).v);
      const out = await pair(OWNER, REPAY, [BUYER, String(owedBefore - 400)], OWNER, REPAY, [BUYER, String(owedBefore - 400)]);
      if (deadlock(out)) dead++;
      const owed = Number((await one(`select pur_owes($1, $2) v`, [OWNER, BUYER])).v);
      if (out.filter(o => o.ok).length !== 1 || owed !== 400) bad++;
      // settle what is left so the next round starts from what it adds
      await admin.query(`select pur_repay_buyer(gen_random_uuid(), $1, $2, '2026-10-14', 'cash', '')`, [BUYER, String(owed)]);
    }
    check('3. two repayments that together pass what is owed, at once: one is accepted, never repaid past the balance',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 4
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('press ' + i); await mkPeriod(f);
      const press = (await one(`select gen_random_uuid() id`)).id;
      const b = JSON.stringify({ ...JSON.parse(buy(f, 500)), payments: [JSON.parse(P(500))] });
      const SAME = `select pur_record('${press}'::uuid, $1::jsonb) r`;
      const out = await pair(BUYER, SAME, [b], BUYER, SAME, [b]);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select count(*) n from purchases pu join purchase_lines l on l.purchase_id = pu.id where l.folder_id = $1`, [f])).n);
      const pays = Number((await one(`select count(*) n from pur_payments x join purchase_lines l on l.purchase_id = x.purchase_id where l.folder_id = $1`, [f])).n);
      if (out.some(o => !o.ok) || n !== 1 || pays !== 1) bad++;
    }
    check('4. the same "paid now" press sent twice at once: one purchase, one payment, both calls answered',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
