-- ════════════════════════════════════════════════════════════════════
-- 0086 WorkMate Requests (office) — live behaviour checks.
--
-- This file wraps itself in begin / rollback, so nothing persists. For a dry
-- run with the migration, run  begin;  <0086 migration>  <this file>  (its own
-- begin only warns; its rollback undoes everything, migration included).
--
-- Uses existing active accounts: W-0007, W-0019 (workers), W-0021
-- (teamLeader), their owner, that owner's staff account, and — if one
-- exists — an owner-role account of another company (the outsider).
-- Builds its own throwaway project, Additional Works, team and items.
-- A failed check aborts with its message; success ends with the row
-- 'pr office verify: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

-- ── 0. Accounts and a throwaway project (as the database owner) ──
do $$
declare
  v_worker uuid; v_other uuid; v_leader uuid; v_owner uuid; v_staff uuid; v_out uuid;
  v_p uuid; v_aw uuid; v_empty uuid; v_item uuid; v_tool uuid;
begin
  select id into v_worker from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_other  from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_leader from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_worker is not null and v_other is not null and v_leader is not null,
    'accounts W-0007 and W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_worker);
  assert (select role from profiles where id = v_owner) = 'owner', 'W-0007''s owner must be an owner account';
  assert (select coalesce(owner_id, id) from profiles where id = v_other) = v_owner
     and (select coalesce(owner_id, id) from profiles where id = v_leader) = v_owner, 'W-0007, W-0019 and W-0021 must share one owner';
  select id into v_staff from profiles
   where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  assert v_staff is not null, 'the owner must have an active staff account';
  select id into v_out from profiles where role = 'owner' and id <> v_owner limit 1;

  insert into folders (owner_id, name) values (v_owner, 'ZZ 0086 verify project') returning id into v_p;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 0086 verify AW', v_p) returning id into v_aw;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 0086 verify empty') returning id into v_empty;
  insert into pr_project_settings (folder_id, owner_id, allow_requests) values (v_p, v_owner, true);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 0086 elbow', '1/2 in', 'pc', 'plumbing') returning id into v_item;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'tool', 'ZZ 0086 pipe wrench', '14 in', 'pc', 'plumbing') returning id into v_tool;

  insert into t_ctx values ('worker', v_worker), ('other', v_other), ('leader', v_leader), ('owner', v_owner),
    ('staff', v_staff), ('out', coalesce(v_out::text, '')), ('p', v_p), ('aw', v_aw), ('empty', v_empty),
    ('item', v_item), ('tool', v_tool);
end $$;

-- ── 1. As the worker W-0007: two requests, and the office RPCs refuse ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);

do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_aw uuid := (select v::uuid from t_ctx where k = 'aw');
  r jsonb;
begin
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_p, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ unlisted elbow', 'spec', 'half inch', 'unit', 'pc', 'quantity', 10),
         jsonb_build_object('kind', 'material', 'description', 'ZZ sand', 'unit', 'bag', 'quantity', 5))));
  insert into t_ctx values ('req', r ->> 'request_id'), ('lineA', r -> 'line_ids' ->> 0), ('lineB', r -> 'line_ids' ->> 1);
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_aw, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ AW nails', 'unit', 'kg', 'quantity', 2))));
  insert into t_ctx values ('reqAW', r ->> 'request_id');

  assert pr_office_queue('open') = '[]'::jsonb, 'a worker reads an empty office queue';
  begin perform pr_office_request((select v::uuid from t_ctx where k = 'req')); assert false, 'worker read a request';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker request: ' || sqlerrm; end;
  begin perform pr_office_set_arranged(gen_random_uuid(), true); assert false, 'worker arranged';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker arrange: ' || sqlerrm; end;
  begin perform pr_office_save_team(null, 'ZZ worker team', true); assert false, 'worker made a team';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker team: ' || sqlerrm; end;
  begin perform pr_folder_request_count(v_p); assert false, 'worker counted requests';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker count: ' || sqlerrm; end;
  begin perform pr_office_batches(); assert false, 'worker read batches';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'worker batches: ' || sqlerrm; end;
end $$;

-- ── 2. As the owner: read, match, arrange ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);

do $$
declare
  v_req uuid := (select v::uuid from t_ctx where k = 'req');
  v_a uuid := (select v::uuid from t_ctx where k = 'lineA');
  v_item uuid := (select v::uuid from t_ctx where k = 'item');
  v_tool uuid := (select v::uuid from t_ctx where k = 'tool');
  d jsonb; q jsonb; v_portion uuid;
