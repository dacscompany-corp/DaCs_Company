-- ════════════════════════════════════════════════════════════════════
-- Stage 3a acceptance — migration 0107 (live: tools). Self-wrapped in
-- begin / rollback: section D switches tools on and records a whole tool's
-- life on a ZZ item, then every row of it is rolled back.
-- Run it through MCP execute_sql. Success ends with the row
-- '3a acceptance: all checks passed'.
--   A. tools are still off: the main owner's status says so, every write is
--      refused TOOLS_OFF, Mark as Complete and the shopping list read nothing;
--      no tool rows exist;
--   B. who may call what: every tl_ operation and reader is for signed-in
--      accounts only, every helper for nobody;
--   C. nothing changed for requests: tools fill no request line, so every
--      line's covered figure is still purchases + stock;
--   D. as the main owner, with tools switched on inside this transaction: a
--      registration at a project needs its person, an opening one a photo; register, issue (a real
--      active worker, a real project in progress), hand back damaged → a
--      Retire request; rejected → Under repair; Lost reported, rejected →
--      exactly back; a tool item refused as stock (TOOL_ITEM); the readers
--      answer with no money. All rolled back.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';

do $$
declare
  v_owner uuid := (select id from profiles where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active'
                     order by created_at limit 1);
  v_worker uuid;
  v_folder uuid;
  v_item uuid;
  v_err text;
  r jsonb;
  t uuid;
  v_rec uuid;
  fn text;
  v_any_folder uuid := (select id from folders where owner_id = v_owner limit 1);
  v_lines uuid[] := array(select id from pr_lines limit 20);
