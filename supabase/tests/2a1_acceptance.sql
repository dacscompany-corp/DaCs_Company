-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-1 acceptance — migration 0096 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists. Builds its own
-- "ZZ 2a1" projects and billing periods. Editor-safe (set_config 'v2a1.*',
-- no temp objects). Needs one active owner with an active staff account.
-- Success ends with the row '2a1 acceptance: all checks passed'.
--   A. §3.3 split, earliest billing number, Cover subset   E. guard
--      (A6: billing #1 first even when #2 is older and has less left)
--   B. staff funded from budgets they cannot read           F. retry
--   C. no period that month → Cover + office review         G. correct / void
--   D. Additional Works in full; fee share split 150 / 50
--   H. NO billing period: counted at once as Cover, flagged; re-fund later
--   I. phone purchasing refused until the Buyer switch  J. stock added once
--   K. after its purchase is voided, a project can be deleted
--   L. replace: a different number of lines, stock never added twice
--   M. never another month's client period: no Cover period, no period
--      that month → tied to the project; that month's money untouched
--   N. deleting refused before anything is removed (a zero-value purchase counts)
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_a uuid; v_b uuid; v_aw uuid;
  v_p1 uuid; v_p2 uuid; v_cover uuid; v_pb uuid; v_paw uuid; v_c uuid; v_c1 uuid; v_c2 uuid;
begin
  select p.id, s.id into v_owner, v_staff
    from profiles p join profiles s on s.owner_id = p.id and s.role = 'staff' and coalesce(s.status, 'active') = 'active'
         -- a staff account allowed the Expenses section (not module-focused elsewhere)
         and (jsonb_typeof(s.allowed_modules) is distinct from 'array' or jsonb_array_length(s.allowed_modules) = 0
              or s.allowed_modules ? 'expenses')
   where p.role = 'owner' and coalesce(p.status, 'active') = 'active'
   order by p.created_at, s.created_at limit 1;
  assert v_owner is not null and v_staff is not null, 'need an active owner with an active staff account allowed Expenses';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a1 project A') returning id into v_a;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a1 project B') returning id into v_b;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 2a1 additional works', v_a) returning id into v_aw;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_a, 'October', 2026, 'progress', 2) returning id into v_p2;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_a, 'October', 2026, 'progress', 1) returning id into v_p1;
  insert into projects (owner_id, folder_id, month, year, funding_type) values (v_owner, v_a, 'October', 2026, 'president') returning id into v_cover;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_b, 'October', 2026, 'progress', 1) returning id into v_pb;
  insert into projects (owner_id, folder_id, month, year, funding_type) values (v_owner, v_aw, 'October', 2026, 'progress') returning id into v_paw;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_p1, v_owner, 5000), (v_p2, v_owner, 4000), (v_pb, v_owner, 100000);
  insert into expenses (owner_id, project_id, expense_name, amount) values (v_owner, v_p1, 'ZZ 2a1 earlier', 2000);
  -- Billing #2 created BEFORE #1, and with LESS left: neither creation order
  -- nor "lowest remaining first" may pick it before billing #1.
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a1 project C') returning id into v_c;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number, created_at) values (v_owner, v_c, 'Oct', 2026, 'progress', 2, now() - interval '1 day') returning id into v_c2;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_c, 'October', 2026, 'progress', 1) returning id into v_c1;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_c2, v_owner, 500), (v_c1, v_owner, 9000);
  perform set_config('v2a1.c', v_c::text, true);
  perform set_config('v2a1.c1', v_c1::text, true);

  perform set_config('v2a1.owner', v_owner::text, true);
  perform set_config('v2a1.staff', v_staff::text, true);
  perform set_config('v2a1.a', v_a::text, true);
  perform set_config('v2a1.b', v_b::text, true);
  perform set_config('v2a1.aw', v_aw::text, true);
  perform set_config('v2a1.p1', v_p1::text, true);
  perform set_config('v2a1.p2', v_p2::text, true);
  perform set_config('v2a1.cover', v_cover::text, true);
  perform set_config('v2a1.pb', v_pb::text, true);
  perform set_config('v2a1.paw', v_paw::text, true);
