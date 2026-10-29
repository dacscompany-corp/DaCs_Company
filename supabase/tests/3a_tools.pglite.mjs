// ════════════════════════════════════════════════════════════════════
// STAGE 3a TOOLS — SERVER TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096 … 0106 and 0107 VERBATIM on PGlite (PostgreSQL in
// memory) over the 2B-b suite's tables. Nothing here talks to the live
// database; supabase/tests/3a_acceptance.sql repeats the key cases there,
// rolled back.
// --with-0108: and 0108 (crew names with their worker numbers, TF1) on top —
// every test here holds, and section L checks the names.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
const M02 = mig('0002_rls.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');
const M96 = mig('0096_purchase_recording.sql');
const M97 = mig('0097_purchasing_office.sql');
const M98 = mig('0098_pm_profit_sharing.sql');
const M101 = mig('0101_purchasing_phone.sql');
const M102 = mig('0102_purchase_payments.sql');
const M103 = mig('0103_buyer_return_photo.sql');
const M90 = mig('0090_workmate_item_history.sql');
const M104 = mig('0104_stock.sql');
const M105 = mig('0105_stock_cost_moves.sql');
const M106 = mig('0106_workmate_phone_stock.sql');
const M107 = mig('0107_tools.sql');
const WITH_0108 = process.argv.includes('--with-0108');
const M108 = WITH_0108 ? mig('0108_tools_crew_numbers.sql') : '';
const M85 = mig('0085_workmate_requests.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
const REQUESTS_0085 = `
create table pr_teams (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  name text not null, active boolean not null default true, created_at timestamptz not null default now());
create table pr_team_members (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  team_id uuid not null references pr_teams(id), worker_id uuid not null references profiles(id), is_leader boolean not null default false,
  added_at timestamptz not null default now(), removed_at timestamptz);
create table pr_photos (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id), line_id uuid references pr_lines(id), storage_path text not null unique,
  uploaded_by uuid not null references profiles(id), created_at timestamptz not null default now());
${fnText(M85, 'pr_is_requester')}
${fnText(M85, 'pr_is_current_leader')}
${fnText(M51, 'attendance_data_owner')}
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

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';   // Expenses, no Buyer switch
const BUYER = '00000000-0000-0000-0000-000000000011';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const WORKER2 = '00000000-0000-0000-0000-000000000019';
const LEADER = '00000000-0000-0000-0000-000000000015';
const GONE = '00000000-0000-0000-0000-00000000001a';     // a deactivated worker
const OTHER = '00000000-0000-0000-0000-00000000000d';    // another company's owner
const OTHERW = '00000000-0000-0000-0000-00000000001b';   // another company's worker
const CLIENT = '00000000-0000-0000-0000-00000000001c';   // a client account of this company
const PARTNER = '00000000-0000-0000-0000-00000000001d';  // a partner account of this company
const EXPOWNER = '00000000-0000-0000-0000-000000000014'; // owner-role account with PM + Expenses: its OWN scope (tools off there)
const PMSTAFF = '00000000-0000-0000-0000-000000000018';  // staff focused on PM only
let opSeq = 0;
const op = () => '40000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

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
  if (M108) await db.exec(M108);
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null, null, 'Mark'),
    ('${WORKER2}', 'worker', '${OWNER}', 'active', null, null, 'Rey'),
    ('${LEADER}', 'teamLeader', '${OWNER}', 'active', null, null, 'Lito'),
    ('${GONE}', 'worker', '${OWNER}', 'inactive', null, null, 'Old'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${OTHERW}', 'worker', '${OTHER}', 'active', null, null, 'Far'),
    ('${CLIENT}', 'client', '${OWNER}', 'active', null, 'client@x.test', 'Cora'),
    ('${PARTNER}', 'partner', '${OWNER}', 'active', null, 'partner@x.test', 'Pat'),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null),
    ('${PMSTAFF}', 'staff', '${OWNER}', 'active', '["pm"]'::jsonb, 'pmstaff@dacs.test', 'Pia');`);
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`select stk_set_enabled(true)`);
  if (opts.on !== false) await db.query(`select tl_set_enabled(true)`);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}
