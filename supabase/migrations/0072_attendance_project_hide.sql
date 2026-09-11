-- ════════════════════════════════════════════════════════════════════
-- 0072_attendance_project_hide.sql
--
-- HIDE A SITE FROM THE WORKERS' PICKER, from the admin Sites screen.
--
-- ── NO NEW COLUMN. 0065 already gave attendance_project_config an
--    `attendance_enabled` flag (default true) and nothing ever read it.
--    This migration is the reading half: the worker picker skips a site
--    switched off, and the admin screen gets a way to switch it.
--
-- ── HIDING IS A PICKER RULE, NOT A REFUSAL. attendance_time_in /
--    attendance_time_out (0069) are deliberately UNTOUCHED, and
--    attendance_project_name (0059) with them. The app is built for sites
--    with no signal: a Time In captured offline before the site was
--    hidden may reach the server days later, and refusing it then would
--    erase a day the worker really worked. A hidden site simply stops
--    being offered; anything already captured still lands.
--
--    attendance_project_name is also what the schedule guard (0070) uses
--    to decide a project belongs to this tenant. Gating it on the flag
--    would lock the admin out of un-hiding the very site they hid.
--
-- ── THE ADMIN SCREEN GETS ITS OWN LIST. It used to read the WORKER
--    picker, so a hidden site would vanish from the one screen that can
--    un-hide it. attendance_projects_for_admin() returns every site plus
--    whether it is hidden. It also ignores require_geofence (0068), for
--    the same reason: a site with no fence yet dropped off the admin
--    screen too, which is exactly where its fence has to be set.
--
-- ── STILL OUTSIDE THE MONEY MODEL. No peso column, nothing feeds
--    Spent / Earned / Profit.
--
-- Idempotent -- safe to re-run.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. The worker picker, now honouring attendance_enabled ──────────
--
-- Everything else is unchanged from 0068 -- the three-column shape, the
-- tenant scoping, the Additional Works exclusion, the geofence gate, the
-- ordering. Only the `hidden` clauses are new.
--
-- `not exists (... attendance_enabled = false)` rather than a join on
-- `attendance_enabled`: most sites have NO config row, and no row must
-- mean "shown", exactly as the column's default says.
create or replace function attendance_projects_for_worker()
returns table (project_system text, project_id uuid, project_name text)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(
      (select a.require_geofence from attendance_config a
        where a.owner_id = attendance_data_owner()),
      false
    ) as require_geofence
  )
  select 'pc'::text, f.id, f.name
    from folders f, cfg
   where f.owner_id = attendance_data_owner()
     and f.parent_folder_id is null
     and coalesce(btrim(f.name), '') <> ''
     and (not cfg.require_geofence or exists (
       select 1 from attendance_project_geofence g
        where g.project_system = 'pc' and g.folder_id = f.id
          and g.owner_id = f.owner_id and g.enabled
     ))
     and not exists (
       select 1 from attendance_project_config h
        where h.project_system = 'pc' and h.folder_id = f.id
          and h.owner_id = f.owner_id and not h.attendance_enabled
     )
  union all
  select 'pm'::text, c.id, coalesce(nullif(btrim(c.project_name), ''), c.client_name)
    from construction_projects c, cfg
   where (c.owner_id is null or c.owner_id = attendance_data_owner())
     and coalesce(c.status, 'active') = 'active'
     and coalesce(nullif(btrim(c.project_name), ''), c.client_name) is not null
     and (not cfg.require_geofence or exists (
       select 1 from attendance_project_geofence g
        where g.project_system = 'pm' and g.pm_project_id = c.id
          and g.owner_id = attendance_data_owner() and g.enabled
     ))
     and not exists (
       select 1 from attendance_project_config h
        where h.project_system = 'pm' and h.pm_project_id = c.id
          and h.owner_id = attendance_data_owner() and not h.attendance_enabled
     )
  order by 3;
$$;

revoke all on function attendance_projects_for_worker() from public;
grant execute on function attendance_projects_for_worker() to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_projects_for_worker() from anon';
  end if;
