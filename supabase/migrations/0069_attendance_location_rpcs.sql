-- ════════════════════════════════════════════════════════════════════
-- 0069_attendance_location_rpcs.sql
--
-- LOCATION VERIFICATION on the write path. 0068 built what we verify
-- against; this is the verifying.
--
-- ── THE RULE, AND THE ONE PIECE OF IT THAT IS EASY TO GET WRONG.
--
--    A refusal happens only when the location is KNOWN BAD. Uncertainty
--    is recorded and flagged, never refused:
--
--      outside_radius   → refused. We know they were somewhere else.
--      mock_location    → refused. Never accidental.
--      permission_denied→ refused. A choice, not a limitation.
--      low_accuracy     → RECORDED, flagged. The phone could not tell.
--      location_unavailable → RECORDED, flagged. Same.
--
--    That is what keeps a worker under scaffolding, on a cheap phone
--    that cannot hold a fix, from losing ₱500 for their employer's
--    choice of hardware. Only being demonstrably elsewhere costs them
--    the day.
--
-- ── THE PART A NAIVE IMPLEMENTATION BREAKS: `p_was_offline`.
--
--    An offline submission was already pre-checked ON THE DEVICE, and
--    the worker was already shown "saved" — days ago, possibly. If the
--    server then refuses it outright, a record the worker was told they
--    had simply vanishes, with no way for them to prove otherwise.
--
--    So OUTSIDE_RADIUS refuses a LIVE submission and is KEPT AND FLAGGED
--    on a queued one. The admin sees the disagreement and can ask about
--    it; destroying a day of recorded work is the worse error.
--
--    KNOWN HOLE, ACCEPTED: p_was_offline is client-supplied, so a
--    modified client could always claim offline to downgrade a refusal
--    into a flag. The mitigation is that it lands in front of an admin
--    rather than passing silently. It is a review queue, not a wall.
--
-- ── WHY THE CLIENT REPORTS SOME OF THIS. The server is authoritative on
--    GEOMETRY — the fence, the distance, the radius — and cannot be
--    lied to about it. But it cannot see whether the worker denied the
--    permission or simply got no fix; both arrive as null coordinates.
--    Only the device knows, so the device says, and the server trusts it
--    for exactly that and nothing else.
--
-- ── OLD SIGNATURES ARE DROPPED, NOT LEFT BESIDE THE NEW ONES.
--    0059's header explains why: `create or replace` with a different
--    parameter list makes a SECOND function, and the shipped app would
--    go on calling the old one, unverified, forever. The new parameters
--    carry defaults, so an app built against the 10-argument call still
--    resolves here.
--
-- ── STILL OUTSIDE THE MONEY MODEL. No peso column, nothing feeds
--    Spent / Earned / Profit.
--
-- Idempotent -- safe to re-run.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. The policy, in exactly one place ─────────────────────────────
--
-- Both RPCs call this, so Time In and Time Out cannot drift into
-- disagreeing about what is refusable -- the same reasoning 0059 gives
-- for sharing attendance_project_name between them.
create or replace function attendance_location_refuses(
  p_status           text,
  p_was_offline      boolean,
  p_require_geofence boolean
) returns boolean language sql immutable parallel safe as $$
  select case p_status
    -- Never accidental, and the app blocks both locally. One arriving
    -- here means a client that did not.
    when 'mock_location'     then true
    when 'permission_denied' then true

    -- Known to be elsewhere. Refused live; kept and flagged when the
    -- device already told the worker it saved.
    when 'outside_radius'    then not coalesce(p_was_offline, false)

    -- An admin has not configured the site. Only refusable once
    -- geofences are required at all -- and still not on a queued record,
    -- for the same reason as above: the fence may have been removed
    -- after the worker captured against it.
    when 'project_geofence_unavailable'
      then coalesce(p_require_geofence, false) and not coalesce(p_was_offline, false)

    -- 'verified', 'low_accuracy', 'location_unavailable': either fine,
    -- or we cannot tell. Never a refusal.
    else false
  end;
