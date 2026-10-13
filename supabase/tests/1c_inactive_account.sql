-- ════════════════════════════════════════════════════════════════════
-- Stage 1c-1 verification — inactive accounts (migration 0093).
-- Verification terms §3: docs/superpowers/specs/2026-10-12-workmate-stage1c1-verification-mvp-terms.md
--
-- Wraps itself in begin / rollback: NOTHING persists. W-0019 and W-0021 are
-- set to 'inactive' ONLY inside this transaction; the final rollback puts
-- them back exactly as they were. Builds its own "ZZ 1c inactive" project,
-- team and task and checks only those. Editor-safe: context lives in
-- transaction-local settings (set_config 'v1ci.*'), never a temp table.
--
-- Checks: an inactive worker / leader is refused every My Work read and
-- action and can no longer open task photos; an active colleague is
-- unaffected; the office still sees the unfinished task with its history,
-- cannot keep the inactive person on it, and can reassign it.
--
-- Photo access is checked two ways: the policy helper functions AND a read
-- of storage.objects as each person (the storage rule a download goes
-- through). An actual phone download, and photos already downloaded to an
-- offline phone, are NOT tested here (1c-3/1c-4): a deactivated phone keeps
-- what it already saved until the app clears it.
--
-- Time limits: each statement stops after 60 s, a lock wait after 5 s, and
-- an idle open transaction after 30 s, so the script can never sit holding
-- the account rows.
--
-- Accounts: W-0007, W-0019 (active workers), W-0021 (active teamLeader),
-- an active staff account — all of one owner. Success ends with the row
-- '1c inactive-account checks: all passed'.
--
-- AFTER EVERY RUN (pass or fail), confirm restoration separately:
--   select worker_no, status from profiles where worker_no in (7, 19, 21) and role in ('worker', 'teamLeader');
--     → all three 'active'
--   select (select count(*) from folders where name like 'ZZ 1c inactive%') as folders,
--          (select count(*) from pr_teams where name like 'ZZ 1c inactive%') as teams,
--          (select count(*) from wp_tasks where title like 'ZZ 1c inactive%') as tasks,
--          (select count(*) from storage.objects where bucket_id = 'task-photos') as task_photos;
--     → all 0
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';

-- ── 0. Throwaway project and team (as the database owner) ──
do $$
declare
  v_w7 uuid; v_w19 uuid; v_w21 uuid; v_owner uuid; v_staff uuid; v_p uuid; v_team uuid;
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
  assert v_staff is not null, 'need an active staff account of that owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 1c inactive project') returning id into v_p;
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1c inactive team') returning id into v_team;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values
    (v_owner, v_team, v_w21, true), (v_owner, v_team, v_w7, false), (v_owner, v_team, v_w19, false);

  perform set_config('v1ci.w7', v_w7::text, true);
  perform set_config('v1ci.w19', v_w19::text, true);
  perform set_config('v1ci.w21', v_w21::text, true);
  perform set_config('v1ci.staff', v_staff::text, true);
  perform set_config('v1ci.p', v_p::text, true);
  perform set_config('v1ci.team', v_team::text, true);
end $$;

-- ── 1. Staff publishes a task: W-0019 responsible, W-0007 helper ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t uuid;
begin
  v_t := (wp_office_save_task(null, jsonb_build_object('folder_id', current_setting('v1ci.p'), 'team_id', current_setting('v1ci.team'),
            'title', 'ZZ 1c inactive task', 'responsible_id', current_setting('v1ci.w19'),
            'helper_ids', jsonb_build_array(current_setting('v1ci.w7')))) -> 'task' ->> 'id')::uuid;
  perform wp_office_publish(null, array[v_t], null, null, null);
  perform set_config('v1ci.t', v_t::text, true);
  perform set_config('v1ci.path', current_setting('v1ci.w19') || '/' || v_t || '/ok.jpg', true);
end $$;

-- ── 2. W-0019, still active: acknowledges and reports a blocker ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.w19'), 'role', 'authenticated')::text, true);
do $$
declare
  r jsonb;
begin
  perform wp_acknowledge(gen_random_uuid(), current_setting('v1ci.t')::uuid, 1);
  r := wp_report_blocker(gen_random_uuid(), current_setting('v1ci.t')::uuid, 'materials', 'ZZ walang semento', null);
  perform set_config('v1ci.blocker', r ->> 'blocker_id', true);
end $$;

-- The phone's upload, simulated as the database owner.
reset role;
insert into storage.objects (bucket_id, name, owner)
values ('task-photos', current_setting('v1ci.path'), current_setting('v1ci.w19')::uuid);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.w19'), 'role', 'authenticated')::text, true);
do $$
begin
  perform wp_attach_photo(gen_random_uuid(), current_setting('v1ci.t')::uuid, current_setting('v1ci.blocker')::uuid, null,
                          current_setting('v1ci.path'));
  assert wp_can_read_task_photo(current_setting('v1ci.path')), 'while active, W-0019 opens their own photo (policy helper)';
  assert (select count(*) from storage.objects where bucket_id = 'task-photos' and name = current_setting('v1ci.path')) = 1,
    'while active, the storage rule lets W-0019 read their own photo';
