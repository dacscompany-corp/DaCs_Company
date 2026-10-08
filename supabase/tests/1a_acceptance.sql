-- ════════════════════════════════════════════════════════════════════
-- Stage 1a acceptance — the spec §9 rows that Stage 1a delivers.
--
-- Wraps itself in begin / rollback: nothing persists. Safe to run at any
-- time: it builds its own throwaway projects, teams and catalogue items and
-- only counts what it created, so real pilot requests do not disturb it.
-- Needs 0085–0088 live. Dry run with 0088:  begin;  <0088>  <this file>
-- (its own begin only warns; its rollback undoes the migration too).
--
-- Accounts: W-0007 and W-0019 (workers), W-0021 (teamLeader), their owner.
-- A failed check aborts with its message; success ends with the row
-- '1a acceptance: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

-- ── 0. Accounts and throwaway projects, teams, items (as the database owner) ──
do $$
declare
  v_w7 uuid; v_w19 uuid; v_w21 uuid; v_owner uuid;
  v_p uuid; v_aw uuid; v_done_aw uuid; v_done_parent uuid; v_open_child uuid; v_hid_ok uuid; v_hid_no uuid; v_pm uuid;
  v_ta uuid; v_tb uuid; v_tc uuid; v_item uuid; v_elbow uuid;
begin
  select id into v_w7  from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w19 from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w21 from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null and v_w19 is not null and v_w21 is not null,
    'W-0007 and W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select role from profiles where id = v_owner) = 'owner', 'W-0007''s owner must be an owner account';
  assert (select coalesce(owner_id, id) from profiles where id = v_w19) = v_owner
     and (select coalesce(owner_id, id) from profiles where id = v_w21) = v_owner, 'the three accounts must share one owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 1a acceptance project') returning id into v_p;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 1a acceptance AW', v_p) returning id into v_aw;
  insert into folders (owner_id, name, parent_folder_id, completed_at) values (v_owner, 'ZZ 1a acceptance done AW', v_p, now()) returning id into v_done_aw;
  insert into folders (owner_id, name, completed_at) values (v_owner, 'ZZ 1a acceptance done project', now()) returning id into v_done_parent;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 1a acceptance open child of done', v_done_parent) returning id into v_open_child;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 1a acceptance hidden + allowed') returning id into v_hid_ok;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 1a acceptance hidden only') returning id into v_hid_no;
  insert into pr_project_settings (folder_id, owner_id, allow_requests)
  values (v_p, v_owner, true), (v_done_parent, v_owner, true), (v_hid_ok, v_owner, true);
  insert into attendance_project_config (project_system, folder_id, owner_id, attendance_enabled)
  values ('pc', v_hid_ok, v_owner, false), ('pc', v_hid_no, v_owner, false);

  -- Team A: W-0021 leads, W-0007 member. Team B: W-0021 and W-0019 plain members. Team C: W-0019 only.
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1a team A') returning id into v_ta;
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1a team B') returning id into v_tb;
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1a team C') returning id into v_tc;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values
    (v_owner, v_ta, v_w21, true), (v_owner, v_ta, v_w7, false),
    (v_owner, v_tb, v_w21, false), (v_owner, v_tb, v_w19, false),
    (v_owner, v_tc, v_w19, false);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1a outlet', '2-gang', 'pc', 'electrical') returning id into v_item;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1a elbow', '1/2 in', 'pc', 'plumbing') returning id into v_elbow;
  select id into v_pm from construction_projects limit 1;

  insert into t_ctx values ('w7', v_w7), ('w19', v_w19), ('w21', v_w21), ('owner', v_owner),
    ('p', v_p), ('aw', v_aw), ('done_aw', v_done_aw), ('done_parent', v_done_parent), ('open_child', v_open_child),
    ('hid_ok', v_hid_ok), ('hid_no', v_hid_no), ('pm', coalesce(v_pm, gen_random_uuid())::text),
    ('ta', v_ta), ('tb', v_tb), ('tc', v_tc), ('item', v_item), ('elbow', v_elbow);
end $$;

