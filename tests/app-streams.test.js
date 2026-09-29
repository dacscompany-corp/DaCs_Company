// ════════════════════════════════════════════════════════════════════
// APP STREAMS TESTS: run with  node tests/app-streams.test.js
//
// Zero dependencies. Guards migration 0082 (two worker apps on one
// backend: the old DACS Attendance app and DAC'S WorkMate):
//   I.   Old phones are untouched: no x-dacs-app header = 'attendance',
//        app_latest_release() still serves only the Attendance stream.
//   II.  The version gate reads the calling app's own minimum.
//   III. Release streams: (app, version_code) key, 1000+ for WorkMate,
//        WorkMate files under workmate/, one publish function.
//   IV.  Grants.
// The live behaviour is checked by supabase/tests/app_streams.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, '..', 'supabase/migrations/0082_workmate_app_streams.sql');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }
// Migration text with -- comments removed, so a comment can't satisfy a check.
function sql() {
  if (!fs.existsSync(MIG)) throw new Error('missing file: supabase/migrations/0082_workmate_app_streams.sql');
  return fs.readFileSync(MIG, 'utf8').replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}
// One function's full text, from "create or replace function <name>(" to its closing "$$;" line.
function fn(name) {
  const re = new RegExp('create or replace function ' + name + '\\([\\s\\S]*?\\n\\$\\$;');
  const m = sql().match(re);
  if (!m) throw new Error('no function ' + name + ' in 0082');
  return m[0];
}

console.log('\nI. Old Attendance phones are untouched');
test('no x-dacs-app header (or any other value) means attendance', () => {
  const f = fn('dacs_request_app');
  ok(/if v_raw = 'workmate' then return 'workmate'; end if;/.test(f), 'only the exact value workmate selects WorkMate');
  ok(/return 'attendance';\s*end;\s*\n\$\$;$/.test(f), 'the fall-through must be attendance');
});
test('a version of 1000+ also means WorkMate (a build that forgot the header)', () => {
  ok(/if attendance_request_app_version\(\) >= 1000 then return 'workmate'; end if;/.test(fn('dacs_request_app')),
    'version-range fallback missing');
});
test('app_latest_release() keeps its signature and serves only the Attendance stream', () => {
  const f = fn('app_latest_release');
  ok(/^create or replace function app_latest_release\(\)/.test(f), 'must stay argument-less (old phones call it)');
  ok(/where r\.app = 'attendance'/.test(f), 'must filter to the attendance stream');
});
test('Attendance APKs keep the <code>.apk storage path', () => {
  ok(/when 'attendance' then version_code::text \|\| '\.apk'/.test(sql()), 'path rule for attendance changed');
});

console.log('\nII. The version gate reads the calling app\'s own minimum');
test('attendance_required_app_version picks the column by app, and WorkMate never below 1000', () => {
  const f = fn('attendance_required_app_version');
  ok(/when 'workmate' then greatest\(1000, coalesce\(/.test(f), 'WorkMate must always be held to at least 1000');
  ok(/select c\.min_workmate_version from attendance_config c where c\.owner_id = p_owner/.test(f), 'WorkMate minimum not read');
  ok(/select c\.min_app_version from attendance_config c where c\.owner_id = p_owner/.test(f), 'Attendance minimum not read');
  ok(/else coalesce\(/.test(f), 'an Attendance owner with no config row must read as 0 (off)');
});
test('the 0077 guard still skips admin writes and uses the per-app minimum', () => {
  const f = fn('attendance_app_version_guard');
  ok(/auth\.uid\(\) is null or auth\.uid\(\) is distinct from new\.worker_id/.test(f), 'admin-write skip removed');
  ok(/v_min := attendance_required_app_version\(new\.owner_id\);/.test(f), 'guard does not use the per-app minimum');
  ok(/raise exception 'APP_UPDATE_REQUIRED'/.test(f), 'refusal code changed (both apps map it to "retry after update")');
});

console.log('\nIII. Release streams');
test('primary key is (app, version_code)', () => {
  ok(/add constraint app_releases_pkey primary key \(app, version_code\)/.test(sql()), 'pkey not per app');
});
test('version ranges: Attendance < 1000, WorkMate >= 1000', () => {
  ok(/\(app = 'attendance' and version_code < 1000\) or \(app = 'workmate' and version_code >= 1000\)/.test(sql()), 'range rule missing');
});
test('WorkMate files live under workmate/', () => {
  ok(/else app \|\| '\/' \|\| version_code::text \|\| '\.apk'/.test(sql()), 'WorkMate path rule missing');
});
test('the old 5-argument publish function is dropped (no ambiguous overload)', () => {
  ok(/drop function if exists app_publish_release\(integer, text, text, bigint, text\);/.test(sql()), 'old signature not dropped');
});
test('publish checks the app, and raises only that app\'s minimum', () => {
  const f = fn('app_publish_release');
  ok(/raise exception 'APP_UNKNOWN'/.test(f), 'unknown app not refused');
  ok(/where app = v_app/.test(f), 'latest version not computed per app');
  ok(/set min_workmate_version = p_version_code/.test(f) && /set min_app_version = p_version_code/.test(f), 'per-app minimum update missing');
  ok(/if is_owner\(\) is not true then/.test(f), 'owner check must be NULL-safe (0080)');
});

console.log('\nIV. Grants');
test('signed-out phones may check for updates; nobody but authenticated owners may publish', () => {
  const s = sql();
  ok(/grant execute on function app_latest_release_for\(text\) to anon, authenticated;/.test(s), 'latest_for not callable signed out');
  ok(/revoke execute on function app_publish_release\(integer, text, text, bigint, text, text\) from anon;/.test(s), 'anon publish not revoked');
  ok(!/\bto public\b/i.test(s), 'nothing may be granted to public');
});
test('the private gate helpers are revoked; the update check is SECURITY DEFINER', () => {
  const s = sql();
  ok(/revoke all on function dacs_request_app\(\) from public, anon, authenticated;/.test(s), 'dacs_request_app not revoked');
  ok(/revoke all on function attendance_required_app_version\(uuid\) from public, anon, authenticated;/.test(s),
    'attendance_required_app_version not revoked');
  ok(/security definer\s+set search_path = public/.test(fn('app_latest_release_for')),
    'app_latest_release_for must be security definer with a fixed search_path');
});
test('an owner can delete an unpublished APK left by a refused publish (0079 fix)', () => {
  const s = sql();
  ok(/security definer set search_path = public/.test(fn('app_release_path_published')), 'helper must be security definer');
  ok(/grant execute on function app_release_path_published\(text\) to authenticated;/.test(s), 'helper not granted to authenticated');
  ok(/create policy app_releases_owner_delete on storage\.objects\s+for delete to authenticated\s+using \(bucket_id = 'app-releases' and is_owner\(\) and not app_release_path_published\(name\)\);/.test(s),
    'delete policy does not use the helper');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
