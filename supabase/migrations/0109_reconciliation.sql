-- 0109 — WorkMate Stage 4: reconciliation and reports (the owner's checks).
--
-- Answers: docs/superpowers/specs/2026-10-30-workmate-stage4-reconciliation-questions.md
-- (Q1–Q7 and Q9–Q15 = A; Q8 = the approach only; Q6 = the feature only);
-- plan: docs/superpowers/plans/2026-10-30-workmate-stage4-reconciliation.md.
-- Builds on 0096–0108. Nothing here moves a peso.
--
-- ── 1. It reads and points (Q1). Every function below either READS the
--    records the money model already keeps, or records an owner's decision
--    that moves no money. Nothing writes an expense row, a payment, a
--    billing period or a client bill; nothing feeds Spent, Earned or Profit.
--
-- ── 2. Who (Q3). Owner accounts allowed the Expenses section (rec_owner).
--    The cash figures inside — petty cash held, what the company owes a
--    buyer, own money to review, returns, disputes, Overpaid — stay the MAIN
--    owner's, as in 2A-4: for any other owner account the server leaves
--    those keys out. Staff never call any of it.
--
-- ── 3. Where every purchase peso is (Q4) — rec_purchase_places. For each
--    recorded purchase: its receipt total, and where those pesos sit today:
--      own     its own expense rows (lines, delivery fees, discounts) plus
--              the cost-move rows on the project that bought the lot;
--      other   cost-move rows on any other project (goods moved or issued
--              from company stock and approved);
--      company what the company still holds: a lot's company share
--              (stk_held), or a warehouse line not yet in stock at its value;
--      loss    company stock loss (approved, unreversed).
--    own + other + company + loss must equal the receipt total. The two
--    sides are counted from DIFFERENT records (expense rows vs. cost moves
--    and lots), so a difference is a bug to report, never a business event.
--    Voided purchases are listed apart and count nowhere; a purchase replaced
--    by its correction is the correction.
--
-- ── 4. "Cover is right" (Q6) — rec_accept_cover / rec_withdraw_cover. A line
--    the server charged to Cover because its month had no billing period
--    (needs_funding_review, 0096) keeps its "Office review" mark until the
--    office adds the period and saves the row again (re-funded, as today) —
--    or until an owner account marks it "Cover is right" with a reason. That
--    mark only clears the flag: the rows stay where they are (Cover, Spent).
--    Who, when, why and the line as it stood are kept (rec_cover_marks). A
--    later correction re-checks the line as always (pur_charge_rows sets the
--    flag again if there is still no period): the old mark no longer matches
--    the line and it waits again. A mark is withdrawn only while the line is
--    exactly as marked; withdrawing puts the flag back.
--
-- ── 5. Bills to check (Q10) — rec_cost_row_log, rec_bills, rec_bill_check.
--    An approved cost move writes expense rows; a reversal DELETES them
--    (0105). So the months a move changed are logged as they happen (a
--    trigger on expenses, cost-move rows only). One item per cost move,
--    transaction and direction: an approval (rows added) or a reversal (rows
--    removed) — two items even if both happen in one transaction. An owner
--    account ticks "Bill checked" (or un-ticks) per item, with a note; the
--    latest tick counts. Client bills are never touched (Q25).
--
-- ── 6. Money still out (Q9) — rec_money_out. Unpaid and Partly paid
--    balances by supplier ("No supplier recorded" when none), purchases whose
--    payment is not tracked (never counted as owed), Overpaid, supplier
--    credit left; for the main owner also petty cash held, what the company
--    owes buyers and own money to review. Payments never change Spent (2A-4).
--
-- ── 7. Waiting (Q5) — rec_waiting. Counts only, with no amounts; the
--    decisions stay where they are (Owner approvals, Cash, Stock, Tools).
--
-- ── 8. Add Expense's saves, settled even if the browser loses one (review,
--    R120) — pur_op_reservations, pur_op_reserve, pur_op_recover. Project
--    Control's Add Expense (which records a purchase AND its "Paid now?"
--    payment in one pur_record) registers each save's operation id BEFORE it
--    sends it, and keeps the id in the browser until the server answers. If
--    what the browser kept is damaged and the id cannot be read, nothing new
--    may be sent until pur_op_recover settles EVERY registered save of that
--    account the server has no answer for: each is cancelled for good — its
--    first request arriving later is refused (OP_CANCELLED, 0106) — unless it
--    was recorded first; pur_op_cancel decides under the lock recording takes,
--    so never both. An absent row in a list proves nothing; this does. Moves
--    no money; pur_ops stays the record of what happened.

-- ════ 1. Who may read and decide ═════════════════════════════════════

-- Owner accounts allowed the Expenses section, in their own company.
create or replace function rec_owner() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(is_owner(), false) or not pr_is_office() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  return pur_actor_owner('expenses_form');
end;
$$;

-- ════ 2. "Cover is right" (Q6) ═══════════════════════════════════════

