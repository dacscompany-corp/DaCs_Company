-- ════════════════════════════════════════════════════════════════════
-- Stage 1c-2 acceptance — migration 0094 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists. Builds its own
-- "ZZ 1c2" project and team. Editor-safe (set_config 'v1c2.*', no temp
-- objects). Accounts: W-0007 and W-0019 (active workers), W-0021 (active
-- teamLeader), an active staff account — one owner. Success ends with
-- the row '1c2 acceptance: all checks passed'.
--   A. a leader's own proposals          C. older dependencies are kept
--   B. automatic task versions           D. inactive office accounts refused
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_w7 uuid; v_w19 uuid; v_w21 uuid; v_owner uuid; v_staff uuid; v_p uuid; v_team uuid;
begin
  select id into v_w7  from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w19 from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w21 from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null and v_w19 is not null and v_w21 is not null,
    'W-0007, W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select coalesce(owner_id, id) from profiles where id = v_w19) = v_owner
     and (select coalesce(owner_id, id) from profiles where id = v_w21) = v_owner, 'one owner';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  assert v_staff is not null, 'need an active staff account';
  insert into folders (owner_id, name) values (v_owner, 'ZZ 1c2 project') returning id into v_p;
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1c2 team') returning id into v_team;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values
    (v_owner, v_team, v_w21, true), (v_owner, v_team, v_w7, false), (v_owner, v_team, v_w19, false);
  perform set_config('v1c2.w7', v_w7::text, true);
  perform set_config('v1c2.w19', v_w19::text, true);
  perform set_config('v1c2.w21', v_w21::text, true);
  perform set_config('v1c2.staff', v_staff::text, true);
  perform set_config('v1c2.p', v_p::text, true);
  perform set_config('v1c2.team', v_team::text, true);
end $$;

set local role authenticated;

-- ═══ A. A leader's own proposals ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w21'), 'role', 'authenticated')::text, true);
do $$
declare
  r jsonb;
begin
  r := wp_propose_task(gen_random_uuid(), current_setting('v1c2.team')::uuid, current_setting('v1c2.p')::uuid, null,
                       'ZZ 1c2 scaffolding', 'Kailangan ng scaffolding');
  perform set_config('v1c2.a', r ->> 'task_id', true);
  r := wp_propose_task(gen_random_uuid(), current_setting('v1c2.team')::uuid, current_setting('v1c2.p')::uuid, null,
                       'ZZ 1c2 extra outlets', '');
  perform set_config('v1c2.b', r ->> 'task_id', true);
  assert (select count(*) from jsonb_array_elements(wp_my_proposals()) x
           where x ->> 'id' in (current_setting('v1c2.a'), current_setting('v1c2.b')) and x ->> 'status' = 'sent') = 2,
    'A1 both proposals read Sent';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w7'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not exists (select 1 from jsonb_array_elements(wp_my_proposals()) x
                      where x ->> 'id' in (current_setting('v1c2.a'), current_setting('v1c2.b'))),
    'A2 a colleague never sees another person''s proposals';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  perform wp_office_save_task(current_setting('v1c2.a')::uuid, jsonb_build_object(
    'folder_id', current_setting('v1c2.p'), 'work_id', current_setting('v1c2.p'), 'team_id', current_setting('v1c2.team'),
    'title', 'ZZ 1c2 scaffolding', 'responsible_id', current_setting('v1c2.w7'), 'helper_ids', '[]'::jsonb, 'depends_on', '[]'::jsonb));
  perform wp_office_publish(null, array[current_setting('v1c2.a')::uuid], null, null, null);
  perform wp_office_cancel(current_setting('v1c2.b')::uuid, 'Not this week');
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w21'), 'role', 'authenticated')::text, true);
do $$
declare
  x jsonb; y jsonb;
begin
  select e into x from jsonb_array_elements(wp_my_proposals()) e where e ->> 'id' = current_setting('v1c2.a');
  select e into y from jsonb_array_elements(wp_my_proposals()) e where e ->> 'id' = current_setting('v1c2.b');
  assert x ->> 'status' = 'published' and x ->> 'decided_at' is not null, 'A3 published: ' || x::text;
  assert y ->> 'status' = 'declined' and y ->> 'reason' = 'Not this week' and y ->> 'decided_at' is not null, 'A4 declined + reason: ' || y::text;
  assert not (x ? 'source_passage') and not (x ? 'office_flags') and not (x ? 'instructions') and not (x ? 'acks'), 'A5 no office-only fields';
  assert x ->> 'work_name' = 'Main Contract' and x ->> 'project_name' = 'ZZ 1c2 project', 'A6 project and work named';
