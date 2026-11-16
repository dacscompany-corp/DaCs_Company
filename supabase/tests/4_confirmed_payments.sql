-- ════════════════════════════════════════════════════════════════════
-- Stage 4, question 8: record ONLY the payments the user has confirmed.
--
-- Run by the USER in the Supabase SQL editor (plan
-- docs/superpowers/plans/2026-10-30-workmate-stage4-reconciliation.md,
-- Task 5) — and only after the user has filled in the confirmations table
-- under question 8 of the Stage 4 sheet. One transaction. Any failed guard
-- stops it and changes NOTHING.
--
-- AS SHIPPED IT DOES NOTHING: v_confirm is empty, and an empty list stops
-- with "NOTHING CONFIRMED". A purchase is never marked paid from its payment
-- method, its receipt photo or anything else on record — only from an entry
-- below, copied from the user's own confirmation:
--   ref           the purchase's reference code (the first 8 characters)
--   expect_total  its receipt total as the sheet lists it (a check: it must still be that)
--   paid_on       the day the user says it was paid (YYYY-MM-DD, Philippine date)
--   amount        the amount the user says was paid (all of it, or part)
--   source        where the money came from: company | petty_cash | own_money
--   person_email  for petty_cash / own_money: the staff buyer whose money it was
--   method        how, AS THE USER CONFIRMS IT: cash | gcash | bank_transfer | check | other
--   note          optional, e.g. 'confirmed by the owner, 31 Oct'
-- A "no" or "not sure" in the table is simply left out: that purchase stays
-- Unpaid.
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It records every confirmed payment, checks
--            the result, prints it in a red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- WHAT IT DOES. Each payment is recorded by pur_pay — the same operation as
-- Purchasing → Record payment — as the main owner (admin@), so it lands in the
-- purchase's payment history like a click. A payment never changes Spent,
-- Earned or Profit (2A-4): the guard at the end proves not one expense row
-- changed. It refuses, before changing anything, if a purchase:
--   · is not found, or the code matches more than one purchase;
--   · is voided, or its total is no longer the expected one;
--   · already has a payment, a refund or a supplier credit (record those by hand);
--   · would be paid more than its total, or before its purchase date, or in the future;
--   · is listed twice; or an entry is missing a field.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_dry boolean := true;
  v_main constant uuid := '869c0be7-da92-44d4-a2b1-03dac7fed7e9';     -- admin@, the main owner
  -- The user's confirmations, one entry per purchase confirmed paid. EMPTY = nothing is recorded.
  -- Example shape (NOT a confirmation):
  --   [{"ref": "xxxxxxxx", "expect_total": 0.00, "paid_on": "2026-10-24", "amount": 0.00,
  --     "source": "company", "person_email": null, "method": "bank_transfer", "note": ""}]
  v_confirm constant jsonb := $c$
[]
$c$;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  e jsonb;
  pu purchases;
  v_ids uuid[] := '{}';
  v_amounts numeric[] := '{}';
  v_pays jsonb[] := '{}';
  v_person uuid;
  v_n int;
  v_i int;
  b_exp text; b_pur text; b_pay bigint; b_other text;
  msg text := '';
