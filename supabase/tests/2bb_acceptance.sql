-- ════════════════════════════════════════════════════════════════════
-- Stage 2B-b acceptance — migration 0106 (live: "From stock" on the workers'
-- requests; settling a stock submission whose answer was lost). Self-wrapped in
-- begin / rollback: section D writes one cancel mark, which is rolled back.
-- Run it through MCP execute_sql. Success ends with the row
-- '2bb acceptance: all checks passed'.
--   A. every worker and team leader who has requests reads them with
--      `from_stock` on each line and each weekly portion — 0 while stock is off;
--   B. the answer carries no money and no stock detail;
--   C. anon cannot call it; stock is still off; the cancel and state
--      functions are for signed-in accounts only, pur_op_begin for nobody;
--   D. as the main owner: a fresh operation id reads 'none'; cancelling it
--      says 'cancelled' (twice: the same answer); the operation lock every
--      write takes before recording (pur_op_begin) then refuses that id
--      OP_CANCELLED. (While stock is off a stock write stops even earlier,
--      STOCK_OFF — so the lock is called directly here, with the same claims.)
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';

do $$
declare
  w record;
  doc jsonb;
  n_people int := 0;
  n_lines int := 0;
  v_owner uuid := (select id from profiles where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active'
                     order by created_at limit 1);
  v_op uuid := gen_random_uuid();
  v_err text;
begin
  assert not coalesce((select s.enabled from stk_settings s where s.owner_id = v_owner), false), 'stock must still be off live';
  for w in select distinct p.id from profiles p join pr_requests r on r.requester_id = p.id
            where p.role in ('worker', 'teamLeader') and coalesce(p.status, 'active') = 'active' loop
    perform set_config('request.jwt.claims', json_build_object('sub', w.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    doc := pr_my_requests(200);
    execute 'reset role';
    n_people := n_people + 1;
    assert jsonb_typeof(doc) = 'array', 'A1 a list for ' || w.id;
    assert not exists (select 1 from jsonb_array_elements(doc) r, jsonb_array_elements(r -> 'lines') l
                        where not (l ? 'from_stock') or (l ->> 'from_stock')::numeric <> 0
                           or exists (select 1 from jsonb_array_elements(l -> 'portions') p
                                       where not (p ? 'from_stock') or (p ->> 'from_stock')::numeric <> 0)),
      'A2 every line and portion says from_stock, 0 while stock is off — ' || w.id;
    n_lines := n_lines + (select count(*) from jsonb_array_elements(doc) r, jsonb_array_elements(r -> 'lines') l);
    assert doc::text !~ '"(amount|price|cost[a-z_]*|value|peso|supplier[a-z_]*|lot_id|location[a-z_]*)"\s*:',
      'B1 no money and no stock detail — ' || w.id;
  end loop;
  assert not has_function_privilege('anon', 'pr_my_requests(integer)', 'execute'), 'C1 anon cannot read requests';
  assert has_function_privilege('authenticated', 'pr_my_requests(integer)', 'execute'), 'C2 signed-in workers can';
  assert has_function_privilege('authenticated', 'pur_op_cancel(uuid)', 'execute')
     and not has_function_privilege('anon', 'pur_op_cancel(uuid)', 'execute'), 'C3 pur_op_cancel: signed-in only';
  assert has_function_privilege('authenticated', 'pur_op_state(uuid)', 'execute')
     and not has_function_privilege('anon', 'pur_op_state(uuid)', 'execute'), 'C4 pur_op_state: signed-in only';
  assert not has_function_privilege('authenticated', 'pur_op_begin(uuid)', 'execute')
     and not has_function_privilege('anon', 'pur_op_begin(uuid)', 'execute'), 'C5 pur_op_begin: nobody calls it directly';

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  assert pur_op_state(v_op) = 'none', 'D1 a fresh id reads none';
  assert pur_op_cancel(v_op) = 'cancelled', 'D2 cancelled';
  assert pur_op_cancel(v_op) = 'cancelled', 'D3 cancelling again gives the same answer';
  assert pur_op_state(v_op) = 'cancelled', 'D4 it reads cancelled';
  execute 'reset role';
  begin
    perform pur_op_begin(v_op);
  exception when others then
    v_err := sqlerrm;
  end;
  assert v_err = 'OP_CANCELLED', 'D5 the operation lock refuses a cancelled id — got ' || coalesce(v_err, 'no refusal');
  raise notice 'checked % workers / leaders, % request lines', n_people, n_lines;
end $$;

select '2bb acceptance: all checks passed' as result;
rollback;
