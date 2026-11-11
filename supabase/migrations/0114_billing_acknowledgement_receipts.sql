-- 0114 — Billing Periods: saved Acknowledgement Receipts.
--
-- Terms: docs/superpowers/specs/2026-11-09-billing-acknowledgement-receipts-mvp-terms.md
--        (owner's answers, 9 Nov 2026).
--
-- A client billing period can have one live Acknowledgement Receipt. Its amount
-- is ALWAYS that period's Fund Allocated, read here on the server: no function
-- accepts an amount. Each receipt gets a permanent number, AR-YYYYMM-NNN, that
-- is never reused. If Fund Allocated changes, the old receipt is voided with a
-- reason and stays on record, and a new one is issued with a new number.
--
-- A receipt keeps what it was issued with. Business details and payment details
-- are copied from Acknowledgement Settings (settings.invoiceDefaults), so later
-- changes never alter an old receipt.
--
-- OUTSIDE THE MONEY MODEL. Nothing here writes an expense, payroll row, invoice,
-- payment, budget or billing period, and nothing may feed these tables into
-- Spent / Earned / Profit. A receipt is a record of a document, not revenue.
-- Owner accounts only. Staff, workers, clients and partners get nothing.
-- Only js/billing-receipts.js calls the bar_* functions.

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════

-- folder_id and period_id have no foreign key on purpose: a receipt outlives a
-- deleted billing period or project.
create table if not exists billing_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  folder_id uuid not null,
  period_id uuid not null,
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
  constraint billing_receipts_void_complete check (
    (voided_at is null) = (void_reason is null) and (voided_at is null) = (voided_by is null)),
  constraint billing_receipts_no_unique unique (owner_id, receipt_no)
);
-- One live receipt per billing period.
create unique index if not exists billing_receipts_one_live on billing_receipts (period_id) where voided_at is null;
create index if not exists billing_receipts_folder_idx on billing_receipts (folder_id, created_at);

-- The running number for each company and month. The row lock taken by the
-- upsert holds the number until commit, so two receipts can never share one.
create table if not exists billing_receipt_counters (
  owner_id uuid not null,
  year_month text not null check (year_month ~ '^[0-9]{6}$'),
  last_no integer not null check (last_no > 0),
  primary key (owner_id, year_month)
);

-- The names typed once per project and offered again next time.
create table if not exists billing_receipt_parties (
  folder_id uuid primary key,
  owner_id uuid not null,
  received_from text not null default '',
  received_by text not null default '',
  updated_by uuid,
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists billing_receipt_parties_owner_idx on billing_receipt_parties (owner_id, updated_at desc);

alter table billing_receipts enable row level security;
alter table billing_receipt_counters enable row level security;
alter table billing_receipt_parties enable row level security;

revoke all on billing_receipts from public, anon, authenticated;
revoke all on billing_receipt_counters from public, anon, authenticated;
revoke all on billing_receipt_parties from public, anon, authenticated;

-- Owner accounts of the company may read receipts. There is no write grant: the
-- functions below are the only way in. The counters and names have no grant at all.
grant select on billing_receipts to authenticated;
drop policy if exists billing_receipts_owner_read on billing_receipts;
create policy billing_receipts_owner_read on billing_receipts for select to authenticated
  using (is_owner() and owner_id = attendance_data_owner());

-- ════ 2. A receipt can only ever be voided ══════════════

create or replace function billing_receipts_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'RECEIPT_PERMANENT' using errcode = 'P0001';
  end if;
  if old.voided_at is not null
     or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'])
        is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'RECEIPT_PERMANENT' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists billing_receipts_guard on billing_receipts;
create trigger billing_receipts_guard before update or delete on billing_receipts
  for each row execute function billing_receipts_guard();

-- ════ 3. Private helpers ════════════════════════════════

-- The company of the owner account calling. Refuses everyone else.
create or replace function bar_company() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text; v_owner uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select role, owner_id, status into v_role, v_owner, v_status from profiles where id = auth.uid();
  if not found then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  if coalesce(v_status, 'active') <> 'active' then raise exception 'INACTIVE' using errcode = 'P0001'; end if;
  if v_role is distinct from 'owner' then raise exception 'OWNER_ONLY' using errcode = 'P0001'; end if;
  return coalesce(v_owner, auth.uid());
end;
$$;

create or replace function bar_period_label(p_funding text, p_number integer, p_month text, p_year integer) returns text
language sql immutable set search_path = public, pg_temp as $$
  select (case p_funding
            when 'mobilization' then 'Mobilization'
            when 'downpayment' then 'Downpayment'
            when 'progress' then 'Progress Billing' || case when coalesce(p_number, 0) > 0 then ' ' || p_number else '' end
            when 'final' then 'Final Payment'
            else 'Billing Period'
          end)
         || coalesce(' (' || nullif(btrim(coalesce(p_month, '') || ' ' || coalesce(p_year::text, '')), '') || ')', '');
$$;

create or replace function bar_clean_name(p_name text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if v = '' then raise exception 'NAME_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v) > 200 then raise exception 'NAME_TOO_LONG' using errcode = 'P0001'; end if;
  return v;
end;
$$;

create or replace function bar_save_parties(p_company uuid, p_folder uuid, p_from text, p_by text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into billing_receipt_parties (folder_id, owner_id, received_from, received_by, updated_by, updated_at)
  values (p_folder, p_company, p_from, p_by, auth.uid(), clock_timestamp())
  on conflict (folder_id) do update
    set received_from = excluded.received_from, received_by = excluded.received_by,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- The caller must already hold the billing period's row lock.
create or replace function bar_new_receipt(p_company uuid, p_period uuid, p_from text, p_by text) returns billing_receipts
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
                                received_from, received_by, business, payment_details, created_by)
  values (p_company, v_p.folder_id, p_period,
          'AR-' || v_ym || '-' || lpad(v_n::text, greatest(3, char_length(v_n::text)), '0'),
          v_today,
          bar_period_label(v_p.funding_type, v_p.billing_number, v_p.month, v_p.year),
          v_amount, v_from, v_by,
          jsonb_build_object('name', coalesce(v_settings ->> 'businessName', ''),
                             'tin', coalesce(v_settings ->> 'businessTin', ''),
                             'address', coalesce(v_settings ->> 'businessAddress', '')),
          coalesce(v_settings -> 'paymentDetails', '{}'::jsonb),
          auth.uid())
  returning * into v_row;

  perform bar_save_parties(p_company, v_p.folder_id, v_from, v_by);
  return v_row;
end;
$$;

-- ════ 4. What the page calls ════════════════════════════

-- Everything the receipt dialogs need, fresh, for one project.
create or replace function bar_state(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_name text; v_description text;
  v_settings jsonb;
  v_from text; v_by text;
  v_periods jsonb; v_total numeric; v_receipts jsonb;
begin
  select name, description into v_name, v_description from folders where id = p_folder and owner_id = v_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select value into v_settings from settings where key = 'invoiceDefaults';

  select received_from, received_by into v_from, v_by from billing_receipt_parties where folder_id = p_folder;
  if coalesce(v_by, '') = '' then
    select received_by into v_by from billing_receipt_parties
     where owner_id = v_company and received_by <> '' order by updated_at desc limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'label', bar_period_label(p.funding_type, p.billing_number, p.month, p.year),
           'amount', round(coalesce(b.monthly_budget, 0), 2))), '[]'::jsonb),
         coalesce(sum(round(coalesce(b.monthly_budget, 0), 2)), 0)
    into v_periods, v_total
    from projects p left join project_budgets b on b.project_id = p.id
   where p.folder_id = p_folder and p.owner_id = v_company
     and p.funding_type is distinct from 'president';

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_receipts
    from billing_receipts r where r.folder_id = p_folder and r.owner_id = v_company;

  return jsonb_build_object(
    'folder', jsonb_build_object('id', p_folder, 'name', v_name, 'description', v_description),
    'received_from', coalesce(v_from, ''),
    'received_by', coalesce(v_by, ''),
    'business', jsonb_build_object('name', coalesce(v_settings ->> 'businessName', ''),
                                   'tin', coalesce(v_settings ->> 'businessTin', ''),
                                   'address', coalesce(v_settings ->> 'businessAddress', '')),
    'payment_details', coalesce(v_settings -> 'paymentDetails', '{}'::jsonb),
    'periods', v_periods,
    'total_received', v_total,
    'receipts', v_receipts);
