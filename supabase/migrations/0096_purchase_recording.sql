-- 0096 — WorkMate Stage 2A-1: one purchase recording operation.
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- Section 3 (money rules, agreed 12 October 2026); plan
-- docs/superpowers/plans/2026-10-14-workmate-stage2a1-purchase-recording.md.
--
-- ── 1. Purchases. A purchase (one receipt) has lines — each for a project
--    (Main Contract or an Additional Works folder) or the warehouse — and
--    optional delivery-fee / discount charges shared across its lines.
--    Purchase, payment and receipt are separate facts; this migration records
--    only the purchase. Payments come later and never touch Spent (§3.5).
--
-- ── 2. Purchases become ordinary expense rows (§3.2). A project line is
--    charged by writing `expenses` rows linked back to it (a fee share to its
--    charge), so Project Control, Reports, print and CSV keep reading one
--    table. Warehouse lines write NO rows: company stock cost, outside every
--    project's Spent until an owner-approved cost assignment (2C).
--
-- ── 3. Funding (§3.3): the ACTUAL purchase month. A Main Contract line
--    charges that month's client periods with a budget, earliest billing
--    number first, each up to its remaining fund (budget − expenses − payroll
--    already charged to it, exactly as Dacs Web computes it). A shortage goes
--    to Cover; never another month. No eligible period that month → the whole
--    amount is Cover and the line is flagged for office review. A project with
--    NO billing period at all still counts the cost at once: the row is tied
--    to the project (expenses.folder_id, no period), Cover, flagged — no
--    period or client allocation is ever invented. Additional Works lines
--    charge their own period in full, no cap (Q24). Cover rows carry
--    cover_expense = true, so Cover stays a SUBSET of Spent.
--
-- ── 4. Only through the purchase. Expense rows made by a purchase are
--    written, corrected, re-funded and voided only by these functions; a
--    trigger refuses any other insert, update or delete of such a row.
--
-- ── 5. Retry- and race-safe. Each call carries an operation id; the first
--    answer is kept in pur_ops and returned on retry, marked
--    "replayed": true. Every lock a
--    call needs (its operation, each project it charges, each stock item it
--    adds to) is taken at the start, in one fixed order, before anything is
--    written — so two simultaneous purchases wait for each other instead of
--    deadlocking or spending the same remaining fund twice.
--
-- ── 6. Stock. The "also track in inventory" tick adds the bought quantity
--    to `inventory` INSIDE the recording transaction, once per purchase line:
--    purchase_stock_moves (one row per line, primary key) refuses a second
--    move, so neither a retry nor an overlapping save can add stock twice.
--    Stock items are matched within the company (its own items, or the
--    unowned ones the old browser mirror wrote). Replacing a purchase
--    (pur_replace) carries the stock already moved over to the new lines, so
--    void-and-record never adds it twice.
--
-- ── 7. Deleting. A project or billing period with a live purchase cannot be
--    deleted (a database safeguard, checked before anything is removed — a
--    fully discounted purchase with no expense rows counts too). Dacs Web
--    asks pur_live_purchases() first, before deleting anything.
--
-- Who: active owner/staff accounts allowed the Expenses section (a
-- module-focused account such as admin-pm@ = ["pm"] is refused) — for
-- recording AND for reading purchases. Changes to one purchase are taken
-- one at a time (a per-purchase lock BEFORE its projects are looked up). Phone
-- purchasing (source 'workmate') is refused until the Buyer switch exists
-- (Stage 2A-2): Expenses access never grants it. Corrections, re-funds and
-- voids on a COMPLETED project, and moving a line to another project, are
-- main-owner only.

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  source text not null check (source in ('expenses_form', 'workmate')),
  purchase_date date not null,
  date_time text not null default '',
  supplier text not null default '' check (char_length(supplier) <= 200),
  receipt_total numeric(14,2) not null check (receipt_total >= 0),
  notes text not null default '' check (char_length(notes) <= 2000),
  payment_method text not null default '' check (char_length(payment_method) <= 60),
  docs jsonb not null default '{}'::jsonb,
  status text not null default 'recorded' check (status in ('recorded', 'void')),
  replaced_by uuid,
  recorded_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchases_owner on purchases (owner_id, purchase_date desc);

-- folder_id is history, not a foreign key: once every purchase of a project
-- is voided the project may be deleted, and its purchases stay readable
-- (folder_name keeps what it was called). The functions validate it.
create table if not exists purchase_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  line_no int not null check (line_no between 1 and 50),
  destination text not null check (destination in ('project', 'warehouse')),
  folder_id uuid,
  folder_name text not null default '',
  item_name text not null check (char_length(btrim(item_name)) between 1 and 200),
  category text not null default '' check (char_length(category) <= 100),
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default '' check (char_length(unit) <= 30),
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  in_inventory boolean not null default false,
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  needs_funding_review boolean not null default false,
  unique (purchase_id, line_no),
  check ((destination = 'project') = (folder_id is not null))
);
create index if not exists purchase_lines_folder on purchase_lines (folder_id);

create table if not exists purchase_charges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  charge_no int not null check (charge_no between 1 and 10),
  kind text not null check (kind in ('delivery_fee', 'discount')),
  amount numeric(14,2) not null check (amount > 0),
  unique (purchase_id, charge_no)
);

-- How a charge is shared across the purchase's lines. Never negative.
create table if not exists purchase_charge_shares (
  charge_id uuid not null references purchase_charges(id),
  line_id uuid not null references purchase_lines(id),
  amount numeric(14,2) not null check (amount >= 0),
  primary key (charge_id, line_id)
);

-- Recorded / corrected / re-funded / voided, with the content before and after.
create table if not exists purchase_history (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  kind text not null check (kind in ('recorded', 'corrected', 'refunded', 'voided', 'replaced')),
  reason text not null default '',
  before jsonb,
  after jsonb,
  actor_id uuid not null references profiles(id),
  at timestamptz not null default now()
);
create index if not exists purchase_history_purchase on purchase_history (purchase_id, id);

-- The first answer to each operation, returned verbatim on retry.
create table if not exists pur_ops (
  owner_id uuid not null references profiles(id),
  op_id uuid not null,
  actor_id uuid not null references profiles(id),
  kind text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, op_id)
);

-- One stock move per purchase line, ever (the primary key is the guard).
create table if not exists purchase_stock_moves (
  line_id uuid primary key references purchase_lines(id),
  inventory_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  moved_at timestamptz not null default now()
);

alter table expenses add column if not exists purchase_line_id uuid references purchase_lines(id);
alter table expenses add column if not exists purchase_charge_id uuid references purchase_charges(id);
-- A project's cost when it has NO billing period: tied to the project, no period.
alter table expenses add column if not exists folder_id uuid references folders(id) on delete cascade;
create index if not exists expenses_purchase_line on expenses (purchase_line_id) where purchase_line_id is not null;
create index if not exists expenses_purchase_charge on expenses (purchase_charge_id) where purchase_charge_id is not null;
create index if not exists expenses_folder on expenses (folder_id) where folder_id is not null;

