-- ════════════════════════════════════════════════════════════════════
-- 0070_attendance_schedule_rpcs.sql
--
-- THE SCHEDULE EDITOR WRITES THROUGH RPCs, like everything else here.
--
-- ── WHY. 0065 gave attendance_project_config and
--    attendance_project_closure ordinary RLS policies and let the admin
--    screen INSERT into them directly. That broke the rule 0050 set for
--    this whole module -- every write goes through a security-definer
--    function -- and it broke it in the way that rule exists to prevent:
--    the browser had to supply `owner_id` itself, and the row then lived
--    or died on whether that value happened to satisfy WITH CHECK.
--
--    In practice closures could be read and deleted but never inserted,
--    with no error surfaced, which is the worst possible shape for a
--    failure: a button that silently does nothing.
--
--    Deriving the owner ON THE SERVER removes the guess entirely. The
--    caller says WHICH PROJECT; the database decides whose it is.
--
-- ── STAFF ACT AS THEIR OWNER, via data_owner_id() -- the 0002 helper,
--    not attendance_data_owner(). That one resolves a WORKER's owner and
--    is deliberately attendance-local; these functions are admin-only
--    and want the ordinary tenancy rule.
--
-- ── IDEMPOTENT WRITES. Adding a closure that already exists returns the
--    existing row rather than raising. The unique index on
--    (project, closed_on) is a correctness guarantee, not something an
--    admin should have to read an error about for pressing Add twice.
--
-- ── STILL OUTSIDE THE MONEY MODEL. No peso column, nothing feeds
--    Spent / Earned / Profit.
--
-- Idempotent -- safe to re-run.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. Shared guard ─────────────────────────────────────────────────
--
-- Resolves the tenant for an admin caller and refuses everyone else.
-- Both writers below use it, so they cannot drift into disagreeing about
-- who may edit a schedule.
create or replace function attendance_schedule_owner(
  p_system     text,
  p_project_id uuid
) returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not (is_owner() or is_staff()) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  if coalesce(p_system, '') not in ('pc', 'pm') then
    raise exception 'PROJECT_SYSTEM_INVALID' using errcode = 'P0001';
  end if;

  v_owner := data_owner_id();

  -- The project must actually belong to this tenant. Without this an
  -- admin could attach a schedule to another company's project id.
  if attendance_project_name(p_system, p_project_id, v_owner) is null then
    raise exception 'PROJECT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  return v_owner;
end $$;

revoke all on function attendance_schedule_owner(text, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function attendance_schedule_owner(text, uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_schedule_owner(text, uuid) from anon';
  end if;
end $$;


-- ── 2. Working days and start time ──────────────────────────────────
create or replace function attendance_project_config_save(
  p_system       text,
  p_project_id   uuid,
  p_working_days smallint[],
  p_start_time   time default null
) returns attendance_project_config
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := attendance_schedule_owner(p_system, p_project_id);
  v_row   attendance_project_config;
begin
  if p_working_days is null or array_length(p_working_days, 1) is null then
    raise exception 'WORKING_DAYS_REQUIRED' using errcode = 'P0001';
  end if;

  insert into attendance_project_config (
    owner_id, project_system, folder_id, pm_project_id,
    working_days, start_time_override
  ) values (
    v_owner, p_system,
    case when p_system = 'pc' then p_project_id end,
    case when p_system = 'pm' then p_project_id end,
    p_working_days, p_start_time
  )
  on conflict do nothing
  returning * into v_row;

  -- Already configured: update in place. `on conflict do nothing` plus a
  -- follow-up update rather than `on conflict do update`, because the
  -- uniqueness lives in two PARTIAL indexes (one per project system) and
  -- there is no single conflict target that names both.
  if v_row.id is null then
    update attendance_project_config
       set working_days        = p_working_days,
           start_time_override = p_start_time
     where owner_id = v_owner
       and project_system = p_system
       and ((p_system = 'pc' and folder_id     = p_project_id)
         or (p_system = 'pm' and pm_project_id = p_project_id))
    returning * into v_row;
  end if;

  return v_row;
end $$;

revoke all on function attendance_project_config_save(text, uuid, smallint[], time) from public;
grant execute on function attendance_project_config_save(text, uuid, smallint[], time)
  to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function '
         || 'attendance_project_config_save(text, uuid, smallint[], time) from anon';
  end if;
end $$;


-- ── 3. Closed dates ─────────────────────────────────────────────────
create or replace function attendance_project_closure_add(
  p_system     text,
  p_project_id uuid,
  p_closed_on  date,
  p_reason     text default null
) returns attendance_project_closure
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := attendance_schedule_owner(p_system, p_project_id);
  v_row   attendance_project_closure;
begin
  if p_closed_on is null then
    raise exception 'DATE_REQUIRED' using errcode = 'P0001';
  end if;

  insert into attendance_project_closure (
    owner_id, project_system, folder_id, pm_project_id,
    closed_on, reason, created_by
  ) values (
    v_owner, p_system,
    case when p_system = 'pc' then p_project_id end,
    case when p_system = 'pm' then p_project_id end,
    p_closed_on, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  )
  on conflict do nothing
  returning * into v_row;

  -- Pressing Add twice on the same date is not an error worth showing an
  -- admin. Return what is already there.
  if v_row.id is null then
    select * into v_row
      from attendance_project_closure
     where owner_id = v_owner
       and project_system = p_system
       and closed_on = p_closed_on
       and ((p_system = 'pc' and folder_id     = p_project_id)
         or (p_system = 'pm' and pm_project_id = p_project_id));
  end if;

  return v_row;
end $$;

revoke all on function attendance_project_closure_add(text, uuid, date, text) from public;
grant execute on function attendance_project_closure_add(text, uuid, date, text) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function '
         || 'attendance_project_closure_add(text, uuid, date, text) from anon';
  end if;
end $$;


create or replace function attendance_project_closure_remove(
  p_closure_id uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_row attendance_project_closure;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not (is_owner() or is_staff()) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  select * into v_row from attendance_project_closure where id = p_closure_id;

  -- Not found and belongs-to-someone-else answer identically: telling a
  -- caller a row exists in another tenant is a fact they have no use for.
  -- 0061 makes the same choice.
  if not found or not can_access(v_row.owner_id) then
    raise exception 'CLOSURE_NOT_FOUND' using errcode = 'P0001';
  end if;

  delete from attendance_project_closure where id = p_closure_id;
  return true;
end $$;

revoke all on function attendance_project_closure_remove(uuid) from public;
grant execute on function attendance_project_closure_remove(uuid) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_project_closure_remove(uuid) from anon';
  end if;
end $$;
