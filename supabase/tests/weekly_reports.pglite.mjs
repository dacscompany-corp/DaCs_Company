// ═════════════════════════════════════════════════
// WEEKLY REPORTS, PART A (0120): ROSTER HISTORY AND OFFICE ACCESS — ON PGLITE
//   npm run test:sql
// The live bodies of auth_role / is_owner / is_staff / data_owner_id (0002) and
// pr_is_office (0094) are sliced out of their migrations, so this cannot drift.
// Spec: docs/superpowers/specs/2026-11-22-weekly-employee-report-mvp-terms.md
// ═════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ROOT } from './ll_base.mjs';

const mig = (f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8').replace(/\r\n/g, '\n');
const M2 = mig('0002_rls.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');
const M120 = mig('0120_weekly_reports.sql');
const M121 = mig('0121_weekly_reports_projects.sql');

function slice(src, name) {
  const start = src.indexOf(`create or replace function ${name}(`);
  const end = src.indexOf('$$;', start);
  if (start < 0 || end < 0) throw new Error(name + ' not found');
  return src.slice(start, end + 3);
}
const LIVE_FNS = ['auth_role', 'is_owner', 'is_staff', 'data_owner_id'].map((n) => slice(M2, n)).join('\n')
  + '\n' + slice(M94, 'pr_is_office');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';   // company A's owner
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';   // company B's owner
const W = '11111111-1111-4111-8111-111111111111';   // active worker (A)
const TL = '22222222-2222-4222-8222-222222222222';  // active teamLeader (A)
const WI = '33333333-3333-4333-8333-333333333333';  // inactive worker (A)
const WN = '44444444-4444-4444-8444-444444444444';  // worker with no owner
const ST = '55555555-5555-4555-8555-555555555555';  // staff (A)
const STI = '66666666-6666-4666-8666-666666666666'; // inactive staff (A)
const STP = '77777777-7777-4777-8777-777777777777'; // staff, pm only
const STA = '88888888-8888-4888-8888-888888888888'; // staff, attendance
const STE = '99999999-9999-4999-8999-999999999999'; // staff, empty list
const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const SETUP = `
create role anon; create role authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create table profiles (id uuid primary key, role text, owner_id uuid, status text,
  display_name text, email text, position text, worker_no text, allowed_modules jsonb);
create table attendance_records (
  id uuid primary key default gen_random_uuid(), owner_id uuid, worker_id uuid, worker_name text, worker_position text,
  work_date date, status text,
  timein_at timestamptz, timein_project_system text, timein_folder_id uuid, timein_pm_project_id uuid, timein_project_name text,
  timein_photo_path text, timein_description text, timein_location_status text, timein_is_mock boolean, timein_was_offline boolean,
  timein_lat double precision, timein_lng double precision,
  timeout_at timestamptz, timeout_project_system text, timeout_folder_id uuid, timeout_pm_project_id uuid, timeout_project_name text,
  timeout_photo_path text, timeout_extra_photo_paths text[], timeout_description text, timeout_event_id uuid,
  timeout_location_status text, timeout_is_mock boolean, timeout_was_offline boolean,
  timeout_lat double precision, timeout_lng double precision,
  total_minutes integer, abandoned_at timestamptz, abandoned_note text);
${LIVE_FNS}

-- 0121: Project Control folders (0064 completed_at) and a STUB of 0072's
-- attendance_projects_for_admin(). 0072's function is not what 0121 changes;
-- the stub only returns the test sites of the caller's company.
create table folders (id uuid primary key, completed_at timestamptz);
create table t_sites (owner_id uuid, project_system text, project_id uuid, project_name text, hidden boolean);
create function attendance_projects_for_admin()
returns table (project_system text, project_id uuid, project_name text, hidden boolean)
language sql stable as $$
  select s.project_system, s.project_id, s.project_name, s.hidden
    from t_sites s where s.owner_id = data_owner_id()
$$;
`;

const SEED = `
insert into profiles (id, role, owner_id, status, allowed_modules) values
  ('${A}', 'owner', null, 'active', null),
  ('${B}', 'owner', null, 'active', null),
  ('${W}', 'worker', '${A}', 'active', null),
  ('${TL}', 'teamLeader', '${A}', 'active', null),
  ('${WI}', 'worker', '${A}', 'inactive', null),
  ('${WN}', 'worker', null, 'active', null),
  ('${ST}', 'staff', '${A}', 'active', null),
  ('${STI}', 'staff', '${A}', 'inactive', null),
  ('${STP}', 'staff', '${A}', 'active', '["pm"]'),
  ('${STA}', 'staff', '${A}', 'active', '["attendance"]'),
  ('${STE}', 'staff', '${A}', 'active', '[]');
`;

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); }
async function as(db, uid) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false);`);
  if (uid) await db.exec('set role authenticated');
}
// As an Edge Function or a security-definer RPC would: no restricted role.
async function asSuper(db, uid) {
  await db.exec(`reset role; select set_config('test.uid', '${uid || ''}', false);`);
}
const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const err = async (p) => { try { await p; return 'no error'; } catch (e) { return e.message; } };

async function fresh() {
  const db = new PGlite();
  await db.exec(SETUP);
  await db.exec(SEED);
  await db.exec(M120);
  await db.exec(M121);
  return db;
}
const count = async (db) => (await q(db, 'select count(*)::int n from att_report_eligibility'))[0].n;
const rowsFor = (db, id) => q(db, `select owner_id, eligible, source from att_report_eligibility where worker_id = $1 order by id`, [id]);
const callOwner = async (db, uid) => { await asSuper(db, uid); return (await q(db, 'select att_report_owner() r'))[0].r; };

console.log('\nWeekly reports part A (0120)');

await test('launch seed: one row per eligible worker/teamLeader, effective today (Manila), source launch', async () => {
  const db = await fresh();
  const rows = await q(db, `select worker_id, eligible, effective_on::text d, source,
                                   (effective_on = (now() at time zone 'Asia/Manila')::date) today
                              from att_report_eligibility order by worker_id`);
  eq(rows.map((r) => r.worker_id).sort(), [W, TL].sort());
  assert(rows.every((r) => r.eligible === true && r.today && r.source === 'launch'), JSON.stringify(rows));
});

await test('running 0120 twice adds no rows', async () => {
  const db = await fresh();
  const n = await count(db);
  await db.exec(M120);
  eq(await count(db), n);
});

await test('deactivating writes false today; reactivating writes true', async () => {
  const db = await fresh();
  await asSuper(db, null);
  await db.exec(`update profiles set status = 'inactive' where id = '${W}'`);
  await db.exec(`update profiles set status = 'active' where id = '${W}'`);
  eq((await rowsFor(db, W)).slice(-2).map((r) => [r.eligible, r.source]), [[false, 'profile'], [true, 'profile']]);
});

await test('worker→staff writes false; staff→worker writes true', async () => {
  const db = await fresh();
  await db.exec(`update profiles set role = 'staff' where id = '${W}'`);
  await db.exec(`update profiles set role = 'worker' where id = '${W}'`);
  eq((await rowsFor(db, W)).slice(-2).map((r) => r.eligible), [false, true]);
});

await test('a change that keeps eligibility writes nothing', async () => {
  const db = await fresh();
  const n = await count(db);
  await db.exec(`update profiles set position = 'Mason', display_name = 'X Y' where id = '${W}'`);
  await db.exec(`update profiles set role = 'teamLeader' where id = '${W}'`);
  eq(await count(db), n);
});

await test('moving company writes false for the old one and true for the new one', async () => {
  const db = await fresh();
  await db.exec(`update profiles set owner_id = '${B}' where id = '${W}'`);
  eq((await rowsFor(db, W)).slice(-2).map((r) => [r.owner_id, r.eligible]), [[A, false], [B, true]]);
});

await test('a new active worker profile writes true on insert; a new staff profile writes nothing', async () => {
  const db = await fresh();
  const n = await count(db);
  await db.exec(`insert into profiles (id, role, owner_id, status) values ('${NEW}', 'staff', '${A}', 'active')`);
  eq(await count(db), n);
  await db.exec(`insert into profiles (id, role, owner_id, status) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'worker', '${A}', 'active')`);
  eq(await count(db), n + 1);
  const last = (await q(db, 'select eligible, source from att_report_eligibility order by id desc limit 1'))[0];
  eq([last.eligible, last.source], [true, 'profile']);
});

await test('setting role to NULL writes eligible=false', async () => {
  const db = await fresh();
  await asSuper(db, null);
  await db.exec(`update profiles set role = null where id = '${W}'`);
  eq((await rowsFor(db, W)).slice(-1).map((r) => [r.eligible, r.source]), [[false, 'profile']]);
});

await test('att_report_owner: owner and staff get the company; others are refused', async () => {
  const db = await fresh();
  eq(await callOwner(db, A), A, 'owner');
  eq(await callOwner(db, ST), A, 'active staff');
  eq(await callOwner(db, STA), A, 'attendance staff');
  eq(await callOwner(db, STE), A, 'empty list');
  for (const [uid, code] of [[STI, 'NOT_OFFICE'], [W, 'NOT_OFFICE'], [STP, 'NO_ATTENDANCE_ACCESS']]) {
    await asSuper(db, uid);
    assert((await err(q(db, 'select att_report_owner()'))).includes(code), uid + ' should be ' + code);
  }
});

await test('authenticated cannot call att_report_owner', async () => {
  const db = await fresh();
  await as(db, A);
  assert((await err(q(db, 'select att_report_owner()'))).includes('permission denied'), 'call allowed');
});

await test('authenticated cannot read att_report_eligibility', async () => {
  const db = await fresh();
  await as(db, A);
  assert((await err(q(db, 'select * from att_report_eligibility'))).includes('permission denied'), 'read allowed');
});


// ── Part B ─────────────────────────────────────────────
console.log('\nWeekly reports part B (0120)');
const WK = '2026-11-16';
const SB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; // staff of company B
const WB = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; // worker of company B
const X1 = '10000000-0000-4000-8000-000000000001'; // deactivated Wed, has records
const X2 = '10000000-0000-4000-8000-000000000002'; // hired 25 Nov
const X3 = '10000000-0000-4000-8000-000000000003'; // deactivated 10 Nov, no records
const X4 = '10000000-0000-4000-8000-000000000004'; // no eligibility, has a record
async function freshB() {
  const db = await fresh();
  await db.exec(`insert into profiles (id, role, owner_id, status) values
      ('${SB}', 'staff', '${B}', 'active'), ('${WB}', 'worker', '${B}', 'active'),
      ('${X1}', 'worker', '${A}', 'inactive'), ('${X2}', 'worker', '${A}', 'active'),
      ('${X3}', 'worker', '${A}', 'inactive'), ('${X4}', 'worker', '${A}', 'active');
    delete from att_report_eligibility;
    insert into att_report_eligibility (owner_id, worker_id, eligible, effective_on, source) values
      ('${A}', '${W}',  true,  '2026-11-01', 'launch'),
      ('${A}', '${TL}', true,  '2026-11-01', 'launch'),
      ('${A}', '${X1}', true,  '2026-11-01', 'launch'),
      ('${A}', '${X1}', false, '2026-11-18', 'profile'),
      ('${A}', '${X2}', true,  '2026-11-25', 'profile'),
      ('${A}', '${X3}', true,  '2026-11-01', 'launch'),
      ('${A}', '${X3}', false, '2026-11-10', 'profile'),
      ('${B}', '${WB}', true,  '2026-11-05', 'launch');`);
  const rec = (own, wk, d, extra = 'null') => `insert into attendance_records
    (owner_id, worker_id, worker_name, work_date, status, timein_at, timein_project_name, timein_photo_path, timeout_extra_photo_paths, timein_lat, timein_lng, timeout_lat, timeout_lng)
    values ('${own}', '${wk}', 'N', '${d}', 'complete', '${d} 08:00+08', 'P', 'p', ${extra}, 1, 2, 3, 4);`;
  await db.exec(rec(A, W, '2026-11-22', `array['z/3.jpg','a/1.jpg','m/2.jpg']`) + rec(A, W, '2026-11-23') + rec(A, W, '2026-11-15')
    + rec(B, WB, '2026-11-17') + rec(A, X1, '2026-11-17') + rec(A, X4, '2026-11-19'));
  return db;
}
const rep = async (db, uid, wk = WK) => { await as(db, uid); return (await q(db, 'select att_week_report($1::date) r', [wk]))[0].r; };
const duties = async (db, uid) => { await as(db, uid); return (await q(db, 'select att_duty_list() r'))[0].r; };
const save = (db, pos, txt, act) => q(db, 'select att_duty_save($1,$2,$3) r', act === undefined ? [pos, txt, true] : [pos, txt, act]);

await test('save then list stores the trade', async () => {
  const db = await freshB(); await as(db, ST);
  const r = (await save(db, 'Helper (Marc Kelley)', 'Carry things'))[0].r;
  eq(r.position, 'Helper');
  eq((await duties(db, ST)).duties.map((d) => d.position), ['Helper']);
});
await test('same trade in another case updates the same row', async () => {
  const db = await freshB(); await as(db, ST);
  await save(db, 'Helper', 'one'); await save(db, 'helper', 'two');
  const l = await duties(db, ST);
  eq(l.duties.length, 1); eq(l.duties[0].duties, 'two');
});
await test('invalid duties and position are refused', async () => {
  const db = await freshB(); await as(db, ST);
  assert((await err(save(db, 'Helper', '   '))).includes('DUTY_TEXT_INVALID'), 'blank');
  assert((await err(save(db, 'Helper', 'x'.repeat(2001)))).includes('DUTY_TEXT_INVALID'), '2001');
  assert((await err(save(db, 'p'.repeat(81), 'ok'))).includes('DUTY_POSITION_INVALID'), '81');
});
await test('updated_by is the caller', async () => {
  const db = await freshB(); await as(db, ST);
  await save(db, 'Helper', 'x');
  await asSuper(db, null);
  eq((await q(db, 'select updated_by from att_position_duties'))[0].updated_by, ST);
});
await test('positions = active trades + duty positions, deduplicated', async () => {
  const db = await freshB(); await asSuper(db, null);
  await db.exec(`delete from profiles where id in ('${X1}','${X2}','${X3}','${X4}','${TL}');
    update profiles set position = 'Mason' where id = '${W}';
    insert into profiles (id, role, owner_id, status, position) values
      ('20000000-0000-4000-8000-000000000001', 'worker', '${A}', 'active', 'mason'),
      ('20000000-0000-4000-8000-000000000002', 'worker', '${A}', 'active', 'Helper (X)'),
      ('20000000-0000-4000-8000-000000000003', 'worker', '${A}', 'inactive', 'Test'),
      ('20000000-0000-4000-8000-000000000004', 'worker', '${A}', 'active', '  ');`);
  await as(db, ST); await save(db, 'Foreman', 'Lead');
  eq((await duties(db, ST)).positions, ['Foreman', 'Helper', 'Mason']);
});
await test('company B staff never see company A duties; a worker gets NOT_OFFICE', async () => {
  const db = await freshB(); await as(db, ST); await save(db, 'Helper', 'x');
  eq((await duties(db, SB)).duties, []);
  await as(db, W);
  assert((await err(save(db, 'Helper', 'x'))).includes('NOT_OFFICE'), 'worker');
});

await test('Tuesday start → WEEK_START_NOT_MONDAY', async () => {
  const db = await freshB(); await as(db, ST);
  assert((await err(q(db, `select att_week_report('2026-11-17')`))).includes('WEEK_START_NOT_MONDAY'), 'tuesday');
});
await test('records: this company only, Mon–Sun inclusive', async () => {
  const db = await freshB();
  const r = await rep(db, ST);
  eq(r.week_start, '2026-11-16'); eq(r.week_end, '2026-11-22');
  eq(r.records.map((x) => x.work_date).sort(), ['2026-11-17', '2026-11-19', '2026-11-22']);
  assert(!r.records.some((x) => x.worker_id === WB), 'company B leaked');
});
await test('record keeps extra photos in stored order and has no coordinates', async () => {
  const db = await freshB();
  const rec = (await rep(db, ST)).records.find((x) => x.work_date === '2026-11-22');
  eq(rec.timeout_extra_photo_paths, ['z/3.jpg', 'a/1.jpg', 'm/2.jpg']);
  assert(!Object.keys(rec).some((k) => /_(lat|lng)$/.test(k)), 'coordinates present');
});
await test('roster: eligible with no records is in (eligible)', async () => {
  const db = await freshB();
  const t = (await rep(db, ST)).roster.find((x) => x.worker_id === TL);
  eq(t.in_roster, 'eligible');
});
await test('roster: deactivated Wed in; hired after out; deactivated before with no records out', async () => {
  const db = await freshB();
  const ids = (await rep(db, ST)).roster.map((x) => x.worker_id);
  assert(ids.includes(X1), 'X1 should be in');
  assert(!ids.includes(X2), 'X2 hired later should be out');
  assert(!ids.includes(X3), 'X3 should be out');
  eq((await rep(db, ST)).roster.find((x) => x.worker_id === X1).in_roster, 'eligible');
});
await test('roster: records without eligibility come in as records', async () => {
  const db = await freshB();
  const x = (await rep(db, ST)).roster.find((r) => r.worker_id === X4);
  eq(x && x.in_roster, 'records');
});
await test('history_starts_on is the first eligibility date; null for a company with none', async () => {
  const db = await freshB();
  eq((await rep(db, ST)).history_starts_on, '2026-11-01');
  eq((await rep(db, SB)).history_starts_on, '2026-11-05');
  await asSuper(db, null);
  await db.exec(`delete from att_report_eligibility where owner_id = '${B}'`);
  eq((await rep(db, SB)).history_starts_on, null);
});
await test('duties: active rows only', async () => {
  const db = await freshB(); await as(db, ST);
  await save(db, 'Mason', 'a'); await save(db, 'Helper', 'b', false);
  eq((await rep(db, ST)).duties.map((d) => d.position), ['Mason']);
});
await test('company B staff get company B only; worker NOT_OFFICE; pm-only staff NO_ATTENDANCE_ACCESS', async () => {
  const db = await freshB();
  const r = await rep(db, SB);
  eq(r.records.map((x) => x.worker_id), [WB]);
  eq(r.roster.map((x) => x.worker_id), [WB]);
  await as(db, W);
  assert((await err(q(db, `select att_week_report('${WK}')`))).includes('NOT_OFFICE'), 'worker');
  await as(db, STP);
  assert((await err(q(db, `select att_week_report('${WK}')`))).includes('NO_ATTENDANCE_ACCESS'), 'pm');
});
await test('att_report_owner: staff whose allowed_modules is a JSON object get their owner', async () => {
  const db = await fresh();
  await asSuper(db, null);
  await db.exec(`update profiles set allowed_modules = '{"x":1}'::jsonb where id = '${ST}'`);
  eq(await callOwner(db, ST), A);
});
await test('authenticated can call the three RPCs', async () => {
  const db = await freshB(); await as(db, ST);
  await q(db, 'select att_duty_list()'); await q(db, `select att_week_report('${WK}')`); await save(db, 'X', 'y');
});

console.log('\nWeekly reports projects (0121)');
const P1 = '20000000-0000-4000-8000-000000000001';
const P2 = '20000000-0000-4000-8000-000000000002';
const P3 = '20000000-0000-4000-8000-000000000003';
const P4 = '20000000-0000-4000-8000-000000000004';
await test('projects lists the company sites with hidden and completed flags', async () => {
  const db = await freshB();
  await db.exec(`insert into folders (id, completed_at) values ('${P1}', null), ('${P3}', now());
    insert into t_sites values
      ('${A}', 'pc', '${P3}', 'Zeta Tower', true),
      ('${A}', 'pc', '${P1}', 'alpha Villa', false),
      ('${A}', 'pm', '${P2}', 'Beta PM', true);`);
  const sorted = (xs) => xs.map((x) => Object.fromEntries(Object.entries(x).sort()));
  eq(sorted((await rep(db, ST)).projects), sorted([
    { project_system: 'pc', project_id: P1, project_name: 'alpha Villa', hidden: false, completed: false },
    { project_system: 'pm', project_id: P2, project_name: 'Beta PM', hidden: true, completed: false },
    { project_system: 'pc', project_id: P3, project_name: 'Zeta Tower', hidden: true, completed: true }]));
});
await test('company B staff get only company B sites', async () => {
  const db = await freshB();
  await db.exec(`insert into t_sites values ('${A}', 'pc', '${P1}', 'A site', false), ('${B}', 'pc', '${P4}', 'B site', false);`);
  eq((await rep(db, SB)).projects.map((x) => x.project_id), [P4]);
});
await test('every 0120 key is still in the payload', async () => {
  const db = await freshB();
  const r = await rep(db, ST);
  for (const k of ['week_start', 'week_end', 'generated_at', 'history_starts_on', 'roster', 'records', 'duties'])
    assert(k in r, 'missing ' + k);
});
await test('no sites gives projects []', async () => {
  const db = await freshB();
  eq((await rep(db, ST)).projects, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
