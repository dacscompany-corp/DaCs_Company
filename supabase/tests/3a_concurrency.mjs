// ════════════════════════════════════════════════════════════════════
// STAGE 3a TOOLS — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 3a_tools.pglite.mjs)
//
// Same approach as 2b_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104 +
// 0107 VERBATIM over the same minimal tables, pairs of calls released at the
// same moment on two connections. Nothing touches the live database.
//   1. the same tool issued twice at once → one, never two holders
//   2. two registrations at once → every number once, none skipped
//   3. two registrations for the last place on a purchase line → one
//   4. a correction lowering a line while a tool is registered from it → never more tools than the line
//   5. two tools issued for the last place on a request line → one fills it, never past it
//   6. the owner confirms a Lost report while the office withdraws it → one wins, the tool matches it
//   7. a handover and a return of the same tool at once → one after the other, one unbroken history
//   8. a purchase and a tool issue for the last place on a request line at once → never filled twice
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
const WORKER2 = '00000000-0000-0000-0000-000000000019';
const ROUNDS = 15;
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-3a-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n3a tools — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 + 0107 on PostgreSQL)');
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
  await admin.query(mig('0107_tools.sql'));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${STAFF}', 'staff', '${OWNER}', 'active', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'), ('${WORKER}', 'worker', '${OWNER}', 'active', 'Mark'),
    ('${WORKER2}', 'worker', '${OWNER}', 'active', 'Rey');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true);
    select stk_set_enabled(true);
    select tl_set_enabled(true);`);

  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const as = (uid) => admin.query(`select set_config('test.uid', '${uid}', false)`);
  const mkFolder = async (name) => (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
  const item = async (name) => (await one(`insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, $2, 'pc', 'tool') returning id`, [OWNER, name])).id;
  const purchase = (lines) => JSON.stringify({ source: 'purchasing', purchase_date: TODAY, receipt_total: lines.reduce((s, l) => s + l.amount, 0),
    lines: lines.map(l => ({ category: 'Tools', unit: 'pc', unplanned_reason: 'test', ...l })) });
  const record = async (lines) => {
    await as(BUYER);
    return (await one(`select pur_record(gen_random_uuid(), $1::jsonb) r`, [purchase(lines)])).r.purchase_id;
  };
  const call = async (uid, sql, args) => { await as(uid); return (await one(sql, args)).r; };
  const mkPeriod = async (f) => {
    const p = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                          values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                  extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 1) returning id`, [OWNER, f])).id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
  };
  const REGISTER = `select tl_register(gen_random_uuid(), $1::jsonb) r`;
  const ISSUE = `select tl_issue(gen_random_uuid(), $1::jsonb) r`;
  // An opening register needs a photo (Q7): a path of this company's tools folder.
  const reg = (b) => JSON.stringify({ condition: 'good', at: 'warehouse',
    ...(b.purchase_id ? {} : { photo_path: `tools/${OWNER}/2026-10/${crypto.randomUUID()}.jpg` }), ...b });
  const oneTool = async (it) => (await call(STAFF, REGISTER, [reg({ item_id: it })])).tools[0].tool_id;
  const toolRow = (id) => one(`select state, holder_id from tl_tools where id = $1`, [id]);

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
      const it = await item('Grinder ' + i);
      const f = await mkFolder('twice ' + i);
      const t = await oneTool(it);
      const out = await pair(STAFF, ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER, folder_id: f })],
                             BUYER, ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER2, folder_id: f })]);
      if (deadlock(out)) dead++;
      const issues = Number((await one(`select count(*) n from tl_records where tool_id = $1 and kind = 'issue'`, [t])).n);
      const row = await toolRow(t);
      const winner = out[0].ok ? WORKER : WORKER2;
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /NOT_AVAILABLE/.test(o.msg))
          || issues !== 1 || row.state !== 'issued' || row.holder_id !== winner) bad++;
    }
    check('1. the same tool issued to two people at once: exactly one issue, one holder', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 2
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Drill ' + i);
      const before = Number((await one(`select coalesce(max(number), 0) m from tl_tools where owner_id = $1`, [OWNER])).m);
      const out = await pair(STAFF, REGISTER, [reg({ item_id: it, count: 2 })], BUYER, REGISTER, [reg({ item_id: it, count: 3 })]);
      if (deadlock(out)) dead++;
      const nums = (await admin.query(`select number from tl_tools where owner_id = $1 and number > $2 order by number`, [OWNER, before])).rows.map(r => r.number);
      const want = [1, 2, 3, 4, 5].map(n => before + n);
      if (out.filter(o => o.ok).length !== 2 || JSON.stringify(nums) !== JSON.stringify(want)) bad++;
    }
    check('2. two registrations at once: both accepted, every number once and none skipped', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 3
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Mixer ' + i);
      const pid = await record([{ destination: 'warehouse', item_name: 'Mixer', quantity: 3, amount: 3000 }]);
      await call(STAFF, REGISTER, [reg({ item_id: it, purchase_id: pid, line_no: 1, count: 2 })]);
      const b = reg({ item_id: it, purchase_id: pid, line_no: 1 });
      const out = await pair(STAFF, REGISTER, [b], BUYER, REGISTER, [b]);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select tl_line_registered($1, 1) n`, [pid])).n);
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /MORE_THAN_BOUGHT/.test(o.msg)) || n !== 3) bad++;
    }
    check('3. two registrations for the last place on a purchase line: one, never more tools than the line bought',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 4
  {
    let bad = 0, dead = 0;
    const FIX = `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'fix') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Saw ' + i);
      const pid = await record([{ destination: 'warehouse', item_name: 'Saw', quantity: 3, amount: 3000 }]);
      await call(STAFF, REGISTER, [reg({ item_id: it, purchase_id: pid, line_no: 1 })]);
      const fixed = purchase([{ destination: 'warehouse', item_name: 'Saw', quantity: 1, amount: 1000 }]);
      const out = await pair(OWNER, FIX, [pid, fixed], STAFF, REGISTER, [reg({ item_id: it, purchase_id: pid, line_no: 1 })]);
      if (deadlock(out)) dead++;
      const q = Number((await one(`select quantity q from purchase_lines where purchase_id = $1`, [pid])).q);
      const n = Number((await one(`select tl_line_registered($1, 1) n`, [pid])).n);
      const ok = out.filter(o => o.ok).length === 1 && n <= q
        && ((out[0].ok && q === 1 && n === 1 && /MORE_THAN_BOUGHT/.test(out[1].msg))
            || (out[1].ok && q === 3 && n === 2 && /TOOLS_IN_USE/.test(out[0].msg)));
      if (!ok) bad++;
    }
    check('4. a correction lowering a line while a tool is registered from it: one wins, never more tools than the line',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 5
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Level ' + i);
      const f = await mkFolder('last place ' + i);
      const batch = (await one(`select pr_batch_for($1, now()) b`, [OWNER])).b;
      const req = (await one(`insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ($1, $2, $3, $3) returning id`, [OWNER, WORKER, f])).id;
      const line = (await one(`insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id, kind) values ($1, $2, 'Level', 'pc', $3, 'tool') returning id`, [OWNER, req, it])).id;
      await admin.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 1)`, [OWNER, line, batch]);
      const [t1, t2] = [await oneTool(it), await oneTool(it)];
      const out = await pair(STAFF, ISSUE, [JSON.stringify({ tool_id: t1, holder_id: WORKER, folder_id: f, request_line_id: line })],
                             BUYER, ISSUE, [JSON.stringify({ tool_id: t2, holder_id: WORKER2, folder_id: f, request_line_id: line })]);
      if (deadlock(out)) dead++;
      const filled = Number((await one(`select pr_line_bought($1) b`, [line])).b);
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /REQUEST_EXCEEDED/.test(o.msg)) || filled !== 1) bad++;
    }
    check('5. two tools issued for the last place on a request line at once: one fills it, never past it',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 6
  {
    let bad = 0, dead = 0;
    const DECIDE = `select tl_decide(gen_random_uuid(), $1, true, 'gone') r`;
    const WITHDRAW = `select tl_reverse(gen_random_uuid(), $1, 'found it') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Jack ' + i);
      const f = await mkFolder('lost ' + i);
      const t = (await call(STAFF, REGISTER, [reg({ item_id: it, at: f, holder_id: WORKER })])).tools[0].tool_id;
      const rec = (await call(STAFF, `select tl_report_lost(gen_random_uuid(), $1, 'missing') r`, [t])).record_id;
      const out = await pair(OWNER, DECIDE, [rec], STAFF, WITHDRAW, [rec]);
      if (deadlock(out)) dead++;
      const status = (await one(`select status from tl_records where id = $1`, [rec])).status;
      const row = await toolRow(t);
      const ok = out.filter(o => o.ok).length === 1 && /BAD_STATE/.test((out.find(o => !o.ok) || {}).msg || '')
        && ((out[0].ok && status === 'done' && row.state === 'lost') || (out[1].ok && status === 'withdrawn' && row.state === 'issued' && row.holder_id === WORKER));
      if (!ok) bad++;
    }
    check('6. the owner confirms a Lost report while the office withdraws it: one wins, and the tool is where that one says',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 7
  {
    let bad = 0, dead = 0;
    const HAND = `select tl_handover(gen_random_uuid(), $1::jsonb) r`;
    const RET = `select tl_return(gen_random_uuid(), $1::jsonb) r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Trowel ' + i);
      const f = await mkFolder('hand or return ' + i);
      const t = (await call(STAFF, REGISTER, [reg({ item_id: it, at: f, holder_id: WORKER })])).tools[0].tool_id;
      const out = await pair(STAFF, HAND, [JSON.stringify({ tool_id: t, holder_id: WORKER2 })],
                             BUYER, RET, [JSON.stringify({ tool_id: t, condition: 'good' })]);
      if (deadlock(out)) dead++;
      const row = await toolRow(t);
      // Either order is real: handed over then returned (both stand), or
      // returned first and the handover refused. Never a lost update: each
      // record starts where the one before it ended, and the tool is where
      // the last one left it.
      const chain = (await admin.query(`select before, after from tl_records where tool_id = $1 order by recorded_at, id`, [t])).rows;
      const linked = chain.every((r, k) => k === 0 || (r.before.state === chain[k - 1].after.state && r.before.holder_id === chain[k - 1].after.holder_id));
      const last = chain[chain.length - 1].after;
      const ok = linked && row.state === last.state && row.holder_id === last.holder_id && out[1].ok
        && ((out[0].ok && chain.length === 3 && row.state === 'available')
            || (!out[0].ok && /NOT_ISSUED/.test(out[0].msg) && chain.length === 2 && row.state === 'available'));
      if (!ok) bad++;
    }
    check('7. a handover and a return of the same tool at once: one after the other, never a lost update — the history is one chain',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 8
  {
    let bad = 0, dead = 0;
    const RECORD = `select pur_record(gen_random_uuid(), $1::jsonb) r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Bender ' + i);
      const f = await mkFolder('bought or issued ' + i); await mkPeriod(f);
      const batch = (await one(`select pr_batch_for($1, now()) b`, [OWNER])).b;
      const req = (await one(`insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ($1, $2, $3, $3) returning id`, [OWNER, WORKER, f])).id;
      const line = (await one(`insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id, kind) values ($1, $2, 'Bender', 'pc', $3, 'tool') returning id`, [OWNER, req, it])).id;
      await admin.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 1)`, [OWNER, line, batch]);
      const t = await oneTool(it);
      const buy = JSON.stringify({ source: 'purchasing', purchase_date: TODAY, receipt_total: 1000,
        lines: [{ destination: 'project', folder_id: f, item_name: 'Bender', quantity: 1, unit: 'pc', category: 'Tools', amount: 1000, request_line_id: line }] });
      const out = await pair(BUYER, RECORD, [buy], STAFF, ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: line })]);
      if (deadlock(out)) dead++;
      const filled = Number((await one(`select pr_line_bought($1) b`, [line])).b);
      if (out.filter(o => o.ok).length !== 1 || filled !== 1) bad++;
    }
    check('8. a purchase and a tool issue for the last place on a request line at once: one fills it, never twice',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