-- Who may READ purchases: the same accounts that may record them — an active
-- owner or staff account allowed the Expenses section. A boolean about the
-- caller only; the policies below call it (callers need EXECUTE on it).
create or replace function pur_reader() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_mods jsonb;
begin
  if auth.uid() is null or not pr_is_office() then
    return false;
  end if;
  select p.allowed_modules into v_mods from profiles p where p.id = auth.uid();
  -- No list, an empty list, or a list that includes Expenses (never null).
  return jsonb_typeof(v_mods) is distinct from 'array' or jsonb_array_length(v_mods) = 0 or v_mods ? 'expenses';
end;
$$;

-- The office reads (owner, or staff of that owner, allowed Expenses); every
-- change goes through the functions below. Clients and workers read nothing.
do $$
declare t text;
begin
  foreach t in array array['purchases', 'purchase_lines', 'purchase_charges', 'purchase_history'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_office_read', t);
    execute format('create policy %I on %I for select using (can_access(owner_id) and pur_reader())', t || '_office_read', t);
  end loop;
end $$;
alter table purchase_charge_shares enable row level security;
drop policy if exists purchase_charge_shares_office_read on purchase_charge_shares;
create policy purchase_charge_shares_office_read on purchase_charge_shares for select
  using (pur_reader() and exists (select 1 from purchase_charges c where c.id = purchase_charge_shares.charge_id and can_access(c.owner_id)));
alter table pur_ops enable row level security;
alter table purchase_stock_moves enable row level security;

-- ════ 2. Only through the purchase ═══════════════════════════════════

-- A purchase-made expense row (or a project-level row with no period) is
-- written only inside the purchase functions, which set dacs.purchase_write
-- for their own transaction.
--
-- Trusting that setting is safe because API clients cannot run SQL or call
-- set_config: PostgREST exposes only the public schema's functions, and from a
-- request it sets only request.* settings. Only the SECURITY DEFINER
-- operations below set it, with is_local = true, so it ends with their
-- transaction. If a public function that runs caller-supplied SQL or
-- set_config is ever added, this guard needs rethinking.
create or replace function pur_guard_expense_row() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('dacs.purchase_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op in ('UPDATE', 'DELETE')
     and (old.purchase_line_id is not null or old.purchase_charge_id is not null or old.folder_id is not null) then
    raise exception 'PURCHASE_ROW' using errcode = 'P0001',
      hint = 'This expense comes from a purchase. Correct or void the purchase instead.';
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and (new.purchase_line_id is not null or new.purchase_charge_id is not null or new.folder_id is not null) then
    raise exception 'PURCHASE_ROW' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists expenses_purchase_guard on expenses;
create trigger expenses_purchase_guard before insert or update or delete on expenses
  for each row execute function pur_guard_expense_row();

-- A project (folder) or billing period with a LIVE purchase cannot be deleted.
-- Checked on the project/period row itself, BEFORE its cascade removes
-- anything — and from the purchase lines, so a fully discounted purchase
-- (no expense rows) counts too. Voided purchases never block.
create or replace function pur_guard_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'folders' then
    if exists (select 1 from purchase_lines l join purchases pu on pu.id = l.purchase_id
                where l.folder_id = old.id and pu.status = 'recorded') then
      raise exception 'PURCHASES_LIVE' using errcode = 'P0001',
        hint = 'This project has purchases. Void them first, or mark the project completed.';
    end if;
  elsif exists (select 1 from expenses e
                 where e.project_id = old.id and (e.purchase_line_id is not null or e.purchase_charge_id is not null)) then
    raise exception 'PURCHASES_LIVE' using errcode = 'P0001',
      hint = 'This billing period has purchases. Void them first.';
  end if;
  return old;
end;
$$;
drop trigger if exists folders_purchase_delete_guard on folders;
create trigger folders_purchase_delete_guard before delete on folders
  for each row execute function pur_guard_delete();
drop trigger if exists projects_purchase_delete_guard on projects;
create trigger projects_purchase_delete_guard before delete on projects
  for each row execute function pur_guard_delete();

-- Asked by Dacs Web BEFORE deleting anything: how many live purchases touch
-- this project AND its Additional Works jobs (any of their lines, discounted
-- to zero or not) or this period. The jobs are children that cascade-delete
-- with the project, so a live purchase on one must block the parent too.
create or replace function pur_live_purchases(p_folder uuid, p_period uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null or not pr_is_office() then
    raise exception 'NOT_OFFICE' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select count(distinct pu.id) from purchases pu
           where pu.owner_id = v_owner and pu.status = 'recorded'
             and (exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.folder_id = p_folder)
                  or exists (select 1 from purchase_lines l join folders f on f.id = l.folder_id
                              where l.purchase_id = pu.id and f.parent_folder_id = p_folder)
                  or exists (select 1 from expenses e join purchase_lines l on l.id = e.purchase_line_id
                              where l.purchase_id = pu.id and e.project_id = p_period)
                  or exists (select 1 from expenses e join purchase_charges c on c.id = e.purchase_charge_id
                              where c.purchase_id = pu.id and e.project_id = p_period)));
end;
$$;

-- ════ 3. Locks ═══════════════════════════════════════════════════════

-- Take every lock a call needs at once, in one fixed order (by lock number),
-- before anything is written. Two calls wanting the same project or stock
-- item wait in line; neither can hold one while waiting for the other.
create or replace function pur_lock(p_keys text[]) returns void
language plpgsql security definer set search_path = public as $$
declare k bigint;
begin
  for k in select distinct hashtextextended(x, 0) from unnest(p_keys) x where x is not null order by 1 loop
    perform pg_advisory_xact_lock(k);
  end loop;
end;
$$;

-- A uuid from request text in its canonical form, or null when it is not one
-- (never an exception, so callers can answer with their own error code).
create or replace function pur_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return nullif(btrim(coalesce(p, '')), '')::uuid;
exception when others then
  return null;
end;
$$;

-- The lock keys for a body: each project it charges, each stock item it adds to.
create or replace function pur_body_keys(p_body jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(k), '{}') from (
    select 'pur_folder:' || coalesce(pur_uuid(l ->> 'folder_id')::text, btrim(l ->> 'folder_id')) k
      from jsonb_array_elements(case when jsonb_typeof(p_body -> 'lines') = 'array' then p_body -> 'lines' else '[]'::jsonb end) l
     where coalesce(l ->> 'folder_id', '') <> ''
    union
    select 'pur_stock:' || lower(btrim(l ->> 'item_name'))
      from jsonb_array_elements(case when jsonb_typeof(p_body -> 'lines') = 'array' then p_body -> 'lines' else '[]'::jsonb end) l
     where (l ->> 'in_inventory') = 'true' and coalesce(btrim(l ->> 'item_name'), '') <> ''
  ) x
$$;

-- The project lock keys of a stored purchase.
create or replace function pur_stored_keys(p_purchase uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct 'pur_folder:' || l.folder_id), '{}')
    from purchase_lines l where l.purchase_id = p_purchase and l.folder_id is not null
