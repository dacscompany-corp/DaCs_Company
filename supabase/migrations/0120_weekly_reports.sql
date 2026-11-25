-- ════════════════════════════════════════════════════════════════════
-- 0120 — Attendance → Weekly reports, part A: roster history and office access
-- ════════════════════════════════════════════════════════════════════
--
-- Weekly reports need to know who was on the roster in a given week, even after
-- a worker is deactivated or changes role. So every change in whether a profile
-- counts as a report worker (role worker / teamLeader, active, with a company)
-- is written down, dated by the Manila calendar day it happened.
--
-- ── att_report_eligibility: append-only history. One row each time a person
--    starts or stops being eligible, or moves company. RLS on, NO policies,
--    all privileges revoked: only security-definer functions touch it.
-- ── att_report_eligible(): the one rule for "counts as a report worker".
-- ── att_report_eligibility_trg: keeps the history on profiles. A change that
--    keeps eligibility (position, display name, worker → teamLeader) writes
--    nothing. Moving company writes false for the old one, true for the new.
-- ── Launch seed: every profile eligible right now, with no history yet, gets one
--    'launch' row dated today (Manila). Re-running adds nothing.
-- ── att_report_owner(): internal gate for the report functions (part B). Active
--    owner or staff only; staff with an allowed_modules list need `attendance`
--    in it (the 0104 pattern). Returns the company id. Not callable by clients.
--
-- Outside the money model, reads attendance only.
-- Spec: docs/superpowers/specs/2026-11-22-weekly-employee-report-mvp-terms.md
-- Test: supabase/tests/weekly_reports.pglite.mjs
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- The migration locks profiles (drop/create trigger, FK); a queued lock would
-- stall every request that reads profiles, so give up after 5s instead.
set local lock_timeout = '5s';

-- ── 1. The roster history ────────────────────────────────────────────
create table if not exists att_report_eligibility (
  id           bigint generated always as identity primary key,
  owner_id     uuid        not null,
  worker_id    uuid        not null references profiles(id) on delete cascade,
  eligible     boolean     not null,
  effective_on date        not null,
  role         text,
  status       text,
  source       text        not null check (source in ('launch', 'profile')),
  recorded_at  timestamptz not null default now()
);
create index if not exists att_report_eligibility_idx
  on att_report_eligibility (owner_id, worker_id, effective_on, id);

alter table att_report_eligibility enable row level security;
revoke all on table att_report_eligibility from public, anon, authenticated;

comment on table att_report_eligibility is
  'Weekly reports (0120): when a worker or team leader started or stopped counting for reports. Append-only, dated by Manila day. No client access.';

-- ── 2. The rule ──────────────────────────────────────────────────────
create or replace function att_report_eligible(p_role text, p_status text, p_owner uuid)
returns boolean language sql immutable as $$
  select coalesce(
    p_role in ('worker', 'teamLeader')
      and coalesce(p_status, 'active') = 'active'
      and p_owner is not null,
    false)
$$;

-- ── 3. Keep the history on profiles ──────────────────────────────────
create or replace function att_report_eligibility_track() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old   boolean := false;
  v_new   boolean := att_report_eligible(new.role, new.status, new.owner_id);
  v_moved boolean := false;
  v_today date    := (now() at time zone 'Asia/Manila')::date;
begin
  if tg_op = 'UPDATE' then
    v_old   := att_report_eligible(old.role, old.status, old.owner_id);
    v_moved := old.owner_id is distinct from new.owner_id;
  end if;
  if v_old and (v_moved or not v_new) then
    insert into att_report_eligibility (owner_id, worker_id, eligible, effective_on, role, status, source)
    values (old.owner_id, new.id, false, v_today, new.role, new.status, 'profile');
  end if;
  if v_new and (v_moved or not v_old) then
    insert into att_report_eligibility (owner_id, worker_id, eligible, effective_on, role, status, source)
    values (new.owner_id, new.id, true, v_today, new.role, new.status, 'profile');
  end if;
  return null;
end $$;
revoke all on function att_report_eligibility_track() from public, anon, authenticated;

drop trigger if exists att_report_eligibility_trg on profiles;
create trigger att_report_eligibility_trg
  after insert or update of role, status, owner_id on profiles
  for each row execute function att_report_eligibility_track();

