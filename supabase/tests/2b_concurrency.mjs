// ════════════════════════════════════════════════════════════════════
// STAGE 2B-a STOCK — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 2b_stock.pglite.mjs)
//
// Same approach as 2a4_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104
// VERBATIM over the same minimal tables, pairs of calls released at the same
// moment on two connections. Nothing touches the live database.
//   1. two issues of the last bags at once → one, never below zero
//   2. two leftover records past what the line brought → one
//   3. a receipt reversed while its bags are issued → never below zero
//   4. a correction lowering a line while more is received → never past it
//   5. an issue and a purchase filling the same request at once → never past it
//   6. the same press twice at once → one record
//   7. a count confirmed while an issue moves the same bags → never a stale count
//   8. a catalogue unit change while stock is first matched to the item → one wins
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
const WORKER = '00000000-0000-0000-0000-00000000000c';
const ROUNDS = 15;
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-2b-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n2B-a stock — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 on PostgreSQL)');
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
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${STAFF}', 'staff', '${OWNER}', 'active', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'), ('${WORKER}', 'worker', '${OWNER}', 'active', 'Mark');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true);
    select stk_set_enabled(true);`);

  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const as = (uid) => admin.query(`select set_config('test.uid', '${uid}', false)`);
  const mkFolder = async (name) => (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
  const mkPeriod = async (f) => {
    const p = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                          values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                  extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 1) returning id`, [OWNER, f])).id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
  };
  const item = async (name) => (await one(`insert into pr_catalog_items (owner_id, name, unit) values ($1, $2, 'bag') returning id`, [OWNER, name])).id;
  const purchase = (lines) => JSON.stringify({ source: 'purchasing', purchase_date: TODAY, receipt_total: lines.reduce((s, l) => s + l.amount, 0),
    lines: lines.map(l => ({ category: 'Materials', unit: 'bag', unplanned_reason: 'test', ...l })) });
  const record = async (lines) => {
    await as(BUYER);
    return (await one(`select pur_record(gen_random_uuid(), $1::jsonb) r`, [purchase(lines)])).r.purchase_id;
  };
  const call = async (uid, sql, args) => { await as(uid); return (await one(sql, args)).r; };
  const MATCH = `select stk_match(gen_random_uuid(), $1, 1, $2, $3, null) r`;
  const RECEIVE = `select stk_receive(gen_random_uuid(), $1, 1, $2, '${TODAY}', '') r`;
  const MOVE = `select stk_move(gen_random_uuid(), $1::jsonb) r`;
  const stocked = async (it, qty) => {
    const pid = await record([{ destination: 'warehouse', item_name: 'Cement', quantity: qty, amount: qty * 100 }]);
    await call(OWNER, MATCH, [pid, it, String(qty)]);
    await call(BUYER, RECEIVE, [pid, String(qty)]);
    return pid;
  };
  const issue = (it, f, qty, extra = {}) => JSON.stringify({ item_id: it, from: 'warehouse', to: f, quantity: String(qty), on: TODAY,
                                                             unplanned_reason: 'test', ...extra });
  const bal = async (it, where) => Number((await one(`select coalesce(sum(stk_balance(lt.id, l.id)), 0) b from stk_lots lt, stk_locations l
                                                      where lt.item_id = $1 and l.owner_id = $2 and
                                                            (case when $3 = 'warehouse' then l.kind = 'warehouse' else l.folder_id::text = $3 end)`,
                                                     [it, OWNER, where])).b);
  const negatives = async () => Number((await one(`select count(*) n from stk_balances($1) where quantity < 0`, [OWNER])).n);

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
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Cement ' + i);
      const f = await mkFolder('last bags ' + i);
      await stocked(it, 10);
      const out = await pair(STAFF, MOVE, [issue(it, f, 7)], BUYER, MOVE, [issue(it, f, 7)]);
      if (deadlock(out)) dead++;
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /NOT_ENOUGH/.test(o.msg))
          || await bal(it, 'warehouse') !== 3 || await negatives() > 0) bad++;
    }
    check('1. two people issue 7 of the last 10 bags at once: exactly one is accepted, 3 left, never below zero',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 2
  {
    let bad = 0, dead = 0;
    const LEFT = `select stk_leftover(gen_random_uuid(), $1, 1, '6', 'site', '${TODAY}', '') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Gravel ' + i);
      const f = await mkFolder('leftovers ' + i); await mkPeriod(f);
      const pid = await record([{ destination: 'project', folder_id: f, item_name: 'Gravel', quantity: 10, amount: 1000 }]);
      await call(OWNER, MATCH, [pid, it, '10']);
      const out = await pair(STAFF, LEFT, [pid], BUYER, LEFT, [pid]);
      if (deadlock(out)) dead++;
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /MORE_THAN_BOUGHT/.test(o.msg)) || await bal(it, f) !== 6) bad++;
    }
    check('2. two leftover records of 6 from a line of 10 at once: one is accepted, never more than the line brought',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 3
  {
    let bad = 0, dead = 0;
    const REV = `select stk_reverse(gen_random_uuid(), $1, 'wrong') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Sand ' + i);
      const f = await mkFolder('reverse ' + i);
      const pid = await stocked(it, 10);
      const rcpt = (await one(`select id from stk_records where purchase_id = $1 and kind = 'receive'`, [pid])).id;
      const out = await pair(BUYER, REV, [rcpt], STAFF, MOVE, [issue(it, f, 4)]);
      if (deadlock(out)) dead++;
      const w = await bal(it, 'warehouse');
      const ok = out.filter(o => o.ok).length === 1
        && ((out[0].ok && /NOT_ENOUGH/.test(out[1].msg) && w === 0) || (out[1].ok && /MOVED_ON/.test(out[0].msg) && w === 6));
      if (!ok || await negatives() > 0) bad++;
    }
    check('3. a receipt reversed while its bags are issued, at once: one wins, the warehouse never goes below zero',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 4
  {
    let bad = 0, dead = 0;
    const FIX = `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'fix') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Nails ' + i);
      const pid = await record([{ destination: 'warehouse', item_name: 'Nails', quantity: 10, amount: 1000 }]);
      await call(OWNER, MATCH, [pid, it, '10']);
      await call(BUYER, RECEIVE, [pid, '4']);
      const fixed = purchase([{ destination: 'warehouse', item_name: 'Nails', quantity: 5, amount: 500 }]);
      const out = await pair(OWNER, FIX, [pid, fixed], STAFF, RECEIVE, [pid, '3']);
      if (deadlock(out)) dead++;
      const q = Number((await one(`select quantity q from purchase_lines where purchase_id = $1`, [pid])).q);
      const got = Number((await one(`select stk_received($1, 1) v`, [pid])).v);
      const ok = out.filter(o => o.ok).length === 1 && got <= q
        && ((out[0].ok && /MORE_THAN_AWAITED/.test(out[1].msg) && q === 5 && got === 4)
            || (out[1].ok && /STOCK_IN_USE/.test(out[0].msg) && q === 10 && got === 7));
      if (!ok) bad++;
    }
    check('4. a correction to 5 while 3 more of 4 received come in, at once: one wins, received never passes the line',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 5
  {
    let bad = 0, dead = 0;
    const REC = `select pur_record(gen_random_uuid(), $1::jsonb) r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Tiles ' + i);
      const f = await mkFolder('request ' + i); await mkPeriod(f);
      await stocked(it, 20);
      const batch = (await one(`select pr_batch_for($1, now()) b`, [OWNER])).b;
      const req = (await one(`insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ($1, $2, $3, $3) returning id`,
                             [OWNER, WORKER, f])).id;
      const line = (await one(`insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id) values ($1, $2, 'Tiles', 'bag', $3) returning id`,
                              [OWNER, req, it])).id;
      await admin.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 10)`, [OWNER, line, batch]);
      const buy = purchase([{ destination: 'project', folder_id: f, item_name: 'Tiles', quantity: 6, amount: 600, request_line_id: line, unplanned_reason: '' }]);
      const out = await pair(STAFF, MOVE, [issue(it, f, 6, { request_line_id: line, unplanned_reason: '' })], BUYER, REC, [buy]);
      if (deadlock(out)) dead++;
      const covered = Number((await one(`select pr_line_bought($1) v`, [line])).v);
      const ok = out.filter(o => o.ok).length === 1 && covered === 6
        && out.some(o => !o.ok && /REQUEST_EXCEEDED|EXTRA_REASON_REQUIRED/.test(o.msg));
      if (!ok) bad++;
    }
    check('5. an issue of 6 and a purchase of 6 for a request of 10, at once: one is accepted, never covered past the need',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 6
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Wire ' + i);
      const f = await mkFolder('press ' + i);
      await stocked(it, 10);
      const press = (await one(`select gen_random_uuid() id`)).id;
      const SAME = `select stk_move('${press}'::uuid, $1::jsonb) r`;
      const out = await pair(STAFF, SAME, [issue(it, f, 4)], STAFF, SAME, [issue(it, f, 4)]);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select count(*) n from stk_records where item_id = $1 and kind = 'issue'`, [it])).n);
      if (out.some(o => !o.ok) || n !== 1 || await bal(it, f) !== 4 || out[0].r.record_id !== out[1].r.record_id) bad++;
    }
    check('6. the same press sent twice at once: one record, both calls answered with it',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 7
  {
    let bad = 0, dead = 0;
    const DECIDE = `select stk_decide(gen_random_uuid(), $1, true, 'ok') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Bolts ' + i);
      const f = await mkFolder('count ' + i);
      await stocked(it, 10);
      const c = await call(STAFF, `select stk_count(gen_random_uuid(), $1::jsonb) r`,
                           [JSON.stringify({ item_id: it, at: 'warehouse', counted: '8', on: TODAY, reason: 'lost' })]);
      const out = await pair(OWNER, DECIDE, [c.record_id], BUYER, MOVE, [issue(it, f, 3)]);
      if (deadlock(out)) dead++;
      const w = await bal(it, 'warehouse');
      const ok = (out[0].ok && out[1].ok && w === 5)
        || (!out[0].ok && /STALE_COUNT/.test(out[0].msg) && out[1].ok && w === 7);
      if (!ok || await negatives() > 0) bad++;
    }
    check('7. a count confirmed while an issue moves the same bags: confirmed against the books it counted, or refused as stale',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 8
  {
    let bad = 0, dead = 0;
    const SAVE = `select pr_office_save_item($1, 'material', 'Gravel', '', 'kg', '', true, null, null) r`;
    const FIRST = `select stk_match(gen_random_uuid(), $1, 1, $2, '10', null) r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Gravel ' + i);
      const pid = await record([{ destination: 'warehouse', item_name: 'Gravel', quantity: 10, amount: 1000 }]);
      const out = await pair(OWNER, SAVE, [it], STAFF, FIRST, [pid, it]);
      if (deadlock(out)) dead++;
      const unit = (await one(`select unit from pr_catalog_items where id = $1`, [it])).unit;
      const matched = Number((await one(`select count(*) n from stk_matches where purchase_id = $1`, [pid])).n);
      const ok = out.filter(o => o.ok).length === 1
        && ((out[0].ok && unit === 'kg' && matched === 0 && /REASON_REQUIRED/.test(out[1].msg))
            || (out[1].ok && unit === 'bag' && matched === 1 && /ITEM_IN_USE/.test(out[0].msg)));
      if (!ok) bad++;
    }
    check('8. a unit change while stock is first matched to the item, at once: one wins — never a match counted in the old unit',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
