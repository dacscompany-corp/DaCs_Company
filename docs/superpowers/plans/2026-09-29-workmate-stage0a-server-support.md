# WorkMate Stage 0A — Server Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the server tell the old Attendance app and the new DAC'S WorkMate app apart, so each has its own minimum version and its own update stream, while every phone running the old app behaves exactly as today.

**Architecture:** One migration (`0082`). Every request from WorkMate carries the header `x-dacs-app: workmate`. The old app never sends it and is treated as `attendance`. The 0077 version-gate trigger reads the minimum for the calling app (`min_app_version` or the new `min_workmate_version`). `app_releases` gains an `app` column and becomes two streams. `app_latest_release()` (which old phones call) returns only the Attendance stream, and WorkMate calls the new `app_latest_release_for('workmate')`. The web publisher (`js/app-updates-admin.js`) recognises either APK by its package name and publishes it into the right stream. WorkMate version numbers are **1000 or higher**, the old app's stay below 1000, and the database enforces it.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), plain browser JS with a Node test (built-ins only).

**Spec:** [docs/superpowers/specs/2026-09-29-unified-worker-app-design.md](../specs/2026-09-29-unified-worker-app-design.md) §1 (new app, packaging, "Preserve the existing Attendance rules, worker accounts and historical records through the shared backend"). Roadmap: [2026-09-29-workmate-stage0-roadmap.md](2026-09-29-workmate-stage0-roadmap.md).

## Global Constraints

- **The old Attendance app (`com.dacs.attendance`, `versionCode` 4 today) must behave exactly as before:** no `x-dacs-app` header means `attendance`; `app_latest_release()` keeps its name, arguments and columns; an Attendance APK is still stored as `<versionCode>.apk`; its minimum stays `attendance_config.min_app_version` (live value **3**).
- WorkMate identity: Android application id **`com.dacs.workmate`** (debug `com.dacs.workmate.debug`), header **`x-dacs-app: workmate`**, version header **`x-dacs-app-version: <versionCode>`**, **`versionCode >= 1000`**. The old app's `versionCode` stays **`< 1000`**.
- WorkMate APKs are stored in the `app-releases` bucket at **`workmate/<versionCode>.apk`**.
- **Migration number `0082`** (the highest on disk is `0081_uploads_access_repair.sql`). Never reuse a number, and never make a DDL change in the SQL editor that isn't this file.
- **Never run `npm run build`** (CLAUDE.md hard rule).
- **The user commits manually.** Checkpoint steps mean hand over; never run `git commit` or `git push`.
- Applying 0082 to production changes live behaviour: **get the user's explicit yes in the same session before Task 4**.
- Attendance stays outside the money model: no peso column, no accounting side effect.

## Why 1000+

`attendance_vouched_time()` (0078) trusts the phone's own clock for any build **below 3**: `when coalesce(p_app_version, 0) < 3 then p_captured_at`. A new app starting at version 1 would fall into that branch and bypass the tamper-proof clock. `attendance_records.timein_app_version` / `timeout_app_version` also store the header number with no app name. Keeping WorkMate at 1000 or above makes the legacy branch unreachable for WorkMate, and keeps every stored number unambiguous. The database enforces the range twice: on releases (`app_releases_range_ck`) and on every Time In / Time Out (`attendance_required_app_version` never returns less than 1000 for WorkMate, even before its first publish). Found in the Task 2 review, 2026-09-29.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `tests/app-streams.test.js` | Create | CI guard. Reads 0082's text and fails if the old-app path, the per-app gate, the ranges, the grants or the dropped signature regress |
| `package.json` | Modify (`scripts.test`) | Add the new suite |
| `supabase/migrations/0082_workmate_app_streams.sql` | Create | The server change |
| `supabase/tests/app_streams.sql` | Create | Live check against production, always rolled back |
| `js/app-updates-admin.js` | Modify | Recognise both apps' APKs; publish into the right stream; show both histories |
| `tests/app-updates.test.js` | Modify | Tests for the two-app publisher rules |
| `docs/DATABASE_SCHEMA.md` | Modify | Document the two apps |
| `supabase/migrations/README.md` | Modify | Next number becomes 0083 |

---

### Task 1: CI guard for 0082

**Files:**
- Create: `tests/app-streams.test.js`
- Modify: `package.json` (the `"test"` script)

**Interfaces:**
- Consumes: nothing (reads files as text).
- Produces: the check that Task 2's `supabase/migrations/0082_workmate_app_streams.sql` must satisfy. Every function in that file must end with a line that is exactly `$$;`.

- [ ] **Step 1: Write the failing test**

Create `tests/app-streams.test.js`:

```js
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
```

- [ ] **Step 2: Add it to `npm test`**

In `package.json`, append ` && node tests/app-streams.test.js` to the end of the `"test"` script (after `node tests/storage-access.test.js`).

- [ ] **Step 3: Run it to verify it fails for the right reason**

Run: `node tests/app-streams.test.js`
Expected: exit code 1, `0 passed, 14 failed`, and every failure says `missing file: supabase/migrations/0082_workmate_app_streams.sql`.

- [ ] **Step 4: Syntax check**

Run: `node --check tests/app-streams.test.js`
Expected: no output, exit 0.

- [ ] **Step 5: Checkpoint (user commits)**

