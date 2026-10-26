-- ════════════════════════════════════════════════════════════════════
-- Stage 2C acceptance — migration 0105 (live behaviour, stock cost moves).
--
-- Self-wrapped in begin / rollback: nothing persists — not the stock switch,
-- the ZZ projects, item, purchase, stock records, cost moves or their
-- expense rows. Editor-safe (set_config 'v2c.*', no temp objects). Needs one
-- active main owner allowed Expenses, an active staff account of theirs
-- allowed Expenses, and an active worker. Run it through MCP execute_sql.
-- Success ends with the row '2c acceptance: all checks passed'.
--   A. stock is off live; the main owner switches it on (rolled back)
--   B. company stock issued to project A: assignment pending, no Spent;
--      staff see the state, never a value; only the main owner approves
--   C. A → B (transfer) and A → warehouse (back): rows on both sides
--   D. reversals: COST_MOVED, newest first; the price is fixed while valued;
--      and where a purchase's cost sits (its billing periods, Cover) too
--   E. a warehouse loss: company stock loss, no expense row
--   F. guards: cost rows untouchable, projects with stock undeletable;
--      a worker sees nothing; helpers internal
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_a uuid; v_b uuid; v_c uuid; v_pa uuid; v_pb uuid; v_pc uuid; v_item uuid; v_sand uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  select p.id, s.id into v_owner, v_staff
    from profiles p join profiles s on s.owner_id = p.id and s.role = 'staff' and coalesce(s.status, 'active') = 'active'
         and (jsonb_typeof(s.allowed_modules) is distinct from 'array' or jsonb_array_length(s.allowed_modules) = 0
              or s.allowed_modules ? 'expenses')
   where p.role = 'owner' and p.owner_id is null and coalesce(p.status, 'active') = 'active'
     and (jsonb_typeof(p.allowed_modules) is distinct from 'array' or jsonb_array_length(p.allowed_modules) = 0
          or p.allowed_modules ? 'expenses')
   order by p.created_at, s.created_at limit 1;
  select w.id into v_worker from profiles w
   where w.owner_id = v_owner and w.role in ('worker', 'teamLeader') and coalesce(w.status, 'active') = 'active'
   order by w.created_at limit 1;
  assert v_owner is not null and v_staff is not null and v_worker is not null,
    'need an active main owner with an active staff account allowed Expenses and an active worker';
  assert not coalesce((select enabled from stk_settings where owner_id = v_owner), false), 'stock must still be off live';
  assert (select count(*) from stk_cost_moves) = 0, 'no cost move exists live yet';
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2c A') returning id into v_a;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2c B') returning id into v_b;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_a, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1) returning id into v_pa;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_b, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1) returning id into v_pb;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_pa, v_owner, 100000), (v_pb, v_owner, 100000);
  -- C: a ₱600 billing period, so a ₱1,000 purchase is ₱600 there and ₱400 Cover (D6–D8).
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2c C') returning id into v_c;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_c, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1) returning id into v_pc;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_pc, v_owner, 600);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, created_by)
  values (v_owner, 'material', 'ZZ 2c sand', 'acceptance', 'bag', v_owner) returning id into v_sand;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, created_by)
  values (v_owner, 'material', 'ZZ 2c cement', 'acceptance', 'bag', v_owner) returning id into v_item;
  perform set_config('v2c.owner', v_owner::text, true);
  perform set_config('v2c.staff', v_staff::text, true);
  perform set_config('v2c.worker', v_worker::text, true);
  perform set_config('v2c.a', v_a::text, true);
  perform set_config('v2c.b', v_b::text, true);
  perform set_config('v2c.pa', v_pa::text, true);
  perform set_config('v2c.pb', v_pb::text, true);
  perform set_config('v2c.c', v_c::text, true);
  perform set_config('v2c.pc', v_pc::text, true);
  perform set_config('v2c.sand', v_sand::text, true);
  perform set_config('v2c.item', v_item::text, true);
  perform set_config('v2c.today', v_today::text, true);
  perform set_config('v2c.expenses', (select count(*)::text || ':' || coalesce(sum(amount), 0)::text from expenses), true);
end $$;

