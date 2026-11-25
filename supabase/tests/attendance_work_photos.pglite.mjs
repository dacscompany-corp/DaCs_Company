// ═════════════════════════════════════════════════
// TIME OUT WORK PHOTOS AND A REQUIRED NOTE (0119) — ON PGLITE
//   npm run test:sql
// The first attendance test on PGlite. A minimal attendance_records with the
// live columns (read 22 Nov 2026), stubs for the helpers 0078's Time Out calls
// (project name, location, trusted time, app version), then 0078's own
// attendance_time_out lifted VERBATIM so 0119 really has an old overload to
// drop, then 0119 run VERBATIM.
// Spec: docs/superpowers/specs/2026-11-22-workmate-timeout-work-photos-design.md
// ═════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ROOT } from './ll_base.mjs';

const mig = (f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8').replace(/\r\n/g, '\n');
const M78 = mig('0078_attendance_trusted_time.sql');
const M119 = mig('0119_attendance_timeout_work_photos.sql');

// 0078's Time Out, exactly as written (live body matched it on 22 Nov 2026).
const OLD_TIME_OUT = (() => {
  const start = M78.indexOf('create or replace function attendance_time_out(');
  const end = M78.indexOf('end $$;', start);
  if (start < 0 || end < 0) throw new Error('0078 attendance_time_out not found');
  return M78.slice(start, end + 'end $$;'.length);
})();

const W = '11111111-1111-4111-8111-111111111111';      // the worker
const OTHER = '44444444-4444-4444-8444-444444444444';  // another worker
const OWNER = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';

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

create table profiles (id uuid primary key, role text, owner_id uuid, status text);
create table attendance_config (owner_id uuid primary key, require_geofence boolean);

-- Live columns of attendance_records (22 Nov 2026), timeout_extra_photo_paths absent: 0119 adds it.
create table attendance_records (
  id uuid primary key default gen_random_uuid(), owner_id uuid, worker_id uuid, worker_name text,
  worker_position text, work_date date, session_seq smallint not null default 1, status text,
  timein_project_name text, timein_at timestamptz, timein_photo_path text, timein_description text,
  timein_lat double precision, timein_lng double precision, timein_accuracy_m double precision,
  timein_event_id uuid, timein_was_offline boolean, timein_received_at timestamptz,
  timeout_project_name text, timeout_at timestamptz, timeout_photo_path text, timeout_description text,
  timeout_lat double precision, timeout_lng double precision, timeout_accuracy_m double precision,
  timeout_event_id uuid, timeout_was_offline boolean, timeout_received_at timestamptz,
  total_minutes integer, created_at timestamptz default now(), updated_at timestamptz default now(),
  timein_project_system text, timein_folder_id uuid, timein_pm_project_id uuid,
  timeout_project_system text, timeout_folder_id uuid, timeout_pm_project_id uuid,
  abandoned_by uuid, abandoned_at timestamptz, abandoned_note text,
  timein_location_status text, timein_distance_m double precision, timein_is_mock boolean,
  timein_geofence_lat double precision, timein_geofence_lng double precision, timein_geofence_radius_m numeric,
  timeout_location_status text, timeout_distance_m double precision, timeout_is_mock boolean,
  timeout_geofence_lat double precision, timeout_geofence_lng double precision, timeout_geofence_radius_m numeric,
  timein_trusted_at timestamptz, timeout_trusted_at timestamptz,
  timein_app_version integer, timeout_app_version integer);
create unique index attendance_timeout_event_uniq on attendance_records (timeout_event_id);

-- Stubs: these helpers are not what 0119 changes.
create function attendance_project_name(p_system text, p_id uuid, p_owner uuid)
  returns text language sql stable as $$ select 'Site A'::text $$;
create function attendance_check_location(
  p_project_system text, p_project_id uuid, p_owner uuid, p_at timestamptz,
  p_lat double precision, p_lng double precision, p_accuracy_m double precision,
  p_is_mock boolean, p_permission_denied boolean)
  returns table(status text, distance_m double precision, fence_lat double precision,
                fence_lng double precision, fence_radius_m numeric)
  language sql stable as
  $$ select 'verified'::text, null::double precision, null::double precision, null::double precision, null::numeric $$;
create function attendance_sane_trusted_at(p_trusted_at timestamptz)
  returns timestamptz language sql immutable as $$ select p_trusted_at $$;
create function attendance_location_refuses(p_status text, p_offline boolean, p_require boolean)
  returns boolean language sql immutable as $$ select false $$;
create function attendance_request_app_version()
  returns integer language sql stable as $$ select 1030 $$;
`;

const SEED = `
insert into profiles (id, role, owner_id, status) values
  ('${W}', 'worker', '${OWNER}', 'active'), ('${OTHER}', 'worker', '${OWNER}', 'active');
insert into attendance_records (owner_id, worker_id, work_date, status, timein_at, timein_project_name)
  values ('${OWNER}', '${W}', ((now() - interval '2 hours') at time zone 'Asia/Manila')::date,
          'working', now() - interval '2 hours', 'Site A');
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
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const err = async (p) => { try { await p; return 'no error'; } catch (e) { return e.message; } };
const arr = (xs) => '{' + xs.map((x) => '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';

const MAIN = `${W}/2026-11-22/out-e1.jpg`;
const extra = (n, uid = W) => `${uid}/2026-11-22/out-e1-${n}.jpg`;
const NOTE = 'Laid hollow blocks, 2F wall';
const EVENT = '55555555-5555-4555-8555-555555555555';

// A Time Out called with NAMED arguments, as PostgREST calls it. `extras`
// undefined = the old app's call (the argument is not sent at all).
async function timeOut(db, { photo = MAIN, extras, note = NOTE, event = EVENT } = {}) {
  const params = [SITE, photo, event, note];
  let extraArg = '';
  if (extras !== undefined) { params.push(arr(extras)); extraArg = ', p_extra_photo_paths => $5::text[]'; }
  return one(db, `
    select r.status, r.timeout_photo_path, r.timeout_description,
           array_to_json(r.timeout_extra_photo_paths) as extras
      from attendance_time_out(
             p_project_system => 'pc', p_project_id => $1::uuid,
             p_captured_at => now() - interval '1 minute', p_photo_path => $2,
             p_event_id => $3::uuid, p_description => $4${extraArg}) r`, params);
}

async function fresh() {
  const db = new PGlite();
  await db.exec(SETUP);
  await db.exec(OLD_TIME_OUT);
  await db.exec(M119);
  await db.exec(SEED);
  await as(db, W);
  return db;
}

console.log('\nTime Out work photos and a required note (0119)');

await test('exactly one attendance_time_out remains, with 14 arguments', async () => {
  const db = await fresh();
  await as(db, null);
  const r = await one(db, `select count(*)::int n, max(pronargs)::int a from pg_proc where proname = 'attendance_time_out'`);
  eq([r.n, r.a], [1, 14]);
});

await test("the old app's call (no work photos, no note) records exactly as today", async () => {
  const db = await fresh();
  const r = await timeOut(db, { note: null });
  eq([r.status, r.timeout_photo_path, r.extras, r.timeout_description], ['complete', MAIN, null, null]);
});

await test('2 extra photos and a real note are recorded, in order', async () => {
  const db = await fresh();
  const r = await timeOut(db, { extras: [extra(2), extra(3)] });
  eq([r.status, r.timeout_photo_path, r.extras, r.timeout_description], ['complete', MAIN, [extra(2), extra(3)], NOTE]);
});

await test('5 extras (6 photos) are fine', async () => {
  const db = await fresh();
  const five = [2, 3, 4, 5, 6].map((n) => extra(n));
  eq((await timeOut(db, { extras: five })).extras, five);
});

await test('fewer than 3 photos in all is refused; more than 6 is refused', async () => {
  const db = await fresh();
  assert((await err(timeOut(db, { extras: [extra(2)] }))).includes('WORK_PHOTOS_REQUIRED'), '1 extra');
  assert((await err(timeOut(db, { extras: [] }))).includes('WORK_PHOTOS_REQUIRED'), 'empty list');
  const six = [2, 3, 4, 5, 6, 7].map((n) => extra(n));
  assert((await err(timeOut(db, { extras: six }))).includes('WORK_PHOTOS_TOO_MANY'), '6 extras');
});

await test("photo links outside the worker's own folder, or malformed, are refused", async () => {
  const db = await fresh();
  const bad = async (o, label) =>
    assert((await err(timeOut(db, o))).includes('WORK_PHOTO_PATH_INVALID'), label);
  await bad({ extras: [extra(2), extra(3, OTHER)] }, "another worker's folder");
  await bad({ extras: [extra(2), `${W}/2026-11-22/out-e1-3.png`] }, 'not a .jpg');
  await bad({ extras: [extra(2), `${W}/../${OTHER}/out-e1-3.jpg`] }, 'contains ..');
  await bad({ extras: [extra(2), MAIN] }, 'an extra equal to the main photo');
  await bad({ extras: [extra(2), extra(2)] }, 'two identical extras');
  await bad({ photo: null, extras: [extra(2), extra(3)] }, 'no main photo');
});

await test('with work photos, a note under 15 characters is refused, spaces and newlines included', async () => {
  const db = await fresh();
  const two = [extra(2), extra(3)];
  assert((await err(timeOut(db, { extras: two, note: 'Laid blocks' }))).includes('WORK_NOTE_REQUIRED'), '11 characters');
  assert((await err(timeOut(db, { extras: two, note: ' '.repeat(20) }))).includes('WORK_NOTE_REQUIRED'), 'spaces');
  assert((await err(timeOut(db, { extras: two, note: '\n'.repeat(15) + 'abc' }))).includes('WORK_NOTE_REQUIRED'), 'newlines');
  assert((await err(timeOut(db, { extras: two, note: null }))).includes('WORK_NOTE_REQUIRED'), 'no note');
});

await test('a replay of the same Time Out returns the stored row before any new check', async () => {
  const db = await fresh();
  await timeOut(db, { extras: [extra(2), extra(3)] });
  const again = await timeOut(db, { note: null });
  eq([again.status, again.extras, again.timeout_description], ['complete', [extra(2), extra(3)], NOTE]);
});

await test('the 14-argument function is executable by authenticated', async () => {
  const db = await fresh();
  await as(db, null);
  const r = await one(db, `
    select has_function_privilege('authenticated', p.oid, 'execute') a
      from pg_proc p where p.proname = 'attendance_time_out'`);
  eq(r.a, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