end $$;

-- 0097 (2A-2, review R3) lets only those who may BUY read purchase rows.
-- This script reads them to check its own results, so where 0097 is applied
-- its staff account gets the Buyer switch for this rolled-back transaction.
-- Recording from the Expenses form works the same either way (0096).
do $$
begin
  if to_regclass('public.pur_buyers') is not null then
    execute 'insert into pur_buyers (user_id, owner_id, is_buyer, updated_by) values ($1, $2, true, $2)
             on conflict (user_id) do update set is_buyer = true'
      using current_setting('v2a1.staff')::uuid, current_setting('v2a1.owner')::uuid;
  end if;
end $$;

set local role authenticated;

-- ═══ A. The §3.3 example, recorded by STAFF (B: budgets they cannot read) ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a1.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_body jsonb;
begin
  assert not exists (select 1 from project_budgets where project_id = current_setting('v2a1.p1')::uuid),
    'B0 staff still cannot read billing budgets directly';
  v_body := jsonb_build_object('purchase_date', '2026-10-14', 'date_time', '2026-10-14T09:30', 'receipt_total', 8000,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.a'), 'item_name', 'ZZ 2a1 cement', 'category', 'Materials', 'quantity', 10, 'amount', 8000)));
  r := pur_record(gen_random_uuid(), v_body);
  perform set_config('v2a1.purchase', r ->> 'purchase_id', true);
  assert (select array_agg((x ->> 'amount')::numeric order by (x ->> 'cover')::boolean, (x ->> 'amount')::numeric)
            from jsonb_array_elements(r -> 'rows') x) = array[3000, 4000, 1000]::numeric[], 'A1 3,000 + 4,000 + 1,000';
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.p1')::uuid and purchase_line_id is not null) = 3000, 'A2 billing #1 first';
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.p2')::uuid) = 4000, 'A3 then billing #2';
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.cover')::uuid and cover_expense) = 1000, 'A4 shortage on the Cover period, flagged';
  assert (select sum(amount) from expenses e join purchase_lines l on l.id = e.purchase_line_id
           where l.purchase_id = (r ->> 'purchase_id')::uuid) = 8000, 'A5 Spent counts the purchase once, Cover inside it';
end $$;

-- ═══ A6. Earliest billing number, not creation order or lowest remaining ═══
do $$
begin
  perform pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-20', 'receipt_total', 300,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.c'), 'item_name', 'ZZ 2a1 sand', 'amount', 300))));
  assert (select sum(e.amount) from expenses e join purchase_lines l on l.id = e.purchase_line_id
           where l.item_name = 'ZZ 2a1 sand' and e.project_id = current_setting('v2a1.c1')::uuid) = 300, 'A6 billing #1 pays first';
end $$;

-- ═══ C. No period that month → all Cover + office review ═══
do $$
declare r jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-11-03', 'receipt_total', 500,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.a'), 'item_name', 'ZZ 2a1 tiles', 'amount', 500))));
  assert r -> 'needs_review' = '[1]'::jsonb, 'C1 flagged for office review';
  assert (select bool_and(cover_expense) and sum(amount) = 500 from expenses e join purchase_lines l on l.id = e.purchase_line_id
           where l.purchase_id = (r ->> 'purchase_id')::uuid), 'C2 all Cover';
end $$;

-- ═══ D. Additional Works in full; a fee shared 150 / 50 ═══
do $$
declare r jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 22000,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.aw'), 'item_name', 'ZZ 2a1 lumber', 'amount', 22000))));
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.paw')::uuid and not cover_expense) = 22000, 'D1 AW in full, no Cover';
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 4200,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 pipe', 'amount', 3000),
                               jsonb_build_object('folder_id', current_setting('v2a1.aw'), 'item_name', 'ZZ 2a1 pipe', 'amount', 1000)),
    'charges', jsonb_build_array(jsonb_build_object('kind', 'delivery_fee', 'amount', 200))));
  assert (select array_agg(e.amount order by e.amount desc) from expenses e join purchase_charges c on c.id = e.purchase_charge_id
           where c.purchase_id = (r ->> 'purchase_id')::uuid) = array[150, 50]::numeric[], 'D2 fee 150 / 50';
