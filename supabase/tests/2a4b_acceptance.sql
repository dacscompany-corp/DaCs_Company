-- ════════════════════════════════════════════════════════════════════
-- Stage 2A-4b acceptance — migration 0103 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists — not the Buyer switch,
-- the petty cash, the return or its upload record. Editor-safe (set_config
-- 'v2a4b.*', no temp objects). Needs one active main owner with an active
-- staff account allowed Expenses, and an active worker. Run it through MCP
-- execute_sql. Success ends with the row '2a4b acceptance: all checks passed'.
--   A. a buyer reports a return with a photo: their own "My cash" carries the photo;
--      the server says that operation id is done — for this buyer only (R38)
--   B. the main owner sees it in that buyer's view; list rows carry supplier_id
--   C. a worker reads no cash at all; pur_cash_detail stays internal
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_owner uuid; v_staff uuid; v_worker uuid; v_today date := (now() at time zone 'Asia/Manila')::date;
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
  perform set_config('v2a4b.owner', v_owner::text, true);
  perform set_config('v2a4b.staff', v_staff::text, true);
  perform set_config('v2a4b.worker', v_worker::text, true);
  perform set_config('v2a4b.today', v_today::text, true);
  perform set_config('v2a4b.path', 'pettyCash/' || v_owner || '/' || to_char(v_today, 'YYYY-MM') || '/' || gen_random_uuid() || '.jpg', true);
end $$;

-- ═══ The main owner: Buyer switch on, petty cash given ═══
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4b.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  perform pur_set_buyer(current_setting('v2a4b.staff')::uuid, true);
  perform pur_cash_give(gen_random_uuid(), current_setting('v2a4b.staff')::uuid, '500', current_setting('v2a4b.today'), 'cash', 'ZZ 2a4b');
end $$;

-- ═══ A. The buyer reports a return with a photo ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4b.staff'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_url text := 'https://example.supabase.co/storage/v1/object/public/uploads/' || current_setting('v2a4b.path');
  v_op uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
begin
  insert into receipt_uploads (path, owner_id, kind) values (current_setting('v2a4b.path'), current_setting('v2a4b.owner')::uuid, 'petty_cash');
  r := pur_cash_report_return(v_op, '200', current_setting('v2a4b.today'), 'ZZ the owner', v_url, 'ZZ 2a4b');
  perform set_config('v2a4b.op', v_op::text, true);
  assert pur_my_ops_done(array[v_op, v_other]) = array[v_op], 'A0 the server has the return''s operation, not an unsent one (R38)';
  perform set_config('v2a4b.ret', r ->> 'return_id', true);
  assert (select x ->> 'photo_url' from jsonb_array_elements(pur_my_cash() -> 'returns') x where x ->> 'id' = current_setting('v2a4b.ret')) = v_url,
    'A1 the buyer''s own My cash carries the photo';
  assert uploads_can_read(current_setting('v2a4b.path'), null), 'A2 and Storage lets them open it';
end $$;

-- ═══ B. The main owner sees it in that buyer's view ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4b.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (select x ->> 'photo_url' from jsonb_array_elements(pur_cash_buyer(current_setting('v2a4b.staff')::uuid) -> 'returns') x
           where x ->> 'id' = current_setting('v2a4b.ret')) like 'https://%' || current_setting('v2a4b.path'), 'B1 the main owner sees the photo';
  assert not exists (select 1 from jsonb_array_elements(pur_purchases(null, null, null, 'all')) x where not (x ? 'supplier_id')),
    'B2 every purchases-list row names its supplier (0103)';
end $$;

-- ═══ C. A worker reads no cash; the detail stays internal ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v2a4b.worker'), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pur_my_cash();
    raise exception 'C1 a worker read cash';
  exception when others then
    assert sqlerrm like '%BUYER_REQUIRED%' or sqlerrm like '%NOT_OFFICE%', 'C1 wrong error: ' || sqlerrm;
  end;
  begin
    perform pur_cash_detail(current_setting('v2a4b.owner')::uuid, current_setting('v2a4b.staff')::uuid);
    raise exception 'C2 pur_cash_detail is callable';
  exception when insufficient_privilege then null;
  end;
  assert not uploads_can_read(current_setting('v2a4b.path'), null), 'C3 a worker cannot open the photo';
  assert pur_my_ops_done(array[current_setting('v2a4b.op')::uuid]) = '{}'::uuid[], 'C4 another account learns nothing of the buyer''s operations';
end $$;
reset role;

select '2a4b acceptance: all checks passed' as result;
rollback;