-- ── 1. The weekly cutoff: Saturday 12:00 noon, Manila time (§9 weekly cycle, after-cutoff → next batch) ──
do $$
begin
  assert pr_cutoff_after('2026-10-03 11:59:59+08') = '2026-10-03 12:00:00+08', 'Saturday 11:59:59 → that Saturday''s batch';
  assert pr_cutoff_after('2026-10-03 12:00:00+08') = '2026-10-10 12:00:00+08', 'received at Saturday noon exactly → next week''s batch';
  assert pr_cutoff_after('2026-10-03 03:59:00+00') = '2026-10-03 12:00:00+08', 'a UTC instant is read in Manila time';
end $$;

-- ── 2. W-0007 (worker): destinations, completed work, PM ids, retries ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_aw uuid := (select v::uuid from t_ctx where k = 'aw');
  v_done_aw uuid := (select v::uuid from t_ctx where k = 'done_aw');
  v_done_parent uuid := (select v::uuid from t_ctx where k = 'done_parent');
  v_open_child uuid := (select v::uuid from t_ctx where k = 'open_child');
  v_hid_ok uuid := (select v::uuid from t_ctx where k = 'hid_ok');
  v_hid_no uuid := (select v::uuid from t_ctx where k = 'hid_no');
  v_pm uuid := (select v::uuid from t_ctx where k = 'pm');
  v_ta uuid := (select v::uuid from t_ctx where k = 'ta');
  v_item uuid := (select v::uuid from t_ctx where k = 'item');
  line jsonb;
  r jsonb; r2 jsonb;
begin
  line := jsonb_build_object('kind', 'material', 'catalog_item_id', v_item, 'description', 'ZZ 1a outlet',
                             'spec', '2-gang', 'unit', 'pc', 'category', 'electrical', 'quantity', 10);

  assert exists (select 1 from pr_destinations() d where d.project_id = v_p and d.work_id = v_p and d.is_main), 'Main Contract offered';
  assert exists (select 1 from pr_destinations() d where d.project_id = v_p and d.work_id = v_aw and not d.is_main), 'open Additional Works offered';
  assert not exists (select 1 from pr_destinations() d where d.work_id = v_done_aw), 'completed Additional Works not offered';
  assert not exists (select 1 from pr_destinations() d where d.project_id = v_done_parent or d.work_id = v_open_child),
    'a completed parent and its open child are not offered';
  assert exists (select 1 from pr_destinations() d where d.project_id = v_hid_ok), 'hidden from Attendance but Allow requests on → offered';
  assert not exists (select 1 from pr_destinations() d where d.project_id = v_hid_no), 'hidden from Attendance, no Allow requests → not offered';

  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_done_aw, 'lines', jsonb_build_array(line)));
    assert false, 'a completed Additional Works job accepted a request under an open parent';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'completed AW: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_done_parent, 'work_id', v_open_child, 'lines', jsonb_build_array(line)));
    assert false, 'an open child rescued a completed parent';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'open child of a completed parent: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_pm, 'lines', jsonb_build_array(line)));
    assert false, 'a PM project id accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'PM id: ' || sqlerrm; end;

  -- Team A request (W-0007 is a plain member): a catalogue line + an unlisted line.
  r := pr_submit_request('00000000-0000-4000-8000-00000001a401', jsonb_build_object('folder_id', v_p, 'work_id', v_p, 'team_id', v_ta,
         'lines', jsonb_build_array(line,
           jsonb_build_object('kind', 'material', 'description', 'ZZ 1a unlisted elbow', 'spec', 'half inch', 'unit', 'pc', 'quantity', 3))));
  r2 := pr_submit_request('00000000-0000-4000-8000-00000001a401', jsonb_build_object('folder_id', v_p, 'lines', jsonb_build_array(line)));
  assert r2 = r, 'a retried request returns the first answer (same request, same batch) and writes nothing';
  assert (select count(*) from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = r ->> 'request_id') = 1, 'one request for the retried op';
  insert into t_ctx values ('reqA', r ->> 'request_id'), ('lineOutlet', r -> 'line_ids' ->> 0), ('lineElbow', r -> 'line_ids' ->> 1);

  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_aw, 'lines', jsonb_build_array(line)));
  assert (select e ->> 'work_name' from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = r ->> 'request_id') = 'ZZ 1a acceptance AW',
    'the request names its Additional Works job';
  insert into t_ctx values ('reqAW', r ->> 'request_id'), ('lineAW', r -> 'line_ids' ->> 0);

  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'lines', jsonb_build_array(line)));
  insert into t_ctx values ('reqSolo', r ->> 'request_id'), ('lineSolo', r -> 'line_ids' ->> 0);

  assert pr_my_requests(200)::text !~* '"[a-z_]*(price|amount|cost|peso)[a-z_]*"\s*:', 'W-0007: no money keys';
