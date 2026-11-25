-- ════════════════════════════════════════════════════════════════════
-- 0119 — WorkMate Time Out: work photos and a required note
-- ════════════════════════════════════════════════════════════════════
--
-- Owner decision, 22 Nov 2026: at Time Out a worker takes NO face photo but
-- 3 to 6 photos of the work done, and must type what they did (15+ characters).
-- Time In is unchanged.
--
-- ── STORAGE (approach A). The FIRST work photo stays in timeout_photo_path,
--    so every existing reader (office thumbnails, "Both photos received", the
--    phone's History, the old app) keeps working. The others go in the new
--    timeout_extra_photo_paths (null = none: every older row, every old-app
--    Time Out).
--
-- ── THE CHECK RUNS ONLY WHEN THE APP SENDS WORK PHOTOS (p_extra_photo_paths
--    not null). Two callers legitimately send none and must record exactly as
--    before: the old DACS Attendance app, which cannot be updated, and a Time
--    Out a phone saved offline on WorkMate 1029 and sends after updating (the
--    version header names the app SENDING, not the one that captured it).
--    WorkMate 1030+ always sends them for a Time Out it captured; the app
--    enforces the same rule before SUBMIT.
--
-- ── attendance_time_out is 0078's function, copied VERBATIM, plus: the
--    trailing argument p_extra_photo_paths; the check right after the replay
--    block (a replay returns the stored row first); and the new column in the
--    UPDATE. The 13-argument version is DROPPED first: PostgREST calls by
--    named arguments, and two overloads would make every call ambiguous.
--
-- Outside the money model, like all of attendance.
-- Spec: docs/superpowers/specs/2026-11-22-workmate-timeout-work-photos-design.md
-- Test: supabase/tests/attendance_work_photos.pglite.mjs. Live check: supabase/tests/attendance_checks.sql (0119 block).
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Where the other work photos live ──────────────────────────────
alter table attendance_records
  add column if not exists timeout_extra_photo_paths text[];
comment on column attendance_records.timeout_extra_photo_paths is
  'WorkMate Time Out work photos after the first (0119); the first is timeout_photo_path. '
  'Storage paths in the attendance bucket, in the order taken. Null = none (older rows, the old app).';

-- ── 2. Time Out takes the work photos ────────────────────────────────
drop function if exists attendance_time_out(text, uuid, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean, boolean, boolean, timestamptz);

create or replace function attendance_time_out(
  p_project_system    text,
  p_project_id        uuid,
  p_captured_at       timestamptz,
  p_photo_path        text,
  p_event_id          uuid,
  p_description       text             default null,
  p_lat               double precision default null,
  p_lng               double precision default null,
  p_accuracy_m        double precision default null,
  p_was_offline       boolean          default false,
  p_is_mock           boolean          default false,
  p_permission_denied boolean          default false,
  p_trusted_at        timestamptz      default null,  -- 0078
  p_extra_photo_paths text[]           default null   -- 0119
) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_prof    record;
  v_owner   uuid;
  v_date    date;
  v_name    text;
  v_row     attendance_records;
  v_loc     record;
  v_req     boolean;
  v_trusted timestamptz;   -- 0078
  v_offline boolean;       -- 0078
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if p_event_id is null then
    raise exception 'EVENT_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if coalesce(p_project_system, '') not in ('pc', 'pm') then
    raise exception 'PROJECT_SYSTEM_INVALID' using errcode = 'P0001';
  end if;

  select * into v_row from attendance_records where timeout_event_id = p_event_id;
  if found then
    if v_row.worker_id <> v_uid then
      raise exception 'EVENT_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return v_row;
  end if;

  -- 0119: work photos. Checked ONLY when the app sends them: the old
  -- Attendance app and a Time Out queued before the update send none, and
  -- refusing those would leave the worker unable to Time Out at all.
  if p_extra_photo_paths is not null then
    if cardinality(p_extra_photo_paths) < 2 then
      raise exception 'WORK_PHOTOS_REQUIRED' using errcode = 'P0001';
    end if;
    if cardinality(p_extra_photo_paths) > 5 then
      raise exception 'WORK_PHOTOS_TOO_MANY' using errcode = 'P0001';
    end if;
    if p_photo_path is null
       or exists (select 1 from unnest(array_prepend(p_photo_path, p_extra_photo_paths)) as x(p)
                   where x.p is null
                      or left(x.p, length(v_uid::text) + 1) <> v_uid::text || '/'
                      or right(x.p, 4) <> '.jpg'
                      or strpos(x.p, '..') > 0)
       or (select count(distinct x.p) from unnest(array_prepend(p_photo_path, p_extra_photo_paths)) as x(p))
          <> cardinality(p_extra_photo_paths) + 1 then
      raise exception 'WORK_PHOTO_PATH_INVALID' using errcode = 'P0001';
    end if;
    if char_length(btrim(coalesce(p_description, ''), E' \t\r\n')) < 15 then
      raise exception 'WORK_NOTE_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  select p.id, p.role, p.owner_id, coalesce(p.status,'active') as status
    into v_prof
    from profiles p where p.id = v_uid;

  if not found or coalesce(v_prof.role,'') not in ('worker','teamLeader') then
    raise exception 'NOT_A_WORKER' using errcode = 'P0001';
  end if;
  if v_prof.status <> 'active' then
    raise exception 'ACCOUNT_INACTIVE' using errcode = 'P0001';
  end if;
  if v_prof.owner_id is null then
    raise exception 'NO_OWNER_ASSIGNED' using errcode = 'P0001';
  end if;
  v_owner := v_prof.owner_id;

  if p_captured_at > now() + interval '2 minutes' then
    raise exception 'CAPTURED_IN_FUTURE' using errcode = 'P0001';
  end if;

  v_name := attendance_project_name(p_project_system, p_project_id, v_owner);
  if v_name is null then
    raise exception 'PROJECT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  v_date := (p_captured_at at time zone 'Asia/Manila')::date;

  select * into v_row
    from attendance_records
   where worker_id = v_uid
     and session_seq = 1
     and work_date in (v_date, v_date - 1)
     and status = 'working'
   order by work_date desc
   limit 1
     for update;

  if not found then
    if exists (
      select 1 from attendance_records
       where worker_id = v_uid and work_date = v_date
         and session_seq = 1 and status = 'complete'
    ) then
      raise exception 'ALREADY_COMPLETE' using errcode = 'P0001';
    end if;
    raise exception 'NOT_TIMED_IN' using errcode = 'P0001';
  end if;

  if p_captured_at < v_row.timein_at then
    raise exception 'TIMEOUT_BEFORE_TIMEIN' using errcode = 'P0001';
  end if;

  if p_captured_at - v_row.timein_at > interval '18 hours' then
    raise exception 'SHIFT_TOO_LONG' using errcode = 'P0001';
  end if;

  v_req := coalesce(
    (select a.require_geofence from attendance_config a where a.owner_id = v_owner),
    false
  );

  select * into v_loc from attendance_check_location(
    p_project_system, p_project_id, v_owner, p_captured_at,
    p_lat, p_lng, p_accuracy_m, p_is_mock, p_permission_denied
  );

  -- 0078: see attendance_time_in.
  v_trusted := attendance_sane_trusted_at(p_trusted_at);
  v_offline := coalesce(p_was_offline, false)
               and coalesce(v_trusted, p_captured_at) < now() - interval '3 minutes';

  if attendance_location_refuses(v_loc.status, v_offline, v_req) then
    raise exception '%', upper(v_loc.status) using errcode = 'P0001';
  end if;

  update attendance_records
     set status                = 'complete',
         timeout_project_system = p_project_system,
         timeout_folder_id      = case when p_project_system = 'pc' then p_project_id end,
         timeout_pm_project_id  = case when p_project_system = 'pm' then p_project_id end,
         timeout_project_name  = v_name,
         timeout_at            = p_captured_at,
         timeout_photo_path    = p_photo_path,
         timeout_extra_photo_paths = p_extra_photo_paths,       -- 0119
         timeout_description   = nullif(btrim(coalesce(p_description,'')), ''),
         timeout_lat           = p_lat,
         timeout_lng           = p_lng,
         timeout_accuracy_m    = p_accuracy_m,
         timeout_event_id      = p_event_id,
         timeout_was_offline   = coalesce(p_was_offline,false),
         timeout_received_at   = now(),
         timeout_location_status   = v_loc.status,
         timeout_distance_m        = v_loc.distance_m,
         timeout_is_mock           = coalesce(p_is_mock,false),
         timeout_geofence_lat      = v_loc.fence_lat,
         timeout_geofence_lng      = v_loc.fence_lng,
         timeout_geofence_radius_m = v_loc.fence_radius_m,
         timeout_trusted_at        = v_trusted,                -- 0078
         timeout_app_version       = nullif(attendance_request_app_version(), 0),
         total_minutes         = floor(extract(epoch from (p_captured_at - timein_at)) / 60)::int
   where id = v_row.id
  returning * into v_row;

  return v_row;
end $$;

revoke all on function attendance_time_out(text, uuid, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean, boolean, boolean, timestamptz, text[]) from public;
grant execute on function attendance_time_out(text, uuid, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean, boolean, boolean, timestamptz, text[]) to authenticated;
