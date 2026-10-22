-- ════════════════════════════════════════════════════════════════════
-- 0102 — WorkMate Stage 2A-4a: paying for purchases.
-- Answers: docs/superpowers/specs/2026-10-22-workmate-stage2a4-questions.md
-- Plan:    docs/superpowers/plans/2026-10-22-workmate-stage2a4a-payments-server-web.md
--
-- Supplier payments on a purchase (deposits, the rest, from petty cash, the
-- buyer's own money, the company directly or a supplier credit), Overpaid and
-- how it is resolved (refunds tied to the money that paid, supplier credit),
-- petty cash (given, reported back, confirmed, counted), "Company owes buyer"
-- and its repayments.
--
-- OUTSIDE THE MONEY MODEL (CLAUDE.md): nothing here writes or reads
-- `expenses` or `payroll`, and no Spent / Earned / Profit code reads these
-- tables. A payment, refund, credit, petty-cash entry or repayment never
-- creates an expense. Only a recorded purchase adds to Spent (0096).
--
-- • Nine private tables. RLS on, NO policies, privileges revoked. Every read
--   and write goes through the SECURITY DEFINER functions below.
-- • Who: payments — accounts that may buy (pur_buyer, 0097), in their own
--   company. Petty cash, repayments, the own-money switch, Overpaid and the
--   tracker — the MAIN owner (pm_main_owner_id, 0098) with the Expenses
--   section. A buyer reads and reports only their own cash.
-- • Every write takes an operation id (pur_ops, 0096): a retry returns the
--   first answer and writes nothing.
-- • Mistakes are VOIDED with a reason, never edited or deleted.
-- • pur_record gains "paid now" (Q3): the purchase and its payments are
--   accepted in ONE transaction, or neither is.
-- Requires 0096, 0097, 0098, 0101.
-- ════════════════════════════════════════════════════════════════════

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- Purchases recorded before 0102 read "Payment not tracked" (Q2) until a
-- payment is recorded on them; every purchase from now on is tracked.
alter table purchases add column if not exists payments_tracked boolean not null default false;
alter table purchases alter column payments_tracked set default true;

-- A credit with one supplier, confirmed from an overpaid purchase (Q9, Q11).
-- It is a BALANCE: used in parts by payments with source 'credit' until gone.
create table if not exists pur_supplier_credits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  supplier_id uuid not null references suppliers(id),
  purchase_id uuid not null references purchases(id),     -- the overpaid purchase it came from
  amount numeric(12,2) not null check (amount > 0),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_supplier_credits_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_supplier_credits_supplier on pur_supplier_credits (owner_id, supplier_id);
create index if not exists pur_supplier_credits_purchase on pur_supplier_credits (purchase_id);

-- One payment to the supplier, on the whole purchase (never per project).
--   source  petty_cash  person = the buyer whose petty cash paid
--           own_money   person = the buyer whose own money paid ("Company owes buyer")
--           company     person = who handed it over (optional) — owner/office paid directly
--           credit      credit_id = the supplier credit used; not cash
create table if not exists pur_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  -- The purchase it was first recorded on. A replacement moves purchase_id
  -- to the new version (R4); this never changes.
  first_purchase_id uuid not null references purchases(id),
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null,
  method text not null check (method in ('cash', 'gcash', 'bank_transfer', 'check', 'other')),
  source text not null check (source in ('petty_cash', 'own_money', 'company', 'credit')),
  person_id uuid references profiles(id),
  credit_id uuid references pur_supplier_credits(id),
  -- own_money only: was the buyer's "May use own money" switch on? (Q21)
  -- If not, the main owner accepts it (then it is owed) or rejects it with a
  -- reason (never owed); either decision stays (R9).
  authorized boolean not null default true,
  accepted_by uuid references profiles(id),
  accepted_at timestamptz,
  rejected_by uuid references profiles(id),
  rejected_at timestamptz,
  reject_reason text,
  proof_url text not null default '' check (proof_url = '' or proof_url ~ '^https://'),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_payments_person_chk check (source not in ('petty_cash', 'own_money') or person_id is not null),
  constraint pur_payments_credit_chk check ((source = 'credit') = (credit_id is not null)),
  constraint pur_payments_decision_chk check (
    (accepted_at is null or rejected_at is null)
    and ((rejected_at is null and rejected_by is null and reject_reason is null)
         or (rejected_at is not null and rejected_by is not null and char_length(btrim(reject_reason)) between 1 and 500))),
  constraint pur_payments_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_payments_purchase on pur_payments (purchase_id);
create index if not exists pur_payments_person on pur_payments (owner_id, person_id, paid_on);
create index if not exists pur_payments_credit on pur_payments (credit_id) where credit_id is not null;

-- A refund from the supplier, tied to the money that paid (Q10):
--   funded_by   received_by   effect
--   petty_cash  petty_cash    the buyer's cash held goes up (person = that buyer)
--   petty_cash  company       nothing moves (the company has its money back)
--   own_money   buyer         "Company owes buyer" goes down (person = that buyer)
--   own_money   company       nothing moves (the company still owes the buyer)
--   company     company       nothing moves
--   company     petty_cash    company cash now held by the buyer (person = the buyer who received it)
--   credit      company       the supplier paid back in cash what a credit had paid — instead of the
--   credit      petty_cash      default, back to its credit (Q10); in a buyer's hands it is cash they hold
create table if not exists pur_refunds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  amount numeric(12,2) not null check (amount > 0),
  funded_by text not null check (funded_by in ('petty_cash', 'own_money', 'company', 'credit')),
  received_by text not null check (received_by in ('petty_cash', 'company', 'buyer')),
  person_id uuid references profiles(id),
  received_on date not null,
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_refunds_route_chk check (
    (funded_by = 'petty_cash' and received_by in ('petty_cash', 'company') and person_id is not null)
    or (funded_by = 'own_money' and received_by in ('buyer', 'company') and person_id is not null)
    or (funded_by in ('company', 'credit') and received_by = 'company' and person_id is null)
    or (funded_by in ('company', 'credit') and received_by = 'petty_cash' and person_id is not null)),
  constraint pur_refunds_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_refunds_purchase on pur_refunds (purchase_id);
create index if not exists pur_refunds_person on pur_refunds (owner_id, person_id, received_on);

-- Petty cash the main owner gave a buyer (Q13). It counts at once; the buyer
-- may say it never arrived (Q14), which flags it and changes nothing.
create table if not exists pur_cash_issues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  issued_on date not null,
  method text not null check (method in ('cash', 'gcash', 'bank_transfer', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  disputed_at timestamptz, dispute_note text check (char_length(dispute_note) <= 300),
  dispute_cleared_at timestamptz, dispute_cleared_by uuid references profiles(id),
  dispute_cleared_note text check (char_length(dispute_cleared_note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_cash_issues_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_cash_issues_buyer on pur_cash_issues (owner_id, buyer_id, issued_on);

-- Unused petty cash handed back (Q17). The buyer reports it; only the main
-- owner's confirmation lowers the balance, on the confirmation day (Q18).
create table if not exists pur_cash_returns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  handed_on date not null,
  handed_to text not null default '' check (char_length(handed_to) <= 120),
  photo_url text not null default '' check (photo_url = '' or photo_url ~ '^https://'),
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'reported' check (status in ('reported', 'withdrawn', 'confirmed', 'rejected')),
  decided_at timestamptz, decided_by uuid references profiles(id),
  decision_note text check (char_length(decision_note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_cash_returns_decided_chk check ((status in ('confirmed', 'rejected')) = (decided_at is not null)),
  constraint pur_cash_returns_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (status = 'confirmed' and voided_at is not null and voided_by is not null
        and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_cash_returns_buyer on pur_cash_returns (owner_id, buyer_id, status);

-- A cash count by the main owner (Q19): a record only, never a balance change.
create table if not exists pur_cash_counts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  counted_on date not null,
  counted numeric(12,2) not null check (counted >= 0),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_cash_counts_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_cash_counts_buyer on pur_cash_counts (owner_id, buyer_id, counted_on);

-- "May use own money" (Q21), one row per staff account that ever had it.
create table if not exists pur_own_money (
  user_id uuid primary key references profiles(id),
  owner_id uuid not null references profiles(id),
  allowed boolean not null default false,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);

-- The company repaying a buyer's own money (Q22).
create table if not exists pur_buyer_repayments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null,
  method text not null check (method in ('cash', 'gcash', 'bank_transfer', 'check', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid references profiles(id), void_reason text,
  constraint pur_buyer_repayments_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create index if not exists pur_buyer_repayments_buyer on pur_buyer_repayments (owner_id, buyer_id, paid_on);

-- Append-only history of everything above.
create table if not exists pur_money_events (
  seq bigint generated always as identity primary key,
  owner_id uuid not null,
  kind text not null,
  purchase_id uuid,
  person_id uuid,
  ref_id uuid,
  amount numeric(12,2),
  detail jsonb,
  reason text,
  actor_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists pur_money_events_ref on pur_money_events (owner_id, ref_id);
create index if not exists pur_money_events_person on pur_money_events (owner_id, person_id, seq);

create or replace function pur_money_events_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists pur_money_events_immutable_trg on pur_money_events;
create trigger pur_money_events_immutable_trg
  before update or delete on pur_money_events for each row execute function pur_money_events_immutable();

-- ════ 2. Internal helpers (never granted to clients) ══════════════════

-- Today in the Philippines (UTC+8, no daylight time).
create or replace function pur_manila_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Manila')::date $$;

-- A peso amount above 0, at most two decimals, below ₱10 billion.
create or replace function pur_pos_money(p text) returns numeric
language plpgsql immutable as $$
declare v numeric := pur_money(p);
begin
  if v is null or v <= 0 or v >= 10000000000 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- A "YYYY-MM-DD" day that has happened (Philippine date), from 2020 on.
create or replace function pur_past_day(p text) returns date
language plpgsql stable as $$
declare v date;
begin
  if coalesce(btrim(p), '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  begin
    v := btrim(p)::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if v < date '2020-01-01' or v > pur_manila_today() then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Optional free text, trimmed; longer than p_max is refused.
create or replace function pur_note(p text, p_max int default 300) returns text
language plpgsql immutable as $$
begin
  if char_length(btrim(coalesce(p, ''))) > p_max then
    raise exception 'BAD_NOTE' using errcode = 'P0001';
  end if;
  return btrim(coalesce(p, ''));
end;
$$;

-- A required reason (voids, rejections, disputes).
create or replace function pur_reason(p text) returns text
language plpgsql immutable as $$
begin
  if char_length(btrim(coalesce(p, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  return btrim(p);
end;
$$;

-- The caller may buy; their company. (Payments, the buyer's own cash.)
create or replace function pur_pay_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

-- Is the caller the main owner (0098's definition) with the Expenses section?
create or replace function pur_is_main_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner' and p.owner_id is null and coalesce(p.status, 'active') = 'active'
       and (jsonb_typeof(p.allowed_modules) is distinct from 'array'
            or jsonb_array_length(p.allowed_modules) = 0 or p.allowed_modules ? 'expenses')
      from profiles p where p.id = auth.uid()), false)
$$;

-- The main owner's company (= their own id), else refused.
create or replace function pur_main_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := pm_main_owner_id();
begin
  if not pur_is_main_owner() then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- A staff account of this company: the only kind that holds petty cash or
-- can be owed its own money. (Owner accounts pay as 'company'.)
create or replace function pur_holder_ok(p_owner uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = p_person and p.role = 'staff' and p.owner_id = p_owner)
$$;

create or replace function pur_own_money_on(p_owner uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select m.allowed from pur_own_money m where m.user_id = p_person and m.owner_id = p_owner), false)
$$;

create or replace function pur_event(p_owner uuid, p_kind text, p_purchase uuid, p_person uuid, p_ref uuid,
                                     p_amount numeric, p_detail jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into pur_money_events (owner_id, kind, purchase_id, person_id, ref_id, amount, detail, reason, actor_id)
  values (p_owner, p_kind, p_purchase, p_person, p_ref, p_amount, p_detail, p_reason, auth.uid());
end;
$$;

-- Store the answer to an operation (0096's pur_ops) and return it.
create or replace function pur_op_done(p_owner uuid, p_op uuid, p_kind text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (p_owner, p_op, auth.uid(), p_kind, p_result);
  return p_result;
end;
$$;

-- One person's money, taken one change at a time (repayments against what is owed).
create or replace function pur_person_lock(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pur_person:' || p_person, 0));
end;
$$;

-- What a supplier credit has left.
create or replace function pur_credit_left(p_credit uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select c.amount - coalesce((select sum(p.amount) from pur_payments p
                               where p.credit_id = c.id and p.voided_at is null), 0)
    from pur_supplier_credits c where c.id = p_credit
$$;

-- Payments on a purchase from one source (and one person, for the buyer's own money / petty cash).
create or replace function pur_paid_from(p_purchase uuid, p_source text, p_person uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from pur_payments
   where purchase_id = p_purchase and voided_at is null and source = p_source
     and (p_source not in ('petty_cash', 'own_money') or person_id = p_person)
$$;

-- Refunds already recorded against that same money.
create or replace function pur_refunded_from(p_purchase uuid, p_source text, p_person uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from pur_refunds
   where purchase_id = p_purchase and voided_at is null and funded_by = p_source
     and (p_source not in ('petty_cash', 'own_money') or person_id = p_person)
$$;

-- How much of an overpayment is already resolved: refunds + credits from it.
create or replace function pur_resolved(p_purchase uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from pur_refunds where purchase_id = p_purchase and voided_at is null), 0)
       + coalesce((select sum(amount) from pur_supplier_credits where purchase_id = p_purchase and voided_at is null), 0)
$$;

-- A purchase's payment state (Q2, Q8). due = the receipt total while the
-- purchase is recorded, ₱0 once voided. excess = paid − due when above 0;
-- the part not yet refunded or credited is "unresolved".
--   not_tracked  recorded before 0102 and never given a payment
--   unpaid · partial · paid · overpaid (unresolved excess)
--   void         voided, nothing (left) to recover
--   void_paid    voided with money paid still to recover
create or replace function pur_pay_state(p_purchase uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pu purchases;
  v_due numeric; v_paid numeric; v_excess numeric; v_resolved numeric; v_unresolved numeric; v_state text;
begin
  select * into pu from purchases where id = p_purchase;
  if pu.id is null then return null; end if;
  v_paid := coalesce((select sum(amount) from pur_payments where purchase_id = p_purchase and voided_at is null), 0);
  v_due := case when pu.status = 'recorded' then pu.receipt_total else 0 end;
  v_excess := greatest(0, v_paid - v_due);
  v_resolved := pur_resolved(p_purchase);
  v_unresolved := greatest(0, v_excess - v_resolved);
  v_state := case
    when pu.status <> 'recorded' then case when v_unresolved > 0 then 'void_paid' else 'void' end
    when not pu.payments_tracked and v_paid = 0 then 'not_tracked'
    when v_unresolved > 0 then 'overpaid'
    when v_paid = 0 then 'unpaid'
    when v_paid < v_due then 'partial'
    else 'paid' end;
  return jsonb_build_object('state', v_state, 'tracked', pu.payments_tracked, 'due', v_due, 'paid', v_paid,
                            'balance', greatest(0, v_due - v_paid), 'excess', v_excess, 'resolved', v_resolved,
                            'unresolved', v_unresolved,
                            -- A correction raised the total after a refund or credit: more was given back than is now over.
                            'over_resolved', greatest(0, v_resolved - v_excess));
end;
$$;

-- Was an entry still standing at the end of a day? (null day = now.) A void
-- counts on the day it was made, never before (R7): a past day's closing
-- never changes; the void shows as a reversal on its own day.
create or replace function pur_stood(p_voided_at timestamptz, p_upto date) returns boolean
language sql immutable as $$
  select p_voided_at is null or (p_upto is not null and (p_voided_at at time zone 'Asia/Manila')::date > p_upto)
$$;

-- A buyer's petty cash as recorded at the end of p_upto (Q16, Q18, R7; null
-- = now). Can be below 0: the screens show ₱0 held and the rest as an
-- "Unreconciled shortfall". Returns count on the day the main owner
-- confirmed them; voids on the day they were made (Philippine dates).
create or replace function pur_cash_raw(p_owner uuid, p_buyer uuid, p_upto date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from pur_cash_issues
                    where owner_id = p_owner and buyer_id = p_buyer and pur_stood(voided_at, p_upto)
                      and (p_upto is null or issued_on <= p_upto)), 0)
       + coalesce((select sum(amount) from pur_refunds
                    where owner_id = p_owner and person_id = p_buyer and received_by = 'petty_cash' and pur_stood(voided_at, p_upto)
                      and (p_upto is null or received_on <= p_upto)), 0)
       - coalesce((select sum(amount) from pur_payments
                    where owner_id = p_owner and person_id = p_buyer and source = 'petty_cash' and pur_stood(voided_at, p_upto)
                      and (p_upto is null or paid_on <= p_upto)), 0)
       - coalesce((select sum(amount) from pur_cash_returns
                    where owner_id = p_owner and buyer_id = p_buyer and status = 'confirmed' and pur_stood(voided_at, p_upto)
                      and (p_upto is null or (decided_at at time zone 'Asia/Manila')::date <= p_upto)), 0)
$$;

-- What the company owes a buyer for their own money (Q21, Q22): authorized
-- or owner-accepted own-money payments, less own-money refunds the buyer
-- received, less repayments. Unauthorized ones not yet accepted are apart.
create or replace function pur_owes(p_owner uuid, p_buyer uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from pur_payments
                    where owner_id = p_owner and person_id = p_buyer and source = 'own_money' and voided_at is null
                      and (authorized or accepted_at is not null)), 0)
       - coalesce((select sum(amount) from pur_refunds
                    where owner_id = p_owner and person_id = p_buyer and funded_by = 'own_money'
                      and received_by = 'buyer' and voided_at is null), 0)
       - coalesce((select sum(amount) from pur_buyer_repayments
                    where owner_id = p_owner and buyer_id = p_buyer and voided_at is null), 0)
$$;

create or replace function pur_owes_to_review(p_owner uuid, p_buyer uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from pur_payments
   where owner_id = p_owner and person_id = p_buyer and source = 'own_money' and voided_at is null
     and not authorized and accepted_at is null and rejected_at is null
$$;

-- One payment, inserted on a purchase the caller has locked (pur_pay, pur_record).
-- p_pay: {amount, paid_on, method, source, person_id?, credit_id?, proof_url?, note?}
create or replace function pur_pay_insert(p_owner uuid, p_purchase uuid, p_pay jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  pu purchases;
  v_amount numeric;
  v_day date;
  v_method text := btrim(coalesce(p_pay ->> 'method', ''));
  v_source text := btrim(coalesce(p_pay ->> 'source', ''));
  v_person uuid := pur_uuid(p_pay ->> 'person_id');
  v_credit uuid := pur_uuid(p_pay ->> 'credit_id');
  v_proof text := btrim(coalesce(p_pay ->> 'proof_url', ''));
  v_note text := pur_note(p_pay ->> 'note');
  v_authorized boolean := true;
  c pur_supplier_credits;
  v_id uuid;
begin
  if jsonb_typeof(p_pay) is distinct from 'object' then
    raise exception 'BAD_PAY' using errcode = 'P0001';
  end if;
  select * into pu from purchases where id = p_purchase and owner_id = p_owner;
  if pu.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if pu.status <> 'recorded' then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  v_amount := pur_pos_money(p_pay ->> 'amount');
  v_day := pur_past_day(p_pay ->> 'paid_on');
  if v_source not in ('petty_cash', 'own_money', 'company', 'credit') then
    raise exception 'BAD_PAY_SOURCE' using errcode = 'P0001';
  end if;
  if v_proof <> '' and v_proof !~ '^https://' then
    raise exception 'BAD_DOCS' using errcode = 'P0001';
  end if;
  if (p_pay ? 'person_id') and nullif(btrim(coalesce(p_pay ->> 'person_id', '')), '') is not null and v_person is null then
    raise exception 'BAD_PERSON' using errcode = 'P0001';
  end if;

  if v_source in ('petty_cash', 'own_money') then
    -- A buyer's own cash: staff record their own; the main owner anyone's.
    if v_person is null and is_staff() then v_person := v_uid; end if;
    if v_person is null then raise exception 'PERSON_REQUIRED' using errcode = 'P0001'; end if;
    if v_person <> v_uid and not pur_is_main_owner() then
      raise exception 'PERSON_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if not pur_holder_ok(p_owner, v_person) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
    if v_source = 'own_money' then v_authorized := pur_own_money_on(p_owner, v_person); end if;
  elsif v_source = 'company' then
    if v_person is null then v_person := v_uid; end if;
    if not exists (select 1 from profiles p where p.id = v_person
                     and (p.id = p_owner or (p.role in ('owner', 'staff') and p.owner_id = p_owner))) then
      raise exception 'BAD_PERSON' using errcode = 'P0001';
    end if;
  end if;

  if v_source = 'credit' then
    if v_credit is null then raise exception 'CREDIT_REQUIRED' using errcode = 'P0001'; end if;
    select * into c from pur_supplier_credits where id = v_credit and owner_id = p_owner for update;
    if c.id is null or c.voided_at is not null then raise exception 'CREDIT_GONE' using errcode = 'P0001'; end if;
    if pu.supplier_id is null or c.supplier_id <> pu.supplier_id then
      raise exception 'CREDIT_SUPPLIER' using errcode = 'P0001';
    end if;
    if v_amount > pur_credit_left(v_credit) then raise exception 'OVER_CREDIT' using errcode = 'P0001'; end if;
    v_method := 'other';
    v_person := null;
  elsif v_credit is not null then
    raise exception 'BAD_PAY' using errcode = 'P0001';
  end if;
  if v_method not in ('cash', 'gcash', 'bank_transfer', 'check', 'other') then
    raise exception 'BAD_METHOD' using errcode = 'P0001';
  end if;

  insert into pur_payments (owner_id, purchase_id, first_purchase_id, amount, paid_on, method, source, person_id, credit_id,
                            authorized, proof_url, note, created_by)
  values (p_owner, p_purchase, p_purchase, v_amount, v_day, v_method, v_source, v_person, v_credit,
          v_authorized, v_proof, v_note, v_uid)
  returning id into v_id;
  update purchases set payments_tracked = true where id = p_purchase and not payments_tracked;
  perform pur_event(p_owner, 'paid', p_purchase, v_person, v_id, v_amount,
                    jsonb_build_object('source', v_source, 'method', v_method, 'paid_on', v_day,
                                       'credit_id', v_credit, 'authorized', v_authorized), null);
  return v_id;
end;
$$;

-- ════ 3. "Paid now": the purchase and its payments in ONE transaction (Q3) ══

-- 0097's header check, plus: a correction or replacement never carries
-- payments (they are recorded on the purchase, Record payment).
create or replace function pur_header_ok(p_body jsonb) returns void
language plpgsql immutable as $$
begin
  if coalesce(p_body ->> 'purchase_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  begin
    perform (p_body ->> 'purchase_date')::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if coalesce(p_body ->> 'date_time', '') <> '' and left(p_body ->> 'date_time', 10) <> p_body ->> 'purchase_date' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  if pur_money(p_body ->> 'receipt_total') is null then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  if coalesce(p_body ->> 'source', 'expenses_form') not in ('expenses_form', 'workmate', 'purchasing') then
    raise exception 'BAD_SOURCE' using errcode = 'P0001';
  end if;
  if p_body ? 'payments' then
    raise exception 'BAD_PAY' using errcode = 'P0001';
  end if;
end;
$$;

-- 0096's pur_record, plus body.payments: [{amount, paid_on, method, source,
-- person_id?, credit_id?, proof_url?, note?}], at most 5. A refused payment
-- refuses the purchase too: nothing is saved (one transaction).
create or replace function pur_record(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  v_result jsonb;
  v_pays jsonb := coalesce(p_body -> 'payments', '[]'::jsonb);
  v_body jsonb := p_body - 'payments';
  v_pay jsonb;
  v_ids jsonb := '[]'::jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if jsonb_typeof(v_pays) <> 'array' or jsonb_array_length(v_pays) > 5 then
    raise exception 'BAD_PAY' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_pays) > 0 and not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_header_ok(v_body);
  perform pur_lock(pur_body_keys(v_body));
  perform set_config('dacs.purchase_write', 'on', true);
  v_result := pur_insert(v_owner, v_uid, v_body, null);
  for v_pay in select value from jsonb_array_elements(v_pays) loop
    v_ids := v_ids || to_jsonb(pur_pay_insert(v_owner, (v_result ->> 'purchase_id')::uuid, v_pay));
  end loop;
  if jsonb_array_length(v_pays) > 0 then
    v_result := v_result || jsonb_build_object('payments', v_ids, 'pay', pur_pay_state((v_result ->> 'purchase_id')::uuid));
  end if;
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'record', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- A replacement (pur_replace) is the same purchase in a new row: its
-- payments, refunds and credits follow it, and so does "not tracked" (R4).
-- Each moved row keeps its own details (a payment its first_purchase_id)
-- and gets its own history entry. Counted on the new version only: the old
-- one, void with nothing left on it, has nothing to recover.
create or replace function pur_pay_follow_replace() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_moved int := 0; r record;
begin
  if old.replaced_by is null and new.replaced_by is not null then
    for r in update pur_payments set purchase_id = new.replaced_by where purchase_id = old.id
             returning id, amount, person_id loop
      v_moved := v_moved + 1;
      perform pur_event(old.owner_id, 'payment_moved', new.replaced_by, r.person_id, r.id, r.amount,
                        jsonb_build_object('from_purchase', old.id), null);
    end loop;
    for r in update pur_refunds set purchase_id = new.replaced_by where purchase_id = old.id
             returning id, amount, person_id loop
      perform pur_event(old.owner_id, 'refund_moved', new.replaced_by, r.person_id, r.id, r.amount,
                        jsonb_build_object('from_purchase', old.id), null);
    end loop;
    for r in update pur_supplier_credits set purchase_id = new.replaced_by where purchase_id = old.id
             returning id, amount loop
      perform pur_event(old.owner_id, 'credit_moved', new.replaced_by, null, r.id, r.amount,
                        jsonb_build_object('from_purchase', old.id), null);
    end loop;
    update purchases set payments_tracked = old.payments_tracked or v_moved > 0 where id = new.replaced_by;
  end if;
  return null;
end;
$$;
drop trigger if exists purchases_pay_follow_replace on purchases;
create trigger purchases_pay_follow_replace
  after update of replaced_by on purchases for each row execute function pur_pay_follow_replace();

-- ════ 4. Payments (buyers, Q4–Q8) ═════════════════════════════════════

-- Record a later payment on a recorded purchase.
create or replace function pur_pay(p_op uuid, p_purchase uuid, p_payment jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  perform pur_purchase_lock(p_purchase);
  if not exists (select 1 from purchases where id = p_purchase and owner_id = v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  v_id := pur_pay_insert(v_owner, p_purchase, p_payment);
  return pur_op_done(v_owner, p_op, 'pay', jsonb_build_object('purchase_id', p_purchase, 'payment_id', v_id,
                                                              'pay', pur_pay_state(p_purchase)));
end;
$$;

-- Void a payment (Q7): the person who recorded it, or the main owner. A
-- void that would leave more refunded or credited than is still over is
-- refused until that refund or credit is voided (RESOLVED_FIRST).
create or replace function pur_void_payment(p_op uuid, p_payment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  v_purchase uuid;
  pay pur_payments;
  v_state jsonb;
  v_before numeric;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select purchase_id into v_purchase from pur_payments where id = p_payment and owner_id = v_owner;
  if v_purchase is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pur_purchase_lock(v_purchase);
  select * into pay from pur_payments where id = p_payment for update;
  if pay.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  if pay.created_by <> auth.uid() and not pur_is_main_owner() then
    raise exception 'NOT_YOURS' using errcode = 'P0001';
  end if;
  v_before := (pur_pay_state(pay.purchase_id) ->> 'over_resolved')::numeric;
  update pur_payments set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_payment;
  v_state := pur_pay_state(pay.purchase_id);
  -- Refused only when THIS void leaves more given back than is over, or more
  -- refunded than that money now paid.
  if (v_state ->> 'over_resolved')::numeric > v_before
     or (pay.source in ('petty_cash', 'own_money', 'company')
         and pur_refunded_from(pay.purchase_id, pay.source, pay.person_id) > pur_paid_from(pay.purchase_id, pay.source, pay.person_id)) then
    raise exception 'RESOLVED_FIRST' using errcode = 'P0001';
  end if;
  perform pur_event(v_owner, 'payment_voided', pay.purchase_id, pay.person_id, p_payment, pay.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'void_payment', jsonb_build_object('purchase_id', pay.purchase_id, 'pay', v_state));
end;
$$;

-- The main owner accepts an own-money payment made while "May use own
-- money" was off (Q21): from then on it counts in "Company owes buyer".
create or replace function pur_accept_own_money(p_op uuid, p_payment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  pay pur_payments;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into pay from pur_payments where id = p_payment and owner_id = v_owner for update;
  if pay.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if pay.source <> 'own_money' or pay.authorized or pay.accepted_at is not null or pay.rejected_at is not null
     or pay.voided_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update pur_payments set accepted_by = auth.uid(), accepted_at = now() where id = p_payment;
  perform pur_event(v_owner, 'own_money_accepted', pay.purchase_id, pay.person_id, p_payment, pay.amount, null, null);
  return pur_op_done(v_owner, p_op, 'accept_own_money',
                     jsonb_build_object('payment_id', p_payment, 'owes', pur_owes(v_owner, pay.person_id)));
end;
$$;

-- ... or rejects it, with a reason (R9): it is never owed. The payment
-- itself stays — the supplier was paid — and so does the decision.
create or replace function pur_reject_own_money(p_op uuid, p_payment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  pay pur_payments;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into pay from pur_payments where id = p_payment and owner_id = v_owner for update;
  if pay.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if pay.source <> 'own_money' or pay.authorized or pay.accepted_at is not null or pay.rejected_at is not null
     or pay.voided_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update pur_payments set rejected_by = auth.uid(), rejected_at = now(), reject_reason = v_reason where id = p_payment;
  perform pur_event(v_owner, 'own_money_rejected', pay.purchase_id, pay.person_id, p_payment, pay.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'reject_own_money',
                     jsonb_build_object('payment_id', p_payment, 'owes', pur_owes(v_owner, pay.person_id)));
end;
$$;

-- ════ 5. Overpaid: refunds and supplier credit (main owner, Q9–Q12) ══════

-- p_refunds: [{amount, funded_by, received_by, person_id?, received_on, note?}]
-- p_credit:  {amount, supplier_id?, note?} or null
-- Each refund part is capped by what that money paid; refunds + credits
-- never exceed what is over. All parts are saved together or not at all.
create or replace function pur_resolve_overpaid(p_op uuid, p_purchase uuid, p_refunds jsonb, p_credit jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  pu purchases;
  v_state jsonb;
  v_part jsonb;
  v_amount numeric;
  v_total numeric := 0;
  v_funded text; v_recv text; v_person uuid; v_day date;
  v_supplier uuid;
  v_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_refunds jsonb := coalesce(p_refunds, '[]'::jsonb);
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  perform pur_purchase_lock(p_purchase);
  select * into pu from purchases where id = p_purchase and owner_id = v_owner;
  if pu.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_refunds) <> 'array' or jsonb_array_length(v_refunds) > 10
     or (p_credit is not null and jsonb_typeof(p_credit) not in ('object', 'null')) then
    raise exception 'BAD_RESOLUTION' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_refunds) = 0 and (p_credit is null or jsonb_typeof(p_credit) = 'null') then
    raise exception 'NOTHING_TO_RESOLVE' using errcode = 'P0001';
  end if;

  for v_part in select value from jsonb_array_elements(v_refunds) loop
    v_amount := pur_pos_money(v_part ->> 'amount');
    v_funded := btrim(coalesce(v_part ->> 'funded_by', ''));
    v_recv := btrim(coalesce(v_part ->> 'received_by', ''));
    v_person := pur_uuid(v_part ->> 'person_id');
    v_day := pur_past_day(v_part ->> 'received_on');
    if v_funded in ('company', 'credit') and v_recv = 'company' then
      v_person := null;
    elsif not ((v_funded = 'petty_cash' and v_recv in ('petty_cash', 'company'))
               or (v_funded = 'own_money' and v_recv in ('buyer', 'company'))
               or (v_funded in ('company', 'credit') and v_recv = 'petty_cash')) then
      raise exception 'BAD_REFUND_ROUTE' using errcode = 'P0001';
    elsif v_person is null or not pur_holder_ok(v_owner, v_person) then
      raise exception 'NOT_A_BUYER' using errcode = 'P0001';
    end if;
    -- Never more back than that money paid (company / credit: any payment of that kind).
    if pur_refunded_from(p_purchase, v_funded, v_person) + v_amount
       > pur_paid_from(p_purchase, v_funded, case when v_funded in ('company', 'credit') then null else v_person end) then
      raise exception 'OVER_SOURCE' using errcode = 'P0001';
    end if;
    insert into pur_refunds (owner_id, purchase_id, amount, funded_by, received_by, person_id, received_on, note, created_by)
    values (v_owner, p_purchase, v_amount, v_funded, v_recv, v_person, v_day, pur_note(v_part ->> 'note'), auth.uid())
    returning id into v_id;
    perform pur_event(v_owner, 'refunded', p_purchase, v_person, v_id, v_amount,
                      jsonb_build_object('funded_by', v_funded, 'received_by', v_recv, 'received_on', v_day), null);
    v_ids := v_ids || jsonb_build_object('refund_id', v_id);
    v_total := v_total + v_amount;
  end loop;

  if p_credit is not null and jsonb_typeof(p_credit) = 'object' then
    v_amount := pur_pos_money(p_credit ->> 'amount');
    v_supplier := coalesce(pur_uuid(p_credit ->> 'supplier_id'), pu.supplier_id);
    if v_supplier is null or not exists (select 1 from suppliers s where s.id = v_supplier and s.owner_id = v_owner) then
      raise exception 'CREDIT_SUPPLIER' using errcode = 'P0001';
    end if;
    insert into pur_supplier_credits (owner_id, supplier_id, purchase_id, amount, note, created_by)
    values (v_owner, v_supplier, p_purchase, v_amount, pur_note(p_credit ->> 'note'), auth.uid())
    returning id into v_id;
    perform pur_event(v_owner, 'credit_confirmed', p_purchase, null, v_id, v_amount,
                      jsonb_build_object('supplier_id', v_supplier), null);
    v_ids := v_ids || jsonb_build_object('credit_id', v_id);
    v_total := v_total + v_amount;
  end if;

  -- The same peso is resolved once: refunds + credits never pass what is over.
  v_state := pur_pay_state(p_purchase);
  if (v_state ->> 'over_resolved')::numeric > 0 then
    raise exception 'OVER_RESOLVED' using errcode = 'P0001';
  end if;
  return pur_op_done(v_owner, p_op, 'resolve_overpaid',
                     jsonb_build_object('purchase_id', p_purchase, 'created', v_ids, 'pay', v_state));
end;
$$;

create or replace function pur_void_refund(p_op uuid, p_refund uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  r pur_refunds;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into r from pur_refunds where id = p_refund and owner_id = v_owner;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pur_purchase_lock(r.purchase_id);
  select * into r from pur_refunds where id = p_refund for update;
  if r.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pur_refunds set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_refund;
  perform pur_event(v_owner, 'refund_voided', r.purchase_id, r.person_id, p_refund, r.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'void_refund', jsonb_build_object('purchase_id', r.purchase_id, 'pay', pur_pay_state(r.purchase_id)));
end;
$$;

-- A credit already used is not voided (void its uses first).
create or replace function pur_void_credit(p_op uuid, p_credit uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  c pur_supplier_credits;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into c from pur_supplier_credits where id = p_credit and owner_id = v_owner;
  if c.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pur_purchase_lock(c.purchase_id);
  select * into c from pur_supplier_credits where id = p_credit for update;
  if c.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  if exists (select 1 from pur_payments where credit_id = p_credit and voided_at is null) then
    raise exception 'CREDIT_USED' using errcode = 'P0001';
  end if;
  update pur_supplier_credits set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_credit;
  perform pur_event(v_owner, 'credit_voided', c.purchase_id, null, p_credit, c.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'void_credit', jsonb_build_object('purchase_id', c.purchase_id, 'pay', pur_pay_state(c.purchase_id)));
end;
$$;

-- ════ 6. Petty cash (Q13–Q19) ═════════════════════════════════════════

create or replace function pur_cash_give(p_op uuid, p_buyer uuid, p_amount text, p_on text, p_method text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_amount numeric;
  v_day date;
  v_method text := btrim(coalesce(p_method, ''));
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  v_amount := pur_pos_money(p_amount);
  v_day := pur_past_day(p_on);
  if v_method not in ('cash', 'gcash', 'bank_transfer', 'other') then
    raise exception 'BAD_METHOD' using errcode = 'P0001';
  end if;
  if not pur_holder_ok(v_owner, p_buyer) or not pur_can_buy(p_buyer, v_owner) then
    raise exception 'NOT_A_BUYER' using errcode = 'P0001';
  end if;
  insert into pur_cash_issues (owner_id, buyer_id, amount, issued_on, method, note, created_by)
  values (v_owner, p_buyer, v_amount, v_day, v_method, pur_note(p_note), auth.uid())
  returning id into v_id;
  perform pur_event(v_owner, 'cash_given', null, p_buyer, v_id, v_amount, jsonb_build_object('issued_on', v_day, 'method', v_method), null);
  return pur_op_done(v_owner, p_op, 'cash_give', jsonb_build_object('issue_id', v_id, 'held', pur_cash_raw(v_owner, p_buyer)));
end;
$$;

-- The buyer: "I did not receive this" (Q14). Flags only.
create or replace function pur_cash_dispute(p_op uuid, p_issue uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  v_note text := pur_reason(p_note);
  i pur_cash_issues;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into i from pur_cash_issues where id = p_issue and owner_id = v_owner and buyer_id = auth.uid() for update;
  if i.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if i.voided_at is not null then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  if i.disputed_at is not null and i.dispute_cleared_at is null then
    raise exception 'ALREADY_DISPUTED' using errcode = 'P0001';
  end if;
  update pur_cash_issues set disputed_at = now(), dispute_note = v_note,
                             dispute_cleared_at = null, dispute_cleared_by = null, dispute_cleared_note = null
   where id = p_issue;
  perform pur_event(v_owner, 'cash_disputed', null, i.buyer_id, p_issue, i.amount, null, v_note);
  return pur_op_done(v_owner, p_op, 'cash_dispute', jsonb_build_object('issue_id', p_issue));
end;
$$;

-- The main owner settles a flag: the cash was handed over (the flag is
-- cleared, with a note). If it was NOT handed over, void the entry instead.
create or replace function pur_cash_clear_dispute(p_op uuid, p_issue uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_note text := pur_reason(p_note);
  i pur_cash_issues;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into i from pur_cash_issues where id = p_issue and owner_id = v_owner for update;
  if i.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if i.disputed_at is null or i.dispute_cleared_at is not null or i.voided_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update pur_cash_issues set dispute_cleared_at = now(), dispute_cleared_by = auth.uid(), dispute_cleared_note = v_note
   where id = p_issue;
  perform pur_event(v_owner, 'dispute_cleared', null, i.buyer_id, p_issue, i.amount, null, v_note);
  return pur_op_done(v_owner, p_op, 'cash_clear_dispute', jsonb_build_object('issue_id', p_issue));
end;
$$;

create or replace function pur_cash_void_issue(p_op uuid, p_issue uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  i pur_cash_issues;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into i from pur_cash_issues where id = p_issue and owner_id = v_owner for update;
  if i.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if i.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pur_cash_issues set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_issue;
  perform pur_event(v_owner, 'cash_issue_voided', null, i.buyer_id, p_issue, i.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'cash_void_issue', jsonb_build_object('issue_id', p_issue, 'held', pur_cash_raw(v_owner, i.buyer_id)));
end;
$$;

-- The buyer reports handing unused cash back (Q17): "Return awaiting confirmation".
create or replace function pur_cash_report_return(p_op uuid, p_amount text, p_handed_on text, p_handed_to text,
                                                  p_photo_url text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  v_amount numeric;
  v_day date;
  v_photo text := btrim(coalesce(p_photo_url, ''));
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  if not pur_holder_ok(v_owner, auth.uid()) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  v_amount := pur_pos_money(p_amount);
  v_day := pur_past_day(p_handed_on);
  -- R13: a return photo is the buyer's own upload in the private pettyCash/ folder.
  if v_photo <> '' and (v_photo !~ '^https://' or not exists (
       select 1 from receipt_uploads u
        where u.path = (receipt_paths_of(array[v_photo]))[1] and u.kind = 'petty_cash'
          and u.uploaded_by = auth.uid() and u.owner_id = v_owner)) then
    raise exception 'BAD_DOCS' using errcode = 'P0001';
  end if;
  insert into pur_cash_returns (owner_id, buyer_id, amount, handed_on, handed_to, photo_url, note, created_by)
  values (v_owner, auth.uid(), v_amount, v_day, pur_note(p_handed_to, 120), v_photo, pur_note(p_note), auth.uid())
  returning id into v_id;
  perform pur_event(v_owner, 'return_reported', null, auth.uid(), v_id, v_amount, jsonb_build_object('handed_on', v_day), null);
  return pur_op_done(v_owner, p_op, 'cash_report_return', jsonb_build_object('return_id', v_id));
end;
$$;

-- The buyer takes back a report the main owner has not decided yet.
create or replace function pur_cash_withdraw_return(p_op uuid, p_return uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  v_prev jsonb;
  r pur_cash_returns;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into r from pur_cash_returns where id = p_return and owner_id = v_owner and buyer_id = auth.uid() for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'reported' then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  update pur_cash_returns set status = 'withdrawn' where id = p_return;
  perform pur_event(v_owner, 'return_withdrawn', null, r.buyer_id, p_return, r.amount, null, null);
  return pur_op_done(v_owner, p_op, 'cash_withdraw_return', jsonb_build_object('return_id', p_return));
end;
$$;

-- The main owner confirms the money arrived (the balance drops today, Q18)
-- or rejects the report with a reason.
create or replace function pur_cash_decide_return(p_op uuid, p_return uuid, p_confirm boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_note text;
  r pur_cash_returns;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  if p_confirm is null then raise exception 'BAD_DECISION' using errcode = 'P0001'; end if;
  v_note := case when p_confirm then pur_note(p_note) else pur_reason(p_note) end;
  select * into r from pur_cash_returns where id = p_return and owner_id = v_owner for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'reported' then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  update pur_cash_returns
     set status = case when p_confirm then 'confirmed' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid(), decision_note = v_note
   where id = p_return;
  perform pur_event(v_owner, case when p_confirm then 'return_confirmed' else 'return_rejected' end,
                    null, r.buyer_id, p_return, r.amount, jsonb_build_object('handed_on', r.handed_on), v_note);
  return pur_op_done(v_owner, p_op, 'cash_decide_return',
                     jsonb_build_object('return_id', p_return, 'held', pur_cash_raw(v_owner, r.buyer_id)));
end;
$$;

-- A confirmed return entered by mistake.
create or replace function pur_cash_void_return(p_op uuid, p_return uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  r pur_cash_returns;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into r from pur_cash_returns where id = p_return and owner_id = v_owner for update;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if r.status <> 'confirmed' or r.voided_at is not null then raise exception 'BAD_STATE' using errcode = 'P0001'; end if;
  update pur_cash_returns set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_return;
  perform pur_event(v_owner, 'return_voided', null, r.buyer_id, p_return, r.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'cash_void_return', jsonb_build_object('return_id', p_return, 'held', pur_cash_raw(v_owner, r.buyer_id)));
end;
$$;

-- A cash count (Q19): what the main owner counted, against the balance recorded that day.
create or replace function pur_cash_count(p_op uuid, p_buyer uuid, p_on text, p_counted text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_counted numeric := pur_money(p_counted);
  v_day date;
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  if v_counted is null or v_counted >= 10000000000 then raise exception 'BAD_AMOUNT' using errcode = 'P0001'; end if;
  v_day := pur_past_day(p_on);
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  insert into pur_cash_counts (owner_id, buyer_id, counted_on, counted, note, created_by)
  values (v_owner, p_buyer, v_day, v_counted, pur_note(p_note), auth.uid())
  returning id into v_id;
  perform pur_event(v_owner, 'cash_counted', null, p_buyer, v_id, v_counted,
                    jsonb_build_object('counted_on', v_day, 'recorded', pur_cash_raw(v_owner, p_buyer, v_day)), null);
  return pur_op_done(v_owner, p_op, 'cash_count', jsonb_build_object('count_id', v_id, 'counted', v_counted,
                                                                     'recorded', pur_cash_raw(v_owner, p_buyer, v_day)));
end;
$$;

create or replace function pur_cash_void_count(p_op uuid, p_count uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  k pur_cash_counts;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into k from pur_cash_counts where id = p_count and owner_id = v_owner for update;
  if k.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if k.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pur_cash_counts set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_count;
  perform pur_event(v_owner, 'count_voided', null, k.buyer_id, p_count, k.counted, null, v_reason);
  return pur_op_done(v_owner, p_op, 'cash_void_count', jsonb_build_object('count_id', p_count));
end;
$$;

-- ════ 7. The buyer's own money (Q21, Q22) ═════════════════════════════

create or replace function pur_set_own_money(p_buyer uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  if p_on is null then raise exception 'BAD_SWITCH' using errcode = 'P0001'; end if;
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  insert into pur_own_money (user_id, owner_id, allowed, updated_by, updated_at)
  values (p_buyer, v_owner, p_on, auth.uid(), now())
  on conflict (user_id) do update set allowed = excluded.allowed, owner_id = excluded.owner_id,
                                      updated_by = excluded.updated_by, updated_at = excluded.updated_at
   where pur_own_money.allowed is distinct from excluded.allowed or pur_own_money.owner_id <> excluded.owner_id;
  if found then
    perform pur_event(v_owner, case when p_on then 'own_money_on' else 'own_money_off' end, null, p_buyer, null, null, null, null);
  end if;
  return jsonb_build_object('user_id', p_buyer, 'own_money', p_on);
end;
$$;

create or replace function pur_repay_buyer(p_op uuid, p_buyer uuid, p_amount text, p_on text, p_method text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_amount numeric;
  v_day date;
  v_method text := btrim(coalesce(p_method, ''));
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  v_amount := pur_pos_money(p_amount);
  v_day := pur_past_day(p_on);
  if v_method not in ('cash', 'gcash', 'bank_transfer', 'check', 'other') then
    raise exception 'BAD_METHOD' using errcode = 'P0001';
  end if;
  perform pur_person_lock(p_buyer);
  if v_amount > pur_owes(v_owner, p_buyer) then raise exception 'OVER_OWED' using errcode = 'P0001'; end if;
  insert into pur_buyer_repayments (owner_id, buyer_id, amount, paid_on, method, note, created_by)
  values (v_owner, p_buyer, v_amount, v_day, v_method, pur_note(p_note), auth.uid())
  returning id into v_id;
  perform pur_event(v_owner, 'repaid', null, p_buyer, v_id, v_amount, jsonb_build_object('paid_on', v_day, 'method', v_method), null);
  return pur_op_done(v_owner, p_op, 'repay_buyer', jsonb_build_object('repayment_id', v_id, 'owes', pur_owes(v_owner, p_buyer)));
end;
$$;

create or replace function pur_void_repayment(p_op uuid, p_repayment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  v_reason text := pur_reason(p_reason);
  r pur_buyer_repayments;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then return v_prev; end if;
  select * into r from pur_buyer_repayments where id = p_repayment and owner_id = v_owner;
  if r.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pur_person_lock(r.buyer_id);
  select * into r from pur_buyer_repayments where id = p_repayment for update;
  if r.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pur_buyer_repayments set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_repayment;
  perform pur_event(v_owner, 'repayment_voided', null, r.buyer_id, p_repayment, r.amount, null, v_reason);
  return pur_op_done(v_owner, p_op, 'void_repayment', jsonb_build_object('repayment_id', p_repayment, 'owes', pur_owes(v_owner, r.buyer_id)));
end;
$$;

-- ════ 8. Reads ════════════════════════════════════════════════════════

-- 0101's list row, plus the payment state (Q2, Q12).
create or replace function pur_list_doc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', pu.id, 'status', pu.status, 'source', pu.source, 'purchase_date', pu.purchase_date,
           'supplier', pu.supplier, 'receipt_total', pu.receipt_total,
           'recorded_by_name', pur_person_name(pu.recorded_by),
           'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
           'projects', (select coalesce(jsonb_agg(distinct l.folder_name), '[]'::jsonb) from purchase_lines l
                         where l.purchase_id = pu.id and l.destination = 'project'),
           'warehouse', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.destination = 'warehouse'),
           'lines', (select count(*) from purchase_lines l where l.purchase_id = pu.id),
           'linked', (select count(*) from purchase_lines l where l.purchase_id = pu.id and l.request_line_id is not null),
           'unplanned', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unplanned_reason <> ''),
           'extra', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.extra_qty > 0),
           'unit_check', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unit_check = 'pending'),
           'needs_review', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.needs_funding_review),
           'pending_change', exists (select 1 from purchase_change_requests r where r.purchase_id = pu.id and r.status = 'pending'),
           'no_receipt_reason', pu.no_receipt_reason,
           'replaced_by', pu.replaced_by,
           'pay', pur_pay_state(pu.id))
    from purchases pu where pu.id = p_purchase
$$;

-- One payment, as the screens show it.
create or replace function pur_payment_json(p_payment uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'purchase_id', p.purchase_id, 'first_purchase_id', p.first_purchase_id,
    'moved', p.first_purchase_id <> p.purchase_id,
    'amount', p.amount, 'paid_on', p.paid_on, 'method', p.method,
    'source', p.source, 'person_id', p.person_id,
    'person_name', case when p.person_id is null then null else pur_person_name(p.person_id) end,
    'credit_id', p.credit_id, 'authorized', p.authorized, 'accepted_at', p.accepted_at,
    'rejected_at', p.rejected_at, 'reject_reason', p.reject_reason,
    'proof_url', p.proof_url, 'note', p.note, 'created_by', p.created_by,
    'created_by_name', pur_person_name(p.created_by), 'created_at', p.created_at,
    'voided_at', p.voided_at, 'void_reason', p.void_reason,
    'can_void', p.voided_at is null and (p.created_by = auth.uid() or pur_is_main_owner()))
  from pur_payments p where p.id = p_payment
$$;

-- A purchase's payments, refunds and credits, and what the caller may use (buyers).
create or replace function pur_purchase_payments(p_purchase uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
  pu purchases;
begin
  select * into pu from purchases where id = p_purchase and owner_id = v_owner;
  if pu.id is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'pay', pur_pay_state(p_purchase),
    'supplier_id', pu.supplier_id,
    'payments', (select coalesce(jsonb_agg(pur_payment_json(p.id) order by p.paid_on, p.created_at, p.id), '[]'::jsonb)
                   from pur_payments p where p.purchase_id = p_purchase),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', r.id, 'amount', r.amount, 'funded_by', r.funded_by, 'received_by', r.received_by,
                  'person_name', case when r.person_id is null then null else pur_person_name(r.person_id) end,
                  'received_on', r.received_on, 'note', r.note, 'voided_at', r.voided_at, 'void_reason', r.void_reason)
                  order by r.created_at), '[]'::jsonb) from pur_refunds r where r.purchase_id = p_purchase),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'amount', c.amount, 'left', pur_credit_left(c.id), 'supplier_id', c.supplier_id,
                  'supplier', (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end from suppliers s where s.id = c.supplier_id),
                  'note', c.note, 'voided_at', c.voided_at, 'void_reason', c.void_reason)
                  order by c.created_at), '[]'::jsonb) from pur_supplier_credits c where c.purchase_id = p_purchase),
    -- Credit with this purchase's supplier that a payment may use (Q11).
    'open_credits', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'left', pur_credit_left(c.id),
                       'from_purchase_id', c.purchase_id, 'created_at', c.created_at) order by c.created_at), '[]'::jsonb)
                       from pur_supplier_credits c
                      where c.owner_id = v_owner and pu.supplier_id is not null and c.supplier_id = pu.supplier_id
                        and c.voided_at is null and pur_credit_left(c.id) > 0),
    'me', jsonb_build_object('user_id', auth.uid(), 'main_owner', pur_is_main_owner(),
                             'holder', pur_holder_ok(v_owner, auth.uid()),
                             'own_money', pur_own_money_on(v_owner, auth.uid()),
                             'cash_held', case when pur_holder_ok(v_owner, auth.uid()) then pur_cash_raw(v_owner, auth.uid()) end));
end;
$$;

-- Supplier credits (Q12: buyers and the main owner see them).
create or replace function pur_credits(p_supplier uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_pay_owner();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', c.id, 'supplier_id', c.supplier_id,
            'supplier', (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end from suppliers s where s.id = c.supplier_id),
            'amount', c.amount, 'left', pur_credit_left(c.id), 'purchase_id', c.purchase_id,
            'purchase_date', (select pu.purchase_date from purchases pu where pu.id = c.purchase_id),
            'note', c.note, 'created_at', c.created_at, 'voided_at', c.voided_at)
          order by c.created_at desc), '[]'::jsonb)
            from pur_supplier_credits c
           where c.owner_id = v_owner and (p_supplier is null or c.supplier_id = p_supplier));
end;
$$;

-- A buyer's cash, as the main owner's tracker and the buyer's own screen show it.
create or replace function pur_cash_summary(p_owner uuid, p_buyer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'buyer_id', p_buyer, 'name', pur_person_name(p_buyer),
    'recorded', pur_cash_raw(p_owner, p_buyer),
    'held', greatest(0, pur_cash_raw(p_owner, p_buyer)),
    'shortfall', greatest(0, -pur_cash_raw(p_owner, p_buyer)),
    'pending_returns', (select coalesce(sum(amount), 0) from pur_cash_returns
                         where owner_id = p_owner and buyer_id = p_buyer and status = 'reported'),
    'open_disputes', (select count(*) from pur_cash_issues where owner_id = p_owner and buyer_id = p_buyer
                        and voided_at is null and disputed_at is not null and dispute_cleared_at is null),
    'last_given_on', (select max(issued_on) from pur_cash_issues where owner_id = p_owner and buyer_id = p_buyer and voided_at is null),
    'owes', pur_owes(p_owner, p_buyer),
    'owes_to_review', pur_owes_to_review(p_owner, p_buyer),
    'own_money', pur_own_money_on(p_owner, p_buyer),
    'can_buy', pur_can_buy(p_buyer, p_owner),
    'last_count', (select jsonb_build_object('id', k.id, 'counted_on', k.counted_on, 'counted', k.counted,
                                             'recorded', pur_cash_raw(p_owner, p_buyer, k.counted_on), 'note', k.note)
                     from pur_cash_counts k where k.owner_id = p_owner and k.buyer_id = p_buyer and k.voided_at is null
                    order by k.counted_on desc, k.created_at desc limit 1))
$$;

-- One buyer's cash with the last 90 days of entries (internal: the callers
-- below check who is asking). Counts are listed for the main owner's view.
create or replace function pur_cash_detail(p_owner uuid, p_buyer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select pur_cash_summary(p_owner, p_buyer) || jsonb_build_object(
    'holder', true,
    'issues', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'amount', i.amount, 'issued_on', i.issued_on,
                 'method', i.method, 'note', i.note, 'disputed_at', i.disputed_at, 'dispute_note', i.dispute_note,
                 'dispute_cleared_at', i.dispute_cleared_at, 'dispute_cleared_note', i.dispute_cleared_note,
                 'voided_at', i.voided_at, 'void_reason', i.void_reason) order by i.issued_on desc, i.created_at desc), '[]'::jsonb)
                 from pur_cash_issues i where i.owner_id = p_owner and i.buyer_id = p_buyer
                  and i.issued_on >= pur_manila_today() - 90),
    'returns', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'handed_on', r.handed_on,
                  'handed_to', r.handed_to, 'status', r.status, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
                  'voided_at', r.voided_at) order by r.created_at desc), '[]'::jsonb)
                  from pur_cash_returns r where r.owner_id = p_owner and r.buyer_id = p_buyer
                   and (r.status = 'reported' or r.handed_on >= pur_manila_today() - 90)),
    'repayments', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'paid_on', x.paid_on,
                     'method', x.method, 'voided_at', x.voided_at) order by x.paid_on desc, x.created_at desc), '[]'::jsonb)
                     from pur_buyer_repayments x where x.owner_id = p_owner and x.buyer_id = p_buyer
                      and x.paid_on >= pur_manila_today() - 90),
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'counted_on', k.counted_on, 'counted', k.counted,
                 'recorded', pur_cash_raw(p_owner, p_buyer, k.counted_on), 'note', k.note, 'voided_at', k.voided_at)
                 order by k.counted_on desc, k.created_at desc), '[]'::jsonb)
                 from pur_cash_counts k where k.owner_id = p_owner and k.buyer_id = p_buyer
                  and k.counted_on >= pur_manila_today() - 90))
$$;

-- The buyer's own cash (their phone / the Purchasing tab): balance, what is
-- waiting, what they are owed, and the last 90 days of entries.
create or replace function pur_my_cash() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_pay_owner();
begin
  if not pur_holder_ok(v_owner, auth.uid()) then
    return jsonb_build_object('holder', false);
  end if;
  return pur_cash_detail(v_owner, auth.uid());
end;
$$;

-- The same for one buyer, for the main owner's tracker (voids live there).
create or replace function pur_cash_buyer(p_buyer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
begin
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  return pur_cash_detail(v_owner, p_buyer);
end;
$$;

-- The main owner's tracker (Q15, Q16, Q19, Q24): every staff buyer, or
-- anyone with cash on record; the returns and flags waiting; Overpaid.
create or replace function pur_cash_tracker() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  return jsonb_build_object(
    'today', pur_manila_today(),
    'buyers', (select coalesce(jsonb_agg(pur_cash_summary(v_owner, p.id) order by pur_person_name(p.id)), '[]'::jsonb)
                 from profiles p
                where p.role = 'staff' and p.owner_id = v_owner
                  and (pur_can_buy(p.id, v_owner)
                       or exists (select 1 from pur_cash_issues i where i.buyer_id = p.id and i.owner_id = v_owner)
                       or exists (select 1 from pur_payments x where x.person_id = p.id and x.owner_id = v_owner)
                       or exists (select 1 from pur_buyer_repayments r where r.buyer_id = p.id and r.owner_id = v_owner))),
    'pending_returns', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'buyer_id', r.buyer_id,
                          'name', pur_person_name(r.buyer_id), 'amount', r.amount, 'handed_on', r.handed_on,
                          'handed_to', r.handed_to, 'photo_url', r.photo_url, 'note', r.note, 'reported_at', r.created_at)
                          order by r.created_at), '[]'::jsonb)
                          from pur_cash_returns r where r.owner_id = v_owner and r.status = 'reported'),
    'disputes', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'buyer_id', i.buyer_id,
                   'name', pur_person_name(i.buyer_id), 'amount', i.amount, 'issued_on', i.issued_on,
                   'dispute_note', i.dispute_note, 'disputed_at', i.disputed_at) order by i.disputed_at), '[]'::jsonb)
                   from pur_cash_issues i where i.owner_id = v_owner and i.voided_at is null
                    and i.disputed_at is not null and i.dispute_cleared_at is null),
    'to_review', (select coalesce(jsonb_agg(pur_payment_json(x.id) order by x.paid_on, x.created_at), '[]'::jsonb)
                    from pur_payments x where x.owner_id = v_owner and x.source = 'own_money' and x.voided_at is null
                     and not x.authorized and x.accepted_at is null and x.rejected_at is null));
