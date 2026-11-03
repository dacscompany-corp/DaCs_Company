-- ═════════════════════════════════════════════════
-- One-off removal, the user's decision of 3 Nov 2026: the Work Plan test records
-- left by the Stage 1c pilots of 13-14 Oct 2026 on Barlin Residence. They are
-- every Work Plan record on live as of 3 Nov: 8 tasks and 1 meeting, with their
-- history, people, acknowledgements, 1 blocker, 1 dependency and 2 photo rows.
-- Two of the 8 have no "ZZ" name: "Install kitchen cabinets" and "Z 1c2 browser
-- – hand task". They hang on the test meeting, were cancelled with the reason
-- "test", and are in the pilot's record
-- (docs/superpowers/specs/2026-10-13-workmate-stage1c2-verification-record.md, row 11).
--
-- Run by the USER in the Supabase SQL editor. One transaction. Any failed guard
-- stops it and changes NOTHING. A real run cannot be undone.
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It deletes everything, checks the result,
--            prints a red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- It goes by exact id, title, status and project, and expects exact counts, so
-- a real task added since, or any change to these, stops it.
--
-- Stays on purpose:
--   wp_ops      — the answers to old saves. No screen shows them, and they stop
--                 an old phone's unsent action from running a second time.
--   2 photos    — the FILES stay in Storage (SQL does not delete Storage files).
--                 Nothing links to them after this.
--   teams       — "Team test" and "Team pilot B" are not Work Plan records.
-- No money record is touched: nothing here reads or writes a peso.
-- ═════════════════════════════════════════════════

do $$
declare
  v_dry boolean := true;
  c_meeting constant uuid := '42674773-c834-4e11-b73e-a004601192cb';
  c_barlin constant uuid := '52bd467a-be33-4282-b676-bfe644f7dd90';
  c_before constant timestamptz := '2026-10-15 00:00:00+00';
  v_tasks uuid[];
  v_versions uuid[];
  n int;
  other_tasks bigint;
  other_events bigint;
  money_before text;
  money_after text;
  msg text := '';
