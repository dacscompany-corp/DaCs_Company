-- ════════════════════════════════════════════════════════════════════
-- 0051_attendance_worker_owner.sql
--
-- Fixes a defect in 0050 that would have made the worker app unusable,
-- plus the data gap that exposed it. Found 2026-08-18 while collecting
-- test UUIDs, BEFORE attendance_checks.sql was run.
--
-- ── THE BUG (0050, section 6)
--    attendance_projects_worker_select used data_owner_id(). That helper
--    (0002_rls.sql) resolves to the owner ONLY for staff:
--
--      case when auth_role() = 'staff' then coalesce(owner_id, auth.uid())
--           else auth.uid() end
--
--    For a WORKER it returns the worker's own uid, so the policy compared
--    a project's owner_id against the worker themself and matched nothing.
--    Every worker would have seen an EMPTY project picker, and since the
--    Project Name is required for every Time In (MVP section 9), the whole
--    attendance flow was dead. data_owner_id() is not wrong — it was
--    written for staff, and 0050 reached for it out of turn.
--
-- ── THE DATA GAP
--    Both existing worker profiles had owner_id = NULL, so even a correct
--    policy had nothing to resolve to. The RPCs' coalesce(owner_id, uid)
--    made each worker their own tenant: PROJECT_UNAVAILABLE on every
--    project, and any record written would carry the worker's own uid as
--    owner_id, so the admin's can_access(owner_id) would never match it.
--
--    Backfilling worker owner_id is SAFE for everything that exists today.
--    Verified 2026-08-18: no current code path reads a WORKER's owner_id.
--    data_owner_id() and can_access() both branch only on is_staff(), and
--    js/admin.js (lines 54 and 534) gates on role === 'staff'. Newly
--    created workers already get owner_id — user-navigator passes ownerUid
--    to adminCreateUser. Only pre-existing rows are affected.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. The helper 0050 should have used ─────────────────────────────
-- Resolves ANY profile to the tenant whose data it belongs to:
--   owner  → owner_id is null  → itself
--   staff  → owner_id          → their owner
--   worker → owner_id          → their owner   ← the case data_owner_id() misses
--
-- Deliberately NOT a change to data_owner_id(): that function is load
-- bearing for every money-model policy in 0002, and widening it to
-- workers would silently grant workers the owner's expenses, payroll and
-- folders. This helper is attendance-local on purpose.
create or replace function attendance_data_owner()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(owner_id, id) from profiles where id = auth.uid()
$$;

revoke all on function attendance_data_owner() from public;
grant execute on function attendance_data_owner() to authenticated;


-- ── 2. Repoint the worker project policy ────────────────────────────
drop policy if exists attendance_projects_worker_select on attendance_projects;
create policy attendance_projects_worker_select on attendance_projects
  for select to authenticated
  using (is_active and owner_id = attendance_data_owner());


-- ── 3. Backfill worker owner_id ─────────────────────────────────────
-- Assign every worker with no owner to the tenant root — the single
-- profile with role = 'owner' and owner_id is null. Guarded: if there is
-- not exactly one such row the assignment is ambiguous, so this raises
-- instead of guessing. Re-running is a no-op once owner_id is set.
do $$
declare v_root uuid; n int; touched int;
begin
  select count(*) into n
    from profiles where role = 'owner' and owner_id is null;

  if n <> 1 then
    raise notice
      'SKIPPED worker owner_id backfill: found % root owners (need exactly 1). Assign owner_id by hand.', n;
    return;
  end if;

  select id into v_root
    from profiles where role = 'owner' and owner_id is null;

  update profiles
     set owner_id = v_root
   where coalesce(role,'') in ('worker','teamLeader')
     and owner_id is null
     and id <> v_root;

  get diagnostics touched = row_count;
  raise notice 'Assigned owner_id % to % worker profile(s).', v_root, touched;
end $$;


-- ── 4. Make a missing owner LOUD instead of confusing ───────────────
-- Without this, a worker whose owner_id is null falls through
-- coalesce(owner_id, uid) and gets PROJECT_UNAVAILABLE — an error that
-- points at the project rather than at the account, which is exactly the
-- wrong place to send someone debugging it. Replaces both RPC bodies
-- from 0050; everything else about them is unchanged.
create or replace function attendance_time_in(
  p_project_id  bigint,
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

  select name into v_name
    from attendance_projects
   where id = p_project_id and owner_id = v_owner and is_active;
  if not found then
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
    timein_project_id, timein_project_name, timein_at, timein_photo_path,
    timein_description, timein_lat, timein_lng, timein_accuracy_m,
    timein_event_id, timein_was_offline, timein_received_at
  ) values (
    v_owner, v_uid, v_prof.display_name, v_prof.job_position,
    v_date, 1, 'working',
    p_project_id, v_name, p_captured_at, p_photo_path,
    nullif(btrim(coalesce(p_description,'')), ''), p_lat, p_lng, p_accuracy_m,
    p_event_id, coalesce(p_was_offline,false), now()
  )
  returning * into v_row;

  return v_row;
end $$;


create or replace function attendance_time_out(
  p_project_id  bigint,
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

  select name into v_name
    from attendance_projects
   where id = p_project_id and owner_id = v_owner and is_active;
  if not found then
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
     set status               = 'complete',
         timeout_project_id   = p_project_id,
         timeout_project_name = v_name,
         timeout_at           = p_captured_at,
         timeout_photo_path   = p_photo_path,
         timeout_description  = nullif(btrim(coalesce(p_description,'')), ''),
         timeout_lat          = p_lat,
         timeout_lng          = p_lng,
         timeout_accuracy_m   = p_accuracy_m,
         timeout_event_id     = p_event_id,
         timeout_was_offline  = coalesce(p_was_offline,false),
         timeout_received_at  = now(),
         total_minutes        = floor(extract(epoch from (p_captured_at - timein_at)) / 60)::int
   where id = v_row.id
  returning * into v_row;

  return v_row;
end $$;