end $$;

-- ── 3. W-0019 (worker, in teams B and C, leads none) ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w19'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_tb uuid := (select v::uuid from t_ctx where k = 'tb');
  r jsonb; ids text[]; n int;
begin
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_tb,
         'lines', jsonb_build_array(jsonb_build_object('kind', 'material', 'description', 'ZZ 1a sand', 'unit', 'bag', 'quantity', 5))));
  insert into t_ctx values ('reqB', r ->> 'request_id');

  select array_agg(e ->> 'id') into ids from jsonb_array_elements(pr_my_requests(200)) e;
  assert not ((select v from t_ctx where k = 'reqA') = any (ids)) and not ((select v from t_ctx where k = 'reqSolo') = any (ids)),
    'W-0019 does not see W-0007''s requests';
  assert not exists (select 1 from jsonb_array_elements(pr_my_requests(200)) e where not (e ->> 'mine')::boolean),
    'a worker who leads no team sees only their own requests';
  begin perform pr_cancel_request(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqA'));
    assert false, 'cancelled a colleague''s request';
  exception when others then assert sqlerrm = 'NOT_YOUR_REQUEST', 'foreign cancel: ' || sqlerrm; end;
  begin perform pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineOutlet'), 1, 1);
    assert false, 'changed a colleague''s line';
  exception when others then assert sqlerrm = 'NOT_YOUR_LINE', 'foreign edit: ' || sqlerrm; end;
  assert pr_my_requests(200)::text !~* '"[a-z_]*(price|amount|cost|peso)[a-z_]*"\s*:', 'W-0019: no money keys';

  -- Legacy request tables (spec §9: no browsing colleagues' requests): own rows only, no writes.
  assert (select count(*) from requests where requested_by is distinct from auth.uid()) = 0, 'legacy requests: own rows only';
  with d as (delete from request_items returning 1) select count(*) into n from d;
  assert n = 0, 'legacy request_items: a worker deletes nothing';
  begin
    insert into requests (requested_by, status) values (auth.uid(), 'pending');
    assert false, 'legacy requests: a worker inserted a row';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── 4. W-0021 (teamLeader: leads A, plain member of B, not in C) ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w21'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_ta uuid := (select v::uuid from t_ctx where k = 'ta');
  v_tb uuid := (select v::uuid from t_ctx where k = 'tb');
  v_tc uuid := (select v::uuid from t_ctx where k = 'tc');
  v_w7 uuid := (select v::uuid from t_ctx where k = 'w7');
  v_w19 uuid := (select v::uuid from t_ctx where k = 'w19');
  v_item uuid := (select v::uuid from t_ctx where k = 'item');
  r jsonb; req jsonb; ids text[];
begin
  -- One request: electrical, plumbing (urgent) and a tool (§9).
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_ta, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'catalog_item_id', v_item, 'description', 'ZZ 1a outlet', 'spec', '2-gang', 'unit', 'pc',
                            'category', 'electrical', 'quantity', 10, 'intended_member_id', v_w7),
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1a PVC pipe', 'spec', '1/2 in, 3 m', 'unit', 'pc', 'category', 'plumbing',
                            'quantity', 6, 'urgent', true, 'urgent_reason', 'leak at the kitchen', 'needed_by', '2026-10-09'),
         jsonb_build_object('kind', 'tool', 'description', 'ZZ 1a drill', 'unit', 'pc', 'category', 'electrical', 'quantity', 1,
                            'intended_member_id', v_w7))));
  select e into req from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = r ->> 'request_id';
  assert jsonb_array_length(req -> 'lines') = 3, 'one request, three lines';
  assert (select array_agg(l ->> 'category' order by (l ->> 'position')::int) from jsonb_array_elements(req -> 'lines') l)
         = array['electrical', 'plumbing', 'electrical'], 'each line keeps its trade';
  assert (select array_agg((l ->> 'urgent')::boolean order by (l ->> 'position')::int) from jsonb_array_elements(req -> 'lines') l)
         = array[false, true, false], 'one urgent line does not make the whole request urgent';
  assert req -> 'lines' -> 0 ->> 'intended_member_id' = v_w7::text, 'the leader names a member on a material line';
  assert req -> 'lines' -> 2 ->> 'intended_member_id' is null, 'a tool line names nobody at request time';

  select array_agg(e ->> 'id') into ids from jsonb_array_elements(pr_my_requests(200)) e;
  assert (select v from t_ctx where k = 'reqA') = any (ids), 'the leader sees a member''s team A request';
  assert not ((select v from t_ctx where k = 'reqSolo') = any (ids)), 'the leader does not see a member''s individual request';
  assert not ((select v from t_ctx where k = 'reqB') = any (ids)), 'a teamLeader who is only a member of team B does not see its requests';

  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_tb, 'lines', jsonb_build_array(
          jsonb_build_object('kind', 'material', 'description', 'ZZ 1a sand', 'unit', 'bag', 'quantity', 1, 'intended_member_id', v_w19))));
    assert false, 'named a member of a team they do not lead';
  exception when others then assert sqlerrm = 'NOT_TEAM_LEADER', 'team B member: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_tc, 'lines', jsonb_build_array(
          jsonb_build_object('kind', 'material', 'description', 'ZZ 1a sand', 'unit', 'bag', 'quantity', 1))));
    assert false, 'used a team they are not in';
  exception when others then assert sqlerrm = 'NOT_IN_TEAM', 'team C: ' || sqlerrm; end;
  begin perform pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineOutlet'), 1, 1);
    assert false, 'the leader changed a member''s line';
  exception when others then assert sqlerrm = 'NOT_YOUR_LINE', 'leader edit: ' || sqlerrm; end;
  assert pr_my_requests(200)::text !~* '"[a-z_]*(price|amount|cost|peso)[a-z_]*"\s*:', 'W-0021: no money keys';
