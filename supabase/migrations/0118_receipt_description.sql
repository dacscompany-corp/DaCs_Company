-- 0118 — Acknowledgement Receipts: the item line typed by the owner.
--
-- Spec: docs/superpowers/specs/2026-11-20-pc-receipt-payment-line-design.md (§ 0118),
--       owner's answers of 20 Nov 2026 ("Type it myself").
--
-- The receipt window gets a Description box, pre-filled with the automatic line
-- and editable before issuing, e.g. "Full Payment of the Down Payment (Nov 20, 2026)".
-- The text is saved as the receipt's billing_label and frozen with it. Blank
-- falls back to the automatic line: for Project Control 0117's
--   <billing> · Payment received (<date>) · Ref. <reference>
-- and for Project Management 0116's
--   Payment received (<date>) · Ref. <reference>
--
-- Everything else is exactly as before: the amount is still read here (Fund
-- Allocated / the payment's paid amount; no function accepts an amount), the
-- same locks, refusals, owner-only access and the one shared AR series. 0114,
-- 0116 and 0117's functions are left unchanged, so the live site keeps working
-- until the web code that uses these goes live. Only js/billing-receipts.js
-- calls the bar_* functions and only js/pm-billing-docs.js the pmar_* ones.
--
-- OUTSIDE THE MONEY MODEL. Nothing here writes an expense, payroll row,
-- invoice, payment, budget or billing period, and nothing feeds a receipt into
-- Spent / Earned / Profit.

set local lock_timeout = '5s';

-- ════ 1. The typed description ═══════════════════════════

-- Trimmed; blank means "use the automatic line"; at most 200 characters, the
-- same limit as every receipt line.
create or replace function bar_clean_description(p_description text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := btrim(coalesce(p_description, ''));
begin
  if v = '' then return null; end if;
  if char_length(v) > 200 then raise exception 'DESCRIPTION_TOO_LONG' using errcode = 'P0001'; end if;
  return v;
end;
$$;

-- ════ 2. Project Control (0114 + 0117) ═══════════════════

-- 0117's bar_new_paid_receipt with the typed line. The caller must already hold
-- the billing period's row lock.
create or replace function bar_new_described_receipt(p_company uuid, p_period uuid, p_from text, p_by text,
                                                     p_paid_on date, p_reference text, p_description text) returns billing_receipts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p projects%rowtype;
  v_amount numeric;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_ym text := to_char((now() at time zone 'Asia/Manila')::date, 'YYYYMM');
  v_n integer;
  v_settings jsonb;
  v_from text := bar_clean_name(p_from);
  v_by text := bar_clean_name(p_by);
  v_paid_on date := bar_check_paid_on(p_paid_on);
  v_ref text := bar_clean_reference(p_reference);
  v_desc text := bar_clean_description(p_description);
  v_row billing_receipts%rowtype;
begin
  select * into v_p from projects where id = p_period and owner_id = p_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_p.funding_type = 'president' then raise exception 'COVER_PERIOD' using errcode = 'P0001'; end if;

  select round(monthly_budget, 2) into v_amount from project_budgets where project_id = p_period;
  if coalesce(v_amount, 0) <= 0 then raise exception 'NO_FUND_ALLOCATED' using errcode = 'P0001'; end if;

  select value into v_settings from settings where key = 'invoiceDefaults';

  insert into billing_receipt_counters as c (owner_id, year_month, last_no)
  values (p_company, v_ym, 1)
  on conflict (owner_id, year_month) do update set last_no = c.last_no + 1
  returning c.last_no into v_n;

  insert into billing_receipts (owner_id, folder_id, period_id, receipt_no, issued_on, billing_label, amount,
                                received_from, received_by, business, payment_details, created_by,
                                paid_on, payment_reference)
  values (p_company, v_p.folder_id, p_period,
          'AR-' || v_ym || '-' || lpad(v_n::text, greatest(3, char_length(v_n::text)), '0'),
          v_today,
          coalesce(v_desc,
                   left(bar_period_label(v_p.funding_type, v_p.billing_number, v_p.month, v_p.year)
                        || ' · Payment received (' || to_char(v_paid_on, 'Mon FMDD, YYYY') || ')'
                        || coalesce(' · Ref. ' || v_ref, ''), 200)),
          v_amount, v_from, v_by,
          jsonb_build_object('name', coalesce(v_settings ->> 'businessName', ''),
                             'tin', coalesce(v_settings ->> 'businessTin', ''),
                             'address', coalesce(v_settings ->> 'businessAddress', '')),
          coalesce(v_settings -> 'paymentDetails', '{}'::jsonb),
          auth.uid(), v_paid_on, v_ref)
  returning * into v_row;

  perform bar_save_parties(p_company, v_p.folder_id, v_from, v_by);
  return v_row;
end;
$$;

create or replace function bar_issue_described(p_period uuid, p_received_from text, p_received_by text,
                                               p_paid_on date, p_reference text, p_description text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_live billing_receipts%rowtype;
begin
  perform bar_check_paid_on(p_paid_on);
  perform bar_clean_reference(p_reference);
  perform bar_clean_description(p_description);

  perform 1 from projects where id = p_period and owner_id = v_company and folder_id is not null for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_live from billing_receipts where period_id = p_period and voided_at is null;
  if found then return to_jsonb(v_live); end if;

  return to_jsonb(bar_new_described_receipt(v_company, p_period, p_received_from, p_received_by,
                                            p_paid_on, p_reference, p_description));
end;
$$;

create or replace function bar_reissue_described(p_receipt uuid, p_reason text, p_received_from text, p_received_by text,
                                                 p_paid_on date, p_reference text, p_description text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_period uuid;
  v_old billing_receipts%rowtype;
begin
  if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  perform bar_check_paid_on(p_paid_on);
  perform bar_clean_reference(p_reference);
  perform bar_clean_description(p_description);

  select period_id into v_period from billing_receipts where id = p_receipt and owner_id = v_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform 1 from projects where id = v_period and owner_id = v_company for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_old from billing_receipts where id = p_receipt for update;
  if v_old.voided_at is not null then raise exception 'ALREADY_VOID' using errcode = 'P0001'; end if;

  update billing_receipts set voided_at = clock_timestamp(), voided_by = auth.uid(), void_reason = v_reason
   where id = p_receipt;

  return to_jsonb(bar_new_described_receipt(v_company, v_period, p_received_from, p_received_by,
                                            p_paid_on, p_reference, p_description));
end;
$$;

-- ════ 3. Project Management (0116) ═══════════════════════

-- 0116's pmar_new_receipt with the typed line. The caller must already hold the
-- payment's row lock.
create or replace function pmar_new_described_receipt(p_company uuid, p_payment uuid, p_from text, p_by text,
                                                      p_description text) returns pm_billing_receipts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p payment_requests%rowtype;
  v_amount numeric;
  v_settings jsonb;
  v_from text := bar_clean_name(p_from);
  v_by text := bar_clean_name(p_by);
  v_desc text := bar_clean_description(p_description);
  v_row pm_billing_receipts%rowtype;
begin
  select * into v_p from payment_requests
   where id = p_payment and construction_project_id is not null and (owner_id is null or owner_id = p_company);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pmar_project(p_company, v_p.construction_project_id);

  v_amount := pmar_paid_amount(v_p.status, v_p.amount_paid, v_p.paid_amount, v_p.total_amount);
  if v_amount <= 0 then raise exception 'NOT_PAID' using errcode = 'P0001'; end if;

  select value into v_settings from settings where key = 'invoiceDefaults';

  insert into pm_billing_receipts (owner_id, project_id, payment_id, receipt_no, issued_on, billing_label, amount,
                                   received_from, received_by, business, payment_details, created_by)
  values (p_company, v_p.construction_project_id, p_payment, pmar_next_no(p_company),
          (now() at time zone 'Asia/Manila')::date,
          coalesce(v_desc, pmar_label(v_p.week_ending_date, v_p.reference_number)),
          v_amount, v_from, v_by,
          jsonb_build_object('name', coalesce(v_settings ->> 'businessName', ''),
                             'tin', coalesce(v_settings ->> 'businessTin', ''),
                             'address', coalesce(v_settings ->> 'businessAddress', '')),
          coalesce(v_settings -> 'paymentDetails', '{}'::jsonb),
          auth.uid())
  returning * into v_row;

  perform pmar_save_parties(p_company, v_p.construction_project_id, v_from, v_by);
  return v_row;
end;
$$;

create or replace function pmar_issue_described(p_payment uuid, p_received_from text, p_received_by text,
                                                p_description text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_project uuid;
  v_live pm_billing_receipts%rowtype;
begin
  perform bar_clean_description(p_description);

  select construction_project_id into v_project from payment_requests
   where id = p_payment and construction_project_id is not null and (owner_id is null or owner_id = v_company)
     for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pmar_project(v_company, v_project);

  select * into v_live from pm_billing_receipts where payment_id = p_payment and voided_at is null;
  if found then return to_jsonb(v_live); end if;

  return to_jsonb(pmar_new_described_receipt(v_company, p_payment, p_received_from, p_received_by, p_description));
end;
$$;

create or replace function pmar_reissue_described(p_receipt uuid, p_reason text, p_received_from text,
                                                  p_received_by text, p_description text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_payment uuid;
  v_old pm_billing_receipts%rowtype;
begin
  if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  perform bar_clean_description(p_description);

  select payment_id into v_payment from pm_billing_receipts where id = p_receipt and owner_id = v_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform 1 from payment_requests where id = v_payment for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_old from pm_billing_receipts where id = p_receipt for update;
  if v_old.voided_at is not null then raise exception 'ALREADY_VOID' using errcode = 'P0001'; end if;

  update pm_billing_receipts set voided_at = clock_timestamp(), voided_by = auth.uid(), void_reason = v_reason
   where id = p_receipt;

  return to_jsonb(pmar_new_described_receipt(v_company, v_payment, p_received_from, p_received_by, p_description));
end;
$$;

-- ════ 4. Who may call what ══════════════════════════════

revoke all on function bar_clean_description(text) from public, anon, authenticated;
revoke all on function bar_new_described_receipt(uuid, uuid, text, text, date, text, text) from public, anon, authenticated;
revoke all on function pmar_new_described_receipt(uuid, uuid, text, text, text) from public, anon, authenticated;

revoke all on function bar_issue_described(uuid, text, text, date, text, text) from public, anon, authenticated;
revoke all on function bar_reissue_described(uuid, text, text, text, date, text, text) from public, anon, authenticated;
revoke all on function pmar_issue_described(uuid, text, text, text) from public, anon, authenticated;
revoke all on function pmar_reissue_described(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function bar_issue_described(uuid, text, text, date, text, text) to authenticated;
grant execute on function bar_reissue_described(uuid, text, text, text, date, text, text) to authenticated;
grant execute on function pmar_issue_described(uuid, text, text, text) to authenticated;
grant execute on function pmar_reissue_described(uuid, text, text, text, text) to authenticated;