begin
  -- ---------- the main owner ----------
  if not exists (select 1 from profiles p where p.id = v_main and p.role = 'owner' and p.owner_id is null
                   and coalesce(p.status, 'active') = 'active') then
    raise exception 'GUARD: v_main is not the active main owner';
  end if;
  if jsonb_typeof(v_confirm) is distinct from 'array' then
    raise exception 'GUARD: v_confirm must be a list';
  end if;
  if jsonb_array_length(v_confirm) = 0 then
    raise exception 'NOTHING CONFIRMED — fill in the confirmations from the user''s table first; nothing was changed';
  end if;

  -- ---------- every entry, checked before anything changes ----------
  for e in select value from jsonb_array_elements(v_confirm) loop
    if jsonb_typeof(e) is distinct from 'object'
       or coalesce(e ->> 'ref', '') !~ '^[0-9a-f]{8}$'
       or coalesce(e ->> 'paid_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(e ->> 'expect_total', '') !~ '^\d+(\.\d{1,2})?$'
       or coalesce(e ->> 'amount', '') !~ '^\d+(\.\d{1,2})?$'
       or coalesce(e ->> 'source', '') not in ('company', 'petty_cash', 'own_money')
       or coalesce(e ->> 'method', '') not in ('cash', 'gcash', 'bank_transfer', 'check', 'other')
       or char_length(coalesce(e ->> 'note', '')) > 300 then
      raise exception 'GUARD: entry % is missing a field or has a bad value (ref, expect_total, paid_on, amount, source, method)', e;
    end if;
    select count(*) into v_n from purchases x where x.owner_id = v_main and x.id::text like (e ->> 'ref') || '%';
    if v_n <> 1 then
      raise exception 'GUARD: ref % matches % purchases (must be exactly 1)', e ->> 'ref', v_n;
    end if;
    select * into pu from purchases x where x.owner_id = v_main and x.id::text like (e ->> 'ref') || '%';
    if pu.id = any(v_ids) then
      raise exception 'GUARD: ref % is listed twice', e ->> 'ref';
    end if;
    if pu.status <> 'recorded' then
      raise exception 'GUARD: ref % is voided', e ->> 'ref';
    end if;
    if pu.receipt_total <> (e ->> 'expect_total')::numeric then
      raise exception 'GUARD: ref % totals % now, not % — stop and check', e ->> 'ref', pu.receipt_total, e ->> 'expect_total';
    end if;
    if exists (select 1 from pur_payments x where x.purchase_id = pu.id and x.voided_at is null)
       or exists (select 1 from pur_refunds x where x.purchase_id = pu.id and x.voided_at is null)
       or exists (select 1 from pur_supplier_credits x where x.purchase_id = pu.id and x.voided_at is null) then
      raise exception 'GUARD: ref % already has a payment, refund or credit — record it by hand in Purchasing', e ->> 'ref';
    end if;
    if (e ->> 'amount')::numeric <= 0 or (e ->> 'amount')::numeric > pu.receipt_total then
      raise exception 'GUARD: ref % — amount % must be above 0 and at most its total %', e ->> 'ref', e ->> 'amount', pu.receipt_total;
    end if;
    if (e ->> 'paid_on')::date < pu.purchase_date or (e ->> 'paid_on')::date > v_today then
      raise exception 'GUARD: ref % — paid on % is before its purchase date % or in the future', e ->> 'ref', e ->> 'paid_on', pu.purchase_date;
    end if;
    v_person := null;
    if e ->> 'source' in ('petty_cash', 'own_money') then
      select p.id into v_person from profiles p
       where lower(p.email) = lower(coalesce(e ->> 'person_email', '')) and p.role = 'staff' and p.owner_id = v_main;
      if v_person is null then
        raise exception 'GUARD: ref % — % needs the staff buyer''s e-mail (person_email)', e ->> 'ref', e ->> 'source';
      end if;
    end if;
    v_ids := v_ids || pu.id;
    v_amounts := v_amounts || (e ->> 'amount')::numeric;
    v_pays := v_pays || jsonb_build_object('amount', e ->> 'amount', 'paid_on', e ->> 'paid_on', 'method', e ->> 'method',
                                           'source', e ->> 'source', 'person_id', v_person, 'note', coalesce(e ->> 'note', ''));
  end loop;

  -- ---------- before ----------
  select md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '-') || ':' || coalesce(folder_id::text, '-') || ':'
                                 || amount::text || ':' || coalesce(cover_expense, false)::text, ',' order by id), ''))
    into b_exp from expenses;
  select md5(coalesce(string_agg(id::text || ':' || status || ':' || receipt_total::text || ':' || purchase_date::text, ',' order by id), ''))
    into b_pur from purchases;
  select count(*) into b_pay from pur_payments;
  select md5(coalesce(string_agg(id::text || ':' || amount::text || ':' || coalesce(voided_at::text, ''), ',' order by id), ''))
    into b_other from pur_payments where not (purchase_id = any(v_ids));

  -- ---------- record them, as the main owner ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_main, 'role', 'authenticated')::text, true);
  for v_i in 1 .. cardinality(v_ids) loop
    perform pur_pay(gen_random_uuid(), v_ids[v_i], v_pays[v_i]);
  end loop;

  -- ---------- after ----------
  for v_i in 1 .. cardinality(v_ids) loop
    if (select count(*) from pur_payments x where x.purchase_id = v_ids[v_i] and x.voided_at is null) <> 1
       or (select sum(amount) from pur_payments x where x.purchase_id = v_ids[v_i] and x.voided_at is null) <> v_amounts[v_i]
       or pur_pay_state(v_ids[v_i]) ->> 'state'
          <> (case when v_amounts[v_i] = (select receipt_total from purchases where id = v_ids[v_i]) then 'paid' else 'partial' end) then
      raise exception 'GUARD: after — purchase % does not show exactly the confirmed payment', left(v_ids[v_i]::text, 8);
    end if;
    msg := msg || left(v_ids[v_i]::text, 8) || ' ₱' || v_amounts[v_i] || ' → ' || (pur_pay_state(v_ids[v_i]) ->> 'state') || '; ';
  end loop;
  perform set_config('request.jwt.claims', '', true);
  if (select md5(coalesce(string_agg(id::text || ':' || coalesce(project_id::text, '-') || ':' || coalesce(folder_id::text, '-') || ':'
                                     || amount::text || ':' || coalesce(cover_expense, false)::text, ',' order by id), '')) from expenses) <> b_exp then
    raise exception 'GUARD: after — an expense row changed (a payment must never change Spent)';
  end if;
  if (select md5(coalesce(string_agg(id::text || ':' || status || ':' || receipt_total::text || ':' || purchase_date::text, ',' order by id), ''))
        from purchases) <> b_pur then
    raise exception 'GUARD: after — a purchase changed';
  end if;
  if (select count(*) from pur_payments) <> b_pay + cardinality(v_ids)
     or (select md5(coalesce(string_agg(id::text || ':' || amount::text || ':' || coalesce(voided_at::text, ''), ',' order by id), ''))
           from pur_payments where not (purchase_id = any(v_ids))) <> b_other then
    raise exception 'GUARD: after — some other payment changed';
  end if;

  msg := cardinality(v_ids) || ' confirmed payment(s) recorded as the main owner: ' || msg
         || 'no expense row, purchase or other payment changed.';
  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): %', msg;
  end if;
  raise notice 'DONE: %', msg;
end $$;