-- ── 4. Launch seed (idempotent) ──────────────────────────────────────
insert into att_report_eligibility (owner_id, worker_id, eligible, effective_on, role, status, source)
select p.owner_id, p.id, true, (now() at time zone 'Asia/Manila')::date, p.role, p.status, 'launch'
  from profiles p
 where att_report_eligible(p.role, p.status, p.owner_id)
   and not exists (select 1 from att_report_eligibility e where e.worker_id = p.id);

-- ── 5. Office access for the report functions ────────────────────────
create or replace function att_report_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_office() then
    raise exception 'NOT_OFFICE' using errcode = 'P0001';
  end if;
  -- CASE, not OR: Postgres does not promise OR short-circuit order, and
  -- jsonb_array_length() raises on a value that is not an array.
  if not coalesce((select case when jsonb_typeof(p.allowed_modules) = 'array'
                               then (jsonb_array_length(p.allowed_modules) = 0
                                     or p.allowed_modules ? 'attendance')
                               else true end
                     from profiles p where p.id = auth.uid()), false) then
    raise exception 'NO_ATTENDANCE_ACCESS' using errcode = 'P0001';
  end if;
  return data_owner_id();
end $$;
revoke all on function att_report_owner() from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════
-- Part B: week report read and general duties
-- ════════════════════════════════════════════════════════════════════

-- ── 6. Trade from a position ("Helper (Marc Kelley)" → "Helper") ─────
-- Mirrors attSplitPosition in js/attendance-admin.js.
create or replace function att_position_trade(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(btrim(coalesce(p, '')), '\s*\([^)]*\)\s*$', ''))
$$;

-- ── 7. General duties per trade. No client access: RPCs only. ────────
create table if not exists att_position_duties (
  id         uuid        primary key default gen_random_uuid(),
  owner_id   uuid        not null,
  position   text        not null,
  duties     text        not null,
  active     boolean     not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists att_position_duties_uniq
  on att_position_duties (owner_id, lower(position));
alter table att_position_duties enable row level security;
revoke all on table att_position_duties from public, anon, authenticated;

comment on table att_position_duties is
  'Weekly reports (0120): general duties written once per trade (case-insensitive). No client access.';

create or replace function att_duty_save(p_position text, p_duties text, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := att_report_owner();
  v_pos   text := att_position_trade(p_position);
  v_txt   text := btrim(coalesce(p_duties, ''));
  v_row   att_position_duties%rowtype;
begin
  if char_length(v_pos) < 1 or char_length(v_pos) > 80 then
    raise exception 'DUTY_POSITION_INVALID' using errcode = 'P0001';
  end if;
  if char_length(v_txt) < 1 or char_length(v_txt) > 2000 then
    raise exception 'DUTY_TEXT_INVALID' using errcode = 'P0001';
  end if;
  insert into att_position_duties (owner_id, position, duties, active, updated_by, updated_at)
  values (v_owner, v_pos, v_txt, coalesce(p_active, true), auth.uid(), now())
  on conflict (owner_id, lower(position)) do update
     set duties = excluded.duties, active = excluded.active,
         updated_by = auth.uid(), updated_at = now()
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'position', v_row.position, 'duties', v_row.duties,
                            'active', v_row.active, 'updated_at', v_row.updated_at);
end $$;
revoke all on function att_duty_save(text, text, boolean) from public, anon;
grant execute on function att_duty_save(text, text, boolean) to authenticated;

create or replace function att_duty_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := att_report_owner();
begin
  return jsonb_build_object(
    'positions', coalesce((
      -- one spelling per trade, ignoring case: the duty row's own, else the
      -- first by byte order (so "Mason" beats "mason")
      select jsonb_agg(shown order by lower(shown))
        from (select coalesce(min(d_pos), min(trade collate "C")) as shown
                from (select att_position_trade(p.position) as trade, null::text as d_pos
                        from profiles p
                       where p.owner_id = v_owner and p.role in ('worker', 'teamLeader')
                         and coalesce(p.status, 'active') = 'active'
                      union all
                      select d.position, d.position from att_position_duties d where d.owner_id = v_owner) t
               where trade <> ''
               group by lower(trade)) g), '[]'::jsonb),
    'duties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'position', d.position, 'duties', d.duties, 'active', d.active,
               'updated_at', d.updated_at,
               'updated_by_name', coalesce(nullif(btrim(u.display_name), ''), split_part(u.email, '@', 1)))
             order by lower(d.position))
        from att_position_duties d left join profiles u on u.id = d.updated_by
       where d.owner_id = v_owner), '[]'::jsonb));