end;
$$;

-- Overpaid purchases (Q8, Q9) with a suggested split of what is over:
-- the LATEST payments are taken as the ones paid too much (plan R5), each
-- part no more than its money can still give back.
create or replace function pur_overpaid() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_out jsonb := '[]'::jsonb;
  v_pu record;
  v_state jsonb;
  v_left numeric;
  v_pay record;
  v_take numeric;
  v_cap numeric;
  v_split jsonb;
  v_key text;
  v_person uuid;
begin
  for v_pu in select pu.id from purchases pu
               where pu.owner_id = v_owner and exists (select 1 from pur_payments x where x.purchase_id = pu.id)
               order by pu.purchase_date desc, pu.created_at desc loop
    v_state := pur_pay_state(v_pu.id);
    continue when (v_state ->> 'unresolved')::numeric = 0 and (v_state ->> 'over_resolved')::numeric = 0;
    v_left := (v_state ->> 'unresolved')::numeric;
    v_split := '{}'::jsonb;
    for v_pay in select x.* from pur_payments x where x.purchase_id = v_pu.id and x.voided_at is null
                  order by x.paid_on desc, x.created_at desc, x.id desc loop
      exit when v_left <= 0;
      -- One part per kind of money (company and credit money is not anyone's own).
      v_person := case when v_pay.source in ('petty_cash', 'own_money') then v_pay.person_id end;
      v_key := v_pay.source || ':' || coalesce(v_person::text, '');
      v_cap := pur_paid_from(v_pu.id, v_pay.source, v_person)
               - pur_refunded_from(v_pu.id, v_pay.source, v_person)
               - coalesce((v_split -> v_key ->> 'amount')::numeric, 0);
      v_take := least(v_left, v_pay.amount, greatest(0, v_cap));
      continue when v_take <= 0;
      v_split := jsonb_set(v_split, array[v_key], jsonb_build_object(
                   'source', v_pay.source, 'person_id', v_person,
                   'person_name', case when v_person is null then null else pur_person_name(v_person) end,
                   'amount', coalesce((v_split -> v_key ->> 'amount')::numeric, 0) + v_take));
      v_left := v_left - v_take;
    end loop;
    v_out := v_out || jsonb_build_array(pur_list_doc(v_pu.id) || jsonb_build_object(
               'supplier_id', (select supplier_id from purchases where id = v_pu.id),
               'paid_by', (select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'person_id', s.person_id,
                             'person_name', case when s.person_id is null then null else pur_person_name(s.person_id) end,
                             'paid', s.paid,
                             'refunded', pur_refunded_from(v_pu.id, s.source, s.person_id))), '[]'::jsonb)
                             from (select x.source, case when x.source in ('petty_cash', 'own_money') then x.person_id end as person_id,
                                          sum(x.amount) as paid
                                     from pur_payments x where x.purchase_id = v_pu.id and x.voided_at is null
                                    group by 1, 2) s),
               'suggested', (select coalesce(jsonb_agg(value), '[]'::jsonb) from jsonb_each(v_split))));
  end loop;
  return v_out;