begin
  q := pr_office_queue('open');
  assert exists (select 1 from jsonb_array_elements(q) e where e ->> 'id' = v_req::text), 'the request is in the open queue';
  assert (select e -> 'events' from jsonb_array_elements(q) e where e ->> 'id' = v_req::text) = 'null'::jsonb, 'the queue carries no history';

  d := pr_office_request(v_req);
  assert jsonb_array_length(d -> 'lines') = 2, 'two lines';
  assert d ->> 'requester_name' is not null and d ->> 'work_name' = 'Main Contract', 'names resolved';
  assert (d -> 'lines' -> 0 ->> 'needed')::numeric = 10, 'line A needs 10';
  assert exists (select 1 from jsonb_array_elements(d -> 'events') e where e ->> 'kind' = 'submitted'), 'history starts with submitted';

  begin perform pr_office_match_item(v_a, v_tool); assert false, 'matched a material to a tool';
  exception when others then assert sqlerrm = 'BAD_CATALOG_ITEM', 'wrong kind: ' || sqlerrm; end;
  perform pr_office_match_item(v_a, v_item);
  assert (select catalog_item_id from pr_lines where id = v_a) = v_item, 'line A matched';
  assert (select version from pr_lines where id = v_a) = 1, 'matching does not change the version';

  select id into v_portion from pr_line_portions where line_id = v_a;
  insert into t_ctx values ('portionA', v_portion);
  perform pr_office_set_arranged(v_portion, true);
  perform pr_office_set_arranged(v_portion, true);
  assert (select arranged_at is not null and arranged_by = auth.uid() from pr_line_portions where id = v_portion), 'portion arranged by the owner';
  assert (select count(*) from pr_events where line_id = v_a and kind = 'portion_arranged') = 1, 'arranging twice records once';
  perform pr_office_set_arranged(v_portion, false);
  assert (select arranged_at is null from pr_line_portions where id = v_portion), 'undo works with nothing pending';
  perform pr_office_set_arranged(v_portion, true);
end $$;

-- ── 3. As the worker: reduce arranged quantity → pending reduction ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  r := pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineA'), 1, 4);
  assert r ->> 'status' = 'applied', 'worker reduction applied';
end $$;

-- ── 4. As the owner: resolve the reduction; office quantity change; conflict ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);
do $$
declare
  v_portion uuid := (select v::uuid from t_ctx where k = 'portionA');
  v_b uuid := (select v::uuid from t_ctx where k = 'lineB');
  r jsonb;
begin
  assert (select pending_reduction from pr_line_portions where id = v_portion) = 6, 'arranged 10 → 4 flags 6 for the office';
  begin perform pr_office_set_arranged(v_portion, false); assert false, 'undid an arrangement with a reduction pending';
  exception when others then assert sqlerrm = 'REDUCTION_PENDING', 'undo pending: ' || sqlerrm; end;
  begin perform pr_office_resolve_reduction(v_portion, 'lost', null); assert false, 'accepted a bad outcome';
  exception when others then assert sqlerrm = 'BAD_OUTCOME', 'outcome: ' || sqlerrm; end;
  r := pr_office_resolve_reduction(v_portion, 'kept_as_surplus', 'supplier will not take it back');
  assert not (r ->> 'removed')::boolean, 'portion kept';
  assert (select quantity = 4 and pending_reduction = 0 from pr_line_portions where id = v_portion), 'portion now 4, nothing pending';
  assert exists (select 1 from pr_events where line_id = (select v::uuid from t_ctx where k = 'lineA')
                  and kind = 'reduction_resolved' and detail ->> 'outcome' = 'kept_as_surplus'), 'outcome recorded';
  begin perform pr_office_resolve_reduction(v_portion, 'order_reduced', null); assert false, 'resolved twice';
  exception when others then assert sqlerrm = 'NOTHING_PENDING', 'twice: ' || sqlerrm; end;

  begin perform pr_office_change_quantity(v_b, 8, '  '); assert false, 'changed without a reason';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'no reason: ' || sqlerrm; end;
  begin perform pr_office_change_quantity(v_b, 0, 'zero'); assert false, 'changed to zero';
  exception when others then assert sqlerrm = 'BAD_QUANTITY', 'zero: ' || sqlerrm; end;
  r := pr_office_change_quantity(v_b, 8, 'site engineer recount');
  assert r ->> 'status' = 'applied' and (r ->> 'version')::int = 2 and (r ->> 'needed')::numeric = 8, 'office change applied, version 2';
  r := pr_office_change_quantity(v_b, 8, 'same again');
  assert r ->> 'status' = 'unchanged', 'same quantity changes nothing';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'worker'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  r := pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineB'), 1, 3);
  assert r ->> 'status' = 'conflict', 'an edit against version 1 becomes a conflict';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);
