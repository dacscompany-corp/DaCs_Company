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