-- One owner decision about one purchase line, as the line stood. Lines are
-- re-created on every correction (new ids), so a mark names the purchase and
-- the line number, and keeps a fingerprint of the line (rec_line_key). Only
-- a line's newest mark (seq) can apply: marking the same line again after a
-- correction supersedes the older mark, even if the line reads the same.
create table if not exists rec_cover_marks (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  line_no int not null,
  item_name text not null default '',
  folder_name text not null default '',
  amount numeric(14,2) not null,
  purchase_date date not null,
  line_key text not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  marked_by uuid not null references profiles(id),
  marked_at timestamptz not null default now(),
  withdrawn_by uuid references profiles(id),
  withdrawn_at timestamptz,
  withdraw_reason text not null default '' check (char_length(withdraw_reason) <= 500),
  check ((withdrawn_at is null) = (withdrawn_by is null)),
  check (withdrawn_at is null or char_length(btrim(withdraw_reason)) between 1 and 500)
);
create index if not exists rec_cover_marks_line on rec_cover_marks (purchase_id, line_no, seq desc);
create index if not exists rec_cover_marks_owner on rec_cover_marks (owner_id, marked_at desc);
alter table rec_cover_marks enable row level security;

-- Never deleted; changed only once, to record its withdrawal.
create or replace function rec_cover_marks_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.withdrawn_at is not null or new.withdrawn_at is null
     or (new.id, new.seq, new.owner_id, new.purchase_id, new.line_no, new.item_name, new.folder_name, new.amount,
         new.purchase_date, new.line_key, new.reason, new.marked_by, new.marked_at)
        is distinct from
        (old.id, old.seq, old.owner_id, old.purchase_id, old.line_no, old.item_name, old.folder_name, old.amount,
         old.purchase_date, old.line_key, old.reason, old.marked_by, old.marked_at) then
    raise exception 'HISTORY_LOCKED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists rec_cover_marks_guard on rec_cover_marks;
create trigger rec_cover_marks_guard before update or delete on rec_cover_marks
  for each row execute function rec_cover_marks_guard();

-- ════ 3. The months each cost move changed (Q10) ═════════════════════

-- Every cost-move expense row as it is added or removed. An approval's rows
-- are added in one transaction, a reversal's removed in one: (xact, change)
-- names the item.
create table if not exists rec_cost_row_log (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  cost_move_id uuid not null references stk_cost_moves(id),
  change text not null check (change in ('added', 'removed')),
  expense_id uuid not null,
  folder_id uuid,
  project_id uuid,
  cover boolean not null default false,
  amount numeric(14,2) not null,
  xact bigint not null default txid_current(),
  at timestamptz not null default now()
);
create index if not exists rec_cost_row_log_move on rec_cost_row_log (owner_id, cost_move_id, xact);
alter table rec_cost_row_log enable row level security;

-- "Bill checked" ticks, per item (cost move, transaction, direction). The latest counts.
create table if not exists rec_bill_checks (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  cost_move_id uuid not null references stk_cost_moves(id),
  xact bigint not null,
  change text not null check (change in ('added', 'removed')),
  checked boolean not null,
  note text not null default '' check (char_length(note) <= 500),
  checked_by uuid not null references profiles(id),
  checked_at timestamptz not null default now()
);
create index if not exists rec_bill_checks_group on rec_bill_checks (cost_move_id, xact, change, id desc);
alter table rec_bill_checks enable row level security;

create or replace function rec_history_locked() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_LOCKED' using errcode = 'P0001';
end;
$$;
drop trigger if exists rec_cost_row_log_locked on rec_cost_row_log;
create trigger rec_cost_row_log_locked before update or delete on rec_cost_row_log
  for each row execute function rec_history_locked();
drop trigger if exists rec_bill_checks_locked on rec_bill_checks;
create trigger rec_bill_checks_locked before update or delete on rec_bill_checks
  for each row execute function rec_history_locked();