end;
$$;

-- Issue the receipt for a billing period. Pressing again, or a retry, returns
-- the receipt that already exists and spends no number.
create or replace function bar_issue(p_period uuid, p_received_from text, p_received_by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_live billing_receipts%rowtype;
begin
  perform 1 from projects where id = p_period and owner_id = v_company and folder_id is not null for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_live from billing_receipts where period_id = p_period and voided_at is null;
  if found then return to_jsonb(v_live); end if;

  return to_jsonb(bar_new_receipt(v_company, p_period, p_received_from, p_received_by));
end;
$$;

-- Void a receipt and issue its replacement, together or not at all.
create or replace function bar_reissue(p_receipt uuid, p_reason text, p_received_from text, p_received_by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_period uuid;
  v_old billing_receipts%rowtype;
begin
  if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;

  select period_id into v_period from billing_receipts where id = p_receipt and owner_id = v_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  perform 1 from projects where id = v_period and owner_id = v_company for no key update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  select * into v_old from billing_receipts where id = p_receipt for update;
  if v_old.voided_at is not null then raise exception 'ALREADY_VOID' using errcode = 'P0001'; end if;

  update billing_receipts set voided_at = clock_timestamp(), voided_by = auth.uid(), void_reason = v_reason
   where id = p_receipt;

  return to_jsonb(bar_new_receipt(v_company, v_period, p_received_from, p_received_by));
end;
$$;

-- Save the project's names without issuing anything (the Overall page).
create or replace function bar_set_parties(p_folder uuid, p_received_from text, p_received_by text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := bar_company();
  v_from text := bar_clean_name(p_received_from);
  v_by text := bar_clean_name(p_received_by);
begin
  perform 1 from folders where id = p_folder and owner_id = v_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform bar_save_parties(v_company, p_folder, v_from, v_by);
end;
$$;

-- ════ 5. Who may call what ══════════════════════════════

revoke all on function billing_receipts_guard() from public, anon, authenticated;
revoke all on function bar_company() from public, anon, authenticated;
revoke all on function bar_period_label(text, integer, text, integer) from public, anon, authenticated;
revoke all on function bar_clean_name(text) from public, anon, authenticated;
revoke all on function bar_save_parties(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function bar_new_receipt(uuid, uuid, text, text) from public, anon, authenticated;

revoke all on function bar_state(uuid) from public, anon, authenticated;
revoke all on function bar_issue(uuid, text, text) from public, anon, authenticated;
revoke all on function bar_reissue(uuid, text, text, text) from public, anon, authenticated;
revoke all on function bar_set_parties(uuid, text, text) from public, anon, authenticated;
grant execute on function bar_state(uuid) to authenticated;
grant execute on function bar_issue(uuid, text, text) to authenticated;
grant execute on function bar_reissue(uuid, text, text, text) to authenticated;
grant execute on function bar_set_parties(uuid, text, text) to authenticated;