-- ═══ A. Off live; the main owner switches it on and buys ₱1,000 + ₱30 delivery of 10 bags ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  assert stk_cost_pending() = '[]'::jsonb, 'A1 stock off: nothing to approve';
  perform stk_set_enabled(true);
  perform pur_set_buyer(current_setting('v2c.staff')::uuid, true);
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2c.today'),
         'supplier', 'ZZ 2c supplier', 'receipt_total', '1030', 'notes', 'ZZ 2c',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 2c cement', 'unit', 'bag',
                                                       'quantity', '10', 'amount', '1000', 'category', 'Materials',
                                                       'unplanned_reason', 'ZZ 2c acceptance')),
         'charges', jsonb_build_array(jsonb_build_object('kind', 'delivery_fee', 'amount', '30'))));
  perform set_config('v2c.purchase', r ->> 'purchase_id', true);
  perform stk_match(gen_random_uuid(), (r ->> 'purchase_id')::uuid, 1, current_setting('v2c.item')::uuid, '10', null);
  perform stk_receive(gen_random_uuid(), (r ->> 'purchase_id')::uuid, 1, '10', current_setting('v2c.today'), 'ZZ 2c');
  assert (select jsonb_agg(jsonb_build_array(x ->> 'name', (x -> 'in_warehouse' ->> 'value')::numeric)) from jsonb_array_elements(stk_company_stock()) x
           where x ->> 'item_id' = current_setting('v2c.item')) = '[["ZZ 2c cement", 1030]]'::jsonb, 'A2 company stock ₱1,030';
end $$;

-- ═══ B. Issued to A: assignment pending ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.staff'), 'role', 'authenticated')::text, true);
do $$
declare i jsonb; t text;
begin
  i := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.item'), 'from', 'warehouse',
         'to', current_setting('v2c.a'), 'quantity', '4', 'on', current_setting('v2c.today'), 'unplanned_reason', 'ZZ 2c'));
  assert jsonb_array_length(i -> 'cost_moves') = 1, 'B1 one cost request';
  perform set_config('v2c.issue', i ->> 'record_id', true);
  perform set_config('v2c.assign', i -> 'cost_moves' ->> 0, true);
  t := stk_item(current_setting('v2c.item')::uuid)::text;
  assert t like '%"kind": "assign"%' and t like '%"status": "pending"%', 'B2 staff see "Cost assignment pending"';
  assert t not like '%"value"%' and t not like '%"estimate"%', 'B3 staff never see a value';
  begin
    perform stk_cost_decide(gen_random_uuid(), current_setting('v2c.assign')::uuid, true, 'x');
    raise exception 'B4 staff approved a cost move';
  exception when others then assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'B4 wrong error: ' || sqlerrm;
  end;
end $$;
reset role;
do $$
begin
  assert (select count(*) from expenses e left join projects p on p.id = e.project_id
           where coalesce(e.folder_id, p.folder_id) = current_setting('v2c.a')::uuid) = 0, 'B5 pending: no Spent on A';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
declare c jsonb; r jsonb;
begin
  select x into c from jsonb_array_elements(stk_cost_pending()) x where x ->> 'id' = current_setting('v2c.assign');
  assert (c ->> 'estimate')::numeric = 412 and (c ->> 'effective')::numeric = 4, 'B6 the card: 4 bags, ₱412';
  r := stk_cost_decide(gen_random_uuid(), current_setting('v2c.assign')::uuid, true, 'ZZ 2c');
  assert (r ->> 'value')::numeric = 412, 'B7 approved ₱412 (₱1,030 × 4/10)';
end $$;
reset role;
do $$
begin
  assert (select jsonb_agg(jsonb_build_array(expense_name, amount, cover_expense, project_id::text)) from expenses
           where stk_cost_move_id = current_setting('v2c.assign')::uuid)
         = jsonb_build_array(jsonb_build_array('From warehouse — ZZ 2c cement', 412, false, current_setting('v2c.pa'))), 'B8 one row on A''s period';
end $$;