end $$;

-- ═══ B. Automatic task versions ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_base jsonb; v_t uuid;
begin
  v_base := jsonb_build_object('folder_id', current_setting('v1c2.p'), 'work_id', current_setting('v1c2.p'),
    'team_id', current_setting('v1c2.team'), 'title', 'ZZ 1c2 plaster', 'instructions', 'Plaster the wall',
    'responsible_id', current_setting('v1c2.w7'), 'helper_ids', '[]'::jsonb, 'depends_on', '[]'::jsonb,
    'planned_start', '2026-10-19', 'planned_end', '2026-10-21');
  v_t := (wp_office_save_task(null, v_base) -> 'task' ->> 'id')::uuid;
  perform wp_office_publish(null, array[v_t], null, null, null);
  assert (wp_office_task(v_t) ->> 'version')::int = 1, 'B0 published at version 1';
  perform set_config('v1c2.t', v_t::text, true);
  perform set_config('v1c2.base', v_base::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w7'), 'role', 'authenticated')::text, true);
do $$ begin perform wp_acknowledge(gen_random_uuid(), current_setting('v1c2.t')::uuid, 1); end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t uuid := current_setting('v1c2.t')::uuid;
  v_base jsonb := current_setting('v1c2.base')::jsonb;
  d jsonb; h jsonb;
begin
  -- B1 a spelling correction marked minor keeps the version and the reading
  v_base := v_base || '{"instructions": "Plaster the wall."}';
  d := wp_office_save_task(v_t, v_base || '{"minor_text_only": true}') -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 1, 'B1 minor text keeps version 1, got ' || (d ->> 'version');
  assert (select (a ->> 'acked')::boolean from jsonb_array_elements(wp_office_task(v_t) -> 'acks') a
           where a ->> 'person_id' = current_setting('v1c2.w7')), 'B1 W-0007''s reading still counts';
  assert h ->> 'kind' = 'edited' and h ->> 'note' like 'Minor spelling correction%', 'B1 history: ' || h::text;

  -- B2 the same kind of wording change NOT marked minor needs a new reading
  v_base := v_base || '{"instructions": "Plaster the wall, then smooth finish."}';
  d := wp_office_save_task(v_t, v_base) -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 2, 'B2 wording change raises the version, got ' || (d ->> 'version');
  assert not (select (a ->> 'acked')::boolean from jsonb_array_elements(wp_office_task(v_t) -> 'acks') a
               where a ->> 'person_id' = current_setting('v1c2.w7')), 'B2 the version-1 reading no longer counts';
  assert h ->> 'kind' = 'revised' and h ->> 'note' = 'Changed: instructions', 'B2 history: ' || h::text;
  perform set_config('v1c2.base', v_base::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t uuid := current_setting('v1c2.t')::uuid;
begin
  begin perform wp_start_work(gen_random_uuid(), v_t); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_ACKNOWLEDGED', 'B3 Start needs the new version read, got ' || sqlerrm; end;
  assert (wp_acknowledge(gen_random_uuid(), v_t, 1) ->> 'stale')::boolean, 'B3 re-sending the old version is stale';
  perform wp_acknowledge(gen_random_uuid(), v_t, 2);
  assert wp_start_work(gen_random_uuid(), v_t) -> 'task' ->> 'status' = 'in_progress', 'B3 starts after reading version 2';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t uuid := current_setting('v1c2.t')::uuid;
  v_base jsonb := current_setting('v1c2.base')::jsonb;
  d jsonb; h jsonb;
begin
  -- B4 a date change cannot hide behind "minor"
  v_base := v_base || '{"planned_end": "2026-10-23"}';
  d := wp_office_save_task(v_t, v_base || '{"minor_text_only": true, "change_note": "rain"}') -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 3 and h ->> 'note' = 'Changed: planned dates — rain', 'B4 dates: ' || h::text;

  -- B5 adding a helper cannot hide behind "minor"
  v_base := v_base || jsonb_build_object('helper_ids', jsonb_build_array(current_setting('v1c2.w19')));
  d := wp_office_save_task(v_t, v_base || '{"minor_text_only": true}') -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 4 and h ->> 'note' = 'Changed: people', 'B5 people: ' || h::text;

  -- B6 several changes at once are listed in a fixed order
  v_base := v_base || jsonb_build_object('title', 'ZZ 1c2 plaster and finish', 'planned_start', '2026-10-20',
                                         'responsible_id', current_setting('v1c2.w19'), 'helper_ids', jsonb_build_array(current_setting('v1c2.w7')));
  d := wp_office_save_task(v_t, v_base) -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 5 and h ->> 'note' = 'Changed: instructions, people, planned dates', 'B6 list: ' || h::text;

  -- B7 saving with nothing changed keeps the version
  d := wp_office_save_task(v_t, v_base) -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 5 and h ->> 'kind' = 'edited', 'B7 no change: ' || h::text;

  -- B8 the old explicit "important" still forces a new version
  d := wp_office_save_task(v_t, v_base || '{"important": true}') -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 6 and h ->> 'note' = 'Important change', 'B8 important: ' || h::text;
  perform set_config('v1c2.base', v_base::text, true);
end $$;

-- ═══ C. Older dependencies are kept ═══
do $$
declare
  v_d uuid;
begin
  v_d := (wp_office_save_task(null, jsonb_build_object('folder_id', current_setting('v1c2.p'), 'work_id', current_setting('v1c2.p'),
           'title', 'ZZ 1c2 older work', 'responsible_id', current_setting('v1c2.w7'),
           'helper_ids', '[]'::jsonb, 'depends_on', '[]'::jsonb)) -> 'task' ->> 'id')::uuid;
  perform wp_office_publish(null, array[v_d], null, null, null);
  perform set_config('v1c2.d', v_d::text, true);
end $$;

reset role;
update wp_tasks set status = 'completed', completed_at = now() - interval '40 days' where id = current_setting('v1c2.d')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);

do $$
declare
  v_t uuid := current_setting('v1c2.t')::uuid;
  v_d text := current_setting('v1c2.d');
  v_base jsonb := current_setting('v1c2.base')::jsonb;
  d jsonb;
begin
  assert not exists (select 1 from jsonb_array_elements(wp_office_board(current_setting('v1c2.p')::uuid)) x where x ->> 'id' = v_d),
    'C1 the Board leaves out tasks completed more than 30 days ago (so the form must fetch them)';
  v_base := v_base || jsonb_build_object('depends_on', jsonb_build_array(v_d));
  d := wp_office_save_task(v_t, v_base) -> 'task';
  assert d -> 'depends_on' ? v_d and (d ->> 'version')::int = 6, 'C2 a link to an older completed task saves, no new version';
  d := wp_office_save_task(v_t, v_base || '{"instructions": "Plaster the wall, then smooth finish!", "minor_text_only": true}') -> 'task';
  assert d -> 'depends_on' ? v_d, 'C3 an unrelated edit that sends the link keeps it';
  d := wp_office_save_task(v_t, v_base || '{"depends_on": []}') -> 'task';
  assert not (d -> 'depends_on' ? v_d), 'C4 the link goes only when the office removes it';
end $$;

-- ═══ D. Inactive office accounts are refused ═══
reset role;
update profiles set status = 'inactive' where id = current_setting('v1c2.staff')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform wp_office_board(null); raise exception 'no error';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'D1 an inactive staff account is not office, got ' || sqlerrm; end;
  begin perform wp_office_task(current_setting('v1c2.t')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'D2 got ' || sqlerrm; end;
end $$;

-- ═══ Permissions ═══
reset role;
do $$
begin
  assert has_function_privilege('authenticated', 'public.wp_my_proposals()', 'execute'), 'P1';
  assert not has_function_privilege('anon', 'public.wp_my_proposals()', 'execute'), 'P2';
  assert not has_function_privilege('anon', 'public.wp_office_save_task(uuid, jsonb)', 'execute'), 'P3';
end $$;

select '1c2 acceptance: all checks passed' as result;

rollback;