end $$;
revoke all on function att_duty_list() from public, anon;
grant execute on function att_duty_list() to authenticated;

-- ── 8. One week of attendance for the whole company ──────────────────
-- Reads attendance_records only. No coordinates leave this function.
create or replace function att_week_report(p_week_start date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := att_report_owner();
  v_end   date;
  v_hist  date;
  v_roster jsonb;
  v_recs   jsonb;
  v_duties jsonb;
begin
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'WEEK_START_NOT_MONDAY' using errcode = 'P0001';
  end if;
  v_end := p_week_start + 6;

  select min(effective_on) into v_hist from att_report_eligibility where owner_id = v_owner;

  with ev as (select worker_id, eligible, effective_on, id from att_report_eligibility
               where owner_id = v_owner and effective_on <= v_end),
  start_state as (select distinct on (worker_id) worker_id, eligible from ev
                   where effective_on < p_week_start order by worker_id, effective_on desc, id desc),
  elig as (select worker_id from start_state where eligible
           union select worker_id from ev where eligible and effective_on between p_week_start and v_end),
  recs as (select distinct worker_id from attendance_records
            where owner_id = v_owner and work_date between p_week_start and v_end),
  members as (select coalesce(e.worker_id, r.worker_id) as worker_id,
                     case when e.worker_id is not null then 'eligible' else 'records' end as in_roster
                from elig e full join recs r on r.worker_id = e.worker_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'worker_id', m.worker_id, 'worker_no', p.worker_no,
           'name', coalesce(nullif(btrim(p.display_name), ''), split_part(p.email, '@', 1)),
           'position', p.position, 'role', p.role,
           'active', coalesce(p.status, 'active') = 'active',
           'in_roster', m.in_roster)
         order by lower(coalesce(nullif(btrim(p.display_name), ''), split_part(p.email, '@', 1))), m.worker_id), '[]'::jsonb)
    into v_roster
    from members m left join profiles p on p.id = m.worker_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'worker_id', r.worker_id, 'worker_name', r.worker_name,
           'worker_position', r.worker_position, 'work_date', r.work_date, 'status', r.status,
           'timein_at', r.timein_at, 'timein_project_system', r.timein_project_system,
           'timein_folder_id', r.timein_folder_id, 'timein_pm_project_id', r.timein_pm_project_id,
           'timein_project_name', r.timein_project_name, 'timein_photo_path', r.timein_photo_path,
           'timein_description', r.timein_description, 'timein_location_status', r.timein_location_status,
           'timein_is_mock', r.timein_is_mock, 'timein_was_offline', r.timein_was_offline,
           'timeout_at', r.timeout_at, 'timeout_project_system', r.timeout_project_system,
           'timeout_folder_id', r.timeout_folder_id, 'timeout_pm_project_id', r.timeout_pm_project_id,
           'timeout_project_name', r.timeout_project_name, 'timeout_photo_path', r.timeout_photo_path,
           'timeout_extra_photo_paths', to_jsonb(r.timeout_extra_photo_paths),
           'timeout_description', r.timeout_description, 'timeout_event_id', r.timeout_event_id,
           'timeout_location_status', r.timeout_location_status, 'timeout_is_mock', r.timeout_is_mock,
           'timeout_was_offline', r.timeout_was_offline, 'total_minutes', r.total_minutes,
           'abandoned_at', r.abandoned_at, 'abandoned_note', r.abandoned_note)
         order by r.work_date, r.timein_at, r.id), '[]'::jsonb)
    into v_recs
    from attendance_records r
   where r.owner_id = v_owner and r.work_date between p_week_start and v_end;

  select coalesce(jsonb_agg(jsonb_build_object('position', d.position, 'duties', d.duties, 'updated_at', d.updated_at)
         order by lower(d.position)), '[]'::jsonb)
    into v_duties
    from att_position_duties d where d.owner_id = v_owner and d.active;

  return jsonb_build_object(
    'week_start', to_char(p_week_start, 'YYYY-MM-DD'), 'week_end', to_char(v_end, 'YYYY-MM-DD'),
    'generated_at', now(), 'history_starts_on', to_char(v_hist, 'YYYY-MM-DD'),
    'roster', v_roster, 'records', v_recs, 'duties', v_duties);
end $$;
revoke all on function att_week_report(date) from public, anon;
grant execute on function att_week_report(date) to authenticated;
