-- 0117 — Project Control receipts: the payment date and reference on the line.
--
-- Spec: docs/superpowers/specs/2026-11-20-pc-receipt-payment-line-design.md
--       (owner's answers "1A + 2A", 20 Nov 2026).
--
-- A Project Control Acknowledgement Receipt (0114) now also records WHEN the
-- client paid and WITH WHICH REFERENCE, typed by the owner when issuing it, and
-- prints them after the billing name, the same standard as Project
-- Management's receipts (0116):
--   Progress Billing 3 (November 2026) · Payment received (Nov 20, 2026) · Ref. PC-NDBMOB-…
-- Both values are saved on the receipt only and frozen with it (0114's guard
-- still allows a single void and nothing else). The amount is still ALWAYS the
-- period's Fund Allocated, read here: no function accepts an amount.
--
-- 0114's bar_issue / bar_reissue are left exactly as they are, so the live site
-- keeps working between applying this and publishing the web code. Only
-- js/billing-receipts.js calls the bar_* functions. Owner accounts only.
--
-- OUTSIDE THE MONEY MODEL. Nothing here writes an expense, payroll row,
-- invoice, payment, budget or billing period, and nothing feeds a receipt into
-- Spent / Earned / Profit. Billing periods are not changed.

set local lock_timeout = '5s';

-- ════ 1. Two columns on the receipt ═════════════════════

alter table billing_receipts add column if not exists paid_on date;
alter table billing_receipts add column if not exists payment_reference text;
alter table billing_receipts drop constraint if exists billing_receipts_reference_len;
alter table billing_receipts add constraint billing_receipts_reference_len
  check (payment_reference is null or char_length(payment_reference) between 1 and 100);

-- ════ 2. Private helpers ════════════════════════════════

-- The payment date: required, and never after today in the Philippines.
create or replace function bar_check_paid_on(p_paid_on date) returns date
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_paid_on is null then raise exception 'PAID_ON_REQUIRED' using errcode = 'P0001'; end if;
  if p_paid_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'PAID_ON_FUTURE' using errcode = 'P0001';
  end if;
  return p_paid_on;
end;
$$;

-- The reference: trimmed; blank means none; at most 100 characters.
create or replace function bar_clean_reference(p_reference text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := btrim(coalesce(p_reference, ''));
begin
  if v = '' then return null; end if;
  if char_length(v) > 100 then raise exception 'REFERENCE_TOO_LONG' using errcode = 'P0001'; end if;
  return v;
end;
$$;

-- 0114's bar_new_receipt, plus the payment date, the reference and the longer
-- line. The caller must already hold the billing period's row lock.
create or replace function bar_new_paid_receipt(p_company uuid, p_period uuid, p_from text, p_by text,
                                                p_paid_on date, p_reference text) returns billing_receipts
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
          left(bar_period_label(v_p.funding_type, v_p.billing_number, v_p.month, v_p.year)
               || ' · Payment received (' || to_char(v_paid_on, 'Mon FMDD, YYYY') || ')'
               || coalesce(' · Ref. ' || v_ref, ''), 200),
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

-- ════ 3. What the page calls ════════════════════════════

-- Issue the receipt for a billing period with its payment date and reference.
-- Pressing again, or a retry, returns the receipt that already exists and
-- spends no number.
create or replace function bar_issue_with_payment(p_period uuid, p_received_from text, p_received_by text,
                                                  p_paid_on date, p_reference text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_live billing_receipts%rowtype;
begin
  perform bar_check_paid_on(p_paid_on);
  perform bar_clean_reference(p_reference);

  perform 1 from projects where id = p_period and owner_id = v_company and folder_id is not null for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_live from billing_receipts where period_id = p_period and voided_at is null;
  if found then return to_jsonb(v_live); end if;

  return to_jsonb(bar_new_paid_receipt(v_company, p_period, p_received_from, p_received_by, p_paid_on, p_reference));
end;
$$;

-- Void a receipt and issue its replacement with a payment date and reference,
-- together or not at all.
create or replace function bar_reissue_with_payment(p_receipt uuid, p_reason text, p_received_from text,
                                                    p_received_by text, p_paid_on date, p_reference text) returns jsonb
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

  select period_id into v_period from billing_receipts where id = p_receipt and owner_id = v_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform 1 from projects where id = v_period and owner_id = v_company for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_old from billing_receipts where id = p_receipt for update;
  if v_old.voided_at is not null then raise exception 'ALREADY_VOID' using errcode = 'P0001'; end if;

  update billing_receipts set voided_at = clock_timestamp(), voided_by = auth.uid(), void_reason = v_reason
   where id = p_receipt;

  return to_jsonb(bar_new_paid_receipt(v_company, v_period, p_received_from, p_received_by, p_paid_on, p_reference));
end;
$$;

-- ════ 4. Who may call what ══════════════════════════════

revoke all on function bar_check_paid_on(date) from public, anon, authenticated;
revoke all on function bar_clean_reference(text) from public, anon, authenticated;
revoke all on function bar_new_paid_receipt(uuid, uuid, text, text, date, text) from public, anon, authenticated;

revoke all on function bar_issue_with_payment(uuid, text, text, date, text) from public, anon, authenticated;
revoke all on function bar_reissue_with_payment(uuid, text, text, text, date, text) from public, anon, authenticated;
grant execute on function bar_issue_with_payment(uuid, text, text, date, text) to authenticated;
grant execute on function bar_reissue_with_payment(uuid, text, text, text, date, text) to authenticated;
