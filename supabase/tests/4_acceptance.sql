-- ════════════════════════════════════════════════════════════════════
-- Stage 4 acceptance — migration 0109 (live behaviour, reconciliation).
--
-- Self-wrapped in begin / rollback: nothing persists — not the ZZ projects,
-- item, purchases, stock records, cost moves, their expense rows and log,
-- the "Cover is right" mark or the bill tick. Editor-safe (set_config 'v4.*',
-- no temp objects). Needs one active main owner allowed Expenses, an active
-- staff account of theirs allowed Expenses, an active worker, and stock
-- switched ON (it is, since 28 Oct 2026). Run it through MCP execute_sql.
-- Success ends with the row 'stage 4 acceptance: all checks passed'.
--   A. every REAL purchase on record already adds up (read-only check)
--   B. a ZZ purchase in a month with no billing period waits; "Cover is
--      right" clears it without moving money; withdrawing puts it back
--   C. a ZZ warehouse lot issued to a ZZ project: approved → a bill to check
--      with its months; ticked; reversed → its own item; adds up throughout
--   D. money still out and waiting: the main owner's keys
--   E. staff and a worker are refused; history is locked; helpers internal
--   F. nothing outside the ZZ rows changed
--   G. Add Expense's saves (R120): an id is registered before it is sent;
--      recovery cancels one the server has not seen, and that save's first
--      request arriving afterwards is refused
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_a uuid; v_b uuid; v_pa uuid; v_pb uuid; v_item uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_old date := (now() at time zone 'Asia/Manila')::date - 100;
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
  assert coalesce((select enabled from stk_settings where owner_id = v_owner), false), 'stock must be on live';
  assert not exists (select 1 from folders where name like 'ZZ 4 %'), 'no "ZZ 4 …" project may exist before the run';
  -- What must not change (F).
  perform set_config('v4.expenses', (select md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '-') || ':'
                       || coalesce(folder_id::text, '-') || ':' || amount::text || ':' || coalesce(cover_expense, false)::text, ','
                       order by id), '')) from expenses), true);
  perform set_config('v4.flags', (select coalesce(string_agg(purchase_id::text || ':' || line_no, ',' order by purchase_id, line_no), '')
                                    from purchase_lines where needs_funding_review), true);
  perform set_config('v4.payments', (select count(*)::text from pur_payments), true);
  perform set_config('v4.marks', (select count(*)::text from rec_cover_marks), true);
  perform set_config('v4.ticks', (select count(*)::text from rec_bill_checks), true);
  perform set_config('v4.log', (select count(*)::text from rec_cost_row_log), true);
  insert into folders (owner_id, name) values (v_owner, 'ZZ 4 A') returning id into v_a;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 4 B') returning id into v_b;
  -- A's only billing period is ~100 days ago: a purchase today has no matching month.
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_a, to_char(v_old, 'FMMonth'), extract(year from v_old)::int, 'progress', 1) returning id into v_pa;
  insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
  values (v_owner, v_b, to_char(v_today, 'FMMonth'), extract(year from v_today)::int, 'progress', 1) returning id into v_pb;
  insert into project_budgets (project_id, owner_id, monthly_budget) values (v_pa, v_owner, 100000), (v_pb, v_owner, 100000);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, created_by)
  values (v_owner, 'material', 'ZZ 4 cement', 'acceptance', 'bag', v_owner) returning id into v_item;
  perform set_config('v4.owner', v_owner::text, true);
  perform set_config('v4.staff', v_staff::text, true);
  perform set_config('v4.worker', v_worker::text, true);
  perform set_config('v4.a', v_a::text, true);
  perform set_config('v4.b', v_b::text, true);
  perform set_config('v4.item', v_item::text, true);
  perform set_config('v4.today', v_today::text, true);
end $$;

-- ═══ A + B. The main owner: every real purchase adds up; "Cover is right" on a ZZ line ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.owner'), 'role', 'authenticated')::text, true);
do $$
declare
  r jsonb; v_pid uuid; v_mark uuid;
  v_today text := current_setting('v4.today');
