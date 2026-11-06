// ═══════════════════════════════════════
// STAGE 3b-a — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 3b_tools_phone.pglite.mjs)
//
// Same approach as 3a_concurrency.mjs: a throwaway PostgreSQL on this machine
// (or the CI runner), the real migrations over the same minimal tables, pairs
// of calls released at the same moment on two connections. Nothing touches the
// live database.
//   1. a leader and the office issue the same tool at once → one holder
//   2. a leader hands over and returns the same tool at once → one after the other
//   3. two leaders' issues for the last place on a request line → never past it
//   4. the same problem report sent twice under one id → one row
//   5. the same problem reported under two ids → one row, one refusal
//   6. the office closes a problem twice at once → one close
//   7. the switch turns a role off while the office names them leader → never a
//      leader without the role
//   8. the switch pressed twice at once → one change, one log row
//   9. "password changed" recorded twice at once → one row
//  10. a damaged return on the real clock, no test clock → no ties observed in 200 runs
//  11. one reset confirmed twice at once (0112) → one row
//  12. a confirmation of one reset racing a second reset (0112) → the second stays owed
// ═══════════════════════════════════════
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
const M85 = mig('0085_workmate_requests.sql');
const M51 = mig('0051_attendance_worker_owner.sql');

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
const BUYER = '00000000-0000-0000-0000-000000000011';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const WORKER2 = '00000000-0000-0000-0000-000000000019';
const LEADER = '00000000-0000-0000-0000-000000000015';
const LEADER2 = '00000000-0000-0000-0000-000000000016';
const ROUNDS = 15;
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-3b-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n3b-a — two sessions at once (0096 … 0108 + 0111 on PostgreSQL)');
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
  await admin.query(`
create table pr_teams (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  name text not null, active boolean not null default true, created_by uuid, created_at timestamptz not null default now());
create table pr_team_members (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  team_id uuid not null references pr_teams(id), worker_id uuid not null references profiles(id), is_leader boolean not null default false,
  added_at timestamptz not null default now(), removed_at timestamptz);
create unique index pr_team_one_leader on pr_team_members (team_id) where is_leader and removed_at is null;
${fnText(M85, 'pr_is_requester')}
${fnText(M85, 'pr_is_current_member')}
${fnText(M85, 'pr_is_current_leader')}
${fnText(M51, 'attendance_data_owner')}`);
  await admin.query(mig('0106_workmate_phone_stock.sql').slice(mig('0106_workmate_phone_stock.sql').indexOf('create or replace function pur_op_begin')));
  await admin.query(mig('0107_tools.sql'));
  await admin.query(mig('0108_tools_crew_numbers.sql'));
  await admin.query(mig('0111_workmate_tools_phone.sql'));
  await admin.query(mig('0112_password_change_per_reset.sql'));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${STAFF}', 'staff', '${OWNER}', 'active', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'), ('${WORKER}', 'worker', '${OWNER}', 'active', 'Mark'),
    ('${WORKER2}', 'worker', '${OWNER}', 'active', 'Rey'),
    ('${LEADER}', 'teamLeader', '${OWNER}', 'active', 'Lito'), ('${LEADER2}', 'teamLeader', '${OWNER}', 'active', 'Nilo');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true);
    select stk_set_enabled(true);
    select tl_set_enabled(true);`);

  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const as = (uid) => admin.query(`select set_config('test.uid', '${uid}', false)`);
  const mkFolder = async (name) => (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
  const item = async (name) => (await one(`insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, $2, 'pc', 'tool') returning id`, [OWNER, name])).id;
  const call = async (uid, sql, args) => { await as(uid); return (await one(sql, args)).r; };
  const REGISTER = `select tl_register(gen_random_uuid(), $1::jsonb) r`;
  const reg = (b) => JSON.stringify({ condition: 'good', at: 'warehouse', photo_path: `tools/${OWNER}/2026-11/${crypto.randomUUID()}.jpg`, ...b });
  const oneTool = async (it) => (await call(STAFF, REGISTER, [reg({ item_id: it })])).tools[0].tool_id;
  const toolRow = (id) => one(`select state, holder_id from tl_tools where id = $1`, [id]);
  const mkTeam = async (name, members, leader) => {
    const t = (await one(`insert into pr_teams (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
    for (const m of members) await admin.query(`insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values ($1, $2, $3, $4)`, [OWNER, t, m, m === leader]);
    return t;
  };
  const TEAM_ISSUE = `select tl_team_issue(gen_random_uuid(), $1::jsonb) r`;
  const OFFICE_ISSUE = `select tl_issue(gen_random_uuid(), $1::jsonb) r`;

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

  await as('');
  await mkTeam('Crew', [LEADER, WORKER, WORKER2], LEADER);
  await mkTeam('Other crew', [LEADER2, WORKER, WORKER2], LEADER2);
  const f = await mkFolder('House');

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const t = await oneTool(await item('Grinder ' + i));
      const out = await pair(LEADER, TEAM_ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER, folder_id: f })],
                             STAFF, OFFICE_ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER2, folder_id: f })]);
      if (deadlock(out)) dead++;
      const row = await toolRow(t);
      const issued = Number((await one(`select count(*) n from tl_records where tool_id = $1 and kind = 'issue'`, [t])).n);
      if (out.filter(o => o.ok).length !== 1 || issued !== 1 || row.state !== 'issued') bad++;
      if (out.filter(o => !o.ok).some(o => !o.msg.includes('NOT_AVAILABLE'))) bad++;
    }
    check('1. a leader and the office issue the same tool at once: one holder', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 2
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const t = await oneTool(await item('Drill ' + i));
      await call(STAFF, OFFICE_ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER, folder_id: f })]);
      const out = await pair(LEADER, `select tl_team_handover(gen_random_uuid(), $1::jsonb) r`, [JSON.stringify({ tool_id: t, holder_id: WORKER2 })],
                             LEADER2, `select tl_team_return(gen_random_uuid(), $1::jsonb) r`, [JSON.stringify({ tool_id: t, condition: 'good' })]);
      if (deadlock(out)) dead++;
      const row = await toolRow(t);
      if (!out.some(o => o.ok)) bad++;
      if (row.state === 'available' ? row.holder_id !== null : row.state !== 'issued') bad++;
    }
    check('2. a handover and a return of the same tool at once: one after the other', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 3
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Saw ' + i);
      const [t1, t2] = [await oneTool(it), await oneTool(it)];
      await as('');
      const batch = (await one(`select pr_batch_for($1, now()) b`, [OWNER])).b;
      const req = (await one(`insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ($1, $2, $3, $3) returning id`, [OWNER, LEADER, f])).id;
      const line = (await one(`insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id, kind) values ($1, $2, 'Saw', 'pc', $3, 'tool') returning id`, [OWNER, req, it])).id;
      await admin.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 1)`, [OWNER, line, batch]);
      const b = (t) => JSON.stringify({ tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: line });
      const out = await pair(LEADER, TEAM_ISSUE, [b(t1)], LEADER, TEAM_ISSUE, [b(t2)]);
      if (deadlock(out)) dead++;
      const covers = Number((await one(`select coalesce(sum(quantity), 0) q from tl_covers where request_line_id = $1`, [line])).q);
      if (out.filter(o => o.ok).length !== 1 || covers !== 1) bad++;
      if (out.filter(o => !o.ok).some(o => !o.msg.includes('REQUEST_EXCEEDED'))) bad++;
    }
    check('3. two issues for the last place on a request line: never past it', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 4, 5
  const REPORT = `select tl_report_problem($1, $2, 'broken', '') r`;
  const heldTool = async (name) => {
    const t = await oneTool(await item(name));
    await call(STAFF, OFFICE_ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER, folder_id: f })]);
    return t;
  };
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const t = await heldTool('Level ' + i);
      const id = crypto.randomUUID();
      const out = await pair(WORKER, REPORT, [id, t], WORKER, REPORT, [id, t]);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select count(*) n from tl_problems where tool_id = $1`, [t])).n);
      if (n !== 1 || !out.every(o => o.ok) || out[0].r.problem_id !== out[1].r.problem_id) bad++;
    }
    check('4. one report sent twice under one id: one row, the same answer', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const t = await heldTool('Square ' + i);
      const out = await pair(WORKER, REPORT, [crypto.randomUUID(), t], WORKER, REPORT, [crypto.randomUUID(), t]);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select count(*) n from tl_problems where tool_id = $1`, [t])).n);
      if (n !== 1 || out.filter(o => o.ok).length !== 1 || !out.find(o => !o.ok).msg.includes('ALREADY_REPORTED')) bad++;
    }
    check('5. the same problem under two ids: one row, one refusal', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 6
  {
    let bad = 0, dead = 0;
    const CLOSE = `select tl_close_problem(gen_random_uuid(), $1, 'done') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const t = await heldTool('Clamp ' + i);
      const p = (await call(WORKER, REPORT, [crypto.randomUUID(), t])).problem_id;
      const out = await pair(STAFF, CLOSE, [p], OWNER, CLOSE, [p]);
      if (deadlock(out)) dead++;
      if (out.filter(o => o.ok).length !== 1 || !out.find(o => !o.ok).msg.includes('ALREADY_CLOSED')) bad++;
    }
    check('6. a problem closed twice at once: one close', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 7
  {
    let bad = 0, dead = 0, offWon = 0, leaderWon = 0;
    const OFF = `select wk_set_team_leader($1, false) r`;
    const NAME = `select pr_office_set_leader($1, $2) r`;
    for (let i = 0; i < ROUNDS * 2; i++) {
      await as('');
      const person = crypto.randomUUID();
      await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values ($1, 'teamLeader', $2, 'active', 'Temp')`, [person, OWNER]);
      const team = await mkTeam('Race ' + i, [person], null);
      const out = i % 2
        ? await pair(OWNER, OFF, [person], STAFF, NAME, [team, person])
        : await pair(STAFF, NAME, [team, person], OWNER, OFF, [person]);
      if (deadlock(out)) dead++;
      const role = (await one(`select role from profiles where id = $1`, [person])).role;
      const marked = Number((await one(`select count(*) n from pr_team_members where worker_id = $1 and is_leader and removed_at is null`, [person])).n);
      if (out.filter(o => o.ok).length !== 1) bad++;
      if (role === 'worker' && marked !== 0) bad++;
      if (role === 'teamLeader' && marked !== 1) bad++;
      if (role === 'worker') offWon++; else leaderWon++;
    }
    check('7. turning a role off while the office names them leader: never a leader without the role', bad === 0 && dead === 0,
      `wrong outcome ${bad}, deadlocks ${dead}, off won ${offWon}, naming won ${leaderWon}`);
  }

  // 8
  {
    let bad = 0, dead = 0;
    const ON = `select wk_set_team_leader($1, true) r`;
    for (let i = 0; i < ROUNDS; i++) {
      await as('');
      const person = crypto.randomUUID();
      await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values ($1, 'worker', $2, 'active', 'Temp')`, [person, OWNER]);
      const out = await pair(OWNER, ON, [person], OWNER, ON, [person]);
      if (deadlock(out)) dead++;
      const logged = Number((await one(`select count(*) n from wk_role_events where worker_id = $1`, [person])).n);
      if (!out.every(o => o.ok) || logged !== 1) bad++;
    }
    check('8. the switch pressed twice at once: one change, one log row', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 9
  {
    let bad = 0, dead = 0;
    const CHANGED = `select wk_password_changed() r`;
    for (let i = 0; i < ROUNDS; i++) {
      await as('');
      await admin.query(`insert into wk_password_events (owner_id, worker_id, kind, actor_id) values ($1, $2, 'temporary_set', $1)`, [OWNER, WORKER]);
      const before = Number((await one(`select count(*) n from wk_password_events where worker_id = $1 and kind = 'changed'`, [WORKER])).n);
      const out = await pair(WORKER, CHANGED, [], WORKER, CHANGED, []);
      if (deadlock(out)) dead++;
      const after = Number((await one(`select count(*) n from wk_password_events where worker_id = $1 and kind = 'changed'`, [WORKER])).n);
      if (!out.every(o => o.ok) || after !== before + 1) bad++;
    }
    check('9. "password changed" twice at once: one row', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 10
  {
    let ties = 0, wrong = 0;
    const RUNS = 200;
    const RETURN = `select tl_team_return(gen_random_uuid(), $1::jsonb) r`;
    const it = await item('Mixer');
    for (let i = 0; i < RUNS; i++) {
      const t = await oneTool(it);
      await call(STAFF, OFFICE_ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER, folder_id: f })]);
      const back = await call(LEADER, RETURN, [JSON.stringify({ tool_id: t, condition: 'damaged' })]);
      const at = await one(`select (select recorded_at from tl_records where id = $1) = (select recorded_at from tl_records where id = $2) as same`, [back.record_id, back.retire_record_id]);
      if (at.same) ties++;
      const undo = await call(LEADER, `select tl_team_reverse(gen_random_uuid(), $1, 'mistake') r`, [back.record_id]).then(() => 'accepted', (e) => e.message);
      if (!undo.includes('LATER_RECORDS')) wrong++;
    }
    check(`10. a damaged return on the real clock, no test clock: no ties observed in ${RUNS} runs, and reversing the return was refused each time`, ties === 0 && wrong === 0, `ties ${ties}, wrong outcome ${wrong}`);
  }

  const RESET = `insert into wk_password_events (owner_id, worker_id, kind, actor_id) values ('${OWNER}', $1, 'temporary_set', '${OWNER}') returning id as r`;
  const CONFIRM = `select wk_password_changed_for($1) r`;
  const openReset = async () => {
    await as(WORKER);
    const s = (await one(`select wk_password_state() r`)).r;
    return s.must_change ? String(s.reset_id) : null;
  };

  // 11
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      await as('');
      const r = (await one(RESET, [WORKER])).r;
      const before = Number((await one(`select count(*) n from wk_password_events where worker_id = $1 and kind = 'changed'`, [WORKER])).n);
      const out = await pair(WORKER, CONFIRM, [r], WORKER, CONFIRM, [r]);
      if (deadlock(out)) dead++;
      const after = Number((await one(`select count(*) n from wk_password_events where worker_id = $1 and kind = 'changed'`, [WORKER])).n);
      if (!out.every(o => o.ok) || after !== before + 1 || out.filter(o => o.r && o.r.recorded).length !== 1 || (await openReset()) !== null) bad++;
    }
    check('11. one reset confirmed twice at once: one row', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }

  // 12
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      await as('');
      const r1 = (await one(RESET, [WORKER])).r;
      const out = await pair(WORKER, CONFIRM, [r1], '', RESET, [WORKER]);
      if (deadlock(out)) dead++;
      const r2 = out[1].ok ? String(out[1].r) : null;
      if (!out.every(o => o.ok) || (await openReset()) !== r2) bad++;
      // close it before the next round, by its own change
      await as(WORKER);
      await one(CONFIRM, [r2]);
    }
    check('12. a confirmation of one reset racing a second reset: the second stays owed', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
