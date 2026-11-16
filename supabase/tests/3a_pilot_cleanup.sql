-- ════════════════════════════════════════════════════════════════════
-- WorkMate 3a tools pilot (Q24): remove the "ZZ 3a pilot" test data.
--
-- Run by the USER in the Supabase SQL editor, after the pilot (plan
-- docs/superpowers/plans/2026-10-28-workmate-stage3a-tools.md, Task 3).
-- One transaction. Any failed guard stops it and changes NOTHING.
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It deletes everything, prints what it
--            removed in a red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- What is "ZZ" (and nothing else is touched):
--   projects  — every folder whose name starts "ZZ 3a pilot" (with their
--               billing periods, budgets and settings: the folder cascade);
--   items     — every catalogue item whose name starts "ZZ 3a";
--   tools     — every tool of a ZZ item or from a ZZ purchase, with its
--               records, request fills and history — and every tool of an
--               older "ZZ …" item (the pilot's TOOL-0007 was registered on
--               "ZZ pilot drill"); that older item itself is kept;
--   purchases — every purchase with a line on a ZZ project, or a warehouse
--               line whose item name starts "ZZ 3a" (all of its lines must be ZZ);
--   stock     — every stock record of a ZZ item or of a ZZ purchase (the
--               pilot makes none: tools are never stock), as the 2B/2C clean-up;
--   requests  — every request for a ZZ project (lines, weekly portions,
--               events, conflicts, photo rows);
--   suppliers — named "ZZ 3a…" that no remaining purchase uses.
-- Not touched: the tools and stock switches (tl_settings / stk_settings and
-- their "switched" events), the company warehouse place, real projects,
-- items, tools, purchases, requests, stock and expenses, the workers the
-- ZZ tools were issued to, operation ids (pur_ops), and photo FILES (see the
-- end). The history guards of tools and stock are switched off for this
-- transaction only, and checked back on before it ends. The pilot's tool
-- numbers go with their rows: the first real tool is TOOL-0001.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_dry boolean := true;
  zf uuid[]; zi uuid[]; zp uuid[]; zl uuid[]; zc uuid[]; zloc uuid[]; zlot uuid[]; zr uuid[]; zcm uuid[];
  zreq uuid[]; zrl uuid[]; zpor uuid[]; zper uuid[]; zt uuid[]; ztr uuid[]; zany uuid[];
  real_tools bigint; real_tl_rec bigint;
  real_exp_n bigint; real_exp_sum numeric; real_pur bigint; real_rec bigint; real_mov bigint; real_cm bigint; real_req bigint;
  n int; real_rec_tmp int; msg text := '';