-- The project a row is on: its own folder (no period), else its period's.
create or replace function rec_row_folder(p_folder uuid, p_period uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(p_folder, (select p.folder_id from projects p where p.id = p_period))
$$;

create or replace function rec_log_cost_rows() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.stk_cost_move_id is not null then
    insert into rec_cost_row_log (owner_id, cost_move_id, change, expense_id, folder_id, project_id, cover, amount)
    values (old.owner_id, old.stk_cost_move_id, 'removed', old.id, rec_row_folder(old.folder_id, old.project_id),
            old.project_id, coalesce(old.cover_expense, false), old.amount);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.stk_cost_move_id is not null then
    insert into rec_cost_row_log (owner_id, cost_move_id, change, expense_id, folder_id, project_id, cover, amount)
    values (new.owner_id, new.stk_cost_move_id, 'added', new.id, rec_row_folder(new.folder_id, new.project_id),
            new.project_id, coalesce(new.cover_expense, false), new.amount);
  end if;
  return null;
end;
$$;
drop trigger if exists rec_log_cost_rows_ins on expenses;
create trigger rec_log_cost_rows_ins after insert on expenses
  for each row when (new.stk_cost_move_id is not null) execute function rec_log_cost_rows();
drop trigger if exists rec_log_cost_rows_del on expenses;
create trigger rec_log_cost_rows_del after delete on expenses
  for each row when (old.stk_cost_move_id is not null) execute function rec_log_cost_rows();
drop trigger if exists rec_log_cost_rows_upd on expenses;
create trigger rec_log_cost_rows_upd after update on expenses
  for each row when ((old.stk_cost_move_id is not null or new.stk_cost_move_id is not null)
                     and (old.stk_cost_move_id, old.amount, old.project_id, old.folder_id, old.cover_expense)
                         is distinct from (new.stk_cost_move_id, new.amount, new.project_id, new.folder_id, new.cover_expense))
  execute function rec_log_cost_rows();

-- Rows approved before this migration: one group per cost move (xact 0).
insert into rec_cost_row_log (owner_id, cost_move_id, change, expense_id, folder_id, project_id, cover, amount, xact, at)
select e.owner_id, e.stk_cost_move_id, 'added', e.id, rec_row_folder(e.folder_id, e.project_id), e.project_id,
       coalesce(e.cover_expense, false), e.amount, 0, coalesce(e.created_at, now())
  from expenses e
 where e.stk_cost_move_id is not null
   and not exists (select 1 from rec_cost_row_log r where r.expense_id = e.id);

-- ════ 4. Helpers ═════════════════════════════════════════════════════

-- A purchase line's value (0105's stk_lot_basis, by line): its item amount
-- less its discount shares plus its delivery-fee shares.
create or replace function rec_line_value(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(l.gross_amount
               - coalesce((select sum(s.amount) from purchase_charge_shares s
                             join purchase_charges c on c.id = s.charge_id and c.kind = 'discount'
                            where s.line_id = l.id), 0)
               + coalesce((select sum(s.amount) from purchase_charge_shares s
                             join purchase_charges c on c.id = s.charge_id and c.kind = 'delivery_fee'
                            where s.line_id = l.id), 0), 2)
    from purchase_lines l where l.id = p_line
$$;

-- A line as it stands — its project, amount, purchase date and where its
-- rows sit — as one fingerprint. A correction that changes any of it
-- changes the key, so an old "Cover is right" mark no longer applies.
create or replace function rec_line_key(p_purchase uuid, p_line_no int) returns text
language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|', l.folder_id::text, l.gross_amount::text, pu.purchase_date::text,
           (select string_agg(coalesce(e.project_id::text, '-') || ':' || coalesce(e.folder_id::text, '-') || ':'
                              || coalesce(e.cover_expense, false)::text || ':' || e.amount::text, ','
                              order by coalesce(e.project_id::text, '-'), coalesce(e.folder_id::text, '-'), e.amount)
              from expenses e where e.purchase_line_id = l.id)))
    from purchase_lines l join purchases pu on pu.id = l.purchase_id
   where l.purchase_id = p_purchase and l.line_no = p_line_no
$$;

-- "October 2026 · billing #2", "May 2026 (Cover period)", or "No billing period".
create or replace function rec_period_label(p_period uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select btrim(coalesce(p.month, '') || ' ' || coalesce(p.year::text, ''))
                          || case when p.billing_number is not null then ' · billing #' || p.billing_number else '' end
                          || case when p.funding_type = 'president' then ' (Cover period)' else '' end
                     from projects p where p.id = p_period), 'No billing period')
$$;

-- The bill items (Q10) with their latest tick, for rec_waiting and rec_bills.
create or replace function rec_bill_groups(p_owner uuid)
returns table (cost_move_id uuid, xact bigint, change text, at timestamptz, checked boolean, note text,
               checked_by uuid, checked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select g.cost_move_id, g.xact, g.change, g.at,
         coalesce(b.checked, false), coalesce(b.note, ''), b.checked_by, b.checked_at
    from (select r.cost_move_id, r.xact, r.change, min(r.at) as at
            from rec_cost_row_log r where r.owner_id = p_owner
           group by r.cost_move_id, r.xact, r.change) g
    left join lateral (select x.checked, x.note, x.checked_by, x.checked_at from rec_bill_checks x
                        where x.cost_move_id = g.cost_move_id and x.xact = g.xact and x.change = g.change
                        order by x.id desc limit 1) b on true
$$;

-- Does a mark still apply? Not withdrawn, the newest for its line, the line
-- recorded and not waiting, and exactly as it was marked.
create or replace function rec_mark_current(p_mark uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select m.withdrawn_at is null
       and not exists (select 1 from rec_cover_marks n
                        where n.purchase_id = m.purchase_id and n.line_no = m.line_no and n.seq > m.seq)
       and exists (select 1 from purchase_lines l join purchases pu on pu.id = l.purchase_id
                    where l.purchase_id = m.purchase_id and l.line_no = m.line_no
                      and pu.status = 'recorded' and not l.needs_funding_review)
       and rec_line_key(m.purchase_id, m.line_no) is not distinct from m.line_key
      from rec_cover_marks m where m.id = p_mark), false)
