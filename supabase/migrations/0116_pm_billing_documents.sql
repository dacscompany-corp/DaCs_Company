-- 0116 — Project Management: saved Acknowledgement Receipts for client
-- payments, the Billing Request's figures, and an office-only payment photo.
--
-- Spec: docs/superpowers/specs/2026-11-18-pm-billing-documents-design.md
--       (owner's answers, 18 Nov 2026).
--
-- A PM payment (a payment_requests row with construction_project_id) that the
-- client has paid can have one live Acknowledgement Receipt. Its amount is
-- ALWAYS the payment's paid amount, read here on the server: no function
-- accepts an amount. The paid amount follows the Total cash receipt rule
-- (js/pm-sharing.js paid()): verified → amount_paid, else paid_amount, else
-- total_amount; paid / partial → amount_paid; anything else → nothing.
-- Numbers come from 0114's billing_receipt_counters, so Project Control and
-- Project Management share ONE AR-YYYYMM-NNN series and a number is never
-- reused. If the paid amount changes, the old receipt is voided with a reason
-- and stays on record, and a new one is issued with a new number.
--
-- PM rows carry no owner_id (all null on live, 18 Nov 2026): PM access is by
-- role. A project or payment is accepted when its owner_id is null or is the
-- caller's company; the receipt stores the caller's company.
--
-- payment_requests.proof_url: a photo of the client's payment, a file in the
-- private `uploads` bucket under paymentReceipts/<account>/<yyyy-mm>/<uuid>.jpg.
-- No storage rule is added: 0110's office rule (owner or staff) already covers
-- the folder, the same access every office account has to the payment rows
-- themselves. Clients and workers get nothing. (A company lock was dropped after
-- review: each owner-role account, e.g. admin-pm@, is its own data_owner_id(),
-- so it would have hidden one office account's photos from the others.)
--
-- OUTSIDE THE MONEY MODEL. Nothing here writes an expense, payroll row,
-- invoice, payment, bill or budget, and nothing may feed these tables into
-- Spent / Earned / Profit, PM profit sharing, the warranty reserve or cash
-- advances. A receipt is a record of a document, not revenue.
-- Owner accounts only (bar_company()). Only js/pm-billing-docs.js calls the
-- pmar_* functions. 0114's tables and functions are used, never redefined.

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════

-- project_id and payment_id have no foreign key on purpose: a receipt outlives
-- its payment or project.
create table if not exists pm_billing_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  project_id uuid not null,
  payment_id uuid not null,
  receipt_no text not null,
  issued_on date not null,
  billing_label text not null check (char_length(billing_label) between 1 and 200),
  amount numeric(14,2) not null check (amount > 0),
  received_from text not null check (char_length(received_from) between 1 and 200),
  received_by text not null check (char_length(received_by) between 1 and 200),
  business jsonb not null default '{}'::jsonb,
  payment_details jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (void_reason is null or char_length(void_reason) between 1 and 500),
  constraint pm_billing_receipts_void_complete check (
    (voided_at is null) = (void_reason is null) and (voided_at is null) = (voided_by is null)),
  constraint pm_billing_receipts_no_unique unique (owner_id, receipt_no)
);
-- One live receipt per payment.
create unique index if not exists pm_billing_receipts_one_live on pm_billing_receipts (payment_id) where voided_at is null;
create index if not exists pm_billing_receipts_project_idx on pm_billing_receipts (project_id, created_at);

-- The names typed once per PM project and offered again next time.
create table if not exists pm_billing_receipt_parties (
  project_id uuid primary key,
  owner_id uuid not null,
  received_from text not null default '',
  received_by text not null default '',
  updated_by uuid,
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists pm_billing_receipt_parties_owner_idx on pm_billing_receipt_parties (owner_id, updated_at desc);

alter table pm_billing_receipts enable row level security;
alter table pm_billing_receipt_parties enable row level security;

revoke all on pm_billing_receipts from public, anon, authenticated;
revoke all on pm_billing_receipt_parties from public, anon, authenticated;

-- Owner accounts of the company may read receipts. There is no write grant: the
-- functions below are the only way in. The names table has no grant at all.
grant select on pm_billing_receipts to authenticated;
drop policy if exists pm_billing_receipts_owner_read on pm_billing_receipts;
create policy pm_billing_receipts_owner_read on pm_billing_receipts for select to authenticated
  using (is_owner() and owner_id = attendance_data_owner());

-- A receipt can only ever be voided, once: 0114's guard is table-agnostic.
drop trigger if exists pm_billing_receipts_guard on pm_billing_receipts;
create trigger pm_billing_receipts_guard before update or delete on pm_billing_receipts
  for each row execute function billing_receipts_guard();

-- ════ 2. The payment photo ══════════════════════════════

alter table payment_requests add column if not exists proof_url text;

-- ════ 3. Private helpers ════════════════════════════════

-- The paid amount of one payment row; 0 when it is not a paid payment.
create or replace function pmar_paid_amount(p_status text, p_amount_paid numeric, p_paid_amount numeric, p_total_amount numeric)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case
           when p_status = 'verified' then round(coalesce(nullif(p_amount_paid, 0), nullif(p_paid_amount, 0), p_total_amount, 0), 2)
           when p_status in ('paid', 'partial') then round(coalesce(p_amount_paid, 0), 2)
           else 0::numeric
         end;
$$;

-- "Payment received (Nov 13, 2026) · Ref. GC-123", cut to 200 characters.
create or replace function pmar_label(p_date text, p_reference text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_date date;
  v_ref text := btrim(coalesce(p_reference, ''));
begin
  if coalesce(p_date, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin v_date := p_date::date; exception when others then v_date := null; end;
  end if;
  return left('Payment received'
              || case when v_date is not null then ' (' || to_char(v_date, 'Mon FMDD, YYYY') || ')' else '' end
              || case when v_ref <> '' then ' · Ref. ' || v_ref else '' end, 200);
end;
$$;

-- The PM project, if it belongs to this company (or, like every live PM row, to none).
create or replace function pmar_project(p_company uuid, p_project uuid) returns construction_projects
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_row construction_projects%rowtype;
begin
  select * into v_row from construction_projects
   where id = p_project and (owner_id is null or owner_id = p_company);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  return v_row;
end;
$$;

-- The next number of the shared AR series. The row lock taken by the upsert
-- holds the number until commit, so two receipts can never share one.
create or replace function pmar_next_no(p_company uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ym text := to_char((now() at time zone 'Asia/Manila')::date, 'YYYYMM');
  v_n integer;
begin
  insert into billing_receipt_counters as c (owner_id, year_month, last_no)
  values (p_company, v_ym, 1)
  on conflict (owner_id, year_month) do update set last_no = c.last_no + 1
  returning c.last_no into v_n;
  return 'AR-' || v_ym || '-' || lpad(v_n::text, greatest(3, char_length(v_n::text)), '0');
end;
$$;

create or replace function pmar_save_parties(p_company uuid, p_project uuid, p_from text, p_by text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into pm_billing_receipt_parties (project_id, owner_id, received_from, received_by, updated_by, updated_at)
  values (p_project, p_company, p_from, p_by, auth.uid(), clock_timestamp())
  on conflict (project_id) do update
    set received_from = excluded.received_from, received_by = excluded.received_by,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- The caller must already hold the payment's row lock.
create or replace function pmar_new_receipt(p_company uuid, p_payment uuid, p_from text, p_by text) returns pm_billing_receipts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p payment_requests%rowtype;
  v_amount numeric;
  v_settings jsonb;
  v_from text := bar_clean_name(p_from);
  v_by text := bar_clean_name(p_by);
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
          pmar_label(v_p.week_ending_date, v_p.reference_number),
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

-- ════ 4. What the page calls ════════════════════════════

-- Everything the receipt dialog and the Billing Request need, fresh, for one PM project.
create or replace function pmar_state(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_proj construction_projects%rowtype;
  v_settings jsonb;
  v_from text; v_by text;
  v_payments jsonb; v_total numeric; v_receipts jsonb;
begin
  v_proj := pmar_project(v_company, p_project);

  select value into v_settings from settings where key = 'invoiceDefaults';

  select received_from, received_by into v_from, v_by from pm_billing_receipt_parties where project_id = p_project;
  v_from := coalesce(nullif(v_from, ''), v_proj.client_name, '');
  if coalesce(v_by, '') = '' then
    select x.received_by into v_by from (
      select received_by, updated_at from pm_billing_receipt_parties where owner_id = v_company and received_by <> ''
      union all
      select received_by, updated_at from billing_receipt_parties where owner_id = v_company and received_by <> ''
    ) x order by x.updated_at desc limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'date', x.week_ending_date, 'reference', nullif(btrim(coalesce(x.reference_number, '')), ''),
           'label', pmar_label(x.week_ending_date, x.reference_number), 'amount', x.amt, 'source', x.source)
           order by x.week_ending_date, x.created_at), '[]'::jsonb),
         coalesce(sum(x.amt), 0)
    into v_payments, v_total
    from (select r.*, pmar_paid_amount(r.status, r.amount_paid, r.paid_amount, r.total_amount) amt
            from payment_requests r
           where r.construction_project_id = p_project and (r.owner_id is null or r.owner_id = v_company)) x
   where x.amt > 0;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_receipts
    from pm_billing_receipts r where r.project_id = p_project and r.owner_id = v_company;

  return jsonb_build_object(
    'project', jsonb_build_object('id', v_proj.id, 'name', v_proj.project_name, 'address', v_proj.address,
                                  'client_name', v_proj.client_name, 'client_email', v_proj.client_email,
                                  'budget', v_proj.budget),
    'received_from', v_from,
    'received_by', coalesce(v_by, ''),
    'business', jsonb_build_object('name', coalesce(v_settings ->> 'businessName', ''),
                                   'tin', coalesce(v_settings ->> 'businessTin', ''),
                                   'address', coalesce(v_settings ->> 'businessAddress', '')),
    'payment_details', coalesce(v_settings -> 'paymentDetails', '{}'::jsonb),
    'payments', v_payments,
    'total_received', v_total,
    'receipts', v_receipts);
end;
$$;

-- Issue the receipt for a paid payment. Pressing again, or a retry, returns
-- the receipt that already exists and spends no number.
create or replace function pmar_issue(p_payment uuid, p_received_from text, p_received_by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_project uuid;
  v_live pm_billing_receipts%rowtype;
begin
  select construction_project_id into v_project from payment_requests
   where id = p_payment and construction_project_id is not null and (owner_id is null or owner_id = v_company)
     for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pmar_project(v_company, v_project);

  select * into v_live from pm_billing_receipts where payment_id = p_payment and voided_at is null;
  if found then return to_jsonb(v_live); end if;

  return to_jsonb(pmar_new_receipt(v_company, p_payment, p_received_from, p_received_by));
end;
$$;

-- Void a receipt and issue its replacement, together or not at all.
create or replace function pmar_reissue(p_receipt uuid, p_reason text, p_received_from text, p_received_by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_payment uuid;
  v_old pm_billing_receipts%rowtype;
begin
  if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;

  select payment_id into v_payment from pm_billing_receipts where id = p_receipt and owner_id = v_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform 1 from payment_requests where id = v_payment for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_old from pm_billing_receipts where id = p_receipt for update;
  if v_old.voided_at is not null then raise exception 'ALREADY_VOID' using errcode = 'P0001'; end if;

  update pm_billing_receipts set voided_at = clock_timestamp(), voided_by = auth.uid(), void_reason = v_reason
   where id = p_receipt;

  return to_jsonb(pmar_new_receipt(v_company, v_payment, p_received_from, p_received_by));
end;
$$;

-- ════ 5. Who may call what ══════════════════════════════

revoke all on function pmar_paid_amount(text, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function pmar_label(text, text) from public, anon, authenticated;
revoke all on function pmar_project(uuid, uuid) from public, anon, authenticated;
revoke all on function pmar_next_no(uuid) from public, anon, authenticated;
revoke all on function pmar_save_parties(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function pmar_new_receipt(uuid, uuid, text, text) from public, anon, authenticated;

revoke all on function pmar_state(uuid) from public, anon, authenticated;
revoke all on function pmar_issue(uuid, text, text) from public, anon, authenticated;
revoke all on function pmar_reissue(uuid, text, text, text) from public, anon, authenticated;
grant execute on function pmar_state(uuid) to authenticated;
grant execute on function pmar_issue(uuid, text, text) to authenticated;
grant execute on function pmar_reissue(uuid, text, text, text) to authenticated;
