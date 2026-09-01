-- ════════════════════════════════════════════════════════════════════
-- 0059_attendance_real_projects.sql
--
-- Attendance stops keeping its OWN list of projects. A worker now times
-- in against the same projects the business already runs:
--
--   system = 'pc' → folders               (Project Control)
--   system = 'pm' → construction_projects (Project Management)
--
-- ── WHY THIS SHAPE
--    This is the pattern 0031_expense_inbox.sql already uses for exactly
--    the same problem: one table serving two project systems whose ids
--    live in different spaces. Copying it deliberately -- a second,
--    different answer to the same question is how `folders.id` vs
--    `construction_projects.id` confusion spreads.
--
-- ── WHY NOW
--    The Android app is not built yet, so no shipped client's RPC
--    contract breaks. That stops being true the day it ships.
--
--    attendance_records is NOT empty, though the admin screens looked it
--    -- A1 filters to TODAY, so older rows never showed. The first
--    attempt at this migration assumed empty, dropped the old project
--    ids in its opening statement, and then failed adding a constraint
--    that required a project system those rows had never had. Section 1b
--    exists because of that: backfill from the name snapshot BEFORE the
--    old columns go, and let a row that cannot be matched keep its name.
--
-- ── WHAT THIS IS NOT
--    Attendance stays OUTSIDE the money model. Pointing a record at a
--    folder does NOT make attendance a cost: nothing here feeds Spent /
--    Earned / Profit, and hours are still not the basis of pay (DAC's
--    labour is pakyaw, capped by contract). This migration changes which
--    project a record NAMES, nothing about what it costs.
--
-- Idempotent -- safe to re-run.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. Repoint attendance_records at the real project systems ───────
--
-- `on delete set null`, NOT cascade -- and this is the opposite of what
-- 0031 chose, on purpose. An inbox item is meaningless without its
-- project, so cascading is right there. An attendance record is a
-- person's work history: deleting a project must never erase the fact
-- that someone worked that day. The name is snapshotted in
-- timein_project_name, so the row stays readable after the FK goes null.

-- New columns go on FIRST, and the old ones come off LAST (section 1c).
-- The first draft of this migration dropped them up here and then added
-- a constraint requiring a project system on every row -- which failed
-- against the rows already in the table, after the old ids were already
-- gone. Add, backfill, constrain, then drop.

alter table attendance_records
  add column if not exists timein_project_system  text,
  add column if not exists timein_folder_id       uuid references folders(id)               on delete set null,
  add column if not exists timein_pm_project_id   uuid references construction_projects(id) on delete set null,
  add column if not exists timeout_project_system text,
  add column if not exists timeout_folder_id      uuid references folders(id)               on delete set null,
  add column if not exists timeout_pm_project_id  uuid references construction_projects(id) on delete set null;


-- ── 1b. Reconnect the rows that already exist ───────────────────────
--
-- The old timein_project_id pointed at attendance_projects, which this
-- migration drops -- so that id is worthless after today. The SNAPSHOT
-- (timein_project_name) is the only project reference that survives, and
-- it is what the backfill matches on.
--
-- Claims a row ONLY when the name resolves to exactly one real project.
-- Zero matches leaves the ids null; two or more is ambiguous and is left
-- null too. Guessing here would attach a person's work history to the
-- wrong job, which is worse than leaving it on the name alone.

do $$
declare touched int;
begin
  -- `count(*) over (partition by nm)` rather than a group-by with
  -- min(id): Postgres has NO min(uuid) aggregate, and reaching for one
  -- is what broke the first run of this block. The window keeps each
  -- candidate row intact and just labels how many share its name, so
  -- `n = 1` is the "exactly one match" test with nothing to aggregate.
  with candidates as (
    select lower(btrim(f.name)) as nm, 'pc'::text as system, null::uuid as pm_id, f.id as folder_id
      from folders f where f.parent_folder_id is null and coalesce(btrim(f.name),'') <> ''
    union all
    select lower(btrim(coalesce(nullif(btrim(c.project_name),''), c.client_name))), 'pm'::text, c.id, null::uuid
      from construction_projects c
     where coalesce(nullif(btrim(c.project_name),''), c.client_name) is not null
  ),
  unique_names as (
    select nm, system, folder_id, pm_id, count(*) over (partition by nm) as n
      from candidates
  )
  update attendance_records r
     set timein_project_system = u.system,
         timein_folder_id      = u.folder_id,
         timein_pm_project_id  = u.pm_id
    from unique_names u
   where u.n = 1
     and r.timein_project_system is null
     and lower(btrim(r.timein_project_name)) = u.nm;
  get diagnostics touched = row_count;
  raise notice 'Time In backfilled on % row(s) by project name.', touched;

  with candidates as (
    select lower(btrim(f.name)) as nm, 'pc'::text as system, null::uuid as pm_id, f.id as folder_id
      from folders f where f.parent_folder_id is null and coalesce(btrim(f.name),'') <> ''
    union all
    select lower(btrim(coalesce(nullif(btrim(c.project_name),''), c.client_name))), 'pm'::text, c.id, null::uuid
      from construction_projects c
     where coalesce(nullif(btrim(c.project_name),''), c.client_name) is not null
  ),
  unique_names as (
    select nm, system, folder_id, pm_id, count(*) over (partition by nm) as n
      from candidates
  )
  update attendance_records r
     set timeout_project_system = u.system,
         timeout_folder_id      = u.folder_id,
         timeout_pm_project_id  = u.pm_id
    from unique_names u
   where u.n = 1
     and r.timeout_project_name is not null
     and r.timeout_project_system is null
     and lower(btrim(r.timeout_project_name)) = u.nm;
  get diagnostics touched = row_count;
  raise notice 'Time Out backfilled on % row(s) by project name.', touched;
