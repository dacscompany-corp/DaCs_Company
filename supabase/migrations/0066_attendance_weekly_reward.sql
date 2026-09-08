-- ════════════════════════════════════════════════════════════════════
-- 0066_attendance_weekly_reward.sql
--
-- THE WEEKLY ATTENDANCE REWARD. ₱500 for a week in which every required
-- Monday–Friday day carries an on-time Time In.
--
-- ── WHAT QUALIFICATION READS: `timein_at`, and nothing else.
--    NOT status, NOT timeout_at, NOT total_minutes.
--
--    This is the single most important property of the whole feature.
--    It means no admin action, taken on any schedule, can move anyone's
--    money. A forgotten Time Out that an admin closes with
--    attendance_abandon (0061) is invisible here; so is an open day
--    nobody has got to yet. Reading `status` would have made an admin's
--    cleanup work decide a worker's ₱500, and would have collided with
--    0061's STILL_TODAY rule, under which a Friday forgotten Time Out
--    cannot be resolved before Saturday.
--
--    Workers are still required to Time Out. It is simply not what the
--    reward is measuring.
--
-- ── STILL OUTSIDE THE MONEY MODEL, and this migration is where that
--    claim gets tested, because there IS now a peso figure in an
--    attendance table.
--
--    `amount` is a REPORTED FIGURE ONLY. Nothing here writes to payroll,
--    expenses, folders or construction_projects; nothing feeds Spent /
--    Earned / Profit; and no trigger, view or function may ever turn a
--    qualification into an accounting entry. Payment happens outside the
--    system entirely, and `paid` records only that somebody says it did.
--    Attendance hours remain not the basis of pay — DAC's labour is
--    pakyaw, capped by labor_contracts.agreed_amount.
--
-- ── 'in_progress' IS THE ABSENCE OF A ROW, never a stored value. Same
--    rule 0050 set for 'no_record'. The current week has no row until it
--    is evaluated and frozen; attendance_reward_progress() answers for
--    it live, computing nothing that gets written.
--
-- Idempotent -- safe to re-run.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. The frozen record ────────────────────────────────────────────
--
-- One row per worker per week, written once and then left alone. §42
-- calls for a permanent record and explicitly says it must not be
-- recalculated because historical display information changed.
--
-- worker_name is snapshotted for the same reason attendance_records
-- snapshots it: a later rename must not rewrite what a past reward said.
create table if not exists attendance_weekly_rewards (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  worker_id     uuid not null references auth.users(id) on delete cascade,

  worker_name     text,
  worker_position text,

  week_start date not null,   -- Monday
  week_end   date not null,   -- Friday

  required_days  smallint not null,
  completed_days smallint not null,
  on_time_days   smallint not null,
  late_days      smallint not null,
  missing_days   smallint not null,

  status text not null,

  -- Snapshotted, not read from config at display time -- same reasoning
  -- as worker_name. If ₱500 ever changes, past rewards must keep what
  -- was actually awarded.
  amount numeric(12,2) not null default 0,

  -- Payment happens off-system. These record that it was reported done,
  -- and nothing else: no amount moves anywhere as a result of setting
  -- them.
  paid    boolean not null default false,
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,

  evaluated_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- 'in_progress' is deliberately NOT allowed: it is the absence of a
  -- row (see the header).
  constraint attendance_weekly_rewards_status_ck
    check (status in ('qualified','disqualified')),

  constraint attendance_weekly_rewards_monday_ck
    check (extract(isodow from week_start) = 1),

  constraint attendance_weekly_rewards_span_ck
    check (week_end = week_start + 4),

  -- A disqualified week pays nothing. Enforced rather than trusted:
  -- this is the one column anyone would be tempted to "fix" by hand.
  constraint attendance_weekly_rewards_amount_ck
    check ((status = 'qualified') or amount = 0),

  constraint attendance_weekly_rewards_paid_ck
    check (paid = false or paid_at is not null)
);

create unique index if not exists attendance_weekly_rewards_worker_week_uniq
  on attendance_weekly_rewards (worker_id, week_start);

create index if not exists attendance_weekly_rewards_owner_week_idx
  on attendance_weekly_rewards (owner_id, week_start desc);