$$;

-- ════ 5. Reads ═══════════════════════════════════════════════════════

-- Q4: where every peso of the purchases made between two days sits today.
create or replace function rec_purchase_places(p_from text, p_to text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_from date;
  v_to date;
  v_rows jsonb;
  v_void jsonb;
begin
  if coalesce(p_from, '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_to, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  begin
    v_from := p_from::date;
    v_to := p_to::date;
  exception when others then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end;
  if v_from > v_to or v_to - v_from > 3700 then
    raise exception 'BAD_RANGE' using errcode = 'P0001';
  end if;

  with pl as (
    select pu.* from purchases pu
     where pu.owner_id = v_owner and pu.status = 'recorded' and pu.purchase_date between v_from and v_to),
  own_rows as (
    select x.pid, sum(x.amount) as amt from (
      select l.purchase_id as pid, e.amount from expenses e join purchase_lines l on l.id = e.purchase_line_id
       where l.purchase_id in (select id from pl)
      union all
      select c.purchase_id, e.amount from expenses e join purchase_charges c on c.id = e.purchase_charge_id
       where c.purchase_id in (select id from pl)) x
     group by x.pid),
  move_rows as (
    select lt.purchase_id as pid,
           sum(e.amount) filter (where lt.cost_folder_id is not null
                                   and rec_row_folder(e.folder_id, e.project_id) = lt.cost_folder_id) as own_amt,
           sum(e.amount) filter (where lt.cost_folder_id is null
                                   or rec_row_folder(e.folder_id, e.project_id) is distinct from lt.cost_folder_id) as other_amt
      from expenses e
      join stk_cost_moves cm on cm.id = e.stk_cost_move_id
      join stk_lots lt on lt.id = cm.lot_id
     where lt.purchase_id in (select id from pl)
     group by lt.purchase_id),
  company as (
    select l.purchase_id as pid,
           sum(case when lt.id is not null then (select h.value from stk_held(lt.id, null) h)
                    when l.destination = 'warehouse' then rec_line_value(l.id)
                    else 0 end) as amt
      from purchase_lines l
      left join stk_lots lt on lt.purchase_id = l.purchase_id and lt.line_no = l.line_no
     where l.purchase_id in (select id from pl)
     group by l.purchase_id),
  loss as (
    select lt.purchase_id as pid, sum(c.value) as amt
      from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id
     where lt.purchase_id in (select id from pl)
       and c.kind = 'loss' and c.status = 'approved' and c.reversed_at is null
     group by lt.purchase_id),
  one as (
    select pl.id, pl.purchase_date, pl.created_at, pl.source, pl.receipt_total,
           coalesce((select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                       from suppliers s where s.id = pl.supplier_id), nullif(btrim(pl.supplier), ''), '') as supplier,
           (select string_agg(l.item_name, ', ' order by l.line_no) from purchase_lines l where l.purchase_id = pl.id) as what,
           (select string_agg(distinct case when l.destination = 'warehouse' then 'Warehouse' else l.folder_name end, ', ')
              from purchase_lines l where l.purchase_id = pl.id) as projects,
           round(coalesce(o.amt, 0) + coalesce(m.own_amt, 0), 2) as own,
           round(coalesce(m.other_amt, 0), 2) as other,
           round(coalesce(c.amt, 0), 2) as company,
           round(coalesce(x.amt, 0), 2) as lost
      from pl
      left join own_rows o on o.pid = pl.id
      left join move_rows m on m.pid = pl.id
      left join company c on c.pid = pl.id
      left join loss x on x.pid = pl.id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', one.id, 'ref', left(one.id::text, 8), 'purchase_date', one.purchase_date, 'entered', one.created_at,
           'source', one.source, 'supplier', one.supplier, 'what', coalesce(one.what, ''), 'projects', coalesce(one.projects, ''),
           'recorded', one.receipt_total, 'own', one.own, 'other', one.other, 'company', one.company, 'loss', one.lost,
           'difference', round(one.receipt_total - one.own - one.other - one.company - one.lost, 2))
         order by one.purchase_date desc, one.created_at desc), '[]'::jsonb)
    into v_rows
    from one;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pu.id, 'ref', left(pu.id::text, 8), 'purchase_date', pu.purchase_date, 'recorded', pu.receipt_total,
           'what', (select string_agg(l.item_name, ', ' order by l.line_no) from purchase_lines l where l.purchase_id = pu.id),
           'voided_at', h.at, 'reason', coalesce(h.reason, ''))
         order by pu.purchase_date desc, pu.created_at desc), '[]'::jsonb)
    into v_void
    from purchases pu
    left join lateral (select x.at, x.reason from purchase_history x
                        where x.purchase_id = pu.id and x.kind = 'voided' order by x.id desc limit 1) h on true
   where pu.owner_id = v_owner and pu.status = 'void' and pu.replaced_by is null
     and pu.purchase_date between v_from and v_to;

  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'purchases', v_rows, 'voided', v_void,
    'totals', (select jsonb_build_object(
                 'purchases', count(*),
                 'recorded', coalesce(round(sum((r ->> 'recorded')::numeric), 2), 0),
                 'own', coalesce(round(sum((r ->> 'own')::numeric), 2), 0),
                 'other', coalesce(round(sum((r ->> 'other')::numeric), 2), 0),
                 'company', coalesce(round(sum((r ->> 'company')::numeric), 2), 0),
                 'loss', coalesce(round(sum((r ->> 'loss')::numeric), 2), 0),
                 'difference', coalesce(round(sum((r ->> 'difference')::numeric), 2), 0),
                 'with_difference', count(*) filter (where (r ->> 'difference')::numeric <> 0))
                 from jsonb_array_elements(v_rows) r));
