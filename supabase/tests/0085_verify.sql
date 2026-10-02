-- ════════════════════════════════════════════════════════════════════
-- 0085 WorkMate Requests — live behaviour checks.
--
-- This file wraps itself in begin / rollback, so nothing persists. For a dry
-- run with the migration, run  begin;  <0085 migration>  <this file>  (its own
-- begin only warns; its rollback undoes everything, migration included).
-- Run immediately after apply only: some checks assume the three test
-- accounts have no real requests or teams yet.
--
-- Uses three existing active accounts under one owner: W-0007 (worker),
-- W-0019 (worker), W-0021 (teamLeader). Builds its own throwaway projects,
-- team and catalogue item. A failed check aborts with its message; success
-- ends with the row 'pr verify: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

-- ── 0. Accounts and a throwaway project tree (as the database owner) ──
do $$
declare
  v_worker uuid; v_other uuid; v_leader uuid; v_owner uuid;
  v_hid_ok uuid; v_hid_no uuid; v_p uuid; v_p2 uuid; v_aw uuid; v_done uuid; v_done_aw uuid; v_team uuid; v_item uuid; v_pm uuid;
begin
  select id into v_worker from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_other  from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_leader from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_worker is not null and v_other is not null and v_leader is not null,
    'accounts W-0007 and W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_worker);
  assert (select coalesce(owner_id, id) from profiles where id = v_other) = v_owner
     and (select coalesce(owner_id, id) from profiles where id = v_leader) = v_owner, 'the three accounts must share one owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 0085 verify project') returning id into v_p;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 0085 verify project two') returning id into v_p2;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 0085 verify AW', v_p) returning id into v_aw;
  insert into folders (owner_id, name, completed_at) values (v_owner, 'ZZ 0085 verify done project', now()) returning id into v_done;
  insert into folders (owner_id, name, parent_folder_id, completed_at) values (v_owner, 'ZZ 0085 verify done AW', v_p, now()) returning id into v_done_aw;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 0085 verify hidden allowed') returning id into v_hid_ok;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 0085 verify hidden only') returning id into v_hid_no;
  insert into pr_project_settings (folder_id, owner_id, allow_requests)
  values (v_p, v_owner, true), (v_p2, v_owner, true), (v_done, v_owner, true), (v_hid_ok, v_owner, true);
  insert into attendance_project_config (project_system, folder_id, owner_id, attendance_enabled)
  values ('pc', v_hid_ok, v_owner, false), ('pc', v_hid_no, v_owner, false);

  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 0085 verify team') returning id into v_team;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader)
  values (v_owner, v_team, v_leader, true), (v_owner, v_team, v_worker, false);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ PVC pipe', '1/2 in, 3 m', 'pc', 'plumbing') returning id into v_item;
  select id into v_pm from construction_projects limit 1;

  insert into t_ctx values ('worker', v_worker), ('other', v_other), ('leader', v_leader), ('owner', v_owner),
    ('p', v_p), ('p2', v_p2), ('aw', v_aw), ('done', v_done), ('done_aw', v_done_aw), ('team', v_team), ('item', v_item),
    ('pm', coalesce(v_pm, gen_random_uuid())::text),
    ('hid_ok', v_hid_ok), ('hid_no', v_hid_no);
end $$;

-- ── 1. The weekly cutoff and batch defaults ──
do $$
declare b record; v_batch uuid;
begin
  assert pr_cutoff_after('2026-10-03 11:59:59+08') = '2026-10-03 12:00:00+08', 'Sat 11:59:59 → that Saturday noon';
  assert pr_cutoff_after('2026-10-03 12:00:00+08') = '2026-10-10 12:00:00+08', 'Sat 12:00 exactly → next Saturday';
  assert pr_cutoff_after('2026-10-04 08:00:00+08') = '2026-10-10 12:00:00+08', 'Sunday → next Saturday';
  assert pr_cutoff_after('2026-10-02 23:30:00+08') = '2026-10-03 12:00:00+08', 'Friday night → tomorrow noon';
  assert pr_cutoff_after('2026-10-03 03:59:00+00') = '2026-10-03 12:00:00+08', 'a UTC instant is read as Manila time';
  -- Create first, then read: a row inserted by a function call inside a query's WHERE is invisible to that same query.
  v_batch := pr_batch_for((select v::uuid from t_ctx where k = 'owner'), '2030-01-05 09:00:00+08');
  select * into b from pr_batches where id = v_batch;
  assert b.cutoff_at = '2030-01-05 12:00:00+08' and b.purchase_on = '2030-01-07' and b.delivery_on = '2030-01-09',
    'batch defaults: Saturday noon cutoff, Monday purchase, Wednesday delivery';
end $$;

-- ── 2. As the worker W-0007 ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);

