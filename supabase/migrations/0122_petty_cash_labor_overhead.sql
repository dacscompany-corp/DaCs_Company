-- ════════════════════════════════════════════════════════════════════
-- 0122_petty_cash_labor_overhead.sql — PETTY CASH FOR LABOR AND OVERHEAD
--
-- A payroll row or an overhead expense may now say it was paid from a staff
-- buyer's petty cash (petty_cash_by). Triggers keep exactly one live
-- pur_cash_spends row per such entry: written in the same step as the entry,
-- voided — never deleted, never changed in place — when the entry is deleted
-- or its person, day or amount changes, and written again when it is still
-- paid from petty cash. pur_cash_raw subtracts live spends the way it
-- subtracts petty-cash purchase payments, so the balance, cash counts, the
-- daily report and Reconciliation's petty cash total all include them.
--
-- Outside the money model: the entry counts once in Labor / Overhead and
-- Spent exactly as before. Petty cash only says how it was paid.
--
-- Who may choose it (checked here, mirrored by the forms): the staff buyer
-- whose petty cash it is, or the main owner (pur_is_main_owner()) for anyone.
-- Taking it off a row is checked the same way (the service role may too).
-- Both run whenever the column changes, a soft-deleted overhead row included.
-- Correcting the amount or day of an entry already paid from petty cash keeps
-- its person and needs no such check: anyone allowed to edit the row may fix
-- a typo.
--
-- Spec: docs/superpowers/specs/2026-11-25-petty-cash-labor-overhead-design.md
-- Needs 0102 (and 0103's pur_cash_detail). Does not depend on 0121.
-- APPLY BEFORE pushing the web code that sends pettyCashBy.
-- ════════════════════════════════════════════════════════════════════

-- ════ 1. Whose petty cash paid ═════════════════════════════════════════

alter table payroll add column if not exists petty_cash_by uuid references profiles(id);
alter table overhead_expenses add column if not exists petty_cash_by uuid references profiles(id);
comment on column payroll.petty_cash_by is
  'Staff buyer whose petty cash paid this row (0122); null = not paid from petty cash. Kept in pur_cash_spends by triggers.';
comment on column overhead_expenses.petty_cash_by is
  'Staff buyer whose petty cash paid this expense (0122); null = not paid from petty cash. Kept in pur_cash_spends by triggers.';

-- ════ 2. The spends ═══════════════════════════════════════════════════

-- payroll_id / overhead_id carry no foreign key on purpose: the record
-- outlives a deleted entry. label and place are snapshots for the report.
create table if not exists pur_cash_spends (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  buyer_id uuid not null references profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  spent_on date not null,
  kind text not null check (kind in ('payroll', 'overhead')),
  payroll_id uuid,
  overhead_id uuid,
  split_group text,
  label text not null default '',
  place text not null default '',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text,
  constraint pur_cash_spends_entry_chk check (
    (kind = 'payroll' and payroll_id is not null and overhead_id is null)
    or (kind = 'overhead' and overhead_id is not null and payroll_id is null)),
  constraint pur_cash_spends_void_chk check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and char_length(btrim(void_reason)) between 1 and 500))
);
create unique index if not exists pur_cash_spends_payroll_live
  on pur_cash_spends (payroll_id) where voided_at is null and payroll_id is not null;
create unique index if not exists pur_cash_spends_overhead_live
  on pur_cash_spends (overhead_id) where voided_at is null and overhead_id is not null;
create index if not exists pur_cash_spends_buyer_day on pur_cash_spends (owner_id, buyer_id, spent_on);

