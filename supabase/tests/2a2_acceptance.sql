-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-2 acceptance — migration 0097 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists — not the Buyer
-- switch, not the test projects, requests or purchases. Builds its own
-- "ZZ 2a2" projects and one request line. Editor-safe (set_config 'v2a2.*',
-- no temp objects). Needs one active owner with an active staff account
-- allowed Expenses, and one active worker of that owner.
-- Success ends with the row '2a2 acceptance: all checks passed'.
--   A. the Buyer switch (owner only)        E. Project Control's correction keeps the link
--   B. claim; buy 6 of 10 → 4 stay assigned F. void returns the quantity
--   C. extra needs a reason; Still ≥ 0      G. owner approval of a staff change
--   D. a different unit waits for a check   H. workers / non-buyers refused; receipts buyer-only
-- Review fixes (16 Oct):
--   R1. no source links a request without the switch
--   R2. picked portions are the only ones covered (next week untouched)
--   R3. the owner sees the whole change; a unit check makes it stale
--   R4. non-buyer staff read no purchase row — only Project Control's line
--   R5. a substitute needs a reason and waits for an office check
--   RR2. a correction cannot newly pick another buyer's portion (re-review)
-- Bought is read as a buyer reads it (pur_shopping_list): the counting
-- helpers are internal and signed-in users cannot call them.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_a uuid; v_b uuid; v_req uuid; v_line uuid; v_line2 uuid; v_portion uuid; v_batch uuid;
  v_line3 uuid; v_line4 uuid; v_p3a uuid; v_p3b uuid;
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
    'need an active owner with an active staff account allowed Expenses and an active worker';
  assert not exists (select 1 from pur_buyers where user_id = v_staff and is_buyer),
    'A0 run this before switching Buyer on for the test staff account';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a2 project A') returning id into v_a;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 2a2 project B') returning id into v_b;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_a, 'October', 2026, 'progress', 1);
  insert into project_budgets (project_id, owner_id, monthly_budget)
    select id, v_owner, 1000000 from projects where folder_id = v_a;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number) values (v_owner, v_b, 'October', 2026, 'progress', 1);
  insert into project_budgets (project_id, owner_id, monthly_budget)
    select id, v_owner, 1000000 from projects where folder_id = v_b;
  v_batch := pr_batch_for(v_owner, now());
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_worker, v_a, v_a, gen_random_uuid()) returning id into v_req;
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_req, 0, 'material', 'ZZ 2a2 cement', 'bag') returning id into v_line;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line, v_batch, 10) returning id into v_portion;
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_req, 1, 'material', 'ZZ 2a2 hinge', 'pcs') returning id into v_line2;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line2, v_batch, 24);
  -- R2: one line needed this week (4) and next week (6).
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_req, 2, 'material', 'ZZ 2a2 sand', 'bag') returning id into v_line3;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line3, v_batch, 4) returning id into v_p3a;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity)
  values (v_owner, v_line3, pr_batch_for(v_owner, now() + interval '8 days'), 6) returning id into v_p3b;
  -- R5: a line a substitute is bought for.
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_req, 3, 'material', 'ZZ 2a2 Boysen paint', 'gal') returning id into v_line4;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line4, v_batch, 2);

  perform set_config('v2a2.line3', v_line3::text, true);
  perform set_config('v2a2.line4', v_line4::text, true);
  perform set_config('v2a2.p3a', v_p3a::text, true);
  perform set_config('v2a2.p3b', v_p3b::text, true);
  perform set_config('v2a2.owner', v_owner::text, true);
  perform set_config('v2a2.staff', v_staff::text, true);
  perform set_config('v2a2.worker', v_worker::text, true);
  perform set_config('v2a2.a', v_a::text, true);
  perform set_config('v2a2.b', v_b::text, true);
  perform set_config('v2a2.line', v_line::text, true);
  perform set_config('v2a2.line2', v_line2::text, true);
  perform set_config('v2a2.portion', v_portion::text, true);