end;
$$;

-- The daily report (Q18, Q20): one buyer, a range of Philippine days
-- (at most 92). Each day: opening, what came in, what went out, closing —
-- recorded figures; the screens show ₱0 and a shortfall below zero. An
-- entry stays on its own day even if voided later (marked voided_on); the
-- void shows as a reversal on the day it was made (R7), so a past day's
-- closing never changes. Days with nothing on them are skipped. Each day:
--   opening + received + refunds_in − payments − returns + Σ reversals.effect = closing
create or replace function pur_cash_report(p_buyer uuid, p_from text, p_to text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_from date := pur_past_day(p_from);
  v_to date;
  v_day date;
  v_open numeric;
  v_close numeric;
  v_days jsonb := '[]'::jsonb;
  v_in jsonb; v_refunds jsonb; v_pays jsonb; v_rets jsonb; v_rev jsonb;
begin
  begin
    v_to := btrim(p_to)::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if v_to < v_from or v_to - v_from > 92 then raise exception 'BAD_RANGE' using errcode = 'P0001'; end if;
  if not pur_holder_ok(v_owner, p_buyer) then raise exception 'NOT_A_BUYER' using errcode = 'P0001'; end if;
  v_open := pur_cash_raw(v_owner, p_buyer, v_from - 1);
  v_close := v_open;
  for v_day in select d::date from generate_series(v_from, v_to, interval '1 day') d loop
    v_in := (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'amount', i.amount, 'method', i.method, 'note', i.note,
               'disputed', i.disputed_at is not null and i.dispute_cleared_at is null,
               'voided_on', (i.voided_at at time zone 'Asia/Manila')::date) order by i.created_at), '[]'::jsonb)
               from pur_cash_issues i where i.owner_id = v_owner and i.buyer_id = p_buyer and i.issued_on = v_day);
    v_refunds := (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'purchase_id', r.purchase_id,
                    'supplier', (select pu.supplier from purchases pu where pu.id = r.purchase_id), 'funded_by', r.funded_by,
                    'voided_on', (r.voided_at at time zone 'Asia/Manila')::date) order by r.created_at), '[]'::jsonb)
                    from pur_refunds r where r.owner_id = v_owner and r.person_id = p_buyer and r.received_by = 'petty_cash'
                     and r.received_on = v_day);
    v_pays := (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'method', x.method,
                 'purchase_id', x.purchase_id, 'supplier', pu.supplier, 'purchase_status', pu.status,
                 'projects', (select coalesce(jsonb_agg(distinct l.folder_name), '[]'::jsonb) from purchase_lines l
                               where l.purchase_id = pu.id and l.destination = 'project'),
                 'warehouse', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.destination = 'warehouse'),
                 'items', (select coalesce(jsonb_agg(l.item_name order by l.line_no), '[]'::jsonb) from purchase_lines l where l.purchase_id = pu.id),
                 'docs', pu.docs, 'proof_url', x.proof_url, 'note', x.note,
                 'voided_on', (x.voided_at at time zone 'Asia/Manila')::date) order by x.created_at), '[]'::jsonb)
                 from pur_payments x join purchases pu on pu.id = x.purchase_id
                where x.owner_id = v_owner and x.person_id = p_buyer and x.source = 'petty_cash' and x.paid_on = v_day);
    v_rets := (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'handed_on', r.handed_on,
                 'handed_to', r.handed_to, 'confirmed_at', r.decided_at,
                 'voided_on', (r.voided_at at time zone 'Asia/Manila')::date) order by r.decided_at), '[]'::jsonb)
                 from pur_cash_returns r where r.owner_id = v_owner and r.buyer_id = p_buyer and r.status = 'confirmed'
                  and (r.decided_at at time zone 'Asia/Manila')::date = v_day);
    -- Voids made on this day: each undoes its entry from here on (effect: +in / −out).
    v_rev := (select coalesce(jsonb_agg(x.v order by x.at), '[]'::jsonb) from (
                select i.voided_at as at, jsonb_build_object('what', 'Petty cash given', 'entry_day', i.issued_on,
                         'amount', i.amount, 'effect', -i.amount, 'reason', i.void_reason) as v
                  from pur_cash_issues i where i.owner_id = v_owner and i.buyer_id = p_buyer
                   and (i.voided_at at time zone 'Asia/Manila')::date = v_day
                union all
                select r.voided_at, jsonb_build_object('what', 'Refund received', 'entry_day', r.received_on,
                         'amount', r.amount, 'effect', -r.amount, 'reason', r.void_reason)
                  from pur_refunds r where r.owner_id = v_owner and r.person_id = p_buyer and r.received_by = 'petty_cash'
                   and (r.voided_at at time zone 'Asia/Manila')::date = v_day
                union all
                select x.voided_at, jsonb_build_object('what', 'Paid to supplier', 'entry_day', x.paid_on,
                         'amount', x.amount, 'effect', x.amount, 'reason', x.void_reason)
                  from pur_payments x where x.owner_id = v_owner and x.person_id = p_buyer and x.source = 'petty_cash'
                   and (x.voided_at at time zone 'Asia/Manila')::date = v_day
                union all
                select r.voided_at, jsonb_build_object('what', 'Returned to the owner', 'entry_day', (r.decided_at at time zone 'Asia/Manila')::date,
                         'amount', r.amount, 'effect', r.amount, 'reason', r.void_reason)
                  from pur_cash_returns r where r.owner_id = v_owner and r.buyer_id = p_buyer and r.status = 'confirmed'
                   and (r.voided_at at time zone 'Asia/Manila')::date = v_day) x);
    continue when v_in = '[]'::jsonb and v_refunds = '[]'::jsonb and v_pays = '[]'::jsonb and v_rets = '[]'::jsonb
              and v_rev = '[]'::jsonb;
    v_open := pur_cash_raw(v_owner, p_buyer, v_day - 1);
    v_close := pur_cash_raw(v_owner, p_buyer, v_day);
    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'day', v_day, 'opening', v_open, 'received', v_in, 'refunds_in', v_refunds, 'payments', v_pays,
      'returns', v_rets, 'reversals', v_rev, 'closing', v_close));
  end loop;
  return jsonb_build_object(
    'buyer_id', p_buyer, 'name', pur_person_name(p_buyer), 'from', v_from, 'to', v_to,
    'opening', pur_cash_raw(v_owner, p_buyer, v_from - 1), 'closing', pur_cash_raw(v_owner, p_buyer, v_to),
    'days', v_days,
    'pending_returns', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'handed_on', r.handed_on))
                          , '[]'::jsonb) from pur_cash_returns r
                          where r.owner_id = v_owner and r.buyer_id = p_buyer and r.status = 'reported'),
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('counted_on', k.counted_on, 'counted', k.counted,
                 'recorded', pur_cash_raw(v_owner, p_buyer, k.counted_on), 'note', k.note) order by k.counted_on), '[]'::jsonb)
                 from pur_cash_counts k where k.owner_id = v_owner and k.buyer_id = p_buyer and k.voided_at is null
                  and k.counted_on between v_from and v_to));