-- History: never deleted; the only change is one void.
create or replace function pur_cash_spends_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
  end if;
  if old.voided_at is not null or new.voided_at is null
     or (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason')
        is distinct from (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
    raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists pur_cash_spends_guard_trg on pur_cash_spends;
create trigger pur_cash_spends_guard_trg
  before update or delete on pur_cash_spends for each row execute function pur_cash_spends_guard();

-- ════ 3. Keeping them ═════════════════════════════════════════════════

-- The petty cash day: the first 10 characters of the entry's date (payroll's
-- payment_date is a date-and-time box), a real day, not in the future.
create or replace function pur_spend_day(p text) returns date
language plpgsql stable set search_path = public as $$
begin
  return pur_past_day(left(btrim(coalesce(p, '')), 10));
exception when others then
  raise exception 'PETTY_CASH_DATE' using errcode = 'P0001';
end;
$$;

-- What an entry's spend is made of — whose petty cash, the day, the amount —
-- or null when it has none (not petty cash, or a soft-deleted overhead).
-- '2026-11-20' and '2026-11-20T00:00' are the same day: an edit form that
-- re-sends the date in another shape changes nothing.
create or replace function pur_spend_key(p_table text, r jsonb) returns jsonb
language sql immutable as $$
  select case
    when r is null or nullif(r ->> 'petty_cash_by', '') is null then null
    when p_table = 'overhead_expenses' and r ->> 'deleted_at' is not null then null
    else jsonb_build_object(
      'by', r ->> 'petty_cash_by',
      'day', left(btrim(coalesce(r ->> (case when p_table = 'payroll' then 'payment_date' else 'date' end), '')), 10),
      'amount', round(coalesce(nullif(btrim(r ->> (case when p_table = 'payroll' then 'total_salary' else 'amount' end)), '')::numeric, 0), 2))
  end
$$;

-- Before the row is saved: who may set or clear whose petty cash, and a day and
-- an amount it can carry. The person checks run whenever the column itself
-- changes — on a soft-deleted overhead row too — so no path (delete, change,
-- restore) can put another person's petty cash on a row or take it off one.
create or replace function pur_spend_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k jsonb := pur_spend_key(tg_table_name, to_jsonb(new));
  o jsonb := case when tg_op = 'UPDATE' then pur_spend_key(tg_table_name, to_jsonb(old)) end;
  v_old_by uuid := case when tg_op = 'UPDATE' then nullif(to_jsonb(old) ->> 'petty_cash_by', '')::uuid end;
  v_by_changed boolean := tg_op = 'INSERT' or new.petty_cash_by is distinct from v_old_by;
begin
  -- Taking it off (or moving it from) someone: that person or the main owner.
  -- No signed-in user (the service role) may, as profiles_guard allows.
  if v_by_changed and v_old_by is not null and auth.uid() is not null
     and not (auth.uid() = v_old_by or pur_is_main_owner()) then
    raise exception 'PERSON_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  -- Putting it on someone: a staff account of this company, and the caller is
  -- that person or the main owner.
  if v_by_changed and new.petty_cash_by is not null then
    if not pur_holder_ok(new.owner_id, new.petty_cash_by) then
      raise exception 'NOT_A_BUYER' using errcode = 'P0001';
    end if;
    if not (auth.uid() is not distinct from new.petty_cash_by or pur_is_main_owner()) then
      raise exception 'PERSON_NOT_ALLOWED' using errcode = 'P0001';
    end if;
  end if;
  if k is null then return new; end if;
  if v_by_changed or o is null or (o ->> 'day') is distinct from (k ->> 'day')
     or (o -> 'amount') is distinct from (k -> 'amount') then
    perform pur_spend_day(k ->> 'day');
    if (k ->> 'amount')::numeric <= 0 then
      raise exception 'BAD_AMOUNT' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- After the row is saved or deleted: void the entry's live spend when what it
-- is made of changed, then write the new one when it is still petty cash.
create or replace function pur_spend_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := case when tg_table_name = 'payroll' then 'payroll' else 'overhead' end;
  r_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  r_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  o jsonb;
  k jsonb;
  v_id uuid;
  v_reason text;
  v_label text;
  v_place text;
begin
  o := pur_spend_key(tg_table_name, r_old);
  k := pur_spend_key(tg_table_name, r_new);
  if o is not distinct from k then return null; end if;
  v_id := coalesce(r_new ->> 'id', r_old ->> 'id')::uuid;
  v_reason := case when v_kind = 'payroll' then 'Payroll entry' else 'Overhead entry' end
           || case when tg_op = 'DELETE'
                     or (v_kind = 'overhead' and r_new ->> 'deleted_at' is not null and r_old ->> 'deleted_at' is null)
                   then ' deleted' else ' changed' end;
  update pur_cash_spends set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   where voided_at is null
     and ((v_kind = 'payroll' and payroll_id = v_id) or (v_kind = 'overhead' and overhead_id = v_id));
  if k is null then return null; end if;
  if v_kind = 'payroll' then
    v_label := btrim(coalesce(r_new ->> 'worker_name', '')) || coalesce(' · ' || nullif(btrim(r_new ->> 'role'), ''), '');
    select f.name into v_place from projects p join folders f on f.id = p.folder_id
     where p.id = nullif(r_new ->> 'project_id', '')::uuid;
  else
    v_label := coalesce(nullif(btrim(r_new ->> 'expense_name'), ''), nullif(btrim(r_new ->> 'description'), ''),
                        nullif(btrim(r_new ->> 'category'), ''), '');
    if nullif(r_new ->> 'folder_id', '') is null then
      v_place := 'Company overhead';
    else
      select f.name into v_place from folders f where f.id = (r_new ->> 'folder_id')::uuid;
    end if;
  end if;
  insert into pur_cash_spends (owner_id, buyer_id, amount, spent_on, kind, payroll_id, overhead_id,
                               split_group, label, place, created_by)
  values ((r_new ->> 'owner_id')::uuid, (k ->> 'by')::uuid, (k ->> 'amount')::numeric, pur_spend_day(k ->> 'day'), v_kind,
          case when v_kind = 'payroll' then v_id end, case when v_kind = 'overhead' then v_id end,
          case when v_kind = 'payroll' then nullif(btrim(r_new ->> 'split_group'), '') end,
          left(coalesce(v_label, ''), 300), left(coalesce(v_place, ''), 300), auth.uid());
  return null;
end;
$$;

drop trigger if exists payroll_petty_check on payroll;
create trigger payroll_petty_check
  before insert or update on payroll for each row execute function pur_spend_check();
drop trigger if exists payroll_petty_sync on payroll;
create trigger payroll_petty_sync
  after insert or update or delete on payroll for each row execute function pur_spend_sync();
drop trigger if exists overhead_petty_check on overhead_expenses;
create trigger overhead_petty_check
  before insert or update on overhead_expenses for each row execute function pur_spend_check();
drop trigger if exists overhead_petty_sync on overhead_expenses;
create trigger overhead_petty_sync
  after insert or update or delete on overhead_expenses for each row execute function pur_spend_sync();

-- ════ 4. The balance and the screens that read it ═════════════════════

-- 0102's pur_cash_raw, plus: less the live spends on labor and overhead,
-- counted like petty-cash purchase payments (voids from the day they are made).
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
       - coalesce((select sum(amount) from pur_cash_spends
                    where owner_id = p_owner and buyer_id = p_buyer and pur_stood(voided_at, p_upto)
                      and (p_upto is null or spent_on <= p_upto)), 0)
$$;

-- 0103's pur_cash_detail, plus the spends (the buyer card and My cash).
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
                  'photo_url', r.photo_url, 'voided_at', r.voided_at) order by r.created_at desc), '[]'::jsonb)
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
                  and k.counted_on >= pur_manila_today() - 90),
    -- 0122: petty cash spent on labor and overhead (90 days), voids included.
    'spends', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'amount', s.amount,
                 'spent_on', s.spent_on, 'label', s.label, 'place', s.place, 'split_group', s.split_group,
                 'voided_at', s.voided_at, 'void_reason', s.void_reason)
                 order by s.spent_on desc, s.created_at desc), '[]'::jsonb)
                 from pur_cash_spends s where s.owner_id = p_owner and s.buyer_id = p_buyer
                  and s.spent_on >= pur_manila_today() - 90))
