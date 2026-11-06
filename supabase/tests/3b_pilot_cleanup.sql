-- ════════════════════════════════════════════════════════════════════
-- WorkMate 3b-b pilot: remove the "ZZ 3b" test data.
--
-- Run by the USER in the Supabase SQL editor, after the 3b-b pilot (WorkMate
-- 0.10.0+1012, Task 5) on the test phone with the test accounts W-0005 and
-- W-0007. One transaction. Any failed guard stops it and changes NOTHING.
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It does everything, prints what it
--            removed in a red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- THE CLEAN-UP, IN THIS ORDER:
--   1. This script (dry run, then the real run). Inside it:
--        a. the ZZ tools and everything recorded on them;
--        b. the ZZ team: W-0005's leadership and both memberships are ended
--           first (as the office's "remove member" does), it checks that
--           W-0005 now leads no active team, and then the team is REMOVED
--           (its membership rows and the team row), not kept switched off;
--        c. the ZZ catalogue item; d. the ZZ project.
--   2. Then, on the web, the main owner turns W-0005's Team Leader switch
--      off. The server refuses that (LEADS_A_TEAM) while W-0005 still leads
--      an active team, so it cannot come before step 1. The switch writes
--      its own row in the role log.
--   3. Then delete, BY NAME, the photo file(s) this script lists (Storage →
--      uploads → tools/…). Never delete a folder.
--
-- What is "ZZ" (and nothing else is touched):
--   projects — every folder whose name starts "ZZ 3b pilot" (with their
--              billing periods and budgets: the folder cascade);
--   item     — every catalogue item whose name starts "ZZ 3b";
--   team     — every team whose name starts "ZZ 3b". Its members may only
--              ever have been W-0005 and W-0007;
--   tools    — every tool of a "ZZ …" catalogue item, with its records,
--              history and problem reports. No tool existed before the
--              pilot. An older "ZZ …" item that is not "ZZ 3b…" is kept.
-- KEPT, never touched: the password log (wk_password_events) and the role
-- log (wk_role_events) — every pilot row in them stays as history, and
-- their guards stay on; W-0005's and W-0007's accounts, roles and
-- passwords; W-0007's real team; attendance; operation ids (pur_ops); real
-- projects, items, teams, tools, purchases, requests, stock and expenses;
-- the tools switch. The tools history guards are off for this transaction
-- only, and checked back on before it ends. Tool numbers go with their
-- rows, so the first real tool is TOOL-0001.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_dry boolean := true;
  v_owner uuid; v_w5 uuid; v_w7 uuid;
  zf uuid[]; zper uuid[]; zloc uuid[]; zi uuid[]; zany uuid[]; zteam uuid[]; zt uuid[]; ztr uuid[];
  v_photos text;
  real_tools bigint; real_recs bigint; real_probs bigint; real_events bigint; real_teams bigint; real_members text;
  real_folders bigint; real_items bigint; real_exp_n bigint; real_exp_sum numeric; real_pur bigint; real_req bigint; real_stk bigint;
  pw_n bigint; pw_last bigint; role_n bigint; role_last bigint; people text; att_n bigint;
  n int; msg text := '';
begin
  perform set_config('lock_timeout', '5s', true);

  -- ---------- what is ZZ ----------
  select coalesce(array_agg(id), '{}') into zf from folders where name like 'ZZ 3b pilot%';
  select coalesce(array_agg(id), '{}') into zi from pr_catalog_items where name like 'ZZ 3b%';
  select coalesce(array_agg(id), '{}') into zteam from pr_teams where name like 'ZZ 3b%';
  select coalesce(array_agg(id), '{}') into zany from pr_catalog_items where name like 'ZZ %';
  select coalesce(array_agg(id), '{}') into zt from tl_tools where item_id = any(zany);
  select coalesce(array_agg(id), '{}') into ztr from tl_records where tool_id = any(zt);
  if cardinality(zf) + cardinality(zi) + cardinality(zteam) + cardinality(zt) = 0 then
    raise exception 'GUARD: no "ZZ 3b…" project, item, team or tool — nothing to clean';
  end if;
  select min(o::text)::uuid, count(distinct o) into v_owner, n from (
    select owner_id o from folders where id = any(zf) union all select owner_id from pr_catalog_items where id = any(zi)
    union all select owner_id from pr_teams where id = any(zteam) union all select owner_id from tl_tools where id = any(zt)) x;
  if n <> 1 then
    raise exception 'GUARD: the ZZ rows belong to more than one company — stop and check';
  end if;
  select id into v_w5 from profiles where worker_no = 5 and owner_id = v_owner;
  select id into v_w7 from profiles where worker_no = 7 and owner_id = v_owner;
  if v_w5 is null or v_w7 is null then
    raise exception 'GUARD: W-0005 or W-0007 is not an account of this company';
  end if;

  -- The team: only ever W-0005 and W-0007, and nothing names it.
  if exists (select 1 from pr_team_members where team_id = any(zteam) and worker_id not in (v_w5, v_w7)) then
    raise exception 'GUARD: someone other than W-0005 and W-0007 was in a ZZ team — stop and check';
  end if;
  if exists (select 1 from pr_requests where team_id = any(zteam))
     or exists (select 1 from wp_tasks where team_id = any(zteam)) then
    raise exception 'GUARD: a request or a Work Plan task names a ZZ team — stop and check';
  end if;
  if exists (select 1 from pr_team_members m join pr_teams t on t.id = m.team_id
              where m.worker_id = v_w5 and m.is_leader and m.removed_at is null and t.active and not t.id = any(zteam)) then
    raise exception 'GUARD: W-0005 leads a real team — the Team Leader switch could not be turned off; stop and check';
  end if;

  -- The project: ZZ jobs only, and nothing but tools was recorded there.
  if exists (select 1 from folders f where f.parent_folder_id = any(zf) and not f.id = any(zf)) then
    raise exception 'GUARD: a job under a ZZ project is not named "ZZ 3b pilot…"';
  end if;
  if exists (select 1 from folders f where f.id = any(zf) and f.parent_folder_id is not null and not f.parent_folder_id = any(zf)) then
    raise exception 'GUARD: a "ZZ 3b pilot…" job sits under a real project';
  end if;
  select coalesce(array_agg(id), '{}') into zper from projects where folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zloc from stk_locations where folder_id = any(zf);
  if exists (select 1 from pr_requests where folder_id = any(zf) or work_folder_id = any(zf))
     or exists (select 1 from purchase_lines where folder_id = any(zf))
     or exists (select 1 from stk_records where from_location = any(zloc) or to_location = any(zloc))
     or exists (select 1 from stk_moves where from_location = any(zloc) or to_location = any(zloc))
     or exists (select 1 from stk_cost_moves where location = any(zloc) or from_folder = any(zf) or to_folder = any(zf))
     or exists (select 1 from expenses where folder_id = any(zf) or project_id = any(zper))
     or exists (select 1 from payroll where project_id = any(zper))
     or exists (select 1 from overhead_expenses where folder_id = any(zf) or billing_period_id = any(zper))
     or exists (select 1 from reimbursements where folder_id = any(zf))
     or exists (select 1 from labor_contracts where folder_id = any(zf))
     or exists (select 1 from construction_projects where folder_id = any(zf))
     or exists (select 1 from wp_tasks where folder_id = any(zf) or work_folder_id = any(zf))
     or exists (select 1 from pr_item_refs where folder_id = any(zf) or work_folder_id = any(zf)) then
    raise exception 'GUARD: a request, purchase, stock, expense, payroll, overhead, contract, reimbursement, construction project, Work Plan task or item note is on a ZZ project (the pilot records only tools) — stop and check';
  end if;

  -- The item: tools only (no request, stock, photo or note).
  if exists (select 1 from pr_lines where catalog_item_id = any(zi))
     or exists (select 1 from stk_lots where item_id = any(zi))
     or exists (select 1 from stk_matches where item_id = any(zi))
     or exists (select 1 from stk_records where item_id = any(zi))
     or exists (select 1 from pr_gallery_photos where catalog_item_id = any(zi))
     or exists (select 1 from pr_item_refs where catalog_item_id = any(zi)) then
    raise exception 'GUARD: a ZZ item is on a request, in stock, or has photos or notes (the pilot adds none) — stop and check';
  end if;

  -- The tools: registered without a purchase, recorded on ZZ projects only, never on a request.
  if exists (select 1 from tl_tools where id = any(zt) and purchase_id is not null) then
    raise exception 'GUARD: a ZZ tool came from a purchase (the pilot registers its tool at the warehouse) — stop and check';
  end if;
  if exists (select 1 from tl_records where id = any(ztr) and folder_id is not null and not folder_id = any(zf))
     or exists (select 1 from tl_tools where id = any(zt) and folder_id is not null and not folder_id = any(zf)) then
    raise exception 'GUARD: a ZZ tool was recorded on a real project';
  end if;
  if exists (select 1 from tl_records where not id = any(ztr) and folder_id = any(zf))
     or exists (select 1 from tl_tools where not id = any(zt) and folder_id = any(zf)) then
    raise exception 'GUARD: a real tool was recorded on a ZZ project';
  end if;
  if exists (select 1 from tl_records where id = any(ztr) and request_line_id is not null)
     or exists (select 1 from tl_covers where record_id = any(ztr)) then
    raise exception 'GUARD: a ZZ tool was linked to a request (the pilot links none) — stop and check';
  end if;
  select string_agg(distinct p, ', ' order by p) into v_photos from (
    select photo_path p from tl_tools where id = any(zt) and photo_path is not null
    union select photo_path from tl_records where id = any(ztr) and photo_path is not null) x;

  -- ---------- what must not change ----------
  select count(*) into real_tools from tl_tools where not id = any(zt);
  select count(*) into real_recs from tl_records where not id = any(ztr);
  select count(*) into real_probs from tl_problems where not tool_id = any(zt);
  select count(*) into real_events from tl_events where record_id is null or not record_id = any(ztr);
  select count(*) into real_teams from pr_teams where not id = any(zteam);
  select md5(coalesce(string_agg(concat_ws('|', id, team_id, worker_id, is_leader, added_at, removed_at), ',' order by id), ''))
    into real_members from pr_team_members where not team_id = any(zteam);
  select count(*) into real_folders from folders where not id = any(zf);
  select count(*) into real_items from pr_catalog_items where not id = any(zi);
  select count(*), coalesce(sum(amount), 0) into real_exp_n, real_exp_sum from expenses;
  select count(*) into real_pur from purchases;
  select count(*) into real_req from pr_requests;
  select count(*) into real_stk from stk_records;
  select count(*), coalesce(max(id), 0) into pw_n, pw_last from wk_password_events;
  select count(*), coalesce(max(id), 0) into role_n, role_last from wk_role_events;
  select md5(string_agg(concat_ws('|', id, role, status, owner_id, worker_no), ',' order by id)) into people
    from profiles where id in (v_w5, v_w7);
  select count(*) into att_n from attendance_records;

  -- ---------- a. the tools (their history guards are off for this transaction only) ----------
  execute 'alter table tl_events disable trigger tl_events_no_change';
  execute 'alter table tl_problems disable trigger tl_problems_no_change';
  execute 'alter table tl_records disable trigger tl_records_no_delete';
  execute 'alter table tl_tools disable trigger tl_tools_no_delete';
  delete from tl_events where record_id = any(ztr);
  get diagnostics n = row_count; msg := msg || 'tool events ' || n;
  delete from tl_problems where tool_id = any(zt);
  get diagnostics n = row_count; msg := msg || ', problem reports ' || n;
  delete from tl_records where id = any(ztr);
  get diagnostics n = row_count; msg := msg || ', tool records ' || n;
  delete from tl_tools where id = any(zt);
  get diagnostics n = row_count; msg := msg || ', tools ' || n;
  execute 'alter table tl_events enable trigger tl_events_no_change';
  execute 'alter table tl_problems enable trigger tl_problems_no_change';
  execute 'alter table tl_records enable trigger tl_records_no_delete';
  execute 'alter table tl_tools enable trigger tl_tools_no_delete';

  -- ---------- b. the team: first end W-0005's leadership, then remove the team ----------
  update pr_team_members set is_leader = false, removed_at = now()
   where team_id = any(zteam) and removed_at is null;
  get diagnostics n = row_count; msg := msg || '; team memberships ended ' || n;
  if exists (select 1 from pr_team_members m join pr_teams t on t.id = m.team_id
              where m.worker_id = v_w5 and m.is_leader and m.removed_at is null and t.active) then
    raise exception 'GUARD: W-0005 still leads an active team';
  end if;
  delete from pr_team_members where team_id = any(zteam);
  get diagnostics n = row_count; msg := msg || ', membership rows removed ' || n;
  delete from pr_teams where id = any(zteam);
  get diagnostics n = row_count; msg := msg || ', teams removed ' || n;

  -- ---------- c. the item; d. the project ----------
  delete from pr_catalog_items where id = any(zi);
  get diagnostics n = row_count; msg := msg || '; catalogue items ' || n;
  delete from stk_locations where id = any(zloc);
  delete from folders where id = any(zf) and parent_folder_id is not null;
  delete from folders where id = any(zf);
  msg := msg || ', projects ' || cardinality(zf) || ' (with ' || cardinality(zper) || ' billing periods)';

  -- ---------- after: nothing ZZ 3b left, nothing real changed, the logs kept, guards on ----------
  if exists (select 1 from folders where name like 'ZZ 3b pilot%')
     or exists (select 1 from pr_catalog_items where name like 'ZZ 3b%')
     or exists (select 1 from pr_teams where name like 'ZZ 3b%')
     or exists (select 1 from tl_tools t join pr_catalog_items c on c.id = t.item_id where c.name like 'ZZ %') then
    raise exception 'GUARD: a ZZ row is still there';
  end if;
  if (select count(*) from tl_tools) <> real_tools or (select count(*) from tl_records) <> real_recs
     or (select count(*) from tl_problems) <> real_probs or (select count(*) from tl_events) <> real_events then
    raise exception 'GUARD: real tools changed';
  end if;
  if (select count(*) from pr_teams) <> real_teams
     or (select md5(coalesce(string_agg(concat_ws('|', id, team_id, worker_id, is_leader, added_at, removed_at), ',' order by id), ''))
           from pr_team_members) <> real_members then
    raise exception 'GUARD: a real team or membership changed';
  end if;
  if (select count(*) from folders) <> real_folders or (select count(*) from pr_catalog_items) <> real_items
     or (select count(*) from expenses) <> real_exp_n or (select coalesce(sum(amount), 0) from expenses) <> real_exp_sum
     or (select count(*) from purchases) <> real_pur or (select count(*) from pr_requests) <> real_req
     or (select count(*) from stk_records) <> real_stk then
    raise exception 'GUARD: real projects, items, expenses, purchases, requests or stock changed';
  end if;
  if (select count(*) from wk_password_events) <> pw_n or (select coalesce(max(id), 0) from wk_password_events) <> pw_last
     or (select count(*) from wk_role_events) <> role_n or (select coalesce(max(id), 0) from wk_role_events) <> role_last then
    raise exception 'GUARD: the password or role log changed';
  end if;
  if (select md5(string_agg(concat_ws('|', id, role, status, owner_id, worker_no), ',' order by id)) from profiles where id in (v_w5, v_w7)) <> people
     or (select count(*) from attendance_records) <> att_n then
    raise exception 'GUARD: W-0005, W-0007 or attendance changed';
  end if;
  if (select count(*) from pg_trigger where tgname in ('tl_events_no_change', 'tl_problems_no_change', 'tl_records_no_delete',
        'tl_tools_no_delete', 'tl_covers_no_change', 'wk_password_events_no_change', 'wk_role_events_no_change')
        and tgenabled = 'O') <> 7 then
    raise exception 'GUARD: a history guard is not on';
  end if;
  msg := msg || '. W-0005 now leads no active team. Kept: password log ' || pw_n || ' rows, role log ' || role_n
         || ' rows, ' || real_tools || ' real tools, ' || real_teams || ' real teams and their members, attendance '
         || att_n || ' rows — unchanged; history guards on. Photo files to delete by name: ' || coalesce(v_photos, 'none') || '.';

  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): would remove %', msg;
  end if;
  raise notice 'CLEAN-UP DONE: removed %', msg;
end $$;

-- Next (step 2): on the web, the main owner turns W-0005's Team Leader switch
-- off. Then (step 3) delete the listed photo files by name; Supabase does not
-- delete Storage files from SQL.