$$;


-- ── 2. The check, in exactly one place ──────────────────────────────
--
-- Returns the §33 result code plus the evidence to snapshot. Distance is
-- computed whenever there is both a fix and a fence, even when the
-- status is already decided -- an admin reviewing a flagged record wants
-- to know how far off it was, not just that it was uncertain.
create or replace function attendance_check_location(
  p_system            text,
  p_id                uuid,
  p_owner             uuid,
  p_at                timestamptz,
  p_lat               double precision,
  p_lng               double precision,
  p_accuracy_m        double precision,
  p_is_mock           boolean,
  p_permission_denied boolean
) returns table (
  status         text,
  distance_m     double precision,
  fence_lat      double precision,
  fence_lng      double precision,
  fence_radius_m numeric
) language plpgsql stable security definer set search_path = public as $$
declare
  v_min   numeric;
  v_fence attendance_project_geofence;
  v_dist  double precision;
  v_stat  text;
begin
  v_min := coalesce(
    (select a.min_accuracy_m from attendance_config a where a.owner_id = p_owner),
    50
  );

  v_fence := attendance_geofence_at(p_system, p_id, p_owner, p_at);

  -- `v_fence IS NULL` would be wrong here: for a composite it is true
  -- only when EVERY field is null. id is NOT NULL in the table, so it is
  -- the unambiguous test for "no row".
  if v_fence.id is not null and p_lat is not null and p_lng is not null then
    v_dist := attendance_distance_m(v_fence.latitude, v_fence.longitude, p_lat, p_lng);
  end if;

  v_stat := case
    when coalesce(p_permission_denied, false) then 'permission_denied'
    when coalesce(p_is_mock, false)           then 'mock_location'
    when p_lat is null or p_lng is null       then 'location_unavailable'
    when p_accuracy_m is null or p_accuracy_m > v_min then 'low_accuracy'
    when v_fence.id is null or not v_fence.enabled    then 'project_geofence_unavailable'
    when v_dist > v_fence.radius_m            then 'outside_radius'
    else 'verified'
  end;

  return query select
    v_stat,
    v_dist,
    v_fence.latitude,
    v_fence.longitude,
    v_fence.radius_m;
end $$;