end;
$$;

-- Q5: what is waiting for someone, as counts. The cash ones (and Overpaid)
-- are the main owner's decisions (2A-4) and reach only the main owner.
create or replace function rec_waiting() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_out jsonb;
begin
  v_out := jsonb_build_object(
    'cost_moves', (select count(*) from stk_cost_moves c where c.owner_id = v_owner and c.status = 'pending'),
    'change_requests', (select count(*) from purchase_change_requests r where r.owner_id = v_owner and r.status = 'pending'),
    'stock', (select count(*) from stk_records r where r.owner_id = v_owner and r.status = 'pending'),
    'tools', (select count(*) from tl_tools t where t.owner_id = v_owner and t.state in ('lost_pending', 'retire_pending')),
    'billing_period', (select count(*) from purchase_lines l join purchases pu on pu.id = l.purchase_id
                        where pu.owner_id = v_owner and pu.status = 'recorded' and l.needs_funding_review),
    'unpaid', (select count(*) from purchases pu
                where pu.owner_id = v_owner and pu.status = 'recorded' and pu.payments_tracked
                  and pur_pay_state(pu.id) ->> 'state' in ('unpaid', 'partial')),
    'bills', (select count(*) from rec_bill_groups(v_owner) g where not g.checked));
  if pur_is_main_owner() then
    v_out := v_out || jsonb_build_object(
      'own_money', (select count(*) from pur_payments x where x.owner_id = v_owner and x.source = 'own_money'
                      and x.voided_at is null and not x.authorized and x.accepted_at is null and x.rejected_at is null),
      'returns', (select count(*) from pur_cash_returns r where r.owner_id = v_owner and r.status = 'reported'),
      'disputes', (select count(*) from pur_cash_issues i where i.owner_id = v_owner and i.voided_at is null
                     and i.disputed_at is not null and i.dispute_cleared_at is null),
      'overpaid', (select count(*) from purchases pu
                    where pu.owner_id = v_owner and exists (select 1 from pur_payments x where x.purchase_id = pu.id)
                      and ((pur_pay_state(pu.id) ->> 'unresolved')::numeric > 0
                           or (pur_pay_state(pu.id) ->> 'over_resolved')::numeric > 0)));
  end if;
  return v_out;
end;
$$;

-- Q6: lines waiting for a billing period, and the "Cover is right" marks.
create or replace function rec_review_lines() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_today date := pur_manila_today();
begin
  return jsonb_build_object(
    'today', v_today,
    'waiting', (select coalesce(jsonb_agg(jsonb_build_object(
                  'purchase_id', pu.id, 'ref', left(pu.id::text, 8), 'line_no', l.line_no,
                  'purchase_date', pu.purchase_date, 'entered', pu.created_at,
                  'item', l.item_name, 'category', l.category, 'project', l.folder_name, 'folder_id', l.folder_id,
                  'amount', l.gross_amount,
                  'rows', (select coalesce(jsonb_agg(jsonb_build_object('period', rec_period_label(e.project_id),
                                     'cover', coalesce(e.cover_expense, false), 'amount', e.amount)
                                     order by e.amount desc), '[]'::jsonb)
                             from expenses e where e.purchase_line_id = l.id),
                  -- A billing period for the purchase month exists NOW: saving the row again would charge it there.
                  'period_now', exists (select 1 from projects p where p.folder_id = l.folder_id
                                          and pur_month_no(p.month) = extract(month from pu.purchase_date)::int
                                          and p.year = extract(year from pu.purchase_date)::int
                                          and coalesce(p.funding_type, '') <> 'president'),
                  'days', v_today - (pu.created_at at time zone 'Asia/Manila')::date)
                  order by pu.purchase_date, pu.created_at, l.line_no), '[]'::jsonb)
                  from purchase_lines l join purchases pu on pu.id = l.purchase_id
                 where pu.owner_id = v_owner and pu.status = 'recorded' and l.needs_funding_review),
    'marks', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', m.id, 'purchase_id', m.purchase_id, 'ref', left(m.purchase_id::text, 8), 'line_no', m.line_no,
                'item', m.item_name, 'project', m.folder_name, 'amount', m.amount, 'purchase_date', m.purchase_date,
                'reason', m.reason, 'marked_by', pur_person_name(m.marked_by), 'marked_at', m.marked_at,
                'withdrawn_by', case when m.withdrawn_by is null then null else pur_person_name(m.withdrawn_by) end,
                'withdrawn_at', m.withdrawn_at, 'withdraw_reason', m.withdraw_reason,
                'current', rec_mark_current(m.id))
                order by m.seq desc), '[]'::jsonb)
                from (select * from rec_cover_marks where owner_id = v_owner order by seq desc limit 100) m));
