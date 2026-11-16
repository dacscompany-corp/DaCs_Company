-- ═══════════════════════════════════════
-- Stage 3b-a acceptance — migration 0111 (live: tools on the phone, the Team
-- Leader switch, password records). Self-wrapped in begin / rollback: every row
-- it writes, and the role it gives W-0005, is rolled back. It uses only the
-- owner's two test accounts, W-0005 and W-0007, and a ZZ team, item and project.
-- It sets no password: that needs the Edge Function and the owner's approval.
-- Run it through MCP execute_sql. Success ends with the row
-- '3b-a acceptance: all checks passed'.
--   A. who may call what: every new reader and action is for signed-in accounts
--      only, every helper for nobody; the new tables have no policy.
--   B. the main owner: the switch gives W-0005 the role and logs it; a direct
--      role change stays refused; nothing is changed for W-0007.
--   C. W-0005 as leader of a ZZ team with W-0007: finds a tool by number, issues,
--      hands back and reverses; refused for anyone outside the team.
--   D. W-0007 as worker: sees their own tool with no money, reports a problem;
--      the office sees it and closes it with a note; no tool or record changes.
--      The password state follows the records: W-0005 was never reset, and
--      W-0007 is read as it stands (reset on 5 Nov by step T0).
--   E. the switch refuses to remove a leader of an active team; an invalid leader
--      reads as such; a mark on a turned-off team can be cleared.
--   F. no expense, payroll or attendance row changed.
-- ═══════════════════════════════════════

begin;
set local statement_timeout = '60s';

do $$
declare
  v_owner uuid := (select id from profiles where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active'
                     order by created_at limit 1);
  v_w5 uuid := (select id from profiles where worker_no = 5 and role = 'worker' and coalesce(status, 'active') = 'active');
  v_w7 uuid := (select id from profiles where worker_no = 7 and role = 'worker' and coalesce(status, 'active') = 'active');
  v_outside uuid := (select id from profiles where role in ('worker', 'teamLeader') and coalesce(status, 'active') = 'active'
                        and worker_no not in (5, 7) order by worker_no limit 1);
  v_team uuid;
  v_folder uuid;
  v_item uuid;
  v_tool uuid;
  v_number int;
  v_rec uuid;
  v_problem uuid;
  v_must boolean;
  r jsonb;
  v_err text;
  fn text;
  v_money_before bigint := (select count(*) from expenses) + (select count(*) from payroll);
  v_attendance_before bigint := (select count(*) from attendance_records);