end $$;

-- ── 5. Private photos (objects inserted by the database owner, standing in for the app's upload) ──
reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('request-photos', (select v from t_ctx where k = 'w7') || '/' || (select v from t_ctx where k = 'reqA') || '/team.jpg',
   (select v::uuid from t_ctx where k = 'w7')),
  ('request-photos', (select v from t_ctx where k = 'w7') || '/' || (select v from t_ctx where k = 'reqSolo') || '/solo.jpg',
   (select v::uuid from t_ctx where k = 'w7'));
insert into t_ctx values
  ('pathTeam', (select v from t_ctx where k = 'w7') || '/' || (select v from t_ctx where k = 'reqA') || '/team.jpg'),
  ('pathSolo', (select v from t_ctx where k = 'w7') || '/' || (select v from t_ctx where k = 'reqSolo') || '/solo.jpg');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w7'), 'role', 'authenticated')::text, true);
do $$
begin
  perform pr_attach_photo(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqA'), null, (select v from t_ctx where k = 'pathTeam'));
  perform pr_attach_photo(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqSolo'), null, (select v from t_ctx where k = 'pathSolo'));
  assert (select count(*) from storage.objects where bucket_id = 'request-photos'
            and name in ((select v from t_ctx where k = 'pathTeam'), (select v from t_ctx where k = 'pathSolo'))) = 2,
    'the requester sees both photos';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w21'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'request-photos' and name = (select v from t_ctx where k = 'pathTeam')) = 1,
    'the team''s leader sees a team request''s photo';
  assert (select count(*) from storage.objects where bucket_id = 'request-photos' and name = (select v from t_ctx where k = 'pathSolo')) = 0,
    'the leader does not see a member''s individual photo';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w19'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'request-photos'
            and name in ((select v from t_ctx where k = 'pathTeam'), (select v from t_ctx where k = 'pathSolo'))) = 0,
    'a colleague sees neither photo';
end $$;

-- ── 6. Leadership taken away: authority is rechecked on every call (spec §3) ──
reset role;
update pr_team_members set is_leader = false
 where team_id = (select v::uuid from t_ctx where k = 'ta') and worker_id = (select v::uuid from t_ctx where k = 'w21');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w21'), 'role', 'authenticated')::text, true);
do $$
declare ids text[];
begin
  select array_agg(e ->> 'id') into ids from jsonb_array_elements(pr_my_requests(200)) e;
  assert not ((select v from t_ctx where k = 'reqA') = any (ids)), 'a former leader no longer sees the team''s requests';
  assert (select count(*) from storage.objects where bucket_id = 'request-photos' and name = (select v from t_ctx where k = 'pathTeam')) = 0,
    'nor its photos';
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', (select v::uuid from t_ctx where k = 'p'),
          'team_id', (select v::uuid from t_ctx where k = 'ta'), 'lines', jsonb_build_array(
          jsonb_build_object('kind', 'material', 'description', 'ZZ 1a outlet', 'unit', 'pc', 'quantity', 1,
                             'intended_member_id', (select v::uuid from t_ctx where k = 'w7')))));
    assert false, 'a former leader named a member';
  exception when others then assert sqlerrm = 'NOT_TEAM_LEADER', 'former leader: ' || sqlerrm; end;