begin
  -- A1: every recorded purchase in ten years, the real ones included, adds up.
  r := rec_purchase_places(((v_today::date) - 3650)::text, v_today);
  assert (r -> 'totals' ->> 'with_difference')::int = 0, 'A1 a purchase does not add up: ' || (r -> 'totals')::text;
  assert (r -> 'totals' ->> 'difference')::numeric = 0, 'A2 total difference';
  -- B1: a ZZ purchase today on A (no October-style period): Cover, waiting.
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', v_today, 'supplier', 'ZZ 4 supplier',
         'receipt_total', 344, 'no_receipt_reason', 'acceptance',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'project', 'folder_id', current_setting('v4.a'),
                    'item_name', 'ZZ 4 paint', 'category', 'Materials', 'unit', 'lot', 'quantity', 1, 'amount', 344,
                    'unplanned_reason', 'acceptance'))));
  v_pid := (r ->> 'purchase_id')::uuid;
  perform set_config('v4.pid', v_pid::text, true);
  assert exists (select 1 from jsonb_array_elements(rec_review_lines() -> 'waiting') x where (x ->> 'purchase_id')::uuid = v_pid),
    'B1 the ZZ line waits for a billing period';
  begin
    perform rec_accept_cover(gen_random_uuid(), v_pid, 1, '  ');
    raise exception 'B2 accepted without a reason';
  exception when others then assert sqlerrm like '%REASON_REQUIRED%', 'B2 wrong error: ' || sqlerrm;
  end;
  v_mark := (rec_accept_cover(gen_random_uuid(), v_pid, 1, 'ZZ acceptance: Cover is right') ->> 'mark_id')::uuid;
  perform set_config('v4.mark', v_mark::text, true);
  assert not exists (select 1 from jsonb_array_elements(rec_review_lines() -> 'waiting') x where (x ->> 'purchase_id')::uuid = v_pid),
    'B3 no longer waiting';
  r := rec_purchase_places(v_today, v_today);
  assert (select array[(x ->> 'own')::numeric, (x ->> 'difference')::numeric] from jsonb_array_elements(r -> 'purchases') x
           where (x ->> 'id')::uuid = v_pid) = array[344, 0]::numeric[], 'B4 still ₱344 in its project''s Spent';
  assert (select (x ->> 'current')::boolean from jsonb_array_elements(rec_review_lines() -> 'marks') x
           where (x ->> 'id')::uuid = v_mark), 'B5 the mark applies';
  perform rec_withdraw_cover(gen_random_uuid(), v_mark, 'ZZ acceptance: withdrawn');
  assert exists (select 1 from jsonb_array_elements(rec_review_lines() -> 'waiting') x where (x ->> 'purchase_id')::uuid = v_pid),
    'B6 waiting again after the withdrawal';
  r := rec_purchase_places(v_today, v_today);
  assert (select (x ->> 'difference')::numeric from jsonb_array_elements(r -> 'purchases') x where (x ->> 'id')::uuid = v_pid) = 0,
    'B7 the ZZ purchase adds up';
end $$;

-- ═══ C. A ZZ warehouse lot to project B: a bill to check ═══
do $$
declare
  r jsonb; v_pid uuid; v_cm uuid; g jsonb;
  v_today text := current_setting('v4.today');