end $$;

set local role authenticated;

-- ═══ A. The Buyer switch ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not pur_buyer(), 'A1 staff without the switch cannot buy';
  begin
    perform pur_set_buyer(current_setting('v2a2.staff')::uuid, true);
    raise exception 'A2 staff set the switch';
  exception when others then
    assert sqlerrm like '%OWNER_ONLY%', 'A2 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_shopping_list();
    raise exception 'H1 a non-buyer read the shopping list';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'H1 wrong error: ' || sqlerrm;
  end;
  -- R1. The Expenses form is still open to them, but not for linking a request.
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'expenses_form', 'purchase_date', '2026-10-14', 'receipt_total', 100,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                                                    'quantity', 1, 'unit', 'bag', 'amount', 100, 'request_line_id', current_setting('v2a2.line')))));
    raise exception 'R1 a non-buyer linked a request through the Expenses form';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'R1 wrong error: ' || sqlerrm;
  end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  perform pur_set_buyer(current_setting('v2a2.staff')::uuid, true);
  -- RR2 (set-up). Next week's sand is the owner's to buy.
  perform pur_assign_portion(current_setting('v2a2.p3b')::uuid, current_setting('v2a2.owner')::uuid, null, null);
end $$;

-- ═══ B–F as the Buyer ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_list jsonb; v_l jsonb; v_pid uuid; v_pid2 uuid; v_id uuid;
begin
  assert pur_buyer(), 'A3 the switch lets staff buy';
  -- B. claim, buy 6 of 10
  perform pur_assign_portion(current_setting('v2a2.portion')::uuid, current_setting('v2a2.staff')::uuid, null, null);
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1500,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                                                       'quantity', 6, 'unit', 'bag', 'amount', 1500, 'request_line_id', current_setting('v2a2.line')))));
  v_pid := (r ->> 'purchase_id')::uuid;
  v_list := pur_shopping_list(null, current_setting('v2a2.a')::uuid, 'all');
  select x into v_l from jsonb_array_elements(v_list) x where x ->> 'line_id' = current_setting('v2a2.line');
  assert (v_l ->> 'needed')::numeric = 10 and (v_l ->> 'bought')::numeric = 6 and (v_l ->> 'still_to_buy')::numeric = 4,
    'B1 Needed 10 · Bought 6 · Still 4: ' || v_l::text;
  assert (v_l -> 'portions' -> 0 ->> 'buyer_id') = current_setting('v2a2.staff'), 'B2 the 4 stay assigned';
  assert v_list::text !~* '"(amount|price|receipt_total|gross_amount)"', 'H2 the shopping list carries no money';

  -- C. 6 more for the last 4: a reason is needed; then Still is 0, not −2
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1500,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                                                    'quantity', 6, 'unit', 'bag', 'amount', 1500, 'request_line_id', current_setting('v2a2.line')))));
    raise exception 'C1 an extra without a reason was recorded';
  exception when others then
    assert sqlerrm like '%EXTRA_REASON_REQUIRED%', 'C1 wrong error: ' || sqlerrm;
  end;
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1500,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                    'quantity', 6, 'unit', 'bag', 'amount', 1500, 'request_line_id', current_setting('v2a2.line'),
                    'extra_reason', 'sold in sixes', 'extra_location', 'warehouse'))));
  v_pid2 := (r ->> 'purchase_id')::uuid;
  assert (r -> 'covers' -> 0 ->> 'covered')::numeric = 4 and (r -> 'covers' -> 0 ->> 'extra')::numeric = 2, 'C2 covers 4, extra 2: ' || r::text;
  select x into v_l from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line');
  assert (v_l ->> 'still_to_buy')::numeric = 0 and (v_l ->> 'extra')::numeric = 2, 'C3 Still 0 (never negative), Extra 2';

  -- D. a box for a request in pcs: covers nothing until someone else checks it
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 900,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 hinge',
                    'quantity', 2, 'unit', 'box', 'amount', 900, 'request_line_id', current_setting('v2a2.line2')))));
  assert (r -> 'covers' -> 0 ->> 'unit_check') = 'pending' and (r -> 'covers' -> 0 ->> 'covered')::numeric = 0, 'D1 pending, nothing covered';
  perform set_config('v2a2.boxp', r ->> 'purchase_id', true);
  begin
    perform pur_check_unit(gen_random_uuid(), (r ->> 'purchase_id')::uuid, 1, 24, 'own check');
    raise exception 'D2 the buyer checked their own purchase';
  exception when others then
    assert sqlerrm like '%OWN_PURCHASE%', 'D2 wrong error: ' || sqlerrm;
  end;
  -- R3 (set-up). A change request on this purchase, made BEFORE the owner's unit check below.
  r := pur_request_change(gen_random_uuid(), current_setting('v2a2.boxp')::uuid, 'void', null, 'ZZ 2a2 bought twice');
  perform set_config('v2a2.cr_stale', r ->> 'request_id', true);

  -- R2. 4 picked from this week's 4, 6 bought: the other 2 are extra — next week's 6 untouched.
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 600,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 sand', 'quantity', 6,
                 'unit', 'bag', 'amount', 600, 'request_line_id', current_setting('v2a2.line3'),
                 'portion_picks', jsonb_build_array(jsonb_build_object('portion_id', current_setting('v2a2.p3a'), 'quantity', 4))))));
    raise exception 'R2a the 2 beyond the pick were covered from another week';
  exception when others then
    assert sqlerrm like '%EXTRA_REASON_REQUIRED%', 'R2a wrong error: ' || sqlerrm;
  end;
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 600,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 sand', 'quantity', 6,
                    'unit', 'bag', 'amount', 600, 'request_line_id', current_setting('v2a2.line3'),
                    'extra_reason', 'sold in sixes', 'extra_location', 'project',
                    'portion_picks', jsonb_build_array(jsonb_build_object('portion_id', current_setting('v2a2.p3a'), 'quantity', 4))))));
  assert (r -> 'covers' -> 0 ->> 'covered')::numeric = 4 and (r -> 'covers' -> 0 ->> 'extra')::numeric = 2, 'R2b covers the pick only: ' || r::text;
  select x into v_l from jsonb_array_elements(pur_shopping_list(null, current_setting('v2a2.a')::uuid, 'all')) x
   where x ->> 'line_id' = current_setting('v2a2.line3');
  assert (select (p ->> 'bought')::numeric from jsonb_array_elements(v_l -> 'portions') p where p ->> 'id' = current_setting('v2a2.p3b')) = 0,
    'R2c next week untouched: ' || v_l::text;
  -- RR2. A correction cannot newly pick a portion another buyer holds (here the owner's next week).
  begin
    perform pur_correct(gen_random_uuid(), (r ->> 'purchase_id')::uuid, jsonb_build_object('source', 'purchasing',
      'purchase_date', '2026-10-14', 'receipt_total', 600,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 sand', 'quantity', 6,
                 'unit', 'bag', 'amount', 600, 'request_line_id', current_setting('v2a2.line3'),
                 'portion_picks', jsonb_build_array(jsonb_build_object('portion_id', current_setting('v2a2.p3a'), 'quantity', 4),
                                                    jsonb_build_object('portion_id', current_setting('v2a2.p3b'), 'quantity', 2))))),
      'ZZ 2a2 cover the other 2 from next week');
    raise exception 'RR2 a correction covered a portion the owner holds';
  exception when others then
    assert sqlerrm like '%ASSIGNED_TO_OTHER%', 'RR2 wrong error: ' || sqlerrm;
  end;

  -- R5. A substitute: a reason first; then it covers nothing until the office checks it.
  begin
    perform pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1800,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 Davies paint', 'quantity', 2,
                 'unit', 'gal', 'amount', 1800, 'request_line_id', current_setting('v2a2.line4'), 'substitute', true))));
    raise exception 'R5a a substitute without a reason was recorded';
  exception when others then
    assert sqlerrm like '%SUBSTITUTE_REASON_REQUIRED%', 'R5a wrong error: ' || sqlerrm;
  end;
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', '2026-10-14', 'receipt_total', 1800,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 Davies paint', 'quantity', 2,
                    'unit', 'gal', 'amount', 1800, 'request_line_id', current_setting('v2a2.line4'), 'substitute', true,
                    'substitute_reason', 'Boysen out of stock; foreman agreed'))));
  assert (r -> 'covers' -> 0 ->> 'unit_check') = 'pending' and (r -> 'covers' -> 0 ->> 'covered')::numeric = 0, 'R5b waits for a check: ' || r::text;

  -- E. Project Control's form (no source, no link) keeps the request link
  perform pur_correct(gen_random_uuid(), v_pid, jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 1560,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 cement',
                                                  'quantity', 6, 'unit', 'bag', 'amount', 1560))), 'receipt said 1,560');
  assert (select request_line_id from purchase_lines where purchase_id = v_pid) = current_setting('v2a2.line')::uuid, 'E1 link kept';
  assert (select (x ->> 'bought')::numeric from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line')) = 10, 'E2 Bought still 6 + 4, covers rebuilt once';

  -- F. void returns the quantity; the assignment stays
  perform pur_void(gen_random_uuid(), v_pid2, 'test');
  assert (select (x ->> 'bought')::numeric from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line')) = 6, 'F1 Bought back to 6';

  -- G. a staff change for the owner: move the purchase to project B
  begin
    perform pur_correct(gen_random_uuid(), v_pid, jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 1560,
      'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.b'), 'item_name', 'ZZ 2a2 cement',
                                                    'quantity', 6, 'unit', 'bag', 'amount', 1560, 'request_line_id', null,
                                                    'unplanned_reason', 'wrong site'))), 'wrong site');
    raise exception 'G1 staff moved a cost to another project';
  exception when others then
    assert sqlerrm like '%OWNER_APPROVAL_NEEDED%', 'G1 wrong error: ' || sqlerrm;
  end;
  r := pur_request_change(gen_random_uuid(), v_pid, 'correct', jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 1560,
         'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.b'), 'item_name', 'ZZ 2a2 cement',
                                                       'quantity', 6, 'unit', 'bag', 'amount', 1560, 'request_line_id', null,
                                                       'unplanned_reason', 'wrong site'))), 'wrong site');
  perform set_config('v2a2.cr', r ->> 'request_id', true);
  perform set_config('v2a2.pid', v_pid::text, true);
  assert exists (select 1 from jsonb_array_elements(pur_change_requests('pending')) x where x ->> 'id' = current_setting('v2a2.cr')),
    'G2 the requester sees it';