do $$
declare
  v_b uuid := (select v::uuid from t_ctx where k = 'lineB');
  d jsonb; l jsonb; v_conflict uuid;
begin
  d := pr_office_request((select v::uuid from t_ctx where k = 'req'));
  select e into l from jsonb_array_elements(d -> 'lines') e where e ->> 'id' = v_b::text;
  assert (l ->> 'has_conflict')::boolean and jsonb_array_length(l -> 'open_conflicts') = 1, 'conflict shown to the office';
  v_conflict := (l -> 'open_conflicts' -> 0 ->> 'id')::uuid;
  assert (l -> 'open_conflicts' -> 0 ->> 'proposed_quantity')::numeric = 3
     and (l -> 'open_conflicts' -> 0 ->> 'current_quantity')::numeric = 8, 'both values kept';
  perform pr_office_resolve_conflict(v_conflict, true, 'worker is on site');
  assert (select version = 3 and not has_conflict from pr_lines where id = v_b), 'applied: version 3, conflict cleared';
  assert (select sum(quantity - pending_reduction) from pr_line_portions where line_id = v_b) = 3, 'line B now needs 3';
  assert (select resolution from pr_line_conflicts where id = v_conflict) = 'applied: worker is on site', 'resolution recorded';
  begin perform pr_office_resolve_conflict(v_conflict, false, null); assert false, 'resolved twice';
  exception when others then assert sqlerrm = 'ALREADY_RESOLVED', 'twice: ' || sqlerrm; end;
end $$;

-- ── 5. Batches: list, move a portion, change dates; no direct writes ──
do $$
declare
  bs jsonb; v_next uuid; v_portion_b uuid; n int; r jsonb;
begin
  bs := pr_office_batches();
  assert (select count(*) from jsonb_array_elements(bs) e where (e ->> 'cutoff_at')::timestamptz > now()) >= 3,
    'this week and the next two weeks exist';
  select (e ->> 'id')::uuid into v_next from jsonb_array_elements(bs) e
   where (e ->> 'cutoff_at')::timestamptz > now() + interval '7 days' order by e ->> 'cutoff_at' limit 1;
  insert into t_ctx values ('next', v_next);

  select id into v_portion_b from pr_line_portions where line_id = (select v::uuid from t_ctx where k = 'lineB');
  r := pr_office_move_portion(v_portion_b, v_next, 'supplier out of stock');
  assert (r ->> 'moved')::boolean and (select batch_id from pr_line_portions where id = v_portion_b) = v_next, 'portion moved';
  begin perform pr_office_move_portion((select v::uuid from t_ctx where k = 'portionA'), v_next, null); assert false, 'moved an arranged portion';
  exception when others then assert sqlerrm = 'ARRANGED', 'arranged move: ' || sqlerrm; end;
  begin perform pr_office_move_portion(v_portion_b, gen_random_uuid(), null); assert false, 'moved to a missing batch';
  exception when others then assert sqlerrm = 'BAD_BATCH', 'missing batch: ' || sqlerrm; end;

  begin perform pr_office_set_batch_dates(v_next, current_date + 10, current_date + 9); assert false, 'delivery before purchase';
  exception when others then assert sqlerrm = 'BAD_DATES', 'dates: ' || sqlerrm; end;
  r := pr_office_set_batch_dates(v_next, current_date + 10, current_date + 12);
  assert (select purchase_on = current_date + 10 and delivery_on = current_date + 12 and updated_by = auth.uid()
            from pr_batches where id = v_next), 'dates changed with who';

  begin
    update pr_batches set delivery_on = delivery_on + 1 where id = v_next;
    get diagnostics n = row_count;
  exception when insufficient_privilege then n := 0;
  end;
  assert n = 0, 'a direct update of pr_batches changes nothing';
  begin
    insert into pr_batches (owner_id, cutoff_at, purchase_on, delivery_on) values (auth.uid(), '2031-01-04 12:00+08', '2031-01-06', '2031-01-08');
    assert false, 'a direct insert into pr_batches was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── 6. Cancel lines; a request with an order still to undo stays open ──
do $$
declare
  v_a uuid := (select v::uuid from t_ctx where k = 'lineA');
  v_b uuid := (select v::uuid from t_ctx where k = 'lineB');
  v_portion uuid := (select v::uuid from t_ctx where k = 'portionA');
  v_req uuid := (select v::uuid from t_ctx where k = 'req');
  r jsonb;