end;
$$;

-- Project Control's Unpaid / Partially paid / Paid badge (owner/admin only,
-- Stage 2 Q8): purchase line and charge ids of recorded, tracked purchases.
create or replace function pur_payment_badges() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null or not coalesce(is_owner(), false) or not pr_is_office() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  v_owner := pur_actor_owner('expenses_form');
  return coalesce((
    select jsonb_object_agg(x.id, x.state)
      from (select l.id::text as id, pur_pay_state(pu.id) ->> 'state' as state
              from purchases pu join purchase_lines l on l.purchase_id = pu.id
             where pu.owner_id = v_owner and pu.status = 'recorded'
            union all
            select c.id::text, pur_pay_state(pu.id) ->> 'state'
              from purchases pu join purchase_charges c on c.purchase_id = pu.id
             where pu.owner_id = v_owner and pu.status = 'recorded') x
     where x.state in ('unpaid', 'partial', 'paid', 'overpaid')), '{}'::jsonb);
end;
$$;

-- ════ 9. Receipt photos of payments and returns mark their upload attached ══
create or replace function public.receipt_mark_attached() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_vals text[];
begin
  if tg_table_name = 'expenses' then
    v_vals := array[new.po_image_url, new.delivery_receipt_url, new.supplier_invoice_url, new.payment_receipt_url];
  elsif tg_table_name = 'purchases' then
    select coalesce(array_agg(x), '{}') into v_vals
      from jsonb_each_text(case when jsonb_typeof(new.docs) = 'object' then new.docs else '{}'::jsonb end) d(k, x);
  elsif tg_table_name = 'pur_payments' then
    v_vals := array[new.proof_url];
  elsif tg_table_name = 'pur_cash_returns' then
    v_vals := array[new.photo_url];
  else
    select coalesce(array_agg(x), '{}') into v_vals
      from jsonb_array_elements_text(case when jsonb_typeof(new.receipt_images) = 'array'
                                          then new.receipt_images else '[]'::jsonb end) x;
  end if;
  update receipt_uploads
     set state = 'attached', attached_at = now()
   where state = 'pending' and owner_id = new.owner_id and path = any (receipt_paths_of(v_vals));
  return null;
