-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-3a acceptance — migration 0101 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists — not the Buyer
-- switch, not the test project, its Additional Works job, the period the
-- server makes for it, or any purchase. Builds its own "ZZ 2a3" project.
-- Editor-safe (set_config 'v2a3.*', no temp objects). Needs one active main
-- owner with an active staff account allowed Expenses, and one active worker
-- of that owner. The staff account's Buyer switch is turned OFF at the start
-- (and on again in A) inside this transaction, so its real setting is kept.
-- Run it through MCP execute_sql.
-- Success ends with the row '2a3 acceptance: all checks passed'.
--   A. the sign-in answer = pur_buyer(), service role only
--   B. an AW job with no period: one hidden period, charged in full
--   C. a phone purchase needs a receipt photo or a reason (web does not)
--   D. My purchases and the destinations list
--   E. no other project's Spent moved
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_main uuid; v_job uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  select p.id, s.id into v_owner, v_staff
    from profiles p join profiles s on s.owner_id = p.id and s.role = 'staff' and coalesce(s.status, 'active') = 'active'
         and (jsonb_typeof(s.allowed_modules) is distinct from 'array' or jsonb_array_length(s.allowed_modules) = 0
              or s.allowed_modules ? 'expenses')
   where p.role = 'owner' and p.owner_id is null and coalesce(p.status, 'active') = 'active'
   order by p.created_at, s.created_at limit 1;
  select w.id into v_worker from profiles w
   where w.owner_id = v_owner and w.role in ('worker', 'teamLeader') and coalesce(w.status, 'active') = 'active'
   order by w.created_at limit 1;
  assert v_owner is not null and v_staff is not null and v_worker is not null,
    'need an active main owner with an active staff account allowed Expenses and an active worker';
  -- Start from "no Buyer switch" whatever the live setting is (rolled back below).
  update pur_buyers set is_buyer = false where user_id = v_staff;

  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a3 project') returning id into v_main;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 2a3 job', v_main) returning id into v_job;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_main, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1);
  insert into project_budgets (project_id, owner_id, monthly_budget) select id, v_owner, 1000000 from projects where folder_id = v_main;

  perform set_config('v2a3.owner', v_owner::text, true);
  perform set_config('v2a3.staff', v_staff::text, true);
  perform set_config('v2a3.worker', v_worker::text, true);
  perform set_config('v2a3.main', v_main::text, true);
  perform set_config('v2a3.job', v_job::text, true);
  perform set_config('v2a3.today', v_today::text, true);
  -- E (before): every other project's Spent.
  perform set_config('v2a3.others', (select coalesce(sum(e.amount), 0)::text from expenses e join projects p on p.id = e.project_id
                                      where p.owner_id = v_owner and p.folder_id not in (v_main, v_job)), true);
end $$;

-- ═══ A. The sign-in answer ═══
set local role service_role;
do $$
begin
  assert pur_signin_can_buy(current_setting('v2a3.owner')::uuid), 'A1 the main owner may buy';
  assert not pur_signin_can_buy(current_setting('v2a3.staff')::uuid), 'A2 staff without the switch may not';
  assert not pur_signin_can_buy(current_setting('v2a3.worker')::uuid), 'A3 a worker may not';
  assert not pur_signin_can_buy(gen_random_uuid()), 'A4 an unknown id may not';
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a3.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_signin_can_buy(current_setting('v2a3.owner')::uuid);
    raise exception 'A5 a signed-in user called pur_signin_can_buy';
  exception when insufficient_privilege then null;
  end;
  perform pur_set_buyer(current_setting('v2a3.staff')::uuid, true);
end $$;
reset role;
set local role service_role;
do $$
begin
  assert pur_signin_can_buy(current_setting('v2a3.staff')::uuid), 'A6 the switch on → staff may buy at sign-in';
end $$;
reset role;

