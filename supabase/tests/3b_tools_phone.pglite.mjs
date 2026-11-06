// ═══════════════════════════════════════
// STAGE 3b-a — TOOLS ON THE PHONE, THE TEAM LEADER SWITCH, TEMPORARY PASSWORDS
//   npm run test:sql
//
// Runs migrations 0096 … 0108 and 0111 VERBATIM on PGlite over the 3a suite's
// tables. Nothing here talks to the live database or a real account.
// supabase/tests/3b_acceptance.sql repeats the key cases on live, rolled back.
// ═══════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText, CATALOG_0085, TOOL_RECORD_CLOCK } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
const M02 = mig('0002_rls.sql');
const M19 = mig('0019_admin_profile_updates.sql');
const M50 = mig('0050_attendance.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
const M85 = mig('0085_workmate_requests.sql');
const M86 = mig('0086_workmate_requests_office.sql');
const M90 = mig('0090_workmate_item_history.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');
const M96 = mig('0096_purchase_recording.sql');
const M97 = mig('0097_purchasing_office.sql');
const M98 = mig('0098_pm_profit_sharing.sql');
const M101 = mig('0101_purchasing_phone.sql');
const M102 = mig('0102_purchase_payments.sql');
const M103 = mig('0103_buyer_return_photo.sql');
const M104 = mig('0104_stock.sql');
const M105 = mig('0105_stock_cost_moves.sql');
const M106 = mig('0106_workmate_phone_stock.sql');
const M107 = mig('0107_tools.sql');
const M108 = mig('0108_tools_crew_numbers.sql');
const M111 = mig('0111_workmate_tools_phone.sql');

// These two end "end $$;" rather than a line of their own.
const fnEnd = (src, name) => {
  const m = src.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?end \\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found');
  return m[0];
};

const REQUESTS_0085 = `
create table pr_teams (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  name text not null, active boolean not null default true, created_by uuid, created_at timestamptz not null default now());
create table pr_team_members (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  team_id uuid not null references pr_teams(id), worker_id uuid not null references profiles(id), is_leader boolean not null default false,
  added_at timestamptz not null default now(), removed_at timestamptz);
create unique index pr_team_one_leader on pr_team_members (team_id) where is_leader and removed_at is null;
create table pr_photos (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id), line_id uuid references pr_lines(id), storage_path text not null unique,
  uploaded_by uuid not null references profiles(id), created_at timestamptz not null default now());
${fnText(M85, 'pr_is_requester')}
${fnText(M85, 'pr_is_current_member')}
${fnText(M85, 'pr_is_current_leader')}
${fnText(M51, 'attendance_data_owner')}
${fnText(M86, 'pr_office_people')}
`;
const BASE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id) on delete cascade, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null,
  monthly_budget numeric not null default 0);
create table expenses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false,
  split_group text, split_index int, split_total int, client_submission_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  total_salary numeric, cover_expense boolean default false);
create table inventory (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid,
  created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}