$$;

-- ════ 4. Funding ═════════════════════════════════════════════════════

-- projects.month is free text ("October"). Full English names, 3-letter
-- abbreviations and numbers all count; anything else matches no month.
create or replace function pur_month_no(p text) returns int
language sql immutable as $$
  select case
    when btrim(coalesce(p, '')) ~ '^\d{1,2}$' and btrim(p)::int between 1 and 12 then btrim(p)::int
    else (select n from (values
            (1, 'january'), (2, 'february'), (3, 'march'), (4, 'april'), (5, 'may'), (6, 'june'),
            (7, 'july'), (8, 'august'), (9, 'september'), (10, 'october'), (11, 'november'), (12, 'december')) m(n, name)
           where lower(btrim(coalesce(p, ''))) in (m.name, left(m.name, 3)))
  end
$$;

-- What a period still has, exactly as Dacs Web computes it today:
-- its fund allocated minus every expense and payroll row charged to it.
create or replace function pur_period_remaining(p_period uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(coalesce((select b.monthly_budget from project_budgets b
                          join projects p on p.id = b.project_id and p.owner_id = b.owner_id
                         where b.project_id = p_period), 0)
             - coalesce((select sum(e.amount) from expenses e where e.project_id = p_period), 0)
             - coalesce((select sum(p.total_salary) from payroll p where p.project_id = p_period), 0), 2)
$$;

-- Where a Cover row goes (§3.3 "Cover link"): the project's Cover (president)
-- period when one exists — that month's, else the latest — otherwise a client
-- period of the same project in the purchase month, flagged cover_expense
-- (earliest billing number). Never another month's client period (it would
-- use up that month's client money). Only this company's periods of this
-- project. Never invents a period. Null = no Cover period and no period in
-- that month → the row is tied to the project.
create or replace function pur_cover_period(p_owner uuid, p_folder uuid, p_date date) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from (
    select p.id,
           (p.funding_type = 'president') as cover_period,
           (pur_month_no(p.month) = extract(month from p_date)::int and p.year = extract(year from p_date)::int) as same_month,
           coalesce(p.year, 0) as year, coalesce(pur_month_no(p.month), 0) as month_no, p.billing_number, p.created_at
      from projects p
     where p.folder_id = p_folder and p.owner_id = p_owner
  ) c
  -- A Cover period of any month, or a client period of the purchase month
  -- only (same_month must be TRUE; null — an unreadable month — is not).
  where c.cover_period is true or c.same_month is true
  order by c.cover_period desc,
           c.same_month desc nulls last,
           case when c.same_month then c.billing_number end asc nulls last,
           c.year desc, c.month_no desc, c.billing_number desc nulls last, c.created_at desc, c.id
  limit 1
$$;

-- How one amount for one project on one date is funded. Returns the rows to
-- write: period (null = the project itself: no Cover period and no period
-- in the purchase month), amount,
-- Cover, office review. Callers hold the project's lock (pur_lock).
create or replace function pur_fund(p_owner uuid, p_folder uuid, p_date date, p_amount numeric)
returns table (period_id uuid, amount numeric, cover boolean, review boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_aw boolean;
  v_left numeric := round(p_amount, 2);
  v_p record;
  v_remain numeric;
  v_charge numeric;
  v_any boolean := false;
  v_cover uuid;
begin
  if v_left <= 0 then
    return;
  end if;
  select f.parent_folder_id is not null into v_aw from folders f where f.id = p_folder and f.owner_id = p_owner;
  if v_aw is null then
    raise exception 'BAD_PROJECT' using errcode = 'P0001';
  end if;

  -- Additional Works: its own period, in full, no monthly cap, never Cover (Q24).
  if v_aw then
    select p.id into v_cover
      from projects p
     where p.folder_id = p_folder and p.owner_id = p_owner
     order by (pur_month_no(p.month) = extract(month from p_date)::int and p.year = extract(year from p_date)::int) desc nulls last,
              p.year desc nulls last, pur_month_no(p.month) desc nulls last, p.billing_number desc nulls last, p.created_at desc, p.id
     limit 1;
    if v_cover is null then
      raise exception 'AW_NO_PERIOD' using errcode = 'P0001';
    end if;
    return query select v_cover, v_left, false, false;
    return;
  end if;

  -- Main Contract: this month's client periods, earliest billing number first.
  for v_p in
    select p.id
      from projects p
      join project_budgets b on b.project_id = p.id and b.owner_id = p_owner
     where p.folder_id = p_folder
       and p.owner_id = p_owner
       and coalesce(p.funding_type, 'progress') <> 'president'
       and b.monthly_budget > 0
       and pur_month_no(p.month) = extract(month from p_date)::int
       and p.year = extract(year from p_date)::int
     order by p.billing_number nulls last, p.created_at, p.id
  loop
    v_any := true;
    exit when v_left <= 0;
    v_remain := pur_period_remaining(v_p.id);
    if v_remain > 0 then
      v_charge := least(v_remain, v_left);
      v_left := v_left - v_charge;
      return query select v_p.id, v_charge, false, false;
    end if;
  end loop;

  -- Shortage → Cover. No Cover period and no period in the purchase month →
  -- the project itself (period null), never another month's client period.
  if v_left > 0 then
    v_cover := pur_cover_period(p_owner, p_folder, p_date);
    return query select v_cover, v_left, true, not v_any;
  end if;
end;
$$;

-- ════ 5. Validating and writing a purchase ═══════════════════════════

-- Split a total across weights to the centavo (largest remainder): every
-- share is first rounded DOWN, then the centavos left over go one each to
-- the shares with the biggest remainders (the earliest line on a tie). No
-- share is ever negative, and the shares always add up to the total.
create or replace function pur_prorate(p_total numeric, p_weights numeric[]) returns numeric[]
language plpgsql immutable as $$
declare
  v_n int := coalesce(array_length(p_weights, 1), 0);
  v_sum numeric := 0;
  v_out numeric[] := '{}';
  v_cents int;
  r record;
  i int;
begin
  if v_n = 0 then
    return v_out;
  end if;
  for i in 1 .. v_n loop
    v_sum := v_sum + greatest(p_weights[i], 0);
  end loop;
  if v_sum <= 0 then
    -- No weights: equal shares.
    return pur_prorate(p_total, array_fill(1::numeric, array[v_n]));
  end if;
  for i in 1 .. v_n loop
    v_out := v_out || (floor(p_total * greatest(p_weights[i], 0) / v_sum * 100) / 100);
  end loop;
  v_cents := round((p_total - (select sum(x) from unnest(v_out) x)) * 100)::int;
  for r in
    select i2 as idx
      from generate_series(1, v_n) i2
     order by (p_total * greatest(p_weights[i2], 0) / v_sum * 100) - floor(p_total * greatest(p_weights[i2], 0) / v_sum * 100) desc, i2
     limit v_cents
  loop
    v_out[r.idx] := v_out[r.idx] + 0.01;
  end loop;
  return v_out;
end;
$$;

-- A peso amount from the request: a number with at most two decimals and
-- not negative, else null (the caller refuses it).
create or replace function pur_money(p text) returns numeric
language plpgsql immutable as $$
begin
  if p is null or btrim(p) !~ '^\d+(\.\d{1,2})?$' then
    return null;
  end if;
  return btrim(p)::numeric;
end;
$$;

-- A quantity from the request: a plain number with at most three decimals,
-- not negative (no NaN, Infinity or exponent), else null (the caller refuses it).
create or replace function pur_qty(p text) returns numeric
language plpgsql immutable as $$
begin
  if p is null or btrim(p) !~ '^\d+(\.\d{1,3})?$' then
    return null;
  end if;
  return btrim(p)::numeric;
end;
$$;

-- Who may call: an active owner or staff account (0094) allowed the
-- Expenses section — an account focused on other sections (allowed_modules,
-- e.g. admin-pm@ = ["pm"]) is refused, like the AI gate (0095). Phone
-- purchasing ('workmate') needs the Buyer switch, which arrives in 2A-2:
-- until then it is refused for everyone. Returns the data owner.
create or replace function pur_actor_owner(p_source text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_mods jsonb;
begin
  if auth.uid() is null or not pr_is_office() then
    raise exception 'NOT_OFFICE' using errcode = 'P0001';
  end if;
  select p.allowed_modules into v_mods from profiles p where p.id = auth.uid();
  if jsonb_typeof(v_mods) = 'array' and jsonb_array_length(v_mods) > 0 and not (v_mods ? 'expenses') then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if coalesce(p_source, 'expenses_form') = 'workmate' then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

-- Validate a purchase body and store its lines and charges. Writes no
-- expense rows (pur_charge_rows does).
create or replace function pur_store(p_owner uuid, p_purchase uuid, p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lines jsonb := coalesce(p_body -> 'lines', '[]'::jsonb);
  v_charges jsonb := coalesce(p_body -> 'charges', '[]'::jsonb);
  v_line jsonb;
  v_charge jsonb;
  v_share jsonb;
  v_dest text;
  v_folder uuid;
  v_folder_name text;
  v_amount numeric;
  v_qty numeric;
  v_min numeric;
  v_id uuid;
  v_line_ids uuid[] := '{}';
  v_line_gross numeric[] := '{}';
  v_gross numeric := 0;
  v_fees numeric := 0;
  v_discounts numeric := 0;
  v_shares numeric[];
  v_no int;
  n int := 0;
  c int := 0;
  k int;
begin
  if jsonb_typeof(v_lines) is distinct from 'array' or jsonb_array_length(v_lines) not between 1 and 50 then
    raise exception 'BAD_LINES' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_charges) is distinct from 'array' or jsonb_array_length(v_charges) > 10 then
    raise exception 'BAD_CHARGES' using errcode = 'P0001';
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    n := n + 1;
    v_dest := coalesce(v_line ->> 'destination', 'project');
    v_folder := pur_uuid(v_line ->> 'folder_id');
    if coalesce(btrim(v_line ->> 'folder_id'), '') <> '' and v_folder is null then
      raise exception 'BAD_PROJECT' using errcode = 'P0001';
    end if;
    v_amount := pur_money(v_line ->> 'amount');
    v_qty := case when v_line ->> 'quantity' is null then 1 else pur_qty(v_line ->> 'quantity') end;
    v_min := case when v_line ->> 'min_stock' is null then 0 else pur_qty(v_line ->> 'min_stock') end;
    if v_amount is null then
      raise exception 'BAD_AMOUNT' using errcode = 'P0001';
    end if;
    if v_line -> 'in_inventory' is not null and jsonb_typeof(v_line -> 'in_inventory') not in ('boolean', 'null') then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
    if v_qty is null or v_min is null or v_qty <= 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'P0001';
    end if;
    if char_length(btrim(coalesce(v_line ->> 'item_name', ''))) not between 1 and 200 then
      raise exception 'BAD_NAME' using errcode = 'P0001';
    end if;
    v_folder_name := '';
    if v_dest = 'project' then
      -- The project must belong to this company.
      select f.name into v_folder_name from folders f where f.id = v_folder and f.owner_id = p_owner;
      if v_folder is null or v_folder_name is null then
        raise exception 'BAD_PROJECT' using errcode = 'P0001';
      end if;
      -- Completion is stamped on the main project: an Additional Works job
      -- under a completed project is locked too.
      if not is_owner() and exists (select 1 from folders f
                                     left join folders par on par.id = f.parent_folder_id
                                    where f.id = v_folder
                                      and (f.completed_at is not null or par.completed_at is not null)) then
        raise exception 'COMPLETED_PROJECT' using errcode = 'P0001';
      end if;
    elsif v_dest = 'warehouse' then
      if v_folder is not null then
        raise exception 'BAD_PROJECT' using errcode = 'P0001';
      end if;
    else
      raise exception 'BAD_DESTINATION' using errcode = 'P0001';
    end if;
    insert into purchase_lines (owner_id, purchase_id, line_no, destination, folder_id, folder_name, item_name, category,
                                quantity, unit, gross_amount, in_inventory, min_stock)
    values (p_owner, p_purchase, n, v_dest, v_folder, coalesce(v_folder_name, ''), btrim(v_line ->> 'item_name'),
            btrim(coalesce(v_line ->> 'category', '')), v_qty, btrim(coalesce(v_line ->> 'unit', '')), v_amount,
            coalesce((v_line ->> 'in_inventory')::boolean, false), v_min)
    returning id into v_id;
    v_line_ids := v_line_ids || v_id;
    v_line_gross := v_line_gross || v_amount;
    v_gross := v_gross + v_amount;
  end loop;

  for v_charge in select value from jsonb_array_elements(v_charges) loop
    c := c + 1;
    v_amount := pur_money(v_charge ->> 'amount');
    if v_amount is null or v_amount = 0 then
      raise exception 'BAD_AMOUNT' using errcode = 'P0001';
    end if;
    if coalesce(v_charge ->> 'kind', '') not in ('delivery_fee', 'discount') then
      raise exception 'BAD_CHARGES' using errcode = 'P0001';
    end if;
    insert into purchase_charges (owner_id, purchase_id, charge_no, kind, amount)
    values (p_owner, p_purchase, c, v_charge ->> 'kind', v_amount)
    returning id into v_id;
    if v_charge ->> 'kind' = 'delivery_fee' then
      v_fees := v_fees + v_amount;
    else
      v_discounts := v_discounts + v_amount;
    end if;

    -- Shares: given by line number, or by default in proportion to the
    -- lines' item amounts (Q4). They must add up to the charge exactly.
    if jsonb_typeof(v_charge -> 'shares') = 'array' and jsonb_array_length(v_charge -> 'shares') > 0 then
      v_shares := array_fill(0::numeric, array[n]);
      for v_share in select value from jsonb_array_elements(v_charge -> 'shares') loop
        v_no := case when (v_share ->> 'line') ~ '^\d{1,3}$' then (v_share ->> 'line')::int end;
        if v_no is null or v_no not between 1 and n or pur_money(v_share ->> 'amount') is null then
          raise exception 'SPLIT_MISMATCH' using errcode = 'P0001';
        end if;
        v_shares[v_no] := v_shares[v_no] + pur_money(v_share ->> 'amount');
      end loop;
    else
      v_shares := pur_prorate(v_amount, v_line_gross);
    end if;
    if (select sum(x) from unnest(v_shares) x) is distinct from v_amount
       or exists (select 1 from unnest(v_shares) x where x < 0) then
      raise exception 'SPLIT_MISMATCH' using errcode = 'P0001';
    end if;
    for k in 1 .. n loop
      if v_shares[k] > 0 then
        insert into purchase_charge_shares (charge_id, line_id, amount) values (v_id, v_line_ids[k], v_shares[k]);
      end if;
    end loop;
    -- What was stored must equal the charge (never more, never less).
    if (select coalesce(sum(s.amount), 0) from purchase_charge_shares s where s.charge_id = v_id) <> v_amount then
      raise exception 'SPLIT_MISMATCH' using errcode = 'P0001';
    end if;
  end loop;

  -- A line's discounts can never exceed its item amount (no negative rows).
  if exists (select 1
               from purchase_lines l
               join purchase_charge_shares s on s.line_id = l.id
               join purchase_charges ch on ch.id = s.charge_id and ch.kind = 'discount'
              where l.purchase_id = p_purchase
              group by l.id, l.gross_amount
             having sum(s.amount) > l.gross_amount) then
    raise exception 'DISCOUNT_TOO_LARGE' using errcode = 'P0001';
  end if;

  -- Lines + fees − discounts must equal the receipt total.
  if v_gross + v_fees - v_discounts <> (select pu.receipt_total from purchases pu where pu.id = p_purchase) then
    raise exception 'TOTAL_MISMATCH' using errcode = 'P0001';
  end if;
end;
$$;

-- Write the expense rows for a stored purchase: each project line's net
-- amount (item amount − its discount shares), and each project's delivery-fee
-- share as its own "Delivery fee (share)" row, all funded by pur_fund. A row
-- with no period is tied to its project (folder_id). Warehouse lines and their
-- shares write nothing. Returns what was written.
create or replace function pur_charge_rows(p_purchase uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pu purchases;
  v_line record;
  v_fee record;
  v_split record;
  v_splits jsonb;
  v_n int;
  v_k int;
  v_first boolean := true;
  v_rows jsonb := '[]'::jsonb;
  v_review int[] := '{}';
begin
  select * into pu from purchases where id = p_purchase;

  for v_line in
    select l.*, l.gross_amount - coalesce((select sum(s.amount) from purchase_charge_shares s
                                             join purchase_charges c on c.id = s.charge_id and c.kind = 'discount'
                                            where s.line_id = l.id), 0) as net
      from purchase_lines l
     where l.purchase_id = p_purchase and l.destination = 'project'
     order by l.line_no
  loop
    select coalesce(jsonb_agg(jsonb_build_object('period_id', f.period_id, 'amount', f.amount, 'cover', f.cover,
                                                 'review', f.review) order by f.n), '[]'::jsonb) into v_splits
      from pur_fund(pu.owner_id, v_line.folder_id, pu.purchase_date, v_line.net) with ordinality f(period_id, amount, cover, review, n);
    v_n := jsonb_array_length(v_splits);
    v_k := 0;
    for v_split in select * from jsonb_to_recordset(v_splits) as x(period_id uuid, amount numeric, cover boolean, review boolean) loop
      v_k := v_k + 1;
      insert into expenses (owner_id, project_id, folder_id, expense_name, category, quantity, amount, date_time, notes,
                            payment_method, in_inventory, cover_expense, split_group, split_index, split_total,
                            po_image_url, delivery_receipt_url, supplier_invoice_url, payment_receipt_url,
                            purchase_line_id)
      values (pu.owner_id, v_split.period_id, case when v_split.period_id is null then v_line.folder_id end,
              v_line.item_name || case when v_n > 1 then ' (' || v_k || '/' || v_n || ')' else '' end,
              v_line.category, case when v_n > 1 then 1 else v_line.quantity end, v_split.amount, pu.date_time,
              pu.notes, pu.payment_method, v_line.in_inventory, v_split.cover,
              case when v_n > 1 then 'purchase:' || p_purchase || ':' || v_line.line_no end,
              case when v_n > 1 then v_k end, case when v_n > 1 then v_n end,
              case when v_first then pu.docs ->> 'po_image_url' end,
              case when v_first then pu.docs ->> 'delivery_receipt_url' end,
              case when v_first then pu.docs ->> 'supplier_invoice_url' end,
              case when v_first then pu.docs ->> 'payment_receipt_url' end,
              v_line.id);
      v_first := false;
      if v_split.review then v_review := v_review || v_line.line_no; end if;
      v_rows := v_rows || jsonb_build_object('line', v_line.line_no, 'period_id', v_split.period_id,
                                             'amount', v_split.amount, 'cover', v_split.cover);
    end loop;
    update purchase_lines set needs_funding_review = (v_line.line_no = any (v_review)) where id = v_line.id;
  end loop;

  -- Delivery fees: one share per project folder, funded like any amount.
  for v_fee in
    select c.id as charge_id, l.folder_id, sum(s.amount) as amount,
           (select l2.category from purchase_lines l2
             where l2.purchase_id = p_purchase and l2.folder_id = l.folder_id
             order by l2.gross_amount desc, l2.line_no limit 1) as category
      from purchase_charges c
      join purchase_charge_shares s on s.charge_id = c.id
      join purchase_lines l on l.id = s.line_id and l.destination = 'project'
     where c.purchase_id = p_purchase and c.kind = 'delivery_fee'
     group by c.id, c.charge_no, l.folder_id
     order by c.charge_no, l.folder_id
  loop
    select coalesce(jsonb_agg(jsonb_build_object('period_id', f.period_id, 'amount', f.amount, 'cover', f.cover,
                                                 'review', f.review) order by f.n), '[]'::jsonb) into v_splits
      from pur_fund(pu.owner_id, v_fee.folder_id, pu.purchase_date, v_fee.amount) with ordinality f(period_id, amount, cover, review, n);
    v_n := jsonb_array_length(v_splits);
    v_k := 0;
    for v_split in select * from jsonb_to_recordset(v_splits) as x(period_id uuid, amount numeric, cover boolean, review boolean) loop
      v_k := v_k + 1;
      insert into expenses (owner_id, project_id, folder_id, expense_name, category, quantity, amount, date_time, notes,
                            payment_method, cover_expense, split_group, split_index, split_total, purchase_charge_id)
      values (pu.owner_id, v_split.period_id, case when v_split.period_id is null then v_fee.folder_id end,
              'Delivery fee (share)' || case when v_n > 1 then ' (' || v_k || '/' || v_n || ')' else '' end,
              coalesce(v_fee.category, ''), 1, v_split.amount, pu.date_time, pu.notes, pu.payment_method, v_split.cover,
              case when v_n > 1 then 'purchase-fee:' || v_fee.charge_id || ':' || v_fee.folder_id end,
              case when v_n > 1 then v_k end, case when v_n > 1 then v_n end, v_fee.charge_id);
      v_rows := v_rows || jsonb_build_object('fee', true, 'period_id', v_split.period_id,
                                             'amount', v_split.amount, 'cover', v_split.cover);
    end loop;
  end loop;

  return jsonb_build_object('purchase_id', p_purchase, 'rows', v_rows, 'needs_review', to_jsonb(v_review));
end;
$$;

-- Remove a purchase's expense rows (correction, re-fund, void).
create or replace function pur_clear_rows(p_purchase uuid) returns void
language sql security definer set search_path = public as $$
  delete from expenses e
   where e.purchase_line_id in (select id from purchase_lines where purchase_id = p_purchase)
      or e.purchase_charge_id in (select id from purchase_charges where purchase_id = p_purchase)
$$;

-- Add each "track in inventory" line's quantity to stock, once per line
-- (purchase_stock_moves' primary key refuses a second move). The first stock
-- item of this company with exactly this name, else a new one. The caller
-- holds the item's lock (pur_lock 'pur_stock:').
create or replace function pur_move_stock(p_purchase uuid, p_actor uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_line record;
  v_inv uuid;
  v_moved int := 0;
begin
  for v_line in
    select l.*, pu.notes from purchase_lines l join purchases pu on pu.id = l.purchase_id
     where l.purchase_id = p_purchase and l.in_inventory order by l.line_no
  loop
    continue when exists (select 1 from purchase_stock_moves m where m.line_id = v_line.id);
    -- Within the company: its own items first, else an unowned one (the old
    -- browser mirror wrote items with no owner). Never another company's.
    select i.id into v_inv from inventory i
     where i.item_name = v_line.item_name and (i.owner_id = v_line.owner_id or i.owner_id is null)
     order by (i.owner_id = v_line.owner_id) desc nulls last, i.created_at, i.id limit 1;
    if v_inv is null then
      insert into inventory (owner_id, item_name, unit, current_stock, min_stock, notes, last_updated, last_adjusted_by, created_at)
      values (v_line.owner_id, v_line.item_name, coalesce(nullif(v_line.unit, ''), 'pcs'), 0, v_line.min_stock,
              nullif(v_line.notes, ''), now(), p_actor, now())
      returning id into v_inv;
    end if;
    insert into purchase_stock_moves (line_id, inventory_id, quantity) values (v_line.id, v_inv, v_line.quantity)
    on conflict (line_id) do nothing;
    if found then
      update inventory set current_stock = coalesce(current_stock, 0) + v_line.quantity,
                           last_updated = now(), last_adjusted_by = p_actor
       where id = v_inv;
      v_moved := v_moved + 1;
    end if;
  end loop;
  return v_moved;
end;
$$;

-- The purchase as stored, for history and for the office's edit form.
create or replace function pur_doc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', pu.id, 'status', pu.status, 'source', pu.source, 'purchase_date', pu.purchase_date,
    'date_time', pu.date_time, 'supplier', pu.supplier, 'receipt_total', pu.receipt_total, 'notes', pu.notes,
    'payment_method', pu.payment_method, 'docs', pu.docs,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'line', l.line_no, 'destination', l.destination, 'folder_id', l.folder_id, 'folder_name', l.folder_name,
                'item_name', l.item_name, 'category', l.category, 'quantity', l.quantity, 'unit', l.unit,
                'amount', l.gross_amount, 'in_inventory', l.in_inventory, 'min_stock', l.min_stock,
                'needs_funding_review', l.needs_funding_review) order by l.line_no), '[]'::jsonb)
                from purchase_lines l where l.purchase_id = pu.id),
    'charges', (select coalesce(jsonb_agg(jsonb_build_object(
                  'kind', c.kind, 'amount', c.amount,
                  'shares', (select coalesce(jsonb_agg(jsonb_build_object('line', l.line_no, 'amount', s.amount) order by l.line_no), '[]'::jsonb)
                               from purchase_charge_shares s join purchase_lines l on l.id = s.line_id where s.charge_id = c.id))
                  order by c.charge_no), '[]'::jsonb)
                  from purchase_charges c where c.purchase_id = pu.id))
  from purchases pu where pu.id = p_purchase
$$;

-- Header fields shared by record and correct.
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
  if coalesce(p_body ->> 'source', 'expenses_form') not in ('expenses_form', 'workmate') then
    raise exception 'BAD_SOURCE' using errcode = 'P0001';
  end if;
end;
$$;

-- The answer already given to this operation, if any — read AFTER taking the
-- operation's lock, so an overlapping second call waits and gets the same,
-- with "replayed": true added.
create or replace function pur_op_begin(p_op uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prev jsonb;
begin
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pur_op:' || auth.uid() || ':' || p_op, 0));
  select o.result into v_prev from pur_ops o where o.actor_id = auth.uid() and o.op_id = p_op;
  if v_prev is null then
    return null;
  end if;
  -- Marked, so the caller can tell the user that a form edited before the
  -- retry was NOT saved — this is the first press's answer.
  return v_prev || jsonb_build_object('replayed', true);
end;
$$;

-- Changes to ONE purchase are taken one at a time, and this lock comes
-- BEFORE its projects are read: a second correction waits here, then reads
-- the projects the first one left — never a stale list.
create or replace function pur_purchase_lock(p_purchase uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('pur_purchase:' || p_purchase, 0));
end;
$$;

-- A recorded purchase of this company, locked; staff refused on a completed
-- project or an Additional Works job under one (the main owner may).
create or replace function pur_open(p_owner uuid, p_purchase uuid) returns purchases
language plpgsql security definer set search_path = public as $$
declare pu purchases;
begin
  select * into pu from purchases where id = p_purchase and owner_id = p_owner for update;
  if pu.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if pu.status <> 'recorded' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if not is_owner() and exists (select 1 from purchase_lines l join folders f on f.id = l.folder_id
                                  left join folders par on par.id = f.parent_folder_id
                                 where l.purchase_id = p_purchase
                                   and (f.completed_at is not null or par.completed_at is not null)) then
    raise exception 'COMPLETED_PROJECT' using errcode = 'P0001';
  end if;
  return pu;
end;
$$;

-- ════ 6. The operations ══════════════════════════════════════════════

-- Record a purchase once. p_body: purchase_date (YYYY-MM-DD, the ACTUAL
-- purchase date), date_time, supplier, receipt_total, notes, payment_method,
-- source, docs {po_image_url, delivery_receipt_url, supplier_invoice_url,
-- payment_receipt_url}, lines [{destination, folder_id, item_name, category,
-- quantity, unit, amount, in_inventory, min_stock}], charges [{kind, amount,
-- shares [{line, amount}]}]. Returns {purchase_id, rows, needs_review, stock_moves}.
create or replace function pur_record(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_header_ok(p_body);
  perform pur_lock(pur_body_keys(p_body));
  perform set_config('dacs.purchase_write', 'on', true);
  v_result := pur_insert(v_owner, v_uid, p_body, null);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'record', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- Insert a purchase, its lines, charges and expense rows, and move its stock.
-- p_carry: stock already moved by a purchase this one replaces —
-- [{line_no, item_name, inventory_id, quantity}]; the old moves of an item are
-- paired in line order with the new lines of that item, which take them over
-- instead of moving stock again (unpaired new lines move stock as usual). Callers hold every lock and the guard.
create or replace function pur_insert(p_owner uuid, p_actor uuid, p_body jsonb, p_carry jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_result jsonb;
begin
  insert into purchases (owner_id, source, purchase_date, date_time, supplier, receipt_total, notes, payment_method, docs, recorded_by)
  values (p_owner, coalesce(p_body ->> 'source', 'expenses_form'), (p_body ->> 'purchase_date')::date,
          coalesce(nullif(p_body ->> 'date_time', ''), p_body ->> 'purchase_date'), btrim(coalesce(p_body ->> 'supplier', '')),
          pur_money(p_body ->> 'receipt_total'), btrim(coalesce(p_body ->> 'notes', '')),
          btrim(coalesce(p_body ->> 'payment_method', '')),
          coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
                     where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                       and jsonb_typeof(v) = 'string'), '{}'::jsonb),
          p_actor)
  returning id into v_id;

  perform pur_store(p_owner, v_id, p_body);
  -- Carried-over stock: the first new "track in inventory" line of the same
  -- item takes the old move over (no stock change). Nothing is ever moved twice.
  insert into purchase_stock_moves (line_id, inventory_id, quantity)
  select l.id, c.inventory_id, c.quantity
    from (select k.*, row_number() over (partition by lower(k.item_name) order by k.line_no) rn
            from jsonb_to_recordset(coalesce(p_carry, '[]'::jsonb)) as k(line_no int, item_name text, inventory_id uuid, quantity numeric)) c
    join (select x.*, row_number() over (partition by lower(x.item_name) order by x.line_no) rn
            from purchase_lines x where x.purchase_id = v_id and x.in_inventory) l
      on lower(l.item_name) = lower(c.item_name) and l.rn = c.rn
  on conflict (line_id) do nothing;
  v_result := pur_charge_rows(v_id) || jsonb_build_object('stock_moves', pur_move_stock(v_id, p_actor));
  insert into purchase_history (owner_id, purchase_id, kind, after, actor_id)
  values (p_owner, v_id, 'recorded', pur_doc(v_id), p_actor);
  return v_result;
end;
$$;

-- Correct a recorded purchase: p_body has the same shape as pur_record and
-- the SAME number of lines (to add or drop a line, void and record again).
-- Funding is recomputed and the purchase's expense rows replaced in one
-- transaction; history keeps the content before and after. Stock already
-- moved is not moved again (a stock correction belongs to Stage 2B). Moving
-- a line to another project, or touching a COMPLETED project, is
-- main-owner only.
create or replace function pur_correct(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_old_folders uuid[];
  v_moves jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_header_ok(p_body);
  -- This purchase first, then its CURRENT projects and the new ones together.
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase) || pur_body_keys(p_body));
  pu := pur_open(v_owner, p_purchase);
  if jsonb_array_length(coalesce(p_body -> 'lines', '[]'::jsonb))
     <> (select count(*) from purchase_lines where purchase_id = p_purchase) then
    raise exception 'LINES_CHANGED' using errcode = 'P0001';
  end if;
  select array_agg(l.folder_id order by l.line_no) into v_old_folders from purchase_lines l where l.purchase_id = p_purchase;
  if not is_owner() and exists (select 1
                                  from jsonb_array_elements(p_body -> 'lines') with ordinality n(v, i)
                                 where pur_uuid(n.v ->> 'folder_id') is distinct from v_old_folders[n.i]) then
    raise exception 'OWNER_APPROVAL_NEEDED' using errcode = 'P0001';
  end if;

  v_before := pur_doc(p_purchase);
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  -- Stock already moved stays moved: the new lines take over the move records.
  select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'inventory_id', m.inventory_id,
                                               'quantity', m.quantity, 'moved_at', m.moved_at)), '[]'::jsonb)
    into v_moves
    from purchase_stock_moves m join purchase_lines l on l.id = m.line_id where l.purchase_id = p_purchase;
  delete from purchase_stock_moves m using purchase_lines l where l.id = m.line_id and l.purchase_id = p_purchase;
  delete from purchase_charge_shares s using purchase_charges c where c.id = s.charge_id and c.purchase_id = p_purchase;
  delete from purchase_charges where purchase_id = p_purchase;
  delete from purchase_lines where purchase_id = p_purchase;

  update purchases set
    purchase_date = (p_body ->> 'purchase_date')::date,
    date_time = coalesce(nullif(p_body ->> 'date_time', ''), p_body ->> 'purchase_date'),
    supplier = btrim(coalesce(p_body ->> 'supplier', '')),
    receipt_total = pur_money(p_body ->> 'receipt_total'),
    notes = btrim(coalesce(p_body ->> 'notes', '')),
    payment_method = btrim(coalesce(p_body ->> 'payment_method', '')),
    docs = docs || coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
                              where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                                and jsonb_typeof(v) = 'string'), '{}'::jsonb),
    updated_at = now()
  where id = p_purchase;

  perform pur_store(v_owner, p_purchase, p_body);
  insert into purchase_stock_moves (line_id, inventory_id, quantity, moved_at)
  select l.id, k.inventory_id, k.quantity, k.moved_at
    from jsonb_to_recordset(v_moves) as k(line_no int, inventory_id uuid, quantity numeric, moved_at timestamptz)
    join purchase_lines l on l.purchase_id = p_purchase and l.line_no = k.line_no;
  v_result := pur_charge_rows(p_purchase);
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'corrected', btrim(p_reason), v_before, pur_doc(p_purchase), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'correct', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- Replace a purchase with a new version that may have a different number of
-- lines (R8): the old one is voided and the new one recorded in ONE
-- transaction. Stock the old one already moved is carried over to the new
-- lines of the same item — so replacing never adds stock twice. Same rules as
-- a correction: reason required; staff cannot touch a completed project or
-- move costs to another project (owner-only).
create or replace function pur_replace(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_carry jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_header_ok(p_body);
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase) || pur_body_keys(p_body));
  pu := pur_open(v_owner, p_purchase);
  if not is_owner() and exists (
      select 1 from jsonb_array_elements(p_body -> 'lines') n(v)
       where not exists (select 1 from purchase_lines l
                          where l.purchase_id = p_purchase
                            and l.destination = coalesce(n.v ->> 'destination', 'project')
                            and l.folder_id is not distinct from pur_uuid(n.v ->> 'folder_id'))) then
    raise exception 'OWNER_APPROVAL_NEEDED' using errcode = 'P0001';
  end if;

  v_before := pur_doc(p_purchase);
  select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'item_name', l.item_name, 'inventory_id', m.inventory_id, 'quantity', m.quantity)), '[]'::jsonb)
    into v_carry
    from purchase_stock_moves m join purchase_lines l on l.id = m.line_id where l.purchase_id = p_purchase;
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  delete from purchase_stock_moves m using purchase_lines l where l.id = m.line_id and l.purchase_id = p_purchase;
  v_result := pur_insert(v_owner, v_uid, p_body, v_carry);
  update purchases set status = 'void', replaced_by = (v_result ->> 'purchase_id')::uuid, updated_at = now() where id = p_purchase;
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'replaced', btrim(p_reason), v_before, jsonb_build_object('replaced_by', v_result ->> 'purchase_id'), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'replace', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- Re-fund a recorded purchase as it stands — e.g. after the office added the
-- billing period a "No billing period" line was waiting for. Same purchase
-- date, same amounts: only where the pesos are charged can change, and the
-- total in Spent stays the same (the old rows are replaced, never added to).
create or replace function pur_refund(p_op uuid, p_purchase uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner('expenses_form');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase));
  pu := pur_open(v_owner, p_purchase);
  v_before := pur_doc(p_purchase);
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  v_result := pur_charge_rows(p_purchase);
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'refunded', btrim(p_reason), v_before, pur_doc(p_purchase), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'refund', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- Void a purchase: its expense rows leave Spent; the purchase, its lines,
-- receipt photos and history stay. A void does not claim goods were returned
-- or money refunded — those are recorded separately (stock is not taken back).
create or replace function pur_void(p_op uuid, p_purchase uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner('expenses_form');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase));
  pu := pur_open(v_owner, p_purchase);
  v_before := pur_doc(p_purchase);
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  update purchases set status = 'void', updated_at = now() where id = p_purchase;
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, actor_id)
  values (v_owner, p_purchase, 'voided', btrim(p_reason), v_before, v_uid);
  v_result := jsonb_build_object('purchase_id', p_purchase, 'status', 'void');
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'void', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- ════ 7. Permissions ═════════════════════════════════════════════════

