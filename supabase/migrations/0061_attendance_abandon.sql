-- ════════════════════════════════════════════════════════════════════
-- 0061_attendance_abandon.sql
--
-- CLOSING A FORGOTTEN TIME OUT. Until now a worker who timed in and
-- never timed out left a record on status 'working' FOREVER: every
-- report showed '—' for that day, and A1's "Currently Working" KPI
-- counted them as still on site months later.
--
-- The 'abandoned' status has existed since 0050 and the admin screens
-- have always rendered its pill — nothing has ever been able to SET it.
-- This migration adds the one write that can, plus the trail that says
-- who did it.
--
-- ── WHAT ABANDONING DOES NOT DO. It does not invent hours.
--    total_minutes and timeout_at stay NULL, so the day still reports
--    '—'. The record stops claiming the worker is on site; it never
--    starts claiming when they left. An admin who actually knows the
--    departure time has no way to enter it here, and that is deliberate
--    — a typed-in time would be indistinguishable from a captured one
--    in every report and export.
--
-- ── STILL OUTSIDE THE MONEY MODEL, same as 0050/0059. No peso column,
--    nothing here feeds Spent / Earned / Profit, and attendance hours
--    remain not the basis of pay (DAC's labour is pakyaw, capped by
--    labor_contracts.agreed_amount).
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════


-- ── 1. The trail ────────────────────────────────────────────────────
-- Three columns, written together and only by the RPC below.
--
-- abandoned_by is a plain uuid reference to auth.users, NOT a name
-- snapshot like worker_name. The reasoning differs on purpose: a
-- worker's name is snapshotted because the RECORD is evidence of what
-- was shown at the time, while the closer is an internal admin whose
-- current name is the useful one — and A2 resolves it against profiles
-- at render time.
--
-- `on delete set null`, matching what 0059 chose for the project FKs:
-- removing an admin account must never erase the attendance record that
-- admin once closed.
alter table attendance_records
  add column if not exists abandoned_by   uuid references auth.users(id) on delete set null,
  add column if not exists abandoned_at   timestamptz,
  add column if not exists abandoned_note text;


-- The trail may only exist on a row that is actually abandoned.
--
-- Deliberately NOT the converse. A row may be 'abandoned' with an empty
-- trail: no row has ever carried that status (nothing could set it
-- before today), but 0059's header records what assuming an attendance
-- table is empty cost last time, so the constraint does not bet on it.
-- Rows written from here on always carry by/at — the RPC is the only
-- writer and sets both unconditionally.
alter table attendance_records drop constraint if exists attendance_abandon_trail_ck;
alter table attendance_records add constraint attendance_abandon_trail_ck check (
  status = 'abandoned'
  or (abandoned_by is null and abandoned_at is null and abandoned_note is null)
);


-- ── 2. attendance_abandon ───────────────────────────────────────────
--
-- The ONLY way 'abandoned' is written.
--
-- ── WHY AN RPC AT ALL. Unlike Time In / Time Out — where workers hold
--    no insert or update policy and the RPC is the only physical route
--    — owner and staff DO hold attendance_records_admin_update (0050
--    §6). A direct update from the browser would work. Three things
--    make it the wrong route anyway:
--
--    1. abandoned_at must be now() ON THE SERVER. This module refuses
--       to trust a device clock anywhere else: attendance_time_in
--       rejects a capture more than 2 minutes in the future, and A1
--       badges a record whose device clock drifted. Letting the browser
--       stamp the audit trail would be the one place a client clock is
--       taken at its word.
--    2. abandoned_by must be auth.uid(). Supplied from the browser it
--       is a value the caller picks, which makes the trail worthless
--       precisely when it matters — an admin could attribute their own
--       edit to a colleague.
--    3. The guards below cannot be skipped by a stale page or a console
--       call.
--
--    The admin update policy is deliberately LEFT AS IT IS. Narrowing
--    it would reach past attendance into whatever else may rely on it;
--    this migration adds the good route without breaking the old one.
--
-- Returns the updated row so the caller can repaint from the database's
-- own copy rather than patching its local one.
create or replace function attendance_abandon(
  p_record_id uuid,
  p_note      text default null
) returns attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_today date;
  v_row   attendance_records;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- Owner or staff only. Workers hold a select policy on their own
  -- records and must not be able to close their own open day.
  if not (is_owner() or is_staff()) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;

  select * into v_row
    from attendance_records
   where id = p_record_id
     for update;

  -- can_access is checked AFTER the row is found, and the same error
  -- is raised either way: telling a caller "that record exists but
  -- belongs to another tenant" is a fact they have no use for.
  if not found or not can_access(v_row.owner_id) then
    raise exception 'RECORD_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 'complete' has a real Time Out; 'abandoned' is already closed.
  -- Neither is a forgotten Time Out, and overwriting one would destroy
  -- either a captured event or an existing trail.
  if v_row.status <> 'working' then
    raise exception 'NOT_OPEN' using errcode = 'P0001';
  end if;

  -- A record still open on TODAY's date is far more likely a worker
  -- who is on site right now than one who forgot. Closing it would
  -- delete a live day's Time Out before it happens — and the worker's
  -- app would then get NOT_TIMED_IN when they try, because
  -- attendance_time_out only closes rows on status 'working'.
  --
  -- Manila, not UTC: work_date is a Manila date key (0050 §8), and
  -- comparing it against a UTC "today" would free up today's records
  -- for closing from 08:00 local (see CLAUDE.md).
  v_today := (now() at time zone 'Asia/Manila')::date;
  if v_row.work_date >= v_today then
    raise exception 'STILL_TODAY' using errcode = 'P0001';
  end if;

  update attendance_records
     set status         = 'abandoned',
         abandoned_by   = v_uid,
         abandoned_at   = now(),
         abandoned_note = nullif(btrim(coalesce(p_note, '')), '')
         -- total_minutes and timeout_at are NOT set, and that is the
         -- whole point: nobody knows when this worker left, so the
         -- record never says.
   where id = v_row.id
  returning * into v_row;

  return v_row;
end $$;

revoke all on function attendance_abandon(uuid, text) from public;
grant execute on function attendance_abandon(uuid, text) to authenticated;