end $$;

-- ═══ E. A purchase-made row changes only through its purchase ═══
do $$
begin
  begin
    update expenses set amount = 1 where project_id = current_setting('v2a1.p2')::uuid and purchase_line_id is not null;
    raise exception 'E1 a direct update was allowed';
  exception when others then
    assert sqlerrm like '%PURCHASE_ROW%', 'E1 wrong error: ' || sqlerrm;
  end;
  begin
    delete from expenses where project_id = current_setting('v2a1.p2')::uuid and purchase_line_id is not null;
    raise exception 'E2 a direct delete was allowed';
  exception when others then
    assert sqlerrm like '%PURCHASE_ROW%', 'E2 wrong error: ' || sqlerrm;
  end;
end $$;

-- ═══ F. Retry: same operation id, one purchase ═══
do $$
declare op uuid := gen_random_uuid(); r1 jsonb; r2 jsonb; v_body jsonb;
begin
  v_body := jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 10,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 nails', 'amount', 10)));
  r1 := pur_record(op, v_body);
  r2 := pur_record(op, v_body);
  assert r1 -> 'replayed' is null and (r2 ->> 'replayed')::boolean, 'F1 the retry is marked replayed';
  assert r2 - 'replayed' = r1, 'F1b otherwise the retry returns the first answer';
  assert (select count(*) from purchase_lines where item_name = 'ZZ 2a1 nails') = 1, 'F2 recorded once';
end $$;

-- ═══ G. Correct (difference only) and void (rows leave Spent) ═══
do $$
declare r jsonb; v_before numeric; v_after numeric;
begin
  select sum(amount) into v_before from expenses where project_id in (current_setting('v2a1.p1')::uuid, current_setting('v2a1.p2')::uuid, current_setting('v2a1.cover')::uuid);
  r := pur_correct(gen_random_uuid(), current_setting('v2a1.purchase')::uuid,
    jsonb_build_object('purchase_date', '2026-10-14', 'date_time', '2026-10-14T09:30', 'receipt_total', 8500,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.a'), 'item_name', 'ZZ 2a1 cement', 'category', 'Materials', 'quantity', 10, 'amount', 8500))),
    'ZZ 2a1 receipt said 8,500');
  select sum(amount) into v_after from expenses where project_id in (current_setting('v2a1.p1')::uuid, current_setting('v2a1.p2')::uuid, current_setting('v2a1.cover')::uuid);
  assert v_after - v_before = 500, 'G1 Spent changes by exactly the difference';
  perform pur_void(gen_random_uuid(), current_setting('v2a1.purchase')::uuid, 'ZZ 2a1 test void');
  assert not exists (select 1 from expenses e join purchase_lines l on l.id = e.purchase_line_id
                      where l.purchase_id = current_setting('v2a1.purchase')::uuid), 'G2 voided rows leave Spent';
  assert (select array_agg(kind order by id) from purchase_history where purchase_id = current_setting('v2a1.purchase')::uuid)
         = array['recorded', 'corrected', 'voided'], 'G3 history kept';
end $$;

-- ═══ H. NO billing period at all: counted at once, Cover, flagged; re-fund later ═══
do $$
declare r jsonb; v_f uuid;
begin
  insert into folders (owner_id, name) values (current_setting('v2a1.owner')::uuid, 'ZZ 2a1 no period') returning id into v_f;
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 700,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', v_f, 'item_name', 'ZZ 2a1 gravel', 'amount', 700))));
  assert r -> 'needs_review' = '[1]'::jsonb, 'H1 flagged';
  assert (select count(*) = 1 and bool_and(e.project_id is null and e.folder_id = v_f and e.cover_expense) and sum(e.amount) = 700
            from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = (r ->> 'purchase_id')::uuid),
    'H2 one Cover row tied to the project, no period';
  assert not exists (select 1 from projects where folder_id = v_f), 'H3 no period invented';
  perform set_config('v2a1.npf', v_f::text, true);
  perform set_config('v2a1.npp', r ->> 'purchase_id', true);
end $$;

-- The office adds the October period (as the database owner here, as Dacs Web would).
reset role;
do $$
declare v_p uuid;
begin
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (current_setting('v2a1.owner')::uuid, current_setting('v2a1.npf')::uuid, 'October', 2026, 'progress', 1) returning id into v_p;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_p, current_setting('v2a1.owner')::uuid, 10000);
  perform set_config('v2a1.npperiod', v_p::text, true);