begin
  -- ── The records must be exactly as found on 3 Nov ──────────────
  select array_agg(t.id) into v_tasks
    from wp_tasks t
    join (values
      ('16494269-8b6f-416b-a923-b7f7d05953c0'::uuid, 'ZZ 1c2 browser – wall prep', 'cancelled'),
      ('d1a469d3-9b4a-488a-88bf-b9d9a28a4a31'::uuid, 'ZZ 1c3 A – skim coat', 'completed'),
      ('bdf4fb00-5aa0-481c-a0a7-f4f047608997'::uuid, 'ZZ 1c3 B – cabinets', 'cancelled'),
      ('b8021855-b2d5-47ce-a697-c235dbca9008'::uuid, 'ZZ 1c3 C – paint', 'cancelled'),
      ('0f67e1d9-ddfd-47b3-b40e-dc835b880962'::uuid, 'ZZ 1c3 proposal 1', 'cancelled'),
      ('56e0c592-0e16-4dd8-8759-86fe8b6a2d6b'::uuid, 'ZZ 1c3 proposal 2', 'cancelled'),
      ('f77304cf-ce98-4855-8642-e25bb1b7dc49'::uuid, 'Install kitchen cabinets', 'cancelled'),
      ('4c0c3e74-a81e-48ca-a24f-4f30fcc1f895'::uuid, 'Z 1c2 browser – hand task', 'cancelled')
    ) w(id, title, status) on w.id = t.id and w.title = t.title and w.status = t.status
   where t.folder_id = c_barlin and t.updated_at < c_before;
  if coalesce(array_length(v_tasks, 1), 0) <> 8 then
    raise exception 'GUARD: expected the 8 test tasks exactly as found, matched %', coalesce(array_length(v_tasks, 1), 0);
  end if;
  if not exists (select 1 from wp_meetings where id = c_meeting and title = 'ZZ 1c2 browser meeting.' and updated_at < c_before) then
    raise exception 'GUARD: the test meeting is not as found';
  end if;

  -- ── Nothing real may hang on them ──────────────────────────────
  if exists (select 1 from wp_tasks where meeting_id = c_meeting and not id = any(v_tasks)) then
    raise exception 'GUARD: another task is on the test meeting';
  end if;
  if exists (select 1 from wp_dependencies where (task_id = any(v_tasks)) <> (depends_on = any(v_tasks))) then
    raise exception 'GUARD: a dependency links a test task to another task';
  end if;

  select count(*) into other_tasks from wp_tasks where not id = any(v_tasks);
  select count(*) into other_events from wp_events
   where (task_id is null or not task_id = any(v_tasks)) and meeting_id is distinct from c_meeting;
  select (select count(*) || '/' || coalesce(sum(amount), 0) from expenses) || ' ' || (select count(*) || '/' || coalesce(sum(total_salary), 0) from payroll)
         || ' ' || (select count(*) from folders) || ' ' || (select count(*) || '/' || coalesce(sum(receipt_total), 0) from purchases)
    into money_before;
  select array_agg(id) into v_versions from wp_meeting_versions where meeting_id = c_meeting;

  -- ── Remove, children first, each with the count it must have ───
  delete from wp_photos where task_id = any(v_tasks);
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'GUARD: % photo rows, expected 2', n; end if;
  msg := msg || n || ' photo rows';

  delete from wp_note_recipients where version_id = any(v_versions);
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'GUARD: % note recipients, expected 3', n; end if;
  msg := msg || ', ' || n || ' note recipients';

  delete from wp_events where task_id = any(v_tasks) or meeting_id = c_meeting;
  get diagnostics n = row_count;
  if n <> 67 then raise exception 'GUARD: % history rows, expected 67', n; end if;
  msg := msg || ', ' || n || ' history rows';

  delete from wp_acks where task_id = any(v_tasks);
  get diagnostics n = row_count;
  if n <> 9 then raise exception 'GUARD: % acknowledgements, expected 9', n; end if;
  msg := msg || ', ' || n || ' acknowledgements';

  delete from wp_blockers where task_id = any(v_tasks);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'GUARD: % blockers, expected 1', n; end if;
  msg := msg || ', ' || n || ' blocker';

  delete from wp_dependencies where task_id = any(v_tasks) or depends_on = any(v_tasks);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'GUARD: % dependencies, expected 1', n; end if;
  msg := msg || ', ' || n || ' dependency';

  delete from wp_task_people where task_id = any(v_tasks);
  get diagnostics n = row_count;
  if n <> 19 then raise exception 'GUARD: % task people, expected 19', n; end if;
  msg := msg || ', ' || n || ' task people';

  delete from wp_tasks where id = any(v_tasks);
  get diagnostics n = row_count;
  if n <> 8 then raise exception 'GUARD: % tasks, expected 8', n; end if;
  msg := msg || ', ' || n || ' tasks';

  delete from wp_meeting_versions where meeting_id = c_meeting;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'GUARD: % meeting versions, expected 2', n; end if;
  msg := msg || ', ' || n || ' meeting versions';

  delete from wp_meetings where id = c_meeting;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'GUARD: % meetings, expected 1', n; end if;
  msg := msg || ', ' || n || ' meeting';

  -- ── Everything else exactly as it was ──────────────────────────
  if (select count(*) from wp_tasks) <> other_tasks or (select count(*) from wp_events) <> other_events then
    raise exception 'GUARD: another Work Plan record changed';
  end if;
  if not exists (select 1 from folders where id = c_barlin) then
    raise exception 'GUARD: Barlin Residence is gone';
  end if;
  select (select count(*) || '/' || coalesce(sum(amount), 0) from expenses) || ' ' || (select count(*) || '/' || coalesce(sum(total_salary), 0) from payroll)
         || ' ' || (select count(*) from folders) || ' ' || (select count(*) || '/' || coalesce(sum(receipt_total), 0) from purchases)
    into money_after;
  if money_after is distinct from money_before then
    raise exception 'GUARD: a money record or project changed';
  end if;
  msg := msg || '. Left in Work Plan: ' || other_tasks || ' tasks, ' || other_events || ' history rows. Expenses, payroll, purchases and projects unchanged.';

  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): would remove %', msg;
  end if;
  raise notice 'REMOVAL DONE: removed %', msg;
end $$;