end $$;
revoke all on function public.receipt_mark_attached() from public, anon;
drop trigger if exists pur_payments_receipt_attach on public.pur_payments;
create trigger pur_payments_receipt_attach
  after insert on public.pur_payments for each row execute function public.receipt_mark_attached();
drop trigger if exists pur_cash_returns_receipt_attach on public.pur_cash_returns;
create trigger pur_cash_returns_receipt_attach
  after insert on public.pur_cash_returns for each row execute function public.receipt_mark_attached();

-- ════ 9b. Return photos: their own private folder (R13) ══════════════════
-- pettyCash/<company>/<yyyy-mm>/<id>.jpg. A buyer's cash is theirs alone
-- (Q24): a return photo is read only by the MAIN owner and by the buyer who
-- uploaded it (the upload ledger says who), never by other buyers. Payment
-- proofs stay in purchases/: buyers may see payments on purchases (Q24).
-- Checked before the uploader read-back and the generic owner/staff rule.

-- The upload ledger learns the kind; only buyers file it, in their company.
alter table public.receipt_uploads drop constraint if exists receipt_uploads_path_check;
alter table public.receipt_uploads add constraint receipt_uploads_path_check
  check (path ~ '^(expenseReceipts|payrollReceipts|purchases|pettyCash)/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$');
