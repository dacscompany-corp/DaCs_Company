// ════════════════════════════════════════════════════════════════════
// ITEM HISTORY READINESS — THE PILOT CLOSE SCRIPT ON PGLITE
//   npm run test:sql
//
// Runs supabase/tests/item_history_pilot_close.sql, unchanged, against an
// exact copy of the live Requests pilot records (ih_pilot_records.json,
// exported read-only on 29 Oct 2026) on PGlite, with the real office
// functions it calls (0086, 0088, 0090, 0097, 0104, 0107 — lifted verbatim).
// Proves: its expectations are the exported records; the dry run changes
// nothing; the real run makes exactly the intended changes and no worker then
// finds a test item; and any changed record is refused with nothing changed.
// Nothing here talks to the live database.
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
const tableText = (src, name) => {
  const m = src.match(new RegExp('create table if not exists ' + name + ' \\([\\s\\S]*?\\n\\);'));
  if (!m) throw new Error('table ' + name + ' not found');
  return m[0];
};
const M02 = mig('0002_rls.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
const M85 = mig('0085_workmate_requests.sql');
const M86 = mig('0086_workmate_requests_office.sql');
const M88 = mig('0088_pr_worker_cancel_alignment.sql');
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
const SCRIPT = read(path.join(ROOT, 'supabase/tests/item_history_pilot_close.sql'));
const REC = JSON.parse(read(path.join(ROOT, 'supabase/tests/ih_pilot_records.json')));
const real = () => {
  const s = SCRIPT.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;');
  if (s === SCRIPT) throw new Error('the setting line is not in the script');
  return s;
};

// The 3a suite's base (auth.uid() also reads the JWT claims the script sets).
const BASE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('test.uid', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
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
// What the script reads beyond the 3a base: 0085's project switches and conflicts, 0090's history (tables and
// readers), the office operations it calls, and the Work Plan blocker table (its one column that matters).
const HISTORY = `
alter table pr_catalog_items add column if not exists created_at timestamptz not null default now();
alter table pr_lines add column if not exists ref_kind text;
alter table pr_lines add column if not exists ref_id uuid;
${tableText(M85, 'pr_project_settings')}
alter table pr_project_settings add column if not exists allow_history boolean not null default false;
${tableText(M85, 'pr_line_conflicts')}
alter table pr_photos add column if not exists gallery_review text;
alter table pr_photos add column if not exists gallery_reviewed_by uuid references profiles(id);
alter table pr_photos add column if not exists gallery_reviewed_at timestamptz;
${tableText(M90, 'pr_item_refs')}
${tableText(M90, 'pr_gallery_photos')}
create table if not exists wp_blockers (id uuid primary key default gen_random_uuid(), request_id uuid references pr_requests(id));
${fnText(M90, 'pr_history_open')}
${fnText(M90, 'pr_history_entries')}
${fnText(M90, 'pr_entry_label')}
${fnText(M90, 'pr_history_search_doc')}
${fnText(M90, 'pr_history_visible')}
${fnText(M86, 'pr_office_match_item')}
${fnText(M88, 'pr_office_cancel_line')}
`;

const OWNER = REC.owner;
const W7 = REC.pilots[0].id, W19 = REC.pilots[1].id, W21 = REC.pilots[2].id;
const W27 = '00000000-0000-0000-0000-000000000027';   // another active worker — not in the pilots
const BARLIN = REC.barlin;
const TEST_ITEMS = REC.test_items;

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function refused(p, want, why) {
  let msg = null;
  try { await p; } catch (e) { msg = e.message; }
  assert(msg !== null, (why || 'expected a refusal') + ': it ran');
  assert(msg.includes(want), (why || '') + ': expected "' + want + '", got "' + msg + '"');
  return msg;
}

// The live pilot records, exactly, on the real functions.
async function copy() {
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
  await db.exec(M108);
  await db.exec(HISTORY);
  const q = (sql, params) => db.query(sql, params);
  await q(`insert into profiles (id, role, owner_id, status) values ($1, 'owner', null, 'active')`, [OWNER]);
  await q(`update profiles set email = 'admin@dacs.test' where id = $1`, [OWNER]);
  for (const p of REC.pilots) {
    await q(`insert into profiles (id, role, owner_id, status, worker_no) values ($1, $2, $3, 'active', $4)`, [p.id, p.role, OWNER, p.worker_no]);
  }
  await q(`insert into profiles (id, role, owner_id, status, worker_no) values ($1, 'worker', $2, 'active', 27)`, [W27, OWNER]);
  for (const [n, s] of REC.settings.entries()) {
    await q(`insert into folders (id, owner_id, name) values ($1, $2, $3)`, [s.folder_id, OWNER, s.folder_id === BARLIN ? 'Barlin Residence' : 'Project ' + n]);
    await q(`insert into pr_project_settings (folder_id, owner_id, allow_requests, allow_history, updated_by) values ($1, $2, $3, $4, $2)`,
      [s.folder_id, OWNER, s.allow_requests, s.allow_history]);
  }
  for (const b of REC.batches) {
    await q(`insert into pr_batches (id, owner_id, cutoff_at, purchase_on, delivery_on) values ($1, $2, $3, $4, $5)`,
      [b.id, OWNER, b.cutoff_at, b.purchase_on, b.delivery_on]);
  }
  for (const i of REC.items) {
    await q(`insert into pr_catalog_items (id, owner_id, name, kind, spec, unit, category, active, aliases, brand, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [i.id, OWNER, i.name, i.kind, i.spec, i.unit, i.category, i.active, i.aliases, i.brand, i.created_at]);
  }
  for (const r of REC.requests) {
    await q(`insert into pr_requests (id, owner_id, requester_id, team_id, folder_id, work_folder_id, client_op_id, drafted_at, received_at,
             status, cancelled_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [r.id, OWNER, r.requester_id, r.team_id, r.folder_id, r.work_folder_id, r.client_op_id, r.drafted_at, r.received_at, r.status, r.cancelled_at]);
    await q(`insert into pr_events (owner_id, request_id, actor_id, kind) values ($1, $2, $3, 'submitted')`, [OWNER, r.id, r.requester_id]);
  }
  for (const l of REC.lines) {
    await q(`insert into pr_lines (id, owner_id, request_id, position, kind, catalog_item_id, description, spec, unit, status, version,
             ref_kind, ref_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [l.id, OWNER, l.request_id, l.position, l.kind, l.catalog_item_id, l.description, l.spec, l.unit, l.status, l.version,
       l.ref_kind, l.ref_id, l.created_at]);
  }
  for (const p of REC.portions) {
    await q(`insert into pr_line_portions (id, owner_id, line_id, batch_id, quantity, arranged_at, arranged_by, pending_reduction, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [p.id, OWNER, p.line_id, p.batch_id, p.quantity, p.arranged_at, p.arranged_by, p.pending_reduction, p.created_at]);
  }
  const requester = (rid) => REC.requests.find(r => r.id === rid).requester_id;
  for (const p of REC.photos) {
    await q(`insert into pr_photos (id, owner_id, request_id, line_id, storage_path, uploaded_by, gallery_review) values ($1, $2, $3, $4, $5, $6, $7)`,
      [p.id, OWNER, p.request_id, p.line_id, p.storage_path, requester(p.request_id), p.gallery_review]);
  }
  for (const r of REC.refs) {
    await q(`insert into pr_item_refs (id, owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision,
             source_note, created_by, created_at, retired_by, retired_at, retire_reason) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $2, $10, $2, $11, $12)`,
      [r.id, OWNER, r.catalog_item_id, r.folder_id, r.work_folder_id, r.description, r.ref_date, r.date_precision, r.source_note,
       r.created_at, r.retired_at, r.retire_reason]);
  }
  for (const g of REC.gallery) {
    await q(`insert into pr_gallery_photos (id, owner_id, catalog_item_id, storage_path, source, source_photo_id, is_cover, status,
             checklist_confirmed, approved_by, approved_at, retired_by, retired_at, retire_reason)
             values ($1, $2, $3, $4, $5, $6, $7, $8, true, $2, $9, $10, $11, $12)`,
      [g.id, OWNER, g.catalog_item_id, g.storage_path, g.source, g.source_photo_id, g.is_cover, g.status, g.approved_at,
       g.retired_at ? OWNER : null, g.retired_at, g.retire_reason]);
  }
  for (const c of REC.conflicts) {
    await q(`insert into pr_line_conflicts (id, owner_id, line_id, proposed_by, base_version, current_version, proposed_quantity, current_quantity)
             values ($1, $2, $3, $4, 1, 2, 1, 1)`, [c.id, OWNER, c.line_id, W7]);
  }
  for (const b of REC.blockers) await q(`insert into wp_blockers (id, request_id) values ($1, $2)`, [b.id, b.request_id]);
  return db;
}

// Everything the script could touch, in one value.
async function fingerprint(db) {
  const parts = [];
  for (const [t, order] of [['pr_requests', 'id'], ['pr_lines', 'id'], ['pr_line_portions', 'id'], ['pr_events', 'id'],
                            ['pr_catalog_items', 'id'], ['pr_project_settings', 'folder_id'], ['pr_photos', 'id'], ['pr_item_refs', 'id'],
                            ['pr_gallery_photos', 'id'], ['wp_blockers', 'id'], ['pr_line_conflicts', 'id']]) {
    parts.push((await one(db, `select md5(coalesce(jsonb_agg(to_jsonb(t) order by ${order})::text, '')) h from ${t} t`)).h);
  }
  return parts.join('');
}
async function workerSees(db, worker) {
  return (await one(db, `select pr_history_search_doc($1, $2, false, null, null, null, null, null, null, 50, 0) d`, [OWNER, worker])).d.items
    .map(x => x.name).sort();
}
async function phoneKeeps(db, worker) {
  await db.exec(`select set_config('test.uid', '${worker}', false)`);
  const v = (await one(db, `select pr_history_visible($1::uuid[]) v`, ['{' + TEST_ITEMS.join(',') + '}'])).v;
  await db.exec(`select set_config('test.uid', '', false)`);
  return v.map(x => x.item_id);
}

console.log('\nItem history readiness — the pilot close script (0085 … 0108 on PGlite, the live pilot records)');

await test('the script expects exactly the exported records (one source: ih_pilot_records.json)', async () => {
  const lit = JSON.parse(SCRIPT.split('$exp$')[1]);
  const tests = new Set(REC.test_items);
  eq(lit.requests, REC.requests.map(r => ({ id: r.id, requester_id: r.requester_id, folder_id: r.folder_id, work_folder_id: r.work_folder_id,
    status: r.status, received_at: r.received_at, cancelled_at: r.cancelled_at })), 'requests');
  eq(lit.lines, REC.lines.map(l => ({ id: l.id, request_id: l.request_id, position: l.position, kind: l.kind, description: l.description,
    spec: l.spec, unit: l.unit, status: l.status, catalog_item_id: l.catalog_item_id, version: l.version, needed: l.needed })), 'lines');
  eq(lit.portions, REC.portions.map(p => ({ id: p.id, line_id: p.line_id, batch_id: p.batch_id, quantity: p.quantity,
    pending_reduction: p.pending_reduction, arranged: p.arranged_at !== null })), 'portions');
  eq(lit.items, REC.items.filter(i => tests.has(i.id)).map(i => ({ id: i.id, name: i.name, kind: i.kind, spec: i.spec, unit: i.unit,
    category: i.category, active: i.active })), 'items');
  eq([lit.requests.length, lit.lines.length, lit.portions.length, lit.items.length], [17, 20, 7, 3]);
  eq(lit.portions.filter(p => p.arranged).map(p => p.quantity), [5], 'one arranged portion, 5 pc');
});

await test('before: workers find only the three test items; the phone keeps them', async () => {
  const db = await copy();
  eq(await workerSees(db, W27), ['RAM', 'ZZ pilot drill', 'ZZ test pipe'], 'any worker — through Barlin, history on');
  eq((await phoneKeeps(db, W7)).length, 3, 'pr_history_visible keeps all three for W-0007');
});

await test('the dry run passes every guard on the exact copy and changes nothing', async () => {
  const db = await copy();
  const before = await fingerprint(db);
  const msg = await refused(db.exec(SCRIPT), 'DRY RUN OK (nothing changed)', 'the dry run');
  assert(msg.includes('7 open lines cancelled') && msg.includes('15 catalogue matches removed') && msg.includes('28 history events')
         && msg.includes('0 pilot portions left'), msg);
  eq(await fingerprint(db), before, 'nothing changed');
});

await test('the real run makes exactly the intended changes; no worker finds a test item; the phone forgets them; history kept', async () => {
  const db = await copy();
  const ev0 = Number((await one(db, `select count(*) n from pr_events`)).n);
  await db.exec(real());
  eq(Number((await one(db, `select count(*) n from pr_requests where status = 'cancelled'`)).n), 17, 'all 17 cancelled, none deleted');
  eq(Number((await one(db, `select count(*) n from pr_lines`)).n), 20, 'the 20 lines kept');
  eq(Number((await one(db, `select count(*) n from pr_lines where status = 'open' or catalog_item_id = any($1::uuid[])`, ['{' + TEST_ITEMS.join(',') + '}'])).n), 0);
  eq((await all(db, `select description from pr_lines where id = '5683408d-d145-4fd3-aac4-086a395b378e'`)).map(r => r.description), ['ZZ outlet'], 'the worker\'s words kept');
  eq(Number((await one(db, `select count(*) n from pr_events`)).n), ev0 + 28, '28 events');
  eq((await all(db, `select kind, count(*)::int n from pr_events where actor_id = $1 group by kind order by kind`, [OWNER])),
     [{ kind: 'item_matched', n: 15 }, { kind: 'office_line_cancelled', n: 7 }, { kind: 'portion_unarranged', n: 1 }, { kind: 'request_cancelled', n: 5 }]);
  eq((await all(db, `select active from pr_catalog_items where id = any($1::uuid[])`, ['{' + TEST_ITEMS.join(',') + '}'])).map(r => r.active), [false, false, false]);
  eq((await all(db, `select count(*)::int n from pr_catalog_items where active`)).map(r => r.n), [3], 'the three real items still active');
  for (const w of [W7, W19, W21, W27]) {
    eq(await workerSees(db, w), [], 'worker ' + w + ' finds nothing');
    eq(await phoneKeeps(db, w), [], 'the phone clean-up keeps nothing for ' + w);
  }
  eq(Number((await one(db, `select count(*) n from pr_photos`)).n), 4, 'photos kept');
  eq(Number((await one(db, `select count(*) n from pr_item_refs`)).n), 2, 'references kept');
  eq(Number((await one(db, `select count(*) n from pr_gallery_photos`)).n), 10, 'gallery kept');
  eq(Number((await one(db, `select count(*) n from wp_blockers`)).n), 1, 'the blocker kept');
  eq((await all(db, `select allow_requests, allow_history from pr_project_settings where folder_id = $1`, [BARLIN])),
     [{ allow_requests: true, allow_history: true }], 'Barlin\'s switches unchanged');
  const again = await refused(db.exec(SCRIPT), 'GUARD: a request is not as reviewed', 'a second run');
  assert(!again.includes('after'), again);
});

// Every changed record is refused before anything happens, and nothing changes.
const L = (id) => id;   // readability below
const SPOILS = [
  ['a line\'s words changed', `update pr_lines set description = 'ZZ outlet box' where id = '5683408d-d145-4fd3-aac4-086a395b378e'`,
   'GUARD: a line is not as reviewed', '5683408d'],
  ['a line\'s unit changed', `update pr_lines set unit = 'box' where id = '67e2a223-3064-49f1-ae47-15c4c1bede9f'`,
   'GUARD: a line is not as reviewed', '67e2a223'],
  ['a line\'s spec changed', `update pr_lines set spec = '8' where id = '0f204a72-6cb5-4061-b178-71617de1e7b6'`,
   'GUARD: a line is not as reviewed', '0f204a72'],
  ['a line\'s quantity changed (6 → 7)', `update pr_line_portions set quantity = 7 where id = '68a58f43-e00c-435c-b7b1-ddea4c51920a'`,
   'GUARD: a line is not as reviewed', '67e2a223'],
  ['an open line cancelled meanwhile', `update pr_lines set status = 'cancelled' where id = 'f8cd7dd9-4617-4efe-bc9a-6136bbde4b89'`,
   'GUARD: a line is not as reviewed', 'f8cd7dd9'],
  ['a test line matched to a real item', `update pr_lines set catalog_item_id = '86a02de4-db1d-40f2-8868-46686f11abb8' where id = '0f204a72-6cb5-4061-b178-71617de1e7b6'`,
   'GUARD: a line is not as reviewed', '0f204a72'],
  ['an unmatched line matched to a test item', `update pr_lines set catalog_item_id = 'eb89b45d-5af1-4661-bbd6-7bc08ca1a73d' where id = '3d08f1d2-6ff6-4178-858f-e6ecefe5c754'`,
   'GUARD: a line is not as reviewed', '3d08f1d2'],
  ['a line edited and put back (version moved)', `update pr_lines set version = version + 1 where id = 'b003f79b-cfc4-498d-8bc2-0b391d851e02'`,
   'GUARD: a line is not as reviewed', 'b003f79b'],
  ['a line added to a pilot request', `insert into pr_lines (owner_id, request_id, description, unit) values ('${OWNER}', '763ed71c-ccc3-447a-b6d9-e94cdfd757b9', 'ZZ extra', 'pc')`,
   'GUARD: a line is not as reviewed', 'ZZ extra'],
  ['a real line elsewhere matched to a test item', `insert into pr_requests (id, owner_id, requester_id, folder_id, work_folder_id) values ('00000000-0000-0000-0000-0000000000f1', '${OWNER}', '${W27}', '${BARLIN}', '${BARLIN}');
     insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id) values ('${OWNER}', '00000000-0000-0000-0000-0000000000f1', 'pipe', 'pc', 'eb89b45d-5af1-4661-bbd6-7bc08ca1a73d')`,
   'GUARD: a request is not as reviewed', '0000000000f1'],
  ['a new real request', `insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ('${OWNER}', '${W27}', '${BARLIN}', '${BARLIN}')`,
   'GUARD: a request is not as reviewed', ''],
  ['a pilot request cancelled meanwhile', `update pr_requests set status = 'cancelled', cancelled_at = now() where id = 'edc66d2f-cecf-4016-b9a5-e6638ab6d46f'`,
   'GUARD: a request is not as reviewed', 'edc66d2f'],
  ['the arranged portion split 4 + 1 (same total)', `update pr_line_portions set quantity = 4 where id = 'e65f8f0f-9715-496f-be4d-6f923e342b01';
     insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ('${OWNER}', '10128bce-5568-49c0-9052-fe4df4d6cb06', '08c4f2d5-fdeb-4d85-b239-609990d2825a', 1)`,
   'GUARD: a portion is not as reviewed', 'e65f8f0f'],
  ['the arranged portion un-arranged meanwhile', `update pr_line_portions set arranged_at = null, arranged_by = null where id = 'e65f8f0f-9715-496f-be4d-6f923e342b01'`,
   'GUARD: a portion is not as reviewed', 'e65f8f0f'],
  ['a pending reduction (same still-needed)', `update pr_line_portions set quantity = 7, pending_reduction = 1 where id = '68a58f43-e00c-435c-b7b1-ddea4c51920a'`,
   'GUARD: a portion is not as reviewed', '68a58f43'],
  ['a buyer took a portion', `update pr_line_portions set buyer_id = '${OWNER}' where id = '09e0ebc0-5dc3-4aff-94a5-5f1cd51b59c9'`,
   'GUARD: a portion is not as reviewed', '09e0ebc0'],
  ['a test item renamed', `update pr_catalog_items set name = 'ZZ test pipe 2' where id = 'eb89b45d-5af1-4661-bbd6-7bc08ca1a73d'`,
   'GUARD: a test item is not as reviewed', 'ZZ test pipe'],
  ['a test item deactivated already', `update pr_catalog_items set active = false where id = 'fdfaa19d-becc-4ca5-aba0-947d76f3b953'`,
   'GUARD: a test item is not as reviewed', 'RAM'],
];
for (const [why, spoil, want, names] of SPOILS) {
  await test('refused, nothing changed: ' + why, async () => {
    const db = await copy();
    await db.exec(spoil);
    const before = await fingerprint(db);
    for (const run of [SCRIPT, real()]) {
      const msg = await refused(db.exec(run), want, why);
      assert(!msg.includes('GUARD: after'), 'refused before any change: ' + msg);
      assert(msg.includes(names), 'names what differs (' + names + '): ' + msg);
      eq(await fingerprint(db), before, why + ': nothing changed');
    }
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