async function refused(promise, want, m) {
  const got = await code(promise);
  assert(got.includes(want), (m || 'refused') + ': expected ' + want + ', got ' + got);
}
async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function item(db, name, unit = 'pc', kind = 'tool', owner = OWNER) {
  return (await one(db, `insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, $2, $3, $4) returning id`, [owner, name, unit, kind])).id;
}
// A request line for a project, one portion of NOW's batch.
async function request(db, folderId, opts = {}) {
  const batch = (await one(db, `select pr_batch_for($1, now()) b`, [OWNER])).b;
  const req = (await one(db, `insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id)
                               values ($1, $2, $3, $4) returning id`, [OWNER, WORKER, opts.project || folderId, folderId])).id;
  const line = (await one(db, `insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id, kind)
                                values ($1, $2, $3, $4, $5, $6) returning id`,
    [OWNER, req, opts.description || 'Grinder', opts.unit || 'pc', opts.item || null, opts.kind || 'tool'])).id;
  const portion = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, $4) returning id`,
    [OWNER, line, batch, opts.quantity ?? 2])).id;
  return { req, line, portion, batch };
}
function body(lines) {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { source: 'purchasing', purchase_date: TODAY, supplier: 'Wilcon', notes: '', payment_method: 'CASH',
           docs: {}, no_receipt_reason: 'test', receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Tools', unit: 'pc', unplanned_reason: 'needed', ...l })) };
}
async function record(db, b, who = BUYER) {
  await as(db, who);
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [op(), JSON.stringify(b)])).r;
}
async function warehouseBuy(db, name, qty, opts = {}) {
  const line = { destination: 'warehouse', item_name: name, quantity: qty, unit: opts.unit || 'pc', amount: opts.amount || qty * 1000 };
  if (opts.requestLine) { line.request_line_id = opts.requestLine; delete line.unplanned_reason; }
  return (await record(db, body([line]))).purchase_id;
}
async function projectBuy(db, f, name, qty, opts = {}) {
  const line = { folder_id: f, item_name: name, quantity: qty, unit: opts.unit || 'pc', amount: opts.amount || qty * 1000 };
  if (opts.requestLine) {
    line.request_line_id = opts.requestLine; delete line.unplanned_reason;
    if (opts.extra) { line.extra_reason = 'spare'; line.extra_location = 'project'; }
  }
  return (await record(db, body([line]))).purchase_id;
}
const rpc = async (db, who, fn, args) => {
  await as(db, who);
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  return (await one(db, `select ${fn}(${ph}) as r`, args)).r;
};
const j = (o) => JSON.stringify(o);
// An opening register needs a photo (Q7, rev 2): the tests give one unless they say otherwise.
const photoOf = (who) => `tools/${who === OTHER ? OTHER : OWNER}/2026-10/${crypto.randomUUID()}.jpg`;
const register = (db, who, b, opId = op()) => rpc(db, who, 'tl_register',
  [opId, j({ condition: 'good', at: 'warehouse', ...(b.purchase_id || 'photo_path' in b ? {} : { photo_path: photoOf(who) }), ...b })]);
const issue = (db, who, b, opId = op()) => rpc(db, who, 'tl_issue', [opId, j(b)]);
const handover = (db, who, b) => rpc(db, who, 'tl_handover', [op(), j(b)]);
const ret = (db, who, b) => rpc(db, who, 'tl_return', [op(), j({ condition: 'good', ...b })]);
const repaired = (db, who, tool, note = '') => rpc(db, who, 'tl_repaired', [op(), tool, note]);
const lost = (db, who, tool, reason = 'not on site') => rpc(db, who, 'tl_report_lost', [op(), tool, reason]);
const retire = (db, who, tool, reason = 'beyond repair') => rpc(db, who, 'tl_request_retire', [op(), tool, reason]);
const found = (db, who, b) => rpc(db, who, 'tl_found', [op(), j({ condition: 'good', ...b })]);
const decide = (db, who, rec, okay, note = 'checked') => rpc(db, who, 'tl_decide', [op(), rec, okay, note]);
const reverse = (db, who, rec, reason = 'mistake') => rpc(db, who, 'tl_reverse', [op(), rec, reason]);
async function tool(db, id) { return one(db, `select * from tl_tools where id = $1`, [id]); }
async function one1(db, who, b = {}) { return (await register(db, who, b)).tools[0].tool_id; }
async function still(db, line) {
  return num((await one(db, `select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0) s
                               from pr_line_portions p where p.line_id = $1`, [line])).s);
}
async function money(db) {
  return one(db, `select (select count(*) from expenses) n, (select coalesce(sum(amount), 0) s from expenses) s,
                         (select count(*) from payroll) pr, (select count(*) from pur_payments) pay`);
}
async function latestRec(db, toolId) { return (await one(db, `select tl_latest($1) id`, [toolId])).id; }

console.log('\n3a tools (0096 … 0106 + 0107 on PGlite)');

// ── A. The switch, and who ────────────────────────────────────────────
await test('switched off: every write and read refused TOOLS_OFF; the completion and shopping-list helpers answer empty', async () => {
  const db = await fresh({ on: false });
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  await refused(register(db, OWNER, { item_id: g }), 'TOOLS_OFF');
  await refused(rpc(db, STAFF, 'tl_overview', []), 'TOOLS_OFF');
  await refused(rpc(db, STAFF, 'tl_choices', []), 'TOOLS_OFF');
  eq((await rpc(db, OWNER, 'tl_status', [])).enabled, false);
  eq(await rpc(db, OWNER, 'tl_project_out', [f]), []);
  eq(await rpc(db, BUYER, 'tl_line_tools', ['{}']), {});
  eq(num((await one(db, `select count(*) n from tl_tools`)).n), 0);
});
await test('only the main owner switches tools on or off; each change is in the history; off refuses writes and undoes nothing', async () => {
  const db = await fresh({ on: false });
  for (const who of [STAFF, EXPOWNER, BUYER]) await refused(rpc(db, who, 'tl_set_enabled', [true]), 'O', who + ' switched tools');
  eq(num((await one(db, `select count(*) n from tl_settings`)).n), 0);
  await rpc(db, OWNER, 'tl_set_enabled', [true]);
  await rpc(db, OWNER, 'tl_set_enabled', [true]);              // no change, no second event
  const g = await item(db, 'Grinder');
  const t = await one1(db, STAFF, { item_id: g });
  await rpc(db, OWNER, 'tl_set_enabled', [false]);
  await refused(issue(db, OWNER, { tool_id: t, holder_id: WORKER, folder_id: await folder(db, 'X') }), 'TOOLS_OFF');
  eq((await tool(db, t)).state, 'available', 'the tool stays');
  eq((await all(db, `select detail ->> 'enabled' e from tl_events where kind = 'switched' order by id`)).map(r => r.e), ['true', 'false']);
});
await test('who records: owner and office staff allowed Expenses; never workers, team leaders or a PM-only account', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  for (const who of [OWNER, STAFF, BUYER]) await one1(db, who, { item_id: g });
  await refused(register(db, EXPOWNER, { item_id: g }), 'TOOLS_OFF', 'an account with its own scope records there, where tools are off');
  await refused(register(db, WORKER, { item_id: g }), 'NOT_OFFICE');
  await refused(register(db, LEADER, { item_id: g }), 'NOT_OFFICE');
  await refused(register(db, PMSTAFF, { item_id: g }), 'NOT_ALLOWED');
  await refused(rpc(db, WORKER, 'tl_overview', []), 'NOT_ALLOWED');
  await refused(rpc(db, PMSTAFF, 'tl_overview', []), 'NOT_ALLOWED');
});
await test('another company sees none of these tools and cannot touch them', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const t = await one1(db, OWNER, { item_id: g });
  await as(db, OTHER);
  await db.query(`select tl_set_enabled(true)`);
  eq((await rpc(db, OTHER, 'tl_overview', [])).tools, []);
  await refused(rpc(db, OTHER, 'tl_tool', [t]), 'NOT_FOUND');
  await refused(issue(db, OTHER, { tool_id: t, holder_id: OTHERW, folder_id: await folder(db, 'Far', { owner: OTHER }) }), 'NOT_FOUND');
  await refused(register(db, OTHER, { item_id: g }), 'BAD_ITEM', 'another company\'s catalogue item');
});

// ── B. Registering ────────────────────────────────────────────────────
await test('numbers: TOOL-0001… per company, several at once, never reused — not even after a cancelled registration', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const r = await register(db, STAFF, { item_id: g, count: 3, details: 'Makita 9553' });
  eq(r.tools.map(x => x.number), [1, 2, 3]);
  eq((await rpc(db, STAFF, 'tl_tool', [r.tools[0].tool_id])).label, 'TOOL-0001');
  await reverse(db, STAFF, await latestRec(db, r.tools[2].tool_id), 'registered twice');
  eq((await tool(db, r.tools[2].tool_id)).state, 'cancelled');
  eq((await register(db, STAFF, { item_id: g })).tools[0].number, 4, 'TOOL-0003 is never reused');
  eq((await rpc(db, STAFF, 'tl_overview', [])).tools.map(x => x.label), ['TOOL-0001', 'TOOL-0002', 'TOOL-0004'], 'a cancelled tool is not listed');
  await as(db, OTHER); await db.query(`select tl_set_enabled(true)`);
  const og = await item(db, 'Drill', 'pc', 'tool', OTHER);
  eq((await register(db, OTHER, { item_id: og })).tools[0].number, 1, 'each company counts from 1');
  await refused(register(db, STAFF, { item_id: g, count: 0 }), 'BAD_QUANTITY');
  await refused(register(db, STAFF, { item_id: g, count: 51 }), 'BAD_QUANTITY');
  await refused(register(db, STAFF, { item_id: g, count: 'two' }), 'BAD_QUANTITY');
});
await test('at a project a tool always has a named responsible person (rev 2): anyone active in the company (T1 = C) — never a client, a partner, a deactivated account or another company', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  await refused(register(db, STAFF, { item_id: g, at: f }), 'PERSON_REQUIRED');
  await refused(register(db, STAFF, { item_id: g, at: f, holder_id: '' }), 'PERSON_REQUIRED');
  for (const who of [CLIENT, PARTNER, GONE, OTHERW, OTHER]) await refused(register(db, STAFF, { item_id: g, at: f, holder_id: who }), 'BAD_PERSON', who);
  for (const who of [WORKER, LEADER, STAFF, BUYER, OWNER, EXPOWNER]) {
    const t = await tool(db, await one1(db, STAFF, { item_id: g, at: f, holder_id: who }));
    eq([t.state, t.holder_id], ['issued', who], who + ' can hold a tool');
  }
  const out = (await rpc(db, STAFF, 'tl_overview', [])).out.map(x => x.holder_name).sort();
  eq(out, ['Ana', 'Juan', 'Lito', 'Mark', 'admin', 'admin-exp'], 'office accounts by their name or e-mail, the crew by theirs');
  await refused(register(db, STAFF, { item_id: g, at: await folder(db, 'Done', { completed: true }), holder_id: WORKER }), 'PROJECT_COMPLETED');
  await refused(register(db, STAFF, { item_id: g, at: 'somewhere' }), 'BAD_PROJECT');
  const t = await tool(db, await one1(db, STAFF, { item_id: g, at: f, holder_id: LEADER }));
  eq([t.state, t.holder_id, t.folder_id], ['issued', LEADER, f]);
  eq(num((await one(db, `select count(*) n from tl_tools where state = 'issued' and (holder_id is null or folder_id is null)`)).n), 0);
  await refused(db.query(`update tl_tools set holder_id = null where id = $1`, [t.id]), 'check', 'the table refuses it too');
});
await test('the item must be an active TOOL item; a condition the server knows', async () => {
  const db = await fresh();
  const cement = await item(db, 'Cement', 'bag', 'material');
  await refused(register(db, STAFF, { item_id: cement }), 'NOT_A_TOOL');
  const old = await item(db, 'Old saw');
  await db.query(`update pr_catalog_items set active = false where id = $1`, [old]);
  await refused(register(db, STAFF, { item_id: old }), 'BAD_ITEM');
  const g = await item(db, 'Grinder');
  eq((await tool(db, await one1(db, STAFF, { item_id: g, condition: 'needs_repair' }))).state, 'repair');
  eq((await tool(db, await one1(db, STAFF, { item_id: g, condition: 'missing_parts' }))).condition, 'missing_parts');
  await refused(register(db, STAFF, { item_id: g, condition: 'broken' }), 'BAD_CONDITION');
  await refused(register(db, STAFF, { item_id: g, details: 'x'.repeat(201) }), 'BAD_NOTE');
});
await test('the opening register needs a photo of the tool (Q7, rev 2); one from a purchase line does not', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  for (const none of [null, '', '   ']) await refused(register(db, STAFF, { item_id: g, photo_path: none }), 'PHOTO_REQUIRED', String(none));
  await refused(register(db, STAFF, { item_id: g, at: f, holder_id: WORKER, photo_path: null }), 'PHOTO_REQUIRED', 'at a project too');
  eq(num((await one(db, `select count(*) n from tl_tools`)).n), 0, 'nothing registered');
  const r = await register(db, STAFF, { item_id: g, count: 2 });
  const ps = (await all(db, `select photo_path from tl_tools order by number`)).map(x => x.photo_path);
  assert(ps[0] && ps[0] === ps[1], 'several identical tools share the one photo: ' + ps);
  eq(r.tools.length, 2);
  const pp = await projectBuy(db, f, 'Grinder', 1);
  eq((await tool(db, await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 }))).photo_path, null, 'from a purchase: optional');
});
await test('a tool already damaged beyond repair (rev 2): registered at the warehouse, Under repair, with a Retire request for the owner; never at a project', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  await refused(register(db, STAFF, { item_id: g, condition: 'damaged', at: f, holder_id: WORKER }), 'DAMAGED_AT_PROJECT');
  const r = await register(db, STAFF, { item_id: g, condition: 'damaged', count: 2, note: 'motor burnt' });
  for (const x of r.tools) {
    const t = await tool(db, x.tool_id);
    eq([t.state, t.condition], ['retire_pending', 'damaged'], 'waiting for the owner');
    const rec = await one(db, `select kind, status, note, before ->> 'state' b from tl_records where id = $1`, [x.retire_record_id]);
    eq([rec.kind, rec.status, rec.note, rec.b], ['retire', 'pending', 'motor burnt', 'repair']);
    await refused(issue(db, STAFF, { tool_id: x.tool_id, holder_id: WORKER, folder_id: f }), 'NOT_AVAILABLE');
  }
  await decide(db, OWNER, r.tools[0].retire_record_id, true);
  eq((await tool(db, r.tools[0].tool_id)).state, 'retired', 'confirmed: retired');
  await decide(db, OWNER, r.tools[1].retire_record_id, false, 'worth fixing');
  eq((await tool(db, r.tools[1].tool_id)).state, 'repair', 'rejected: Under repair, never Available');
  await repaired(db, STAFF, r.tools[1].tool_id);
  eq((await tool(db, r.tools[1].tool_id)).state, 'available');
  eq((await rpc(db, STAFF, 'tl_overview', [])).pending, [], 'nothing left waiting');
  await refused(reverse(db, STAFF, (await one(db, `select id from tl_records where tool_id = $1 and kind = 'register'`, [r.tools[0].tool_id])).id), 'LATER_RECORDS',
    'the registration of a decided tool stands');
  const pp = await projectBuy(db, f, 'Grinder', 1);
  eq((await tool(db, (await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, condition: 'damaged' })).tools[0].tool_id)).state,
     'retire_pending', 'from a purchase line too (at the warehouse)');
});
await test('a photo is a file of this company\'s tools folder', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const ok = `tools/${OWNER}/2026-10/11111111-2222-4333-8444-555555555555.jpg`;
  eq((await tool(db, await one1(db, STAFF, { item_id: g, photo_path: ok }))).photo_path, ok);
  for (const bad of [`tools/${OTHER}/2026-10/11111111-2222-4333-8444-555555555555.jpg`, `purchases/${OWNER}/2026-10/11111111-2222-4333-8444-555555555555.jpg`,
                     'https://x.test/a.jpg', `tools/${OWNER}/2026-10/../a.jpg`]) {
    await refused(register(db, STAFF, { item_id: g, photo_path: bad }), 'BAD_PHOTO', bad);
  }
});
await test('from a purchase line: never more than it bought; a warehouse line\'s tools start at the warehouse; a project line\'s there or with someone on that project', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House'), f2 = await folder(db, 'Shop');
  const wp = await warehouseBuy(db, 'Grinder', 2);
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1, count: 3 }), 'MORE_THAN_BOUGHT');
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1, at: f, holder_id: WORKER }), 'BAD_PLACE');
  await register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1, count: 2 });
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1 }), 'MORE_THAN_BOUGHT');
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 9 }), 'NOT_FOUND');
  const pp = await projectBuy(db, f, 'Grinder', 2);
  await refused(register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, at: f2, holder_id: WORKER }), 'BAD_PLACE');
  const t = await tool(db, await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, at: f, holder_id: WORKER }));
  eq([t.state, t.purchase_id, t.line_no], ['issued', pp, 1]);
  eq((await tool(db, await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 }))).state, 'available');
});
await test('"Tools to register": tool lines (bought for a tool request, or with tools from them), until all are registered', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const pp = await projectBuy(db, f, 'Grinder', 2, { requestLine: rq.line });
  await warehouseBuy(db, 'Cement', 5, { unit: 'bag' });             // not a tool line
  let ov = await rpc(db, STAFF, 'tl_overview', []);
  eq(ov.to_register.map(l => [l.item_name, num(l.quantity), l.registered, l.suggested_item_id]), [['Grinder', 2, 0, g]]);
  await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 });
  ov = await rpc(db, STAFF, 'tl_overview', []);
  eq(ov.to_register.map(l => l.registered), [1]);
  await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 });
  eq((await rpc(db, STAFF, 'tl_overview', [])).to_register, [], 'all registered');
  const free = await warehouseBuy(db, 'Drill', 2);                   // an unlinked line becomes a tool line once a tool is registered from it
  eq((await rpc(db, STAFF, 'tl_overview', [])).to_register, []);
  await register(db, STAFF, { item_id: g, purchase_id: free, line_no: 1 });
  eq((await rpc(db, STAFF, 'tl_overview', [])).to_register.map(l => l.registered), [1]);
});

// ── C. Tools are never quantity stock (Q6) ────────────────────────────
await test('a tool item is never stock: no match, opening, count or move of it (TOOL_ITEM)', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const wp = await warehouseBuy(db, 'Grinder', 2);
  await refused(rpc(db, STAFF, 'stk_match', [op(), wp, 1, g, '2', null]), 'TOOL_ITEM');
  await refused(rpc(db, STAFF, 'stk_opening', [op(), j({ item_id: g, at: 'warehouse', quantity: '2', on: TODAY })]), 'TOOL_ITEM');
  await refused(rpc(db, STAFF, 'stk_count', [op(), j({ item_id: g, at: 'warehouse', counted: '0', on: TODAY })]), 'TOOL_ITEM');
  // There is never any of it to move.
  await refused(rpc(db, STAFF, 'stk_move', [op(), j({ item_id: g, from: 'warehouse', to: f, quantity: '1', on: TODAY, unplanned_reason: 'x' })]), 'NOT_ENOUGH');
  eq(num((await one(db, `select (select count(*) from stk_matches) + (select count(*) from stk_lots) + (select count(*) from stk_records) n`)).n), 0);
});
await test('a line bought for a tool request never becomes stock (leftovers refused); a warehouse line leaves Receiving once tools are registered from it, and never becomes stock', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const pp = await projectBuy(db, f, 'Grinder', 2, { requestLine: rq.line });
  await refused(rpc(db, STAFF, 'stk_leftover', [op(), pp, 1, '1', 'site', TODAY, '']), 'TOOL_ITEM', 'auto-matched to the tool item');
  eq((await rpc(db, STAFF, 'stk_overview', [])).awaiting, [], 'a project line is never in Receiving');
  const free = await warehouseBuy(db, 'Drill', 3);
  eq((await rpc(db, STAFF, 'stk_overview', [])).awaiting.length, 1, 'an unlinked line is (it may be anything)');
  await register(db, STAFF, { item_id: g, purchase_id: free, line_no: 1 });
  eq((await rpc(db, STAFF, 'stk_overview', [])).awaiting, [], 'until a tool is registered from it');
  await refused(rpc(db, BUYER, 'stk_receive', [op(), free, 1, '1', TODAY, '']), 'TOOL_LINE');
  const mat = await item(db, 'Drill bits', 'pc', 'material');
  await refused(rpc(db, STAFF, 'stk_match', [op(), free, 1, mat, '3', null]), 'TOOL_LINE');
});
await test('a line already received as stock cannot have tools registered from it (LINE_IS_STOCK)', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const wp = await warehouseBuy(db, 'Grinder', 2);
  await rpc(db, BUYER, 'stk_receive', [op(), wp, 1, '1', TODAY, '']);   // unmatched receipt: recorded in line units
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1 }), 'LINE_IS_STOCK');
});
await test('purchase guards: a correction may not drop below the tools registered from a line, nor void the purchase (TOOLS_IN_USE) — until those are cancelled', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const pp = await projectBuy(db, f, 'Grinder', 2);
  const r = await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, count: 2 });
  const fix = (qty) => body([{ folder_id: f, item_name: 'Grinder', quantity: qty, unit: 'pc', amount: qty * 1000 }]);
  await refused(rpc(db, OWNER, 'pur_correct', [op(), pp, j(fix(1)), 'counted wrong']), 'TOOLS_IN_USE');
  await rpc(db, OWNER, 'pur_correct', [op(), pp, j(fix(3)), 'one more']);     // keeping enough is fine
  await refused(rpc(db, OWNER, 'pur_void', [op(), pp, 'wrong supplier']), 'TOOLS_IN_USE');
  for (const x of r.tools) await reverse(db, STAFF, await latestRec(db, x.tool_id), 'not ours');
  await rpc(db, OWNER, 'pur_correct', [op(), pp, j(fix(1)), 'counted wrong']);
  eq((await one(db, `select status from purchases where id = $1`, [pp])).status, 'recorded');
});
await test('a catalogue item used by a tool keeps its kind and unit (ITEM_IN_USE)', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  await one1(db, STAFF, { item_id: g });
  await refused(db.query(`update pr_catalog_items set kind = 'material' where id = $1`, [g]), 'ITEM_IN_USE');
  await refused(db.query(`update pr_catalog_items set unit = 'set' where id = $1`, [g]), 'ITEM_IN_USE');
});

// ── D. Custody ────────────────────────────────────────────────────────
await test('issue: only an Available tool, to a named person on a project that is not completed', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t = await one1(db, STAFF, { item_id: g });
  await refused(issue(db, STAFF, { tool_id: t, folder_id: f }), 'PERSON_REQUIRED');
  await refused(issue(db, STAFF, { tool_id: t, holder_id: OTHERW, folder_id: f }), 'BAD_PERSON');
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: await folder(db, 'Done', { completed: true }) }), 'PROJECT_COMPLETED');
  const parent = await folder(db, 'Closed', { completed: true });
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: await folder(db, 'Extra', { parent }) }), 'PROJECT_COMPLETED', 'a job under a completed project');
  await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, note: 'for the tiles' });
  eq([(await tool(db, t)).state, (await tool(db, t)).holder_id], ['issued', WORKER]);
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: f }), 'NOT_AVAILABLE', 'twice');
  const rp = await one1(db, STAFF, { item_id: g, condition: 'needs_repair' });
  await refused(issue(db, STAFF, { tool_id: rp, holder_id: WORKER, folder_id: f }), 'NOT_AVAILABLE', 'under repair');
});
await test('handover: person to person (and project to project), never through the warehouse; staying on a completed project is fine', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House'), f2 = await folder(db, 'Shop');
  const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER }), 'SAME_HOLDER');
  await handover(db, STAFF, { tool_id: t, holder_id: WORKER2 });
  eq([(await tool(db, t)).holder_id, (await tool(db, t)).folder_id], [WORKER2, f], 'same project');
  await handover(db, STAFF, { tool_id: t, holder_id: LEADER, folder_id: f2 });
  eq([(await tool(db, t)).holder_id, (await tool(db, t)).folder_id], [LEADER, f2]);
  await db.query(`update folders set completed_at = now() where id = $1`, [f2]);
  await handover(db, STAFF, { tool_id: t, holder_id: WORKER });                  // stays on the completed project
  await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: await folder(db, 'Old', { completed: true }) }), 'PROJECT_COMPLETED');
  await refused(handover(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g }), holder_id: WORKER }), 'NOT_ISSUED');
  const h = await rpc(db, STAFF, 'tl_tool', [t]);
  eq(h.records.map(r => r.kind), ['handover', 'handover', 'handover', 'register']);
  eq(h.records[0].from_holder_name, 'Lito');
});
await test('return with its condition: good → Available; needs repair or missing parts → Under repair; then Repaired → Available', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  for (const [cond, state] of [['good', 'available'], ['needs_repair', 'repair'], ['missing_parts', 'repair']]) {
    const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
    const r = await ret(db, STAFF, { tool_id: t, condition: cond, note: 'back' });
    eq([(await tool(db, t)).state, (await tool(db, t)).condition], [state, cond], cond);
    const rec = await one(db, `select holder_id, folder_id from tl_records where id = $1`, [r.record_id]);
    eq([rec.holder_id, rec.folder_id], [WORKER, f], 'the return keeps who had it');
    if (state === 'repair') {
      await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f }), 'NOT_AVAILABLE');
      await repaired(db, STAFF, t, 'new brushes');
      eq([(await tool(db, t)).state, (await tool(db, t)).condition], ['available', 'good']);
    }
  }
  await refused(ret(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g }) }), 'NOT_ISSUED');
  await refused(ret(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER }), condition: 'broken' }), 'BAD_CONDITION');
  await refused(repaired(db, STAFF, await one1(db, STAFF, { item_id: g })), 'NOT_IN_REPAIR');
});

await test('registered at a project needing repair or missing parts (rev 3): kept with its person and project, NOT usable — no handover until Repaired there; then handed over', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House'), f2 = await folder(db, 'Shop');
  for (const cond of ['needs_repair', 'missing_parts']) {
    const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER, condition: cond });
    let row = await tool(db, t);
    eq([row.state, row.holder_id, row.folder_id, row.condition], ['issued', WORKER, f, cond], cond + ': with its person, on its project');
    await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2 }), 'NEEDS_REPAIR', cond + ': no handover before repair');
    await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: f2 }), 'NEEDS_REPAIR', cond + ': nor onto another project');
    await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: f }), 'NOT_AVAILABLE', cond + ': never issued again');
    row = await tool(db, t);
    eq([row.state, row.holder_id, row.folder_id], ['issued', WORKER, f], cond + ': the refusals moved nothing');
    await db.query(`update tl_tools set since = now() - interval '4 days' where id = $1`, [t]);
    const before = await tool(db, t);
    await repaired(db, STAFF, t, 'new switch');
    row = await tool(db, t);
    eq([row.state, row.holder_id, row.folder_id, row.condition, new Date(row.since).getTime()],
       ['issued', WORKER, f, 'good', new Date(before.since).getTime()], cond + ': repaired where it is — same person, project and days out');
    eq((await rpc(db, STAFF, 'tl_tool', [t])).days, 4);
    const h = await rpc(db, STAFF, 'tl_tool', [t]);
    eq([h.records[0].kind, h.records[0].holder_name, h.records[0].folder_name], ['repaired', 'Mark', 'House']);
    await handover(db, STAFF, { tool_id: t, holder_id: WORKER2 });
    row = await tool(db, t);
    eq([row.state, row.holder_id, row.folder_id], ['issued', WORKER2, f], cond + ': handed over after repair');
  }
  // Returned before it was repaired: back at the warehouse, Under repair.
  const t2 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER, condition: 'needs_repair' });
  await ret(db, STAFF, { tool_id: t2, condition: 'needs_repair' });
  eq([(await tool(db, t2)).state, (await tool(db, t2)).holder_id], ['repair', null], 'a return is always allowed');
  // A good issued tool is not "repaired"; reversing a repair puts it back as it was.
  const t3 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await refused(repaired(db, STAFF, t3), 'NOT_IN_REPAIR', 'an issued tool in good condition');
  const t4 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER, condition: 'missing_parts' });
  await repaired(db, STAFF, t4);
  await reverse(db, STAFF, await latestRec(db, t4), 'parts not fitted yet');
  eq([(await tool(db, t4)).condition, (await tool(db, t4)).state, (await tool(db, t4)).holder_id], ['missing_parts', 'issued', WORKER], 'reversed: as before');
  await refused(handover(db, STAFF, { tool_id: t4, holder_id: WORKER2 }), 'NEEDS_REPAIR', 'and not usable again');
});

// ── E. The owner: Lost and Retire (Q16–Q17, rev 2) ────────────────────
await test('returned damaged beyond repair → Retire waits for the main owner; meanwhile it cannot be issued, handed over or returned', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  const r = await ret(db, STAFF, { tool_id: t, condition: 'damaged', note: 'motor burnt' });
  eq((await tool(db, t)).state, 'retire_pending');
  const rec = await one(db, `select kind, status, before ->> 'state' b, after ->> 'state' a from tl_records where id = $1`, [r.retire_record_id]);
  eq([rec.kind, rec.status, rec.b, rec.a], ['retire', 'pending', 'repair', 'retired']);
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f }), 'NOT_AVAILABLE');
  await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2 }), 'NOT_ISSUED');
  await refused(ret(db, STAFF, { tool_id: t }), 'NOT_ISSUED');
  await refused(repaired(db, STAFF, t), 'NOT_IN_REPAIR');
  eq((await rpc(db, STAFF, 'tl_overview', [])).pending.map(p => p.kind), ['retire']);
});
await test('the owner REJECTS a retire request → Under repair, never straight to Available; CONFIRMS → Retired for good', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const t = await one1(db, STAFF, { item_id: g, condition: 'needs_repair' });
  let req = await retire(db, STAFF, t, 'cracked housing');
  eq((await tool(db, t)).state, 'retire_pending');
  await refused(decide(db, OWNER, req.record_id, false, ''), 'REASON_REQUIRED', 'a rejection needs a reason');
  await decide(db, OWNER, req.record_id, false, 'a new housing is cheap');
  eq((await tool(db, t)).state, 'repair');
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: await folder(db, 'H') }), 'NOT_AVAILABLE');
  req = await retire(db, STAFF, t, 'housing out of stock');
  await decide(db, OWNER, req.record_id, true);
  eq((await tool(db, t)).state, 'retired');
  await refused(decide(db, OWNER, req.record_id, true), 'BAD_STATE');
  await refused(reverse(db, OWNER, req.record_id), 'BAD_STATE', 'a confirmed retirement is final');
  await refused(retire(db, STAFF, await one1(db, STAFF, { item_id: g })), 'NOT_IN_REPAIR', 'only an Under-repair tool');
});
await test('Lost: waits for the main owner; REJECTED → exactly where it was (same person, project and since); CONFIRMED → Lost, who had it kept; Found → back', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await db.query(`update tl_tools set since = now() - interval '5 days' where id = $1`, [t]);
  const before = await tool(db, t);
  let rep = await lost(db, STAFF, t, 'not on site Friday');
  let now = await tool(db, t);
  eq([now.state, now.holder_id, now.folder_id], ['lost_pending', WORKER, f], 'who had it stays recorded');
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: f }), 'NOT_AVAILABLE');
  await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2 }), 'NOT_ISSUED');
  await refused(ret(db, STAFF, { tool_id: t }), 'NOT_ISSUED');
  await refused(lost(db, STAFF, t), 'BAD_STATE', 'reported twice');
  await decide(db, OWNER, rep.record_id, false, 'it is at the other site');
  now = await tool(db, t);
  eq([now.state, now.holder_id, now.folder_id, new Date(now.since).getTime()], ['issued', WORKER, f, new Date(before.since).getTime()], 'exactly as before');
  eq((await rpc(db, STAFF, 'tl_tool', [t])).days, 5, 'still out 5 days, not since the report');
  rep = await lost(db, STAFF, t, 'gone');
  await decide(db, OWNER, rep.record_id, true, 'police report filed');
  now = await tool(db, t);
  eq([now.state, now.holder_id], ['lost', WORKER]);
  await refused(reverse(db, OWNER, rep.record_id), 'BAD_STATE', 'a confirmed loss is not reversed — it is Found');
  await refused(found(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g }) }), 'NOT_LOST');
  await found(db, STAFF, { tool_id: t, condition: 'missing_parts', note: 'in the truck' });
  eq([(await tool(db, t)).state, (await tool(db, t)).holder_id], ['repair', null]);
  const t2 = await one1(db, STAFF, { item_id: g });
  await decide(db, OWNER, (await lost(db, STAFF, t2)).record_id, true);
  await found(db, STAFF, { tool_id: t2 });
  eq((await tool(db, t2)).state, 'available', 'found in good condition');
});
await test('a rejected Lost report of a warehouse or Under-repair tool puts it back there too', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  for (const cond of ['good', 'needs_repair']) {
    const t = await one1(db, STAFF, { item_id: g, condition: cond });
    const want = (await tool(db, t)).state;
    await decide(db, OWNER, (await lost(db, STAFF, t)).record_id, false, 'counted again');
    eq((await tool(db, t)).state, want);
  }
});
await test('only the main owner decides; the office withdraws its own request (same as a rejection); others cannot', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  const rep = await lost(db, STAFF, t);
  for (const who of [STAFF, BUYER]) await refused(decide(db, who, rep.record_id, true), 'OWNER_ONLY', who);
  await refused(decide(db, EXPOWNER, rep.record_id, true), 'TOOLS_OFF', 'another scope');
  await refused(reverse(db, BUYER, rep.record_id, 'not mine'), 'NOT_YOURS');
  await refused(reverse(db, STAFF, rep.record_id, ''), 'REASON_REQUIRED');
  await reverse(db, STAFF, rep.record_id, 'it turned up next day');
  eq([(await tool(db, t)).state, (await tool(db, t)).holder_id], ['issued', WORKER]);
  eq((await one(db, `select status from tl_records where id = $1`, [rep.record_id])).status, 'withdrawn');
  const t2 = await one1(db, STAFF, { item_id: g, condition: 'needs_repair' });
  const rq = await retire(db, BUYER, t2);
  await reverse(db, OWNER, rq.record_id, 'repair it');               // the main owner may withdraw anyone's
  eq((await tool(db, t2)).state, 'repair');
  eq((await all(db, `select kind from tl_events where kind <> 'switched' order by id`)).map(r => r.kind), ['withdrawn', 'withdrawn']);
});

// ── F. Requests: one tool fills a line once (Q14, rev 2–3) ─────────────
await test('a warehouse tool NOT bought for the line fills it; a return and a handover keep it filled; reversing that issue reopens it by one', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const t = await one1(db, STAFF, { item_id: g });
  eq(await still(db, rq.line), 2);
  const is = await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
  eq([is.fills_request, is.bought_for_request], [true, false]);
  eq(await still(db, rq.line), 1);
  const shown = await rpc(db, BUYER, 'tl_line_tools', [`{${rq.line}}`]);
  eq([shown[rq.line].tools.map(x => [x.label, x.counted]), num(shown[rq.line].filled), num(shown[rq.line].portions[rq.portion])],
     [[['TOOL-0001', true]], 1, 1], 'the shopping list: issued, filled 1 in its weekly portion');
  for (const who of [WORKER, LEADER, PMSTAFF]) eq(await rpc(db, who, 'tl_line_tools', [`{${rq.line}}`]), {}, who + ' reads no tools');
  await handover(db, STAFF, { tool_id: t, holder_id: WORKER2 });
  eq(await still(db, rq.line), 1, 'a handover keeps it filled');
  const back = await ret(db, STAFF, { tool_id: t });
  eq(await still(db, rq.line), 1, 'a return keeps it filled');
  await refused(reverse(db, STAFF, is.record_id), 'LATER_RECORDS');
  await reverse(db, STAFF, back.record_id);
  await reverse(db, STAFF, (await one(db, `select id from tl_records where tool_id = $1 and kind = 'handover'`, [t])).id);
  await reverse(db, STAFF, is.record_id, 'issued to the wrong request');
  eq(await still(db, rq.line), 2, 'reopened by exactly that tool');
  eq([num((await one(db, `select pr_line_bought($1) b`, [rq.line])).b), num((await one(db, `select pr_line_from_tools($1) b`, [rq.line])).b)], [0, 0],
     'the line\'s figure too');
  eq((await tool(db, t)).state, 'available');
});
await test('a tool BOUGHT for the line and issued for it counts once; reversing that issue keeps the line filled through its purchase (rev 3)', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 1 });
  const pp = await projectBuy(db, f, 'Grinder', 1, { requestLine: rq.line });
  eq(await still(db, rq.line), 0, 'bought');
  const t = await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 });
  const is = await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
  eq([is.fills_request, is.bought_for_request], [false, true]);
  eq(await still(db, rq.line), 0, 'still 0 — never below');
  eq(num((await one(db, `select pr_line_bought($1) b`, [rq.line])).b), 1, 'filled once, not twice');
  eq(num((await one(db, `select count(*) n from tl_covers`)).n), 0);
  const shown = await rpc(db, BUYER, 'tl_line_tools', [`{${rq.line}}`]);
  eq([shown[rq.line].tools.map(x => [x.label, x.holder_name, x.counted]), num(shown[rq.line].filled), shown[rq.line].portions],
     [[['TOOL-0001', 'Mark', false]], 0, {}], 'issued, but counted through its purchase');
  await reverse(db, STAFF, is.record_id, 'not yet handed out');
  eq(await still(db, rq.line), 0, 'stays filled through the purchase');
  eq(num((await one(db, `select pr_line_bought($1) b`, [rq.line])).b), 1);
});
await test('a line bought 3 for a request of 2 (1 extra): its first 2 tools count through the purchase; the extra cannot fill the line again', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const pp = await projectBuy(db, f, 'Grinder', 3, { requestLine: rq.line, extra: true });
  eq(await still(db, rq.line), 0);
  const r = await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, count: 3 });
  const go = (x, line) => issue(db, STAFF, { tool_id: x.tool_id, holder_id: WORKER, folder_id: f, request_line_id: line });
  eq([(await go(r.tools[0], rq.line)).fills_request, (await go(r.tools[1], rq.line)).fills_request], [false, false]);
  await refused(go(r.tools[2], rq.line), 'REQUEST_EXCEEDED', 'the extra would count twice');
  eq(num((await one(db, `select pr_line_bought($1) b`, [rq.line])).b), 2, 'filled 2, never 3');
  await go(r.tools[2], null);                                      // issued without a request: fine
  const other = await request(db, f, { item: g, quantity: 1 });
  const t4 = await one1(db, STAFF, { item_id: g });
  eq((await go({ tool_id: t4 }, other.line)).fills_request, true, 'a tool not bought for that line counts on its own');
});
await test('the request link: a TOOL line of that project, open, of the same item and unit', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder'), d = await item(db, 'Drill');
  const f = await folder(db, 'House'), f2 = await folder(db, 'Shop');
  const t = await one1(db, STAFF, { item_id: g });
  const go = (line, folderId = f) => issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: folderId, request_line_id: line });
  await refused(go((await request(db, f, { kind: 'material', unit: 'pc' })).line), 'NOT_A_TOOL_LINE');
  await refused(go((await request(db, f2, { item: g })).line), 'BAD_REQUEST_LINK');
  await refused(go((await request(db, f, { item: d })).line), 'ITEM_MISMATCH');
  await refused(go((await request(db, f, { unit: 'set' })).line), 'UNIT_MISMATCH');
  const closed = await request(db, f, { item: g });
  await db.query(`update pr_lines set status = 'cancelled' where id = $1`, [closed.line]);
  await refused(go(closed.line), 'LINE_CLOSED');
  await refused(go('not-a-uuid'), 'BAD_REQUEST_LINK');
  eq((await tool(db, t)).state, 'available', 'nothing was issued');
  const open = await request(db, f, { item: null, quantity: 1 });      // a line naming no catalogue item: any grinder
  await go(open.line);
  eq(await still(db, open.line), 0);
});
await test('Request lines to fill: open tool lines of the project with what is still to fill', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  await request(db, f, { kind: 'material', unit: 'bag', description: 'Cement' });
  const lines = await rpc(db, STAFF, 'tl_request_lines', [f]);
  eq(lines.map(l => [l.description, num(l.still_to_buy)]), [['Grinder', 2]]);
  eq(lines[0].line_id, rq.line);
});

// ── G. Reversals, history and retries ─────────────────────────────────
await test('reverse: only the tool\'s latest record, by whoever recorded it or an owner; a registration reversed → cancelled and the line freed', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const wp = await warehouseBuy(db, 'Grinder', 1);
  const t = await one1(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1 });
  const is = await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f });
  await refused(reverse(db, STAFF, (await one(db, `select id from tl_records where tool_id = $1 and kind = 'register'`, [t])).id), 'LATER_RECORDS');
  await refused(reverse(db, BUYER, is.record_id), 'NOT_YOURS');
  await reverse(db, OWNER, is.record_id, 'an owner may');
  await refused(reverse(db, STAFF, is.record_id), 'BAD_STATE', 'twice');
  await reverse(db, STAFF, await latestRec(db, t), 'registered from the wrong line');
  eq((await tool(db, t)).state, 'cancelled');
  await register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1 });   // the line's place is free again
});
await test('history cannot be edited: events, request fills, records and tools are never deleted or changed directly', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 1 });
  const t = await one1(db, STAFF, { item_id: g });
  await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
  for (const sql of [`update tl_events set reason = 'x'`, `delete from tl_events`, `update tl_covers set quantity = 2`,
                     `delete from tl_covers`, `delete from tl_records`, `delete from tl_tools`]) {
    await refused(db.query(sql), 'HISTORY_IMMUTABLE', sql);
  }
});
await test('the same press twice records once (the first answer, replayed); a cancelled operation id is refused', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const id = op();
  const a = await register(db, STAFF, { item_id: g, count: 2 }, id);
  const b = await register(db, STAFF, { item_id: g, count: 5 }, id);       // a changed form under the same id
  eq([b.replayed, b.tools.length], [true, 2]);
  eq(num((await one(db, `select count(*) n from tl_tools`)).n), 2);
  const iid = op();
  await issue(db, STAFF, { tool_id: a.tools[0].tool_id, holder_id: WORKER, folder_id: f }, iid);
  await issue(db, STAFF, { tool_id: a.tools[0].tool_id, holder_id: WORKER, folder_id: f }, iid);
  eq(num((await one(db, `select count(*) n from tl_records where kind = 'issue'`)).n), 1);
  const cid = op();
  await as(db, STAFF);
  eq((await one(db, `select pur_op_cancel($1) r`, [cid])).r, 'cancelled');
  await refused(issue(db, STAFF, { tool_id: a.tools[1].tool_id, holder_id: WORKER, folder_id: f }, cid), 'OP_CANCELLED');
  eq((await tool(db, a.tools[1].tool_id)).state, 'available');
});

// ── H. Reading ────────────────────────────────────────────────────────
await test('the Tools screen: tools, tools out longest first with days, what waits for the owner; one tool\'s whole history', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t1 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER, details: 'Makita' });
  const t2 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER2 });
  await db.query(`update tl_tools set since = now() - interval '9 days' where id = $1`, [t2]);
  await lost(db, STAFF, await one1(db, STAFF, { item_id: g }));
  const ov = await rpc(db, STAFF, 'tl_overview', []);
  eq(ov.out.map(x => [x.label, x.holder_name, x.folder_name, x.days]), [['TOOL-0002', 'Rey', 'House', 9], ['TOOL-0001', 'Mark', 'House', 0]]);
  eq(ov.pending.map(p => [p.kind, p.label]), [['lost', 'TOOL-0003']]);
  eq(ov.tools.map(x => x.state), ['issued', 'issued', 'lost_pending']);
  const one_ = await rpc(db, STAFF, 'tl_tool', [t1]);
  eq([one_.details, one_.item_name, one_.records.length, one_.records[0].kind, one_.records[0].latest], ['Makita', 'Grinder', 1, 'register', true]);
});
await test('choices: tool items only; everyone active in the company, the crew with their teams; projects with completed marked', async () => {
  const db = await fresh();
  await item(db, 'Grinder'); await item(db, 'Cement', 'bag', 'material');
  const team = (await one(db, `insert into pr_teams (owner_id, name) values ($1, 'Masons') returning id`, [OWNER])).id;
  await db.query(`insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values ($1, $2, $3, true)`, [OWNER, team, LEADER]);
  await folder(db, 'House'); await folder(db, 'Done', { completed: true });
  const ch = await rpc(db, STAFF, 'tl_choices', []);
  eq(ch.items.map(i => i.name), ['Grinder']);
  eq(ch.people.map(p => [p.name, p.role, p.teams]), [['admin', 'owner', []], ['admin-exp', 'owner', []], ['Ana', 'staff', []], ['Juan', 'staff', []],
    ['Lito', 'teamLeader', ['Masons']], ['Mark', 'worker', []], ['Pia', 'staff', []], ['Rey', 'worker', []]],
    'everyone active in the company (T1 = C); no client, partner, deactivated account or other company');
  eq(ch.projects.map(p => [p.name, p.completed]), [['Done', true], ['House', false]]);
});
await test('tools out on a project and its Additional Works jobs, for Mark as Complete; empty while off or for an account that cannot record', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const aw = await folder(db, 'Garage', { parent: f });
  await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await one1(db, STAFF, { item_id: g, at: aw, holder_id: WORKER2 });
  await one1(db, STAFF, { item_id: g, at: await folder(db, 'Shop'), holder_id: WORKER2 });
  const out = await rpc(db, OWNER, 'tl_project_out', [f]);
  eq(out.map(x => [x.label, x.holder_name, x.folder_name]), [['TOOL-0001', 'Mark', 'House'], ['TOOL-0002', 'Rey', 'House — Garage']]);
  eq(await rpc(db, PMSTAFF, 'tl_project_out', [f]), []);
  await rpc(db, OWNER, 'tl_set_enabled', [false]);
  eq(await rpc(db, OWNER, 'tl_project_out', [f]), []);
});
await test('no money anywhere: a whole flow writes no expense, payroll or payment, and no answer carries a peso amount', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const pp = await projectBuy(db, f, 'Grinder', 1, { requestLine: rq.line });
  const before = await money(db);
  const t = await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 });
  await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
  await handover(db, STAFF, { tool_id: t, holder_id: WORKER2 });
  await ret(db, STAFF, { tool_id: t, condition: 'damaged' });
  const t2 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await decide(db, OWNER, (await lost(db, STAFF, t2)).record_id, true);
  eq(await money(db), before);
  const texts = [j(await rpc(db, STAFF, 'tl_overview', [])), j(await rpc(db, STAFF, 'tl_tool', [t])), j(await rpc(db, STAFF, 'tl_choices', [])),
                 j(await rpc(db, STAFF, 'tl_request_lines', [f])), j(await rpc(db, OWNER, 'tl_project_out', [f]))];
  for (const s of texts) assert(!/amount|price|cost|gross|₱|peso/i.test(s), 'money in an answer: ' + s.slice(0, 200));
});

// ── I. What 0107 changes elsewhere, and who may call what ─────────────
await test('stk_overview is 0104\'s, word for word, but for leaving tool lines out of Receiving', async () => {
  const mine = fnText(M107, 'stk_overview');
  const theirs = fnText(M104, 'stk_overview');
  eq(mine.replace("\n                    and not tl_tool_line(l)", ''), theirs);
  assert(mine.includes('and not tl_tool_line(l)'), 'the one change');
  const fresh_ = fnText(M107, 'pr_item_in_use');
  eq(fresh_.replace("\n      or exists (select 1 from tl_tools t where t.item_id = p_item)", ''), fnText(M104, 'pr_item_in_use'));
});
await test('covered = purchases + stock + tools, everywhere 0097 counts Still to buy', async () => {
  eq(fnText(M107, 'pr_portion_bought').includes('pr_portion_purchased(p_portion) + pr_portion_from_stock(p_portion) + pr_portion_from_tools(p_portion)'), true);
  eq(fnText(M107, 'pr_line_bought').includes('pr_line_purchased(p_line) + pr_line_from_stock(p_line) + pr_line_from_tools(p_line)'), true);
});
await test('grants: every tl_ operation and reader is for signed-in users only; every helper for no one', async () => {
  const db = await fresh();
  const can = async (role, fn) => (await one(db, `select has_function_privilege($1, $2, 'execute') x`, [role, fn])).x;
  const open = ['tl_status()', 'tl_set_enabled(boolean)', 'tl_register(uuid,jsonb)', 'tl_issue(uuid,jsonb)', 'tl_handover(uuid,jsonb)',
                'tl_return(uuid,jsonb)', 'tl_repaired(uuid,uuid,text)', 'tl_report_lost(uuid,uuid,text)', 'tl_request_retire(uuid,uuid,text)',
                'tl_found(uuid,jsonb)', 'tl_decide(uuid,uuid,boolean,text)', 'tl_reverse(uuid,uuid,text)', 'tl_overview()', 'tl_tool(uuid)',
                'tl_choices()', 'tl_request_lines(uuid)', 'tl_project_out(uuid)', 'tl_line_tools(uuid[])', 'stk_overview()'];
  for (const fn of open) {
    eq([await can('authenticated', fn), await can('anon', fn)], [true, false], fn);
  }
  const names = (await all(db, `select p.oid::regprocedure::text f
                                  from pg_proc p where p.proname like 'tl\\_%' or p.proname in ('pr_portion_from_tools', 'pr_line_from_tools')`)).map(r => r.f);
  const internal = names.filter(n => !open.some(o => o.split('(')[0] === n.split('(')[0]));
  assert(internal.length >= 25, 'helpers found: ' + internal.length);
  for (const fn of internal) eq([await can('authenticated', fn), await can('anon', fn)], [false, false], fn);
});

// ── J. The live acceptance script ─────────────────────────────────────
const ACCEPT = read(path.join(ROOT, 'supabase/tests/3a_acceptance.sql'));
// Supabase's auth.uid() reads the JWT claims, as the script sets them; live
// profiles have created_at, and the main owner is the oldest owner account.
async function acceptancePrep(db) {
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as
                   $$ select coalesce(nullif(current_setting('test.uid', true), ''),
                                      nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
                 alter table profiles add column if not exists created_at timestamptz not null default now();
                 update profiles set created_at = now() + interval '1 hour' where id <> '${OWNER}';
                 select set_config('test.uid', '', false);`);
}
async function acceptanceDb() {
  const db = await fresh({ on: false });
  await folder(db, 'Barlin');
  await request(db, await folder(db, 'Prado'), { quantity: 1, kind: 'material', unit: 'bag', description: 'Cement' });
  await acceptancePrep(db);
  return db;
}
await test('the live acceptance script (3a_acceptance.sql) passes as written, tools off, and leaves nothing behind', async () => {
  const db = await acceptanceDb();
  const count = () => one(db, `select (select count(*) from tl_tools) t, (select count(*) from tl_records) r, (select count(*) from tl_settings) s,
                                      (select count(*) from pr_catalog_items) i, (select count(*) from pur_ops) o`);
  const before = await count();
  const res = await db.exec(ACCEPT);
  assert(res.some(x => (x.rows || []).some(r => r.result === '3a acceptance: all checks passed')), 'the success row');
  eq(await count(), before, 'all rolled back');
});
await test('the acceptance script fails when it should: tools already on, a function open to anon, a helper open, no person check, a tool item taken as stock, no opening photo check', async () => {
  for (const [why, spoil, want] of [
    ['tools already switched on', async (db) => { await as(db, OWNER); await db.query(`select tl_set_enabled(true)`); await as(db, ''); }, 'A1'],
    ['tl_tool open to anon', (db) => db.exec(`grant execute on function tl_tool(uuid) to anon`), 'B1'],
    ['tl_write open to signed-in users', (db) => db.exec(`grant execute on function tl_write(uuid, tl_tools, text, text, jsonb, jsonb) to authenticated`), 'B2'],
    ['a project registration without a person accepted', (db) => {
      const fn = fnText(M107, 'tl_person');
      const a = "  if p_person is null then\n    raise exception 'PERSON_REQUIRED' using errcode = 'P0001';\n  end if;\n";
      assert(fn.split(a).length === 2, 'the person check is in tl_person once');
      return db.exec(fn.replace(a, ''));
    }, 'D1'],
    ['a tool item taken as stock', (db) => db.exec(`drop trigger tl_no_tool_stock on stk_records`), 'D9'],
    ['an opening register without a photo accepted', (db) => {
      const fn = fnText(M107, 'tl_register');
      const a = "  if v_purchase is null and v_photo is null then\n    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';\n  end if;\n";
      assert(fn.split(a).length === 2, 'the photo check is in tl_register once');
      return db.exec(fn.replace(a, ''));
    }, 'D1b'],
  ]) {
    const db = await acceptanceDb();
    await spoil(db);
    await refused(db.exec(ACCEPT), want, why);
  }
});