end;
$$;

-- Q10: every approval and reversal of a cost move, with the months it
-- changed on each side and its latest "Bill checked" tick. Project Control's
-- Reports read the same list (through js/reconciliation-admin.js) for its
-- "changed after the month ended" note (Q11): a reversal deletes its rows,
-- so only this log still knows that a month changed again.
create or replace function rec_bills() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := rec_owner();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'cost_move_id', g.cost_move_id, 'group', g.xact::text || ':' || g.change, 'at', g.at,
            'change', case g.change when 'added' then 'approved' else 'reversed' end,
            'kind', cm.kind, 'item', ci.name, 'unit', ci.unit, 'quantity', cm.approved_quantity, 'value', cm.value,
            'from', case when cm.from_folder is null then 'Company stock' else stk_folder_name(cm.from_folder) end,
            'to', case when cm.kind = 'loss' then 'Company stock loss'
                       when cm.to_folder is null then 'Company stock' else stk_folder_name(cm.to_folder) end,
            'reverse_reason', cm.reverse_reason,
            'sides', (select coalesce(jsonb_agg(jsonb_build_object(
                         'project', case when s.folder_id is null then 'No project' else stk_folder_name(s.folder_id) end,
                         'period', rec_period_label(s.project_id), 'period_id', s.project_id, 'folder_id', s.folder_id,
                         'cover', s.cover, 'amount', s.amount)
                         order by s.amount), '[]'::jsonb)
                        from (select r.folder_id, r.project_id, r.cover,
                                     round(sum(case when r.change = 'added' then r.amount else -r.amount end), 2) as amount
                                from rec_cost_row_log r
                               where r.owner_id = v_owner and r.cost_move_id = g.cost_move_id and r.xact = g.xact
                                 and r.change = g.change
                               group by r.folder_id, r.project_id, r.cover) s),
            'checked', g.checked, 'note', g.note,
            'checked_by', case when g.checked_by is null then null else pur_person_name(g.checked_by) end,
            'checked_at', g.checked_at)
          order by g.checked, g.at desc), '[]'::jsonb)
            from rec_bill_groups(v_owner) g
            join stk_cost_moves cm on cm.id = g.cost_move_id
            join stk_lots lt on lt.id = cm.lot_id
            join pr_catalog_items ci on ci.id = lt.item_id);
end;
$$;

