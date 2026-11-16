// ════════════════════════════════════════════════════════════════════
// STAGE 2A-3a PHONE PURCHASING — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2a3_server.pglite.mjs)
//
// Same approach as 2a2_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 VERBATIM over the
// same minimal tables, pairs of calls released at the same moment on two
// connections. Nothing touches the live database.
//   1. two phone purchases for the same AW job with NO period → one period, both recorded
//   2. an AW purchase (making its period) against one for its parent project → no deadlock
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2a3-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2A-3a phone purchasing — two sessions at once (0096 + 0097 + 0101 on PostgreSQL)');
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

  // 1
  {
    let bad = 0, dead = 0, errs = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const main = await mkFolder('main ' + i);
      const aw = await mkFolder('job ' + i, main);
      const out = await pair(BUYER, REC, [buy(aw, 100)], BUYER2, REC, [buy(aw, 250)]);
      if (deadlock(out)) dead++;
      if (out.some(o => !o.ok)) errs++;
      if (await periods(aw) !== 1 || await spent(aw) !== 350) bad++;
    }
    check('1. two phone purchases for the same AW job with no period: one period made, both recorded in full',
      bad === 0 && dead === 0 && errs === 0, `wrong period count or Spent ${bad}, deadlocks ${dead}, failed calls ${errs}`);
  }
  // 2
  {
    let dead = 0, errs = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const main = await mkFolder('parent ' + i);
      await mkPeriod(main);
      const aw = await mkFolder('child ' + i, main);
      const out = await pair(BUYER, REC, [buy(aw, 100)], BUYER2, REC, [buy(main, 100)]);
      if (deadlock(out)) dead++;
      if (out.some(o => !o.ok)) errs++;
    }
    check('2. an AW purchase (making its period) against a purchase for its parent project: no deadlock, both recorded',
      dead === 0 && errs === 0, `deadlocks ${dead}, failed ${errs}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