end $$;


-- Exactly one of the two id columns is set, and it matches the system.
--
-- All-null is ALLOWED on Time In as well as Time Out, and that is not
-- laziness: a row recorded before 0059 (or one whose project name no
-- longer resolves to anything) genuinely has no project system, and
-- timein_project_name still says where the person worked. Refusing that
-- state would mean either deleting real attendance or inventing a
-- project for it. Rows written from here on always carry a system --
-- the RPCs are the only writer, workers hold no insert policy, and both
-- functions set it unconditionally.
alter table attendance_records drop constraint if exists attendance_timein_project_ck;
alter table attendance_records add constraint attendance_timein_project_ck check (
      (timein_project_system is null and timein_folder_id is null and timein_pm_project_id is null)
   or (timein_project_system = 'pc' and timein_folder_id is not null and timein_pm_project_id is null)
   or (timein_project_system = 'pm' and timein_pm_project_id is not null and timein_folder_id is null)
);

alter table attendance_records drop constraint if exists attendance_timeout_project_ck;
alter table attendance_records add constraint attendance_timeout_project_ck check (
      (timeout_project_system is null and timeout_folder_id is null and timeout_pm_project_id is null)
   or (timeout_project_system = 'pc' and timeout_folder_id is not null and timeout_pm_project_id is null)
   or (timeout_project_system = 'pm' and timeout_pm_project_id is not null and timeout_folder_id is null)
);

create index if not exists attendance_records_timein_folder_idx
  on attendance_records (timein_folder_id) where timein_folder_id is not null;
create index if not exists attendance_records_timein_pmproj_idx
  on attendance_records (timein_pm_project_id) where timein_pm_project_id is not null;


-- ── 1c. Now the old bigint columns can go ───────────────────────────
-- Last, not first: until this point they were the only evidence of which
-- attendance_projects row a record came from, and dropping them before
-- the backfill is what broke the first attempt at this migration.

alter table attendance_records
  drop column if exists timein_project_id,
  drop column if exists timeout_project_id;


-- ── 2. The worker's project picker ──────────────────────────────────
--
-- SECURITY DEFINER returning ONLY (system, id, name), and that narrow
-- shape is the whole point. Workers must NOT get a select policy on
-- `folders`: that table is the Project Control project row, and the
-- money hanging off it (folder_budgets.total_budget, contract values)
-- is owner-confidential. Granting select "so the picker works" would
-- hand every mason the contract amounts. A function that returns three
-- columns cannot leak a fourth.
--
-- ── The two systems are scoped DIFFERENTLY, and that is not a bug here
--    folders               → owner-scoped (`folders_rw` uses can_access(owner_id))
--    construction_projects → ROLE-scoped  (`cproj_admin` is is_owner() or is_staff(),
--                            with no owner filter at all, and owner_id is
--                            nullable -- many live rows carry NULL)
--    So the pm branch matches the admin policy's own reach rather than
--    inventing a stricter rule that would hide most of the PM projects
--    from the picker while the PM module itself still shows them.
--
-- Additional Works are EXCLUDED (parent_folder_id is not null). An AW
-- folder is extra scope billed against the same physical site, not a
-- second place a worker can stand -- listing both would show the site
-- twice under near-identical names.