-- Q9: money still out. Payments never change Spent (2A-4); this only adds up
-- what 2A-4 records. Cash keys: the main owner only.
create or replace function rec_money_out() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_out jsonb;
begin
  v_out := jsonb_build_object(
    'owed', (select coalesce(jsonb_agg(jsonb_build_object('supplier', x.name, 'purchases', x.n, 'partly_paid', x.partial,
                                                          'balance', x.balance) order by x.balance desc, x.name), '[]'::jsonb)
               from (select coalesce((select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                                        from suppliers s where s.id = pu.supplier_id),
                                     nullif(btrim(pu.supplier), ''), 'No supplier recorded') as name,
                            count(*) as n, count(*) filter (where st.v ->> 'state' = 'partial') as partial,
                            round(sum((st.v ->> 'balance')::numeric), 2) as balance
                       from purchases pu cross join lateral (select pur_pay_state(pu.id) as v) st
                      where pu.owner_id = v_owner and pu.status = 'recorded'
                        and st.v ->> 'state' in ('unpaid', 'partial')
                      group by 1) x),
    'not_tracked', (select jsonb_build_object('purchases', count(*), 'total', coalesce(round(sum(pu.receipt_total), 2), 0))
                      from purchases pu
                     where pu.owner_id = v_owner and pu.status = 'recorded' and not pu.payments_tracked
                       and not exists (select 1 from pur_payments x where x.purchase_id = pu.id and x.voided_at is null)),
    'credits', (select coalesce(jsonb_agg(jsonb_build_object('supplier', y.name, 'credits', y.n, 'left', y.left_amt)
                                          order by y.left_amt desc, y.name), '[]'::jsonb)
                  from (select coalesce((select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                                           from suppliers s where s.id = c.supplier_id), 'A supplier') as name,
                               count(*) as n, round(sum(pur_credit_left(c.id)), 2) as left_amt
                          from pur_supplier_credits c
                         where c.owner_id = v_owner and c.voided_at is null and pur_credit_left(c.id) > 0
                         group by 1) y));
  if pur_is_main_owner() then
    v_out := v_out || jsonb_build_object(
      'overpaid', (select jsonb_build_object('purchases', count(*), 'amount', coalesce(round(sum(z.unresolved), 2), 0))
                     from (select (pur_pay_state(pu.id) ->> 'unresolved')::numeric as unresolved
                             from purchases pu
                            where pu.owner_id = v_owner
                              and exists (select 1 from pur_payments x where x.purchase_id = pu.id)) z
                    where z.unresolved > 0),
      'buyers', (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'cash_held', greatest(0, b.raw),
                                                              'shortfall', greatest(0, -b.raw), 'owed_to_buyer', b.owes,
                                                              'own_money_to_review', b.review) order by b.name), '[]'::jsonb)
                   from (select pur_person_name(p.id) as name, pur_cash_raw(v_owner, p.id) as raw,
                                pur_owes(v_owner, p.id) as owes, pur_owes_to_review(v_owner, p.id) as review
                           from profiles p
                          where p.role = 'staff' and p.owner_id = v_owner
                            and (exists (select 1 from pur_cash_issues i where i.buyer_id = p.id and i.owner_id = v_owner)
                                 or exists (select 1 from pur_payments x where x.person_id = p.id and x.owner_id = v_owner)
                                 or exists (select 1 from pur_buyer_repayments r where r.buyer_id = p.id and r.owner_id = v_owner))) b
                  where b.raw <> 0 or b.owes <> 0 or b.review <> 0));
  end if;
  return v_out;
end;
$$;

-- ════ 6. Decisions (they move no money) ═══════════════════════════════