do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_p2 uuid := (select v::uuid from t_ctx where k = 'p2');
  v_aw uuid := (select v::uuid from t_ctx where k = 'aw');
  v_done uuid := (select v::uuid from t_ctx where k = 'done');
  v_done_aw uuid := (select v::uuid from t_ctx where k = 'done_aw');
  v_team uuid := (select v::uuid from t_ctx where k = 'team');
  v_leader uuid := (select v::uuid from t_ctx where k = 'leader');
  v_item uuid := (select v::uuid from t_ctx where k = 'item');
  v_pm uuid := (select v::uuid from t_ctx where k = 'pm');
  v_hid_ok uuid := (select v::uuid from t_ctx where k = 'hid_ok');
  v_hid_no uuid := (select v::uuid from t_ctx where k = 'hid_no');
  v_line jsonb;
  r jsonb; r2 jsonb; mine jsonb;
begin
  v_line := jsonb_build_object('kind', 'material', 'catalog_item_id', v_item, 'description', 'ZZ PVC pipe',
                               'spec', '1/2 in, 3 m', 'unit', 'pc', 'category', 'plumbing', 'quantity', 10);

  assert exists (select 1 from pr_destinations() d where d.project_id = v_p and d.work_id = v_p and d.is_main and d.work_name = 'Main Contract'), 'Main Contract offered';
  assert exists (select 1 from pr_destinations() d where d.project_id = v_p and d.work_id = v_aw and not d.is_main), 'open Additional Works offered';
  assert not exists (select 1 from pr_destinations() d where d.project_id = v_done or d.work_id = v_done_aw), 'completed work never offered';
  assert exists (select 1 from pr_destinations() d where d.project_id = v_hid_ok), 'a hidden site with Allow requests is offered';
  assert not exists (select 1 from pr_destinations() d where d.project_id = v_hid_no), 'a hidden site without Allow requests is not offered';
  assert exists (select 1 from pr_my_teams() t where t.team_id = v_team and not t.i_lead and jsonb_array_length(t.members) = 2), 'worker sees their team (2 members), not as leader';
  assert exists (select 1 from pr_catalog() c where c.id = v_item), 'catalogue visible';

  r := pr_submit_request('00000000-0000-4000-8000-000000000001', jsonb_build_object('folder_id', v_p, 'work_id', v_p, 'lines', jsonb_build_array(v_line)));
  assert r ? 'request_id' and jsonb_array_length(r -> 'line_ids') = 1, 'submit returns the request and its line ids';
  r2 := pr_submit_request('00000000-0000-4000-8000-000000000001', jsonb_build_object('folder_id', v_p, 'work_id', v_p, 'lines', jsonb_build_array(v_line, v_line)));
  assert r2 = r, 'a retried operation returns the first answer and writes nothing';
  mine := pr_my_requests(50);
  assert jsonb_array_length(mine) = 1, 'exactly one request after the retry';
  assert (mine -> 0 -> 'lines' -> 0 ->> 'needed')::numeric = 10, 'needed = 10';
  assert mine -> 0 ->> 'work_name' = 'Main Contract', 'Main Contract label';
  assert (mine -> 0 ->> 'mine')::boolean, 'marked as mine';
  insert into t_ctx values ('req1', r ->> 'request_id'), ('line1', r -> 'line_ids' ->> 0);

  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_aw, 'lines', jsonb_build_array(v_line)));
  assert r ? 'request_id', 'a request for open Additional Works is accepted';

  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_done, 'lines', jsonb_build_array(v_line)));
    assert false, 'completed project accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'completed project: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_done_aw, 'lines', jsonb_build_array(v_line)));
    assert false, 'completed Additional Works accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'completed AW: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p2, 'work_id', v_aw, 'lines', jsonb_build_array(v_line)));
    assert false, 'Additional Works under the wrong project accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'wrong parent: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_pm, 'lines', jsonb_build_array(v_line)));
    assert false, 'a PM project id accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'PM id: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'lines', '[]'::jsonb));
    assert false, 'no lines accepted';
  exception when others then assert sqlerrm = 'NO_LINES', 'no lines: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'lines', jsonb_build_array(v_line || '{"quantity": 0}'::jsonb)));
    assert false, 'zero quantity accepted';
  exception when others then assert sqlerrm = 'BAD_QUANTITY', 'zero: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'lines', jsonb_build_array(v_line || '{"urgent": true}'::jsonb)));
    assert false, 'urgent without a reason accepted';
  exception when others then assert sqlerrm = 'URGENT_NEEDS_REASON', 'urgent: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_team,
          'lines', jsonb_build_array(v_line || jsonb_build_object('intended_member_id', v_leader))));
    assert false, 'a plain member named another member';
  exception when others then assert sqlerrm = 'NOT_TEAM_LEADER', 'member for another: ' || sqlerrm; end;

  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_team,
         'lines', jsonb_build_array(v_line || jsonb_build_object('urgent', true, 'urgent_reason', 'slab pour Friday', 'needed_by', '2026-10-09'))));
  assert r ? 'request_id', 'a member submits a team request for themselves';
  insert into t_ctx values ('team_req', r ->> 'request_id');

  assert (select count(*) from pr_requests) = 0 and (select count(*) from pr_lines) = 0
     and (select count(*) from pr_teams) = 0 and (select count(*) from pr_ops) = 0,
    'workers read pr_* tables only through RPCs';
