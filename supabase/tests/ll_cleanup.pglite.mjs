// ════════════════════════════════════════════════════════════════════
// LINKED LABOR: THE ZZ CLEAN-UP (ll_pilot_cleanup.sql) — TESTS ON PGLITE
//   npm run test:sql
// 0098 and 0113 run VERBATIM over ll_base.mjs, with minimal copies of the other
// live tables the script reads (same foreign keys and delete rules). The ZZ
// data is made through the real functions, so its history is genuine, and it
// sits beside real records — including real rows that look like ZZ ones.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { LL_PRE, LL_TABLES, LL_HELPERS, M98, M113, IDS, seed, ROOT } from './ll_base.mjs';

const I = IDS;
const SCRIPT = fs.readFileSync(path.join(ROOT, 'supabase/tests/ll_pilot_cleanup.sql'), 'utf8').replace(/\r\n/g, '\n');
const REAL_RUN = SCRIPT.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;');
if (REAL_RUN === SCRIPT) throw new Error('the v_dry line was not found');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a).slice(0, 400) + ' !== ' + JSON.stringify(b).slice(0, 400)); }

// The other live tables the script reads, with their real delete rules.
const CLEANUP_TABLES = `
alter table construction_projects add column if not exists folder_id uuid references folders(id) on delete set null;
create table projects (id uuid primary key default gen_random_uuid(), owner_id uuid, folder_id uuid references folders(id) on delete cascade, month text, year text);
alter table payroll add constraint payroll_project_id_fkey foreign key (project_id) references projects(id) on delete cascade;
create table folder_budgets (folder_id uuid primary key references folders(id) on delete cascade, owner_id uuid, total_budget numeric default 0);
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid, monthly_budget numeric default 0);
create table project_control_allocation_policies (folder_id uuid primary key references folders(id) on delete cascade, owner_id uuid);
create table project_control_billing_allocations (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid);
create table billing_allocation_adjustments (id uuid primary key default gen_random_uuid(), owner_id uuid, project_id uuid not null references projects(id) on delete cascade, reason text);
create table expenses (id uuid primary key default gen_random_uuid(), owner_id uuid, folder_id uuid references folders(id) on delete cascade, project_id uuid references projects(id) on delete cascade, amount numeric);
create table overhead_expenses (id uuid primary key default gen_random_uuid(), owner_id uuid, folder_id uuid references folders(id) on delete cascade, billing_period_id uuid references projects(id) on delete set null);
create table reimbursements (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
create table expense_inbox (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
create table additional_works (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
create table pr_requests (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id), work_folder_id uuid references folders(id));
create table purchases (id uuid primary key default gen_random_uuid(), status text);
create table purchase_lines (id uuid primary key default gen_random_uuid(), purchase_id uuid references purchases(id), folder_id uuid);
alter table expenses add column purchase_line_id uuid, add column purchase_charge_id uuid;
create table stk_lots (id uuid primary key default gen_random_uuid(), cost_folder_id uuid);
create table stk_locations (id uuid primary key default gen_random_uuid(), folder_id uuid);
create table stk_records (id uuid primary key default gen_random_uuid(), from_location uuid, to_location uuid);
create table stk_moves (id uuid primary key default gen_random_uuid(), from_location uuid, to_location uuid);
create table stk_cost_moves (id uuid primary key default gen_random_uuid(), location uuid, from_folder uuid, to_folder uuid);
create table wp_tasks (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id), work_folder_id uuid references folders(id));
create table pr_item_refs (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade, work_folder_id uuid references folders(id) on delete cascade);
create table tl_tools (id uuid primary key default gen_random_uuid(), folder_id uuid);
create table tl_records (id uuid primary key default gen_random_uuid(), folder_id uuid);
create table attendance_records (id uuid primary key default gen_random_uuid(), worker_id uuid, timein_folder_id uuid references folders(id) on delete set null, timeout_folder_id uuid references folders(id) on delete set null);
`;
// W-0005 and W-0007, who are "ZZ" linking's only allowed accounts.
const M96 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0096_purchase_recording.sql'), 'utf8').replace(/\r\n/g, '\n');
const PUR_GUARD = M96.match(/create or replace function pur_guard_delete\(\)[\s\S]*?\n\$\$;/)[0] + `
create trigger folders_purchase_delete_guard before delete on folders for each row execute function pur_guard_delete();
create trigger projects_purchase_delete_guard before delete on projects for each row execute function pur_guard_delete();`;
const W5 = '00000000-0000-0000-0000-000000000005', W7 = '00000000-0000-0000-0000-000000000007';
const OLD = '00000000-0000-0000-0000-0000000f00aa';