end $$;

-- ── 7. The office (owner): arrange, change a batch's dates, match the unlisted item ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);
do $$
declare v_portion uuid; v_batch uuid; v_new date;
begin
  select id, batch_id into v_portion, v_batch from pr_line_portions where line_id = (select v::uuid from t_ctx where k = 'lineOutlet');
  perform pr_office_set_arranged(v_portion, true);
  v_new := (select delivery_on from pr_batches where id = v_batch) + 1;
  perform pr_office_set_batch_dates(v_batch, (select purchase_on from pr_batches where id = v_batch), v_new);
  insert into t_ctx values ('newDelivery', v_new::text);
  perform pr_office_match_item((select v::uuid from t_ctx where k = 'lineElbow'), (select v::uuid from t_ctx where k = 'elbow'));
end $$;

-- ── 8. W-0007 sees the office's changes; quantity rules (spec §4B) ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_outlet text := (select v from t_ctx where k = 'lineOutlet');
  v_base int; r jsonb; l jsonb;
begin
  select x into l from jsonb_array_elements(pr_my_requests(200)) e, jsonb_array_elements(e -> 'lines') x where x ->> 'id' = v_outlet;
  assert l -> 'portions' -> 0 ->> 'delivery_on' = (select v from t_ctx where k = 'newDelivery'), 'the office''s new delivery date reaches the worker';
  assert (select x ->> 'catalog_item_id' from jsonb_array_elements(pr_my_requests(200)) e, jsonb_array_elements(e -> 'lines') x
           where x ->> 'id' = (select v from t_ctx where k = 'lineElbow')) = (select v from t_ctx where k = 'elbow'),
    'the unlisted line now carries the office''s catalogue match';
  v_base := (l ->> 'version')::int;

  r := pr_change_quantity(gen_random_uuid(), v_outlet::uuid, v_base, 12);
  assert r ->> 'status' = 'applied', '10 → 12 applied';
  select x into l from jsonb_array_elements(pr_my_requests(200)) e, jsonb_array_elements(e -> 'lines') x where x ->> 'id' = v_outlet;
  assert jsonb_array_length(l -> 'portions') = 2, 'adding 2 to an arranged 10 makes a second portion';
  assert exists (select 1 from jsonb_array_elements(l -> 'portions') p where (p ->> 'arranged')::boolean and (p ->> 'quantity')::numeric = 10),
    'the arranged 10 are untouched';
  assert exists (select 1 from jsonb_array_elements(l -> 'portions') p where not (p ->> 'arranged')::boolean and (p ->> 'quantity')::numeric = 2),
    'the extra 2 are scheduled separately, unarranged';

  r := pr_change_quantity(gen_random_uuid(), v_outlet::uuid, (r ->> 'version')::int, 9);
  select x into l from jsonb_array_elements(pr_my_requests(200)) e, jsonb_array_elements(e -> 'lines') x where x ->> 'id' = v_outlet;
  assert jsonb_array_length(l -> 'portions') = 1 and (l -> 'portions' -> 0 ->> 'quantity')::numeric = 10
     and (l -> 'portions' -> 0 ->> 'pending_reduction')::numeric = 1 and (l ->> 'needed')::numeric = 9,
    '12 → 9: the unarranged 2 go first, then 1 of the arranged 10 is flagged for the office';

  r := pr_change_quantity(gen_random_uuid(), v_outlet::uuid, v_base, 7);
  assert r ->> 'status' = 'conflict' and (r ->> 'needed')::numeric = 9, 'an offline edit against an old version is a conflict, nothing overwritten';