begin
  r := pur_record(gen_random_uuid(), jsonb_build_object('source', 'purchasing', 'purchase_date', v_today, 'supplier', 'ZZ 4 supplier',
         'receipt_total', 1000, 'no_receipt_reason', 'acceptance',
         'lines', jsonb_build_array(jsonb_build_object('destination', 'warehouse', 'item_name', 'ZZ 4 cement', 'category', 'Materials',
                    'unit', 'bag', 'quantity', 10, 'amount', 1000, 'unplanned_reason', 'acceptance'))));
  v_pid := (r ->> 'purchase_id')::uuid;
  perform set_config('v4.wpid', v_pid::text, true);
  perform stk_match(gen_random_uuid(), v_pid, 1, current_setting('v4.item')::uuid, '10', null);
  perform stk_receive(gen_random_uuid(), v_pid, 1, '10', v_today, '');
  r := stk_move(gen_random_uuid(), jsonb_build_object('item_id', current_setting('v4.item'), 'from', 'warehouse',
         'to', current_setting('v4.b'), 'quantity', '4', 'on', v_today, 'unplanned_reason', 'acceptance'));
  v_cm := (r -> 'cost_moves' ->> 0)::uuid;
  assert (rec_waiting() ->> 'cost_moves')::int >= 1, 'C1 a cost move waits';
  perform stk_cost_decide(gen_random_uuid(), v_cm, true, 'acceptance');
  select x into g from jsonb_array_elements(rec_bills()) x where (x ->> 'cost_move_id')::uuid = v_cm and x ->> 'change' = 'approved';
  assert g is not null, 'C2 the approval is a bill to check';
  assert (g ->> 'checked')::boolean = false and jsonb_array_length(g -> 'sides') = 1
         and (g -> 'sides' -> 0 ->> 'amount')::numeric = 400 and g -> 'sides' -> 0 ->> 'project' = 'ZZ 4 B',
    'C3 its months: ' || (g -> 'sides')::text;
  perform rec_bill_check(gen_random_uuid(), v_cm, g ->> 'group', true, 'ZZ acceptance');
  assert (select (x ->> 'checked')::boolean from jsonb_array_elements(rec_bills()) x
           where (x ->> 'cost_move_id')::uuid = v_cm and x ->> 'change' = 'approved'), 'C4 ticked';
  r := rec_purchase_places(v_today, v_today);
  assert (select array[(x ->> 'other')::numeric, (x ->> 'company')::numeric, (x ->> 'difference')::numeric]
            from jsonb_array_elements(r -> 'purchases') x where (x ->> 'id')::uuid = v_pid) = array[400, 600, 0]::numeric[],
    'C5 ₱400 in B, ₱600 company stock';
  perform stk_cost_reverse(gen_random_uuid(), v_cm, 'acceptance');
  assert exists (select 1 from jsonb_array_elements(rec_bills()) x
                  where (x ->> 'cost_move_id')::uuid = v_cm and x ->> 'change' = 'reversed' and not (x ->> 'checked')::boolean),
    'C6 the reversal is its own item, not checked';
  r := rec_purchase_places(v_today, v_today);
  assert (select (x ->> 'company')::numeric from jsonb_array_elements(r -> 'purchases') x where (x ->> 'id')::uuid = v_pid) = 1000,
    'C7 back to company stock';
end $$;

-- ═══ D. Money still out and waiting: the main owner's keys ═══
do $$
declare m jsonb; w jsonb;
begin
  m := rec_money_out();
  assert m ? 'owed' and m ? 'not_tracked' and m ? 'credits' and m ? 'overpaid' and m ? 'buyers', 'D1 money out keys: ' || m::text;
  w := rec_waiting();
  assert w ? 'billing_period' and w ? 'unpaid' and w ? 'bills' and w ? 'own_money' and w ? 'returns' and w ? 'overpaid',
    'D2 waiting keys: ' || w::text;
end $$;

-- ═══ E. Staff and a worker are refused ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform rec_purchase_places(current_setting('v4.today'), current_setting('v4.today')); raise exception 'E1 staff read places';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E1 wrong error: ' || sqlerrm; end;
  begin perform rec_money_out(); raise exception 'E2 staff read money out';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E2 wrong error: ' || sqlerrm; end;
  begin perform rec_accept_cover(gen_random_uuid(), current_setting('v4.pid')::uuid, 1, 'staff'); raise exception 'E3 staff marked Cover';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E3 wrong error: ' || sqlerrm; end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform rec_waiting(); raise exception 'E4 a worker read waiting';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E4 wrong error: ' || sqlerrm; end;
  begin perform rec_bills(); raise exception 'E5 a worker read the bills';
  exception when others then assert sqlerrm like '%OWNER_ONLY%', 'E5 wrong error: ' || sqlerrm; end;
end $$;

-- ═══ G. Add Expense's saves (R120) ═══
-- (Recovery settles every unsettled save of the account — inside this rolled-back run only.)
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.owner'), 'role', 'authenticated')::text, true);
do $$
declare
  v_x uuid := gen_random_uuid(); v_y uuid := gen_random_uuid(); r jsonb;
  v_body jsonb := jsonb_build_object('source', 'expenses_form', 'purchase_date', current_setting('v4.today'), 'receipt_total', 60,
         'no_receipt_reason', 'acceptance', 'lines', jsonb_build_array(jsonb_build_object('destination', 'project',
         'folder_id', current_setting('v4.b'), 'item_name', 'ZZ 4 glue', 'category', 'Materials', 'unit', 'pc', 'quantity', 1, 'amount', 60)));