begin
  assert v_owner is not null and v_w5 is not null and v_w7 is not null, 'the main owner and test accounts W-0005 and W-0007 must exist, as plain workers';

  -- A
  foreach fn in array array['tl_my_tools()', 'tl_my_tool(uuid)', 'tl_team_tools()', 'tl_team_tool(uuid)', 'tl_team_find(text)',
      'tl_team_choices()', 'tl_team_request_lines(uuid,uuid)', 'tl_team_my_records(integer)', 'tl_team_issue(uuid,jsonb)',
      'tl_team_handover(uuid,jsonb)', 'tl_team_return(uuid,jsonb)', 'tl_team_reverse(uuid,uuid,text)',
      'tl_report_problem(uuid,uuid,text,text)', 'tl_problems(boolean)', 'tl_close_problem(uuid,uuid,text)', 'wk_me()',
      'wk_set_team_leader(uuid,boolean)', 'wk_worker_log(uuid)', 'wk_password_state()', 'wk_password_changed()',
      'pr_office_teams()', 'pr_office_set_leader(uuid,uuid)'] loop
    assert has_function_privilege('authenticated', fn, 'execute') and not has_function_privilege('anon', fn, 'execute'), 'A1 ' || fn;
  end loop;
  foreach fn in array array['tl_actor()', 'tl_crew_owner()', 'tl_leader_owner()', 'tl_i_lead(uuid)', 'tl_as_leader(text,uuid,jsonb)',
      'tl_leader_sees_line(uuid,uuid)', 'tl_phone_tool_json(uuid)', 'tl_person_records(uuid,uuid)'] loop
    assert not has_function_privilege('authenticated', fn, 'execute') and not has_function_privilege('anon', fn, 'execute'), 'A2 ' || fn;
  end loop;
  assert (select count(*) from pg_policies where tablename in ('tl_problems', 'wk_role_events', 'wk_password_events')) = 0, 'A3 no table policy';

  -- B
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  assert (wk_me() ->> 'is_main_owner')::boolean, 'B1 the main owner';
  begin
    update profiles set role = 'teamLeader' where id = v_w5;
    assert false, 'B2 a direct role change must stay refused';
  exception when others then
    assert sqlerrm = 'role may only be changed between client and partner', 'B2 got ' || sqlerrm;
  end;
  r := wk_set_team_leader(v_w5, true);
  assert (r ->> 'changed')::boolean and (select role from profiles where id = v_w5) = 'teamLeader', 'B3 the switch';
  assert jsonb_array_length(wk_worker_log(v_w5)) >= 1, 'B4 logged';
  assert (select role from profiles where id = v_w7) = 'worker', 'B5 nobody else';

  r := pr_office_save_team(null, 'ZZ 3b acceptance team', true);
  v_team := (r ->> 'id')::uuid;
  perform pr_office_add_member(v_team, v_w5);
  perform pr_office_add_member(v_team, v_w7);
  perform pr_office_set_leader(v_team, v_w5);
  insert into folders (owner_id, name) values (v_owner, 'ZZ 3b acceptance project') returning id into v_folder;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'tool', 'ZZ 3b acceptance tool', '', 'pc', 'tools') returning id into v_item;
  r := tl_register(gen_random_uuid(), jsonb_build_object('item_id', v_item, 'condition', 'good', 'at', 'warehouse',
         'photo_path', 'tools/' || v_owner || '/2026-11/' || gen_random_uuid() || '.jpg'));
  v_tool := (r -> 'tools' -> 0 ->> 'tool_id')::uuid;
  v_number := (select number from tl_tools where id = v_tool);

  -- C
  perform set_config('request.jwt.claims', json_build_object('sub', v_w5, 'role', 'authenticated')::text, true);
  r := tl_team_find(v_number::text);
  assert (r ->> 'id')::uuid = v_tool and not r ? 'holder_name' and not r ? 'records', 'C1 finds it, with no custody or history';
  assert (select count(*) from jsonb_array_elements(tl_team_choices() -> 'members') m where (m ->> 'id')::uuid = v_w7) = 1, 'C2 their member';
  if v_outside is not null then
    begin
      perform tl_team_issue(gen_random_uuid(), jsonb_build_object('tool_id', v_tool, 'holder_id', v_outside, 'folder_id', v_folder));
      assert false, 'C3 someone outside the team';
    exception when others then
      assert sqlerrm = 'NOT_YOUR_TEAM', 'C3 got ' || sqlerrm;
    end;
  end if;
  r := tl_team_issue(gen_random_uuid(), jsonb_build_object('tool_id', v_tool, 'holder_id', v_w7, 'folder_id', v_folder, 'photo_path', 'ignored'));
  v_rec := (r ->> 'record_id')::uuid;
  assert (select recorded_by from tl_records where id = v_rec) = v_w5 and (select photo_path from tl_records where id = v_rec) is null, 'C4 theirs, no photo';
  assert jsonb_array_length(tl_team_tools()) = 1, 'C5 they see it';
  begin
    perform tl_team_find(v_number::text);
    assert false, 'C6 an issued tool';
  exception when others then
    assert sqlerrm = 'TOOL_NOT_AVAILABLE', 'C6 got ' || sqlerrm;
  end;

  -- D
  perform set_config('request.jwt.claims', json_build_object('sub', v_w7, 'role', 'authenticated')::text, true);
  r := tl_my_tools() -> 0;
  assert (r ->> 'id')::uuid = v_tool, 'D1 their tool';
  assert not (tl_my_tools()::text ~* 'amount|price|purchase|photo'), 'D2 no money, purchase or photo';
  r := tl_report_problem(gen_random_uuid(), v_tool, 'broken', 'ZZ');
  v_problem := (r ->> 'problem_id')::uuid;
  assert (select state from tl_tools where id = v_tool) = 'issued', 'D3 changes no tool';
  begin
    perform tl_team_tools();
    assert false, 'D4 a plain worker';
  exception when others then
    assert sqlerrm = 'NOT_LEADER', 'D4 got ' || sqlerrm;
  end;
  v_must := coalesce((select e.kind = 'temporary_set' from wk_password_events e
                       where e.worker_id = v_w7 and e.kind in ('temporary_set', 'changed') order by e.id desc limit 1), false);
  assert (wk_password_state() ->> 'must_change')::boolean = v_must, 'D5 the state follows the records';
  assert (wk_password_changed() ->> 'recorded')::boolean = v_must, 'D6 recorded only if a change was owed';
  assert not (wk_password_state() ->> 'must_change')::boolean, 'D6b nothing owed afterwards';
  perform set_config('request.jwt.claims', json_build_object('sub', v_w5, 'role', 'authenticated')::text, true);
  assert not (wk_password_state() ->> 'must_change')::boolean, 'D6c never reset';
  assert not (wk_password_changed() ->> 'recorded')::boolean, 'D6d nothing to record';

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  assert (select count(*) from jsonb_array_elements(tl_problems(true)) p where (p ->> 'id')::uuid = v_problem) = 1, 'D7 the office sees it';
  perform tl_close_problem(gen_random_uuid(), v_problem, 'ZZ closed');
  assert (select count(*) from jsonb_array_elements(tl_problems(true)) p where (p ->> 'id')::uuid = v_problem) = 0, 'D8 closed';

  -- E
  begin
    perform wk_set_team_leader(v_w5, false);
    assert false, 'E1 a leader of an active team';
  exception when others then
    assert sqlerrm = 'LEADS_A_TEAM', 'E1 got ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_w5, 'role', 'authenticated')::text, true);
  perform tl_team_reverse(gen_random_uuid(), v_rec, 'ZZ wrong person');
  assert (select state from tl_tools where id = v_tool) = 'available', 'E2 reversed';
  update profiles set status = 'inactive' where id = v_w5 and false;

  perform set_config('request.jwt.claims', '', true);
  update profiles set status = 'inactive' where id = v_w5;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  assert (select m ->> 'leader_problem' from jsonb_array_elements(pr_office_teams()) t, jsonb_array_elements(t -> 'members') m
           where (t ->> 'id')::uuid = v_team and (m ->> 'worker_id')::uuid = v_w5) = 'inactive', 'E3 an invalid leader reads as such';
  perform pr_office_save_team(v_team, 'ZZ 3b acceptance team', false);
  perform pr_office_set_leader(v_team, null);
  assert not exists (select 1 from pr_team_members where team_id = v_team and is_leader), 'E4 a mark cleared on a turned-off team';

  -- F
  perform set_config('request.jwt.claims', '', true);
  assert (select count(*) from expenses) + (select count(*) from payroll) = v_money_before, 'F1 no money row';
  assert (select count(*) from attendance_records) = v_attendance_before, 'F2 no attendance row';
end $$;

select '3b-a acceptance: all checks passed' as result;
rollback;