end $$;

-- ── 9. The office sees the conflict and the reduction; it cancels the Additional Works line ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  assert exists (select 1 from pr_line_conflicts where line_id = (select v::uuid from t_ctx where k = 'lineOutlet') and resolved_at is null),
    'the office has the conflict to resolve';
  assert exists (select 1 from jsonb_array_elements(pr_office_queue('open')) e where e ->> 'id' = (select v from t_ctx where k = 'reqA')),
    'the request is in the office''s open queue';
  r := pr_office_cancel_line((select v::uuid from t_ctx where k = 'lineAW'), '1a acceptance');
  assert (r ->> 'request_closed')::boolean, 'the office''s last-line cancel closes the request';
end $$;

-- ── 10. W-0007 cancels (0088): last line closes the request; a late cancel is a quiet success ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w7'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  r := pr_cancel_line(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineElbow'));
  assert r ->> 'status' = 'cancelled' and not (r ->> 'request_closed')::boolean, 'one of two lines cancelled: the request stays open';
  assert (select e ->> 'status' from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = (select v from t_ctx where k = 'reqA')) = 'submitted',
    'request A still submitted';

  r := pr_cancel_line('00000000-0000-4000-8000-00000001a402', (select v::uuid from t_ctx where k = 'lineSolo'));
  assert (r ->> 'request_closed')::boolean and (r ->> 'version')::int = 2, 'cancelling the last line closes the request';
  assert (select e ->> 'status' from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = (select v from t_ctx where k = 'reqSolo')) = 'cancelled',
    'the worker sees it cancelled';
  assert pr_cancel_line('00000000-0000-4000-8000-00000001a402', (select v::uuid from t_ctx where k = 'lineSolo')) = r,
    'a retried cancel returns the first answer';

  r := pr_cancel_request(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqSolo'));
  assert r ->> 'status' = 'cancelled' and (r ->> 'lines')::int = 0, 'cancelling an already-cancelled request: success, nothing changes';
  r := pr_cancel_line(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineSolo'));
  assert r ->> 'status' = 'cancelled' and (r ->> 'version')::int = 2, 'cancelling an already-cancelled line: success, version unchanged';
  r := pr_cancel_request(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqAW'));
  assert r ->> 'status' = 'cancelled', 'a cancel arriving after the office closed the request: success, not Failed';
  r := pr_cancel_line(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineAW'));
  assert r ->> 'status' = 'cancelled', 'a line cancel arriving after the office cancelled it: success';
end $$;

-- ── 11. Records and money (as the database owner) ──
reset role;
do $$
declare v_solo uuid := (select v::uuid from t_ctx where k = 'reqSolo');
begin
  assert (select count(*) from pr_events where request_id = v_solo and kind = 'line_cancelled') = 1
     and (select count(*) from pr_events where request_id = v_solo and kind = 'request_cancelled' and detail ->> 'by' = 'worker') = 1
     and (select count(*) from pr_events where request_id = v_solo and kind = 'request_cancelled') = 1,
    'one line cancel and one request close recorded; the late cancels recorded nothing';
  assert (select count(*) from pr_requests where client_op_id = '00000000-0000-4000-8000-00000001a401') = 1, 'one request for the retried op';
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name like 'pr\_%' and column_name ~* '(price|amount|cost|peso)'),
    'no pr_ table has a money column';
end $$;

select '1a acceptance: all checks passed' as result;

rollback;