alter table public.receipt_uploads drop constraint if exists receipt_uploads_kind_check;
alter table public.receipt_uploads add constraint receipt_uploads_kind_check check (kind in ('expense', 'payroll', 'purchase', 'petty_cash'));
drop policy if exists receipt_uploads_insert on public.receipt_uploads;
create policy receipt_uploads_insert on public.receipt_uploads
  for insert to authenticated
  with check ((is_owner() or is_staff())
              and owner_id = data_owner_id()
              and uploaded_by = auth.uid()
              and state = 'pending'
              and split_part(path, '/', 2) = owner_id::text
              and (kind not in ('purchase', 'petty_cash') or pur_buyer())
              and split_part(path, '/', 1) = case kind when 'expense' then 'expenseReceipts'
                                                       when 'payroll' then 'payrollReceipts'
                                                       when 'petty_cash' then 'pettyCash'
                                                       else 'purchases' end);

-- May the caller read this pettyCash/ file? The main owner of that company,
-- or the account that uploaded it. SECURITY DEFINER: the ledger's own read
-- policy must not decide this.
create or replace function public.pur_petty_reader(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and split_part(p_name, '/', 2) = data_owner_id()::text
     and (pur_is_main_owner()
          or exists (select 1 from receipt_uploads u where u.path = p_name and u.uploaded_by = auth.uid()))
$$;

-- 0097's rules, plus the pettyCash folder.
create or replace function public.uploads_can_read(p_name text, p_owner_id text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_pid    uuid := dacs_try_uuid(split_part(p_name, '/', 2));
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only (not even the uploader once the switch is off).
  if v_folder = 'purchases' then
    return pur_buyer() and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- 0102: petty cash return photos — the main owner and the uploading buyer only.
  if v_folder = 'pettyCash' then
    return pur_petty_reader(p_name);
  end if;

  -- The uploader can always read back their own file.
  if p_owner_id is not null and p_owner_id = v_uid::text then return true; end if;

  -- Owner-only modules (quotations 0045, reimbursements 0041).
  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- Owner and staff: everything else (staff encode receipts from here).
  if is_owner() or is_staff() then return true; end if;

  -- Construction client / partner: files filed under THEIR project. Same
  -- test as the weekly_bills _client_read / _partner_read policies.
  if v_folder in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms') then
    return v_pid is not null
       and (cproj_client_can_read(v_pid) or cproj_partner_can_read(v_pid));
  end if;

  -- Employee agreement PDF: every non-owner admin role (staff, worker,
  -- teamLeader) signs it at first login in admin.html (js/admin.js).
  if v_folder = 'employeeTermsGlobal' then return coalesce(is_worker(), false); end if;

  -- Agreement templates shown at the client/partner signing gates.
  -- coalesce: a profile with a NULL role must not be denied (NOT NULL = NULL).
  if v_folder = 'agreementDocs' then return not coalesce(is_worker(), false); end if;

  return false;
end $$;

create or replace function public.uploads_can_write(p_name text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_seg2   text := split_part(p_name, '/', 2);
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only.
  if v_folder = 'purchases' then
    return pur_buyer() and v_seg2 = data_owner_id()::text;
  end if;

  -- 0102: petty cash return photos — buyers of THAT company (read back through the ledger).
  if v_folder = 'pettyCash' then
    return pur_buyer() and v_seg2 = data_owner_id()::text;
  end if;

  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  if is_owner() or is_staff() then return true; end if;
  -- Signatures. Clients/partners (js/client-management-app.js):
  --   signatures/<uid>_<ts>.png  and  signatures/proj_<project>_<uid>_<ts>.png
  -- Workers/team leaders (employee agreement gate, js/admin.js):
  --   signatures/employee_<uid>_<ts>.png  only
  if v_folder = 'signatures' then
    if coalesce(is_worker(), false) then
      return p_name ~ ('^signatures/employee_' || v_uid::text || '_[0-9]+\.png$');
    end if;
    return p_name ~ ('^signatures/(proj_[0-9a-f-]{36}_)?' || v_uid::text || '_[0-9]+\.png$');
  end if;
  --   signed-terms/<uid>/<ts>_<name>.pdf   (dacsSnapshotPdf, every signing gate)
  if v_folder = 'signed-terms'  then return v_seg2 = v_uid::text; end if;

  -- Workers and team leaders upload nothing else.
  if coalesce(is_worker(), false) then return false; end if;
  --   procurementReceipts/<project>/…  (client "bought by client" receipt; clients only,
  --   partners are read-only, same as the procurement_client_update table policy)
  if v_folder = 'procurementReceipts' then
    return dacs_try_uuid(v_seg2) is not null and cproj_client_can_read(dacs_try_uuid(v_seg2));
  end if;

  return false;
end $$;

revoke all on function public.uploads_can_read(text, text) from public;
revoke all on function public.uploads_can_write(text) from public;
revoke all on function public.uploads_can_read(text, text) from anon;
revoke all on function public.uploads_can_write(text) from anon;
grant execute on function public.uploads_can_read(text, text) to authenticated;
grant execute on function public.uploads_can_write(text) to authenticated;

-- 0097's overwrite policy; a return photo is never overwritten.
drop policy if exists "uploads_admin_update" on storage.objects;
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) = 'pettyCash' then false
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) = 'pettyCash' then false
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end);

