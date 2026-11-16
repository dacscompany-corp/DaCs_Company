-- ════════════════════════════════════════════════════════════════════
-- Stage 2B-a acceptance — migration 0104 (live behaviour, stock).
--
-- Self-wrapped in begin / rollback: nothing persists — not the stock switch,
-- the ZZ project, item, purchases, stock records or the Buyer switch.
-- Editor-safe (set_config 'v2b.*', no temp objects). Needs one active main
-- owner allowed Expenses, an active staff account of theirs allowed Expenses,
-- and an active worker. Run it through MCP execute_sql. Success ends with the
-- row '2b acceptance: all checks passed'.
--   A. stock is off: everyone is refused; the main owner switches it on
--   B. a warehouse purchase: matched, received in part, awaiting the rest;
--      the item's unit is then fixed (stock uses it)
--   C. issue, return, count (main owner confirms), reverse — balances right;
--      the oldest RECEIVED delivery goes first
--   D. purchases with stock: void refused; the old tick refused once on
--   E. a worker sees nothing; helpers stay internal; no peso written
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_folder uuid; v_item uuid;
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
  assert not coalesce((select enabled from stk_settings where owner_id = v_owner), false), 'stock must still be off live (2B-a is dormant)';
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2b acceptance') returning id into v_folder;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, created_by)
  values (v_owner, 'material', 'ZZ 2b cement', 'acceptance', 'bag', v_owner) returning id into v_item;
  perform set_config('v2b.owner', v_owner::text, true);
  perform set_config('v2b.staff', v_staff::text, true);
  perform set_config('v2b.worker', v_worker::text, true);
  perform set_config('v2b.folder', v_folder::text, true);
  perform set_config('v2b.item', v_item::text, true);
  perform set_config('v2b.today', v_today::text, true);
  perform set_config('v2b.yesterday', (v_today - 1)::text, true);
  perform set_config('v2b.expenses', (select count(*)::text from expenses), true);
end $$;

-- ═══ A. Off until the main owner switches it on ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (stk_status() ->> 'enabled')::boolean = false and (stk_status() ->> 'can_record')::boolean, 'A1 staff: may record, but stock is off';
  begin
    perform stk_overview();
    raise exception 'A2 a read worked while off';
  exception when others then assert sqlerrm like '%STOCK_OFF%', 'A2 wrong error: ' || sqlerrm;
  end;
  begin
    perform stk_set_enabled(true);
    raise exception 'A3 staff switched stock on';
  exception when others then assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'A3 wrong error: ' || sqlerrm;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  perform pur_set_buyer(current_setting('v2b.staff')::uuid, true);
  perform stk_set_enabled(true);
  assert (stk_status() ->> 'enabled')::boolean and (stk_status() ->> 'is_main_owner')::boolean, 'A4 on, for the main owner';
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2b.today'),
         'supplier', 'ZZ 2b supplier', 'receipt_total', '1000', 'notes', 'ZZ 2b',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 2b cement', 'unit', 'bag',
                                                       'quantity', '10', 'amount', '1000', 'category', 'Materials',
                                                       'unplanned_reason', 'ZZ 2b acceptance'))));
  perform set_config('v2b.purchase', r ->> 'purchase_id', true);
end $$;

-- ═══ B. Matched, received in part ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.staff'), 'role', 'authenticated')::text, true);
do $$
declare ov jsonb; l jsonb;
begin
  ov := stk_overview();
  select x into l from jsonb_array_elements(ov -> 'awaiting') x where x ->> 'purchase_id' = current_setting('v2b.purchase');
  assert l is not null and (l ->> 'awaiting')::numeric = 10 and l -> 'match' = 'null'::jsonb, 'B1 awaiting 10, to match';
  assert l ->> 'suggested_item_id' = current_setting('v2b.item'), 'B2 the one-click suggestion';
  assert not (l ? 'gross_amount') and not (l ? 'amount'), 'B3 no price on the line';
  perform stk_match(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 1, current_setting('v2b.item')::uuid, '10', null);
  perform stk_receive(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 1, '6', current_setting('v2b.yesterday'), 'ZZ 2b');
  select x into l from jsonb_array_elements(stk_overview() -> 'awaiting') x where x ->> 'purchase_id' = current_setting('v2b.purchase');
  assert (l ->> 'received')::numeric = 6 and (l ->> 'awaiting')::numeric = 4, 'B4 received 6, awaiting 4';
  begin
    perform stk_receive(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 1, '5', current_setting('v2b.today'), '');
    raise exception 'B5 received more than awaited';
  exception when others then assert sqlerrm like '%MORE_THAN_AWAITED%', 'B5 wrong error: ' || sqlerrm;
  end;
  begin
    perform pr_office_save_item(current_setting('v2b.item')::uuid, 'material', 'ZZ 2b cement', 'acceptance', 'kg', '', true, null, null);
    raise exception 'B6 the unit of an item stock uses changed';
  exception when others then assert sqlerrm like '%ITEM_IN_USE%', 'B6 wrong error: ' || sqlerrm;
  end;
  assert (select (x ->> 'in_use')::boolean from jsonb_array_elements(pr_office_catalog()) x where x ->> 'id' = current_setting('v2b.item')),
    'B7 the catalogue shows it in use';
end $$;