begin
  perform pur_op_reserve(v_x);
  perform pur_op_reserve(v_x);                                  -- registered again: harmless
  perform pur_op_reserve(v_y);
  perform pur_record(v_x, v_body);                              -- x reached the server (its reply may be lost)
  r := pur_op_recover();                                        -- the browser lost the id: settle them all
  assert (r ->> 'cancelled')::int >= 1, 'G1 recovery cancelled nothing: ' || r::text;
  assert pur_op_state(v_x) = 'recorded' and pur_op_state(v_y) = 'cancelled', 'G2 recorded stays recorded; the other is cancelled';
  begin
    perform pur_record(v_y, v_body);                            -- y's first request, arriving after the list was checked
    raise exception 'G3 a cancelled save was recorded';
  exception when others then assert sqlerrm like '%OP_CANCELLED%', 'G3 wrong error: ' || sqlerrm;
  end;
  assert (pur_op_recover() ->> 'cancelled')::int = 0, 'G5 nothing left to settle';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v4.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform pur_op_recover(); raise exception 'G6 a worker recovered';
  exception when others then assert sqlerrm like '%NOT_OFFICE%', 'G6 wrong error: ' || sqlerrm; end;
end $$;

-- ═══ E (cont.) + F. History locked; helpers internal; nothing outside ZZ changed ═══
reset role;
do $$
begin
  begin
    delete from rec_cover_marks where id = current_setting('v4.mark')::uuid;
    raise exception 'E6 a mark was deleted';
  exception when others then assert sqlerrm like '%HISTORY_LOCKED%', 'E6 wrong error: ' || sqlerrm;
  end;
  begin
    delete from rec_cost_row_log;
    raise exception 'E7 the log was deleted';
  exception when others then assert sqlerrm like '%HISTORY_LOCKED%', 'E7 wrong error: ' || sqlerrm;
  end;
  assert not has_function_privilege('anon', 'rec_purchase_places(text,text)', 'execute'), 'E8 anon cannot read';
  assert not has_function_privilege('authenticated', 'rec_owner()', 'execute'), 'E9 internal';
  assert not has_function_privilege('authenticated', 'rec_line_key(uuid,integer)', 'execute'), 'E10 internal';
  assert (select count(*) from pg_policies where tablename in ('rec_cover_marks', 'rec_cost_row_log', 'rec_bill_checks',
                                                                'pur_op_reservations')) = 0,
    'E11 no direct table access';
  assert (select relrowsecurity from pg_class where relname = 'pur_op_reservations'), 'E12 reservations: RLS on';
  assert (select count(distinct purchase_id) from purchase_lines where item_name = 'ZZ 4 glue') = 1,
    'G4 exactly one ZZ glue purchase — the cancelled save''s late request recorded nothing';
  -- F: every expense row outside the ZZ projects is as it was; no real line's mark, no payment, no tick changed.
  assert (select md5(coalesce(string_agg(e.id::text || ':' || coalesce(e.project_id::text, '-') || ':'
                     || coalesce(e.folder_id::text, '-') || ':' || e.amount::text || ':' || coalesce(e.cover_expense, false)::text, ','
                     order by e.id), ''))
            from expenses e
           where coalesce(e.folder_id, (select p.folder_id from projects p where p.id = e.project_id))
                 not in (current_setting('v4.a')::uuid, current_setting('v4.b')::uuid)) = current_setting('v4.expenses'),
    'F1 a real expense row changed';
  assert (select coalesce(string_agg(purchase_id::text || ':' || line_no, ',' order by purchase_id, line_no), '')
            from purchase_lines where needs_funding_review
             and purchase_id <> current_setting('v4.pid')::uuid) = current_setting('v4.flags'),
    'F2 a real line''s "Office review" mark changed';
  assert (select count(*)::text from pur_payments) = current_setting('v4.payments'), 'F3 a payment was recorded';
  assert (select count(*) from rec_cover_marks)::text = (current_setting('v4.marks')::int + 1)::text, 'F4 only the ZZ mark';
  assert (select count(*) from rec_bill_checks)::text = (current_setting('v4.ticks')::int + 1)::text, 'F5 only the ZZ tick';
  assert (select count(*) from rec_cost_row_log)::text = (current_setting('v4.log')::int + 2)::text,
    'F6 the log: the ZZ approval''s row and the reversal''s';
  assert (select array_agg(e.cover_expense) = array[true] and sum(e.amount) = 344
            from expenses e join purchase_lines l on l.id = e.purchase_line_id where l.purchase_id = current_setting('v4.pid')::uuid),
    'F7 the ZZ line is still ₱344 on Cover — marking and withdrawing moved nothing';
end $$;

select 'stage 4 acceptance: all checks passed' as result;
rollback;