-- Internal to the two RPCs, which are security definer and reach it as
-- the function owner. The roles are named explicitly: Supabase's default
-- privileges grant every new function to anon and authenticated
-- directly, so `revoke from public` alone would leave it open -- the
-- mistake 0066 made and 0067 had to clean up.
revoke all on function attendance_check_location(
  text, uuid, uuid, timestamptz, double precision, double precision,
  double precision, boolean, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function attendance_check_location('
         || 'text, uuid, uuid, timestamptz, double precision, double precision, '
         || 'double precision, boolean, boolean) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_check_location('
         || 'text, uuid, uuid, timestamptz, double precision, double precision, '
         || 'double precision, boolean, boolean) from anon';
  end if;
end $$;


-- ── 3. Drop the old signatures ──────────────────────────────────────
drop function if exists attendance_time_in(text, uuid, timestamptz, text, uuid, text,
                                           double precision, double precision,
                                           double precision, boolean);
drop function if exists attendance_time_out(text, uuid, timestamptz, text, uuid, text,
                                            double precision, double precision,
                                            double precision, boolean);


-- ── 4. Time In ──────────────────────────────────────────────────────
create or replace function attendance_time_in(
  p_project_system text,
  p_project_id  uuid,
  p_captured_at timestamptz,
  p_photo_path  text,
  p_event_id    uuid,
  p_description text             default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy_m  double precision default null,
  p_was_offline boolean          default false,
  -- New in 0069, defaulted so a client built against the 10-argument
  -- call still resolves.
  p_is_mock           boolean default false,
  p_permission_denied boolean default false
) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  record;
  v_owner uuid;
  v_date  date;
  v_name  text;
  v_row   attendance_records;
  v_loc   record;
  v_req   boolean;
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

  -- ── Location, AFTER the day checks ────────────────────────────────
  -- Deliberately last. A worker who has already timed in should be told
  -- ALREADY_TIMED_IN, which they can act on, rather than a location
  -- complaint about a record that was never going to be written.
  v_req := coalesce(
    (select a.require_geofence from attendance_config a where a.owner_id = v_owner),
    false
  );

  select * into v_loc from attendance_check_location(
    p_project_system, p_project_id, v_owner, p_captured_at,
    p_lat, p_lng, p_accuracy_m, p_is_mock, p_permission_denied
  );

  if attendance_location_refuses(v_loc.status, p_was_offline, v_req) then
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
    timein_geofence_lat, timein_geofence_lng, timein_geofence_radius_m
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
    v_loc.fence_lat, v_loc.fence_lng, v_loc.fence_radius_m
  )
  returning * into v_row;

  return v_row;
end $$;


-- ── 5. Time Out ─────────────────────────────────────────────────────
create or replace function attendance_time_out(
  p_project_system text,
  p_project_id  uuid,
  p_captured_at timestamptz,
  p_photo_path  text,
  p_event_id    uuid,
  p_description text             default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy_m  double precision default null,
  p_was_offline boolean          default false,
  p_is_mock           boolean default false,
  p_permission_denied boolean default false
) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  record;
  v_owner uuid;
  v_date  date;
  v_name  text;
  v_row   attendance_records;
  v_loc   record;
  v_req   boolean;
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

  -- Location last again, and it matters more here: a worker refused at
  -- Time Out is left with an OPEN day they cannot close, which an admin
  -- then has to abandon. Refusing is still right when they are provably
  -- somewhere else, but every softer case has to stay recordable.
  v_req := coalesce(
    (select a.require_geofence from attendance_config a where a.owner_id = v_owner),
    false
  );

  select * into v_loc from attendance_check_location(
    p_project_system, p_project_id, v_owner, p_captured_at,
    p_lat, p_lng, p_accuracy_m, p_is_mock, p_permission_denied
  );

  if attendance_location_refuses(v_loc.status, p_was_offline, v_req) then
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
         total_minutes         = floor(extract(epoch from (p_captured_at - timein_at)) / 60)::int
   where id = v_row.id
  returning * into v_row;

  return v_row;
end $$;


-- ── 6. Grants ───────────────────────────────────────────────────────
--
-- Roles named explicitly, per 0067. `revoke ... from public` does not
-- remove what Supabase's default privileges grant directly to anon and
-- authenticated.
revoke all on function attendance_time_in(text, uuid, timestamptz, text, uuid, text,
                                          double precision, double precision, double precision,
                                          boolean, boolean, boolean) from public;
revoke all on function attendance_time_out(text, uuid, timestamptz, text, uuid, text,
                                           double precision, double precision, double precision,
                                           boolean, boolean, boolean) from public;
grant execute on function attendance_time_in(text, uuid, timestamptz, text, uuid, text,
                                             double precision, double precision, double precision,
                                             boolean, boolean, boolean) to authenticated;
grant execute on function attendance_time_out(text, uuid, timestamptz, text, uuid, text,
                                              double precision, double precision, double precision,
                                              boolean, boolean, boolean) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_time_in(text, uuid, timestamptz, text, uuid, '
         || 'text, double precision, double precision, double precision, boolean, boolean, boolean) '
         || 'from anon';
    execute 'revoke execute on function attendance_time_out(text, uuid, timestamptz, text, uuid, '
         || 'text, double precision, double precision, double precision, boolean, boolean, boolean) '
         || 'from anon';
  end if;
end $$;

revoke all on function attendance_location_refuses(text, boolean, boolean) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_location_refuses(text, boolean, boolean) from anon';
  end if;
end $$;