Stop and tell the user: "Task 1 ready to commit: `tests/app-streams.test.js`, `package.json` (fails until Task 2)."

---

### Task 2: Migration 0082 and its live check

**Files:**
- Create: `supabase/migrations/0082_workmate_app_streams.sql`
- Create: `supabase/tests/app_streams.sql`
- Test: `tests/app-streams.test.js` (Task 1)

**Interfaces:**
- Consumes (live, verified 2026-09-29): table `app_releases` (constraints `app_releases_pkey`, `app_releases_path_ck`, `app_releases_storage_path_key`), table `attendance_config` (pk `owner_id`, column `min_app_version`), functions `attendance_request_app_version()` (0077), `is_owner()` (0002), trigger `attendance_records_app_version` → `attendance_app_version_guard()` (0077), `app_latest_release()` / `app_list_releases()` / `app_publish_release(integer, text, text, bigint, text)` (0079/0080).
- Produces:
  - `dacs_request_app() returns text`: `'workmate'` or `'attendance'`
  - `attendance_required_app_version(p_owner uuid) returns integer`
  - column `attendance_config.min_workmate_version integer not null default 0`
  - column `app_releases.app text not null default 'attendance'`
  - `app_latest_release_for(p_app text)`, returning the same columns as `app_latest_release()`
  - `app_publish_release(p_version_code integer, p_version_name text, p_release_notes text, p_size_bytes bigint, p_sha256 text, p_app text default 'attendance') returns app_releases`
  - error codes `APP_UNKNOWN` (new), `VERSION_NOT_NEWER`, `APK_NOT_UPLOADED`, `APK_SIZE_MISMATCH`, `OWNER_REQUIRED` (as before)

- [ ] **Step 1: Write the live check**

Create `supabase/tests/app_streams.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- app_streams.sql — LIVE check of migration 0082 (two worker apps).
--
-- SAFE ON PRODUCTION: one transaction, always ROLLED BACK. It inserts a
-- scratch config row and scratch release rows, which the rollback
-- removes; no file is uploaded and nothing is published.
--
-- Run: Supabase SQL editor, the Supabase MCP execute_sql tool, or
--      psql "$DB_URL" -f supabase/tests/app_streams.sql
-- Pass: one row 'app streams: all checks passed'
-- Fail: ERROR 'FAIL: <which check>'
-- ════════════════════════════════════════════════════════════════════
begin;

create function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_label; end if;
end $$;

-- ── 1. Which app is calling ───────────────────────────────────────────
select set_config('request.headers', '', true);
select pg_temp.check(dacs_request_app() = 'attendance', 'no header = the old Attendance app');
select set_config('request.headers', '{"x-dacs-app":"workmate","x-dacs-app-version":"1000"}', true);
select pg_temp.check(dacs_request_app() = 'workmate', 'x-dacs-app: workmate = WorkMate');
select pg_temp.check(attendance_request_app_version() = 1000, 'WorkMate''s version is read from the shared version header');
select set_config('request.headers', '{"x-dacs-app":"WorkMate"}', true);
select pg_temp.check(dacs_request_app() = 'workmate', 'the app name is case-insensitive');
select set_config('request.headers', '{"x-dacs-app":"something-else"}', true);
select pg_temp.check(dacs_request_app() = 'attendance', 'an unknown app name gets the Attendance rules');
select set_config('request.headers', '{"x-dacs-app-version":"1005"}', true);
select pg_temp.check(dacs_request_app() = 'workmate', 'a version of 1000+ without the app header still means WorkMate');
select set_config('request.headers', '{"x-dacs-app-version":"4"}', true);
select pg_temp.check(dacs_request_app() = 'attendance', 'the old app (version 4, no app header) stays Attendance');
select set_config('request.headers', '', true);

-- ── 2. Each app is held to its own minimum ────────────────────────────
select set_config('t.owner', (select id::text from profiles where role = 'owner' and owner_id is null limit 1), true);
select pg_temp.check(current_setting('t.owner') <> '', 'fixture: main owner account');
insert into attendance_config (owner_id, min_app_version, min_workmate_version)
values (current_setting('t.owner')::uuid, 3, 1005)
on conflict (owner_id) do update set min_app_version = 3, min_workmate_version = 1005;

select set_config('request.headers', '', true);
select pg_temp.check(attendance_required_app_version(current_setting('t.owner')::uuid) = 3,
                     'the old app is held to min_app_version');
select pg_temp.check(attendance_required_app_version('00000000-0000-4000-8000-000000000000') = 0,
                     'an Attendance owner with no config row reads as 0 (off)');
select set_config('request.headers', '{"x-dacs-app":"workmate"}', true);
select pg_temp.check(attendance_required_app_version(current_setting('t.owner')::uuid) = 1005,
                     'WorkMate is held to min_workmate_version');
select pg_temp.check(attendance_required_app_version('00000000-0000-4000-8000-000000000000') = 1000,
                     'WorkMate with no config row is still held to 1000');
update attendance_config set min_workmate_version = 0 where owner_id = current_setting('t.owner')::uuid;
select pg_temp.check(attendance_required_app_version(current_setting('t.owner')::uuid) = 1000,
                     'WorkMate before its first publish (minimum 0) is still held to 1000');
select set_config('request.headers', '', true);

-- ── 3. Two release streams ────────────────────────────────────────────
insert into app_releases (app, version_code, version_name, storage_path, size_bytes, sha256) values
  ('attendance', 999,   'check-a', '999.apk',            1, repeat('a', 64)),
  ('workmate',   99999, 'check-w', 'workmate/99999.apk', 1, repeat('b', 64));
select pg_temp.check((select version_code from app_latest_release()) = 999,
                     'old phones still see only the Attendance stream');
select pg_temp.check((select version_code from app_latest_release_for('workmate')) = 99999,
                     'WorkMate sees its own stream');
select pg_temp.check((select version_code from app_latest_release_for('attendance')) = 999,
                     'app_latest_release_for(attendance) agrees with app_latest_release()');
select pg_temp.check(not exists (select 1 from app_latest_release_for('nope')),
                     'an unknown app name returns nothing');
select pg_temp.check(app_release_path_published('999.apk') and app_release_path_published('workmate/99999.apk')
                     and not app_release_path_published('workmate/12345.apk'),
                     'the published-path helper sees both streams');
select pg_temp.check(has_function_privilege('authenticated', 'app_release_path_published(text)', 'execute')
                 and not has_function_privilege('anon', 'app_release_path_published(text)', 'execute'),
                     'the delete-policy helper is callable by owners, not signed out');

do $$
begin
  begin
    insert into app_releases (app, version_code, version_name, storage_path, size_bytes, sha256)
    values ('workmate', 5, 'x', 'workmate/5.apk', 1, repeat('c', 64));
    raise exception 'FAIL: a WorkMate release below 1000 was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into app_releases (app, version_code, version_name, storage_path, size_bytes, sha256)
    values ('attendance', 1001, 'x', '1001.apk', 1, repeat('c', 64));
    raise exception 'FAIL: an Attendance release of 1000 or more was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into app_releases (app, version_code, version_name, storage_path, size_bytes, sha256)
    values ('workmate', 1002, 'x', '1002.apk', 1, repeat('c', 64));
    raise exception 'FAIL: a WorkMate release stored outside workmate/ was accepted';
  exception when check_violation then null;
  end;
end $$;

-- ── 4. Publish function and grants ───────────────────────────────────
select pg_temp.check((select count(*) from pg_proc where proname = 'app_publish_release') = 1,
                     'exactly one app_publish_release (old 5-argument signature dropped)');
select pg_temp.check(exists (
  select 1 from pg_proc where proname = 'app_publish_release'
     and pg_get_function_identity_arguments(oid)
         = 'p_version_code integer, p_version_name text, p_release_notes text, p_size_bytes bigint, p_sha256 text, p_app text'),
  'app_publish_release takes p_app');
select pg_temp.check(not has_function_privilege('anon', 'app_publish_release(integer,text,text,bigint,text,text)', 'execute'),
                     'anon cannot publish');
select pg_temp.check(has_function_privilege('anon', 'app_latest_release_for(text)', 'execute'),
                     'a signed-out WorkMate can check for updates');
select pg_temp.check(has_function_privilege('anon', 'app_latest_release()', 'execute'),
                     'a signed-out old app can still check for updates');

select pg_temp.check(has_function_privilege('authenticated', 'app_publish_release(integer,text,text,bigint,text,text)', 'execute'),
                     'the owner''s portal (authenticated) can publish');
select pg_temp.check(not has_function_privilege('anon', 'dacs_request_app()', 'execute')
                 and not has_function_privilege('anon', 'attendance_required_app_version(uuid)', 'execute'),
                     'the private gate helpers are not callable signed out');

select 'app streams: all checks passed' as result;
rollback;
```