-- ════ 10. Privileges ═══════════════════════════════════════════════════

alter table pur_payments enable row level security;
alter table pur_supplier_credits enable row level security;
alter table pur_refunds enable row level security;
alter table pur_cash_issues enable row level security;
alter table pur_cash_returns enable row level security;
alter table pur_cash_counts enable row level security;
alter table pur_own_money enable row level security;
alter table pur_buyer_repayments enable row level security;
alter table pur_money_events enable row level security;
revoke all on table pur_payments, pur_supplier_credits, pur_refunds, pur_cash_issues, pur_cash_returns,
                    pur_cash_counts, pur_own_money, pur_buyer_repayments, pur_money_events
  from public, anon, authenticated;
revoke all on sequence pur_money_events_seq_seq from public, anon, authenticated;

-- Internal helpers: only the SECURITY DEFINER operations call them.
revoke all on function pur_money_events_immutable(), pur_manila_today(), pur_pos_money(text), pur_past_day(text),
                       pur_note(text, int), pur_reason(text), pur_pay_owner(), pur_is_main_owner(), pur_main_owner(),
                       pur_holder_ok(uuid, uuid), pur_own_money_on(uuid, uuid),
                       pur_event(uuid, text, uuid, uuid, uuid, numeric, jsonb, text), pur_op_done(uuid, uuid, text, jsonb),
                       pur_person_lock(uuid), pur_credit_left(uuid), pur_paid_from(uuid, text, uuid),
                       pur_refunded_from(uuid, text, uuid), pur_resolved(uuid), pur_pay_state(uuid),
                       pur_cash_raw(uuid, uuid, date), pur_owes(uuid, uuid), pur_owes_to_review(uuid, uuid),
                       pur_pay_insert(uuid, uuid, jsonb), pur_pay_follow_replace(), pur_payment_json(uuid),
                       pur_cash_summary(uuid, uuid), pur_cash_detail(uuid, uuid), pur_stood(timestamptz, date)
  from public, anon, authenticated;
