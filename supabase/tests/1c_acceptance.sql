-- ════════════════════════════════════════════════════════════════════
-- Stage 1c-1 acceptance — My Work server (migration 0093).
--
-- Wraps itself in begin / rollback: nothing persists. Builds its own
-- throwaway projects, team, meeting and tasks (names start "ZZ 1c") and
-- checks only what it built. Editor-safe: context lives in transaction-
-- local settings (set_config 'v1c.*'), never a temp table. Dry run with
-- 0093:  begin;  <0093>  <this file>  (its own begin only warns; its
-- rollback undoes the migration too).
--
-- Accounts: W-0007 and W-0019 (active workers), W-0021 (active
-- teamLeader), all of one owner; an active staff account of that owner;
-- another owner account. A failed check stops the script with its message
-- (in the SQL editor the whole transaction is then aborted — expected;
-- nothing is kept); success ends with the row
-- '1c acceptance: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── 0. Throwaway data (as the database owner) ──
do $$
declare
  v_w7 uuid; v_w19 uuid; v_w21 uuid; v_owner uuid; v_staff uuid; v_other uuid;
  v_p uuid; v_aw uuid; v_done uuid; v_oth_p uuid; v_team uuid;
begin
  select id into v_w7  from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w19 from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w21 from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null and v_w19 is not null and v_w21 is not null,
    'W-0007 and W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select coalesce(owner_id, id) from profiles where id = v_w19) = v_owner
     and (select coalesce(owner_id, id) from profiles where id = v_w21) = v_owner, 'the three accounts must share one owner';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  select id into v_other from profiles where role = 'owner' and id <> v_owner limit 1;
  assert v_staff is not null and v_other is not null, 'need an active staff account of that owner and another owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 1c project') returning id into v_p;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 1c AW', v_p) returning id into v_aw;
  insert into folders (owner_id, name, completed_at) values (v_owner, 'ZZ 1c done', now()) returning id into v_done;
  insert into folders (owner_id, name) values (v_other, 'ZZ 1c other company') returning id into v_oth_p;
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1c team') returning id into v_team;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values
    (v_owner, v_team, v_w21, true), (v_owner, v_team, v_w7, false), (v_owner, v_team, v_w19, false);

  perform set_config('v1c.w7', v_w7::text, true);
  perform set_config('v1c.w19', v_w19::text, true);
  perform set_config('v1c.w21', v_w21::text, true);
  perform set_config('v1c.staff', v_staff::text, true);
  perform set_config('v1c.p', v_p::text, true);
  perform set_config('v1c.aw', v_aw::text, true);
  perform set_config('v1c.done', v_done::text, true);
  perform set_config('v1c.oth_p', v_oth_p::text, true);
  perform set_config('v1c.team', v_team::text, true);
end $$;

-- ── 1. Staff: meeting, drafts, validation, publish (spec §13: drafts stay drafts; one destination; one responsible) ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_m uuid; v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid; v_t5 uuid;
  v_base jsonb; v_d1 jsonb; v_d2 jsonb; v_res jsonb;