-- ═══ C. A → B and A → warehouse ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.staff'), 'role', 'authenticated')::text, true);
do $$
declare m jsonb; w jsonb;
begin
  m := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.item'), 'from', current_setting('v2c.a'),
         'to', current_setting('v2c.b'), 'quantity', '3', 'on', current_setting('v2c.today'), 'unplanned_reason', 'ZZ 2c'));
  w := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.item'), 'from', current_setting('v2c.a'),
         'to', 'warehouse', 'quantity', '1', 'on', current_setting('v2c.today')));
  perform set_config('v2c.move', m ->> 'record_id', true);
  perform set_config('v2c.transfer', m -> 'cost_moves' ->> 0, true);
  perform set_config('v2c.back', w -> 'cost_moves' ->> 0, true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (stk_cost_decide(gen_random_uuid(), current_setting('v2c.transfer')::uuid, true, 'ZZ') ->> 'value')::numeric = 309, 'C1 transfer ₱309';
  assert (stk_cost_decide(gen_random_uuid(), current_setting('v2c.back')::uuid, true, 'ZZ') ->> 'value')::numeric = 103, 'C2 back ₱103 (the rest)';
end $$;
reset role;
do $$
declare v_a numeric; v_b numeric; v_c numeric;
begin
  select coalesce(sum(e.amount), 0) into v_a from expenses e left join projects p on p.id = e.project_id
   where coalesce(e.folder_id, p.folder_id) = current_setting('v2c.a')::uuid;
  select coalesce(sum(e.amount), 0) into v_b from expenses e left join projects p on p.id = e.project_id
   where coalesce(e.folder_id, p.folder_id) = current_setting('v2c.b')::uuid;
  select h.value into v_c from stk_lots lt, stk_held(lt.id, null) h where lt.purchase_id = current_setting('v2c.purchase')::uuid;
  assert (v_a, v_b, v_c) = (0::numeric, 309::numeric, 721::numeric), 'C3 A ₱0, B ₱309, company ₱721 — got ' || v_a || ', ' || v_b || ', ' || v_c;
  assert v_a + v_b + v_c = 1030, 'C4 every peso in one place';
  assert (select array_agg(expense_name order by amount) from expenses e join projects p on p.id = e.project_id
           where e.stk_cost_move_id is not null and p.folder_id = current_setting('v2c.a')::uuid)
         = array['Moved to ZZ 2c B — ZZ 2c cement', 'Back to company stock — ZZ 2c cement', 'From warehouse — ZZ 2c cement'], 'C5 A''s labels';
end $$;

-- ═══ D. Reversals and the price ═══
set local role authenticated;
do $$
begin
  begin
    perform stk_reverse(gen_random_uuid(), current_setting('v2c.move')::uuid, 'ZZ');
    raise exception 'D1 reversed a movement whose cost moved';
  exception when others then assert sqlerrm like '%COST_MOVED%', 'D1 wrong error: ' || sqlerrm;
  end;
  begin
    perform stk_cost_reverse(gen_random_uuid(), current_setting('v2c.assign')::uuid, 'ZZ');
    raise exception 'D2 reversed the assignment under later moves';
  exception when others then assert sqlerrm like '%LATER_MOVES_FIRST%', 'D2 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_correct(gen_random_uuid(), current_setting('v2c.purchase')::uuid, jsonb_build_object('source', 'purchasing',
      'purchase_date', current_setting('v2c.today'), 'supplier', 'ZZ 2c supplier', 'receipt_total', '1130', 'notes', 'ZZ 2c',
      'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 2c cement', 'unit', 'bag',
                                                    'quantity', '10', 'amount', '1100', 'category', 'Materials', 'unplanned_reason', 'ZZ 2c')),
      'charges', jsonb_build_array(jsonb_build_object('kind', 'delivery_fee', 'amount', '30'))), 'ZZ price');
    raise exception 'D3 the price changed under approved cost moves';
  exception when others then assert sqlerrm like '%STOCK_COST_IN_USE%', 'D3 wrong error: ' || sqlerrm;
  end;
  perform stk_cost_reverse(gen_random_uuid(), current_setting('v2c.transfer')::uuid, 'ZZ wrong project');
end $$;
reset role;
do $$
begin
  assert (select count(*) from expenses where stk_cost_move_id = current_setting('v2c.transfer')::uuid) = 0, 'D4 its rows are gone';
  assert (select reverse_reason from stk_cost_moves where id = current_setting('v2c.transfer')::uuid) = 'ZZ wrong project', 'D5 the record stays';
end $$;