drop trigger if exists attendance_weekly_rewards_touch on attendance_weekly_rewards;
create trigger attendance_weekly_rewards_touch before update on attendance_weekly_rewards
  for each row execute function attendance_touch_updated_at();

alter table attendance_weekly_rewards enable row level security;

drop policy if exists attendance_weekly_rewards_admin_all on attendance_weekly_rewards;
create policy attendance_weekly_rewards_admin_all on attendance_weekly_rewards
  for all using ((is_owner() or is_staff()) and can_access(owner_id))
  with check ((is_owner() or is_staff()) and can_access(owner_id));

drop policy if exists attendance_weekly_rewards_worker_select on attendance_weekly_rewards;
create policy attendance_weekly_rewards_worker_select on attendance_weekly_rewards
  for select using (worker_id = auth.uid());


-- ── 2. The shared day breakdown ─────────────────────────────────────
--
-- ONE definition of what each day of a week was, used by BOTH the live
-- progress view and the frozen evaluation. They cannot be allowed to
-- drift into disagreeing -- that is 0059's reasoning for sharing
-- attendance_project_name between the two RPCs, and it applies harder
-- here, because a disagreement would mean the reward a worker was shown
-- all week is not the reward they get.
--
-- ── WHICH PROJECT'S CALENDAR APPLIES. Workers are not assigned to
--    projects -- they pick one per Time In, and attendance_projects_for_worker()
--    offers all of them. So the worker's site for the week is INFERRED
--    from the projects they actually timed in at during it.
--
--    Where they worked more than one, a day is treated as not required
--    if ANY of those sites was closed. That is the generous reading, and
--    it is the decided one: a worker whose site was shut is not at fault
--    merely because some other project happened to be open, and nobody
--    sent them there.
--
--    A worker with no Time Ins at all that week has no inferable site,
--    so the plain Mon–Fri week stands. They are absent on every day of
--    it and disqualified regardless, so nothing hangs on the fallback.
--
-- day_status is one of: on_time | late | missing | not_required
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
  -- The sites this worker actually stood on during the week.
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
           coalesce(r.timein_folder_id, r.timein_pm_project_id) as project_id
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
      when (rec.timein_at at time zone 'Asia/Manila')::time > st.start_time then 'late'
      else 'on_time'
    end as day_status
  from days d
  left join rec on rec.work_date = d.work_date
  cross join owner o
  -- Required unless every inferred site says otherwise. With no sites at
  -- all the plain Mon–Fri week stands.
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
  -- Lateness uses the start time of the site they timed in at THAT DAY.
  -- For a day with no Time In the value is unused but must not be null,
  -- or the comparison above would silently never fire.
  cross join lateral (
    select coalesce(
      attendance_start_time(rec.system, rec.project_id, o.owner_id),
      (select a.default_start_time from attendance_config a where a.owner_id = o.owner_id),
      '09:00'::time
    ) as start_time
  ) st
  order by d.work_date;
$$;

-- DELIBERATELY NOT GRANTED TO authenticated. This function is security
-- definer and takes a worker id, so a grant would let any signed-in
-- worker read any other worker's week. Its two callers below are
-- themselves security definer and run as the function owner, so they
-- reach it without a grant. Route every client through
-- attendance_reward_progress(), which checks who is asking.
revoke all on function attendance_week_days(uuid, date) from public;


-- ── 3. Live progress for the current week ───────────────────────────
--
-- Writes nothing. This is what §37's on-screen progress and §43's
-- 'In Progress' status are built from, for a week that has not been
-- frozen yet.
--
-- A worker may only ask about themselves. The function is security
-- definer, so without this check any authenticated worker could read
-- any other worker's week.
create or replace function attendance_reward_progress(
  p_worker     uuid,
  p_week_start date
) returns table (
  work_date  date,
  required   boolean,
  timein_at  timestamptz,
  start_time time,
  day_status text
) language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if p_worker <> auth.uid() and not (is_owner() or is_staff()) then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if extract(isodow from p_week_start) <> 1 then
    raise exception 'WEEK_START_NOT_MONDAY' using errcode = 'P0001';
  end if;

  return query select * from attendance_week_days(p_worker, p_week_start);
end $$;