begin
  v_m := (wp_office_save_meeting(null, 'ZZ 1c meeting', (now() at time zone 'Asia/Manila')::date, 'ZZPRIVATE original notes') ->> 'meeting_id')::uuid;
  v_base := jsonb_build_object('meeting_id', v_m, 'folder_id', current_setting('v1c.p'), 'team_id', current_setting('v1c.team'));
  v_d1 := v_base || jsonb_build_object('title', 'ZZ 1c wall prep', 'responsible_id', current_setting('v1c.w19'),
                                       'source_passage', 'ZZSOURCE', 'office_flags', jsonb_build_array('ZZFLAG'));
  v_t1 := (wp_office_save_task(null, v_d1) -> 'task' ->> 'id')::uuid;
  v_d2 := v_base || jsonb_build_object('title', 'ZZ 1c electrical', 'work_id', current_setting('v1c.aw'),
                                       'responsible_id', current_setting('v1c.w7'),
                                       'helper_ids', jsonb_build_array(current_setting('v1c.w19')),
                                       'depends_on', jsonb_build_array(v_t1),
                                       'planned_start', '2026-10-19', 'planned_end', '2026-10-21');
  v_t2 := (wp_office_save_task(null, v_d2) -> 'task' ->> 'id')::uuid;
  assert (select status from wp_tasks where id = v_t2) = 'draft' and (select version from wp_tasks where id = v_t2) = 0,
    'a new task is a draft at version 0';

  begin perform wp_office_save_task(v_t1, v_d1 || jsonb_build_object('depends_on', jsonb_build_array(v_t2))); raise exception 'no error';
  exception when others then assert sqlerrm = 'DEPENDENCY_CYCLE', 'wall → electrical → wall must be refused, got ' || sqlerrm; end;
  begin perform wp_office_save_task(null, v_d1 || jsonb_build_object('folder_id', current_setting('v1c.done'))); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'a completed project is refused, got ' || sqlerrm; end;
  begin perform wp_office_save_task(null, v_d1 || jsonb_build_object('folder_id', current_setting('v1c.oth_p'))); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'another company''s project is refused, got ' || sqlerrm; end;
  begin perform wp_office_save_task(null, v_d1 || jsonb_build_object('responsible_id', current_setting('v1c.staff'))); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_PERSON', 'a staff account cannot be the responsible person, got ' || sqlerrm; end;
  begin perform wp_office_save_task(null, v_d1 || jsonb_build_object('helper_ids', jsonb_build_array(current_setting('v1c.w19')))); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_PERSON', 'the responsible person cannot also be a helper, got ' || sqlerrm; end;

  v_t3 := (wp_office_save_task(null, v_base || jsonb_build_object('title', 'ZZ 1c no one yet')) -> 'task' ->> 'id')::uuid;
  begin perform wp_office_publish(null, array[v_t3], null, null, null); raise exception 'no error';
  exception when others then assert sqlerrm = 'NO_RESPONSIBLE', 'no responsible person, no publish; got ' || sqlerrm; end;
  perform wp_office_cancel(v_t3, 'ZZ duplicate');

  -- An individual task (no meeting, no team) that is already overdue, and one that waits for it.
  v_t4 := (wp_office_save_task(null, jsonb_build_object('folder_id', current_setting('v1c.p'), 'title', 'ZZ 1c individual',
            'responsible_id', current_setting('v1c.w7'), 'planned_end', '2026-10-01')) -> 'task' ->> 'id')::uuid;
  v_t5 := (wp_office_save_task(null, jsonb_build_object('folder_id', current_setting('v1c.p'), 'title', 'ZZ 1c after individual',
            'responsible_id', current_setting('v1c.w19'), 'depends_on', jsonb_build_array(v_t4))) -> 'task' ->> 'id')::uuid;
  begin perform wp_office_cancel(v_t4, 'ZZ test'); raise exception 'no error';
  exception when others then assert sqlerrm = 'HAS_DEPENDENTS', 'a task another waits for cannot be cancelled, got ' || sqlerrm; end;

  v_res := wp_office_publish(v_m, null, 'Shared: Monday start, wall first.', null, 'first version');
  assert (v_res ->> 'published_tasks')::int = 2 and (v_res ->> 'meeting_version')::int = 1,
    'publishing the meeting publishes its two drafts as version 1: ' || v_res::text;
  assert (select status from wp_tasks where id = v_t1) = 'not_started' and (select version from wp_tasks where id = v_t1) = 1,
    'published = Not started, version 1';
  assert (select array_agg(r.person_id order by r.person_id)
            from wp_note_recipients r join wp_meeting_versions v on v.id = r.version_id where v.meeting_id = v_m)
       = (select array_agg(x order by x) from unnest(array[current_setting('v1c.w7')::uuid, current_setting('v1c.w19')::uuid]) x),
    'default recipients = the people assigned in that meeting (not the leader)';
  perform wp_office_publish(null, array[v_t4], null, null, null);

  perform set_config('v1c.m', v_m::text, true);
  perform set_config('v1c.t1', v_t1::text, true);
  perform set_config('v1c.t2', v_t2::text, true);
  perform set_config('v1c.t3', v_t3::text, true);
  perform set_config('v1c.t4', v_t4::text, true);