- [ ] **Step 2: Run the live check BEFORE the migration (expected to fail)**

Run the file through the Supabase MCP `execute_sql` tool (project `hqbgduyonlbbsvjuapre`). It is read-only in effect and rolls back.
Expected: ERROR `function dacs_request_app() does not exist`. Record it in the report as the "before" evidence.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0082_workmate_app_streams.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0082_workmate_app_streams.sql
--
-- TWO WORKER APPS, ONE BACKEND. DAC'S WorkMate (Flutter, Android id
-- com.dacs.workmate) is a new, separate app. The old DACS Attendance app
-- (com.dacs.attendance) keeps being maintained. Until now the server knew
-- only one app: one minimum version (0077) and one update stream (0079).
--
-- ── WHICH APP IS CALLING. WorkMate sends `x-dacs-app: workmate` on every
--    request. The old app never sends it, so no header = 'attendance',
--    and every phone in the field today behaves exactly as before. A
--    declared version of 1000+ also means WorkMate (the ranges never
--    overlap), so a WorkMate build that forgot the app header is still
--    held to WorkMate's own minimum.
--
-- ── ALSO FIXES 0079's DELETE POLICY. app_releases_owner_delete checked
--    "not published" with a subquery the calling owner may not read
--    (0079 revoked app_releases from authenticated), so a refused publish
--    could never remove its uploaded APK. It now asks a SECURITY DEFINER
--    helper, app_release_path_published(path).
--
-- ── ONE MINIMUM PER APP. attendance_config.min_workmate_version sits
--    beside min_app_version. The 0077 trigger now asks
--    attendance_required_app_version(owner), which picks the column by app
--    and never lets WorkMate below 1000 (even while its minimum is 0).
--    Both apps still send their own number in x-dacs-app-version.
--
-- ── WORKMATE VERSIONS START AT 1000. 0078's attendance_vouched_time()
--    trusts the phone clock for any build below 3, and
--    attendance_records.timein_app_version stores the number with no app
--    name. Keeping WorkMate at 1000+ and the old app below 1000 makes the
--    legacy branch unreachable for WorkMate and every stored number
--    unambiguous. app_releases enforces the ranges.
--
-- ── TWO RELEASE STREAMS. app_releases gains `app`; the key becomes
--    (app, version_code). Old phones call app_latest_release() with no
--    argument, so it keeps its exact signature and now returns only the
--    Attendance stream. WorkMate calls app_latest_release_for('workmate').
--    WorkMate files live at app-releases/workmate/<code>.apk; Attendance
--    files stay at <code>.apk. The existing bucket policies (owner insert;
--    delete only an unreferenced file) already cover both paths.
--
-- ── PUBLISH. app_publish_release gains p_app (default 'attendance'). The
--    old 5-argument function is DROPPED first: a second overload would make
--    every call ambiguous. Publishing raises only that app's minimum.
--
-- Outside the money model, like all of attendance.
-- Live check: supabase/tests/app_streams.sql. CI guard: tests/app-streams.test.js.
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Which app is calling ─────────────────────────────────────────
create or replace function dacs_request_app()
returns text language plpgsql stable as $$
declare
  v_headers json;
  v_raw     text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return 'attendance';
  end;
  v_raw := lower(coalesce(v_headers ->> 'x-dacs-app', ''));
  if v_raw = 'workmate' then return 'workmate'; end if;
  -- The version ranges never overlap (Attendance < 1000, WorkMate >= 1000).
  if attendance_request_app_version() >= 1000 then return 'workmate'; end if;
  return 'attendance';