-- ═══ B–D as the Buyer (staff with the switch on) ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a3.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_list jsonb; v_d jsonb; v_receipt text := 'https://example.test/zz-2a3-receipt.jpg';
begin
  assert pur_buyer(), 'A7 pur_buyer() agrees with the sign-in answer';
  -- B. AW job with no period.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', current_setting('v2a3.today'),
         'receipt_total', 1500, 'docs', jsonb_build_object('po_image_url', v_receipt),
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.job'), 'item_name', 'ZZ 2a3 lumber',
                                                       'unit', 'pc', 'amount', 1500, 'unplanned_reason', 'ZZ test'))));
  assert r ->> 'purchase_id' is not null, 'B1 recorded';
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', current_setting('v2a3.today'),
         'receipt_total', 500, 'docs', jsonb_build_object('po_image_url', v_receipt),
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.job'), 'item_name', 'ZZ 2a3 nails',
                                                       'unit', 'box', 'amount', 500, 'unplanned_reason', 'ZZ test'))));
  -- C. No receipt.
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', current_setting('v2a3.today'),
      'receipt_total', 80, 'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.main'),
                                                     'item_name', 'ZZ 2a3 rope', 'unit', 'pc', 'amount', 80, 'unplanned_reason', 'ZZ test'))));
    raise exception 'C1 a phone purchase without a receipt or a reason was recorded';
  exception when others then
    assert sqlerrm like '%NO_RECEIPT%', 'C1 wrong error: ' || sqlerrm;
  end;
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'workmate', 'purchase_date', current_setting('v2a3.today'),
         'receipt_total', 80, 'no_receipt_reason', 'ZZ sari-sari store, no receipt',
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.main'), 'item_name', 'ZZ 2a3 rope',
                                                       'unit', 'pc', 'amount', 80, 'unplanned_reason', 'ZZ test'))));
  perform set_config('v2a3.noreceipt', r ->> 'purchase_id', true);
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a3.today'),
         'receipt_total', 20, 'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.main'),
                                                        'item_name', 'ZZ 2a3 tape', 'unit', 'pc', 'amount', 20, 'unplanned_reason', 'ZZ test'))));
  assert r ->> 'purchase_id' is not null, 'C2 the Purchasing tab still records without a receipt (R5)';
  -- D. My purchases and destinations.
  v_list := pur_my_purchases(60);
  assert (select count(*) from jsonb_array_elements(v_list) x
           where (x -> 'projects') ?| array['ZZ 2a3 project', 'ZZ 2a3 job']) = 4, 'D1 my four ZZ purchases listed';
  assert (select x ->> 'no_receipt_reason' from jsonb_array_elements(v_list) x where x ->> 'id' = current_setting('v2a3.noreceipt'))
         = 'ZZ sari-sari store, no receipt', 'D2 the reason is shown';
  v_d := pur_destinations();
  assert exists (select 1 from jsonb_array_elements(v_d) x where x ->> 'folder_id' = current_setting('v2a3.main')
                    and (x -> 'works') @> jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a3.job'), 'name', 'ZZ 2a3 job'))),
    'D3 the project and its job are listed';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a3.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_my_purchases(60);
    raise exception 'D4 a worker read My purchases';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%' or sqlerrm like '%NOT_OFFICE%', 'D4 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_destinations();
    raise exception 'D5 a worker read the destinations';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'D5 wrong error: ' || sqlerrm;
  end;
end $$;
reset role;

-- ═══ B and E checked as the database owner ═══
do $$
declare v_n int; v_spent numeric;
begin
  select count(*) into v_n from projects where folder_id = current_setting('v2a3.job')::uuid;
  assert v_n = 1, 'B2 exactly one period for the job, got ' || v_n;
  assert exists (select 1 from projects p where p.folder_id = current_setting('v2a3.job')::uuid and p.funding_type = 'downpayment'
                    and p.month = to_char(current_setting('v2a3.today')::date, 'FMMonth')
                    and not exists (select 1 from project_budgets b where b.project_id = p.id)), 'B3 downpayment, purchase month, no budget row';
  select coalesce(sum(e.amount), 0) into v_spent from expenses e join projects p on p.id = e.project_id
   where p.folder_id = current_setting('v2a3.job')::uuid;
  assert v_spent = 2000, 'B4 the job is charged in full: ' || v_spent;
  assert not exists (select 1 from expenses e join projects p on p.id = e.project_id
                      where p.folder_id = current_setting('v2a3.job')::uuid and e.cover_expense), 'B5 never Cover';
  select coalesce(sum(e.amount), 0) into v_spent from expenses e join projects p on p.id = e.project_id
   where p.owner_id = current_setting('v2a3.owner')::uuid
     and p.folder_id not in (current_setting('v2a3.main')::uuid, current_setting('v2a3.job')::uuid);
  assert v_spent = current_setting('v2a3.others')::numeric, 'E1 no other project''s Spent moved';
end $$;

select '2a3 acceptance: all checks passed' as result;
rollback;