end $$;

-- Before deactivation: the leader reads the team photo; helper W-0007 does
-- not (not the uploader, not responsible) — and reads the task as a helper.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.w21'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'task-photos' and name = current_setting('v1ci.path')) = 1,
    'while active, the storage rule lets the leader read the team photo';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_version int;
  r jsonb;
begin
  assert (select count(*) from storage.objects where bucket_id = 'task-photos' and name = current_setting('v1ci.path')) = 0,
    'a helper who neither uploaded nor is responsible cannot read the photo';
  select (x ->> 'version')::int into v_version from jsonb_array_elements(wp_my_work()) x where x ->> 'id' = current_setting('v1ci.t');
  r := wp_acknowledge(gen_random_uuid(), current_setting('v1ci.t')::uuid, v_version);
  assert not (r ->> 'stale')::boolean and (r -> 'task' ->> 'my_ack_version')::int = v_version, 'W-0007 reads the task as a helper';
  perform set_config('v1ci.helper_version', v_version::text, true);
end $$;

-- ── 3. Deactivate W-0019 and W-0021 — inside this transaction only ──
reset role;
update profiles set status = 'inactive' where id in (current_setting('v1ci.w19')::uuid, current_setting('v1ci.w21')::uuid);
set local role authenticated;

-- ── 4. Inactive W-0019: every My Work read and action is refused ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.w19'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t uuid := current_setting('v1ci.t')::uuid;
begin
  begin perform wp_my_work(); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive: My Work refused, got ' || sqlerrm; end;
  begin perform wp_my_notes(); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive: notes refused, got ' || sqlerrm; end;
  begin perform wp_acknowledge(gen_random_uuid(), v_t, 1); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive: acknowledge refused, got ' || sqlerrm; end;
  begin perform wp_start_work(gen_random_uuid(), v_t); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive: start refused, got ' || sqlerrm; end;
  begin perform wp_report_progress(gen_random_uuid(), v_t, 'x'); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive: progress refused, got ' || sqlerrm; end;
  begin perform wp_report_blocker(gen_random_uuid(), v_t, 'other', 'x', null); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive: blocker refused, got ' || sqlerrm; end;
  begin perform wp_report_done(gen_random_uuid(), v_t, 'x'); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive: done refused, got ' || sqlerrm; end;
  begin perform wp_attach_photo(gen_random_uuid(), v_t, null, null, current_setting('v1ci.path')); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive: attach refused, got ' || sqlerrm; end;
  assert not wp_can_read_task_photo(current_setting('v1ci.path')), 'inactive: their own photo no longer opens (policy helper)';
  assert (select count(*) from storage.objects where bucket_id = 'task-photos' and name = current_setting('v1ci.path')) = 0,
    'inactive: the storage rule refuses their own photo';
  assert not wp_can_upload_task_path(current_setting('v1ci.w19') || '/' || v_t || '/new.jpg'), 'inactive: no new uploads (policy helper)';
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('task-photos', current_setting('v1ci.w19') || '/' || v_t || '/new.jpg', auth.uid());
    raise exception 'no error';
  exception when insufficient_privilege then null;
            when others then assert false, 'inactive: the storage rule must refuse an upload, got ' || sqlerrm;
  end;
end $$;

-- ── 5. Inactive leader W-0021: no team view, no check, no proposal, no photo ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.w21'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform wp_my_work(); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive leader: My Work refused, got ' || sqlerrm; end;
  begin perform wp_leader_check(gen_random_uuid(), current_setting('v1ci.t')::uuid, 'ok'); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive leader: check refused, got ' || sqlerrm; end;
  begin perform wp_propose_task(gen_random_uuid(), current_setting('v1ci.team')::uuid, current_setting('v1ci.p')::uuid, null, 'ZZ idea', '');
    raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_A_REQUESTER', 'inactive leader: proposal refused, got ' || sqlerrm; end;
  assert not wp_can_read_task_photo(current_setting('v1ci.path')), 'inactive leader: the team photo no longer opens (policy helper)';
  assert (select count(*) from storage.objects where bucket_id = 'task-photos' and name = current_setting('v1ci.path')) = 0,
    'inactive leader: the storage rule refuses the team photo';
end $$;

-- ── 6. Active helper W-0007 is unaffected ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.w7'), 'role', 'authenticated')::text, true);
do $$
begin
  assert exists (select 1 from jsonb_array_elements(wp_my_work()) x
                  where x ->> 'id' = current_setting('v1ci.t') and x ->> 'my_role' = 'helper'),
    'an active colleague still sees the task as helper';