revoke all on function pur_record(uuid, jsonb) from public, anon;
grant execute on function pur_record(uuid, jsonb) to authenticated;
revoke all on function pur_correct(uuid, uuid, jsonb, text) from public, anon;
grant execute on function pur_correct(uuid, uuid, jsonb, text) to authenticated;
revoke all on function pur_refund(uuid, uuid, text) from public, anon;
grant execute on function pur_refund(uuid, uuid, text) to authenticated;
revoke all on function pur_replace(uuid, uuid, jsonb, text) from public, anon;
grant execute on function pur_replace(uuid, uuid, jsonb, text) to authenticated;
revoke all on function pur_live_purchases(uuid, uuid) from public, anon;
grant execute on function pur_live_purchases(uuid, uuid) to authenticated;
-- A boolean about the caller only; the read policies need to call it.
revoke all on function pur_reader() from public, anon;
grant execute on function pur_reader() to authenticated;
revoke all on function pur_void(uuid, uuid, text) from public, anon;
grant execute on function pur_void(uuid, uuid, text) to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function pur_lock(text[]) from public, anon, authenticated;
revoke all on function pur_body_keys(jsonb) from public, anon, authenticated;
revoke all on function pur_stored_keys(uuid) from public, anon, authenticated;
revoke all on function pur_month_no(text) from public, anon, authenticated;
revoke all on function pur_period_remaining(uuid) from public, anon, authenticated;
revoke all on function pur_cover_period(uuid, uuid, date) from public, anon, authenticated;
revoke all on function pur_fund(uuid, uuid, date, numeric) from public, anon, authenticated;
revoke all on function pur_prorate(numeric, numeric[]) from public, anon, authenticated;
revoke all on function pur_money(text) from public, anon, authenticated;
revoke all on function pur_qty(text) from public, anon, authenticated;
revoke all on function pur_uuid(text) from public, anon, authenticated;
revoke all on function pur_actor_owner(text) from public, anon, authenticated;
revoke all on function pur_store(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_charge_rows(uuid) from public, anon, authenticated;
revoke all on function pur_clear_rows(uuid) from public, anon, authenticated;
revoke all on function pur_move_stock(uuid, uuid) from public, anon, authenticated;
revoke all on function pur_doc(uuid) from public, anon, authenticated;
revoke all on function pur_header_ok(jsonb) from public, anon, authenticated;
revoke all on function pur_op_begin(uuid) from public, anon, authenticated;
revoke all on function pur_open(uuid, uuid) from public, anon, authenticated;
revoke all on function pur_guard_expense_row() from public, anon, authenticated;
revoke all on function pur_guard_delete() from public, anon, authenticated;
revoke all on function pur_purchase_lock(uuid) from public, anon, authenticated;
revoke all on function pur_insert(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