end $$;
set local role authenticated;

do $$
begin
  perform pur_refund(gen_random_uuid(), current_setting('v2a1.npp')::uuid, 'ZZ 2a1 period added');
  assert (select sum(amount) from expenses where project_id = current_setting('v2a1.npperiod')::uuid and not cover_expense) = 700, 'H4 re-funded onto the period';
  assert not exists (select 1 from expenses where folder_id = current_setting('v2a1.npf')::uuid), 'H5 the no-period row is gone, counted once';
  assert (select purchase_date from purchases where id = current_setting('v2a1.npp')::uuid) = '2026-10-14', 'H6 purchase date kept';
end $$;

-- ═══ I. Phone purchasing needs the Buyer switch (2A-2) ═══
-- (with 0097: the switch given above is off for this check, then back on)
reset role;
do $$
begin
  if to_regclass('public.pur_buyers') is not null then
    execute 'update pur_buyers set is_buyer = false where user_id = $1' using current_setting('v2a1.staff')::uuid;
  end if;
end $$;
set local role authenticated;
do $$
begin
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', '2026-10-14', 'receipt_total', 1,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 x', 'amount', 1))));
    raise exception 'I1 a workmate purchase was accepted';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'I1 wrong error: ' || sqlerrm;
  end;
end $$;
reset role;
do $$
begin
  if to_regclass('public.pur_buyers') is not null then
    execute 'update pur_buyers set is_buyer = true where user_id = $1' using current_setting('v2a1.staff')::uuid;
  end if;
end $$;
set local role authenticated;

-- ═══ J. Stock: added inside the purchase, once — a retry adds nothing ═══
do $$
declare op uuid := gen_random_uuid(); v_body jsonb;
begin
  v_body := jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 90,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 stock item',
                                                  'amount', 90, 'quantity', 6, 'unit', 'pc', 'in_inventory', true)));
  perform pur_record(op, v_body);
  perform pur_record(op, v_body);
  assert (select count(*) = 1 and sum(current_stock) = 6 from inventory where item_name = 'ZZ 2a1 stock item'), 'J1 stock added once';
end $$;

-- ═══ K. After its purchase is voided, a project can be deleted ═══
do $$
begin
  perform pur_void(gen_random_uuid(), current_setting('v2a1.npp')::uuid, 'ZZ 2a1 test');
end $$;
reset role;
do $$
begin
  delete from folders where id = current_setting('v2a1.npf')::uuid;
  assert not exists (select 1 from folders where id = current_setting('v2a1.npf')::uuid), 'K1 deleted';
  assert (select folder_name from purchase_lines where purchase_id = current_setting('v2a1.npp')::uuid) = 'ZZ 2a1 no period', 'K2 history readable';
end $$;

