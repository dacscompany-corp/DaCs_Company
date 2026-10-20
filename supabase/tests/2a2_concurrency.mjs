// ════════════════════════════════════════════════════════════════════
// STAGE 2A-2 PURCHASING — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2a2_purchasing.pglite.mjs)
//
// Same approach as 2a1_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 VERBATIM over the same
// minimal tables, pairs of calls released at the same moment on two
// connections. Nothing touches the live database.
//   1. two buyers claim the SAME portion          → exactly one wins, no deadlock
//   2. two purchases cover the SAME last 10       → never more than 10 covered
//   3. a purchase against an office reduction     → no deadlock, never over-covered
//   4. purchase A+B against purchase B+A          → no deadlock
//   5. an assignment against a purchase           → no deadlock, one buyer holds it
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
const WORKER = '00000000-0000-0000-0000-00000000000c';
const ROUNDS = 15;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2a2-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2A-2 purchasing — two sessions at once (0096 + 0097 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(`
create role anon; create role authenticated;
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
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'),
    ('${BUYER2}', 'staff', '${OWNER}', 'active', 'Pedro'), ('${WORKER}', 'worker', '${OWNER}', 'active', 'Mark');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true); select pur_set_buyer('${BUYER2}', true);`);

  const mkFolder = async (name) => {
    const f = (await admin.query(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).rows[0].id;
    const p = (await admin.query(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                                  values ($1, $2, 'October', 2026, 'progress', 1) returning id`, [OWNER, f])).rows[0].id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
    return f;
  };
  const mkLine = async (f, qty) => {
    const b = (await admin.query(`select pr_batch_for($1, now()) b`, [OWNER])).rows[0].b;
    const r = (await admin.query(`insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ($1, $2, $3, $3) returning id`, [OWNER, WORKER, f])).rows[0].id;
    const l = (await admin.query(`insert into pr_lines (owner_id, request_id, description, unit) values ($1, $2, 'Cement', 'bag') returning id`, [OWNER, r])).rows[0].id;
    const p = (await admin.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, $4) returning id`, [OWNER, l, b, qty])).rows[0].id;
    return { line: l, portion: p };
  };
  const buy = (f, lines) => JSON.stringify({ source: 'purchasing', purchase_date: '2026-10-14',
    receipt_total: lines.reduce((s, l) => s + l.amount, 0),
    lines: lines.map(l => ({ destination: 'project', folder_id: f, item_name: 'Cement', unit: 'bag',
                             extra_reason: 'test', extra_location: 'project', ...l })) });
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
  const CLAIM = `select pur_assign_portion($1, $2, null, null) r`;
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');
  const covered = async (line) => Number((await admin.query(`select pr_line_bought($1) n`, [line])).rows[0].n);
  const portionsOk = async (line) => (await admin.query(
    `select bool_and(pr_portion_bought(id) <= quantity) ok from pr_line_portions where line_id = $1`, [line])).rows[0].ok;

  // 1
  {
    let wins = 0, dead = 0, bad = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('claim ' + i);
      const t = await mkLine(f, 10);
      const out = await pair(BUYER, CLAIM, [t.portion, BUYER], BUYER2, CLAIM, [t.portion, BUYER2]);
      if (deadlock(out)) dead++;
      const ok = out.filter(o => o.ok).length;
      if (ok === 1 && out.some(o => !o.ok && /ASSIGNED_TO_OTHER/.test(o.msg))) wins++; else bad++;
    }
    check('1. two buyers claim the same portion: exactly one wins, the other is told it is taken', wins === ROUNDS && dead === 0,
      `wins ${wins}, deadlocks ${dead}, other outcomes ${bad}`);
  }
  // 2
  {
    let over = 0, dead = 0, errs = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('cover ' + i);
      const t = await mkLine(f, 10);
      const out = await pair(BUYER, REC, [buy(f, [{ quantity: 7, amount: 700, request_line_id: t.line }])],
                             BUYER2, REC, [buy(f, [{ quantity: 7, amount: 700, request_line_id: t.line }])]);
      if (deadlock(out)) dead++;
      if (out.some(o => !o.ok)) errs++;
      if (await covered(t.line) > 10 || !(await portionsOk(t.line))) over++;
    }
    check('2. two purchases on the same last 10: both recorded, never more than 10 covered (the rest is extra)',
      over === 0 && dead === 0 && errs === 0, `over-covered ${over}, deadlocks ${dead}, failed calls ${errs}`);
  }
  // 3
  {
    let over = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('reduce ' + i);
      const t = await mkLine(f, 10);
      const out = await pair(BUYER, REC, [buy(f, [{ quantity: 6, amount: 600, request_line_id: t.line }])],
                             OWNER, `select pr_office_change_quantity($1, 3, 'site has some') r`, [t.line]);
      if (deadlock(out)) dead++;
      // What the line needed BEFORE the reduction was 10: whichever order the two ran in,
      // what is recorded as bought never exceeds that, and no cover exceeds its portion.
      const bought = Number((await admin.query(`select coalesce(sum(c.quantity), 0) s from purchase_line_covers c
                                                  join purchase_lines l on l.id = c.line_id join purchases pu on pu.id = l.purchase_id
                                                 where c.request_line_id = $1 and pu.status = 'recorded'`, [t.line])).rows[0].s);
      const fat = Number((await admin.query(`select count(*) n from purchase_line_covers c join pr_line_portions p on p.id = c.portion_id
                                              where p.line_id = $1 and c.quantity > p.quantity`, [t.line])).rows[0].n);
      if (bought > 10 || fat > 0 || !(await portionsOk(t.line))) over++;
    }
    check('3. a purchase against an office reduction: no deadlock, nothing over-covered', over === 0 && dead === 0,
      `bad states ${over}, deadlocks ${dead}`);
  }
  // 4
  {
    let dead = 0, errs = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('cross ' + i);
      const a = await mkLine(f, 10), b = await mkLine(f, 10);
      const out = await pair(BUYER, REC, [buy(f, [{ quantity: 3, amount: 3, request_line_id: a.line }, { quantity: 3, amount: 3, request_line_id: b.line }])],
                             BUYER2, REC, [buy(f, [{ quantity: 3, amount: 3, request_line_id: b.line }, { quantity: 3, amount: 3, request_line_id: a.line }])]);
      if (deadlock(out)) dead++;
      if (out.some(o => !o.ok)) errs++;
    }
    check('4. purchase A+B against purchase B+A: no deadlock, both recorded', dead === 0 && errs === 0, `deadlocks ${dead}, failed ${errs}`);
  }
  // 5
  {
    let dead = 0, bad = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const f = await mkFolder('assign ' + i);
      const t = await mkLine(f, 10);
      const out = await pair(OWNER, CLAIM, [t.portion, BUYER2],
                             BUYER, REC, [buy(f, [{ quantity: 4, amount: 4, request_line_id: t.line }])]);
      if (deadlock(out)) dead++;
      const holders = (await admin.query(`select count(distinct buyer_id) n from pr_line_portions where line_id = $1 and buyer_id is not null`, [t.line])).rows[0].n;
      if (Number(holders) < 1 || !(await portionsOk(t.line))) bad++;
    }
    check('5. an assignment against a purchase on the same portion: no deadlock, someone holds it', dead === 0 && bad === 0,
      `deadlocks ${dead}, bad ${bad}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