end $$;

-- ═══ D / G as the owner ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_cr jsonb;
begin
  -- R3. The owner sees the whole change: quantity, unit, date, project, total, before and after.
  select x into v_cr from jsonb_array_elements(pur_change_requests('pending')) x where x ->> 'id' = current_setting('v2a2.cr');
  assert (v_cr -> 'proposed' -> 'lines' -> 0 ->> 'quantity')::numeric = 6 and v_cr -> 'proposed' -> 'lines' -> 0 ->> 'unit' = 'bag'
     and v_cr -> 'proposed' ->> 'purchase_date' = '2026-10-14' and v_cr -> 'proposed' -> 'lines' -> 0 ->> 'where' like 'ZZ 2a2 project B%'
     and v_cr -> 'base' -> 'lines' -> 0 ->> 'where' like 'ZZ 2a2 project A%' and (v_cr -> 'proposed' ->> 'receipt_total')::numeric = 1560,
    'R3a the full change: ' || v_cr::text;
  select x into v_cr from jsonb_array_elements(pur_change_requests('pending')) x where x ->> 'id' = current_setting('v2a2.cr_stale');
  assert not (v_cr ->> 'changed_since')::boolean, 'R3b not changed yet';
  perform pur_check_unit(gen_random_uuid(), current_setting('v2a2.boxp')::uuid, 1, 24, '2 boxes of 12');
  select x into v_cr from jsonb_array_elements(pur_change_requests('pending')) x where x ->> 'id' = current_setting('v2a2.cr_stale');
  assert (v_cr ->> 'changed_since')::boolean, 'R3c the owner is warned: the unit check changed the purchase';
  r := pur_decide_change(gen_random_uuid(), current_setting('v2a2.cr_stale')::uuid, true, null);
  assert r ->> 'status' = 'stale', 'R3d approval refused after the unit check: ' || r::text;
  assert (select (x ->> 'bought')::numeric from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line2')) = 24, 'D3 covered after the owner''s check';
  assert (select kind from purchase_history where purchase_id = current_setting('v2a2.boxp')::uuid order by id desc limit 1) = 'unit_checked', 'D4 audited';
  r := pur_decide_change(gen_random_uuid(), current_setting('v2a2.cr')::uuid, true, null);
  assert r ->> 'status' = 'approved', 'G3 approved: ' || r::text;
  assert (select folder_id from purchase_lines where purchase_id = current_setting('v2a2.pid')::uuid) = current_setting('v2a2.b')::uuid, 'G4 moved to B';
  assert (select (x ->> 'bought')::numeric from jsonb_array_elements(pur_shopping_list(null, null, 'all')) x where x ->> 'line_id' = current_setting('v2a2.line')) = 0, 'G5 no longer covers the request';
  assert (select reason from purchase_history where purchase_id = current_setting('v2a2.pid')::uuid order by id desc limit 1) like '%requested by%', 'G6 history names the requester';
  perform set_config('v2a2.pline', (select id::text from purchase_lines where purchase_id = current_setting('v2a2.pid')::uuid), true);
  perform pur_set_buyer(current_setting('v2a2.staff')::uuid, false);
end $$;

-- ═══ H. Isolation ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  assert not pur_buyer(), 'H3 switched off';
  assert not uploads_can_read('purchases/' || current_setting('v2a2.owner') || '/2026-10/00000000-0000-0000-0000-000000000001.jpg', null),
    'H4 a non-buyer cannot read purchase receipts';
  -- 2A-1 unchanged: staff still record from the Expenses / Project Control form
  perform pur_record(gen_random_uuid(), jsonb_build_object('purchase_date', '2026-10-14', 'receipt_total', 10,
    'lines', jsonb_build_array(jsonb_build_object('folder_id', current_setting('v2a2.a'), 'item_name', 'ZZ 2a2 nails', 'amount', 10))));
  -- R4. … but read no purchase row — Project Control gets only the line it edits.
  assert not exists (select 1 from purchases) and not exists (select 1 from purchase_lines)
     and not exists (select 1 from purchase_history) and not exists (select 1 from purchase_change_requests),
    'R4a a non-buyer read purchase rows';
  r := pur_entry_row(current_setting('v2a2.pline')::uuid, null);
  assert r -> 'line' ->> 'item_name' = 'ZZ 2a2 cement' and (r ->> 'line_count')::int = 1
     and not (r ? 'covers') and not (r -> 'purchase' ? 'bought_by'), 'R4b the edit form''s line, nothing more: ' || r::text;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a2.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_shopping_list();
    raise exception 'H5 a worker read the shopping list';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%', 'H5 wrong error: ' || sqlerrm;
  end;
  assert not exists (select 1 from purchase_line_covers), 'H6 a worker reads no covers';
  assert not exists (select 1 from suppliers), 'H7 a worker reads no suppliers';
end $$;

reset role;
select '2a2 acceptance: all checks passed' as result;
rollback;
