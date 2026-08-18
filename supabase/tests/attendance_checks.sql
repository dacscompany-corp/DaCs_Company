-- ════════════════════════════════════════════════════════════════════
-- Attendance — schema, RPC and RLS checks.
-- Run in the Supabase SQL editor AFTER applying 0050_attendance.sql.
--
-- Every block is wrapped in begin/rollback, so running this file leaves
-- NO data behind. Failures raise loudly via `assert` — a silent pass
-- means the assertion ran and held.
--
-- Kept separate from rls_checks.sql on purpose: attendance is a
-- deliberately isolated module (see the design spec, section 2), and its
-- checks travel with it.
--
-- ── 0. Fill these in from your database ──────────────────────────────
--    select id, email, role, owner_id, status from profiles
--     where role in ('owner','staff','worker') order by role;
--
--    <OWNER_UUID>   an owner profile
--    <WORKER_UUID>  a worker profile whose owner_id = <OWNER_UUID>
--    <STAFF_UUID>   a staff profile whose owner_id = <OWNER_UUID>
--    <OTHER_UUID>   any profile belonging to a DIFFERENT owner
--
-- Find/replace those four tokens before running.
-- ════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 1. Schema shape — tables, columns and constraints exist.          ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  do $$
  declare n int;
  begin
    select count(*) into n from information_schema.tables
     where table_schema = 'public'
       and table_name in ('attendance_projects','attendance_records','attendance_terms_acceptances');
    assert n = 3, format('expected 3 attendance tables, found %s', n);

    select count(*) into n from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name in ('position','worker_no');
    assert n = 2, format('expected profiles.position and profiles.worker_no, found %s', n);

    -- the one-record-per-day guarantee
    select count(*) into n from pg_indexes
     where schemaname = 'public' and indexname = 'attendance_worker_day_uniq';
    assert n = 1, 'attendance_worker_day_uniq is missing — one-record-per-day is unenforced';

    -- the idempotency guarantee
    select count(*) into n from pg_indexes
     where schemaname = 'public' and indexname = 'attendance_timein_event_uniq';
    assert n = 1, 'attendance_timein_event_uniq is missing — replay would duplicate';

    raise notice 'BLOCK 1 OK — schema shape';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 2. Every existing worker got a worker_no; nobody else did.        ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  do $$
  declare n int;
  begin
    select count(*) into n from profiles
     where role in ('worker','teamLeader') and worker_no is null;
    assert n = 0, format('%s worker profiles have no worker_no', n);

    select count(*) into n from profiles
     where coalesce(role,'') not in ('worker','teamLeader') and worker_no is not null;
    assert n = 0, format('%s non-worker profiles were given a worker_no', n);

    raise notice 'BLOCK 2 OK — worker_no backfill';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 3. RLS — a worker may read own rows and active projects only,     ║
-- ║    and may NOT write attendance_records directly.                 ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  -- Seed as service role (bypasses RLS), then drop to the worker.
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Test Active',   true),
         ('<OWNER_UUID>'::uuid, 'ZZ Test Inactive', false);

  insert into attendance_records
    (owner_id, worker_id, work_date, timein_project_name, timein_at,
     timein_photo_path, timein_event_id)
  values
    ('<OWNER_UUID>'::uuid, '<WORKER_UUID>'::uuid, current_date,
     'ZZ Test Active', now(), 'zz/test/in.jpg', gen_random_uuid()),
    ('<OWNER_UUID>'::uuid, '<OTHER_UUID>'::uuid,  current_date,
     'ZZ Test Active', now(), 'zz/other/in.jpg', gen_random_uuid());

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare n int; blocked boolean := false;
  begin
    -- own rows only
    select count(*) into n from attendance_records;
    assert n = 1, format('worker should see exactly 1 own record, saw %s', n);

    -- active projects only
    select count(*) into n from attendance_projects where name like 'ZZ Test%';
    assert n = 1, format('worker should see only the ACTIVE test project, saw %s', n);

    -- direct writes must be impossible
    begin
      insert into attendance_records
        (owner_id, worker_id, work_date, timein_project_name, timein_at,
         timein_photo_path, timein_event_id)
      values ('<OWNER_UUID>'::uuid, '<WORKER_UUID>'::uuid, current_date + 1,
              'ZZ Test Active', now(), 'zz/hack.jpg', gen_random_uuid());
    exception when others then
      blocked := true;
    end;
    assert blocked, 'worker was able to INSERT attendance_records directly — RPC bypass is possible';

    raise notice 'BLOCK 3 OK — worker RLS';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 4. Staff act as their owner and can read the team's records.      ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_records
    (owner_id, worker_id, work_date, timein_project_name, timein_at,
     timein_photo_path, timein_event_id)
  values ('<OWNER_UUID>'::uuid, '<WORKER_UUID>'::uuid, current_date,
          'ZZ Test Active', now(), 'zz/test/in.jpg', gen_random_uuid());

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<STAFF_UUID>","email":"staff@example.com","role":"authenticated"}';

  do $$
  declare n int;
  begin
    select count(*) into n from attendance_records where worker_id = '<WORKER_UUID>'::uuid;
    assert n >= 1, 'staff cannot see their owner''s attendance records';
    raise notice 'BLOCK 4 OK — staff RLS';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 5. Photo bucket exists, is PRIVATE, and is prefix-scoped.         ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  do $$
  declare v_public boolean; n int;
  begin
    select public into v_public from storage.buckets where id = 'attendance';
    assert v_public is not null, 'bucket "attendance" does not exist';
    assert v_public = false, 'bucket "attendance" is PUBLIC — worker photos must be private';

    select count(*) into n from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('attendance_worker_insert','attendance_worker_select','attendance_admin_select');
    assert n = 3, format('expected 3 attendance storage policies, found %s', n);

    raise notice 'BLOCK 5 OK — photo bucket';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 6. Time In — happy path, then IDEMPOTENT REPLAY.                  ║