-- Output columns are named project_system / project_name, not system /
-- name: `name` is a built-in type and both would shadow the very columns
-- the body selects (folders.name, construction_projects.project_name).
create or replace function attendance_projects_for_worker()
returns table (project_system text, project_id uuid, project_name text)
language sql stable security definer set search_path = public as $$
  select 'pc'::text, f.id, f.name
    from folders f
   where f.owner_id = attendance_data_owner()
     and f.parent_folder_id is null
     and coalesce(btrim(f.name), '') <> ''
  union all
  select 'pm'::text, c.id, coalesce(nullif(btrim(c.project_name), ''), c.client_name)
    from construction_projects c
   where (c.owner_id is null or c.owner_id = attendance_data_owner())
     and coalesce(c.status, 'active') = 'active'
     and coalesce(nullif(btrim(c.project_name), ''), c.client_name) is not null
  order by 3;
$$;

revoke all on function attendance_projects_for_worker() from public;
grant execute on function attendance_projects_for_worker() to authenticated;


-- ── 3. Resolve one project, or refuse ───────────────────────────────
--
-- Shared by both RPCs so Time In and Time Out cannot drift into
-- disagreeing about what counts as an available project. Returns the
-- name to snapshot; null means "not available to this tenant".

create or replace function attendance_project_name(p_system text, p_id uuid, p_owner uuid)
returns text language sql stable security definer set search_path = public as $$
  select case p_system
    when 'pc' then (
      select f.name from folders f
       where f.id = p_id and f.owner_id = p_owner and f.parent_folder_id is null
    )
    when 'pm' then (
      select coalesce(nullif(btrim(c.project_name), ''), c.client_name)
        from construction_projects c
       where c.id = p_id
         and (c.owner_id is null or c.owner_id = p_owner)
         and coalesce(c.status, 'active') = 'active'
    )
  end;
$$;

revoke all on function attendance_project_name(text, uuid, uuid) from public;
grant execute on function attendance_project_name(text, uuid, uuid) to authenticated;


-- ── 4. The RPCs, on the new contract ────────────────────────────────
--
-- The old bigint-project signatures are DROPPED, not left beside the new
-- ones. `create or replace` with a changed parameter type creates an
-- overload instead of replacing, and two live attendance_time_in
-- functions is precisely the ambiguity that makes a client call the
-- wrong one. Everything else about these bodies is unchanged from 0051.

drop function if exists attendance_time_in(bigint, timestamptz, text, uuid, text,
                                           double precision, double precision, double precision, boolean);
drop function if exists attendance_time_out(bigint, timestamptz, text, uuid, text,
                                            double precision, double precision, double precision, boolean);

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
  p_was_offline boolean          default false
) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  record;
  v_owner uuid;
  v_date  date;
  v_name  text;
  v_row   attendance_records;
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

  insert into attendance_records (
    owner_id, worker_id, worker_name, worker_position,
    work_date, session_seq, status,
    timein_project_system, timein_folder_id, timein_pm_project_id,
    timein_project_name, timein_at, timein_photo_path,
    timein_description, timein_lat, timein_lng, timein_accuracy_m,
    timein_event_id, timein_was_offline, timein_received_at
  ) values (
    v_owner, v_uid, v_prof.display_name, v_prof.job_position,
    v_date, 1, 'working',
    p_project_system,
    case when p_project_system = 'pc' then p_project_id end,
    case when p_project_system = 'pm' then p_project_id end,
    v_name, p_captured_at, p_photo_path,
    nullif(btrim(coalesce(p_description,'')), ''), p_lat, p_lng, p_accuracy_m,
    p_event_id, coalesce(p_was_offline,false), now()
  )
  returning * into v_row;

  return v_row;
end $$;


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
  p_was_offline boolean          default false
) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  record;
  v_owner uuid;
  v_date  date;
  v_name  text;
  v_row   attendance_records;
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
         total_minutes         = floor(extract(epoch from (p_captured_at - timein_at)) / 60)::int
   where id = v_row.id
  returning * into v_row;

  return v_row;
end $$;

revoke all on function attendance_time_in(text, uuid, timestamptz, text, uuid, text,
                                          double precision, double precision, double precision, boolean) from public;
grant execute on function attendance_time_in(text, uuid, timestamptz, text, uuid, text,
                                             double precision, double precision, double precision, boolean) to authenticated;

revoke all on function attendance_time_out(text, uuid, timestamptz, text, uuid, text,
                                           double precision, double precision, double precision, boolean) from public;
grant execute on function attendance_time_out(text, uuid, timestamptz, text, uuid, text,
                                              double precision, double precision, double precision, boolean) to authenticated;


-- ── 5. Retire the third project list ────────────────────────────────
--
-- Dropped rather than left dormant. CLAUDE.md's standing warning is that
-- this repo already has two notions of "project" and confusing them
-- silently matches nothing; a third one sitting empty in the schema is
-- an invitation to wire something back to it. `cascade` takes its
-- policies, indexes and touch trigger with it. Section 1 already removed
-- the only columns that referenced it.

drop table if exists attendance_projects cascade;
