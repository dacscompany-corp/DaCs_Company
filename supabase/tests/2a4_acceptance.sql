-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-4a acceptance — migration 0102 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists — not the Buyer or
-- own-money switch, not the "ZZ 2a4" project, its purchases, payments, petty
-- cash, refunds, credit or repayment. Editor-safe (set_config 'v2a4.*', no
-- temp objects). Needs one active main owner with an active staff account
-- allowed Expenses. That account's switches are set inside this transaction,
-- so its real settings are kept. Run it through MCP execute_sql.
-- Success ends with the row '2a4 acceptance: all checks passed'.
--   A. "paid now": the purchase and its payment together; Paid; cash held down
--   B. a deposit, the rest, then too much: Partially paid → Paid → Overpaid
--   C. Overpaid resolved: refund tied to its money + a supplier credit, used in part
--   D. petty cash: given, returned, confirmed; the daily report adds up
--   E. own money: switch off → flagged; accepted; repaid
--   F. who may: a worker and the staff account are refused the owner's screens
--   G. no Spent moved anywhere — this project's or any other
--   H. return photos: the main owner reads them; a buyer only their own uploads
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_main uuid; v_sup uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
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

  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a4 project') returning id into v_main;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_main, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1);
  insert into project_budgets (project_id, owner_id, monthly_budget) select id, v_owner, 1000000 from projects where folder_id = v_main;
  insert into suppliers (owner_id, name, created_by) values (v_owner, 'ZZ 2a4 Hardware', v_owner) returning id into v_sup;

  perform set_config('v2a4.owner', v_owner::text, true);
  perform set_config('v2a4.staff', v_staff::text, true);
  perform set_config('v2a4.worker', v_worker::text, true);
  perform set_config('v2a4.main', v_main::text, true);
  perform set_config('v2a4.sup', v_sup::text, true);
  perform set_config('v2a4.today', v_today::text, true);
  -- G (before): every expense row of the company, count and pesos.
  perform set_config('v2a4.spent', (select count(*)::text || '/' || coalesce(sum(amount), 0)::text from expenses where owner_id = v_owner), true);
end $$;

-- ═══ As the main owner: switches on, petty cash given ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  perform pur_set_buyer(current_setting('v2a4.staff')::uuid, true);
  perform pur_set_own_money(current_setting('v2a4.staff')::uuid, false);
  r := pur_cash_give(gen_random_uuid(), current_setting('v2a4.staff')::uuid, '5000', current_setting('v2a4.today'), 'cash', 'ZZ 2a4');
  assert (r ->> 'held')::numeric >= 5000, 'D1 petty cash given counts at once';
  perform set_config('v2a4.held0', (r ->> 'held'), true);
end $$;

-- ═══ A–C as the buyer ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_p uuid; v_q uuid; v_rcpt text := 'https://example.test/zz-2a4-receipt.jpg';
  v_line jsonb := jsonb_build_object('folder_id', current_setting('v2a4.main'), 'item_name', 'ZZ 2a4 cement', 'unit', 'bag', 'unplanned_reason', 'ZZ test');