end $$;

-- ── 2. W-0007: only their own tasks; electrical blocked by the wall; acknowledgement retry; notes ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_work jsonb; v_t2 jsonb; v_notes jsonb; v_r1 jsonb; v_r2 jsonb; v_op uuid := gen_random_uuid();
begin
  v_work := wp_my_work();
  assert not exists (select 1 from jsonb_array_elements(v_work) x where x ->> 'id' = current_setting('v1c.t1')),
    'W-0007 is not on the wall task, so it is not listed';
  select x into v_t2 from jsonb_array_elements(v_work) x where x ->> 'id' = current_setting('v1c.t2');
  assert v_t2 is not null and v_t2 ->> 'my_role' = 'responsible', 'W-0007 sees electrical as responsible';
  assert (v_t2 ->> 'blocked')::boolean and jsonb_array_length(v_t2 -> 'waiting_for') = 1, 'electrical waits for the wall';
  assert v_t2 ->> 'work_name' = 'ZZ 1c AW', 'the Additional Works name is shown';
  assert not (v_t2 ? 'source_passage') and not (v_t2 ? 'office_flags') and not (v_t2 ? 'acks') and not (v_t2 ? 'proposed_by'),
    'no office-only fields reach a worker';
  assert exists (select 1 from jsonb_array_elements(v_work) x where x ->> 'id' = current_setting('v1c.t4')), 'the individual task is listed';

  begin perform wp_start_work(gen_random_uuid(), current_setting('v1c.t2')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'TASK_BLOCKED', 'Start work is locked while blocked, got ' || sqlerrm; end;

  v_r1 := wp_acknowledge(v_op, current_setting('v1c.t2')::uuid, 1);
  v_r2 := wp_acknowledge(v_op, current_setting('v1c.t2')::uuid, 1);
  assert v_r1 = v_r2 and not (v_r1 ->> 'stale')::boolean, 'a retried acknowledgement returns the first answer';
  assert not exists (select 1 from jsonb_array_elements(v_r1 -> 'task' -> 'history') h where h ->> 'kind' in ('acknowledged', 'proposed')),
    'a worker never sees who acknowledged';

  v_notes := wp_my_notes();
  assert exists (select 1 from jsonb_array_elements(v_notes) x
                  where x ->> 'meeting_id' = current_setting('v1c.m') and x ->> 'shared_notes' like 'Shared:%'),
    'W-0007 reads the shared notes';
  assert position('ZZPRIVATE' in v_notes::text) = 0 and position('ZZSOURCE' in v_work::text) = 0
     and position('ZZFLAG' in v_work::text) = 0, 'original notes, AI source and office flags never reach a worker';

  begin perform wp_office_board(null); raise exception 'no error';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'a worker cannot open the office board, got ' || sqlerrm; end;
  begin perform wp_propose_task(gen_random_uuid(), current_setting('v1c.team')::uuid, current_setting('v1c.p')::uuid, null, 'ZZ idea', '');
    raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_LEADER', 'only a current team leader proposes, got ' || sqlerrm; end;
  begin perform wp_report_progress(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'x'); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_ASSIGNED', 'no action on a task you are not on, got ' || sqlerrm; end;
end $$;

-- ── 3. W-0019: reports a blocker (once, despite a retry); photo rules ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w19'), 'role', 'authenticated')::text, true);
do $$
declare
  v_op uuid := gen_random_uuid(); v_a jsonb; v_b jsonb;
begin
  begin perform wp_report_blocker(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'weather', 'ulan', null); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_KIND', 'an unknown blocker kind is refused, got ' || sqlerrm; end;
  v_a := wp_report_blocker(v_op, current_setting('v1c.t1')::uuid, 'materials', 'Walang semento', null);
  v_b := wp_report_blocker(v_op, current_setting('v1c.t1')::uuid, 'materials', 'Walang semento', null);
  assert v_a = v_b and jsonb_array_length(v_a -> 'task' -> 'blockers') = 1, 'a retried blocker report is recorded once';
  perform set_config('v1c.blocker', v_a ->> 'blocker_id', true);
  begin perform wp_start_work(gen_random_uuid(), current_setting('v1c.t1')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'TASK_BLOCKED', 'an open blocker locks Start work, got ' || sqlerrm; end;
  begin perform wp_attach_photo(gen_random_uuid(), current_setting('v1c.t1')::uuid, (v_a ->> 'blocker_id')::uuid, null,
                                current_setting('v1c.w7') || '/' || current_setting('v1c.t1') || '/x.jpg'); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_PATH', 'a photo path starts with the uploader and the task, got ' || sqlerrm; end;
  begin perform wp_attach_photo(gen_random_uuid(), current_setting('v1c.t1')::uuid, (v_a ->> 'blocker_id')::uuid, null,
                                current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/missing.jpg'); raise exception 'no error';
  exception when others then assert sqlerrm = 'PHOTO_NOT_UPLOADED', 'a photo must be uploaded first, got ' || sqlerrm; end;
end $$;

-- ── 4. Staff clears the blocker (note required) ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform wp_office_clear_blocker(current_setting('v1c.blocker')::uuid, ' '); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOTE_REQUIRED', 'clearing needs a note, got ' || sqlerrm; end;
  perform wp_office_clear_blocker(current_setting('v1c.blocker')::uuid, 'Semento delivered and checked at site');
  assert not (wp_office_task(current_setting('v1c.t1')::uuid) ->> 'blocked')::boolean, 'cleared → no longer blocked';
end $$;

-- The phone's upload, simulated as the database owner.
reset role;
insert into storage.objects (bucket_id, name, owner)
values ('task-photos', current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/ok.jpg', current_setting('v1c.w19')::uuid);
set local role authenticated;

-- ── 5. W-0019: attaches the photo, starts, reports done; cannot check own work ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w19'), 'role', 'authenticated')::text, true);
do $$
declare
  v_r jsonb;
begin
  v_r := wp_attach_photo(gen_random_uuid(), current_setting('v1c.t1')::uuid, current_setting('v1c.blocker')::uuid, null,
                         current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/ok.jpg');
  assert v_r ? 'photo_id', 'photo attached';
  begin perform wp_start_work(gen_random_uuid(), current_setting('v1c.t1')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_ACKNOWLEDGED', 'Start needs the current version read first, got ' || sqlerrm; end;
  perform wp_acknowledge(gen_random_uuid(), current_setting('v1c.t1')::uuid, 1);
  perform wp_start_work(gen_random_uuid(), current_setting('v1c.t1')::uuid);
  v_r := wp_report_done(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'Tapos na ang palitada');
  assert v_r -> 'task' ->> 'status' = 'reported_done', 'reported done';
  begin perform wp_leader_check(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'ok'); raise exception 'no error';
  exception when others then assert sqlerrm = 'OWN_WORK', 'nobody checks their own work, got ' || sqlerrm; end;
end $$;

-- ── 6. W-0021 (current team leader): sees team tasks, checks the wall, proposes ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w21'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t1 jsonb; v_r jsonb;
begin
  select x into v_t1 from jsonb_array_elements(wp_my_work()) x where x ->> 'id' = current_setting('v1c.t1');
  assert v_t1 ->> 'my_role' = 'leader' and (v_t1 ->> 'can_check')::boolean, 'the leader sees the wall task and may check it';
  assert jsonb_array_length(v_t1 -> 'photos') = 1, 'the leader sees the blocker photo';
  assert position('ZZSOURCE' in v_t1::text) = 0 and position('ZZFLAG' in v_t1::text) = 0
     and not (v_t1 ? 'source_passage') and not (v_t1 ? 'office_flags'),
    'the AI source and office flags never reach a worker who can see the task';
  assert wp_can_read_task_photo(current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/ok.jpg'), 'the leader may open it';
  begin perform wp_acknowledge(gen_random_uuid(), current_setting('v1c.t1')::uuid, 1); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_ASSIGNED', 'a leader who is not assigned does not acknowledge, got ' || sqlerrm; end;
  begin perform wp_start_work(gen_random_uuid(), current_setting('v1c.t2')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_RESPONSIBLE', 'the leader cannot start someone else''s task, got ' || sqlerrm; end;
  v_r := wp_leader_check(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'Checked, maayos');
  assert v_r -> 'task' ->> 'status' = 'leader_checked', 'leader check recorded';
  v_r := wp_propose_task(gen_random_uuid(), current_setting('v1c.team')::uuid, current_setting('v1c.p')::uuid, null,
                         'ZZ 1c proposal', 'Kailangan ng scaffolding');
  perform set_config('v1c.prop', v_r ->> 'task_id', true);
end $$;

-- W-0007 is not on the wall task: no photo.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w7'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not wp_can_read_task_photo(current_setting('v1c.w19') || '/' || current_setting('v1c.t1') || '/ok.jpg'),
    'someone not on the task cannot open its photo';
end $$;

-- ── 7. Staff: a proposal is a draft; send back needs a reason ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb;
begin
  v := wp_office_task(current_setting('v1c.prop')::uuid);
  assert v ->> 'status' = 'draft' and v ->> 'proposed_by' is not null, 'a leader proposal arrives as a draft for the office';
  begin perform wp_office_send_back(current_setting('v1c.t1')::uuid, ''); raise exception 'no error';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'send back needs a reason, got ' || sqlerrm; end;
  v := wp_office_send_back(current_setting('v1c.t1')::uuid, 'Kulang ang palitada sa gilid');
  assert v -> 'task' ->> 'status' = 'in_progress' and (v -> 'task' ->> 'sent_back')::boolean, 'sent back → In progress, marked Sent back';
  begin perform wp_office_approve(current_setting('v1c.t1')::uuid, null); raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_STATE', 'only reported work can be approved, got ' || sqlerrm; end;
end $$;

-- ── 8. W-0019 reports done again: Sent back clears ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w19'), 'role', 'authenticated')::text, true);
do $$
declare
  v_r jsonb;
begin
  v_r := wp_report_done(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'Inayos na');
  assert v_r -> 'task' ->> 'status' = 'reported_done' and not (v_r -> 'task' ->> 'sent_back')::boolean, 'reported again; Sent back cleared';
end $$;

-- ── 9. Staff: approve unblocks electrical; reopen blocks it again; important revision; notes v2 to W-0007 only ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb;
begin
  v := wp_office_approve(current_setting('v1c.t1')::uuid, 'Good');
  assert v -> 'task' ->> 'status' = 'completed', 'approved';
  assert not (wp_office_task(current_setting('v1c.t2')::uuid) ->> 'blocked')::boolean, 'electrical is ready once the wall is approved';
  begin perform wp_office_reopen(current_setting('v1c.t1')::uuid, ' '); raise exception 'no error';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'reopening needs a reason, got ' || sqlerrm; end;
  v := wp_office_reopen(current_setting('v1c.t1')::uuid, 'Crack found');
  assert v -> 'task' ->> 'status' = 'in_progress' and (v -> 'task' ->> 'sent_back')::boolean and v -> 'task' ->> 'completed_at' is null,
    'reopened → In progress, Sent back';
  assert (wp_office_task(current_setting('v1c.t2')::uuid) ->> 'blocked')::boolean, 'reopening the wall blocks electrical again';

  v := wp_office_task(current_setting('v1c.t2')::uuid);
  perform wp_office_save_task(current_setting('v1c.t2')::uuid, jsonb_build_object(
    'meeting_id', v ->> 'meeting_id', 'folder_id', v ->> 'folder_id', 'work_id', v ->> 'work_id', 'team_id', v ->> 'team_id',
    'title', v ->> 'title', 'responsible_id', v -> 'responsible' ->> 'id',
    'helper_ids', (select jsonb_agg(h -> 'id') from jsonb_array_elements(v -> 'helpers') h),
    'depends_on', v -> 'depends_on', 'planned_start', '2026-10-20', 'planned_end', '2026-10-22',
    'important', true, 'change_note', 'Start moved one day'));
  assert (wp_office_task(current_setting('v1c.t2')::uuid) ->> 'version')::int = 2, 'an important revision raises the version';

  perform wp_office_publish(current_setting('v1c.m')::uuid, null, 'Shared v2: electrical starts Tuesday.',
                            array[current_setting('v1c.w7')::uuid], 'only the electrical crew');
end $$;

-- ── 10. W-0019 reports the wall done again; left out of notes v2 ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w19'), 'role', 'authenticated')::text, true);
do $$
begin
  perform wp_report_done(gen_random_uuid(), current_setting('v1c.t1')::uuid, 'Inayos ang crack');
  assert not exists (select 1 from jsonb_array_elements(wp_my_notes()) x where x ->> 'meeting_id' = current_setting('v1c.m')),
    'W-0019 was not chosen for notes version 2';
end $$;

-- ── 11. Staff approves the wall again ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  perform wp_office_approve(current_setting('v1c.t1')::uuid, 'OK now');
  assert not (wp_office_task(current_setting('v1c.t2')::uuid) ->> 'blocked')::boolean, 'electrical ready again';
  assert exists (select 1 from jsonb_array_elements(wp_office_task(current_setting('v1c.t2')::uuid) -> 'acks') a
                  where a ->> 'person_id' = current_setting('v1c.w7') and not (a ->> 'acked')::boolean),
    'after the revision W-0007 has not acknowledged version 2 yet';
end $$;

-- ── 12. W-0007: stale acknowledgement, then version 2; start, progress, done; notes v2 ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_r jsonb;
begin
  v_r := wp_acknowledge(gen_random_uuid(), current_setting('v1c.t2')::uuid, 1);
  assert (v_r ->> 'stale')::boolean and (v_r -> 'task' ->> 'version')::int = 2, 'acknowledging version 1 is stale after the revision';
  v_r := wp_acknowledge(gen_random_uuid(), current_setting('v1c.t2')::uuid, 2);
  assert not (v_r ->> 'stale')::boolean and (v_r -> 'task' ->> 'my_ack_version')::int = 2, 'version 2 acknowledged';
  perform wp_start_work(gen_random_uuid(), current_setting('v1c.t2')::uuid);
  v_r := wp_report_progress(gen_random_uuid(), current_setting('v1c.t2')::uuid, 'Kalahati na');
  assert v_r ? 'event_id', 'progress recorded';
  v_r := wp_report_done(gen_random_uuid(), current_setting('v1c.t2')::uuid, 'Tapos');
  assert v_r -> 'task' ->> 'status' = 'reported_done', 'electrical reported done';
  assert exists (select 1 from jsonb_array_elements(wp_my_notes()) x
                  where x ->> 'meeting_id' = current_setting('v1c.m') and (x ->> 'version')::int = 2), 'W-0007 reads notes version 2';
end $$;

-- ── 13. Office lists: not acknowledged after 24h, overdue; declined proposal; meeting history ──
reset role;
update wp_tasks set version_at = now() - interval '25 hours' where id = current_setting('v1c.t4')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  b jsonb; x jsonb; m jsonb;
begin
  b := wp_office_board(current_setting('v1c.p')::uuid);
  select e into x from jsonb_array_elements(b) e where e ->> 'id' = current_setting('v1c.t4');
  assert (x ->> 'not_acknowledged_24h')::boolean and (x ->> 'overdue')::boolean,
    'the individual task shows Not acknowledged (24h) and Overdue';
  assert not exists (select 1 from jsonb_array_elements(b) e where e ->> 'id' = current_setting('v1c.t3')), 'cancelled tasks leave the board';
  perform wp_office_cancel(current_setting('v1c.prop')::uuid, 'Not this week');
  assert wp_office_task(current_setting('v1c.prop')::uuid) ->> 'status' = 'cancelled', 'a proposal can be declined';
  m := wp_office_meeting(current_setting('v1c.m')::uuid);
  assert (m ->> 'current_version')::int = 2 and jsonb_array_length(m -> 'versions') = 2, 'both note versions are kept';
  assert position('ZZPRIVATE' in m::text) > 0, 'the office keeps the original notes';
end $$;

-- ── 14. Permission fence (as the database owner) ──
reset role;
do $$
declare
  f text; t text;
begin
  foreach f in array array['wp_person_ok(uuid,uuid)', 'wp_work_valid(uuid,uuid,uuid)', 'wp_task_blocked(uuid)', 'wp_role_on(uuid,uuid)',
      'wp_can_check(uuid,uuid)', 'wp_depends_on(uuid,uuid)', 'wp_task_doc(uuid,uuid,boolean)', 'wp_op_prev(uuid,uuid)',
      'wp_op_save(uuid,uuid,text,jsonb)', 'wp_log(uuid,uuid,uuid,text,text,jsonb)', 'wp_worker_task(uuid)', 'wp_office_task_row(uuid)'] loop
    assert not has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ' must be internal';
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f || ' must not be callable by anon';
  end loop;
  foreach f in array array['wp_my_work()', 'wp_my_notes()', 'wp_acknowledge(uuid,uuid,integer)', 'wp_start_work(uuid,uuid)',
      'wp_report_progress(uuid,uuid,text)', 'wp_report_blocker(uuid,uuid,text,text,uuid)', 'wp_report_done(uuid,uuid,text)',
      'wp_leader_check(uuid,uuid,text)', 'wp_propose_task(uuid,uuid,uuid,uuid,text,text)', 'wp_attach_photo(uuid,uuid,uuid,bigint,text)',
      'wp_office_destinations()', 'wp_office_meetings()', 'wp_office_meeting(uuid)', 'wp_office_save_meeting(uuid,text,date,text)',
      'wp_office_save_task(uuid,jsonb)', 'wp_office_publish(uuid,uuid[],text,uuid[],text)', 'wp_office_board(uuid)', 'wp_office_task(uuid)',
      'wp_office_clear_blocker(uuid,text)', 'wp_office_approve(uuid,text)', 'wp_office_send_back(uuid,text)',
      'wp_office_reopen(uuid,text)', 'wp_office_cancel(uuid,text)',
      'wp_can_upload_task_path(text)', 'wp_can_read_task_photo(text)', 'wp_office_task_path_ok(text)'] loop
    assert has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ' must be callable when signed in';
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f || ' must not be callable by anon';
  end loop;
  foreach t in array array['wp_meetings', 'wp_meeting_versions', 'wp_note_recipients', 'wp_tasks', 'wp_task_people', 'wp_acks',
      'wp_blockers', 'wp_dependencies', 'wp_events', 'wp_ops', 'wp_photos'] loop
    assert not has_table_privilege('anon', 'public.' || t, 'select'), t || ': anon reads nothing';
    assert not has_table_privilege('authenticated', 'public.' || t, 'insert')
       and not has_table_privilege('authenticated', 'public.' || t, 'update')
       and not has_table_privilege('authenticated', 'public.' || t, 'delete'), t || ': no direct writes';
  end loop;
  assert (select public = false from storage.buckets where id = 'task-photos'), 'task-photos is private';
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name like 'wp\_%' and column_name ~* '(price|amount|cost|peso)'),
    'no wp_ table has a money column';
end $$;

select '1c acceptance: all checks passed' as result;

rollback;