end $$;

-- quantities, conflicts (still W-0007)
do $$
declare
  v_line uuid := (select v::uuid from t_ctx where k = 'line1');
  r jsonb; req jsonb; l jsonb;
begin
  r := pr_change_quantity('00000000-0000-4000-8000-000000000002', v_line, 1, 12);
  assert r ->> 'status' = 'applied' and (r ->> 'version')::int = 2 and (r ->> 'needed')::numeric = 12, '10 → 12 applied at version 2';
  assert pr_change_quantity('00000000-0000-4000-8000-000000000002', v_line, 1, 12) = r, 'a retried change returns the first answer';
  r := pr_change_quantity(gen_random_uuid(), v_line, 1, 8);
  assert r ->> 'status' = 'conflict' and (r ->> 'needed')::numeric = 12, 'an edit against an outdated version is a conflict, not an overwrite';
  select e into req from jsonb_array_elements(pr_my_requests(50)) e where e ->> 'id' = (select v from t_ctx where k = 'req1');
  l := req -> 'lines' -> 0;
  assert (l ->> 'needed')::numeric = 12 and (l ->> 'has_conflict')::boolean and jsonb_array_length(l -> 'portions') = 1,
    'still 12 in one portion, flagged as a conflict';
end $$;

-- ── 3. The spec §4B example: 10 arranged this week + 2 unarranged next week, reduced to 9 ──
reset role;
do $$
declare
  v_line uuid := (select v::uuid from t_ctx where k = 'line1');
  v_owner uuid := (select v::uuid from t_ctx where k = 'owner');
begin
  update pr_line_portions set quantity = 10, arranged_at = now() where line_id = v_line;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity, created_at)
  values (v_owner, v_line, pr_batch_for(v_owner, now() + interval '7 days'), 2, now() + interval '1 second');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);
do $$
declare
  v_line uuid := (select v::uuid from t_ctx where k = 'line1');
  r jsonb; l jsonb;
begin
  r := pr_change_quantity(gen_random_uuid(), v_line, 2, 9);
  assert r ->> 'status' = 'applied' and (r ->> 'needed')::numeric = 9, '12 → 9 applied';
  select e -> 'lines' -> 0 into l from jsonb_array_elements(pr_my_requests(50)) e where e ->> 'id' = (select v from t_ctx where k = 'req1');
  assert jsonb_array_length(l -> 'portions') = 1, 'the later unarranged 2 are removed first';
  assert (l -> 'portions' -> 0 ->> 'quantity')::numeric = 10 and (l -> 'portions' -> 0 ->> 'pending_reduction')::numeric = 1
     and (l -> 'portions' -> 0 ->> 'arranged')::boolean, 'the arranged 10 stay, with 1 flagged for the office';

  r := pr_change_quantity(gen_random_uuid(), v_line, 3, 10);
  select e -> 'lines' -> 0 into l from jsonb_array_elements(pr_my_requests(50)) e where e ->> 'id' = (select v from t_ctx where k = 'req1');
  assert jsonb_array_length(l -> 'portions') = 1 and (l -> 'portions' -> 0 ->> 'pending_reduction')::numeric = 0,
    '9 → 10 takes back the flagged 1 instead of buying one more';

  r := pr_cancel_line(gen_random_uuid(), v_line);
  assert r ->> 'status' = 'cancelled', 'line cancelled';
  select e -> 'lines' -> 0 into l from jsonb_array_elements(pr_my_requests(50)) e where e ->> 'id' = (select v from t_ctx where k = 'req1');
  assert l ->> 'status' = 'cancelled' and (l ->> 'needed')::numeric = 0
     and (l -> 'portions' -> 0 ->> 'pending_reduction')::numeric = 10, 'cancel flags the arranged 10, erases nothing';
  begin perform pr_change_quantity(gen_random_uuid(), v_line, 5, 3);
    assert false, 'a cancelled line accepted a change';
  exception when others then assert sqlerrm = 'LINE_CLOSED', 'cancelled line: ' || sqlerrm; end;
end $$;

-- ── 4. Photos (object inserted by the database owner, standing in for the app's upload) ──
reset role;
insert into storage.objects (bucket_id, name, owner)
select 'request-photos', (select v from t_ctx where k = 'worker') || '/' || (select v from t_ctx where k = 'req1') || '/p1.jpg',
       (select v::uuid from t_ctx where k = 'worker');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);
