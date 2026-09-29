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