end $$;

-- ── 7. Office: the unfinished task stays visible with its history; reassign it ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb;
  v_base jsonb := jsonb_build_object('folder_id', current_setting('v1ci.p'), 'team_id', current_setting('v1ci.team'),
                                     'title', 'ZZ 1c inactive task');
begin
  v := wp_office_task(current_setting('v1ci.t')::uuid);
  assert v ->> 'status' = 'not_started' and v -> 'responsible' ->> 'id' = current_setting('v1ci.w19'),
    'the office still sees the task, unchanged, with the inactive responsible person';
  assert jsonb_array_length(v -> 'blockers') = 1, 'the blocker W-0019 reported is still there';
  assert exists (select 1 from jsonb_array_elements(v -> 'history') h where h ->> 'kind' = 'acknowledged'),
    'the office keeps the acknowledgement history';
  assert exists (select 1 from jsonb_array_elements(wp_office_board(current_setting('v1ci.p')::uuid)) e
                  where e ->> 'id' = current_setting('v1ci.t')), 'the task is on the office board';

  begin perform wp_office_save_task(current_setting('v1ci.t')::uuid, v_base || jsonb_build_object(
          'responsible_id', current_setting('v1ci.w19'), 'helper_ids', jsonb_build_array(current_setting('v1ci.w7'))));
    raise exception 'no error';
  exception when others then assert sqlerrm = 'BAD_PERSON', 'an inactive person cannot be kept on the task, got ' || sqlerrm; end;

  assert (select count(*) from storage.objects where bucket_id = 'task-photos' and name = current_setting('v1ci.path')) = 1,
    'the office still reads the photo through the storage rule';

  -- Reassign to W-0007 as an IMPORTANT revision: the version rises, so the
  -- acknowledgement W-0007 gave as a helper no longer counts.
  v := wp_office_save_task(current_setting('v1ci.t')::uuid, v_base || jsonb_build_object(
         'responsible_id', current_setting('v1ci.w7'), 'helper_ids', '[]'::jsonb,
         'important', true, 'change_note', 'ZZ reassigned: W-0019 inactive')) -> 'task';
  assert v -> 'responsible' ->> 'id' = current_setting('v1ci.w7') and jsonb_array_length(v -> 'helpers') = 0,
    'the office reassigns the task to W-0007';
  assert (v ->> 'version')::int > current_setting('v1ci.helper_version')::int, 'the reassignment raised the version';
  perform set_config('v1ci.new_version', v ->> 'version', true);
  perform wp_office_clear_blocker(current_setting('v1ci.blocker')::uuid, 'ZZ semento checked at site');
end $$;

-- ── 8. W-0007, now responsible: the helper-time read no longer counts ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1ci.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  r jsonb;
  v_old int := current_setting('v1ci.helper_version')::int;
  v_new int := current_setting('v1ci.new_version')::int;
begin
  r := (select x from jsonb_array_elements(wp_my_work()) x where x ->> 'id' = current_setting('v1ci.t'));
  assert r ->> 'my_role' = 'responsible' and (r ->> 'version')::int = v_new and (r ->> 'my_ack_version')::int = v_old,
    'W-0007 sees the new version and that they last read the old one';
  begin perform wp_start_work(gen_random_uuid(), current_setting('v1ci.t')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_ACKNOWLEDGED', 'an earlier read does not count after the revision, got ' || sqlerrm; end;
  r := wp_acknowledge(gen_random_uuid(), current_setting('v1ci.t')::uuid, v_old);
  assert (r ->> 'stale')::boolean, 'acknowledging the old version again is answered as stale';
  r := wp_acknowledge(gen_random_uuid(), current_setting('v1ci.t')::uuid, v_new);
  assert not (r ->> 'stale')::boolean, 'W-0007 reads the updated version';
  r := wp_start_work(gen_random_uuid(), current_setting('v1ci.t')::uuid);
  assert r -> 'task' ->> 'status' = 'in_progress', 'W-0007 starts the reassigned task';
  assert (select count(*) from storage.objects where bucket_id = 'task-photos' and name = current_setting('v1ci.path')) = 1,
    'as the new responsible person, W-0007 now reads the task photo through the storage rule';
end $$;

-- ── 9. History is kept (as the database owner) ──
reset role;
do $$
begin
  assert (select count(*) from wp_task_people
           where task_id = current_setting('v1ci.t')::uuid and person_id = current_setting('v1ci.w19')::uuid
             and role = 'responsible' and removed_at is not null) = 1,
    'W-0019 stays in the task history as a removed responsible person';
  assert (select status from profiles where id = current_setting('v1ci.w19')::uuid) = 'inactive',
    'W-0019 is inactive only inside this transaction — the rollback below restores it';
end $$;

select '1c inactive-account checks: all passed' as result;

rollback;