`;

const id = (n) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const OWNER = id(1), SUBOWNER = id(2), STAFF = id(3), OTHER = id(4);
const AMY = id(11), BEN = id(12), CAL = id(13), DEE = id(14), EVE = id(15), FAR = id(16), GONE = id(17);
const CLIENT = id(21), PARTNER = id(22);
let opSeq = 0;
const op = () => '40000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) {
    failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message);
    if (process.env.DACS_FAIL_FAST) process.exit(1);
  }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);

const as = (db, uid) => db.exec(`select set_config('test.uid', '${uid}', false)`);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const code = async (p) => { try { await p; return 'no error'; } catch (e) { return e.message; } };
async function refused(p, want, m) {
  const got = await code(p);
  assert(got.includes(want), (m || 'refused') + ': expected ' + want + ', got ' + got);
}
const rpc = async (db, who, fn, args = []) => {
  await as(db, who);
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  return (await one(db, `select ${fn}(${ph}) as r`, args)).r;
};
const j = (o) => JSON.stringify(o);

// One company: Led (CAL leads; AMY, BEN), Second (CAL leads; DEE), Plain (EVE leads; FAR), Unled (AMY, FAR; no leader).
async function fresh(opts = {}) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(CATALOG_0085);
  await db.exec(fnText(M90, 'pr_clean_aliases'));
  await db.exec(M97);
  await db.exec(M101);
  await db.exec(fnText(M98, 'pm_main_owner_id'));
  await db.exec(M102);
  await db.exec(M103);
  await db.exec(M104);
  await db.exec(M105);
  await db.exec(REQUESTS_0085);
  await db.exec(M106);
  await db.exec(M107);
  await db.exec(TOOL_RECORD_CLOCK);
  await db.exec(M108);
  await db.exec(fnEnd(M19, 'profiles_guard'));
  await db.exec(`create trigger profiles_guard_trg before update on profiles for each row execute function profiles_guard();`);
  await db.exec(`create sequence worker_no_seq start 100;`);
  await db.exec(fnEnd(M50, 'assign_worker_no'));
  await db.exec(`create trigger profiles_worker_no_trg before insert or update of role on profiles for each row execute function assign_worker_no();`);
  await db.exec(fnText(M86, 'pr_office_add_member'));
  await db.exec(fnText(M86, 'pr_office_remove_member'));
  await db.exec(fnText(M86, 'pr_office_save_team'));
  await db.exec(M111);
  await as(db, '');
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name, worker_no) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null, null),
    ('${SUBOWNER}', 'owner', '${OWNER}', 'active', '["pm"]'::jsonb, 'admin-pm@dacs.test', null, null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana', null),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null, null),
    ('${AMY}', 'worker', '${OWNER}', 'active', null, null, 'Amy', 1),
    ('${BEN}', 'worker', '${OWNER}', 'active', null, null, 'Ben', 2),
    ('${CAL}', 'teamLeader', '${OWNER}', 'active', null, null, 'Cal', 3),
    ('${DEE}', 'worker', '${OWNER}', 'active', null, null, 'Dee', 4),
    ('${EVE}', 'teamLeader', '${OWNER}', 'active', null, null, 'Eve', 5),
    ('${FAR}', 'worker', '${OWNER}', 'active', null, null, 'Far', 6),
    ('${GONE}', 'worker', '${OWNER}', 'inactive', null, null, 'Gone', 7),
    ('${CLIENT}', 'client', '${OWNER}', 'active', null, 'client@x.test', 'Cora', null),
    ('${PARTNER}', 'partner', '${OWNER}', 'active', null, 'partner@x.test', 'Pat', null);`);
  await as(db, OWNER);
  await db.query(`select stk_set_enabled(true)`);
  if (opts.on !== false) await db.query(`select tl_set_enabled(true)`);
  await as(db, '');
  const team = async (name, members, leader, active = true) => {
    const t = (await one(db, `insert into pr_teams (owner_id, name, active) values ($1, $2, $3) returning id`, [OWNER, name, active])).id;
    for (const m of members) {
      await db.query(`insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values ($1, $2, $3, $4)`, [OWNER, t, m, m === leader]);
    }
    return t;
  };
  db.led = await team('Led', [CAL, AMY, BEN], CAL);
  db.second = await team('Second', [CAL, DEE], CAL);
  db.plain = await team('Plain', [EVE, FAR], EVE);
  db.unled = await team('Unled', [AMY, FAR], null);
  db.project = (await one(db, `insert into folders (owner_id, name) values ($1, 'House') returning id`, [OWNER])).id;
  db.done = (await one(db, `insert into folders (owner_id, name, completed_at) values ($1, 'Finished', now()) returning id`, [OWNER])).id;
  db.item = (await one(db, `insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, 'Grinder', 'pc', 'tool') returning id`, [OWNER])).id;
  return db;
}
const photoOf = () => `tools/${OWNER}/2026-10/${crypto.randomUUID()}.jpg`;
async function newTool(db, b = {}) {
  const r = await rpc(db, OWNER, 'tl_register', [op(), j({ item_id: db.item, condition: 'good', at: 'warehouse', photo_path: photoOf(), ...b })]);
  return r.tools[0].tool_id;
}
const numberOf = async (db, tool) => (await one(db, `select number from tl_tools where id = $1`, [tool])).number;
const officeIssue = (db, tool, holder) => rpc(db, OWNER, 'tl_issue', [op(), j({ tool_id: tool, holder_id: holder, folder_id: db.project })]);
const issue = (db, who, b, opId = op()) => rpc(db, who, 'tl_team_issue', [opId, j(b)]);
const handover = (db, who, b) => rpc(db, who, 'tl_team_handover', [op(), j(b)]);
const ret = (db, who, b) => rpc(db, who, 'tl_team_return', [op(), j({ condition: 'good', ...b })]);
const reverse = (db, who, rec, reason = 'mistake') => rpc(db, who, 'tl_team_reverse', [op(), rec, reason]);
const toolRow = (db, t) => one(db, `select * from tl_tools where id = $1`, [t]);
const latest = async (db, t) => (await one(db, `select tl_latest($1) id`, [t])).id;
async function requestLine(db, opts = {}) {
  await as(db, '');
  const batch = (await one(db, `select pr_batch_for($1, now()) b`, [OWNER])).b;
  const req = (await one(db, `insert into pr_requests (owner_id, requester_id, team_id, folder_id, work_folder_id)
                               values ($1, $2, $3, $4, $4) returning id`, [OWNER, opts.by || AMY, opts.team === undefined ? db.led : opts.team, opts.folder || db.project])).id;
  const line = (await one(db, `insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id, kind)
                                values ($1, $2, $3, 'pc', $4, 'tool') returning id`, [OWNER, req, 'Grinder', opts.item === undefined ? db.item : opts.item])).id;
  await db.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, $4)`, [OWNER, line, batch, opts.quantity ?? 1]);
  return line;
}
const still = async (db, line) => num((await one(db, `select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0) s
                                                        from pr_line_portions p where p.line_id = $1`, [line])).s);
const FORBIDDEN = /amount|price|cost|peso|purchase|note|photo|receipt|pending_record/i;
const keysOf = (o, out = new Set()) => {
  if (Array.isArray(o)) o.forEach((x) => keysOf(x, out));
  else if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.add(k); keysOf(o[k], out); }
  return out;
};
const noForbidden = (o, m) => { for (const k of keysOf(o)) assert(!FORBIDDEN.test(k), (m || '') + ' exposes ' + k); };

console.log('\n3b-a tools on the phone (0096 … 0108 + 0111 on PGlite)');

// ── A. A worker's own tools ─────────────────────────────────
await test('My tools: only their own, with no money, purchase, note, photo or other people', async () => {
  const db = await fresh();
  const mine = await newTool(db, { details: 'Blue' }); const theirs = await newTool(db);
  await officeIssue(db, mine, AMY); await officeIssue(db, theirs, BEN);
  const list = await rpc(db, AMY, 'tl_my_tools');
  eq(list.map((t) => t.id), [mine]);
  eq(list[0].label, 'TOOL-' + String(await numberOf(db, mine)).padStart(4, '0'));
  eq([list[0].item_name, list[0].details, list[0].folder_name, list[0].state], ['Grinder', 'Blue', 'House', 'issued']);
  noForbidden(list, 'my tools');
  assert(!JSON.stringify(list).includes('Ben'), 'another person');
});
await test('My tools: a tool reported lost still shows; a returned one does not', async () => {
  const db = await fresh();
  const a = await newTool(db); const b = await newTool(db);
  await officeIssue(db, a, AMY); await officeIssue(db, b, AMY);
  await rpc(db, OWNER, 'tl_report_lost', [op(), a, 'not on site']);
  await rpc(db, OWNER, 'tl_return', [op(), j({ tool_id: b, condition: 'good' })]);
  const list = await rpc(db, AMY, 'tl_my_tools');
  eq(list.map((t) => [t.id, t.state]), [[a, 'lost_pending']]);
});
await test('history: only while they had it; office notes, and whoever had it after they passed it on, stay hidden', async () => {
  const db = await fresh();
  const t = await newTool(db);
  await rpc(db, OWNER, 'tl_issue', [op(), j({ tool_id: t, holder_id: BEN, folder_id: db.project, note: 'SECRET-A' })]);
  await rpc(db, OWNER, 'tl_handover', [op(), j({ tool_id: t, holder_id: AMY, note: 'SECRET-B' })]);
  await rpc(db, OWNER, 'tl_handover', [op(), j({ tool_id: t, holder_id: DEE, note: 'SECRET-C' })]);
  await rpc(db, OWNER, 'tl_handover', [op(), j({ tool_id: t, holder_id: FAR, note: 'SECRET-D' })]);
  const h = await rpc(db, AMY, 'tl_my_tool', [t]);
  eq(h.records.map((r) => r.kind), ['handover', 'handover'], 'received it, passed it on');
  assert(!JSON.stringify(h).includes('SECRET'), 'an office note');
  assert(!JSON.stringify(h).includes('Far'), 'someone after them');
  eq(h.holder_name, undefined, 'current holder hidden once it left them');
  eq(h.state, undefined, 'current state hidden once it left them');
  noForbidden(h, 'history');
  await refused(rpc(db, CAL, 'tl_my_tool', [t]), 'NOT_YOUR_TOOL', 'never held it');
});
await test('non-crew accounts get nothing, and tools off answers TOOLS_OFF', async () => {
  const db = await fresh();
  for (const who of [OWNER, STAFF, CLIENT, PARTNER, GONE]) await refused(rpc(db, who, 'tl_my_tools'), 'NOT_A_REQUESTER', who);
  const off = await fresh({ on: false });
  await refused(rpc(off, AMY, 'tl_my_tools'), 'TOOLS_OFF');
  await refused(rpc(off, CAL, 'tl_team_tools'), 'TOOLS_OFF');
});

// ── B. Report a problem ─────────────────────────────────────
await test('report: only the holder; it changes no tool or record; the office sees it and closes it with a note', async () => {
  const db = await fresh();
  const t = await newTool(db);
  await officeIssue(db, t, AMY);
  const before = await toolRow(db, t);
  const recs = async () => num((await one(db, `select count(*) n from tl_records where tool_id = $1`, [t])).n);
  const n = await recs();
  for (const who of [BEN, CAL, STAFF, OWNER]) await refused(rpc(db, who, 'tl_report_problem', [op(), t, 'broken', '']), 'NOT', who);
  const r = await rpc(db, AMY, 'tl_report_problem', [op(), t, 'broken', 'The cord is cut']);
  assert(r.problem_id, 'an id');
  eq(await toolRow(db, t), before, 'tool untouched');
  eq(await recs(), n, 'no record');
  await refused(rpc(db, AMY, 'tl_report_problem', [op(), t, 'broken', 'again']), 'ALREADY_REPORTED');
  await rpc(db, AMY, 'tl_report_problem', [op(), t, 'dont_have', '']);
  await refused(rpc(db, AMY, 'tl_report_problem', [op(), t, 'lost_it', '']), 'BAD_KIND');
  const open = await rpc(db, STAFF, 'tl_problems', [true]);
  eq(open.map((p) => p.kind).sort(), ['broken', 'dont_have']);
  const b = open.find((p) => p.kind === 'broken');
  eq([b.reported_by_name, b.note, b.holder_name, b.folder_name], ['Amy (W-0001)', 'The cord is cut', 'Amy (W-0001)', 'House']);
  for (const who of [AMY, CAL]) await refused(rpc(db, who, 'tl_problems', [true]), 'NOT_ALLOWED', who);
  await refused(rpc(db, STAFF, 'tl_close_problem', [op(), b.id, '']), 'REASON_REQUIRED');
  await refused(rpc(db, AMY, 'tl_close_problem', [op(), b.id, 'fine']), 'N', 'a worker cannot close it');
  await rpc(db, STAFF, 'tl_close_problem', [op(), b.id, 'Replaced the cord']);
  await refused(rpc(db, STAFF, 'tl_close_problem', [op(), b.id, 'twice']), 'ALREADY_CLOSED');
  eq((await rpc(db, STAFF, 'tl_problems', [true])).length, 1);
  const all = await rpc(db, STAFF, 'tl_problems', [false]);
  eq(all.find((p) => p.id === b.id).close_note, 'Replaced the cord');
  eq((await rpc(db, AMY, 'tl_my_tools'))[0].my_open_problems, ['dont_have']);
  eq(await toolRow(db, t), before, 'closing changes nothing either');
});
await test('report: a retry records once; a problem can be reported again after closing; rows cannot be deleted or rewritten', async () => {
  const db = await fresh();
  const t = await newTool(db);
  await officeIssue(db, t, AMY);
  const id1 = op();
  const a = await rpc(db, AMY, 'tl_report_problem', [id1, t, 'broken', '']);
  const b = await rpc(db, AMY, 'tl_report_problem', [id1, t, 'broken', '']);
  eq(a.problem_id, b.problem_id, 'replayed');
  eq(b.replayed, true);
  await rpc(db, STAFF, 'tl_close_problem', [op(), a.problem_id, 'ok']);
  await rpc(db, AMY, 'tl_report_problem', [op(), t, 'broken', 'again']);
  await as(db, '');
  await refused(db.query(`delete from tl_problems`), 'HISTORY_IMMUTABLE');
  await refused(db.query(`update tl_problems set note = 'x' where id = $1`, [a.problem_id]), 'HISTORY_IMMUTABLE');
  await refused(db.query(`update tl_problems set close_note = 'y' where id = $1`, [a.problem_id]), 'HISTORY_IMMUTABLE');
});

// ── C. A leader's view and lookup ───────────────────────────
await test('team tools: the current members of the teams they lead now, and no one else', async () => {
  const db = await fresh();
  const [a, d, f, c] = [await newTool(db), await newTool(db), await newTool(db), await newTool(db)];
  await officeIssue(db, a, AMY); await officeIssue(db, d, DEE); await officeIssue(db, f, FAR); await officeIssue(db, c, CAL);
  const ids = async (who) => (await rpc(db, who, 'tl_team_tools')).map((t) => t.id).sort();
  eq(await ids(CAL), [a, c, d].sort(), 'both teams, and their own');
  eq(await ids(EVE), [f], 'only Plain');
  const list = await rpc(db, CAL, 'tl_team_tools');
  noForbidden(list, 'team tools');
  for (const who of [AMY, FAR]) await refused(rpc(db, who, 'tl_team_tools'), 'NOT_LEADER', who + ' leads nothing');
  await rpc(db, OWNER, 'pr_office_remove_member', [db.second, DEE]);
  eq(await ids(CAL), [a, c].sort(), 'a member removed drops out at once');
  await refused(rpc(db, CAL, 'tl_team_tool', [d]), 'NOT_YOUR_TEAM');
  await refused(rpc(db, CAL, 'tl_team_tool', [f]), 'NOT_YOUR_TEAM');
  const h = await rpc(db, CAL, 'tl_team_tool', [a]);
  eq(h.holder_name, 'Amy (W-0001)');
  noForbidden(h, 'team history');
});
await test('find by number: an Available tool of this company only, and every other answer is the same, revealing nothing', async () => {
  const db = await fresh();
  const free = await newTool(db, { details: 'Blue' }); const out = await newTool(db); const bad = await newTool(db);
  await officeIssue(db, out, FAR);
  await rpc(db, OWNER, 'tl_issue', [op(), j({ tool_id: bad, holder_id: AMY, folder_id: db.project })]);
  await rpc(db, OWNER, 'tl_return', [op(), j({ tool_id: bad, condition: 'needs_repair' })]);
  const n = await numberOf(db, free);
  const got = await rpc(db, CAL, 'tl_team_find', [String(n)]);
  eq([got.id, got.item_name, got.details], [free, 'Grinder', 'Blue']);
  noForbidden(got, 'find');
  assert(!('holder_name' in got) && !('records' in got) && !('state' in got), 'no custody or history');
  eq((await rpc(db, CAL, 'tl_team_find', ['TOOL-' + String(n).padStart(4, '0')])).id, free, 'the printed label works');
  eq((await rpc(db, CAL, 'tl_team_find', [' tool-' + n + ' '])).id, free, 'spaces and case do not matter');
  for (const asked of [String(await numberOf(db, out)), String(await numberOf(db, bad)), '99999', 'abc', '', "1' or 1=1"]) {
    const msg = await code(rpc(db, CAL, 'tl_team_find', [asked]));
    assert(msg === 'TOOL_NOT_AVAILABLE', 'asked ' + asked + ' got ' + msg);
  }
  for (const who of [AMY, OWNER, STAFF]) await refused(rpc(db, who, 'tl_team_find', [String(n)]), 'NOT', who);
});
await test('find by number: another company\'s tool is the same refusal', async () => {
  const db = await fresh();
  await as(db, OTHER);
  await db.query(`select stk_set_enabled(true)`); await db.query(`select tl_set_enabled(true)`);
  await as(db, '');
  const it = (await one(db, `insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, 'Drill', 'pc', 'tool') returning id`, [OTHER])).id;
  const r = await rpc(db, OTHER, 'tl_register', [op(), j({ item_id: it, condition: 'good', at: 'warehouse', photo_path: `tools/${OTHER}/2026-10/${crypto.randomUUID()}.jpg` })]);
  const n = await numberOf(db, r.tools[0].tool_id);
  const mine = await newTool(db);
  eq(await numberOf(db, mine), n, 'numbers are per company, so ours has the same number');
  await issue(db, CAL, { tool_id: mine, holder_id: AMY, folder_id: db.project });
  await refused(rpc(db, CAL, 'tl_team_find', [String(n)]), 'TOOL_NOT_AVAILABLE');
});
await test('choices: members they lead, and open projects with no completed ones; names only', async () => {
  const db = await fresh();
  const c = await rpc(db, CAL, 'tl_team_choices');
  eq(c.members.map((m) => m.name).sort(), ['Amy (W-0001)', 'Ben (W-0002)', 'Cal (W-0003)', 'Dee (W-0004)'].sort());
  eq(c.projects.map((p) => p.name), ['House']);
  noForbidden(c, 'choices');
  await refused(rpc(db, AMY, 'tl_team_choices'), 'NOT_LEADER');
});

// ── D. Issue, handover, return ──────────────────────────────
await test('issue: a leader issues to a member; recorded as theirs; refused outside, on a closed project, or a tool not Available', async () => {
  const db = await fresh();
  const t = await newTool(db); const t2 = await newTool(db);
  const r = await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, note: 'for the slab' });
  const row = await toolRow(db, t);
  eq([row.state, row.holder_id, row.folder_id], ['issued', AMY, db.project]);
  const rec = await one(db, `select * from tl_records where id = $1`, [r.record_id]);
  eq([rec.kind, rec.recorded_by, rec.note], ['issue', CAL, 'for the slab']);
  for (const [who, holder, m] of [[CAL, FAR, 'outside their teams'], [EVE, AMY, 'another leader\'s member'], [AMY, BEN, 'a plain worker'], [CAL, GONE, 'never a member'], [CAL, STAFF, 'office staff']]) {
    await refused(issue(db, who, { tool_id: t2, holder_id: holder, folder_id: db.project }), 'NOT', m);
  }
  await refused(issue(db, CAL, { tool_id: t2, holder_id: AMY, folder_id: db.done }), 'PROJECT_COMPLETED');
  await refused(issue(db, CAL, { tool_id: t, holder_id: BEN, folder_id: db.project }), 'NOT_AVAILABLE');
  eq((await toolRow(db, t2)).state, 'available', 'no refused call changed it');
});
await test('issue: a leader counts as a member of their own team', async () => {
  const db = await fresh();
  const t = await newTool(db);
  await issue(db, CAL, { tool_id: t, holder_id: CAL, folder_id: db.project });
  eq((await toolRow(db, t)).holder_id, CAL);
});
await test('issue: a photo sent by the phone is ignored, so the tools folder stays office-only', async () => {
  const db = await fresh();
  const t = await newTool(db);
  const r = await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, photo_path: photoOf() });
  eq((await one(db, `select photo_path from tl_records where id = $1`, [r.record_id])).photo_path, null);
});
await test('authority is checked on every call: losing the role, the team, or an active team stops it at once', async () => {
  const db = await fresh();
  const t1 = await newTool(db);
  const go = (t) => issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project });
  await rpc(db, OWNER, 'pr_office_remove_member', [db.led, AMY]);
  await refused(go(t1), 'NOT_YOUR_TEAM', 'member removed');
  await rpc(db, OWNER, 'pr_office_add_member', [db.led, AMY]);
  await as(db, '');
  await db.query(`update pr_team_members set is_leader = false where team_id = $1`, [db.led]);
  await refused(go(t1), 'NOT_YOUR_TEAM', 'no longer named');
  await db.query(`update pr_team_members set is_leader = true where team_id = $1 and worker_id = $2`, [db.led, CAL]);
  await db.query(`update pr_teams set active = false where id = $1`, [db.led]);
  await refused(go(t1), 'NOT_YOUR_TEAM', 'team turned off');
  await db.query(`update pr_teams set active = true where id = $1`, [db.led]);
  await go(t1);
  await db.query(`update pr_team_members set is_leader = false where worker_id = $1`, [CAL]);
  await refused(rpc(db, CAL, 'tl_team_tools'), 'NOT_LEADER', 'leads nothing now');
  await db.query(`update pr_team_members set is_leader = true where team_id = $1 and worker_id = $2`, [db.led, CAL]);
  await as(db, '');
  await db.query(`update profiles set status = 'inactive' where id = $1`, [CAL]);
  await refused(rpc(db, CAL, 'tl_team_find', ['1']), 'NOT_A_REQUESTER', 'account switched off');
  await db.query(`update profiles set status = 'active' where id = $1`, [CAL]);
});
await test('handover: both people must be in teams this leader leads; a different team of theirs is fine; project can change', async () => {
  const db = await fresh();
  const other = (await one(db, `insert into folders (owner_id, name) values ($1, 'Annex') returning id`, [OWNER])).id;
  const t = await newTool(db);
  await officeIssue(db, t, AMY);
  await refused(handover(db, CAL, { tool_id: t, holder_id: FAR }), 'NOT_YOUR_TEAM', 'new holder outside');
  await refused(handover(db, EVE, { tool_id: t, holder_id: FAR }), 'NOT_YOUR_TEAM', 'current holder outside');
  await handover(db, CAL, { tool_id: t, holder_id: DEE, folder_id: other });
  const row = await toolRow(db, t);
  eq([row.holder_id, row.folder_id], [DEE, other]);
  const f = await newTool(db);
  await officeIssue(db, f, FAR);
  await refused(handover(db, CAL, { tool_id: f, holder_id: AMY }), 'NOT_YOUR_TEAM', 'a tool they cannot see');
  await refused(handover(db, CAL, { tool_id: await newTool(db), holder_id: AMY }), 'NOT_YOUR_TEAM', 'an Available tool gives nothing away');
});
await test('return: each condition has its existing result; damaged goes to the main owner; outside their teams refused', async () => {
  const db = await fresh();
  const mk = async () => { const t = await newTool(db); await officeIssue(db, t, AMY); return t; };
  const a = await mk(); const b = await mk(); const c = await mk(); const d = await mk(); const e = await mk();
  await ret(db, CAL, { tool_id: a, condition: 'good' });
  eq((await toolRow(db, a)).state, 'available');
  await ret(db, CAL, { tool_id: b, condition: 'needs_repair' });
  eq((await toolRow(db, b)).state, 'repair');
  await ret(db, CAL, { tool_id: c, condition: 'missing_parts' });
  eq((await toolRow(db, c)).state, 'repair');
  await ret(db, CAL, { tool_id: d, condition: 'damaged', note: 'split' });
  eq((await toolRow(db, d)).state, 'retire_pending');
  await refused(ret(db, EVE, { tool_id: e }), 'NOT_YOUR_TEAM');
  eq((await toolRow(db, e)).holder_id, AMY);
  await refused(ret(db, CAL, { tool_id: e, condition: 'perfect' }), 'BAD_CONDITION');
  await rpc(db, OWNER, 'pr_office_remove_member', [db.led, AMY]);
  await refused(ret(db, CAL, { tool_id: e }), 'NOT_YOUR_TEAM', 'holder left the team');
});
await test('a retried action records once, even after the tool moved on or the leader lost the team', async () => {
  const db = await fresh();
  const t = await newTool(db);
  const id1 = op();
  const a = await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project }, id1);
  const b = await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project }, id1);
  eq(a.record_id, b.record_id);
  eq(b.replayed, true);
  await ret(db, CAL, { tool_id: t });
  eq((await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project }, id1)).record_id, a.record_id, 'still the first answer');
  await rpc(db, OWNER, 'pr_office_remove_member', [db.led, AMY]);
  eq((await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project }, id1)).record_id, a.record_id, 'the person\'s own earlier answer');
  eq(num((await one(db, `select count(*) n from tl_records where tool_id = $1 and kind = 'issue'`, [t])).n), 1);
  eq(await rpc(db, CAL, 'pur_op_state', [id1]), 'recorded');
});
await test('a cancelled operation id never records, using stock\'s send-again, check or cancel route', async () => {
  const db = await fresh();
  const t = await newTool(db);
  const id1 = op();
  eq(await rpc(db, CAL, 'pur_op_state', [id1]), 'none');
  await rpc(db, CAL, 'pur_op_cancel', [id1]);
  await refused(issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project }, id1), 'OP_CANCELLED');
  eq((await toolRow(db, t)).state, 'available');
});

// ── E. Reversing their own record ───────────────────────────
await test('reverse: only their own latest record, with a reason; the office can always reverse; the owner decides pending ones', async () => {
  const db = await fresh();
  const t = await newTool(db);
  const r = await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project });
  await refused(reverse(db, EVE, r.record_id), 'NOT_YOURS');
  await refused(reverse(db, CAL, r.record_id, ''), 'REASON_REQUIRED');
  await reverse(db, CAL, r.record_id, 'wrong person');
  eq((await toolRow(db, t)).state, 'available');
  const r2 = await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project });
  const r3 = await handover(db, CAL, { tool_id: t, holder_id: BEN });
  await refused(reverse(db, CAL, r2.record_id), 'LATER_RECORDS');
  await rpc(db, OWNER, 'pr_office_remove_member', [db.led, BEN]);
  await refused(reverse(db, CAL, r3.record_id), 'NOT_YOUR_TEAM', 'someone in it left their team');
  await rpc(db, OWNER, 'pr_office_add_member', [db.led, BEN]);
  await reverse(db, CAL, r3.record_id);
  eq((await toolRow(db, t)).holder_id, AMY);
  const office = await officeIssue(db, await newTool(db), AMY);
  await refused(reverse(db, CAL, office.record_id), 'NOT_YOURS', 'an office record');
  const d = await newTool(db);
  await officeIssue(db, d, AMY);
  const back = await ret(db, CAL, { tool_id: d, condition: 'damaged' });
  await refused(reverse(db, CAL, back.record_id), 'LATER_RECORDS', 'the Retire request came after');
  await refused(reverse(db, CAL, back.retire_record_id), 'BAD_STATE', 'a leader never withdraws what waits for the owner');
});
await test('a damaged return: its Retire request is always the later record, every time', async () => {
  const db = await fresh();
  for (let i = 1; i <= 30; i++) {
    const t = await newTool(db);
    await officeIssue(db, t, AMY);
    const back = await ret(db, CAL, { tool_id: t, condition: 'damaged' });
    await refused(reverse(db, CAL, back.record_id), 'LATER_RECORDS', 'round ' + i + ': the Retire request came after');
  }
});
await test('my records: their own recent records, which ones they can still reverse, no notes', async () => {
  const db = await fresh();
  const t = await newTool(db);
  await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, note: 'SECRET' });
  await handover(db, CAL, { tool_id: t, holder_id: BEN });
  const recs = await rpc(db, CAL, 'tl_team_my_records', [10]);
  eq(recs.map((r) => [r.kind, r.can_reverse]), [['handover', true], ['issue', false]]);
  assert(!JSON.stringify(recs).includes('SECRET'), 'a note');
  noForbidden(recs, 'my records');
  await refused(rpc(db, AMY, 'tl_team_my_records', [10]), 'NOT_LEADER');
});

// ── F. Request links: the existing fill-once rules ──────────
await test('a linked issue fills the line once; a return or handover keeps it filled; reversing reopens it by one', async () => {
  const db = await fresh();
  const line = await requestLine(db);
  const t = await newTool(db);
  eq(await still(db, line), 1);
  const options = await rpc(db, CAL, 'tl_team_request_lines', [t, db.project]);
  eq(options.map((o) => [o.line_id, o.still_to_fill]), [[line, 1]]);
  noForbidden(options, 'request lines');
  const r = await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, request_line_id: line });
  eq(r.fills_request, true);
  eq(await still(db, line), 0, 'filled');
  await handover(db, CAL, { tool_id: t, holder_id: BEN });
  eq(await still(db, line), 0, 'a handover keeps it');
  await ret(db, CAL, { tool_id: t });
  eq(await still(db, line), 0, 'a return keeps it');
  const t2 = await newTool(db);
  await refused(issue(db, CAL, { tool_id: t2, holder_id: AMY, folder_id: db.project, request_line_id: line }), 'REQUEST_EXCEEDED', 'never past its quantity');
  const line2 = await requestLine(db);
  const r2 = await issue(db, CAL, { tool_id: t2, holder_id: AMY, folder_id: db.project, request_line_id: line2 });
  eq(await still(db, line2), 0);
  await reverse(db, CAL, r2.record_id);
  eq(await still(db, line2), 1, 'reversal reopens by one');
});
await test('a leader can link only lines they can already see; anything else sends them to the office, and nothing is recorded', async () => {
  const db = await fresh();
  const t = await newTool(db);
  const teamLine = await requestLine(db, { team: db.led });
  const ownLine = await requestLine(db, { by: CAL, team: null });
  const memberSolo = await requestLine(db, { by: AMY, team: null });
  const otherTeam = await requestLine(db, { by: FAR, team: db.plain });
  const lines = (await rpc(db, CAL, 'tl_team_request_lines', [t, db.project])).map((o) => o.line_id).sort();
  eq(lines, [teamLine, ownLine].sort());
  for (const line of [memberSolo, otherTeam]) {
    await refused(issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, request_line_id: line }), 'REQUEST_NEEDS_OFFICE');
  }
  await refused(issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, request_line_id: 'not-a-uuid' }), 'BAD_REQUEST_LINK');
  eq((await toolRow(db, t)).state, 'available');
  await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, request_line_id: ownLine });
  eq(await still(db, ownLine), 0);
});
await test('the existing line checks still apply: another project, a different item, a material line', async () => {
  const db = await fresh();
  const annex = (await one(db, `insert into folders (owner_id, name) values ($1, 'Annex') returning id`, [OWNER])).id;
  const t = await newTool(db);
  const elsewhere = await requestLine(db, { folder: annex });
  await refused(issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, request_line_id: elsewhere }), 'BAD_REQUEST_LINK');
  await as(db, '');
  const drill = (await one(db, `insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, 'Drill', 'pc', 'tool') returning id`, [OWNER])).id;
  const wrong = await requestLine(db, { item: drill });
  await refused(issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, request_line_id: wrong }), 'ITEM_MISMATCH');
  eq((await rpc(db, CAL, 'tl_team_request_lines', [t, db.project])).length, 0, 'not offered');
  await refused(rpc(db, CAL, 'tl_team_request_lines', [await officeHeld(db), db.project]), 'TOOL_NOT_AVAILABLE');
});
async function officeHeld(db) { const t = await newTool(db); await officeIssue(db, t, FAR); return t; }

// ── G. Nothing touches money ────────────────────────────────
await test('every phone action leaves expenses, payroll and purchase payments unchanged', async () => {
  const db = await fresh();
  const count = () => one(db, `select (select count(*) from expenses) e, (select count(*) from payroll) p, (select count(*) from pur_payments) y`);
  const before = await count();
  const t = await newTool(db);
  const line = await requestLine(db);
  await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project, request_line_id: line });
  await handover(db, CAL, { tool_id: t, holder_id: BEN });
  await rpc(db, BEN, 'tl_report_problem', [op(), t, 'broken', '']);
  await ret(db, CAL, { tool_id: t, condition: 'damaged' });
  eq(await count(), before);
});
await test('no new function reads labor contracts, payroll, expenses or a profile\'s trade', async () => {
  const body = M111.replace(/--.*$/gm, '');
  for (const word of ['labor_contracts', 'pm_labor_contracts', 'from payroll', 'from expenses', 'p.position', 'profiles.position']) {
    assert(!body.includes(word), 'mentions ' + word);
  }
});

// ── H. The Team Leader switch ───────────────────────────────
const setRole = (db, who, worker, on) => rpc(db, who, 'wk_set_team_leader', [worker, on]);
await test('only the main owner can use the switch', async () => {
  const db = await fresh();
  // The exact answer: the guard behind it would also refuse, and must not hide a wider test here.
  for (const who of [SUBOWNER, STAFF, AMY, CAL, CLIENT]) await refused(setRole(db, who, AMY, true), 'OWNER_ONLY', who);
  await refused(setRole(db, OTHER, AMY, true), 'NOT_A_WORKER', 'another company\'s main owner');
  eq((await one(db, `select role from profiles where id = $1`, [AMY])).role, 'worker');
  await setRole(db, OWNER, AMY, true);
  eq((await one(db, `select role from profiles where id = $1`, [AMY])).role, 'teamLeader');
});
await test('the switch changes the role and nothing else, and every change is logged once', async () => {
  const db = await fresh();
  const snap = (who) => one(db, `select id, owner_id, status, display_name, worker_no from profiles where id = $1`, [who]);
  const memberships = () => db.query(`select team_id, worker_id, is_leader, removed_at from pr_team_members order by team_id, worker_id`);
  const before = await snap(AMY); const mBefore = (await memberships()).rows;
  const r = await setRole(db, OWNER, AMY, true);
  eq(r.changed, true);
  eq(await snap(AMY), before);
  eq((await memberships()).rows, mBefore, 'joins, removes and names nobody');
  eq((await setRole(db, OWNER, AMY, true)).changed, false, 'already on: no change');
  const log = await rpc(db, OWNER, 'wk_worker_log', [AMY]);
  eq(log.map((e) => [e.kind, e.detail]), [['role', 'worker → teamLeader']]);
  await setRole(db, OWNER, AMY, false);
  eq((await rpc(db, OWNER, 'wk_worker_log', [AMY])).length, 2);
  eq(num((await one(db, `select count(*) n from wk_role_events where actor_id = $1`, [OWNER])).n), 2);
  await as(db, '');
  await refused(db.query(`delete from wk_role_events`), 'HISTORY_IMMUTABLE');
  await refused(db.query(`update wk_role_events set to_role = 'worker'`), 'HISTORY_IMMUTABLE');
  for (const who of [SUBOWNER, STAFF, AMY]) await refused(rpc(db, who, 'wk_worker_log', [AMY]), 'O', who);
});
await test('promoting alone gives no powers until the office names them leader', async () => {
  const db = await fresh();
  const t = await newTool(db);
  await setRole(db, OWNER, BEN, true);
  await refused(rpc(db, BEN, 'tl_team_tools'), 'NOT_LEADER');
  await refused(issue(db, BEN, { tool_id: t, holder_id: AMY, folder_id: db.project }), 'NOT_YOUR_TEAM');
  await rpc(db, OWNER, 'pr_office_set_leader', [db.led, BEN]);
  await issue(db, BEN, { tool_id: t, holder_id: AMY, folder_id: db.project });
  eq((await rpc(db, CAL, 'tl_team_tools')).some((x) => x.id === t), false, 'the old leader of Led no longer sees it');
});
await test('turning off is refused while they lead an active team, naming it; it works once someone else leads', async () => {
  const db = await fresh();
  const msg = await code(setRole(db, OWNER, EVE, false));
  assert(msg === 'LEADS_A_TEAM', msg);
  eq((await one(db, `select role from profiles where id = $1`, [EVE])).role, 'teamLeader');
  await setRole(db, OWNER, FAR, true);
  await rpc(db, OWNER, 'pr_office_set_leader', [db.plain, FAR]);
  await setRole(db, OWNER, EVE, false);
  eq((await one(db, `select role from profiles where id = $1`, [EVE])).role, 'worker');
});
await test('only crew accounts of this company; a switched-off account cannot be promoted, and can be demoted', async () => {
  const db = await fresh();
  for (const who of [STAFF, SUBOWNER, CLIENT, PARTNER, OWNER, OTHER]) await refused(setRole(db, OWNER, who, true), 'NOT_A_WORKER', who);
  await refused(setRole(db, OWNER, GONE, true), 'ACCOUNT_INACTIVE');
  await refused(setRole(db, OWNER, '00000000-0000-0000-0000-00000000dead', true), 'NOT_A_WORKER');
  await refused(setRole(db, OWNER, AMY, null), 'BAD_SWITCH');
});

// ── I. The guard still refuses everything else ──────────────
await test('profiles_guard: direct role changes stay refused for everyone; client and partner still work', async () => {
  const db = await fresh();
  const direct = (who, target, role) => as(db, who).then(() => db.query(`update profiles set role = $1 where id = $2`, [role, target]));
  for (const who of [OWNER, STAFF]) {
    await refused(direct(who, AMY, 'teamLeader'), 'role may only be changed between client and partner', who);
    await refused(direct(who, CAL, 'worker'), 'role may only be changed between client and partner', who);
  }
  await refused(direct(AMY, AMY, 'teamLeader'), 'not allowed to change', 'a worker on themselves');
  await refused(direct(OWNER, OWNER, 'staff'), 'not allowed to change your own role');
  await refused(direct(OWNER, AMY, 'owner'), 'role may only be changed');
  await refused(direct(STAFF, CLIENT, 'owner'), 'role may only be changed');
  await direct(OWNER, CLIENT, 'partner');
  await direct(OWNER, CLIENT, 'client');
  await as(db, OWNER);
  await db.query(`update profiles set display_name = 'Amy B' where id = $1`, [AMY]);
  await as(db, '');
  await db.query(`update profiles set role = 'teamLeader' where id = $1`, [AMY]);
  await db.query(`update profiles set role = 'worker' where id = $1`, [AMY]);
});
await test('the guard\'s opening cannot be reached by setting the flag for someone else, or for another role', async () => {
  const db = await fresh();
  await as(db, STAFF);
  await db.exec(`select set_config('dacs.wk_role_change', '${OWNER}', false)`);
  await refused(db.query(`update profiles set role = 'teamLeader' where id = $1`, [AMY]), 'role may only be changed', 'flag for someone else');
  await as(db, OWNER);
  await db.exec(`select set_config('dacs.wk_role_change', '${OWNER}', false)`);
  await refused(db.query(`update profiles set role = 'staff' where id = $1`, [AMY]), 'role may only be changed', 'another role');
  await refused(db.query(`update profiles set role = 'owner' where id = $1`, [AMY]), 'role may only be changed', 'another role');
  await refused(db.query(`update profiles set owner_id = null where id = $1`, [AMY]), 'not allowed to change owner_id');
  await db.exec(`select set_config('dacs.wk_role_change', '${STAFF}', false)`);
  await refused(db.query(`update profiles set role = 'teamLeader' where id = $1`, [AMY]), 'role may only be changed', 'a flag naming someone else, even for the main owner');
  await db.exec(`select set_config('dacs.wk_role_change', '', false)`);
});
await test('after the switch runs the flag is cleared, so the same session cannot change a role directly', async () => {
  const db = await fresh();
  await setRole(db, OWNER, AMY, true);
  await as(db, OWNER);
  await refused(db.query(`update profiles set role = 'worker' where id = $1`, [AMY]), 'role may only be changed');
});
await test('inside one transaction, neither flag outlives its call', async () => {
  const db = await fresh();
  await as(db, OWNER);
  await db.exec('begin');
  await db.query(`select wk_set_team_leader($1, true)`, [AMY]);
  const direct = await code(db.query(`update profiles set role = 'teamLeader' where id = $1`, [BEN]));
  await db.exec('rollback');
  eq(direct, 'role may only be changed between client and partner', 'the role flag');
  const t = await newTool(db);
  await as(db, CAL);
  await db.exec('begin');
  await db.query(`select tl_team_issue($1, $2::jsonb)`, [op(), j({ tool_id: t, holder_id: AMY, folder_id: db.project })]);
  const office = await code(db.query(`select tl_return($1, $2::jsonb)`, [op(), j({ tool_id: t, condition: 'good' })]));
  await db.exec('rollback');
  assert(office !== 'no error', 'the leader flag: the office function answered a leader');
});

// ── J. Invalid leaders and inactive teams ───────────────────
const officeTeam = async (db, team) => (await rpc(db, OWNER, 'pr_office_teams')).find((t) => t.id === team);
const leaderOf = (t) => t.members.find((m) => m.is_leader) || null;
await test('invalid leaders: a named leader with a switched-off account is flagged, and has no powers', async () => {
  const db = await fresh();
  eq(leaderOf(await officeTeam(db, db.led)).leader_problem, null, 'a valid leader');
  await as(db, '');
  await db.query(`update profiles set status = 'inactive' where id = $1`, [CAL]);
  eq(leaderOf(await officeTeam(db, db.led)).leader_problem, 'inactive');
  await rpc(db, OWNER, 'pr_office_set_leader', [db.led, null]);
  eq(leaderOf(await officeTeam(db, db.led)), null, 'the office can clear it');
  await as(db, '');
  await db.query(`update profiles set status = 'active' where id = $1`, [CAL]);
  await rpc(db, OWNER, 'pr_office_set_leader', [db.led, CAL]);
  await as(db, '');
  await db.query(`update profiles set status = 'inactive' where id = $1`, [CAL]);
  await db.query(`update profiles set role = 'teamLeader' where id = $1`, [FAR]);
  await rpc(db, OWNER, 'pr_office_add_member', [db.led, FAR]);
  await rpc(db, OWNER, 'pr_office_set_leader', [db.led, FAR]);
  eq(leaderOf(await officeTeam(db, db.led)).worker_id, FAR, 'or pick someone else');
});
await test('invalid leaders: a mark left without the role is flagged, whatever caused it', async () => {
  const db = await fresh();
  await as(db, '');
  await db.query(`update profiles set role = 'worker' where id = $1`, [EVE]);
  eq(leaderOf(await officeTeam(db, db.plain)).leader_problem, 'no_role');
  await refused(rpc(db, EVE, 'tl_team_tools'), 'NOT_LEADER');
});
await test('inactive teams: the office can clear a mark there, not name a leader; turning the role off clears theirs too', async () => {
  const db = await fresh();
  await as(db, '');
  await db.query(`update pr_teams set active = false where id = $1`, [db.plain]);
  await refused(rpc(db, OWNER, 'pr_office_set_leader', [db.plain, FAR]), 'BAD_TEAM', 'naming still needs an active team');
  await rpc(db, OWNER, 'pr_office_set_leader', [db.plain, null]);
  eq(leaderOf(await officeTeam(db, db.plain)), null);
  await as(db, '');
  await db.query(`update pr_team_members set is_leader = true where team_id = $1 and worker_id = $2`, [db.plain, EVE]);
  await setRole(db, OWNER, EVE, false);
  eq(leaderOf(await officeTeam(db, db.plain)), null, 'cleared in the same step');
  await as(db, '');
  await db.query(`update pr_teams set active = true where id = $1`, [db.plain]);
  await setRole(db, OWNER, EVE, true);
  eq(leaderOf(await officeTeam(db, db.plain)), null, 'an old mark cannot come back');
  await refused(rpc(db, EVE, 'tl_team_tools'), 'NOT_LEADER');
});
await test('the existing leader rules still hold', async () => {
  const db = await fresh();
  await refused(rpc(db, OWNER, 'pr_office_set_leader', [db.led, FAR]), 'NOT_IN_TEAM');
  await refused(rpc(db, OWNER, 'pr_office_set_leader', [db.led, AMY]), 'NOT_A_TEAM_LEADER');
  await refused(rpc(db, AMY, 'pr_office_set_leader', [db.led, CAL]), 'OFFICE_ONLY');
  await refused(rpc(db, OTHER, 'pr_office_set_leader', [db.led, null]), 'BAD_TEAM');
});

// ── K. The temporary-password records ───────────────────────
const event = (db, worker, kind, actor = OWNER) => db.query(`insert into wk_password_events (owner_id, worker_id, kind, actor_id) values ($1, $2, $3, $4)`, [OWNER, worker, kind, actor]);
await test('must change: only after a temporary password was really set, until the worker changes it', async () => {
  const db = await fresh();
  const state = (who) => rpc(db, who, 'wk_password_state');
  eq((await state(AMY)).must_change, false);
  await as(db, '');
  await event(db, AMY, 'requested');
  eq((await state(AMY)).must_change, false, 'asked, not set');
  await as(db, '');
  await event(db, AMY, 'failed');
  eq((await state(AMY)).must_change, false, 'the reset failed');
  await as(db, '');
  await event(db, AMY, 'temporary_set');
  eq((await state(AMY)).must_change, true);
  eq((await state(BEN)).must_change, false, 'only that worker');
  const done = await rpc(db, AMY, 'wk_password_changed');
  eq(done.recorded, true);
  eq((await state(AMY)).must_change, false);
  eq((await rpc(db, AMY, 'wk_password_changed')).recorded, false, 'nothing to record');
  await as(db, '');
  await event(db, AMY, 'temporary_set');
  eq((await state(AMY)).must_change, true, 'a second reset asks again');
});
await test('the password log holds no password, cannot be rewritten, and only the main owner reads it', async () => {
  const db = await fresh();
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'wk_password_events'`)).rows.map((r) => r.column_name);
  eq(cols.sort(), ['actor_id', 'at', 'id', 'kind', 'owner_id', 'worker_id'].sort());
  await as(db, '');
  await event(db, AMY, 'temporary_set');
  await refused(db.query(`delete from wk_password_events`), 'HISTORY_IMMUTABLE');
  await refused(db.query(`update wk_password_events set kind = 'failed'`), 'HISTORY_IMMUTABLE');
  const log = await rpc(db, OWNER, 'wk_worker_log', [AMY]);
  eq(log.map((e) => [e.kind, e.detail]), [['password', 'temporary_set']]);
  for (const who of [SUBOWNER, STAFF, AMY, CAL]) await refused(rpc(db, who, 'wk_worker_log', [AMY]), 'O', who);
  eq((await rpc(db, OWNER, 'wk_me')).is_main_owner, true);
  for (const who of [SUBOWNER, STAFF, AMY]) eq((await rpc(db, who, 'wk_me')).is_main_owner, false, who);
});