// ── K. The pilot's guarded clean-up (3a_pilot_cleanup.sql) ──────────
const CLEAN = read(path.join(ROOT, 'supabase/tests/3a_pilot_cleanup.sql'));
async function stubs(db) {
  await db.exec(`
    create table if not exists construction_projects (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete set null);
    create table if not exists wp_tasks (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id), work_folder_id uuid references folders(id));
    create table if not exists wp_blockers (id uuid primary key default gen_random_uuid(), request_id uuid references pr_requests(id));
    create table if not exists overhead_expenses (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade,
      billing_period_id uuid references projects(id) on delete set null, amount numeric);
    create table if not exists reimbursements (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
    create table if not exists labor_contracts (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
    create table if not exists pr_line_conflicts (id uuid primary key default gen_random_uuid(), line_id uuid references pr_lines(id));
    create table if not exists pr_item_refs (id uuid primary key default gen_random_uuid(), catalog_item_id uuid references pr_catalog_items(id),
      folder_id uuid references folders(id) on delete cascade);
    create table if not exists pr_gallery_photos (id uuid primary key default gen_random_uuid(), catalog_item_id uuid references pr_catalog_items(id));`);
}
const cleanup = (db, real = false) => {
  if (!real) return db.exec(CLEAN);
  const run = CLEAN.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;');
  assert(run !== CLEAN, 'the setting line is in the file');
  return db.exec(run);
};
async function period(db, folderId, budget = 100000) {
  const d = new Date(TODAY + 'T00:00:00Z');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, $3, $4, 'progress', 1) returning id`, [OWNER, folderId, months[d.getUTCMonth()], d.getUTCFullYear()])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, OWNER, budget]);
  return id;
}
async function snapshot(db) {
  return one(db, `select (select count(*) from folders) folders, (select count(*) from projects) periods,
                         (select count(*) from pr_catalog_items) items, (select count(*) from purchases) purchases,
                         (select count(*) from expenses) exp_n, (select coalesce(sum(amount), 0) from expenses) exp_sum,
                         (select count(*) from pr_requests) requests, (select count(*) from tl_tools) tools, (select count(*) from tl_records) tool_recs,
                         (select count(*) from tl_covers) covers, (select count(*) from tl_events) events`);
}
// A whole ZZ pilot (Q24) beside real data: real tools on a real project first.
async function pilot() {
  const db = await fresh();
  await stubs(db);
  const real = await folder(db, 'House'); await period(db, real);
  const drill = await item(db, 'Drill');
  const realReq = await request(db, real, { item: drill, quantity: 1, description: 'Drill' });
  const realPur = await projectBuy(db, real, 'Drill', 1, { requestLine: realReq.line });
  const realTool = await one1(db, STAFF, { item_id: drill, purchase_id: realPur, line_no: 1 });
  await issue(db, STAFF, { tool_id: realTool, holder_id: WORKER, folder_id: real, request_line_id: realReq.line });
  const real2 = await one1(db, STAFF, { item_id: drill, at: real, holder_id: WORKER2 });
  const A = await folder(db, 'ZZ 3a pilot A'); await period(db, A);
  const job = await folder(db, 'ZZ 3a pilot A — extra room', { parent: A });
  const B = await folder(db, 'ZZ 3a pilot B'); await period(db, B);
  const g = await item(db, 'ZZ 3a grinder');
  const req = await request(db, A, { item: g, quantity: 2, description: 'ZZ 3a grinder' });
  const pur = await projectBuy(db, A, 'ZZ 3a grinder', 1, { requestLine: req.line });
  const t1 = await one1(db, STAFF, { item_id: g, purchase_id: pur, line_no: 1 });
  await issue(db, STAFF, { tool_id: t1, holder_id: WORKER, folder_id: A, request_line_id: req.line });
  await handover(db, STAFF, { tool_id: t1, holder_id: WORKER2, folder_id: job });
  const back = await ret(db, STAFF, { tool_id: t1, condition: 'damaged' });
  await decide(db, OWNER, back.retire_record_id, false, 'repair');
  const t2 = await one1(db, STAFF, { item_id: g });
  await issue(db, STAFF, { tool_id: t2, holder_id: LEADER, folder_id: B, request_line_id: null });
  await decide(db, OWNER, (await lost(db, STAFF, t2)).record_id, false, 'on site');
  const t3 = await one1(db, STAFF, { item_id: g, at: A, holder_id: WORKER, condition: 'missing_parts' });
  await issue(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g }), holder_id: WORKER, folder_id: A, request_line_id: req.line });
  // The live pilot's slip: a tool registered on an older pilot's "ZZ pilot drill" (the item stays, its tools go).
  const old = await item(db, 'ZZ pilot drill');
  await one1(db, STAFF, { item_id: old, condition: 'damaged' });
  await as(db, '');
  return { db, real, A, B, job, g, drill, req, realReq, realTool, real2, t1, t2, t3, pur };
}
await test('the pilot clean-up: the dry run changes nothing; the real run removes only ZZ — real tools, purchases, expenses and requests stay; guards back on', async () => {
  const p = await pilot();
  const db = p.db;
  const before = await snapshot(db);
  const realBefore = await all(db, `select id, number, state, holder_id from tl_tools where id in ($1, $2) order by number`, [p.realTool, p.real2]);
  const stillReal = await still(db, p.realReq.line);
  await refused(cleanup(db), 'DRY RUN OK', 'the dry run');
  eq(await snapshot(db), before, 'nothing changed');
  await cleanup(db, true);
  eq(num((await one(db, `select count(*) n from folders where name like 'ZZ 3a%'`)).n), 0);
  eq(num((await one(db, `select count(*) n from pr_catalog_items where name like 'ZZ 3a%'`)).n), 0);
  eq(num((await one(db, `select count(*) n from pr_catalog_items where name = 'ZZ pilot drill'`)).n), 1, 'the older pilot item kept');
  eq(await all(db, `select id, number, state, holder_id from tl_tools order by number`), realBefore, 'the real tools, numbers and holders kept');
  eq(num((await one(db, `select count(*) n from tl_records`)).n), 3, 'their 3 records');
  eq(await still(db, p.realReq.line), stillReal, 'the real request as it was');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 1, 'the real purchase stays');
  eq(num((await one(db, `select count(*) n from tl_events where kind = 'switched'`)).n), 1, 'the switch\'s history stays');
  eq(num((await one(db, `select count(*) n from pg_trigger where tgname in ('tl_events_no_change', 'tl_covers_no_change',
      'tl_records_no_delete', 'tl_tools_no_delete') and tgenabled = 'O'`)).n), 4, 'guards back on');
  await refused(db.query(`delete from tl_tools`), 'HISTORY_IMMUTABLE', 'and they hold');
  await refused(cleanup(db), 'no project named', 'a second run finds nothing');
});
await test('the clean-up stops (and changes nothing) when ZZ and real tools are mixed', async () => {
  for (const [why, spoil, want] of [
    ['a ZZ tool handed over onto a real project', (p) => handover(p.db, STAFF, { tool_id: p.t2, holder_id: WORKER, folder_id: p.real }), 'a ZZ tool was recorded on a real project'],
    ['a real tool issued on a ZZ project', async (p) => { await ret(p.db, STAFF, { tool_id: p.real2 });
      await issue(p.db, STAFF, { tool_id: p.real2, holder_id: WORKER, folder_id: p.A }); }, 'a real tool was recorded on a ZZ project'],
    ['a real tool filling a ZZ request', async (p) => {
      const t = await one1(p.db, STAFF, { item_id: p.drill });
      const r2 = await request(p.db, p.A, { quantity: 1, description: 'Any tool' });
      await issue(p.db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: p.A, request_line_id: r2.line }); }, 'a real tool was recorded on a ZZ project'],
    ['a ZZ tool registered as a real item from a ZZ purchase', async (p) => {
      const zp = await projectBuy(p.db, p.A, 'ZZ 3a level', 1);
      await register(p.db, STAFF, { item_id: p.drill, purchase_id: zp, line_no: 1 }); }, 'registered as a real catalogue item'],
  ]) {
    const p = await pilot();
    await spoil(p);
    await as(p.db, '');
    const before = await snapshot(p.db);
    await refused(cleanup(p.db, true), want, why);
    eq(await snapshot(p.db), before, why + ': nothing changed');
  }
});

// ── L. 0108 (TF1): the crew by name and worker number, everywhere Tools names a person ──
if (WITH_0108) {
  const numbered = async () => {
    const db = await fresh();
    await db.exec(`update profiles set worker_no = 7 where id = '${WORKER}';
                   update profiles set worker_no = 21 where id = '${LEADER}';
                   update profiles set worker_no = 5 where id = '${OWNER}';
                   insert into profiles (id, role, owner_id, status, display_name, worker_no)
                     values ('00000000-0000-0000-0000-0000000000d9', 'worker', '${OWNER}', 'active', '  ', 9);`);
    return db;
  };
  await test('0108: a named worker or team leader reads "Name (W-0007)"; one with no name stays "W-0009"; office and owner unchanged', async () => {
    const db = await numbered();
    const ch = await rpc(db, STAFF, 'tl_choices', []);
    eq(ch.people.map(p => p.name), ['admin', 'admin-exp', 'Ana', 'Juan', 'Lito (W-0021)', 'Mark (W-0007)', 'Pia', 'Rey', 'W-0009'],
       'a number on an owner account is not shown; a worker with no number keeps the name alone');
  });
  await test('0108: the numbered name is on the tool, its records, the Out list, Mark as Complete and the shopping list', async () => {
    const db = await numbered();
    const g = await item(db, 'Grinder');
    const f = await folder(db, 'House');
    const rq = await request(db, f, { item: g, quantity: 1, description: 'Grinder' });
    const t = await one1(db, STAFF, { item_id: g });
    await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
    await handover(db, STAFF, { tool_id: t, holder_id: LEADER, folder_id: f });
    const one_ = await rpc(db, STAFF, 'tl_tool', [t]);
    eq(one_.holder_name, 'Lito (W-0021)');
    eq(one_.records.filter(r => r.kind !== 'register').map(r => [r.kind, r.holder_name, r.from_holder_name]),
       [['handover', 'Lito (W-0021)', 'Mark (W-0007)'], ['issue', 'Mark (W-0007)', null]]);
    eq((await rpc(db, STAFF, 'tl_overview', [])).out.map(x => x.holder_name), ['Lito (W-0021)']);
    eq((await rpc(db, OWNER, 'tl_project_out', [f])).map(x => x.holder_name), ['Lito (W-0021)']);
    eq((await rpc(db, BUYER, 'tl_line_tools', [`{${rq.line}}`]))[rq.line].tools.map(x => x.holder_name), ['Mark (W-0007)'],
       'the shopping list names whom it was issued to for the line');
  });
  await test('0108 changes tl_person_name alone, and only for the crew; nobody may call it', async () => {
    const mine = fnText(M108, 'tl_person_name');
    const theirs = fnText(M107, 'tl_person_name');
    eq(mine.replace(`
                   || case when nullif(btrim(p.display_name), '') is not null and p.worker_no is not null
                           then ' (W-' || lpad(p.worker_no::text, 4, '0') || ')' else '' end`, '')
           .replace(`case when p.role in ('worker', 'teamLeader')
              then pr_person_name(p.id)
              else`, `case when p.role in ('worker', 'teamLeader') then pr_person_name(p.id) else`),
       theirs);
    eq((M108.match(/create or replace function/g) || []).length, 1, 'one function');
    const db = await fresh();
    for (const role of ['authenticated', 'anon']) {
      eq((await one(db, `select has_function_privilege($1, 'tl_person_name(uuid)', 'execute') x`, [role])).x, false, role);
    }
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