begin
  begin perform pr_office_cancel_line(v_a, ''); assert false, 'cancelled without a reason';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'no reason: ' || sqlerrm; end;
  r := pr_office_cancel_line(v_a, 'wrong size requested');
  assert not (r ->> 'request_closed')::boolean, 'line B still open';
  assert (select status from pr_lines where id = v_a) = 'cancelled', 'line A cancelled';
  assert (select pending_reduction = quantity from pr_line_portions where id = v_portion), 'arranged quantity flagged, not erased';
  begin perform pr_office_cancel_line(v_a, 'again'); assert false, 'cancelled twice';
  exception when others then assert sqlerrm = 'LINE_CLOSED', 'twice: ' || sqlerrm; end;

  r := pr_office_cancel_line(v_b, 'not needed any more');
  assert (r ->> 'request_closed')::boolean, 'last open line closes the request';
  assert (select status = 'cancelled' and cancelled_at is not null from pr_requests where id = v_req), 'request cancelled';
  assert exists (select 1 from pr_events where request_id = v_req and kind = 'request_cancelled' and detail ->> 'by' = 'office'),
    'the office closing the request is in its history';
  assert exists (select 1 from jsonb_array_elements(pr_office_queue('open')) e where e ->> 'id' = v_req::text),
    'a cancelled request with an order still to undo stays in the open queue';

  r := pr_office_resolve_reduction(v_portion, 'order_reduced', null);
  assert (r ->> 'removed')::boolean and not exists (select 1 from pr_line_portions where id = v_portion), 'fully reduced portion removed';
  assert not exists (select 1 from jsonb_array_elements(pr_office_queue('open')) e where e ->> 'id' = v_req::text), 'gone from the open queue';
  assert exists (select 1 from jsonb_array_elements(pr_office_queue('closed')) e where e ->> 'id' = v_req::text), 'in the closed list';
end $$;

-- ── 7. Projects and the delete guard ──
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_aw uuid := (select v::uuid from t_ctx where k = 'aw');
  v_empty uuid := (select v::uuid from t_ctx where k = 'empty');
  ps jsonb;
begin
  ps := pr_office_projects();
  assert exists (select 1 from jsonb_array_elements(ps) e where e ->> 'folder_id' = v_p::text
                  and (e ->> 'allow_requests')::boolean and (e ->> 'additional_works')::int = 1), 'project listed with its AW';
  assert not exists (select 1 from jsonb_array_elements(ps) e where e ->> 'folder_id' = v_aw::text), 'AW is not a top-level project';
  perform pr_office_set_allow_requests(v_empty, true);
  assert (select allow_requests from pr_project_settings where folder_id = v_empty), 'allow requests switched on';
  perform pr_office_set_allow_requests(v_empty, false);
  assert not (select allow_requests from pr_project_settings where folder_id = v_empty), 'and off again';
  begin perform pr_office_set_allow_requests(v_aw, true); assert false, 'set allow on an AW';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'AW allow: ' || sqlerrm; end;

  assert pr_folder_request_count(v_p) = 2, 'project counts its own and its AW''s requests';
  assert pr_folder_request_count(v_aw) = 1, 'AW counts its request';
  assert pr_folder_request_count(v_empty) = 0, 'an empty project counts none';
end $$;

-- ── 8. As staff: teams and the catalogue ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_other uuid := (select v::uuid from t_ctx where k = 'other');
  v_leader uuid := (select v::uuid from t_ctx where k = 'leader');
  v_owner uuid := (select v::uuid from t_ctx where k = 'owner');
  v_team uuid; v_item uuid; t jsonb;