-- Q6: "Cover is right" — clears one line's "Office review" mark, with a reason.
create or replace function rec_accept_cover(p_op uuid, p_purchase uuid, p_line_no int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_prev jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  pu purchases;
  l purchase_lines;
  v_id uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(p_purchase);
  select * into pu from purchases where id = p_purchase and owner_id = v_owner;
  if pu.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if pu.status <> 'recorded' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  select * into l from purchase_lines where purchase_id = p_purchase and line_no = p_line_no;
  if l.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not l.needs_funding_review then
    raise exception 'NOT_WAITING' using errcode = 'P0001';
  end if;
  if not exists (select 1 from expenses e where e.purchase_line_id = l.id)
     or exists (select 1 from expenses e where e.purchase_line_id = l.id and not coalesce(e.cover_expense, false)) then
    raise exception 'NOT_COVER' using errcode = 'P0001';
  end if;
  insert into rec_cover_marks (owner_id, purchase_id, line_no, item_name, folder_name, amount, purchase_date, line_key,
                               reason, marked_by)
  values (v_owner, p_purchase, p_line_no, l.item_name, coalesce(l.folder_name, ''), l.gross_amount, pu.purchase_date,
          rec_line_key(p_purchase, p_line_no), v_reason, auth.uid())
  returning id into v_id;
  update purchase_lines set needs_funding_review = false where id = l.id;
  return pur_op_done(v_owner, p_op, 'rec_accept_cover',
                     jsonb_build_object('mark_id', v_id, 'purchase_id', p_purchase, 'line_no', p_line_no));
end;
$$;

-- Q6: withdraw a mark — only while the line is exactly as it was marked.
create or replace function rec_withdraw_cover(p_op uuid, p_mark uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_prev jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  m rec_cover_marks;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select * into m from rec_cover_marks where id = p_mark and owner_id = v_owner;
  if m.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(m.purchase_id);
  select * into m from rec_cover_marks where id = p_mark for update;
  if m.withdrawn_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if not rec_mark_current(m.id) then
    raise exception 'CHANGED_SINCE' using errcode = 'P0001',
      hint = 'The line changed (or was marked again) after this mark; it no longer applies.';
  end if;
  update purchase_lines set needs_funding_review = true where purchase_id = m.purchase_id and line_no = m.line_no;
  update rec_cover_marks set withdrawn_by = auth.uid(), withdrawn_at = now(), withdraw_reason = v_reason where id = m.id;
  return pur_op_done(v_owner, p_op, 'rec_withdraw_cover', jsonb_build_object('mark_id', m.id, 'withdrawn', true));
end;
$$;

-- Q10: tick (or un-tick) "Bill checked" for one item. p_group is the item's
-- key as rec_bills gives it: '<transaction>:added' (an approval) or
-- '<transaction>:removed' (a reversal).
create or replace function rec_bill_check(p_op uuid, p_cost_move uuid, p_group text, p_checked boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := rec_owner();
  v_prev jsonb;
  v_xact bigint;
  v_change text;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if coalesce(p_group, '') !~ '^\d{1,18}:(added|removed)$' or p_checked is null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  v_xact := split_part(p_group, ':', 1)::bigint;
  v_change := split_part(p_group, ':', 2);
  if char_length(v_note) > 500 then
    raise exception 'BAD_NOTE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from rec_cost_row_log r where r.owner_id = v_owner and r.cost_move_id = p_cost_move
                    and r.xact = v_xact and r.change = v_change) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into rec_bill_checks (owner_id, cost_move_id, xact, change, checked, note, checked_by)
  values (v_owner, p_cost_move, v_xact, v_change, p_checked, v_note, auth.uid());
  return pur_op_done(v_owner, p_op, 'rec_bill_check',
                     jsonb_build_object('cost_move_id', p_cost_move, 'group', p_group, 'checked', p_checked));
end;
$$;

-- ════ 7. Add Expense's saves (R120) ═════════════════════════════════

-- Every operation id Add Expense may send to pur_record, registered first.
-- Written only by pur_op_reserve; read only by pur_op_recover. Settled ids
-- are the ones pur_ops holds (recorded, or cancelled).
create table if not exists pur_op_reservations (
  actor_id uuid not null references profiles(id),
  op_id uuid not null,
  owner_id uuid not null references profiles(id),
  reserved_at timestamptz not null default now(),
  primary key (actor_id, op_id)
);
alter table pur_op_reservations enable row level security;

-- Register a save's id before it is sent. Accounts that may use Add Expense
-- (pur_actor_owner). Sending it again is harmless.
create or replace function pur_op_reserve(p_op uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  insert into pur_op_reservations (actor_id, op_id, owner_id) values (auth.uid(), p_op, v_owner)
  on conflict (actor_id, op_id) do nothing;
end;
$$;

-- Settle every registered save of the CALLING account that the server has no
-- answer for: cancelled for good, or found recorded (pur_op_cancel, each
-- under its operation's lock). Returns how many of each.
create or replace function pur_op_recover() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_op uuid;
  v_cancelled int := 0;
  v_recorded int := 0;
begin
  perform pur_actor_owner('expenses_form');
  for v_op in select r.op_id from pur_op_reservations r
               where r.actor_id = auth.uid()
                 and not exists (select 1 from pur_ops o where o.actor_id = r.actor_id and o.op_id = r.op_id)
               order by r.reserved_at, r.op_id
  loop
    if pur_op_cancel(v_op) = 'cancelled' then
      v_cancelled := v_cancelled + 1;
    else
      v_recorded := v_recorded + 1;
    end if;
  end loop;
  return jsonb_build_object('cancelled', v_cancelled, 'recorded', v_recorded);
end;
$$;

-- ════ 8. Who may call what ═══════════════════════════════════════════

revoke all on function rec_purchase_places(text, text) from public, anon;
grant execute on function rec_purchase_places(text, text) to authenticated;
revoke all on function rec_waiting() from public, anon;
grant execute on function rec_waiting() to authenticated;
revoke all on function rec_review_lines() from public, anon;
grant execute on function rec_review_lines() to authenticated;
revoke all on function rec_bills() from public, anon;
grant execute on function rec_bills() to authenticated;
revoke all on function rec_money_out() from public, anon;
grant execute on function rec_money_out() to authenticated;
revoke all on function rec_accept_cover(uuid, uuid, int, text) from public, anon;
grant execute on function rec_accept_cover(uuid, uuid, int, text) to authenticated;
revoke all on function rec_withdraw_cover(uuid, uuid, text) from public, anon;
grant execute on function rec_withdraw_cover(uuid, uuid, text) to authenticated;
revoke all on function rec_bill_check(uuid, uuid, text, boolean, text) from public, anon;
grant execute on function rec_bill_check(uuid, uuid, text, boolean, text) to authenticated;
revoke all on function pur_op_reserve(uuid) from public, anon;
grant execute on function pur_op_reserve(uuid) to authenticated;
revoke all on function pur_op_recover() from public, anon;
grant execute on function pur_op_recover() to authenticated;

-- Internal helpers: only the SECURITY DEFINER functions above call them.
revoke all on function rec_owner() from public, anon, authenticated;
revoke all on function rec_cover_marks_guard() from public, anon, authenticated;
revoke all on function rec_history_locked() from public, anon, authenticated;
revoke all on function rec_row_folder(uuid, uuid) from public, anon, authenticated;
revoke all on function rec_log_cost_rows() from public, anon, authenticated;
revoke all on function rec_line_value(uuid) from public, anon, authenticated;
revoke all on function rec_line_key(uuid, int) from public, anon, authenticated;
revoke all on function rec_mark_current(uuid) from public, anon, authenticated;
revoke all on function rec_period_label(uuid) from public, anon, authenticated;
revoke all on function rec_bill_groups(uuid) from public, anon, authenticated;