-- ═══ L. Replace: a different number of lines, stock never added twice ═══
set local role authenticated;
do $$
declare r jsonb; rr jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 40,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 replace item',
                                                  'amount', 40, 'quantity', 3, 'in_inventory', true))));
  rr := pur_replace(gen_random_uuid(), (r ->> 'purchase_id')::uuid, jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 50,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 replace item',
                                                  'amount', 40, 'quantity', 3, 'in_inventory', true),
                               jsonb_build_object('folder_id', current_setting('v2a1.b'), 'item_name', 'ZZ 2a1 replace extra', 'amount', 10))),
    'ZZ 2a1 forgot a line');
  assert (select sum(current_stock) from inventory where item_name = 'ZZ 2a1 replace item') = 3, 'L1 stock carried over, not added twice';
  assert (select status from purchases where id = (r ->> 'purchase_id')::uuid) = 'void', 'L2 the old purchase is closed';
  assert not exists (select 1 from expenses e join purchase_lines l on l.id = e.purchase_line_id
                      where l.purchase_id = (r ->> 'purchase_id')::uuid), 'L3 the old rows left Spent';
  assert (select sum(e.amount) from expenses e join purchase_lines l on l.id = e.purchase_line_id
           where l.purchase_id = (rr ->> 'purchase_id')::uuid) = 50, 'L4 the new purchase counts once';
end $$;

-- ═══ M. Never another month's client period: October has ₱1,000, no Cover period, no December period ═══
reset role;
do $$
declare v_f uuid; v_p uuid;
begin
  insert into folders (owner_id, name) values (current_setting('v2a1.owner')::uuid, 'ZZ 2a1 cross month') returning id into v_f;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (current_setting('v2a1.owner')::uuid, v_f, 'October', 2026, 'progress', 1) returning id into v_p;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_p, current_setting('v2a1.owner')::uuid, 1000);
  perform set_config('v2a1.xmf', v_f::text, true);
  perform set_config('v2a1.xmp', v_p::text, true);
end $$;
set local role authenticated;
do $$
declare r jsonb;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-12-02', 'receipt_total', 300,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.xmf'), 'item_name', 'ZZ 2a1 december item', 'amount', 300))));
  assert r -> 'needs_review' = '[1]'::jsonb, 'M1 flagged for office review';
  assert (select count(*) = 1 and bool_and(e.project_id is null and e.folder_id = current_setting('v2a1.xmf')::uuid and e.cover_expense)
                 and sum(e.amount) = 300
            from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = (r ->> 'purchase_id')::uuid),
    'M2 one Cover row tied to the project — not parked on October';
  assert not exists (select 1 from expenses where project_id = current_setting('v2a1.xmp')::uuid), 'M3 October''s client money untouched';
  r := pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-20', 'receipt_total', 1000,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a1.xmf'), 'item_name', 'ZZ 2a1 october item', 'amount', 1000))));
  assert (select count(*) = 1 and bool_and(e.project_id = current_setting('v2a1.xmp')::uuid and not e.cover_expense) and sum(e.amount) = 1000
            from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = (r ->> 'purchase_id')::uuid),
    'M4 the October purchase is funded ₱1,000 from October, no Cover';
end $$;

-- ═══ N. Deleting is refused BEFORE anything is removed — a fully discounted purchase counts ═══
do $$
declare v_f uuid; v_p uuid;
begin
  insert into folders (owner_id, name) values (current_setting('v2a1.owner')::uuid, 'ZZ 2a1 discounted') returning id into v_f;
  perform pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 0,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', v_f, 'item_name', 'ZZ 2a1 free sample', 'amount', 10)),
    'charges', jsonb_build_array(jsonb_build_object('kind', 'discount', 'amount', 10))));
  assert pur_live_purchases(v_f, null) = 1, 'N1 the pre-check sees the zero-value purchase';
  perform set_config('v2a1.discf', v_f::text, true);
end $$;
reset role;
do $$
begin
  begin
    delete from folders where id = current_setting('v2a1.discf')::uuid;
    raise exception 'N2 a project with a live purchase was deleted';
  exception when others then
    assert sqlerrm like '%PURCHASES_LIVE%', 'N2 wrong error: ' || sqlerrm;
  end;
  assert exists (select 1 from folders where id = current_setting('v2a1.discf')::uuid), 'N3 nothing removed';
end $$;

select '2a1 acceptance: all checks passed' as result;
rollback;