-- The storage rules run as the signed-in reader: like pur_buyer(), callable, answering only about the caller.
revoke all on function public.pur_petty_reader(text) from public, anon;
grant execute on function public.pur_petty_reader(text) to authenticated;
-- Restated: create or replace keeps a function's permissions, so they can never drift.
revoke all on function pur_header_ok(jsonb) from public, anon, authenticated;
revoke all on function pur_list_doc(uuid) from public, anon, authenticated;

-- Called by Dacs Web and WorkMate (each checks its caller itself).
revoke all on function pur_record(uuid, jsonb), pur_pay(uuid, uuid, jsonb), pur_void_payment(uuid, uuid, text),
                       pur_accept_own_money(uuid, uuid), pur_reject_own_money(uuid, uuid, text), pur_resolve_overpaid(uuid, uuid, jsonb, jsonb),
                       pur_void_refund(uuid, uuid, text), pur_void_credit(uuid, uuid, text),
                       pur_cash_give(uuid, uuid, text, text, text, text), pur_cash_dispute(uuid, uuid, text),
                       pur_cash_clear_dispute(uuid, uuid, text), pur_cash_void_issue(uuid, uuid, text),
                       pur_cash_report_return(uuid, text, text, text, text, text), pur_cash_withdraw_return(uuid, uuid),
                       pur_cash_decide_return(uuid, uuid, boolean, text), pur_cash_void_return(uuid, uuid, text),
                       pur_cash_count(uuid, uuid, text, text, text), pur_cash_void_count(uuid, uuid, text),
                       pur_set_own_money(uuid, boolean), pur_repay_buyer(uuid, uuid, text, text, text, text),
                       pur_void_repayment(uuid, uuid, text), pur_purchase_payments(uuid), pur_credits(uuid),
                       pur_my_cash(), pur_cash_buyer(uuid), pur_cash_tracker(), pur_overpaid(), pur_cash_report(uuid, text, text),
                       pur_payment_badges()
  from public, anon;
grant execute on function pur_record(uuid, jsonb), pur_pay(uuid, uuid, jsonb), pur_void_payment(uuid, uuid, text),
                          pur_accept_own_money(uuid, uuid), pur_reject_own_money(uuid, uuid, text), pur_resolve_overpaid(uuid, uuid, jsonb, jsonb),
                          pur_void_refund(uuid, uuid, text), pur_void_credit(uuid, uuid, text),
                          pur_cash_give(uuid, uuid, text, text, text, text), pur_cash_dispute(uuid, uuid, text),
                          pur_cash_clear_dispute(uuid, uuid, text), pur_cash_void_issue(uuid, uuid, text),
                          pur_cash_report_return(uuid, text, text, text, text, text), pur_cash_withdraw_return(uuid, uuid),
                          pur_cash_decide_return(uuid, uuid, boolean, text), pur_cash_void_return(uuid, uuid, text),
                          pur_cash_count(uuid, uuid, text, text, text), pur_cash_void_count(uuid, uuid, text),
                          pur_set_own_money(uuid, boolean), pur_repay_buyer(uuid, uuid, text, text, text, text),
                          pur_void_repayment(uuid, uuid, text), pur_purchase_payments(uuid), pur_credits(uuid),
                          pur_my_cash(), pur_cash_buyer(uuid), pur_cash_tracker(), pur_overpaid(), pur_cash_report(uuid, text, text),
                          pur_payment_badges()
  to authenticated;