async function as(db, uid) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false);`);
  if (uid) await db.exec('set role authenticated');
}
async function admin(db) { await db.exec(`reset role; select set_config('test.uid', '', false);`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function rows(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function err(promise) { try { await promise; return 'no error'; } catch (e) { return e.message; } }
const rpc = async (db, uid, sql, params) => { await as(db, uid); try { return (await one(db, sql, params)).r; } finally { await admin(db); } };

async function base() {
  const db = new PGlite();
  await db.exec(LL_PRE);
  await db.exec(LL_TABLES);
  await db.exec(LL_HELPERS);
  await db.exec(CLEANUP_TABLES);
  await db.exec(PUR_GUARD);
  await db.exec(M98);
  await db.exec(M113);
  await seed((sql) => db.exec(sql));
  await db.exec(`insert into profiles (id, role, owner_id, status, display_name, worker_no) values
    ('${W5}', 'worker', '${I.OWNER}', 'active', 'Same Name', 5), ('${W7}', 'worker', '${I.OWNER}', 'active', 'Same Name', 7);`);
  return db;
}
async function folder(db, name, o = {}) {
  await admin(db);
  const f = (await one(db, 'insert into folders (owner_id, name, parent_folder_id) values ($1, $2, $3) returning id', [o.owner || I.OWNER, name, o.parent || null])).id;
  await db.query('insert into folder_budgets (folder_id, owner_id, total_budget) values ($1, $2, 100000)', [f, o.owner || I.OWNER]);
  await db.query('insert into project_control_allocation_policies (folder_id, owner_id) values ($1, $2)', [f, o.owner || I.OWNER]);
  const p = (await one(db, `insert into projects (owner_id, folder_id, month, year) values ($1, $2, 'Nov', '2026') returning id`, [o.owner || I.OWNER, f])).id;
  await db.query('insert into project_budgets (project_id, owner_id, monthly_budget) values ($1, $2, 50000)', [p, o.owner || I.OWNER]);
  await db.query('insert into project_control_billing_allocations (project_id, owner_id) values ($1, $2)', [p, o.owner || I.OWNER]);
  return { f, p };
}
async function contract(db, uid, folderId, name, scope, o = {}) {
  await as(db, uid);
  const r = await one(db, `insert into labor_contracts (owner_id, folder_id, worker_name, scope, agreed_amount, pay_type, status, cap_history,
      category, works, pay_basis, agreement_signed, worker_id)
    values ($1, $2, $3, $4, $5, 'pakyaw', 'ongoing', '[]'::jsonb, 'labor', '[]'::jsonb, 'fixed', false, $6) returning *`,
    [o.owner || I.OWNER, folderId, name, scope, o.amount ?? 10000, o.worker || null]);
  await admin(db);
  return r;
}
async function pay(db, contractId, periodId, amount, o = {}) {
  await admin(db);
  return (await one(db, `insert into payroll (owner_id, worker_name, labor_type, total_salary, payment_date, contract_id, project_id, receipt_images)
    values ($1, 'x', 'direct', $2, '2026-11-08', $3, $4, $5::jsonb) returning id`,
    [I.OWNER, amount, contractId, periodId, JSON.stringify(o.receipts || [])])).id;
}
const link = (db, c, w, no, reason = '') => rpc(db, I.OWNER, 'select lc_link($1, $2, $3, $4) r', [c, w, no, reason]);
const edit = (db, c, ch, reason = '') => rpc(db, I.OWNER, 'select lc_edit($1, $2::jsonb, $3) r', [c, JSON.stringify(ch), reason]);

// Real records, some deliberately looking like the ZZ ones.
async function realWorld(db) {
  const a = await folder(db, 'Alpha House');
  const older = await folder(db, 'ZZ 3b pilot old');                 // ZZ, but not "ZZ LL"
  const c1 = await contract(db, I.OWNER, a.f, 'Juan Cruz', 'Masonry', { amount: 50000 });
  const twin = await contract(db, I.OWNER, a.f, 'ZZ LL Ana', 'Real job, same typed name as a ZZ contract');
  const c3 = await contract(db, I.STAFF, older.f, 'Ben Dizon', 'Tiling');
  await pay(db, c1.id, a.p, 20000);
  await pay(db, twin.id, a.p, 500);
  await pay(db, null, a.p, 700);
  await edit(db, c1.id, { scope: 'Masonry, phase 2' }, 'Added the rear wall');   // a real history row
  await rpc(db, I.OWNER, 'select lc_end($1, $2) r', [c3.id, 'Finished']);
  await admin(db);
  await db.exec(`insert into expenses (owner_id, folder_id, project_id, amount) values ('${I.OWNER}', '${a.f}', '${a.p}', 1234.5);
                 insert into attendance_records (worker_id, timein_folder_id) values ('${I.W1}', '${a.f}');`);
  return { a, older, c1, twin, c3 };
}

// Everything the browser check makes, through the real functions.
async function zzCheck(db) {
  const A = await folder(db, 'ZZ LL check A');
  const B = await folder(db, 'ZZ LL check B');
  const draft = await contract(db, I.OWNER, A.f, 'ZZ LL Ana', 'ZZ draft job');
  const paid = await contract(db, I.OWNER, A.f, 'ZZ LL Ben', 'ZZ paid job', { amount: 20000 });
  await pay(db, paid.id, A.p, 1000);
  await edit(db, draft.id, { scope: 'ZZ draft job, edited' });
  await edit(db, paid.id, { scope: 'ZZ paid job, edited', agreed_amount: 25000 }, 'ZZ reason');
  // Duplicate names, linked to the two test accounts.
  const d5 = await contract(db, I.OWNER, A.f, 'ZZ LL Twin', 'ZZ twin five');
  const d7 = await contract(db, I.OWNER, A.f, 'ZZ LL Twin', 'ZZ twin seven');
  await link(db, d5.id, W5, 5); await link(db, d7.id, W7, 7);
  await pay(db, d7.id, A.p, 300);
  // Delete: a draft, and a paid one with a reason.
  const gone1 = await contract(db, I.OWNER, A.f, 'ZZ LL Del', 'ZZ delete draft');
  const gone2 = await contract(db, I.OWNER, A.f, 'ZZ LL Del', 'ZZ delete paid');
  const orphan = await pay(db, gone2.id, A.p, 400);
  await rpc(db, I.OWNER, 'select lc_delete($1, $2) r', [gone1.id, '']);
  await rpc(db, I.OWNER, 'select lc_delete($1, $2) r', [gone2.id, 'ZZ entered twice']);
  // Merge, then End and Reopen.
  const m1 = await contract(db, I.OWNER, A.f, 'ZZ LL Merge', 'ZZ merge one', { amount: 1000 });
  const m2 = await contract(db, I.OWNER, A.f, 'ZZ LL Merge', 'ZZ merge two', { amount: 2000 });
  await pay(db, m2.id, A.p, 250);
  await rpc(db, I.OWNER, 'select lc_merge($1::uuid[], $2, $3, $4) r', [[m1.id, m2.id], m1.id, 'ZZ package', 'ZZ one agreement']);
  await rpc(db, I.OWNER, 'select lc_end($1, $2) r', [m1.id, 'ZZ end']);
  await rpc(db, I.OWNER, 'select lc_reopen($1, $2) r', [m1.id, 'ZZ reopen']);
  // The same worker's job on the other project (the merge across projects is refused).
  const other = await contract(db, I.OWNER, B.f, 'ZZ LL Merge', 'ZZ project B job');
  await pay(db, other.id, B.p, 100);
  await admin(db);
  return { A, B, draft, paid, d5, d7, gone1, gone2, orphan, m1, m2, other };
}

const REAL_TABLES = ['labor_contracts', 'payroll', 'folders', 'projects', 'folder_budgets', 'project_budgets', 'project_control_allocation_policies',
                     'project_control_billing_allocations', 'billing_allocation_adjustments', 'expenses', 'overhead_expenses', 'attendance_records', 'profiles'];
async function snap(db, zf = []) {
  await admin(db);
  const out = {};
  for (const t of REAL_TABLES) out[t] = await rows(db, `select * from ${t} order by 1`);
  out.lc_events = await rows(db, 'select * from lc_events order by id');
  return out;
}
const ZERO = '00000000-0000-0000-0000-000000000000';
function fillIds(script, { company, a, b }) {
  let s = script;
  for (const [name, v] of [['v_company', company], ['v_project_a', a], ['v_project_b', b]]) {
    const re = new RegExp("^(  " + name + " +uuid := ')" + ZERO + "(';.*)$", 'm');
    if (!re.test(s)) throw new Error('id line not found: ' + name);
    s = s.replace(re, (m, p1, p2) => p1 + v + p2);
  }
  return s;
}
const filled = (script, z, o = {}) => fillIds(script, { company: o.company ?? I.OWNER, a: o.a ?? z.A.f, b: o.b ?? z.B.f });
const dry = (db, z, o) => err(db.exec(filled(SCRIPT, z, o)));
const real = (db, z, o) => err(db.exec(filled(REAL_RUN, z, o)));
const noop = async () => {};
const guardsOn = async (db) => Number((await one(db, `select count(*)::int n from pg_trigger where tgname in ('lc_guard','lc_log','lc_events_no_change','lc_events_no_truncate') and tgenabled = 'O'`)).n);

await test('P1 the dry run does everything, says what it would remove, and changes nothing', async () => {
  const db = await base();
  await realWorld(db); const z = await zzCheck(db);
  const before = await snap(db);
  const e = await dry(db, z);
  assert(e.includes('DRY RUN OK'), e);
  assert(e.includes('would remove payments 5, contracts 6, history rows 19, projects 2 (with 2 billing periods).'), e);
  eq(await snap(db), before, 'the dry run changed something');
  eq(await guardsOn(db), 4, 'guards after the dry run');
});

await test('P2 the real run removes only the ZZ rows; every real row, including look-alikes, is unchanged row for row', async () => {
  const db = await base();
  const w = await realWorld(db);
  const before = await snap(db);          // the real world, before any ZZ data exists
  const z = await zzCheck(db);
  const e = await real(db, z);
  eq(e, 'no error', 'the real run failed');
  const after = await snap(db);
  for (const t of Object.keys(before)) eq(after[t], before[t], t + ' changed');
  // The look-alikes survive: same typed name, and an older "ZZ" project that is not "ZZ LL".
  eq((await one(db, 'select worker_name from labor_contracts where id = $1', [w.twin.id])).worker_name, 'ZZ LL Ana');
  eq((await one(db, `select count(*)::int n from folders where name = 'ZZ 3b pilot old'`)).n, 1);
  eq((await one(db, 'select count(*)::int n from folders where id = any($1::uuid[])', [[z.A.f, z.B.f]])).n, 0);
  eq((await one(db, 'select count(*)::int n from lc_events where contract_id = any($1::uuid[])', [[z.gone1.id, z.gone2.id, z.m2.id]])).n, 0, 'history of deleted and merged ZZ contracts');
  eq(await guardsOn(db), 4, 'guards after the real run');
});

await test('P3 afterwards the protection still works, nothing is linked, and a second run finds nothing', async () => {
  const db = await base();
  const w = await realWorld(db);
  const z = await zzCheck(db);
  eq(await real(db, z), 'no error');
  eq((await one(db, 'select count(*)::int n from labor_contracts where worker_id is not null')).n, 0);
  await as(db, I.OWNER);
  assert((await err(db.query('update labor_contracts set worker_id = $1 where id = $2', [I.W1, w.c1.id]))).includes('LC_USE_FUNCTION'), 'link guard');
  assert((await err(db.query(`update labor_contracts set scope = 'x' where id = $1`, [w.c1.id]))).includes('LC_REASON_NEEDED'), 'reason guard');
  await admin(db);
  assert((await err(db.exec(`update lc_events set reason = 'x'`))).includes('LC_EVENTS_APPEND_ONLY'), 'history guard');
  assert((await dry(db, z)).includes('project A is not there'), 'a second run finds nothing and stops');
});

await test('P4 a stopped run leaves every guard on and nothing changed', async () => {
  const db = await base();
  await realWorld(db);
  const z = await zzCheck(db);
  await db.exec(`insert into expenses (owner_id, folder_id, amount) values ('${I.OWNER}', '${z.A.f}', 1)`);
  const before = await snap(db);
  assert((await real(db, z)).includes('GUARD'), 'should stop');
  eq(await snap(db), before);
  eq(await guardsOn(db), 4);
});

// Each mixed-up situation stops the script, whichever run it is, and changes nothing.
const STOPS = [
  ['a REAL contract is linked', 'a REAL contract is linked', async (db, w) => { await link(db, w.c1.id, I.W1, 13); }],
  ['a ZZ contract is linked to a real worker at creation', 'is linked to someone other', async (db, w, z) => {
    await contract(db, I.OWNER, z.A.f, 'ZZ LL Picked', 'ZZ linked from the New Contract picker', { worker: I.W1 }); }],
  ['a ZZ contract was once linked to a real worker', 'once linked to someone other', async (db, w, z) => {
    await link(db, z.draft.id, I.W1, 13); await link(db, z.draft.id, null, null, 'wrong person'); }],
  ['a payment on a ZZ contract in a real billing period', 'real billing period', async (db, w, z) => { await pay(db, z.paid.id, w.a.p, 5); }],
  ['a payment in a ZZ billing period tagged to a real contract', 'tagged to a real contract', async (db, w, z) => { await pay(db, w.c1.id, z.A.p, 5); }],
  ['a receipt on a ZZ payment', 'file attached', async (db, w, z) => { await pay(db, z.paid.id, z.A.p, 5, { receipts: ['receipts/x.jpg'] }); }],
  ['an agreement file on a ZZ contract', 'file attached', async (db, w, z) => { await edit(db, z.draft.id, { agreement_pdf_url: 'https://x/a.pdf' }); }],
  ['an added file on a ZZ contract', 'file attached', async (db, w, z) => {
    await as(db, I.OWNER);
    await db.query(`update labor_contracts set cap_history = cap_history || '[{"fileUrl":"u","note":"File uploaded"}]'::jsonb where id = $1`, [z.draft.id]);
    await admin(db); }],
  ['an expense on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into expenses (owner_id, folder_id, amount) values ('${I.OWNER}', '${z.A.f}', 1)`); }],
  ['overhead on a ZZ period', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into overhead_expenses (owner_id, billing_period_id) values ('${I.OWNER}', '${z.A.p}')`); }],
  ['a request on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into pr_requests (folder_id, work_folder_id) values ('${z.A.f}', '${z.A.f}')`); }],
  ['attendance on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into attendance_records (worker_id, timein_folder_id) values ('${I.W1}', '${z.A.f}')`); }],
  ['a BOQ on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into boq_documents (owner_id, folder_id) values ('${I.OWNER}', '${z.A.f}')`); }],
  ['a purchase on a ZZ project', 'on a ZZ project', async (db, w, z) => {
    const p = (await one(db, `insert into purchases (status) values ('recorded') returning id`)).id;
    await db.query('insert into purchase_lines (purchase_id, folder_id) values ($1, $2)', [p, z.A.f]); }],
  ['a voided purchase on a ZZ project', 'on a ZZ project', async (db, w, z) => {
    const p = (await one(db, `insert into purchases (status) values ('voided') returning id`)).id;
    await db.query('insert into purchase_lines (purchase_id, folder_id) values ($1, $2)', [p, z.A.f]); }],
  ['a stock lot costed to a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.query('insert into stk_lots (cost_folder_id) values ($1)', [z.A.f]); }],
  ['stock moved through a ZZ site', 'on a ZZ project', async (db, w, z) => {
    const l = (await one(db, 'insert into stk_locations (folder_id) values ($1) returning id', [z.A.f])).id;
    await db.query('insert into stk_moves (to_location) values ($1)', [l]); }],
  ['a deleted ZZ contract that had a file', 'file attached', async (db, w, z) => {
    const c = await contract(db, I.OWNER, z.A.f, 'ZZ LL File', 'ZZ had a file');
    await edit(db, c.id, { agreement_pdf_url: 'https://x/a.pdf' });
    await rpc(db, I.OWNER, 'select lc_delete($1, $2) r', [c.id, '']); }],
  ['a deleted ZZ contract that had a signature image', 'file attached', async (db, w, z) => {
    const c = await contract(db, I.OWNER, z.A.f, 'ZZ LL Sig', 'ZZ had a signature');
    await admin(db);
    await db.exec('alter table labor_contracts disable trigger lc_guard');
    await db.query('update labor_contracts set agreement_signature_image = $1 where id = $2', ['https://x/s.png', c.id]);
    await db.exec('alter table labor_contracts enable trigger lc_guard');
    await rpc(db, I.OWNER, 'select lc_delete($1, $2) r', [c.id, '']); }],
  ['an expense in a ZZ period', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into expenses (owner_id, project_id, amount) values ('${I.OWNER}', '${z.A.p}', 1)`); }],
  ['overhead on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into overhead_expenses (owner_id, folder_id) values ('${I.OWNER}', '${z.A.f}')`); }],
  ['a reimbursement on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into reimbursements (folder_id) values ('${z.A.f}')`); }],
  ['a Project Management project on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into construction_projects (folder_id) values ('${z.A.f}')`); }],
  ['an inbox item on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into expense_inbox (folder_id) values ('${z.A.f}')`); }],
  ['a request for a ZZ job', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into pr_requests (folder_id, work_folder_id) values ('${w.a.f}', '${z.A.f}')`); }],
  ['a stock record on a ZZ site', 'on a ZZ project', async (db, w, z) => {
    const l = (await one(db, 'insert into stk_locations (folder_id) values ($1) returning id', [z.A.f])).id;
    await db.query('insert into stk_records (from_location) values ($1)', [l]); }],
  ['a stock cost move for a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.query('insert into stk_cost_moves (to_folder) values ($1)', [z.A.f]); }],
  ['a Work Plan task on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into wp_tasks (folder_id, work_folder_id) values ('${z.A.f}', '${z.A.f}')`); }],
  ['an item reference on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into pr_item_refs (folder_id, work_folder_id) values ('${z.A.f}', '${z.A.f}')`); }],
  ['a tool sitting on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.query('insert into tl_tools (folder_id) values ($1)', [z.A.f]); }],
  ['attendance timed out on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into attendance_records (worker_id, timeout_folder_id) values ('${I.W1}', '${z.A.f}')`); }],
  ['W-0007 is not an account of this company', 'W-0005 or W-0007', async (db) => { await db.query('update profiles set worker_no = 707 where id = $1', [W7]); }],
  ['a tool on a ZZ project', 'on a ZZ project', async (db, w, z) => { await db.exec(`insert into tl_records (folder_id) values ('${z.A.f}')`); }],
  ['a job under one of the projects', 'a job sits under', async (db, w, z) => { await folder(db, 'Real looking job', { parent: z.A.f }); }],
  ['a ZZ contract moved to a real project', 'now sits on a real project', async (db, w, z) => {
    await db.exec(`alter table labor_contracts disable trigger lc_guard; alter table labor_contracts disable trigger lc_log;`);
    await db.query('update labor_contracts set folder_id = $1 where id = $2', [w.a.f, z.draft.id]);
    await db.exec(`alter table labor_contracts enable trigger lc_guard; alter table labor_contracts enable trigger lc_log;`); }],
  ['a real contract moved onto a ZZ project', 'moved to or from', async (db, w, z) => {
    await db.exec(`alter table labor_contracts disable trigger lc_guard;`);
    await db.query('update labor_contracts set folder_id = $1 where id = $2', [z.B.f, w.c3.id]);
    await db.exec(`alter table labor_contracts enable trigger lc_guard;`); }],
  ['the ids are not filled in', 'fill in the company', noop, () => ({ company: ZERO, a: ZERO, b: ZERO })],
  ['the same id twice', 'are the same', noop, (z) => ({ a: z.A.f, b: z.A.f })],
  ['the two ids swapped', 'project A is not there', noop, (z) => ({ a: z.B.f, b: z.A.f })],
  ['a real project named by mistake', 'project A is not there', noop, (z, w) => ({ a: w.a.f })],
  ['an unrelated ZZ LL project named by mistake', 'project A is not there', async (db, w) => { w.other = await folder(db, 'ZZ LL unrelated'); }, (z, w) => ({ a: w.other.f })],
  ['a project id that does not exist', 'project A is not there', noop, () => ({ a: '00000000-0000-0000-0000-00000000dead' })],
  ['project A renamed', 'project A is not there', async (db, w, z) => { await db.query(`update folders set name = 'Renamed' where id = $1`, [z.A.f]); }],
  ['project B renamed', 'project B is not there', async (db, w, z) => { await db.query(`update folders set name = 'Renamed' where id = $1`, [z.B.f]); }],
  ['project A in another company', 'project A is not there', async (db, w, z) => { await db.query('update folders set owner_id = $1 where id = $2', [I.OTHER, z.A.f]); }],
  ['project B in another company', 'project B is not there', async (db, w, z) => { await db.query('update folders set owner_id = $1 where id = $2', [I.OTHER, z.B.f]); }],
  ['project A moved under another project', 'project A is not there', async (db, w, z) => { await db.query('update folders set parent_folder_id = $1 where id = $2', [w.a.f, z.A.f]); }],
  ['project B moved under another project', 'project B is not there', async (db, w, z) => { await db.query('update folders set parent_folder_id = $1 where id = $2', [w.a.f, z.B.f]); }],
  ['the company id is a staff account', 'is not the main owner', noop, () => ({ company: I.STAFF })],
  ['the company id is a second owner account', 'is not the main owner', noop, () => ({ company: I.PMOWNER })],
  ['the company id is switched off', 'is not the main owner', async (db) => { await db.query(`update profiles set status = 'inactive' where id = $1`, [I.OWNER]); }],
  ['the company id is another company', 'project A is not there', noop, () => ({ company: I.OTHER })],
  ['a billing period of another company', 'belongs to another company', async (db, w, z) => { await db.query('update projects set owner_id = $1 where id = $2', [I.OTHER, z.A.p]); }],
  ['a contract of another company', 'belongs to another company', async (db, w, z) => {
    await db.exec('alter table labor_contracts disable trigger lc_guard; alter table labor_contracts disable trigger lc_log;');
    await db.query('update labor_contracts set owner_id = $1 where id = $2', [I.OTHER, z.draft.id]);
    await db.exec('alter table labor_contracts enable trigger lc_guard; alter table labor_contracts enable trigger lc_log;'); }],
  ['a payment of another company', 'belongs to another company', async (db, w, z) => { await db.query('update payroll set owner_id = $1 where contract_id = $2', [I.OTHER, z.paid.id]); }],
  ['a history row of another company', 'belongs to another company', async (db, w, z) => {
    await db.exec('alter table lc_events disable trigger lc_events_no_change');
    await db.query('update lc_events set owner_id = $1 where contract_id = $2', [I.OTHER, z.draft.id]);
    await db.exec('alter table lc_events enable trigger lc_events_no_change'); }],
  ['a contract with no creation record', 'no record of being created', async (db, w, z) => {
    await db.exec('alter table labor_contracts disable trigger lc_log');
    await contract(db, I.OWNER, z.A.f, 'ZZ LL NoLog', 'ZZ no log');
    await db.exec('alter table labor_contracts enable trigger lc_log'); }],
  ['W-0005 is not an account of this company', 'W-0005 or W-0007', async (db, w, z) => {
    await db.query('update profiles set worker_no = 505 where id = $1', [W5]); }],
];
for (const [name, want, make, ids] of STOPS) {
  await test('P5 stops: ' + name, async () => {
    const db = await base();
    const w = await realWorld(db);
    const z = await zzCheck(db);
    await make(db, w, z);
    await admin(db);
    const before = await snap(db);
    for (const run of [dry, real]) {
      const e = await run(db, z, ids ? ids(z, w) : undefined);
      assert(e.includes('GUARD') && e.includes(want), `expected "${want}", got: ${e}`);
      eq(await snap(db), before, 'it changed something');
    }
    eq(await guardsOn(db), 4);
  });
}

await test('P6 with the ids left as zeros it refuses and does nothing', async () => {
  const db = await base();
  await realWorld(db);
  await zzCheck(db);
  const before = await snap(db);
  for (const s of [SCRIPT, REAL_RUN]) assert((await err(db.exec(s))).includes('fill in the company'), 'should refuse');
  eq(await snap(db), before);
});

await test('P10 unrelated projects with the same prefix, or even the same name, stay completely unchanged', async () => {
  const db = await base();
  const w = await realWorld(db);
  const others = [await folder(db, 'ZZ LL unrelated work'), await folder(db, 'ZZ LL check A'), await folder(db, 'ZZ LL stray', { parent: w.a.f })];
  for (const [i, o] of others.entries()) {
    const c = await contract(db, I.OWNER, o.f, 'ZZ LL Ana', 'Unrelated job ' + i, { amount: 700 });
    await pay(db, c.id, o.p, 70 + i);
    await edit(db, c.id, { scope: 'Unrelated job edited ' + i }, 'someone else, real reason');
    await admin(db);
    await db.query('insert into billing_allocation_adjustments (owner_id, project_id, reason) values ($1, $2, $3)', [I.OWNER, o.p, 'unrelated']);
    await db.query('insert into overhead_expenses (owner_id, folder_id, billing_period_id) values ($1, $2, $3)', [I.OWNER, o.f, o.p]);
  }
  const before = await snap(db);
  const z = await zzCheck(db);
  eq(await real(db, z), 'no error');
  const after = await snap(db);
  for (const t of Object.keys(before)) eq(after[t], before[t], t + ' changed');
  eq((await one(db, `select count(*)::int n from folders where name like 'ZZ LL%'`)).n, 3, 'the three unrelated projects remain');
  eq((await one(db, `select count(*)::int n from folders where id = any($1::uuid[])`, [[z.A.f, z.B.f]])).n, 0, 'the two named projects are gone');
});

// Sabotage: each bad change must be caught by the after-checks and undone.
const SABOTAGE = [
  ['a real payment deleted', 'a real payment changed', (w) => `delete from payroll where contract_id = '${w.c1.id}';`],
  ['a real contract changed', 'a real contract changed', (w) => `update labor_contracts set notes = 'x' where id = '${w.c1.id}';`],
  ['a real contract linked', 'a real contract changed', (w) => `update labor_contracts set worker_id = '${W5}' where id = '${w.c1.id}';`],
  ['a real history row deleted', 'a real history row changed', (w) => `delete from lc_events where contract_id = '${w.c1.id}';`],
  ['a real period deleted', 'a real project or billing period changed', (w) => `delete from projects where id = '${w.older.p}';`],
  ['a test account changed', 'W-0005, W-0007, attendance or expenses changed', () => `update profiles set status = 'off' where worker_no = 5;`],
  ['a real expense deleted', 'W-0005, W-0007, attendance or expenses changed', () => `delete from expenses where amount = 1234.5;`],
  ['attendance deleted', 'W-0005, W-0007, attendance or expenses changed', () => `delete from attendance_records;`],
  ['a real budget deleted', 'a real budget or allocation changed', (w) => `delete from folder_budgets where folder_id = '${w.a.f}';`],
  ['a test row left behind', 'a ZZ row is still there', () => `insert into lc_events (id, owner_id, contract_id, kind) values (zev[1], v_company, zc[1], 'created');`],
  ['a guard left off', 'a Linked Labor guard is not on', () => `alter table labor_contracts disable trigger lc_log;`, true],
  ['history row-level security off', 'access rules changed', () => `alter table lc_events disable row level security;`, true],
  ['an extra history policy', 'access rules changed', () => `create policy zz_extra on lc_events for select using (true);`, true],
  ['history writable by signed-in accounts', 'access rules changed', () => `grant update on lc_events to authenticated;`, true],
  ['the history guard stops refusing', 'the history accepted a change', () => `create or replace function lc_events_no_change() returns trigger language plpgsql as $f$ begin return coalesce(new, old); end $f$;`, true],
];
const WHILE_OFF = "  execute 'alter table labor_contracts enable trigger lc_guard';";
const BEFORE_TRIGGER_CHECK = '  if (select count(*) from pg_trigger';
for (const [name, want, bad, late] of SABOTAGE) {
  await test('P8 caught and undone: ' + name, async () => {
    const db = await base();
    const w = await realWorld(db);
    const z = await zzCheck(db);
    const marker = late ? BEFORE_TRIGGER_CHECK : WHILE_OFF;
    if (!REAL_RUN.includes(marker)) throw new Error('marker not found: ' + marker);
    const script = filled(REAL_RUN.replace(marker, () => '  ' + bad(w) + '\n' + marker), z);
    const before = await snap(db);
    const e = await err(db.exec(script));
    assert(e.includes('GUARD') && e.includes(want), `expected "${want}", got: ${e}`);
    eq(await snap(db), before, 'it changed something');
    eq(await guardsOn(db), 4);
  });
}

await test('P9 a worker\'s real Time In arriving while it runs neither stops it nor is lost', async () => {
  const db = await base();
  const w = await realWorld(db);
  const z = await zzCheck(db);
  await db.exec(`create function t_in() returns trigger language plpgsql as $f$ begin
      insert into attendance_records (worker_id, timein_folder_id) values ('${I.W1}', '${w.a.f}'); return old; end $f$;
    create trigger t_in after delete on folders for each row when (old.parent_folder_id is null) execute function t_in();`);
  const n = (await one(db, 'select count(*)::int n from attendance_records')).n;
  eq(await real(db, z), 'no error');
  eq((await one(db, 'select count(*)::int n from attendance_records')).n, n + 2, 'the two Time Ins, one per ZZ project deleted');
});

await test('P7 the script: dry by default, every guard it turns off it turns back on, and it writes only ZZ rows', () => {
  assert(/v_dry boolean := true;/.test(SCRIPT), 'dry by default');
  const off = [...SCRIPT.matchAll(/alter table (\w+) disable trigger (\w+)/g)].map(m => m[1] + '.' + m[2]).sort();
  const on = [...SCRIPT.matchAll(/alter table (\w+) enable trigger (\w+)/g)].map(m => m[1] + '.' + m[2]).sort();
  eq(off, ['labor_contracts.lc_guard', 'labor_contracts.lc_log', 'lc_events.lc_events_no_change']);
  eq(on, off);
  const writes = [...SCRIPT.matchAll(/^\s*(delete from|update|insert into)\s+(\w+)(.*)$/gm)].map(m => (m[1] + ' ' + m[2] + ' ' + m[3].trim()).trim());
  eq(writes.sort(), [
    'delete from folders where id = any(zf);',
    'delete from labor_contracts where id = any(zc);',
    'delete from lc_events where id = any(zev);',
    // The self-check: one probe row, always undone before the block ends.
    'delete from lc_events where id = v_probe;',
    "insert into lc_events (owner_id, contract_id, kind, reason) values (v_company, gen_random_uuid(), 'edited', 'clean-up self-check') returning id into v_probe;",
    "update lc_events set reason = 'x' where id = v_probe;",
    'delete from payroll where id = any(zp);',
    'delete from stk_locations where id = any(zloc);',
  ].sort());
  assert(!/storage\.objects/i.test(SCRIPT), 'the script never touches Storage');
  const code = SCRIPT.replace(/--[^\n]*/g, '');
  assert(!/\blike\s+'/i.test(code), 'nothing is ever chosen by a name pattern');
  assert(/^  zf := array\[v_project_a, v_project_b\];$/m.test(SCRIPT), 'the projects are exactly the two named ids');
  for (const n of ['v_company', 'v_project_a', 'v_project_b']) assert(new RegExp("^  " + n + " +uuid := '" + ZERO + "';", 'm').test(SCRIPT), n + ' ships blank');
  assert(!/\bprofiles\b[^;]*\bset\b/i.test(SCRIPT), 'the script never writes a profile');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
