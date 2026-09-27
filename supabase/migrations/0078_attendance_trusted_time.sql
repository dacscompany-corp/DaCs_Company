-- 0078 — Close the weekly-reward loophole with evidence, not approval.
--
-- ── THE LOOPHOLE (found 2026-09-27). The ₱500 reward judges lateness on
--    `timein_at`, which is the PHONE's clock. The server only refuses a
--    capture time in the FUTURE; a time in the past is exactly what an
--    honest offline queue sends, so it is accepted. Set the phone clock back,
--    switch on airplane mode, Time In, reconnect: the day arrives "on time".
--    And because 0069 softens `outside_radius` to a flag whenever the phone
--    SAYS it was offline, the same trick also escaped the geofence.
--
-- ── WHY NOT "AN ADMIN APPROVES FLAGGED DAYS". 0066's header makes it the
--    single most important property of the reward that no admin action can
--    move anyone's ₱500. An approval queue would break that, and ~30% of
--    September's Time Ins carry an uncertain location (weak GPS), so it
--    would also be a weekly chore. This migration decides from EVIDENCE the
--    record already carries, automatically. The 0066 rule stands.
--
-- Three parts, each covering a gap the others leave:
--
--  1. A TRUSTED TIME. From versionCode 3 the app anchors the server's clock
--     (the HTTP Date header of its last response) to the phone's uptime
--     counter, which the phone's clock setting cannot touch, and sends the
--     shutter time measured that way as p_trusted_at. Stored as
--     timein_trusted_at / timeout_trusted_at. A reboot breaks the anchor,
--     and the app then sends null rather than guess.
--
--  2. THE REWARD JUDGES THE TIME IT CAN VOUCH FOR (attendance_week_days).
--        trusted time when there is one;
--        else, from a build too OLD to send one (versionCode < 3, or no
--          version at all), the phone's time exactly as before 0078;
--        else the phone's time IF it reached the server within 3 minutes
--          (the server's own clock then corroborates it);
--        else nothing -- the day is 'unverified'.
--
--     ── WHY OLD BUILDS KEEP THE OLD RULE. Measured 2026-09-27: 6 of
--        September's 49 Time Ins reached the server more than 3 minutes
--        after the shutter -- up to a day later -- with good locations and
--        ordinary times, none of them flagged offline. Honest workers on
--        weak signal. Judging old builds strictly would have cost them the
--        bonus for a reading their app could not take. Old builds are
--        retired instead by 0077: raise min_app_version to 3 and they
--        cannot record at all. Each row now stores the build that sent it
--        (timein_app_version) so the rule can tell them apart.
--     And a Time In whose location is KNOWN BAD -- outside_radius,
--     mock_location, permission_denied -- is 'unverified' too, however
--     early it was. Uncertain locations (low_accuracy, location_unavailable,
--     no fence configured) still count: a cheap phone under scaffolding is
--     not a cheat, and 0069's "refuse only what is known bad" holds here.
--     An 'unverified' day is a day worked that cannot earn the bonus. It
--     disqualifies the week, like a late day, and says why.
--
--  3. "OFFLINE" MUST BE TRUE TO SOFTEN THE FENCE. attendance_location_refuses
--     now receives offline = (the phone said so) AND (the capture is more
--     than 3 minutes old by the best clock available). A phone that claims
--     offline and uploads at once is judged live, so outside_radius is
--     refused as 0069 intended.
--
-- ── WHAT THIS CANNOT STOP. A modified APK can send any p_trusted_at it
--    likes. Defeating that needs device attestation (Play Integrity), which
--    is a separate decision. This closes the trick an ordinary worker can do
--    from the Settings app.
--
-- ── ROLLOUT. Apply this BEFORE installing versionCode 3: that build sends
--    p_trusted_at, and against the old 12-argument functions PostgREST
--    would find no match and every Time In would sit in the queue.
--    Old builds keep working and are judged exactly as before (above).
--    Frozen reward rows are never recalculated (0066 §4), so no past week
--    changes. Raise 0077's min_app_version to 3 once the new APK is out --
--    that, not this migration, is what closes the loophole for old builds.
--
-- Outside the money model, like all of attendance.


begin;

-- ── 1. Columns ───────────────────────────────────────────────────────
alter table attendance_records
  add column if not exists timein_trusted_at   timestamptz,
  add column if not exists timeout_trusted_at  timestamptz,
  -- The worker-app versionCode that sent each half (0077's header), null
  -- when none was declared. Tells a build that COULD vouch for its time
  -- from one that could not -- see part 2 of the header.
  add column if not exists timein_app_version  integer,
  add column if not exists timeout_app_version integer;

comment on column attendance_records.timein_trusted_at is
  'Shutter time measured on the phone''s uptime counter from the last server '
  'clock it saw (0078). Null when the app could not vouch for it (old build, '
  'reboot since last contact). The reward judges lateness on this.';

alter table attendance_weekly_rewards
  add column if not exists unverified_days smallint not null default 0;


-- ── 2. The time a record can vouch for ───────────────────────────────
--
-- ONE definition, used by the reward and nothing else, so the rule cannot
-- be restated slightly differently somewhere. Null = no clock vouches.
create or replace function attendance_vouched_time(
  p_trusted_at  timestamptz,
  p_captured_at timestamptz,
  p_received_at timestamptz,
  p_app_version integer
) returns timestamptz language sql immutable parallel safe as $$
  select case
    when p_trusted_at is not null then p_trusted_at
    -- A build that cannot take the reading is judged as before 0078.
    -- 3 is the first versionCode that sends p_trusted_at.
    when coalesce(p_app_version, 0) < 3 then p_captured_at
    when p_received_at is not null and p_captured_at is not null
         and p_received_at - p_captured_at <= interval '3 minutes' then p_captured_at
    else null
  end;
$$;

-- A client-supplied trusted time is accepted only where it is plausible.
-- Outside that window it is dropped (null), never "corrected".
create or replace function attendance_sane_trusted_at(p_trusted_at timestamptz)
returns timestamptz language sql stable as $$
  select case
    when p_trusted_at is null then null
    when p_trusted_at > now() + interval '2 minutes' then null
    when p_trusted_at < now() - interval '30 days' then null
    else p_trusted_at
  end;
$$;


-- ── 3. Time In / Time Out, re-issued with p_trusted_at ───────────────
--
-- Bodies are the LIVE definitions (read from production 2026-09-27, which
-- match 0069) with three changes, each marked 0078: the new parameter, the
-- honest offline test passed to attendance_location_refuses, and the new
-- column written. The old 12-argument signatures are dropped so PostgREST
-- never has two candidates; an old build omitting p_trusted_at resolves to
-- the new one through the default.

drop function if exists attendance_time_in(text, uuid, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean, boolean, boolean);
drop function if exists attendance_time_out(text, uuid, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean, boolean, boolean);

create or replace function attendance_time_in(
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
  p_trusted_at        timestamptz      default null   -- 0078
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

  select * into v_row from attendance_records where timein_event_id = p_event_id;
  if found then
    if v_row.worker_id <> v_uid then
      raise exception 'EVENT_ID_CONFLICT' using errcode = 'P0001';
    end if;
    return v_row;
  end if;

  select p.id,
         p.role,
         p.owner_id,
         p.display_name,
         p.position                    as job_position,
         coalesce(p.status,'active')   as status
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

  if exists (
    select 1 from attendance_records
     where worker_id = v_uid and work_date = v_date and session_seq = 1
  ) then
    raise exception 'ALREADY_TIMED_IN' using errcode = 'P0001';
  end if;

  v_req := coalesce(
    (select a.require_geofence from attendance_config a where a.owner_id = v_owner),
    false
  );

  select * into v_loc from attendance_check_location(
    p_project_system, p_project_id, v_owner, p_captured_at,
    p_lat, p_lng, p_accuracy_m, p_is_mock, p_permission_denied
  );

  -- 0078: offline softens the fence only when it is TRUE -- the capture is
  -- more than 3 minutes old by the best clock we have.
  v_trusted := attendance_sane_trusted_at(p_trusted_at);
  v_offline := coalesce(p_was_offline, false)
               and coalesce(v_trusted, p_captured_at) < now() - interval '3 minutes';

  if attendance_location_refuses(v_loc.status, v_offline, v_req) then
    raise exception '%', upper(v_loc.status) using errcode = 'P0001';
  end if;

  insert into attendance_records (
    owner_id, worker_id, worker_name, worker_position,
    work_date, session_seq, status,
    timein_project_system, timein_folder_id, timein_pm_project_id,
    timein_project_name, timein_at, timein_photo_path,
    timein_description, timein_lat, timein_lng, timein_accuracy_m,
    timein_event_id, timein_was_offline, timein_received_at,
    timein_location_status, timein_distance_m, timein_is_mock,
    timein_geofence_lat, timein_geofence_lng, timein_geofence_radius_m,
    timein_trusted_at, timein_app_version                   -- 0078
  ) values (
    v_owner, v_uid, v_prof.display_name, v_prof.job_position,
    v_date, 1, 'working',
    p_project_system,
    case when p_project_system = 'pc' then p_project_id end,
    case when p_project_system = 'pm' then p_project_id end,
    v_name, p_captured_at, p_photo_path,
    nullif(btrim(coalesce(p_description,'')), ''), p_lat, p_lng, p_accuracy_m,
    p_event_id, coalesce(p_was_offline,false), now(),
    v_loc.status, v_loc.distance_m, coalesce(p_is_mock,false),
    v_loc.fence_lat, v_loc.fence_lng, v_loc.fence_radius_m,
    v_trusted, nullif(attendance_request_app_version(), 0)  -- 0078
  )
  returning * into v_row;

  return v_row;
end $$;

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
  p_trusted_at        timestamptz      default null   -- 0078
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

revoke all on function attendance_time_in(text, uuid, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean, boolean, boolean, timestamptz) from public;
revoke all on function attendance_time_out(text, uuid, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean, boolean, boolean, timestamptz) from public;
grant execute on function attendance_time_in(text, uuid, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean, boolean, boolean, timestamptz) to authenticated;
grant execute on function attendance_time_out(text, uuid, timestamptz, text, uuid, text,
  double precision, double precision, double precision, boolean, boolean, boolean, timestamptz) to authenticated;


-- ── 4. The reward's day breakdown, with 'unverified' ─────────────────
--
-- Same shape as 0066 (attendance_reward_progress returns it verbatim, so
-- the columns must not change). `timein_at` stays the phone's time for
-- display; the STATUS is decided on the vouched time.
create or replace function attendance_week_days(
  p_worker     uuid,
  p_week_start date
) returns table (
  work_date  date,
  required   boolean,
  timein_at  timestamptz,
  start_time time,
  day_status text
) language sql stable security definer set search_path = public as $$
  with owner as (
    select coalesce(p.owner_id, p.id) as owner_id from profiles p where p.id = p_worker
  ),
  sites as (
    select distinct r.timein_project_system as system,
           coalesce(r.timein_folder_id, r.timein_pm_project_id) as id
      from attendance_records r
     where r.worker_id = p_worker
       and r.work_date between p_week_start and p_week_start + 4
       and r.timein_project_system is not null
  ),
  days as (
    select (p_week_start + d)::date as work_date from generate_series(0, 4) as d
  ),
  rec as (
    select r.work_date,
           r.timein_at,
           r.timein_project_system as system,
           coalesce(r.timein_folder_id, r.timein_pm_project_id) as project_id,
           -- 0078
           attendance_vouched_time(r.timein_trusted_at, r.timein_at, r.timein_received_at,
                                   r.timein_app_version) as vouched_at,
           r.timein_location_status in ('outside_radius','mock_location','permission_denied')
             as location_known_bad
      from attendance_records r
     where r.worker_id = p_worker
       and r.work_date between p_week_start and p_week_start + 4
  )
  select
    d.work_date,
    req.required,
    rec.timein_at,
    st.start_time,
    case
      when not req.required then 'not_required'
      when rec.timein_at is null then 'missing'
      -- 0078: a day worked that cannot earn the bonus.
      when coalesce(rec.location_known_bad, false) then 'unverified'
      when rec.vouched_at is null then 'unverified'
      when (rec.vouched_at at time zone 'Asia/Manila')::time > st.start_time then 'late'
      else 'on_time'
    end as day_status
  from days d
  left join rec on rec.work_date = d.work_date
  cross join owner o
  cross join lateral (
    select case
      when not exists (select 1 from sites) then true
      else exists (
        select 1 from sites s
         where attendance_is_required_day(s.system, s.id, o.owner_id, d.work_date)
      )
      and not exists (
        select 1 from sites s
         where not attendance_is_required_day(s.system, s.id, o.owner_id, d.work_date)
      )
    end as required
  ) req
  cross join lateral (
    select coalesce(
      attendance_start_time(rec.system, rec.project_id, o.owner_id),
      (select a.default_start_time from attendance_config a where a.owner_id = o.owner_id),
      '09:00'::time
    ) as start_time
  ) st
  order by d.work_date;
$$;

-- Still internal: see 0066 §2 and 0067.
revoke all on function attendance_week_days(uuid, date) from public;
revoke execute on function attendance_week_days(uuid, date) from authenticated;
revoke execute on function attendance_week_days(uuid, date) from anon;


-- ── 5. Freezing a week counts unverified days ────────────────────────
create or replace function attendance_evaluate_week(
  p_owner      uuid,
  p_week_start date
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_grace  integer;
  v_amount numeric(12,2);
  v_due    timestamptz;
  v_count  integer := 0;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not ((is_owner() or is_staff()) and can_access(p_owner)) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  if extract(isodow from p_week_start) <> 1 then
    raise exception 'WEEK_START_NOT_MONDAY' using errcode = 'P0001';
  end if;

  select coalesce(a.evaluation_grace_hours, 60), coalesce(a.reward_amount, 500)
    into v_grace, v_amount
    from attendance_config a where a.owner_id = p_owner;

  v_grace  := coalesce(v_grace, 60);
  v_amount := coalesce(v_amount, 500);

  v_due := ((p_week_start + 5)::timestamp at time zone 'Asia/Manila')
           + make_interval(hours => v_grace);

  if now() < v_due then
    raise exception 'WEEK_NOT_READY' using errcode = 'P0001';
  end if;

  with roster as (
    select p.id, p.display_name, p.position
      from profiles p
     where coalesce(p.owner_id, p.id) = p_owner
       and p.role in ('worker','teamLeader')
       and coalesce(p.status, 'active') = 'active'
  ),
  tally as (
    select r.id      as worker_id,
           r.display_name,
           r.position,
           count(*) filter (where d.required)                                      as required_days,
           -- 0078: an unverified day was still a day worked.
           count(*) filter (where d.day_status in ('on_time','late','unverified')) as completed_days,
           count(*) filter (where d.day_status = 'on_time')                        as on_time_days,
           count(*) filter (where d.day_status = 'late')                           as late_days,
           count(*) filter (where d.required and d.day_status = 'missing')         as missing_days,
           count(*) filter (where d.required and d.day_status = 'unverified')      as unverified_days
      from roster r
      cross join lateral attendance_week_days(r.id, p_week_start) d
     group by r.id, r.display_name, r.position
  ),
  scored as (
    select t.*,
           (t.required_days > 0 and t.on_time_days >= t.required_days
            and t.late_days = 0 and t.missing_days = 0
            and t.unverified_days = 0) as qualified          -- 0078
      from tally t
  ),
  ins as (
    insert into attendance_weekly_rewards (
      owner_id, worker_id, worker_name, worker_position,
      week_start, week_end,
      required_days, completed_days, on_time_days, late_days, missing_days,
      unverified_days,                                       -- 0078
      status, amount, evaluated_at
    )
    select p_owner, s.worker_id, s.display_name, s.position,
           p_week_start, p_week_start + 4,
           s.required_days, s.completed_days, s.on_time_days, s.late_days, s.missing_days,
           s.unverified_days,
           case when s.qualified then 'qualified' else 'disqualified' end,
           case when s.qualified then v_amount else 0 end,
           now()
      from scored s
    on conflict (worker_id, week_start) do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end $$;

revoke all on function attendance_evaluate_week(uuid, date) from public;
grant execute on function attendance_evaluate_week(uuid, date) to authenticated;

commit;