begin
  -- A. Paid now.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
         'receipt_total', 1250, 'supplier_id', current_setting('v2a4.sup'), 'docs', jsonb_build_object('po_image_url', v_rcpt),
         'lines', jsonb_build_array(v_line || jsonb_build_object('amount', 1250)),
         'payments', jsonb_build_array(jsonb_build_object('amount', '1250', 'paid_on', current_setting('v2a4.today'),
                                                          'method', 'cash', 'source', 'petty_cash'))));
  assert r -> 'pay' ->> 'state' = 'paid', 'A1 paid now: ' || (r -> 'pay')::text;
  assert ((pur_my_cash() ->> 'recorded')::numeric) = current_setting('v2a4.held0')::numeric - 1250, 'A2 cash held went down by ₱1,250';
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
      'receipt_total', 99, 'lines', jsonb_build_array(v_line || jsonb_build_object('amount', 99)),
      'payments', jsonb_build_array(jsonb_build_object('amount', '99', 'paid_on', current_setting('v2a4.today'), 'method', 'barter', 'source', 'company'))));
    raise exception 'A3 a bad payment let its purchase through';
  exception when others then
    assert sqlerrm like '%BAD_METHOD%', 'A3 wrong error: ' || sqlerrm;
  end;
  assert not exists (select 1 from jsonb_array_elements(pur_my_purchases(1)) x where (x ->> 'receipt_total')::numeric = 99),
    'A4 the refused purchase was not recorded';

  -- B. Deposit, the rest, too much.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
         'receipt_total', 1000, 'supplier_id', current_setting('v2a4.sup'),
         'lines', jsonb_build_array(v_line || jsonb_build_object('amount', 1000))));
  v_p := (r ->> 'purchase_id')::uuid;
  perform set_config('v2a4.p', v_p::text, true);
  r := pur_pay(gen_random_uuid(), v_p, jsonb_build_object('amount', '300', 'paid_on', current_setting('v2a4.today'), 'method', 'gcash', 'source', 'company'));
  assert r -> 'pay' ->> 'state' = 'partial', 'B1 a deposit: Partially paid';
  r := pur_pay(gen_random_uuid(), v_p, jsonb_build_object('amount', '700', 'paid_on', current_setting('v2a4.today'), 'method', 'cash', 'source', 'petty_cash'));
  assert r -> 'pay' ->> 'state' = 'paid', 'B2 the rest: Paid';
  r := pur_pay(gen_random_uuid(), v_p, jsonb_build_object('amount', '500', 'paid_on', current_setting('v2a4.today'), 'method', 'cash', 'source', 'petty_cash'));
  assert r -> 'pay' ->> 'state' = 'overpaid' and (r -> 'pay' ->> 'unresolved')::numeric = 500, 'B3 too much: Overpaid ₱500';
  assert (select x -> 'pay' ->> 'state' from jsonb_array_elements(pur_my_purchases(1)) x where x ->> 'id' = v_p::text) = 'overpaid',
    'B4 the list row shows it';

  -- E (part). Own money while the switch is off.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
         'receipt_total', 400, 'supplier_id', current_setting('v2a4.sup'),
         'lines', jsonb_build_array(v_line || jsonb_build_object('amount', 400)),
         'payments', jsonb_build_array(jsonb_build_object('amount', '400', 'paid_on', current_setting('v2a4.today'),
                                                          'method', 'cash', 'source', 'own_money'))));
  assert (pur_my_cash() ->> 'owes_to_review')::numeric = 400 and (pur_my_cash() ->> 'owes')::numeric = 0, 'E1 flagged, not owed yet';
  perform set_config('v2a4.own', pur_purchase_payments((r ->> 'purchase_id')::uuid) -> 'payments' -> 0 ->> 'id', true);

  -- D (part). A return reported.
  r := pur_cash_report_return(gen_random_uuid(), '1000', current_setting('v2a4.today'), 'ZZ the owner', '', 'ZZ 2a4');
  perform set_config('v2a4.ret', r ->> 'return_id', true);
  assert (pur_my_cash() ->> 'pending_returns')::numeric >= 1000, 'D2 awaiting confirmation, shown apart';

  -- F. The owner's screens are not the buyer's.
  begin
    perform pur_cash_tracker();
    raise exception 'F1 the buyer read the tracker';
  exception when others then
    assert sqlerrm like '%OWNER_ONLY%' or sqlerrm like '%NOT_ALLOWED%', 'F1 wrong error: ' || sqlerrm;
  end;
end $$;

-- ═══ C–E as the main owner ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_credit uuid; v_rep jsonb; v_q uuid; v_d jsonb; v_held numeric;
begin
  -- C. ₱500 over: ₱300 back into the buyer's petty cash, ₱200 as Wilcon-style credit.
  v_held := (select (b ->> 'recorded')::numeric from jsonb_array_elements(pur_cash_tracker() -> 'buyers') b
              where b ->> 'buyer_id' = current_setting('v2a4.staff'));
  assert exists (select 1 from jsonb_array_elements(pur_overpaid()) x where x ->> 'id' = current_setting('v2a4.p')), 'C1 on the Overpaid list';
  r := pur_resolve_overpaid(gen_random_uuid(), current_setting('v2a4.p')::uuid,
         jsonb_build_array(jsonb_build_object('amount', '300', 'funded_by', 'petty_cash', 'person_id', current_setting('v2a4.staff'),
                                              'received_by', 'petty_cash', 'received_on', current_setting('v2a4.today'))),
         jsonb_build_object('amount', '200', 'note', 'ZZ credit memo'));
  assert r -> 'pay' ->> 'state' = 'paid', 'C2 resolved';
  assert (select (b ->> 'recorded')::numeric from jsonb_array_elements(pur_cash_tracker() -> 'buyers') b
           where b ->> 'buyer_id' = current_setting('v2a4.staff')) = v_held + 300, 'C3 cash held +₱300';
  v_credit := (r -> 'created' -> 1 ->> 'credit_id')::uuid;
  perform set_config('v2a4.credit', v_credit::text, true);

  -- D. Confirm the return; the daily report adds up.
  r := pur_cash_decide_return(gen_random_uuid(), current_setting('v2a4.ret')::uuid, true, 'ZZ counted');
  v_rep := pur_cash_report(current_setting('v2a4.staff')::uuid, current_setting('v2a4.today'), current_setting('v2a4.today'));
  v_d := v_rep -> 'days' -> 0;
  assert v_d ->> 'day' = current_setting('v2a4.today'), 'D3 today is in the report';
  assert (v_d ->> 'opening')::numeric
         + (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_d -> 'received') x)
         + (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_d -> 'refunds_in') x)
         - (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_d -> 'payments') x)
         - (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_d -> 'returns') x)
         = (v_d ->> 'closing')::numeric, 'D4 opening + in − out = closing';

  -- E. Accept the own-money payment, repay part of it.
  perform pur_accept_own_money(gen_random_uuid(), current_setting('v2a4.own')::uuid);
  assert (select (b ->> 'owes')::numeric from jsonb_array_elements(pur_cash_tracker() -> 'buyers') b
           where b ->> 'buyer_id' = current_setting('v2a4.staff')) >= 400, 'E2 accepted: owed';
  r := pur_repay_buyer(gen_random_uuid(), current_setting('v2a4.staff')::uuid, '150', current_setting('v2a4.today'), 'cash', 'ZZ');
  begin
    perform pur_repay_buyer(gen_random_uuid(), current_setting('v2a4.staff')::uuid, '100000000', current_setting('v2a4.today'), 'cash', 'ZZ');
    raise exception 'E3 repaid more than owed';
  exception when others then
    assert sqlerrm like '%OVER_OWED%', 'E3 wrong error: ' || sqlerrm;
  end;
  assert exists (select 1 from jsonb_each_text(pur_payment_badges()) b where b.value in ('paid', 'partial')), 'F2 the owner badge reads states';