-- ═══ C. Issue, return, count, reverse ═══
do $$
declare i jsonb; ret jsonb; c jsonb; v_item jsonb;
begin
  i := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2b.item'), 'from', 'warehouse',
         'to', current_setting('v2b.folder'), 'quantity', '4', 'on', current_setting('v2b.today'), 'unplanned_reason', 'ZZ 2b'));
  assert i ->> 'kind' = 'issue', 'C1 an issue';
  ret := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2b.item'), 'returns_record', i ->> 'record_id',
           'quantity', '1', 'on', current_setting('v2b.today')));
  perform set_config('v2b.return', ret ->> 'record_id', true);
  c := stk_count(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2b.item'), 'at', 'warehouse', 'counted', '2',
         'on', current_setting('v2b.today'), 'reason', 'lost'));
  assert c ->> 'status' = 'pending' and (c ->> 'book')::numeric = 3, 'C2 counted 2 of 3: waits for the owner';
  perform set_config('v2b.count', c ->> 'record_id', true);
  begin
    perform stk_decide(gen_random_uuid(), (c ->> 'record_id')::uuid, true, 'x');
    raise exception 'C3 staff confirmed a count';
  exception when others then assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'C3 wrong error: ' || sqlerrm;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  perform stk_decide(gen_random_uuid(), current_setting('v2b.count')::uuid, true, 'ZZ 2b');
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.staff'), 'role', 'authenticated')::text, true);
do $$
declare it jsonb; wh numeric; site numeric;
begin
  perform stk_reverse(gen_random_uuid(), current_setting('v2b.return')::uuid, 'ZZ 2b mistake');
  it := stk_item(current_setting('v2b.item')::uuid);
  select coalesce(sum((p ->> 'quantity')::numeric) filter (where p ->> 'name' = 'Warehouse'), 0),
         coalesce(sum((p ->> 'quantity')::numeric) filter (where p ->> 'name' = 'ZZ 2b acceptance'), 0)
    into wh, site
    from jsonb_array_elements(it -> 'lots') l, jsonb_array_elements(l -> 'places') p;
  assert wh = 1 and site = 4, 'C4 warehouse 1, site 4 (6 in, 4 out, 1 lost; the return reversed) — got ' || wh || ' / ' || site;
  assert (select count(*) from jsonb_array_elements(it -> 'records') r where (r ->> 'reversed')::boolean) = 1, 'C5 the reversed record stays';
end $$;
do $$
declare i jsonb; wh jsonb;
begin
  -- The rest arrives today; yesterday's delivery (1 left) still goes first.
  perform stk_receive(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 1, '4', current_setting('v2b.today'), 'ZZ 2b');
  i := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v2b.item'), 'from', 'warehouse',
         'to', current_setting('v2b.folder'), 'quantity', '2', 'on', current_setting('v2b.today'), 'unplanned_reason', 'ZZ 2b'));
  assert jsonb_array_length(i -> 'lots') = 2, 'C6 the issue drew on two deliveries';
  select jsonb_agg(jsonb_build_array(y ->> 'received_on', (y ->> 'quantity')::numeric)) into wh
    from jsonb_array_elements(stk_item(current_setting('v2b.item')::uuid) -> 'lots') l, jsonb_array_elements(l -> 'layers') y
   where y ->> 'name' = 'Warehouse';
  assert wh = jsonb_build_array(jsonb_build_array(current_setting('v2b.today'), 3)),
    'C7 oldest received first: yesterday''s last bag went, today''s delivery has 3 left — got ' || coalesce(wh::text, 'nothing');
end $$;

-- ═══ D. Purchases with stock ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_void(gen_random_uuid(), current_setting('v2b.purchase')::uuid, 'ZZ 2b');
    raise exception 'D1 voided a purchase with stock records';
  exception when others then assert sqlerrm like '%STOCK_IN_USE%', 'D1 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2b.today'),
      'receipt_total', '10', 'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 2b tick',
      'unit', 'pc', 'quantity', '1', 'amount', '10', 'in_inventory', true, 'unplanned_reason', 'ZZ 2b'))));
    raise exception 'D2 the old tick still writes';
  exception when others then assert sqlerrm like '%STOCK_TICK_RETIRED%', 'D2 wrong error: ' || sqlerrm;
  end;
end $$;

-- ═══ E. A worker sees nothing; helpers internal; no peso ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2b.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not (stk_status() ->> 'enabled')::boolean and not (stk_status() ->> 'can_record')::boolean, 'E1 a worker: no stock';
  begin
    perform stk_overview();
    raise exception 'E2 a worker read stock';
  exception when others then assert sqlerrm like '%NOT_ALLOWED%', 'E2 wrong error: ' || sqlerrm;
  end;
  begin
    perform stk_balance(gen_random_uuid(), gen_random_uuid());
    raise exception 'E3 stk_balance is callable';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  assert not has_function_privilege('anon', 'stk_move(uuid,jsonb)', 'execute'), 'E4 anon cannot move stock';
  assert not has_function_privilege('authenticated', 'pr_portion_bought(uuid)', 'execute'), 'E5 still internal';
  assert (select count(*) from pg_policies where tablename like 'stk\_%') = 0, 'E6 no direct table access';
  assert (select count(*) from expenses)::text = current_setting('v2b.expenses'), 'E7 no stock step wrote an expense row';
end $$;

select '2b acceptance: all checks passed' as result;
rollback;