// ── L. Who may call what ────────────────────────────────────
await test('every new reader and action is for signed-in accounts; every helper for nobody; tables have no policy', async () => {
  const db = await fresh();
  const can = async (role, fn) => (await one(db, `select has_function_privilege($1, $2, 'execute') x`, [role, fn])).x;
  const open = ['tl_my_tools()', 'tl_my_tool(uuid)', 'tl_team_tools()', 'tl_team_tool(uuid)', 'tl_team_find(text)', 'tl_team_choices()',
    'tl_team_request_lines(uuid, uuid)', 'tl_team_issue(uuid, jsonb)', 'tl_team_handover(uuid, jsonb)', 'tl_team_return(uuid, jsonb)',
    'tl_team_reverse(uuid, uuid, text)', 'tl_team_my_records(integer)', 'tl_report_problem(uuid, uuid, text, text)',
    'tl_problems(boolean)', 'tl_close_problem(uuid, uuid, text)', 'wk_set_team_leader(uuid, boolean)', 'wk_worker_log(uuid)', 'wk_me()',
    'wk_password_state()', 'wk_password_changed()', 'pr_office_teams()', 'pr_office_set_leader(uuid, uuid)'];
  for (const fn of open) eq([await can('authenticated', fn), await can('anon', fn)], [true, false], fn);
  const helpers = ['tl_crew_owner()', 'tl_leader_owner()', 'tl_i_lead(uuid)', 'tl_as_leader(text, uuid, jsonb)', 'tl_phone_tool_json(uuid)', 'tl_person_records(uuid, uuid)', 'tl_history_immutable()', 'tl_problems_guard()'];
  for (const fn of helpers) eq([await can('authenticated', fn), await can('anon', fn)], [false, false], fn);
  const defined = [...M111.matchAll(/create or replace function (?:public\.)?([a-z_]+)\(/g)].map((m) => m[1]);
  const known = new Set([...open, ...helpers].map((f) => f.split('(')[0]).concat(['tl_actor', 'profiles_guard', 'tl_leader_sees_line']));
  for (const fn of defined) assert(known.has(fn), fn + ' has no permission decision here');
  for (const t of ['tl_problems', 'wk_role_events', 'wk_password_events']) {
    const r = await one(db, `select relrowsecurity x from pg_class where relname = $1`, [t]);
    eq(r.x, true, t + ' has row security');
    eq(num((await one(db, `select count(*) n from pg_policies where tablename = $1`, [t])).n), 0, t + ' has no policy');
  }
});
await test('tl_actor: outside a leader\'s own checked call the office rule is unchanged', async () => {
  const db = await fresh();
  const t = await newTool(db);
  for (const who of [AMY, CAL]) await refused(rpc(db, who, 'tl_issue', [op(), j({ tool_id: t, holder_id: AMY, folder_id: db.project })]), 'N', who + ' on the office function');
  await as(db, CAL);
  await db.exec(`select set_config('dacs.tl_leader_actor', '${AMY}', false)`);
  await refused(db.query(`select tl_issue($1, $2::jsonb)`, [op(), j({ tool_id: t, holder_id: AMY, folder_id: db.project })]), 'N', 'a flag for someone else');
  await db.exec(`select set_config('dacs.tl_leader_actor', '', false)`);
  await issue(db, CAL, { tool_id: t, holder_id: AMY, folder_id: db.project });
  await refused(db.query(`select tl_return($1, $2::jsonb)`, [op(), j({ tool_id: t, condition: 'good' })]), 'N', 'the flag does not outlive the call');
  eq((await toolRow(db, t)).state, 'issued');
});

// ── M. The way back ─────────────────────────────────────────
const ROLLBACK = read(path.join(ROOT, 'supabase/tests/3b_rollback.sql'));
await test('the rollback restores the four functions exactly, and deletes nothing', async () => {
  for (const [src, name] of [[M107, 'tl_actor'], [M86, 'pr_office_teams'], [M86, 'pr_office_set_leader']]) {
    assert(ROLLBACK.includes(fnText(src, name)), name + ' is the earlier text');
  }
  assert(ROLLBACK.includes(fnEnd(M19, 'profiles_guard')), 'profiles_guard is the earlier text');
  assert(!/\b(drop|delete|truncate)\b/i.test(ROLLBACK.replace(/--.*$/gm, '')), 'it removes nothing');
  const db = await fresh();
  const t = await newTool(db);
  await officeIssue(db, t, AMY);
  await rpc(db, AMY, 'tl_report_problem', [op(), t, 'broken', '']);
  await as(db, '');
  await db.exec(ROLLBACK);
  await refused(ret(db, CAL, { tool_id: t }), 'NOT', 'a leader can no longer record');
  eq((await toolRow(db, t)).holder_id, AMY);
  await refused(setRole(db, OWNER, BEN, true), 'role may only be changed', 'the switch is refused by the guard');
  assert(!('leader_problem' in (await officeTeam(db, db.led)).members[0]), 'the office list is the earlier one');
  await refused(rpc(db, OWNER, 'pr_office_set_leader', [db.unled, null]).then(async () => {
    await as(db, '');
    await db.query(`update pr_teams set active = false where id = $1`, [db.unled]);
    return rpc(db, OWNER, 'pr_office_set_leader', [db.unled, null]);
  }), 'BAD_TEAM', 'a turned-off team is as before');
  await rpc(db, OWNER, 'tl_return', [op(), j({ tool_id: t, condition: 'good' })]);
  eq((await toolRow(db, t)).state, 'available', 'the office keeps working');
  eq(num((await one(db, `select count(*) n from tl_problems`)).n), 1, 'reports stay');
});

// ── N. The live acceptance script ───────────────────────────
const ACCEPT = read(path.join(ROOT, 'supabase/tests/3b_acceptance.sql'));
// As live: auth.uid() reads the JWT claims the script sets; the main owner is the oldest
// owner account; W-0005 and W-0007 are plain workers; the attendance table exists.
async function acceptanceDb() {
  const db = await fresh();
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as
                   $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid $$;
                 create table attendance_records (id uuid primary key default gen_random_uuid());
                 alter table profiles add column if not exists created_at timestamptz not null default now();
                 update profiles set created_at = now() + interval '1 hour' where id <> '${OWNER}';
                 update profiles set worker_no = 50 where id = '${EVE}';
                 update profiles set worker_no = 70 where id = '${GONE}';
                 update profiles set worker_no = 5 where id = '${BEN}';
                 update profiles set worker_no = 7 where id = '${AMY}';`);
  return db;
}
const acceptanceCounts = (db) => one(db, `select (select count(*) from tl_tools) t, (select count(*) from tl_records) r, (select count(*) from tl_problems) p,
  (select count(*) from wk_role_events) e, (select count(*) from pr_teams) m, (select count(*) from folders) f, (select count(*) from pur_ops) o,
  (select role from profiles where id = '${BEN}') w5, (select status from profiles where id = '${BEN}') s5`);
await test('the live acceptance script passes as written and leaves nothing behind, W-0005\'s role included', async () => {
  const db = await acceptanceDb();
  const before = await acceptanceCounts(db);
  const res = await db.exec(ACCEPT);
  assert(res.some((x) => (x.rows || []).some((r) => r.result === '3b-a acceptance: all checks passed')), 'the success row');
  eq(await acceptanceCounts(db), before, 'all rolled back');
  eq(before.w5, 'worker');
});
await test('the acceptance script fails when it should', async () => {
  for (const [why, spoil, want] of [
    ['a reader open to anon', (db) => db.exec(`grant execute on function tl_team_find(text) to anon`), 'A1'],
    ['a helper open to signed-in users', (db) => db.exec(`grant execute on function tl_i_lead(uuid) to authenticated`), 'A2'],
    ['a table with a policy', (db) => db.exec(`create policy zz on tl_problems for select using (true)`), 'A3'],
    ['W-0005 already a leader', (db) => db.exec(`update profiles set role = 'teamLeader' where worker_no = 5`), 'test accounts'],
    ['the guard open to a direct change', (db) => db.exec(fnEnd(M19, 'profiles_guard').replace("raise exception 'role may only be changed between client and partner';", "null;")), 'B2'],
    ['a leader able to act outside their team', (db) => db.exec(`create or replace function tl_i_lead(p_person uuid) returns boolean language sql stable security definer set search_path = public as $f$ select true $f$`), 'C3'],
    ['a find that reveals issued tools', (db) => db.exec(fnText(M111, 'tl_team_find').replace(" and t.state = 'available'", '')), 'C6'],
  ]) {
    const db = await acceptanceDb();
    await spoil(db);
    const got = await code(db.exec(ACCEPT));
    assert(got.includes(want), why + ': expected ' + want + ', got ' + got);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
