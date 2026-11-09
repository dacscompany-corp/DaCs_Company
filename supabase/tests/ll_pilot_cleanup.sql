-- ════════════════════════════════════════════════════════════════════
-- Linked Labor browser check: remove THIS check's test data, and only that.
--
-- Run by the USER in the Supabase SQL editor, after the check, with every
-- office tab on these projects closed. One transaction. Any failed guard
-- stops it and changes NOTHING.
--
-- BEFORE THE FIRST RUN: fill in the three ids just below "declare" (the main
-- owner's account and the two projects). They come from the read-only query
-- run right after the two projects were created. Left as zeros, it refuses.
--
-- RUN IT TWICE:
--   1st run: v_dry as it is. It does everything, prints what it removed in
--            a red "DRY RUN OK" message, then undoes it all.
--   2nd run: on the v_dry line just below "declare", change the word true
--            to false, and run again.
--
-- What it removes, and nothing else:
--   projects  — ONLY the two named by id below, each confirmed by its exact
--               name, its company and being a top-level project, with their
--               billing periods, budgets and allocation rows (the folder
--               cascade). A project is never picked by its name: any other
--               project, even one named "ZZ LL…", is left alone;
--   contracts — the labor contracts on those two projects, and the contracts
--               their history says were created on them (deleted and merged);
--   payments  — the payroll rows on those billing periods or contracts;
--   history   — the lc_events rows of those contracts: this check's own
--               synthetic rows, and only those.
--
-- KEPT, never touched: every other project, billing period, contract, payment
-- and history row; attendance; W-0005's and W-0007's accounts. The history
-- and contract guards are off inside this one transaction only. Before it
-- ends, every audit protection is checked back on, and the history is made
-- to refuse a real edit and delete. No file is involved: the check uploads
-- none, and this script stops if one of these contracts or payments has one.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_dry boolean := true;
  v_company   uuid := '00000000-0000-0000-0000-000000000000';   -- the main owner's account id
  v_project_a uuid := '00000000-0000-0000-0000-000000000000';   -- the id of "ZZ LL check A"
  v_project_b uuid := '00000000-0000-0000-0000-000000000000';   -- the id of "ZZ LL check B"
  v_w5 uuid; v_w7 uuid; v_probe bigint; v_refused int := 0;
  zf uuid[]; zft text[]; zper uuid[]; zloc uuid[]; zc uuid[]; zp uuid[]; zev bigint[];
  real_c text; real_p text; real_e text; real_f text; real_per text; people text;
  real_budgets bigint; real_period_budgets bigint; real_policies bigint; real_alloc bigint; real_adj bigint;
  att_n bigint; exp_n bigint; exp_sum numeric;
  n int; msg text := '';
begin
  perform set_config('lock_timeout', '5s', true);

  -- ---------- exactly these two projects, or stop ----------
  if '00000000-0000-0000-0000-000000000000'::uuid in (v_company, v_project_a, v_project_b) then
    raise exception 'GUARD: fill in the company and the two project ids at the top — nothing has been named to clean';
  end if;
  if v_project_a = v_project_b then
    raise exception 'GUARD: the two project ids are the same';
  end if;
  if not exists (select 1 from profiles where id = v_company and role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active') then
    raise exception 'GUARD: the company id is not the main owner account';
  end if;
  if not exists (select 1 from folders where id = v_project_a and name = 'ZZ LL check A' and owner_id = v_company and parent_folder_id is null) then
    raise exception 'GUARD: project A is not there with this id, the name "ZZ LL check A", this company and no parent (already cleaned, or a wrong id)';
  end if;
  if not exists (select 1 from folders where id = v_project_b and name = 'ZZ LL check B' and owner_id = v_company and parent_folder_id is null) then
    raise exception 'GUARD: project B is not there with this id, the name "ZZ LL check B", this company and no parent (already cleaned, or a wrong id)';
  end if;
  zf := array[v_project_a, v_project_b];
  zft := array[v_project_a::text, v_project_b::text];

  -- ---------- what belongs to them ----------
  select coalesce(array_agg(id), '{}') into zper from projects where folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zloc from stk_locations where folder_id = any(zf);
  select coalesce(array_agg(distinct x), '{}') into zc from (
    select id x from labor_contracts where folder_id = any(zf)
    union select contract_id from lc_events where kind = 'created' and after ->> 'folder_id' = any(zft)
    union select contract_id from lc_events where kind in ('deleted', 'merged') and before ->> 'folder_id' = any(zft)) s;
  select coalesce(array_agg(id), '{}') into zev from lc_events where contract_id = any(zc);
  select coalesce(array_agg(id), '{}') into zp from payroll where project_id = any(zper) or contract_id = any(zc);

  -- Every row is this company's.
  if exists (select 1 from projects where id = any(zper) and owner_id is distinct from v_company)
     or exists (select 1 from labor_contracts where id = any(zc) and owner_id is distinct from v_company)
     or exists (select 1 from lc_events where id = any(zev) and owner_id is distinct from v_company)
     or exists (select 1 from payroll where id = any(zp) and owner_id is distinct from v_company) then
    raise exception 'GUARD: a row on these projects belongs to another company — stop and check';
  end if;
  select id into v_w5 from profiles where worker_no = 5 and owner_id = v_company;
  select id into v_w7 from profiles where worker_no = 7 and owner_id = v_company;
  if v_w5 is null or v_w7 is null then
    raise exception 'GUARD: W-0005 or W-0007 is not an account of this company';
  end if;

  -- The check creates no jobs under these projects; deleting one would take its jobs too.
  if exists (select 1 from folders f where f.parent_folder_id = any(zf)) then
    raise exception 'GUARD: a job sits under one of these projects (the check creates none) — stop and check';
  end if;

  -- Real contracts stay unlinked. The check's are only ever W-0005's or W-0007's.
  if exists (select 1 from labor_contracts where not id = any(zc) and worker_id is not null) then
    raise exception 'GUARD: a REAL contract is linked to an account — stop and check';
  end if;
  if exists (select 1 from labor_contracts where id = any(zc) and worker_id is not null and worker_id not in (v_w5, v_w7)) then
    raise exception 'GUARD: a ZZ contract is linked to someone other than W-0005 or W-0007 — stop and check';
  end if;
  if exists (select 1 from lc_events e where e.id = any(zev) and e.kind in ('linked', 'relinked', 'unlinked')
              and ((e.before ->> 'worker_id' is not null and (e.before ->> 'worker_id')::uuid not in (v_w5, v_w7))
                or (e.after ->> 'worker_id' is not null and (e.after ->> 'worker_id')::uuid not in (v_w5, v_w7)))) then
    raise exception 'GUARD: a ZZ contract was once linked to someone other than W-0005 or W-0007 — stop and check';
  end if;

  -- A contract stays on the side it started: nothing moved between these projects and any other.
  if exists (select 1 from labor_contracts where id = any(zc) and (folder_id is null or not folder_id = any(zf))) then
    raise exception 'GUARD: a contract created on a ZZ project now sits on a real project — stop and check';
  end if;
  if exists (select 1 from lc_events where kind = 'edited' and (after ->> 'folder_id' = any(zft) or before ->> 'folder_id' = any(zft))) then
    raise exception 'GUARD: a contract was moved to or from a ZZ project — stop and check';
  end if;
  -- Only this check's synthetic history: each contract's own record says it was created here.
  if exists (select 1 from unnest(zc) c(id)
              where not exists (select 1 from lc_events e where e.contract_id = c.id and e.kind = 'created' and e.after ->> 'folder_id' = any(zft))) then
    raise exception 'GUARD: a contract here has no record of being created on these projects — stop and check';
  end if;

  -- Payments: these contracts are paid only in these billing periods, and the reverse.
  if exists (select 1 from payroll where id = any(zp) and (project_id is null or not project_id = any(zper))) then
    raise exception 'GUARD: a payment on a ZZ contract sits in a real billing period — stop and check';
  end if;
  if exists (select 1 from payroll where id = any(zp) and contract_id is not null and not contract_id = any(zc)) then
    raise exception 'GUARD: a payment in a ZZ billing period is tagged to a real contract — stop and check';
  end if;

  -- No files: the check uploads none, so anything here is unexpected.
  if exists (select 1 from payroll where id = any(zp) and jsonb_typeof(receipt_images) = 'array' and jsonb_array_length(receipt_images) > 0)
     or exists (select 1 from labor_contracts where id = any(zc) and (coalesce(agreement_pdf_url, '') <> '' or coalesce(agreement_signature_image, '') <> ''))
     or exists (select 1 from labor_contracts c, jsonb_array_elements(case when jsonb_typeof(c.cap_history) = 'array' then c.cap_history else '[]'::jsonb end) h
                 where c.id = any(zc) and h ? 'fileUrl')
     or exists (select 1 from lc_events where id = any(zev) and (coalesce(before ->> 'agreement_pdf_url', '') <> '' or coalesce(before ->> 'agreement_signature_image', '') <> '')) then
    raise exception 'GUARD: a ZZ contract or payment has a file attached (the check uploads none) — stop and check';
  end if;

  -- Nothing else was recorded on these projects.
  if exists (select 1 from expenses where folder_id = any(zf) or project_id = any(zper))
     or exists (select 1 from overhead_expenses where folder_id = any(zf) or billing_period_id = any(zper))
     or exists (select 1 from reimbursements where folder_id = any(zf))
     or exists (select 1 from construction_projects where folder_id = any(zf))
     or exists (select 1 from boq_documents where folder_id = any(zf))
     or exists (select 1 from expense_inbox where folder_id = any(zf))
     or exists (select 1 from pr_requests where folder_id = any(zf) or work_folder_id = any(zf))
     or exists (select 1 from purchase_lines where folder_id = any(zf))
     or exists (select 1 from stk_lots where cost_folder_id = any(zf))
     or exists (select 1 from stk_records where from_location = any(zloc) or to_location = any(zloc))
     or exists (select 1 from stk_moves where from_location = any(zloc) or to_location = any(zloc))
     or exists (select 1 from stk_cost_moves where location = any(zloc) or from_folder = any(zf) or to_folder = any(zf))
     or exists (select 1 from wp_tasks where folder_id = any(zf) or work_folder_id = any(zf))
     or exists (select 1 from pr_item_refs where folder_id = any(zf) or work_folder_id = any(zf))
     or exists (select 1 from tl_records where folder_id = any(zf))
     or exists (select 1 from tl_tools where folder_id = any(zf))
     or exists (select 1 from attendance_records where timein_folder_id = any(zf) or timeout_folder_id = any(zf)) then
    raise exception 'GUARD: an expense, overhead, BOQ, reimbursement, request, purchase, stock, tool, Work Plan task or attendance is on a ZZ project (the check records only contracts and payments) — stop and check';
  end if;

  -- ---------- what must not change ----------
  -- Row by row. Each row is hashed on its own: old payroll rows can hold large inline photos.
  select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) into real_c from labor_contracts t where not t.id = any(zc);
  select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) into real_p from payroll t where not t.id = any(zp);
  select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) into real_e from lc_events t where not t.id = any(zev);
  select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) into real_f from folders t where not t.id = any(zf);
  select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) into real_per from projects t where not t.id = any(zper);
  select md5(string_agg(concat_ws('|', id, role, status, owner_id, worker_no), ',' order by id)) into people from profiles where id in (v_w5, v_w7);
  select count(*) into real_budgets from folder_budgets where not folder_id = any(zf);
  select count(*) into real_period_budgets from project_budgets where not project_id = any(zper);
  select count(*) into real_policies from project_control_allocation_policies where not folder_id = any(zf);
  select count(*) into real_alloc from project_control_billing_allocations where not project_id = any(zper);
  select count(*) into real_adj from billing_allocation_adjustments where not project_id = any(zper);
  select count(*) into att_n from attendance_records;
  select count(*), coalesce(sum(amount), 0) into exp_n, exp_sum from expenses;

  -- ---------- remove, in this order (the guards are off inside this transaction only) ----------
  execute 'alter table labor_contracts disable trigger lc_guard';
  execute 'alter table labor_contracts disable trigger lc_log';
  execute 'alter table lc_events disable trigger lc_events_no_change';

  delete from payroll where id = any(zp);
  get diagnostics n = row_count; msg := msg || 'payments ' || n;
  delete from labor_contracts where id = any(zc);
  get diagnostics n = row_count; msg := msg || ', contracts ' || n;
  delete from lc_events where id = any(zev);
  get diagnostics n = row_count; msg := msg || ', history rows ' || n;

  execute 'alter table labor_contracts enable trigger lc_guard';
  execute 'alter table labor_contracts enable trigger lc_log';
  execute 'alter table lc_events enable trigger lc_events_no_change';

  delete from stk_locations where id = any(zloc);
  delete from folders where id = any(zf);
  msg := msg || ', projects ' || cardinality(zf) || ' (with ' || cardinality(zper) || ' billing periods)';

  -- ---------- after: nothing of this check left, nothing else changed ----------
  if exists (select 1 from folders where id = any(zf))
     or exists (select 1 from projects where id = any(zper))
     or exists (select 1 from labor_contracts where id = any(zc))
     or exists (select 1 from payroll where id = any(zp))
     or exists (select 1 from lc_events where id = any(zev)) then
    raise exception 'GUARD: a ZZ row is still there';
  end if;
  if (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) from labor_contracts t) <> real_c then
    raise exception 'GUARD: a real contract changed';
  end if;
  if (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) from payroll t) <> real_p then
    raise exception 'GUARD: a real payment changed';
  end if;
  if (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) from lc_events t) <> real_e then
    raise exception 'GUARD: a real history row changed';
  end if;
  if (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) from folders t) <> real_f
     or (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), ',' order by t.id), '')) from projects t) <> real_per then
    raise exception 'GUARD: a real project or billing period changed';
  end if;
  if (select count(*) from folder_budgets) <> real_budgets or (select count(*) from project_budgets) <> real_period_budgets
     or (select count(*) from project_control_allocation_policies) <> real_policies
     or (select count(*) from project_control_billing_allocations) <> real_alloc
     or (select count(*) from billing_allocation_adjustments) <> real_adj then
    raise exception 'GUARD: a real budget or allocation changed';
  end if;
  if (select md5(string_agg(concat_ws('|', id, role, status, owner_id, worker_no), ',' order by id)) from profiles where id in (v_w5, v_w7)) <> people
     or (select count(*) from attendance_records) < att_n   -- "<": a worker's real Time In may arrive while this runs
     or (select count(*) from expenses) <> exp_n or (select coalesce(sum(amount), 0) from expenses) <> exp_sum then
    raise exception 'GUARD: W-0005, W-0007, attendance or expenses changed';
  end if;

  -- ---------- every audit protection is back ----------
  if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled = 'O' and
        ((t.tgrelid = 'public.labor_contracts'::regclass and t.tgname in ('lc_guard', 'lc_log')) or
         (t.tgrelid = 'public.lc_events'::regclass and t.tgname in ('lc_events_no_change', 'lc_events_no_truncate')))) <> 4 then
    raise exception 'GUARD: a Linked Labor guard is not on';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.lc_events'::regclass)
     or (select count(*) from pg_policy where polrelid = 'public.lc_events'::regclass) <> 1
     or not exists (select 1 from pg_policy where polrelid = 'public.lc_events'::regclass and polname = 'lc_events_owner_read' and polcmd = 'r')
     or not has_table_privilege('authenticated', 'public.lc_events', 'select')
     or has_table_privilege('authenticated', 'public.lc_events', 'insert')
     or has_table_privilege('authenticated', 'public.lc_events', 'update')
     or has_table_privilege('authenticated', 'public.lc_events', 'delete')
     or has_table_privilege('anon', 'public.lc_events', 'select') then
    raise exception 'GUARD: the history table access rules changed';
  end if;
  -- Prove it: with the guards back on, the history refuses an edit and a delete. The probe row is undone.
  begin
    insert into lc_events (owner_id, contract_id, kind, reason) values (v_company, gen_random_uuid(), 'edited', 'clean-up self-check') returning id into v_probe;
    begin
      update lc_events set reason = 'x' where id = v_probe;
    exception when others then
      if sqlerrm = 'LC_EVENTS_APPEND_ONLY' then v_refused := v_refused + 1; else raise; end if;
    end;
    begin
      delete from lc_events where id = v_probe;
    exception when others then
      if sqlerrm = 'LC_EVENTS_APPEND_ONLY' then v_refused := v_refused + 1; else raise; end if;
    end;
    raise exception 'LC_CLEANUP_PROBE_UNDO';
  exception when others then
    if sqlerrm <> 'LC_CLEANUP_PROBE_UNDO' then raise; end if;
  end;
  if v_refused <> 2 then
    raise exception 'GUARD: the history accepted a change';
  end if;
  msg := msg || '. Everything else unchanged; no real contract is linked; every audit protection is back on and tested.';

  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): would remove %', msg;
  end if;
  raise notice 'CLEAN-UP DONE: removed %', msg;
end $$;