do $$
declare
  v_req uuid := (select v::uuid from t_ctx where k = 'req1');
  v_path text := (select v from t_ctx where k = 'worker') || '/' || (select v from t_ctx where k = 'req1') || '/p1.jpg';
  r jsonb;
begin
  r := pr_attach_photo(gen_random_uuid(), v_req, null, v_path);
  assert r ? 'photo_id', 'photo attached';
  assert (select count(*) from storage.objects where bucket_id = 'request-photos') = 1, 'the requester sees their photo';
  begin perform pr_attach_photo(gen_random_uuid(), v_req, null, 'someone-else/' || v_req || '/p2.jpg');
    assert false, 'a foreign path accepted';
  exception when others then assert sqlerrm = 'BAD_PATH', 'foreign path: ' || sqlerrm; end;
  begin perform pr_attach_photo(gen_random_uuid(), v_req, null, (select v from t_ctx where k = 'worker') || '/' || v_req || '/missing.jpg');
    assert false, 'a photo that was never uploaded accepted';
  exception when others then assert sqlerrm = 'PHOTO_NOT_UPLOADED', 'missing photo: ' || sqlerrm; end;
end $$;

-- ── 5. As the team leader W-0021 ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'leader'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_team uuid := (select v::uuid from t_ctx where k = 'team');
  v_worker uuid := (select v::uuid from t_ctx where k = 'worker');
  ids text[];
  r jsonb;
begin
  assert exists (select 1 from pr_my_teams() t where t.team_id = v_team and t.i_lead), 'the leader leads the team';
  select array_agg(e ->> 'id') into ids from jsonb_array_elements(pr_my_requests(50)) e;
  assert (select v from t_ctx where k = 'team_req') = any (ids), 'the leader sees the member''s team request';
  assert not ((select v from t_ctx where k = 'req1') = any (ids)), 'the leader does not see the member''s individual request';
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_team,
         'lines', jsonb_build_array(jsonb_build_object('kind', 'material', 'description', 'Outlet, 2-gang', 'unit', 'pc',
                                                       'quantity', 6, 'intended_member_id', v_worker))));
  assert r ? 'request_id', 'the leader submits for a member';
  begin perform pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'line1'), 6, 1);
    assert false, 'the leader changed a member''s line';
  exception when others then assert sqlerrm = 'NOT_YOUR_LINE', 'leader edit: ' || sqlerrm; end;
  assert (select count(*) from storage.objects where bucket_id = 'request-photos') = 0, 'an individual request''s photo is not the leader''s to see';
end $$;

-- ── 6. As the other worker W-0019 (in no team) ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'other'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_team uuid := (select v::uuid from t_ctx where k = 'team');
  n int;
begin
  assert jsonb_array_length(pr_my_requests(50)) = 0, 'no access to colleagues'' requests';
  assert not exists (select 1 from pr_my_teams()), 'in no team';
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_team,
          'lines', jsonb_build_array(jsonb_build_object('kind', 'tool', 'description', 'Drill', 'unit', 'pc', 'quantity', 1))));
    assert false, 'used a team they are not in';
  exception when others then assert sqlerrm = 'NOT_IN_TEAM', 'foreign team: ' || sqlerrm; end;
  begin perform pr_cancel_request(gen_random_uuid(), (select v::uuid from t_ctx where k = 'req1'));
    assert false, 'cancelled a colleague''s request';
  exception when others then assert sqlerrm = 'NOT_YOUR_REQUEST', 'foreign cancel: ' || sqlerrm; end;
  assert (select count(*) from storage.objects where bucket_id = 'request-photos') = 0, 'a colleague''s photo is invisible';

  -- legacy tables: own rows only, no writes
  assert (select count(*) from requests where requested_by is distinct from auth.uid()) = 0, 'legacy requests: own rows only';
  with d as (delete from request_items returning 1) select count(*) into n from d;
  assert n = 0, 'legacy request_items: a worker deletes nothing';
  begin
    insert into requests (requested_by, status) values (auth.uid(), 'pending');
    assert false, 'legacy requests: a worker inserted a row';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── 7. The office's view (as the database owner) ──
reset role;
do $$
begin
  assert (select count(*) from pr_line_conflicts where line_id = (select v::uuid from t_ctx where k = 'line1')) = 1, 'the conflict is kept for the office';
  assert (select count(*) from pr_events where request_id = (select v::uuid from t_ctx where k = 'req1')) >= 6, 'history recorded';
  assert (select count(*) from pr_requests where client_op_id = '00000000-0000-4000-8000-000000000001') = 1, 'one request for the retried op';
end $$;

select 'pr verify: all checks passed' as result;

rollback;