revoke all on function attendance_reward_progress(uuid, date) from public;
grant execute on function attendance_reward_progress(uuid, date) to authenticated;


-- ── 4. Evaluate and freeze one week ─────────────────────────────────
--
-- ── THE GRACE PERIOD IS THE POINT. This refuses to run until
--    attendance_config.evaluation_grace_hours have passed since the end
--    of the week (Saturday 00:00 Manila). The app is built for sites
--    with no signal: a Time In captured offline on Friday afternoon may
--    not reach the server until the worker passes through coverage days
--    later, and it arrives carrying its ORIGINAL timein_at. Freezing the
--    week before it lands would cost that worker ₱500 for a day they
--    worked on time.
--
--    Because of that refusal it is safe to call this on page load for
--    any unevaluated past week, which is how evaluation actually happens
--    -- no pg_cron dependency.
--
-- ── ONCE WRITTEN, FROZEN. `on conflict do nothing`: §42 says a reward
--    record must not be recalculated. That also means a `paid` flag an
--    admin has already set can never be clobbered by a re-run.
--
-- Every active worker of the owner gets a row, including one who never
-- turned up -- the admin view in §40 is meant to show the whole roster,
-- and a missing row would read as "not evaluated" rather than "absent".
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

  -- No config row yet: the documented defaults, not nulls.
  v_grace  := coalesce(v_grace, 60);
  v_amount := coalesce(v_amount, 500);

  -- End of the week is Saturday 00:00 Manila, i.e. week_start + 5 days.
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
           count(*) filter (where d.required)                            as required_days,
           count(*) filter (where d.day_status in ('on_time','late'))    as completed_days,
           count(*) filter (where d.day_status = 'on_time')              as on_time_days,
           count(*) filter (where d.day_status = 'late')                 as late_days,
           count(*) filter (where d.required and d.day_status = 'missing') as missing_days
      from roster r
      cross join lateral attendance_week_days(r.id, p_week_start) d
     group by r.id, r.display_name, r.position
  ),
  scored as (
    select t.*,
           -- Qualified when every required day carried an on-time Time
           -- In. required_days = 0 (the whole week closed) cannot
           -- qualify: there is nothing to have been on time for.
           (t.required_days > 0 and t.on_time_days >= t.required_days
            and t.late_days = 0 and t.missing_days = 0) as qualified
      from tally t
  ),
  ins as (
    insert into attendance_weekly_rewards (
      owner_id, worker_id, worker_name, worker_position,
      week_start, week_end,
      required_days, completed_days, on_time_days, late_days, missing_days,
      status, amount, evaluated_at
    )
    select p_owner, s.worker_id, s.display_name, s.position,
           p_week_start, p_week_start + 4,
           s.required_days, s.completed_days, s.on_time_days, s.late_days, s.missing_days,
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


-- ── 5. Mark a reward paid ───────────────────────────────────────────
--
-- A STATUS MARKER, NOT AN ACCOUNTING ENTRY. Payment happens outside the
-- system; this records that somebody says it happened, so a disputed
-- payout has something to point at. No amount moves anywhere as a
-- result of calling this, and nothing may ever make it do so.
create or replace function attendance_reward_mark_paid(
  p_reward_id uuid,
  p_paid      boolean default true
) returns attendance_weekly_rewards
language plpgsql security definer set search_path = public as $$
declare
  v_row attendance_weekly_rewards;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_row from attendance_weekly_rewards where id = p_reward_id for update;

  if not found or not can_access(v_row.owner_id) then
    raise exception 'REWARD_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (is_owner() or is_staff()) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  -- Nothing was owed, so nothing can be paid. Without this the flag
  -- could be set on a disqualified week and the export would ask
  -- payroll for ₱0.
  if p_paid and v_row.status <> 'qualified' then
    raise exception 'NOT_QUALIFIED' using errcode = 'P0001';
  end if;

  update attendance_weekly_rewards
     set paid    = p_paid,
         paid_at = case when p_paid then now() else null end,
         paid_by = case when p_paid then auth.uid() else null end
   where id = v_row.id
  returning * into v_row;

  return v_row;
end $$;

revoke all on function attendance_reward_mark_paid(uuid, boolean) from public;
grant execute on function attendance_reward_mark_paid(uuid, boolean) to authenticated;
