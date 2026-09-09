-- ════════════════════════════════════════════════════════════════════
-- 0071_attendance_geofence_rpc.sql
--
-- SETTING A PROJECT'S GEOFENCE, from the admin screen.
--
-- 0068 created attendance_project_geofence and 0069 verifies against it,
-- but nothing was ever built to WRITE one -- coordinates had to be typed
-- into the SQL editor by hand. This is the missing half.
--
-- ── AN RPC, NOT A TABLE INSERT, and that is not a style preference.
--    0065 gave the schedule tables ordinary RLS policies and let the
--    browser insert directly, supplying owner_id itself. Closures could
--    then be read and deleted but never inserted, silently, because a
--    client-supplied owner_id that misses WITH CHECK is indistinguishable
--    from a button that does nothing. 0070 rewrote those as RPCs. This
--    one is built that way from the start.
--
-- ── SETTING A FENCE APPENDS, IT NEVER UPDATES.
--    The table is effective-dated (0068) so that editing a fence cannot
--    retroactively invalidate attendance already recorded against the old
--    one -- §33 requires exactly that. An UPDATE here would rewrite
--    history for every past record that was judged against it, including
--    offline records still waiting to sync.
--
--    So a "change" is a new row with a later effective_from, and
--    attendance_geofence_at() resolves whichever was in force at capture.
--    The old rows are not clutter; they are the evidence.
--
-- Idempotent -- safe to re-run.
-- ════════════════════════════════════════════════════════════════════

create or replace function attendance_project_geofence_set(
  p_system     text,
  p_project_id uuid,
  p_latitude   double precision,
  p_longitude  double precision,
  p_radius_m   numeric default 150,
  p_enabled    boolean default true
) returns attendance_project_geofence
language plpgsql security definer set search_path = public as $$
declare
  -- Reuses 0070's guard: admin-only, and the project must belong to this
  -- tenant. Sharing it means the schedule and the fence cannot drift into
  -- disagreeing about who may edit a project.
  v_owner uuid := attendance_schedule_owner(p_system, p_project_id);
  v_row   attendance_project_geofence;
begin
  if p_latitude is null or p_longitude is null then
    raise exception 'COORDINATES_REQUIRED' using errcode = 'P0001';
  end if;

  -- Checked here as well as by the table constraint so the admin gets a
  -- code the screen can word, rather than a raw constraint name.
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'COORDINATES_INVALID' using errcode = 'P0001';
  end if;

  if coalesce(p_radius_m, 0) not between 10 and 5000 then
    raise exception 'RADIUS_OUT_OF_RANGE' using errcode = 'P0001';
  end if;

  insert into attendance_project_geofence (
    owner_id, project_system, folder_id, pm_project_id,
    effective_from, latitude, longitude, radius_m, enabled, created_by
  ) values (
    v_owner, p_system,
    case when p_system = 'pc' then p_project_id end,
    case when p_system = 'pm' then p_project_id end,
    now(), p_latitude, p_longitude, coalesce(p_radius_m, 150),
    coalesce(p_enabled, true), auth.uid()
  )
  returning * into v_row;

  return v_row;
end $$;

revoke all on function attendance_project_geofence_set(
  text, uuid, double precision, double precision, numeric, boolean) from public;
grant execute on function attendance_project_geofence_set(
  text, uuid, double precision, double precision, numeric, boolean) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_project_geofence_set('
         || 'text, uuid, double precision, double precision, numeric, boolean) from anon';
  end if;
end $$;


-- ── The current fence, for the editor to show ───────────────────────
--
-- The newest row per project. Admins read the table directly for this in
-- principle, but the effective-dated shape means "the current one" is a
-- query with an ordering rule in it, and two callers writing that rule
-- differently is how an editor ends up showing a fence that is not the
-- one in force.
create or replace function attendance_project_geofence_current(
  p_system     text,
  p_project_id uuid
) returns attendance_project_geofence
language sql stable security definer set search_path = public as $$
  select g.*
    from attendance_project_geofence g
   where g.project_system = p_system
     and ((p_system = 'pc' and g.folder_id     = p_project_id)
       or (p_system = 'pm' and g.pm_project_id = p_project_id))
     and can_access(g.owner_id)
   order by g.effective_from desc
   limit 1;
$$;

revoke all on function attendance_project_geofence_current(text, uuid) from public;
grant execute on function attendance_project_geofence_current(text, uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function '
         || 'attendance_project_geofence_current(text, uuid) from anon';
  end if;
end $$;
