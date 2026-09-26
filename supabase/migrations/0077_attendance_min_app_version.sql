-- 0077 — Refuse attendance from an out-of-date worker APK.
--
-- ── WHY. The Location-off fix (2026-09-15) lives in the APP: the device
--    refuses at the shutter when Location is switched off, and the server
--    never sees that case. So every phone still carrying the old build kept
--    the loophole, and the server had no way to tell old from new -- the app
--    shipped as versionCode 1 and sent nothing that identified it.
--
--    From versionCode 2 the app sends `x-dacs-app-version: <versionCode>` on
--    every request (Dacs Attendance → SupabaseModule.kt). This migration lets
--    the office name a minimum and refuses Time In / Time Out below it.
--
-- ── THE ROLLOUT HAZARD, same shape as 0068's require_geofence.
--    Every phone in the field today sends NO header, which reads as version
--    0. Enforcing on apply would stop every worker from clocking in until
--    they reinstall. So min_app_version SHIPS AT 0 = OFF. Install the new APK
--    on every phone, confirm Time Ins arrive, THEN raise it:
--
--        update attendance_config set min_app_version = 2;
--
--    (a data change, not a schema one -- the no-SQL-editor rule is about DDL.)
--
-- ── NOTHING IS LOST WHEN IT REFUSES. The app maps APP_UPDATE_REQUIRED to a
--    RETRY and keeps the queued row. Room survives an APK update, and the new
--    build resends the same row with its original shutter time. An old build
--    that does not know the code lands on `Unexpected`, which it also retries.
--
-- ── WHY A TRIGGER, NOT THE RPCs. attendance_time_in / _time_out are long and
--    were re-issued by 0051, 0059 and 0069; a fourth rewrite to add one check
--    is where drift comes from. Every worker write reaches attendance_records
--    through those RPCs (workers hold no insert/update policy), so a BEFORE
--    trigger on the table sees all of them, and cannot be skipped by a
--    future RPC that forgets the check.
--
--    It applies only when the caller IS the worker the row belongs to.
--    attendance_abandon (0061) is an ADMIN writing a worker's row from the
--    web portal, which sends no app header and must never be refused here.
--
-- Outside the money model, like all of attendance: no peso column, no
-- accounting side effect.

alter table attendance_config
  add column if not exists min_app_version integer not null default 0;

alter table attendance_config
  drop constraint if exists attendance_config_min_app_version_ck;
alter table attendance_config
  add constraint attendance_config_min_app_version_ck check (min_app_version >= 0);

comment on column attendance_config.min_app_version is
  'Lowest worker-APK versionCode allowed to record Time In / Time Out (0077). '
  '0 = off. Ships 0 because every phone before versionCode 2 sends no version '
  'at all; raise it only after the new APK is on every phone.';


-- The version the calling app declared, or 0 when it declared none.
-- Never raises: a garbled header is treated as "no version", which is what
-- an old build is.
create or replace function attendance_request_app_version()
returns integer language plpgsql stable as $$
declare
  v_headers json;
  v_raw     text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return 0;
  end;
  v_raw := v_headers ->> 'x-dacs-app-version';
  if v_raw is null or v_raw !~ '^[0-9]{1,9}$' then
    return 0;
  end if;
  return v_raw::integer;
end;
$$;


create or replace function attendance_app_version_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min integer;
begin
  -- Only the worker writing their own day. See the header: an admin closing
  -- a forgotten Time Out is not an app and is never refused here.
  if auth.uid() is null or auth.uid() is distinct from new.worker_id then
    return new;
  end if;

  select c.min_app_version into v_min
    from attendance_config c
   where c.owner_id = new.owner_id;

  if coalesce(v_min, 0) > 0 and attendance_request_app_version() < v_min then
    raise exception 'APP_UPDATE_REQUIRED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function attendance_app_version_guard() from public;

drop trigger if exists attendance_records_app_version on attendance_records;
create trigger attendance_records_app_version
  before insert or update on attendance_records
  for each row execute function attendance_app_version_guard();