begin
  assert exists (select 1 from jsonb_array_elements(pr_office_queue('closed')) e where e ->> 'id' = (select v from t_ctx where k = 'req')),
    'staff see the owner''s requests';
  assert exists (select 1 from jsonb_array_elements(pr_office_people()) e where e ->> 'id' = v_leader::text), 'people list has W-0021';

  v_team := (pr_office_save_team(null, 'ZZ 0086 team', true) ->> 'id')::uuid;
  assert (select owner_id from pr_teams where id = v_team) = v_owner, 'staff create teams for their owner';
  begin perform pr_office_save_team(null, ' zz 0086 TEAM ', true); assert false, 'duplicate team';
  exception when others then assert sqlerrm = 'DUPLICATE_TEAM', 'dup team: ' || sqlerrm; end;

  perform pr_office_add_member(v_team, v_other);
  perform pr_office_add_member(v_team, v_other);
  assert (select count(*) from pr_team_members where team_id = v_team and worker_id = v_other and removed_at is null) = 1, 'adding twice keeps one row';
  begin perform pr_office_set_leader(v_team, v_other); assert false, 'a worker became leader';
  exception when others then assert sqlerrm = 'NOT_A_TEAM_LEADER', 'worker leader: ' || sqlerrm; end;
  begin perform pr_office_set_leader(v_team, v_leader); assert false, 'a non-member became leader';
  exception when others then assert sqlerrm = 'NOT_IN_TEAM', 'outside leader: ' || sqlerrm; end;
  perform pr_office_add_member(v_team, v_leader);
  perform pr_office_set_leader(v_team, v_leader);
  select e into t from jsonb_array_elements(pr_office_teams()) e where e ->> 'id' = v_team::text;
  assert jsonb_array_length(t -> 'members') = 2 and (t -> 'members' -> 0 ->> 'is_leader')::boolean
     and t -> 'members' -> 0 ->> 'worker_id' = v_leader::text, 'leader listed first';
  perform pr_office_remove_member(v_team, v_leader);
  assert not exists (select 1 from pr_team_members where team_id = v_team and is_leader and removed_at is null), 'removed leader is no longer leader';
  assert exists (select 1 from pr_team_members where team_id = v_team and worker_id = v_leader and removed_at is not null), 'history row kept';

  v_item := (pr_office_save_item(null, 'material', 'ZZ 0086 cement', '40 kg', 'bag', 'masonry', true) ->> 'id')::uuid;
  begin perform pr_office_save_item(null, 'material', 'zz 0086 CEMENT', '40 KG', 'Bag', '', true); assert false, 'duplicate item';
  exception when others then assert sqlerrm = 'DUPLICATE_ITEM', 'dup item: ' || sqlerrm; end;
  begin perform pr_office_save_item(null, 'food', 'ZZ', '', 'pc', '', true); assert false, 'bad kind';
  exception when others then assert sqlerrm = 'BAD_ITEM', 'bad kind: ' || sqlerrm; end;
  perform pr_office_save_item(v_item, 'material', 'ZZ 0086 cement', '40 kg', 'bag', 'masonry', false);
  assert exists (select 1 from jsonb_array_elements(pr_office_catalog()) e
                  where e ->> 'id' = v_item::text and not (e ->> 'active')::boolean), 'inactive items stay listed for the office';
end $$;

-- ── 9. The outsider (another company's owner) sees and changes nothing ──
select set_config('request.jwt.claims', json_build_object('sub', coalesce(nullif((select v from t_ctx where k = 'out'), ''),
       (select v from t_ctx where k = 'worker')), 'role', 'authenticated')::text, true);
do $$
begin
  if (select v from t_ctx where k = 'out') = '' then
    raise notice 'no outsider account: tenant checks skipped';
    return;
  end if;
  assert not exists (select 1 from jsonb_array_elements(pr_office_queue('closed')) e where e ->> 'id' = (select v from t_ctx where k = 'req')),
    'the outsider''s queue does not list the request';
  begin perform pr_office_request((select v::uuid from t_ctx where k = 'req')); assert false, 'outsider read the request';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'outsider read: ' || sqlerrm; end;
  begin perform pr_office_set_batch_dates((select v::uuid from t_ctx where k = 'next'), current_date, current_date); assert false, 'outsider moved dates';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'outsider dates: ' || sqlerrm; end;
  begin perform pr_folder_request_count((select v::uuid from t_ctx where k = 'p')); assert false, 'outsider counted';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'outsider count: ' || sqlerrm; end;
end $$;

-- ── 10. Grants (as the database owner) ──
reset role;
do $$
begin
  assert not has_function_privilege('anon', 'pr_office_queue(text)', 'execute'), 'anon cannot read the queue';
  assert has_function_privilege('authenticated', 'pr_office_queue(text)', 'execute'), 'signed-in users may call the queue';
  assert not has_function_privilege('authenticated', 'pr_request_doc(uuid, boolean)', 'execute'), 'pr_request_doc is internal';
  assert not has_function_privilege('authenticated', 'pr_is_office()', 'execute'), 'pr_is_office is internal';
  assert not exists (select 1 from pg_policies where tablename = 'pr_batches' and cmd in ('INSERT', 'UPDATE')), 'no batch write policies';
  assert not exists (select 1 from pg_policies where tablename in ('pr_teams', 'pr_team_members', 'pr_catalog_items', 'pr_project_settings')
                      and cmd in ('INSERT', 'UPDATE')), 'no setup-table write policies';
end $$;

select 'pr office verify: all checks passed' as result;

rollback;