end $$;


-- ── 2. The admin list -- every site, hidden or not ──────────────────
--
-- Same (system, id, name) shape as the picker plus one boolean, and the
-- same tenant scoping as 0059 -- so the two lists cannot disagree about
-- WHICH sites exist, only about which ones a worker is offered.
--
-- Admin-only. A worker calling it would learn the names of sites they
-- were deliberately not shown; NOT_ADMIN says no instead.
create or replace function attendance_projects_for_admin()
returns table (project_system text, project_id uuid, project_name text, hidden boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not (is_owner() or is_staff()) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  -- data_owner_id(), not attendance_data_owner(): this is an admin
  -- function and wants the ordinary tenancy rule (0070 makes the same
  -- choice for the schedule writers).
  v_owner := data_owner_id();

  return query
    select 'pc'::text, f.id, f.name::text,
           exists (
             select 1 from attendance_project_config h
              where h.project_system = 'pc' and h.folder_id = f.id
                and h.owner_id = v_owner and not h.attendance_enabled
           )
      from folders f
     where f.owner_id = v_owner
       and f.parent_folder_id is null
       and coalesce(btrim(f.name), '') <> ''
    union all
    select 'pm'::text, c.id,
           coalesce(nullif(btrim(c.project_name), ''), c.client_name)::text,
           exists (
             select 1 from attendance_project_config h
              where h.project_system = 'pm' and h.pm_project_id = c.id
                and h.owner_id = v_owner and not h.attendance_enabled
           )
      from construction_projects c
     where (c.owner_id is null or c.owner_id = v_owner)
       and coalesce(c.status, 'active') = 'active'
       and coalesce(nullif(btrim(c.project_name), ''), c.client_name) is not null
     order by 3;
end $$;

revoke all on function attendance_projects_for_admin() from public;
grant execute on function attendance_projects_for_admin() to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_projects_for_admin() from anon';
  end if;
end $$;


-- ── 3. Hide / show one site ─────────────────────────────────────────
--
-- Through attendance_schedule_owner (0070) so hiding and scheduling
-- cannot drift into disagreeing about who may edit a site: the caller
-- names the project, the server derives the tenant.
--
-- Hiding a site with no config row CREATES one, and its working_days
-- take the column default {1,2,3,4,5}. That changes no rule -- no row
-- already meant Mon–Fri to attendance_is_required_day (0065) -- but the
-- Sites card will read "Mon–Fri" instead of "Not set yet" afterwards.
create or replace function attendance_project_set_hidden(
  p_system     text,
  p_project_id uuid,
  p_hidden     boolean
) returns attendance_project_config
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := attendance_schedule_owner(p_system, p_project_id);
  v_row   attendance_project_config;
begin
  if p_hidden is null then
    raise exception 'HIDDEN_REQUIRED' using errcode = 'P0001';
  end if;

  insert into attendance_project_config (
    owner_id, project_system, folder_id, pm_project_id, attendance_enabled
  ) values (
    v_owner, p_system,
    case when p_system = 'pc' then p_project_id end,
    case when p_system = 'pm' then p_project_id end,
    not p_hidden
  )
  on conflict do nothing
  returning * into v_row;

  -- Already configured: flip the flag in place and leave the schedule
  -- alone. Same two-step as attendance_project_config_save, for the same
  -- reason -- the uniqueness lives in two PARTIAL indexes and there is no
  -- single conflict target that names both.
  if v_row.id is null then
    update attendance_project_config
       set attendance_enabled = not p_hidden
     where owner_id = v_owner
       and project_system = p_system
       and ((p_system = 'pc' and folder_id     = p_project_id)
         or (p_system = 'pm' and pm_project_id = p_project_id))
    returning * into v_row;
  end if;

  return v_row;
end $$;

revoke all on function attendance_project_set_hidden(text, uuid, boolean) from public;
grant execute on function attendance_project_set_hidden(text, uuid, boolean) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function '
         || 'attendance_project_set_hidden(text, uuid, boolean) from anon';
  end if;
end $$;