-- ║    The replay case is the whole reason this is an RPC.            ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ RPC Project', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare
    v_proj  bigint;
    v_event uuid := gen_random_uuid();
    v_a     attendance_records;
    v_b     attendance_records;
    n       int;
  begin
    select id into v_proj from attendance_projects where name = 'ZZ RPC Project';

    -- first call
    v_a := attendance_time_in(
      p_project_id  => v_proj,
      p_captured_at => timestamptz '2026-08-17 07:45:00+08',
      p_photo_path  => 'w/2026-08-17/in-x.jpg',
      p_event_id    => v_event,
      p_description => 'Started construction work at Block A.'
    );
    assert v_a.status = 'working', format('expected status working, got %s', v_a.status);
    assert v_a.work_date = date '2026-08-17',
      format('expected work_date 2026-08-17, got %s', v_a.work_date);
    assert v_a.timein_project_name = 'ZZ RPC Project', 'project name was not snapshotted';
    assert v_a.total_minutes is null, 'total_minutes must stay null until Time Out';

    -- SAME event id replayed — must return the same row, not a new one
    v_b := attendance_time_in(
      p_project_id  => v_proj,
      p_captured_at => timestamptz '2026-08-17 07:45:00+08',
      p_photo_path  => 'w/2026-08-17/in-x.jpg',
      p_event_id    => v_event
    );
    assert v_b.id = v_a.id, 'replay created a DIFFERENT record — idempotency is broken';

    select count(*) into n from attendance_records
     where worker_id = '<WORKER_UUID>'::uuid and work_date = date '2026-08-17';
    assert n = 1, format('replay left %s rows, expected 1', n);

    raise notice 'BLOCK 6 OK — Time In happy path + idempotent replay';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 7. Time In twice with DIFFERENT event ids -> ALREADY_TIMED_IN.    ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ RPC Project', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare v_proj bigint; v_msg text := ''; n int;
  begin
    select id into v_proj from attendance_projects where name = 'ZZ RPC Project';

    perform attendance_time_in(v_proj, timestamptz '2026-08-17 07:45:00+08',
              'p/in-1.jpg', gen_random_uuid());
    begin
      perform attendance_time_in(v_proj, timestamptz '2026-08-17 09:00:00+08',
                'p/in-2.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'ALREADY_TIMED_IN', format('expected ALREADY_TIMED_IN, got "%s"', v_msg);

    select count(*) into n from attendance_records
     where worker_id = '<WORKER_UUID>'::uuid and work_date = date '2026-08-17';
    assert n = 1, format('duplicate Time In left %s rows', n);

    raise notice 'BLOCK 7 OK — duplicate Time In blocked';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 8. UTC+8 DATE BOUNDARY — 23:50 and 00:10 Manila are different     ║
-- ║    work_dates. A UTC date key would collapse them. Also rejects   ║
-- ║    a future capture and an inactive project.                      ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ RPC Project',  true),
         ('<OWNER_UUID>'::uuid, 'ZZ RPC Inactive', false);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare
    v_proj bigint; v_off bigint; v_msg text := '';
    d1 date; d2 date;
  begin
    select id into v_proj from attendance_projects where name = 'ZZ RPC Project';
    select id into v_off  from attendance_projects where name = 'ZZ RPC Inactive';

    -- 2026-08-17 23:50+08 -> work_date 2026-08-17 (in UTC it is 15:50 same day)
    d1 := (attendance_time_in(v_proj, timestamptz '2026-08-17 23:50:00+08',
             'p/a.jpg', gen_random_uuid())).work_date;
    assert d1 = date '2026-08-17', format('23:50 Manila gave work_date %s', d1);

    -- 2026-08-18 00:10+08 -> work_date 2026-08-18 (in UTC it is 2026-08-17 16:10)
    d2 := (attendance_time_in(v_proj, timestamptz '2026-08-18 00:10:00+08',
             'p/b.jpg', gen_random_uuid())).work_date;
    assert d2 = date '2026-08-18', format('00:10 Manila gave work_date %s', d2);
    assert d1 <> d2, 'midnight boundary collapsed two days into one work_date';

    -- a capture in the future is rejected outright
    begin
      perform attendance_time_in(v_proj, now() + interval '10 minutes',
                'p/c.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'CAPTURED_IN_FUTURE', format('expected CAPTURED_IN_FUTURE, got "%s"', v_msg);

    -- an inactive project is not selectable
    v_msg := '';
    begin
      perform attendance_time_in(v_off, timestamptz '2026-08-19 07:45:00+08',
                'p/d.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'PROJECT_UNAVAILABLE', format('expected PROJECT_UNAVAILABLE, got "%s"', v_msg);

    raise notice 'BLOCK 8 OK — UTC+8 boundary, future capture, inactive project';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 9. Time Out — total_minutes, independent project, replay,         ║
-- ║    and the MVP's own worked example: 7:45 AM -> 5:30 PM = 585.    ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Site A', true),
         ('<OWNER_UUID>'::uuid, 'ZZ Site B', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare
    a bigint; b bigint;
    v_out uuid := gen_random_uuid();
    r attendance_records; r2 attendance_records;
    n int;
  begin
    select id into a from attendance_projects where name = 'ZZ Site A';
    select id into b from attendance_projects where name = 'ZZ Site B';

    perform attendance_time_in(a, timestamptz '2026-08-17 07:45:00+08',
              'p/in.jpg', gen_random_uuid());

    -- Time Out on a DIFFERENT project — MVP section 13 stores both independently
    r := attendance_time_out(
      p_project_id  => b,
      p_captured_at => timestamptz '2026-08-17 17:30:00+08',
      p_photo_path  => 'p/out.jpg',
      p_event_id    => v_out,
      p_description => 'Finished construction work at Block A.'
    );

    assert r.status = 'complete', format('expected complete, got %s', r.status);
    assert r.total_minutes = 585,
      format('7:45 AM to 5:30 PM must be 585 minutes (9h45m), got %s', r.total_minutes);
    assert r.timein_project_name  = 'ZZ Site A', 'Time In project was overwritten';
    assert r.timeout_project_name = 'ZZ Site B', 'Time Out project was not stored independently';
    assert r.work_date = date '2026-08-17', 'work_date changed on Time Out';

    -- replay returns the same row
    r2 := attendance_time_out(b, timestamptz '2026-08-17 17:30:00+08',
            'p/out.jpg', v_out);
    assert r2.id = r.id, 'Time Out replay created a different record';

    select count(*) into n from attendance_records
     where worker_id = '<WORKER_UUID>'::uuid and work_date = date '2026-08-17';
    assert n = 1, format('expected 1 row after Time Out + replay, got %s', n);

    raise notice 'BLOCK 9 OK — Time Out, 585 minutes, independent projects, replay';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 10. Time Out error paths: no Time In, already complete,           ║
-- ║     and Time Out before Time In.                                  ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Site A', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare a bigint; v_msg text := ''; n int;
  begin
    select id into a from attendance_projects where name = 'ZZ Site A';

    -- (a) Time Out with no Time In
    begin
      perform attendance_time_out(a, timestamptz '2026-08-17 17:30:00+08',
                'p/o.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'NOT_TIMED_IN', format('expected NOT_TIMED_IN, got "%s"', v_msg);

    -- (b) Time Out BEFORE Time In
    perform attendance_time_in(a, timestamptz '2026-08-17 07:45:00+08',
              'p/i.jpg', gen_random_uuid());
    v_msg := '';
    begin
      perform attendance_time_out(a, timestamptz '2026-08-17 06:00:00+08',
                'p/o.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'TIMEOUT_BEFORE_TIMEIN',
      format('expected TIMEOUT_BEFORE_TIMEIN, got "%s"', v_msg);

    -- (c) Time Out twice with different event ids
    perform attendance_time_out(a, timestamptz '2026-08-17 17:30:00+08',
              'p/o1.jpg', gen_random_uuid());
    v_msg := '';
    begin
      perform attendance_time_out(a, timestamptz '2026-08-17 18:00:00+08',
                'p/o2.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'ALREADY_COMPLETE', format('expected ALREADY_COMPLETE, got "%s"', v_msg);

    select count(*) into n from attendance_records
     where worker_id = '<WORKER_UUID>'::uuid and work_date = date '2026-08-17';
    assert n = 1, format('error paths left %s rows, expected 1', n);

    raise notice 'BLOCK 10 OK — Time Out error paths';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 10b. A forgotten Time Out cannot be closed a day late.            ║
-- ║      The night-shift window must not silently produce a 33h day.  ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Site A', true);

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare a bigint; v_msg text := ''; r attendance_records;
  begin
    select id into a from attendance_projects where name = 'ZZ Site A';

    -- timed in yesterday morning, never timed out
    perform attendance_time_in(a, timestamptz '2026-08-17 07:45:00+08',
              'p/i.jpg', gen_random_uuid());

    -- tries to time out the NEXT afternoon -> 33 hours later
    begin
      perform attendance_time_out(a, timestamptz '2026-08-18 17:00:00+08',
                'p/o.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'SHIFT_TOO_LONG',
      format('a 33-hour shift was accepted — expected SHIFT_TOO_LONG, got "%s"', v_msg);

    -- but a genuine NIGHT SHIFT crossing midnight still works:
    -- 22:00 on the 19th -> 06:00 on the 20th is 8 hours.
    perform attendance_time_in(a, timestamptz '2026-08-19 22:00:00+08',
              'p/n-i.jpg', gen_random_uuid());
    r := attendance_time_out(a, timestamptz '2026-08-20 06:00:00+08',
           'p/n-o.jpg', gen_random_uuid());
    assert r.total_minutes = 480,
      format('night shift 22:00 to 06:00 must be 480 minutes, got %s', r.total_minutes);
    assert r.work_date = date '2026-08-19',
      format('night shift must stay on its Time In date, got %s', r.work_date);

    raise notice 'BLOCK 10b OK — 33h rejected, night shift preserved';
  end $$;
rollback;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 11. A DEACTIVATED worker cannot record attendance.                ║
-- ║     MVP section 20 — deactivate must block the action, not just   ║
-- ║     the UI.                                                       ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OWNER_UUID>'::uuid, 'ZZ Site A', true);

  update profiles set status = 'inactive' where id = '<WORKER_UUID>'::uuid;

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare a bigint; v_msg text := '';
  begin
    select id into a from attendance_projects where name = 'ZZ Site A';
    begin
      perform attendance_time_in(a, timestamptz '2026-08-17 07:45:00+08',
                'p/i.jpg', gen_random_uuid());
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'ACCOUNT_INACTIVE',
      format('deactivated worker was not blocked — got "%s"', v_msg);
    raise notice 'BLOCK 11 OK — deactivated worker blocked';
  end $$;
rollback;  -- the status change is rolled back with everything else


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ 12. CROSS-TENANT — a worker cannot use another owner's project    ║
-- ║     and cannot see another owner's records.                       ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;
  -- A project belonging to a DIFFERENT owner.
  insert into attendance_projects (owner_id, name, is_active)
  values ('<OTHER_UUID>'::uuid, 'ZZ Foreign Project', true);

  insert into attendance_records
    (owner_id, worker_id, work_date, timein_project_name, timein_at,
     timein_photo_path, timein_event_id)
  values ('<OTHER_UUID>'::uuid, '<OTHER_UUID>'::uuid, current_date,
          'ZZ Foreign Project', now(), 'zz/foreign.jpg', gen_random_uuid());

  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"<WORKER_UUID>","email":"worker@example.com","role":"authenticated"}';

  do $$
  declare f bigint; n int;
  begin
    -- Read through the worker's own RLS view. A non-STRICT `select into`
    -- with no visible row leaves f NULL rather than raising — so f being
    -- NULL is exactly the proof we want: the project is invisible.
    select id into f from attendance_projects where name = 'ZZ Foreign Project';
    assert f is null, 'worker can SEE another owner''s project in the picker';

    -- and cannot read the foreign record
    select count(*) into n from attendance_records
     where timein_project_name = 'ZZ Foreign Project';
    assert n = 0, format('worker can read %s of another owner''s records', n);

    raise notice 'BLOCK 12 OK — cross-tenant isolation';
  end $$;
rollback;


-- ════════════════════════════════════════════════════════════════════
-- Expected output: thirteen notices —
--   BLOCK 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10b, 11, 12 ... OK
--
-- Then confirm nothing was left behind (every block rolls back):
--   select count(*) from attendance_projects where name like 'ZZ %';
--   select count(*) from attendance_records  where timein_photo_path like 'p/%'
--                                               or timein_photo_path like 'zz/%'
--                                               or timein_photo_path like 'w/%';
-- Both must be 0.
-- ════════════════════════════════════════════════════════════════════