-- ═══ D6–D8. Where a purchase's cost sits is fixed too (R81, rev 2) ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2c.today'),
         'supplier', 'ZZ 2c supplier', 'receipt_total', '1000', 'notes', 'ZZ 2c',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'project', 'folder_id', current_setting('v2c.c'), 'item_name', 'ZZ 2c sand',
                                                       'unit', 'bag', 'quantity', '10', 'amount', '1000', 'category', 'Materials',
                                                       'unplanned_reason', 'ZZ 2c acceptance'))));
  perform set_config('v2c.sandbuy', r ->> 'purchase_id', true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.staff'), 'role', 'authenticated')::text, true);
do $$
declare m jsonb;
begin
  perform stk_match(gen_random_uuid(), current_setting('v2c.sandbuy')::uuid, 1, current_setting('v2c.sand')::uuid, '10', null);
  perform stk_leftover(gen_random_uuid(), current_setting('v2c.sandbuy')::uuid, 1, '5', 'warehouse', current_setting('v2c.today'), 'ZZ 2c');
  m := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.sand'), 'from', 'warehouse',
         'to', current_setting('v2c.b'), 'quantity', '2', 'on', current_setting('v2c.today'), 'unplanned_reason', 'ZZ 2c'));
  perform set_config('v2c.sandmove', m -> 'cost_moves' ->> 0, true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (stk_cost_decide(gen_random_uuid(), current_setting('v2c.sandmove')::uuid, true, 'ZZ') ->> 'value')::numeric = 200, 'D6 transfer ₱200';
end $$;
reset role;
do $$
begin
  assert (select jsonb_agg(jsonb_build_array(e.cover_expense, e.amount) order by e.cover_expense)
            from (select cover_expense, sum(amount) amount from expenses e join projects p on p.id = e.project_id
                   where p.folder_id = current_setting('v2c.c')::uuid group by 1) e)
         = '[[false, 480], [true, 320]]'::jsonb, 'D7 C: ₱600 − ₱120 on its period, ₱400 − ₱80 Cover';
  -- A second billing period this month would take the Cover part.
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (current_setting('v2c.owner')::uuid, current_setting('v2c.c')::uuid, to_char(current_setting('v2c.today')::date, 'FMMonth'),
          extract(year from current_setting('v2c.today')::date)::int, 'progress', 2);
  insert into project_budgets (project_id, owner_id, monthly_budget)
  select id, owner_id, 1000 from projects where folder_id = current_setting('v2c.c')::uuid and billing_number = 2;
end $$;
set local role authenticated;
do $$
begin
  begin
    perform pur_refund(gen_random_uuid(), current_setting('v2c.sandbuy')::uuid, 'ZZ billing periods re-checked');
    raise exception 'D8 a re-fund moved rows under an approved cost move';
  exception when others then assert sqlerrm like '%STOCK_COST_FUNDING%', 'D8 wrong error: ' || sqlerrm;
  end;
end $$;
reset role;
do $$
begin
  assert (select sum(amount) from expenses e join projects p on p.id = e.project_id
           where p.folder_id = current_setting('v2c.c')::uuid and e.cover_expense) = 320, 'D8 nothing moved';
  perform set_config('v2c.rows', (select count(*)::text from expenses), true);
end $$;

-- ═══ E. A warehouse loss of company goods ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.staff'), 'role', 'authenticated')::text, true);
do $$
declare c jsonb;
begin
  c := stk_count(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2c.item'), 'at', 'warehouse', 'counted', '5',
         'reason', 'damaged', 'on', current_setting('v2c.today')));
  perform set_config('v2c.count', c ->> 'record_id', true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  perform stk_decide(gen_random_uuid(), current_setting('v2c.count')::uuid, true, 'ZZ');
  assert (select (x -> 'loss' ->> 'value')::numeric from jsonb_array_elements(stk_company_stock()) x
           where x ->> 'item_id' = current_setting('v2c.item')) = 206, 'E1 company stock loss ₱206 (2 bags)';
end $$;

-- ═══ F. Guards; a worker; internals ═══
reset role;
do $$
begin
  assert (select count(*)::text from expenses) = current_setting('v2c.rows'), 'E2 a loss writes no expense row';
  begin
    update expenses set amount = 1 where stk_cost_move_id = current_setting('v2c.assign')::uuid;
    raise exception 'F1 a cost row was edited';
  exception when others then assert sqlerrm like '%STOCK_COST_ROW%', 'F1 wrong error: ' || sqlerrm;
  end;
  begin
    delete from folders where id = current_setting('v2c.a')::uuid;
    raise exception 'F2 a project with stock was deleted';
  exception when others then assert sqlerrm like '%STOCK_LIVE%', 'F2 wrong error: ' || sqlerrm;
  end;
  assert not has_function_privilege('anon', 'stk_cost_decide(uuid,uuid,boolean,text)', 'execute'), 'F3 anon cannot decide';
  assert not has_function_privilege('authenticated', 'stk_cost_rows(uuid)', 'execute'), 'F4 internal';
  assert not has_function_privilege('authenticated', 'stk_held(uuid,uuid)', 'execute'), 'F5 internal';
  assert (select count(*) from pg_policies where tablename = 'stk_cost_moves') = 0, 'F6 no direct table access';
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2c.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform stk_cost_pending();
    raise exception 'F7 a worker read the approvals';
  exception when others then assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'F7 wrong error: ' || sqlerrm;
  end;
  begin
    perform stk_company_stock();
    raise exception 'F8 a worker read company stock';
  exception when others then assert sqlerrm like '%NOT_ALLOWED%', 'F8 wrong error: ' || sqlerrm;
  end;
end $$;
reset role;

select '2c acceptance: all checks passed' as result;
rollback;