end $$;

-- ═══ C. The buyer uses the credit in part ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_q uuid;
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', current_setting('v2a4.today'),
         'receipt_total', 500, 'supplier_id', current_setting('v2a4.sup'),
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a4.main'), 'item_name', 'ZZ 2a4 sand',
                                                       'unit', 'bag', 'amount', 500, 'unplanned_reason', 'ZZ test')),
         'payments', jsonb_build_array(
            jsonb_build_object('amount', '120', 'paid_on', current_setting('v2a4.today'), 'method', 'other', 'source', 'credit',
                               'credit_id', current_setting('v2a4.credit')),
            jsonb_build_object('amount', '380', 'paid_on', current_setting('v2a4.today'), 'method', 'cash', 'source', 'petty_cash'))));
  assert r -> 'pay' ->> 'state' = 'paid', 'C4 credit + cash pay it in full';
  assert (select (x ->> 'left')::numeric from jsonb_array_elements(pur_credits(current_setting('v2a4.sup')::uuid)) x
           where x ->> 'id' = current_setting('v2a4.credit')) = 80, 'C5 ₱80 of the credit left';
end $$;

-- ═══ F. A worker reaches none of it ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_my_cash();
    raise exception 'F3 a worker read cash';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%' or sqlerrm like '%NOT_OFFICE%', 'F3 wrong error: ' || sqlerrm;
  end;
  begin
    perform 1 from pur_payments limit 1;
    raise exception 'F4 a signed-in user read pur_payments directly';
  exception when insufficient_privilege then null;
  end;
  assert not uploads_can_read('pettyCash/' || current_setting('v2a4.owner') || '/2026-10/zz-2a4.jpg', null),
    'F5 a worker reads a return photo';
end $$;

-- ═══ H. Return photos (R13): the main owner reads them; a buyer only their own uploads ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not uploads_can_read('pettyCash/' || current_setting('v2a4.owner') || '/2026-10/zz-2a4.jpg', null),
    'H1 a buyer reads a return photo they did not upload';
  assert uploads_can_write('pettyCash/' || current_setting('v2a4.owner') || '/2026-10/zz-2a4.jpg'),
    'H2 the buyer may upload a return photo';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert uploads_can_read('pettyCash/' || current_setting('v2a4.owner') || '/2026-10/zz-2a4.jpg', null),
    'H3 the main owner reads return photos';
end $$;
reset role;

-- ═══ G. Spent: only the purchases moved it ═══
do $$
declare v_n int; v_s numeric; v_main numeric;
begin
  select coalesce(sum(e.amount), 0) into v_main from expenses e join projects p on p.id = e.project_id
   where p.folder_id = current_setting('v2a4.main')::uuid;
  assert v_main = 1250 + 1000 + 400 + 500, 'G1 the ZZ project''s Spent = its four purchases, not what was paid: ' || v_main;
  select count(*), coalesce(sum(e.amount), 0) into v_n, v_s from expenses e
   where e.owner_id = current_setting('v2a4.owner')::uuid
     and coalesce(e.project_id, '00000000-0000-0000-0000-000000000000') not in (select id from projects where folder_id = current_setting('v2a4.main')::uuid);
  assert v_n::text || '/' || v_s::text = current_setting('v2a4.spent'), 'G2 no other expense row changed';
end $$;

select '2a4 acceptance: all checks passed' as result;
rollback;