end;
$$;

-- ── 2. One minimum per app ──────────────────────────────────────────
alter table attendance_config
  add column if not exists min_workmate_version integer not null default 0;
alter table attendance_config
  drop constraint if exists attendance_config_min_workmate_version_ck;
alter table attendance_config
  add constraint attendance_config_min_workmate_version_ck check (min_workmate_version >= 0);
comment on column attendance_config.min_workmate_version is
  'Lowest DAC''S WorkMate versionCode (1000+) allowed to record Time In / Time Out (0082). '
  '0 = off. Set by app_publish_release(..., ''workmate''). min_app_version is the old app''s.';

-- WorkMate is ALWAYS held to 1000 or more, even before its first publish
-- (min_workmate_version = 0): 0078 trusts the phone clock for builds below
-- 3, and Flutter's default version (1.0.0+1) builds as versionCode 1.
create or replace function attendance_required_app_version(p_owner uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case dacs_request_app()
           when 'workmate' then greatest(1000, coalesce((
             select c.min_workmate_version from attendance_config c where c.owner_id = p_owner), 0))
           else coalesce((
             select c.min_app_version from attendance_config c where c.owner_id = p_owner), 0)
         end
$$;

-- 0077's guard, reading the calling app's own minimum. Unchanged otherwise.
create or replace function attendance_app_version_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min integer;
begin
  if auth.uid() is null or auth.uid() is distinct from new.worker_id then
    return new;
  end if;

  v_min := attendance_required_app_version(new.owner_id);

  if v_min > 0 and attendance_request_app_version() < v_min then
    raise exception 'APP_UPDATE_REQUIRED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ── 3. Two release streams ──────────────────────────────────────────
alter table app_releases
  add column if not exists app text not null default 'attendance';
alter table app_releases drop constraint if exists app_releases_app_ck;
alter table app_releases
  add constraint app_releases_app_ck check (app in ('attendance', 'workmate'));
alter table app_releases drop constraint if exists app_releases_range_ck;
alter table app_releases
  add constraint app_releases_range_ck check (
    (app = 'attendance' and version_code < 1000) or (app = 'workmate' and version_code >= 1000));
alter table app_releases drop constraint if exists app_releases_pkey;
alter table app_releases
  add constraint app_releases_pkey primary key (app, version_code);
alter table app_releases drop constraint if exists app_releases_path_ck;
alter table app_releases
  add constraint app_releases_path_ck check (
    storage_path = case app
                     when 'attendance' then version_code::text || '.apk'
                     else app || '/' || version_code::text || '.apk'
                   end);

-- Old phones: same name, no argument, same columns. Attendance stream only.
create or replace function app_latest_release()
returns table (
  version_code  integer,
  version_name  text,
  release_notes text,
  storage_path  text,
  size_bytes    bigint,
  sha256        text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.version_code, r.version_name, r.release_notes,
         r.storage_path, r.size_bytes, r.sha256
    from app_releases r
   where r.app = 'attendance'
   order by r.version_code desc
   limit 1;
$$;

-- WorkMate (and any later app): latest release of the named stream.
create or replace function app_latest_release_for(p_app text)
returns table (
  version_code  integer,
  version_name  text,
  release_notes text,
  storage_path  text,
  size_bytes    bigint,
  sha256        text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.version_code, r.version_name, r.release_notes,
         r.storage_path, r.size_bytes, r.sha256
    from app_releases r
   where r.app = p_app
   order by r.version_code desc
   limit 1;
$$;

create or replace function app_list_releases()
returns setof app_releases
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if is_owner() is not true then
    raise exception 'OWNER_REQUIRED' using errcode = 'P0001';
  end if;
  return query select * from app_releases order by app, version_code desc;
end;
$$;

-- ── 4. Publish into one stream ──────────────────────────────────────
drop function if exists app_publish_release(integer, text, text, bigint, text);

create or replace function app_publish_release(
  p_version_code  integer,
  p_version_name  text,
  p_release_notes text,
  p_size_bytes    bigint,
  p_sha256        text,
  p_app           text default 'attendance'
)
returns app_releases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app      text := coalesce(p_app, 'attendance');
  v_path     text;
  v_latest   integer;
  v_min      integer;
  v_obj_size bigint;
  v_row      app_releases;
begin
  if is_owner() is not true then
    raise exception 'OWNER_REQUIRED' using errcode = 'P0001';
  end if;
  if v_app not in ('attendance', 'workmate') then
    raise exception 'APP_UNKNOWN' using errcode = 'P0001', detail = v_app;
  end if;

  v_path := case v_app
              when 'attendance' then p_version_code::text || '.apk'
              else v_app || '/' || p_version_code::text || '.apk'
            end;

  lock table app_releases in share row exclusive mode;

  select coalesce(max(version_code), 0) into v_latest
    from app_releases where app = v_app;
  select coalesce(max(case v_app when 'workmate' then min_workmate_version else min_app_version end), 0)
    into v_min from attendance_config;

  if p_version_code is null or p_version_code <= greatest(v_latest, v_min) then
    raise exception 'VERSION_NOT_NEWER' using errcode = 'P0001',
      detail = format('app=%s latest=%s minimum=%s', v_app, v_latest, v_min);
  end if;

  select (o.metadata ->> 'size')::bigint into v_obj_size
    from storage.objects o
   where o.bucket_id = 'app-releases' and o.name = v_path;
  if v_obj_size is null then
    raise exception 'APK_NOT_UPLOADED' using errcode = 'P0001';
  end if;
  if v_obj_size <> p_size_bytes then
    raise exception 'APK_SIZE_MISMATCH' using errcode = 'P0001',
      detail = format('uploaded=%s declared=%s', v_obj_size, p_size_bytes);
  end if;

  insert into app_releases (app, version_code, version_name, release_notes,
                            storage_path, size_bytes, sha256, published_by)
  values (v_app, p_version_code, btrim(p_version_name),
          nullif(btrim(coalesce(p_release_notes, '')), ''),
          v_path, p_size_bytes, lower(p_sha256), auth.uid())
  returning * into v_row;

  -- One APK serves every owner's workers: raise THIS app's minimum everywhere.
  if v_app = 'workmate' then
    update attendance_config
       set min_workmate_version = p_version_code
     where min_workmate_version < p_version_code;
    insert into attendance_config (owner_id, min_workmate_version)
    values (auth.uid(), p_version_code)
    on conflict (owner_id) do nothing;
  else
    update attendance_config
       set min_app_version = p_version_code
     where min_app_version < p_version_code;
    insert into attendance_config (owner_id, min_app_version)
    values (auth.uid(), p_version_code)
    on conflict (owner_id) do nothing;
  end if;

  return v_row;
end;
$$;

-- ── 5. Grants ───────────────────────────────────────────────────────
-- A NEW function is executable by PUBLIC (which includes anon) AND, in this
-- project, directly by anon/authenticated through Supabase's default
-- privileges (the reason 0080 exists). So each new function is revoked from
-- public AND anon by name. Existing functions replaced above keep the
-- grants 0077/0079/0080 gave them.
revoke all on function dacs_request_app() from public, anon, authenticated;
revoke all on function attendance_required_app_version(uuid) from public, anon, authenticated;
revoke all on function app_latest_release_for(text) from public;
grant execute on function app_latest_release_for(text) to anon, authenticated;
revoke all on function app_publish_release(integer, text, text, bigint, text, text) from public;
revoke execute on function app_publish_release(integer, text, text, bigint, text, text) from anon;
grant execute on function app_publish_release(integer, text, text, bigint, text, text) to authenticated;

-- ── 6. Owner can remove an unpublished APK (fixes 0079) ─────────────
create or replace function app_release_path_published(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_releases r where r.storage_path = p_path)
$$;
revoke all on function app_release_path_published(text) from public, anon;
grant execute on function app_release_path_published(text) to authenticated;

drop policy if exists app_releases_owner_delete on storage.objects;
create policy app_releases_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'app-releases' and is_owner() and not app_release_path_published(name));
```

- [ ] **Step 4: Run the CI guard**

Run: `node tests/app-streams.test.js`
Expected: `14 passed, 0 failed`, exit 0. If a check fails, the SQL differs from this plan: fix the SQL, never the test.

- [ ] **Step 5: Dry run on production inside a transaction that is thrown away**

Build one query: the line `begin;`, then the full contents of `0082_workmate_app_streams.sql`, then the full contents of `supabase/tests/app_streams.sql`. The check's own `begin;` only warns inside an open transaction, and its final `rollback;` discards everything, the migration included. Run it through the Supabase MCP `execute_sql` tool (project `hqbgduyonlbbsvjuapre`).
Expected: one row, `app streams: all checks passed`.
Then confirm nothing persisted:
`select exists (select 1 from information_schema.columns where table_name = 'app_releases' and column_name = 'app') as leaked;` → `false`.

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: exit 0 (12 suites).

- [ ] **Step 7: Checkpoint (user commits)**

Stop and tell the user: "Task 2 ready to commit: `supabase/migrations/0082_workmate_app_streams.sql`, `supabase/tests/app_streams.sql`. Dry run passed; NOT applied to production."

---

### Task 3: The publisher recognises both apps

**Files:**
- Modify: `js/app-updates-admin.js` (constants at lines 18-20; `refusalFor` at 159-178; the `pure` export at 184; the screen in `render()` at 219-380)
- Modify: `tests/app-updates.test.js`

**Interfaces:**
- Consumes: Task 2's `app_publish_release(..., p_app)` and `app_list_releases()` rows, which now include `app`.
- Produces (pure, exported for Node): `APPS`, `appForPackage(packageName) → 'attendance' | 'workmate' | null`, `storagePathFor(app, versionCode) → string`, `refusalFor(manifest, latest) → string | null`, where `latest` is a number (compared against the file's own app, the old behaviour) or an object `{ attendance: n, workmate: m }`.

- [ ] **Step 1: Write the failing tests**

In `tests/app-updates.test.js`, directly before the line `  console.log('\nIII. The hash every phone checks against');`, insert:

```js
  console.log('\nII-b. Two apps: DACS Attendance and DAC\'S WorkMate');
  const wm = { packageName: 'com.dacs.workmate', versionCode: 1000, versionName: '1.0.0' };
  await test('the package name picks the app', () => {
    eq(au.appForPackage('com.dacs.attendance'), 'attendance');
    eq(au.appForPackage('com.dacs.workmate'), 'workmate');
    eq(au.appForPackage('com.example.other'), null);
  });
  await test('a first WorkMate release is accepted', () => eq(au.refusalFor(wm, { attendance: 4, workmate: 0 }), null));
  await test('each app is compared with its OWN latest version', () => {
    eq(au.refusalFor(real, { attendance: 4, workmate: 1500 }), null);
    ok(/already published/.test(au.refusalFor({ ...wm, versionCode: 1500 }, { attendance: 4, workmate: 1500 })));
  });
  await test('a WorkMate build below 1000 is refused', () =>
    ok(/1000/.test(au.refusalFor({ ...wm, versionCode: 12 }, { attendance: 4, workmate: 0 }))));
  await test('an Attendance build of 1000 or more is refused', () =>
    ok(/below 1000/.test(au.refusalFor({ ...real, versionCode: 1000 }, { attendance: 4, workmate: 0 }))));
  await test('a WorkMate debug build is refused by name', () =>
    ok(/DEBUG/.test(au.refusalFor({ ...wm, packageName: 'com.dacs.workmate.debug' }, 0))));
  await test('storage paths: Attendance at the root, WorkMate under workmate/', () => {
    eq(au.storagePathFor('attendance', 5), '5.apk');
    eq(au.storagePathFor('workmate', 1003), 'workmate/1003.apk');
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node tests/app-updates.test.js`
Expected: exit 1. The seven `II-b` tests FAIL (`au.appForPackage is not a function`, or `This is not the DACS Attendance app`). Every earlier test still passes.

- [ ] **Step 3: Implement the pure half**

In `js/app-updates-admin.js`, replace

```js
    const BUCKET = 'app-releases';
    const PACKAGE = 'com.dacs.attendance';
    const APK_MIME = 'application/vnd.android.package-archive';
```

with

```js
    const BUCKET = 'app-releases';
    const APK_MIME = 'application/vnd.android.package-archive';

    // Two worker apps on one backend (0082). The package name inside the APK
    // decides which stream a file is published into; the owner never picks.
    // Attendance versionCodes stay below 1000, WorkMate's start at 1000
    // (0078's trusted-time rule treats builds below 3 as legacy).
    const APPS = {
        attendance: {
            packageName: 'com.dacs.attendance',
            label: 'DACS Attendance',
            bump: 'Raise versionCode in build.gradle.kts',
            release: 'Build the signed release APK (assembleRelease) and upload that.',
            codeOk: (code) => code < 1000,
            codeRule: 'DACS Attendance version numbers must stay below 1000 (1000 and up belong to DAC\'S WorkMate).'
        },
        workmate: {
            packageName: 'com.dacs.workmate',
            label: 'DAC\'S WorkMate',
            bump: 'Raise the build number after "+" in pubspec.yaml',
            release: 'Build the signed release APK (flutter build apk --release) and upload that.',
            codeOk: (code) => code >= 1000,
            codeRule: 'DAC\'S WorkMate version numbers start at 1000. Set version: x.y.z+1000 (or higher) in pubspec.yaml.'
        }
    };

    function appForPackage(packageName) {
        for (const key of Object.keys(APPS)) if (APPS[key].packageName === packageName) return key;
        return null;
    }

    function storagePathFor(app, versionCode) {
        return app === 'attendance' ? versionCode + '.apk' : app + '/' + versionCode + '.apk';
    }
```

Then replace the whole `refusalFor` function (its doc comment included) with

```js
    /**
     * Why this file may not be published, in the owner's words -- or null.
     * [latest] is the highest version already published: a number (compared
     * with the file's own app), or { attendance: n, workmate: m }.
     */
    function refusalFor(manifest, latest) {
        if (!manifest || !manifest.packageName) return 'This file is not an Android app.';
        for (const key of Object.keys(APPS)) {
            if (manifest.packageName === APPS[key].packageName + '.debug') {
                return 'This is a DEBUG build. Phones cannot install it as an update. ' + APPS[key].release;
            }
        }
        const app = appForPackage(manifest.packageName);
        if (!app) {
            return 'This is not the DACS Attendance app or DAC\'S WorkMate (' + manifest.packageName + ').';
        }
        if (!manifest.versionCode) return 'Could not read the version number from this file.';
        if (!APPS[app].codeOk(manifest.versionCode)) return APPS[app].codeRule;
        const published = typeof latest === 'number' ? latest : ((latest && latest[app]) || 0);
        if (manifest.versionCode <= published) {
            return 'This is version ' + manifest.versionCode + ', but version ' + published +
                   ' is already published. ' + APPS[app].bump + ', rebuild, and upload again.';
        }
        return null;
    }
```

Replace

```js
    const pure = { readApkManifest, sha256Hex, refusalFor, formatSize };
```

with

```js
    const pure = { readApkManifest, sha256Hex, refusalFor, formatSize, appForPackage, storagePathFor, APPS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/app-updates.test.js`
Expected: every test passes, including the earlier ones (`another app is refused` still matches `/not the DACS Attendance app/`). Section IV prints SKIP unless an Attendance APK has been built next door.

- [ ] **Step 5: Update the screen**

In `render()`:

(a) Replace the header sub-line text
`'<div class="att-sub">Publish a new version of the worker app. Every phone on an older version must update before it can Time In or Time Out.</div>'`
with
`'<div class="att-sub">Publish a new version of a worker app: DACS Attendance or DAC\'S WorkMate. The file itself says which app it is. Every phone on an older version of that app must update before it can Time In or Time Out.</div>'`

(b) Replace the `latest()` function

```js
        function latest() {
            return releases.length ? releases[0].version_code : 0;
        }
```

with

```js
        // Highest published version per app. Rows arrive ordered by app, then newest first.
        function latest() {
            const out = { attendance: 0, workmate: 0 };
            for (const r of releases) {
                const app = r.app || 'attendance';
                if (r.version_code > (out[app] || 0)) out[app] = r.version_code;
            }
            return out;
        }
```

(c) In `paintHistory()`, replace the table head and row template so each row shows its app and "Current" marks the newest row **of each app**:

```js
            const seen = {};
            history.innerHTML =
                '<table class="att-table"><thead><tr>' +
                '<th>App</th><th>Version</th><th>What\'s new</th><th>Size</th><th>Published</th><th></th>' +
                '</tr></thead><tbody>' +
                releases.map((r) => {
                    const app = r.app || 'attendance';
                    const current = !seen[app];
                    seen[app] = true;
                    return '<tr>' +
                        '<td>' + esc((APPS[app] && APPS[app].label) || app) + '</td>' +
                        '<td><strong>' + esc(r.version_name) + '</strong> <span class="att-mono">(' + esc(r.version_code) + ')</span></td>' +
                        '<td>' + (r.release_notes ? esc(r.release_notes) : '<span class="att-note">—</span>') + '</td>' +
                        '<td class="att-mono">' + esc(formatSize(r.size_bytes)) + '</td>' +
                        '<td>' + esc(new Date(r.published_at).toLocaleString('en-PH',
                            { dateStyle: 'medium', timeStyle: 'short' })) + '</td>' +
                        '<td>' + (current ? '<span class="att-pill att-pill--done">Current</span>' : '') + '</td>' +
                        '</tr>';
                }).join('') +
                '</tbody></table>';
```

(this replaces everything from `history.innerHTML =` to the closing `'</tbody></table>';` inside `paintHistory`; the empty-state branch above it stays).

(d) In the file-change handler, replace

```js
                facts.innerHTML =
                    '<strong>Version ' + esc(manifest.versionName || '?') + '</strong> ' +
```

with

```js
                facts.innerHTML =
                    '<strong>' + esc(APPS[appForPackage(manifest.packageName)].label) + '</strong> · ' +
                    '<strong>Version ' + esc(manifest.versionName || '?') + '</strong> ' +
```

(e) In the publish click handler, replace

```js
            const m = picked.manifest;
            const ok = confirm(
                'Publish version ' + (m.versionName || m.versionCode) + '?\n\n' +
                'Every phone on an older version will be BLOCKED from Time In and Time Out ' +
```

with

```js
            const m = picked.manifest;
            const app = appForPackage(m.packageName);
            const ok = confirm(
                'Publish ' + APPS[app].label + ' version ' + (m.versionName || m.versionCode) + '?\n\n' +
                'Every phone on an older version of ' + APPS[app].label + ' will be BLOCKED from Time In and Time Out ' +
```

then replace `const path = m.versionCode + '.apk';` with `const path = storagePathFor(app, m.versionCode);`, and add `p_app: app` to the `app_publish_release` call's parameter object, after `p_sha256: picked.sha`.

(f) In `publishError`, add before the final `return`:

```js
        if (text.includes('APP_UNKNOWN')) return 'This app is not recognised by the server. Reload the page.';
```

- [ ] **Step 6: Verify**

Run: `node --check js/app-updates-admin.js`, then `node tests/app-updates.test.js`, then `npm test`.
Expected: no syntax output; every app-updates test passes; `npm test` exit 0.

- [ ] **Step 7: Checkpoint (user commits)**

Stop and tell the user: "Task 3 ready to commit: `js/app-updates-admin.js`, `tests/app-updates.test.js`."

---

### Task 4: Apply to production and verify

**Files:** none changed.

- [ ] **Step 1: Ask for the go-ahead**

Tell the user, in plain words: "Ready to apply 0082. Phones on the old Attendance app are not affected: same update check, same minimum (3). WorkMate gets its own minimum and update stream. Apply now?" **Do not continue without an explicit yes in this session.** Tell them plainly: run **only** `0082_workmate_app_streams.sql`, nothing else.

- [ ] **Step 2: Apply**

Apply the file with the Supabase MCP `apply_migration` tool (name `0082_workmate_app_streams`, query = the file contents). If the user applies it in the SQL editor instead, note that (no `schema_migrations` row).

- [ ] **Step 3: Live check**

Run `supabase/tests/app_streams.sql` through the MCP `execute_sql` tool.
Expected: `app streams: all checks passed`.

- [ ] **Step 4: Old app still gets its update info**

Run: `select * from app_latest_release();`
Expected: the same result as before the migration (today: no rows, nothing published yet). No error.

- [ ] **Step 5: The storage check from 0081 still passes**

Run `supabase/tests/uploads_access.sql`.
Expected: `uploads access: all checks passed` (0082 touches no storage policy; this confirms it).

- [ ] **Step 6: Owner screen**

Ask the user to open `admin.html` as the owner → Attendance → App updates. Expected: the page loads, the history says "Nothing published yet" (or lists releases with an **App** column), and choosing a non-APK file shows "This file could not be read as an Android app".

---

### Task 5: Documentation

**Files:**
- Modify: `docs/DATABASE_SCHEMA.md`, directly after the paragraph that begins `**Minimum worker-app version (\`0077\`).**` (it ends with the `insert into attendance_config … on conflict …` line)
- Modify: `supabase/migrations/README.md` (the "Next number" line)

- [ ] **Step 1: DATABASE_SCHEMA.md**

Insert after that paragraph:

```markdown
**Two worker apps (`0082`).** DAC'S WorkMate (Flutter, Android id `com.dacs.workmate`) runs beside
the old DACS Attendance app (`com.dacs.attendance`) on the same backend. WorkMate sends
`x-dacs-app: workmate`; no header means `attendance`, so old phones are unaffected
(`dacs_request_app()`). Each app has its own minimum: `attendance_config.minAppVersion` (Attendance)
and `minWorkmateVersion` (WorkMate), chosen by `attendance_required_app_version(owner)` inside the
0077 trigger. **WorkMate versionCodes start at 1000; Attendance stays below 1000.** The database
enforces this, because 0078 trusts the phone clock for builds below 3 and `timeinAppVersion` stores
the number without an app name. `app_releases` has an `app` column and the key `(app, version_code)`;
Attendance files are `<code>.apk`, WorkMate files `workmate/<code>.apk`. Old phones call
`app_latest_release()` (Attendance stream only); WorkMate calls `app_latest_release_for('workmate')`.
`app_publish_release(..., p_app)` raises only that app's minimum. The publisher
(`js/app-updates-admin.js`) reads the package name from the APK and picks the stream itself.
```

- [ ] **Step 2: migrations README**

Replace

```
- **Next number = highest existing + 1** (**0082** — highest on disk is
  `0081_uploads_access_repair.sql`). Sort the folder before you pick; don't
```

with

```
- **Next number = highest existing + 1** (**0083** — highest on disk is
  `0082_workmate_app_streams.sql`). Sort the folder before you pick; don't
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: exit 0.

- [ ] **Step 4: Checkpoint (user commits)**

Stop and tell the user: "Task 5 ready to commit: `docs/DATABASE_SCHEMA.md`, `supabase/migrations/README.md`."

---

## Self-review against the spec and roadmap

| Requirement | Covered by |
|---|---|
| Spec §1: "Preserve the existing Attendance rules, worker accounts and historical records through the shared backend" | No change to attendance tables' rows, RPCs or accounts; the gate keeps 0077's semantics per app (Task 2); live check section 2 |
| Spec §1: installation/update path must be specified for a new app | Two release streams + WorkMate path + `app_latest_release_for` (Task 2); publisher (Task 3) |
| Roadmap: the old app keeps being maintained | Its stream, path, minimum and RPC are unchanged (Tasks 2 and 3; live check sections 1 and 3; Task 4 Step 4) |
| Roadmap: WorkMate 1000+, `x-dacs-app: workmate` | Range constraint, header function (Task 2); publisher rules (Task 3) |
| 0078 trusted time not bypassable by the new app | 1000+ range makes `< 3` unreachable for WorkMate (Why 1000+; Task 2 range check) |
| CLAUDE.md: migration number, no SQL-editor DDL, docs fan-out | 0082 via `apply_migration` (Task 4); README + schema doc (Task 5) |

Out of scope here, by design: the Flutter app itself (plan 0B), the old app's switch-over card (plan 0E).