begin
  -- A
  assert not coalesce((select s.enabled from tl_settings s where s.owner_id = v_owner), false), 'A1 tools must still be off live';
  assert (select count(*) from tl_tools) = 0 and (select count(*) from tl_records) = 0 and (select count(*) from tl_covers) = 0,
    'A2 no tool rows yet';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  assert (tl_status() ->> 'enabled')::boolean = false and (tl_status() ->> 'is_main_owner')::boolean, 'A3 status: off, main owner';
  begin
    perform tl_register(gen_random_uuid(), '{"item_id": null}'::jsonb);
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'TOOLS_OFF', 'A4 a write while off — got ' || coalesce(v_err, 'no refusal');
  assert tl_project_out(v_any_folder) = '[]'::jsonb, 'A5 Mark as Complete reads nothing while off';
  assert tl_line_tools(v_lines) = '{}'::jsonb, 'A6 the shopping list reads nothing while off';
  execute 'reset role';

  -- B
  foreach fn in array array['tl_status()', 'tl_set_enabled(boolean)', 'tl_register(uuid,jsonb)', 'tl_issue(uuid,jsonb)',
      'tl_handover(uuid,jsonb)', 'tl_return(uuid,jsonb)', 'tl_repaired(uuid,uuid,text)', 'tl_report_lost(uuid,uuid,text)',
      'tl_request_retire(uuid,uuid,text)', 'tl_found(uuid,jsonb)', 'tl_decide(uuid,uuid,boolean,text)', 'tl_reverse(uuid,uuid,text)',
      'tl_overview()', 'tl_tool(uuid)', 'tl_choices()', 'tl_request_lines(uuid)', 'tl_project_out(uuid)', 'tl_line_tools(uuid[])', 'stk_overview()'] loop
    assert has_function_privilege('authenticated', fn, 'execute') and not has_function_privilege('anon', fn, 'execute'), 'B1 signed-in only: ' || fn;
  end loop;
  foreach fn in array array['tl_actor()', 'tl_reader()', 'tl_write(uuid,tl_tools,text,text,jsonb,jsonb)', 'tl_apply(uuid,jsonb,boolean)',
      'tl_cover(uuid,uuid,uuid,uuid,uuid)', 'tl_bought_for(tl_tools,uuid,uuid)', 'pr_line_bought(uuid)', 'pr_portion_bought(uuid)',
      'pr_item_in_use(uuid)', 'tl_tool_json(uuid)', 'tl_record_json(uuid)'] loop
    assert not has_function_privilege('authenticated', fn, 'execute') and not has_function_privilege('anon', fn, 'execute'), 'B2 nobody: ' || fn;
  end loop;

  -- C
  assert not exists (select 1 from pr_lines l where pr_line_bought(l.id) <> pr_line_purchased(l.id) + pr_line_from_stock(l.id)),
    'C1 every request line: covered = purchases + stock (tools fill nothing yet)';

  -- D
  select p.id into v_worker from profiles p
   where p.role in ('worker', 'teamLeader') and coalesce(p.status, 'active') = 'active' and coalesce(p.owner_id, p.id) = v_owner limit 1;
  select f.id into v_folder from folders f left join folders par on par.id = f.parent_folder_id
   where f.owner_id = v_owner and f.completed_at is null and par.completed_at is null limit 1;
  assert v_worker is not null and v_folder is not null, 'D0 an active worker and a project in progress exist';
  insert into pr_catalog_items (owner_id, name, unit, kind) values (v_owner, 'ZZ 3a acceptance grinder', 'pc', 'tool') returning id into v_item;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform tl_set_enabled(true);
  v_err := null;
  begin
    perform tl_register(gen_random_uuid(), jsonb_build_object('item_id', v_item, 'at', v_folder, 'condition', 'good'));
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'PERSON_REQUIRED', 'D1 at a project without a person — got ' || coalesce(v_err, 'no refusal');
  v_err := null;
  begin
    perform tl_register(gen_random_uuid(), jsonb_build_object('item_id', v_item, 'at', 'warehouse', 'condition', 'good'));
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'PHOTO_REQUIRED', 'D1b an opening register without a photo — got ' || coalesce(v_err, 'no refusal');
  r := tl_register(gen_random_uuid(), jsonb_build_object('item_id', v_item, 'at', 'warehouse', 'condition', 'good', 'details', 'ZZ',
                                                         'photo_path', 'tools/' || v_owner || '/2026-10/' || gen_random_uuid() || '.jpg'));
  t := (r -> 'tools' -> 0 ->> 'tool_id')::uuid;
  assert (r -> 'tools' -> 0 ->> 'number')::int = 1, 'D2 the first tool is TOOL-0001';
  perform tl_issue(gen_random_uuid(), jsonb_build_object('tool_id', t, 'holder_id', v_worker, 'folder_id', v_folder));
  assert (tl_project_out(v_folder) -> 0 ->> 'label') = 'TOOL-0001', 'D3 Mark as Complete would name it';
  r := tl_return(gen_random_uuid(), jsonb_build_object('tool_id', t, 'condition', 'damaged', 'note', 'ZZ'));
  v_rec := (r ->> 'retire_record_id')::uuid;
  assert (tl_tool(t) ->> 'state') = 'retire_pending', 'D4 damaged → waiting for the owner';
  v_err := null;
  begin
    perform tl_issue(gen_random_uuid(), jsonb_build_object('tool_id', t, 'holder_id', v_worker, 'folder_id', v_folder));
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'NOT_AVAILABLE', 'D5 not issued while waiting — got ' || coalesce(v_err, 'no refusal');
  perform tl_decide(gen_random_uuid(), v_rec, false, 'ZZ repair it');
  assert (tl_tool(t) ->> 'state') = 'repair', 'D6 a rejected retire → Under repair';
  perform tl_repaired(gen_random_uuid(), t, 'ZZ');
  perform tl_issue(gen_random_uuid(), jsonb_build_object('tool_id', t, 'holder_id', v_worker, 'folder_id', v_folder));
  v_rec := (tl_report_lost(gen_random_uuid(), t, 'ZZ') ->> 'record_id')::uuid;
  perform tl_decide(gen_random_uuid(), v_rec, false, 'ZZ it is on site');
  r := tl_tool(t);
  assert (r ->> 'state') = 'issued' and (r ->> 'holder_id')::uuid = v_worker, 'D7 a rejected Lost → exactly back';
  r := tl_overview();
  assert r::text !~ '"(amount|price|cost[a-z_]*|value|peso|gross[a-z_]*)"\s*:', 'D8 the Tools screen carries no money';
  v_err := null;
  begin
    perform stk_opening(gen_random_uuid(), jsonb_build_object('item_id', v_item, 'at', 'warehouse', 'quantity', '1',
                                                              'on', to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD')));
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'TOOL_ITEM', 'D9 a tool item is never stock — got ' || coalesce(v_err, 'no refusal');
  execute 'reset role';
  raise notice 'checked with worker % on folder %', v_worker, v_folder;
end $$;

select '3a acceptance: all checks passed' as result;
rollback;