begin
  -- ---------- what is ZZ ----------
  select coalesce(array_agg(id), '{}') into zf from folders where name like 'ZZ 3a pilot%';
  if cardinality(zf) = 0 then
    raise exception 'GUARD: no project named "ZZ 3a pilot…" — nothing to clean';
  end if;
  if exists (select 1 from folders f where f.parent_folder_id = any(zf) and not f.id = any(zf)) then
    raise exception 'GUARD: a job under a ZZ project is not named "ZZ 3a pilot…"';
  end if;
  if exists (select 1 from folders f where f.id = any(zf) and f.parent_folder_id is not null and not f.parent_folder_id = any(zf)) then
    raise exception 'GUARD: a "ZZ 3a pilot…" job sits under a real project';
  end if;
  select coalesce(array_agg(id), '{}') into zper from projects where folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zi from pr_catalog_items where name like 'ZZ 3a%';
  select coalesce(array_agg(distinct purchase_id), '{}') into zp from purchase_lines
   where folder_id = any(zf) or (destination = 'warehouse' and item_name like 'ZZ 3a%');
  if exists (select 1 from purchase_lines where purchase_id = any(zp)
              and not (folder_id = any(zf) or (destination = 'warehouse' and item_name like 'ZZ 3a%'))) then
    raise exception 'GUARD: a ZZ purchase also has a real line — stop and check';
  end if;
  select coalesce(array_agg(id), '{}') into zl from purchase_lines where purchase_id = any(zp);
  select coalesce(array_agg(id), '{}') into zc from purchase_charges where purchase_id = any(zp);
  if exists (select 1 from pur_payments where purchase_id = any(zp) or first_purchase_id = any(zp))
     or exists (select 1 from pur_refunds where purchase_id = any(zp))
     or exists (select 1 from pur_supplier_credits where purchase_id = any(zp)) then
    raise exception 'GUARD: a ZZ purchase has payments, refunds or credits (the pilot records none) — stop and check';
  end if;

  -- Requests for ZZ projects; ZZ items never on a real request, nor ZZ requests filled by real purchases.
  select coalesce(array_agg(id), '{}') into zreq from pr_requests where folder_id = any(zf) or work_folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zrl from pr_lines where request_id = any(zreq);
  select coalesce(array_agg(id), '{}') into zpor from pr_line_portions where line_id = any(zrl);
  if exists (select 1 from pr_lines where catalog_item_id = any(zi) and not request_id = any(zreq)) then
    raise exception 'GUARD: a ZZ item is on a real request';
  end if;
  if exists (select 1 from purchase_lines where request_line_id = any(zrl) and not purchase_id = any(zp))
     or exists (select 1 from purchase_line_covers where (request_line_id = any(zrl) or portion_id = any(zpor)) and not line_id = any(zl)) then
    raise exception 'GUARD: a real purchase covers a ZZ request';
  end if;
  if exists (select 1 from wp_blockers where request_id = any(zreq)) then
    raise exception 'GUARD: a Work Plan blocker points at a ZZ request';
  end if;

  -- Stock: ZZ items and ZZ purchases only, at the warehouse or ZZ sites only.
  select coalesce(array_agg(id), '{}') into zloc from stk_locations where folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zlot from stk_lots where item_id = any(zi) or purchase_id = any(zp);
  if exists (select 1 from stk_lots where id = any(zlot) and not item_id = any(zi)) then
    raise exception 'GUARD: a ZZ purchase was matched to a real catalogue item';
  end if;
  if exists (select 1 from stk_lots where item_id = any(zi) and purchase_id is not null and not purchase_id = any(zp)) then
    raise exception 'GUARD: a ZZ item has stock from a real purchase';
  end if;
  if exists (select 1 from stk_matches where (item_id = any(zi)) <> (purchase_id = any(zp))) then
    raise exception 'GUARD: a match mixes a ZZ item with a real purchase (or the other way)';
  end if;
  select coalesce(array_agg(id), '{}') into zr from stk_records
   where item_id = any(zi) or purchase_id = any(zp) or lot_id = any(zlot);
  if exists (select 1 from stk_records where (from_location = any(zloc) or to_location = any(zloc)) and not id = any(zr)) then
    raise exception 'GUARD: real goods were recorded at a ZZ site';
  end if;
  if exists (select 1 from stk_records r where r.id = any(zr) and (
               (r.from_location is not null and not r.from_location = any(zloc)
                and r.from_location <> (select id from stk_locations w where w.owner_id = r.owner_id and w.kind = 'warehouse'))
            or (r.to_location is not null and not r.to_location = any(zloc)
                and r.to_location <> (select id from stk_locations w where w.owner_id = r.owner_id and w.kind = 'warehouse')))) then
    raise exception 'GUARD: ZZ goods were recorded at a real project''s site';
  end if;
  if exists (select 1 from stk_records where id = any(zr) and request_line_id is not null and not request_line_id = any(zrl))
     or exists (select 1 from stk_covers where (request_line_id = any(zrl) or portion_id = any(zpor)) and not record_id = any(zr))
     or exists (select 1 from stk_moves where (record_id = any(zr)) <> (lot_id = any(zlot))) then
    raise exception 'GUARD: ZZ stock and real requests or real stock are mixed';
  end if;
  select coalesce(array_agg(id), '{}') into zcm from stk_cost_moves where lot_id = any(zlot);
  if exists (select 1 from stk_cost_moves where (from_folder = any(zf) or to_folder = any(zf)) and not id = any(zcm))
     or exists (select 1 from stk_cost_moves where id = any(zcm)
                 and ((from_folder is not null and not from_folder = any(zf)) or (to_folder is not null and not to_folder = any(zf)))) then
    raise exception 'GUARD: a cost move links a ZZ project and real stock (or the other way)';
  end if;

  -- Tools: ZZ items (any "ZZ …" item — no tool existed before this pilot)
  -- and ZZ purchases only, on ZZ projects or the warehouse only.
  select coalesce(array_agg(id), '{}') into zany from pr_catalog_items where name like 'ZZ %';
  select coalesce(array_agg(id), '{}') into zt from tl_tools where item_id = any(zany) or purchase_id = any(zp);
  select coalesce(array_agg(id), '{}') into ztr from tl_records where tool_id = any(zt);
  if exists (select 1 from tl_tools where id = any(zt) and not item_id = any(zany)) then
    raise exception 'GUARD: a tool from a ZZ purchase was registered as a real catalogue item';
  end if;
  if exists (select 1 from tl_records where id = any(ztr) and folder_id is not null and not folder_id = any(zf))
     or exists (select 1 from tl_tools where id = any(zt) and folder_id is not null and not folder_id = any(zf)) then
    raise exception 'GUARD: a ZZ tool was recorded on a real project';
  end if;
  if exists (select 1 from tl_records where not id = any(ztr) and (folder_id = any(zf) or request_line_id = any(zrl))) then
    raise exception 'GUARD: a real tool was recorded on a ZZ project or request';
  end if;
  if exists (select 1 from tl_records where id = any(ztr) and request_line_id is not null and not request_line_id = any(zrl))
     or exists (select 1 from tl_covers where (request_line_id = any(zrl) or portion_id = any(zpor)) and not record_id = any(ztr))
     or exists (select 1 from tl_covers where record_id = any(ztr) and not request_line_id = any(zrl)) then
    raise exception 'GUARD: ZZ tools and real requests are mixed';
  end if;

  -- Nothing real hangs on a ZZ project.
  if exists (select 1 from construction_projects where folder_id = any(zf))
     or exists (select 1 from wp_tasks where folder_id = any(zf) or work_folder_id = any(zf))
     or exists (select 1 from payroll where project_id = any(zper))
     or exists (select 1 from overhead_expenses where folder_id = any(zf) or billing_period_id = any(zper))
     or exists (select 1 from reimbursements where folder_id = any(zf))
     or exists (select 1 from labor_contracts where folder_id = any(zf)) then
    raise exception 'GUARD: payroll, overhead, a contract, a reimbursement, a construction project or a Work Plan task is on a ZZ project';
  end if;
  if exists (select 1 from expenses
              where (folder_id = any(zf) or project_id = any(zper))
                and not (coalesce(purchase_line_id = any(zl), false) or coalesce(purchase_charge_id = any(zc), false)
                         or coalesce(stk_cost_move_id = any(zcm), false))) then
    raise exception 'GUARD: a hand-entered expense is on a ZZ project — stop and check';
  end if;
  if exists (select 1 from expenses where stk_cost_move_id = any(zcm)
              and not (coalesce(folder_id = any(zf), false) or coalesce(project_id = any(zper), false))) then
    raise exception 'GUARD: a ZZ cost move wrote a row on a real project';
  end if;
  if exists (select 1 from pr_gallery_photos where catalog_item_id = any(zi)) then
    raise exception 'GUARD: a ZZ item has gallery photos (the pilot adds none) — stop and check';
  end if;

  -- ---------- the real data, before ----------
  select count(*), coalesce(sum(amount), 0) into real_exp_n, real_exp_sum from expenses
   where not (coalesce(folder_id = any(zf), false) or coalesce(project_id = any(zper), false)
              or coalesce(purchase_line_id = any(zl), false) or coalesce(purchase_charge_id = any(zc), false)
              or coalesce(stk_cost_move_id = any(zcm), false));
  select count(*) into real_pur from purchases where not id = any(zp);
  select count(*) into real_rec from stk_records where not id = any(zr);
  select count(*) into real_mov from stk_moves where not record_id = any(zr);
  select count(*) into real_cm from stk_cost_moves where not id = any(zcm);
  select count(*) into real_req from pr_requests where not id = any(zreq);
  select count(*) into real_tools from tl_tools where not id = any(zt);
  select count(*) into real_tl_rec from tl_records where not id = any(ztr);

  -- ---------- tools (their history guards are off for this transaction only) ----------
  execute 'alter table tl_events disable trigger tl_events_no_change';
  execute 'alter table tl_covers disable trigger tl_covers_no_change';
  execute 'alter table tl_records disable trigger tl_records_no_delete';
  execute 'alter table tl_tools disable trigger tl_tools_no_delete';
  delete from tl_events where record_id = any(ztr);
  get diagnostics n = row_count; msg := msg || 'tool events ' || n;
  delete from tl_covers where record_id = any(ztr);
  get diagnostics n = row_count; msg := msg || ', tool request fills ' || n;
  delete from tl_records where id = any(ztr);
  get diagnostics n = row_count; msg := msg || ', tool records ' || n;
  delete from tl_tools where id = any(zt);
  get diagnostics n = row_count; msg := msg || ', tools ' || n || ', ';
  execute 'alter table tl_events enable trigger tl_events_no_change';
  execute 'alter table tl_covers enable trigger tl_covers_no_change';
  execute 'alter table tl_records enable trigger tl_records_no_delete';
  execute 'alter table tl_tools enable trigger tl_tools_no_delete';

  -- ---------- stock (its history guards are off for this transaction only) ----------
  perform set_config('dacs.purchase_write', 'on', true);
  execute 'alter table stk_events disable trigger stk_events_no_change';
  execute 'alter table stk_moves disable trigger stk_moves_no_change';
  execute 'alter table stk_covers disable trigger stk_covers_no_change';
  delete from expenses where stk_cost_move_id = any(zcm) or purchase_line_id = any(zl) or purchase_charge_id = any(zc);
  get diagnostics n = row_count; msg := msg || 'expense rows ' || n;
  delete from stk_events where cost_move_id = any(zcm) or record_id = any(zr) or purchase_id = any(zp);
  get diagnostics n = row_count; msg := msg || ', stock events ' || n;
  update stk_cost_moves set resubmits = null where id = any(zcm) and resubmits is not null;
  delete from stk_cost_moves where id = any(zcm);
  get diagnostics n = row_count; msg := msg || ', cost moves ' || n;
  delete from stk_covers where record_id = any(zr);
  get diagnostics n = row_count; msg := msg || ', request covers ' || n;
  delete from stk_moves where record_id = any(zr);
  get diagnostics n = row_count; msg := msg || ', stock moves ' || n;
  -- Returns first: a return always names its issue (it cannot be blanked).
  delete from stk_records where id = any(zr) and returns_record is not null;
  get diagnostics n = row_count;
  delete from stk_records where id = any(zr);
  get diagnostics real_rec_tmp = row_count; msg := msg || ', stock records ' || (n + real_rec_tmp);
  delete from stk_lots where id = any(zlot);
  get diagnostics n = row_count; msg := msg || ', lots ' || n;
  delete from stk_matches where purchase_id = any(zp) or item_id = any(zi);
  get diagnostics n = row_count; msg := msg || ', matches ' || n;
  delete from stk_locations where id = any(zloc);
  get diagnostics n = row_count; msg := msg || ', sites ' || n;
  execute 'alter table stk_events enable trigger stk_events_no_change';
  execute 'alter table stk_moves enable trigger stk_moves_no_change';
  execute 'alter table stk_covers enable trigger stk_covers_no_change';

  -- ---------- purchases ----------
  delete from purchase_change_requests where purchase_id = any(zp);
  delete from purchase_history where purchase_id = any(zp);
  delete from purchase_charge_shares where line_id = any(zl);
  delete from purchase_stock_moves where line_id = any(zl);
  delete from purchase_line_covers where line_id = any(zl);
  delete from purchase_charges where purchase_id = any(zp);
  delete from purchase_lines where purchase_id = any(zp);
  update purchases set replaced_by = null where id = any(zp) and replaced_by is not null;
  delete from purchases where id = any(zp);
  get diagnostics n = row_count; msg := msg || ', purchases ' || n;
  perform set_config('dacs.purchase_write', '', true);

  -- ---------- requests ----------
  delete from pr_photos where request_id = any(zreq);
  get diagnostics n = row_count; msg := msg || ', request photo rows ' || n;
  delete from pr_line_conflicts where line_id = any(zrl);
  delete from pr_events where request_id = any(zreq);
  delete from pr_line_portions where line_id = any(zrl);
  delete from pr_lines where request_id = any(zreq);
  delete from pr_requests where id = any(zreq);
  get diagnostics n = row_count; msg := msg || ', requests ' || n;

  -- ---------- catalogue, projects, suppliers ----------
  delete from pr_item_refs where catalog_item_id = any(zi);
  delete from pr_catalog_items where id = any(zi);
  get diagnostics n = row_count; msg := msg || ', catalogue items ' || n;
  delete from folders where id = any(zf) and parent_folder_id is not null;
  delete from folders where id = any(zf);
  if exists (select 1 from folders where id = any(zf)) then
    raise exception 'GUARD: a ZZ project is still there';
  end if;
  msg := msg || ', projects ' || cardinality(zf) || ' (with ' || cardinality(zper) || ' billing periods)';
  delete from suppliers s where s.name like 'ZZ 3a%' and not exists (select 1 from purchases p where p.supplier_id = s.id);
  get diagnostics n = row_count; msg := msg || ', suppliers ' || n;

  -- ---------- after: nothing ZZ left, nothing real moved, guards back on ----------
  if exists (select 1 from folders where name like 'ZZ 3a pilot%')
     or exists (select 1 from pr_catalog_items where name like 'ZZ 3a%')
     or exists (select 1 from purchase_lines where item_name like 'ZZ 3a%')
     or exists (select 1 from tl_tools t join pr_catalog_items c on c.id = t.item_id where c.name like 'ZZ %') then
    raise exception 'GUARD: a ZZ row is still there';
  end if;
  if (select count(*) from expenses) <> real_exp_n or (select coalesce(sum(amount), 0) from expenses) <> real_exp_sum then
    raise exception 'GUARD: real expenses changed';
  end if;
  if (select count(*) from purchases) <> real_pur or (select count(*) from stk_records) <> real_rec
     or (select count(*) from stk_moves) <> real_mov or (select count(*) from stk_cost_moves) <> real_cm
     or (select count(*) from pr_requests) <> real_req then
    raise exception 'GUARD: real purchases, stock or requests changed';
  end if;
  if (select count(*) from tl_tools) <> real_tools or (select count(*) from tl_records) <> real_tl_rec then
    raise exception 'GUARD: real tools changed';
  end if;
  if (select count(*) from pg_trigger where tgname in ('tl_events_no_change', 'tl_covers_no_change', 'tl_records_no_delete', 'tl_tools_no_delete')
         and tgenabled = 'O') <> 4 then
    raise exception 'GUARD: a tools history guard is not back on';
  end if;
  if (select count(*) from pg_trigger where tgname in ('stk_events_no_change', 'stk_moves_no_change', 'stk_covers_no_change')
         and tgenabled = 'O') <> 3 then
    raise exception 'GUARD: a stock history guard is not back on';
  end if;
  msg := msg || '. Real: ' || real_exp_n || ' expense rows (₱' || real_exp_sum || '), ' || real_pur || ' purchases, '
         || real_rec || ' stock records, ' || real_cm || ' cost moves, ' || real_req || ' requests, ' || real_tools || ' tools, '
         || real_tl_rec || ' tool records — unchanged; history guards back on.';

  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): would delete %', msg;
  end if;
  raise notice 'CLEAN-UP DONE: deleted %', msg;
end $$;

-- Request photos: the rows are gone, the FILES stay in Storage (Supabase does
-- not delete Storage files from SQL). The pilot takes none; if it did, delete
-- them by hand under request-photos/<worker id>/<request id>/.