$$;

-- 0102's pur_cash_report, plus each day's spends and their voids
-- ("Paid labor" / "Paid overhead"); print and CSV follow.
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
  v_in jsonb; v_refunds jsonb; v_pays jsonb; v_rets jsonb; v_rev jsonb; v_spends jsonb;
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
    -- 0122: petty cash spent on labor and overhead this day.
    v_spends := (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'amount', s.amount,
                   'label', s.label, 'place', s.place, 'split_group', s.split_group,
                   'voided_on', (s.voided_at at time zone 'Asia/Manila')::date) order by s.created_at, s.id), '[]'::jsonb)
                   from pur_cash_spends s where s.owner_id = v_owner and s.buyer_id = p_buyer and s.spent_on = v_day);
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
                   and (r.voided_at at time zone 'Asia/Manila')::date = v_day
                union all
                select s.voided_at, jsonb_build_object('what', case s.kind when 'payroll' then 'Paid labor' else 'Paid overhead' end,
                         'entry_day', s.spent_on, 'amount', s.amount, 'effect', s.amount, 'reason', s.void_reason)
                  from pur_cash_spends s where s.owner_id = v_owner and s.buyer_id = p_buyer
                   and (s.voided_at at time zone 'Asia/Manila')::date = v_day) x);
    continue when v_in = '[]'::jsonb and v_refunds = '[]'::jsonb and v_pays = '[]'::jsonb and v_rets = '[]'::jsonb
              and v_rev = '[]'::jsonb and v_spends = '[]'::jsonb;
    v_open := pur_cash_raw(v_owner, p_buyer, v_day - 1);
    v_close := pur_cash_raw(v_owner, p_buyer, v_day);
    v_days := v_days || jsonb_build_array(jsonb_build_object(
      'day', v_day, 'opening', v_open, 'received', v_in, 'refunds_in', v_refunds, 'payments', v_pays, 'spends', v_spends,
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

-- ════ 5. Privileges ═══════════════════════════════════════════════════

alter table pur_cash_spends enable row level security;
revoke all on table pur_cash_spends from public, anon, authenticated;

-- Internal: only the triggers and the SECURITY DEFINER reads use them.
-- Restated for the redefined helpers (create or replace keeps permissions,
-- so they can never drift).
revoke all on function pur_cash_spends_guard(), pur_spend_day(text), pur_spend_key(text, jsonb),
                       pur_spend_check(), pur_spend_sync(),
                       pur_cash_raw(uuid, uuid, date), pur_cash_detail(uuid, uuid)
  from public, anon, authenticated;
