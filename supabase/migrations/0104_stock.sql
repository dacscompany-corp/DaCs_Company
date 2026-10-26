-- 0104 — WorkMate Stage 2B-a: stock on the server (quantities only).
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- (Warehouse cost assignment, §3.8); answers:
-- docs/superpowers/specs/2026-10-24-workmate-stage2bc-questions.md (all A);
-- plan: docs/superpowers/plans/2026-10-25-workmate-stage2b-a-stock.md.
--
-- ── 1. Where stock is (Q2). One company warehouse, and each Project
--    Control project's site (Main Contract or an Additional Works job) as a
--    place where goods can sit. Places are made the first time they are used.
--
-- ── 2. What is stock (Q3–Q5, Q9). Stock is counted in a CATALOGUE item's
--    unit, in LOTS: one lot per purchase line it came from (so every later
--    peso traces back to one receipt — Q12, priced in 2C), or an untraced
--    lot for old goods with no purchase in the system (Q13, worth ₱0 in 2C).
--    A purchase line becomes stock only once it is MATCHED to a catalogue
--    item: automatically when it is linked to a request line whose catalogue
--    item has the same unit, otherwise by the office ("To match"), which
--    says how many item units the line is (a different unit is the
--    office's check, never the buyer's own). Warehouse purchases are stock;
--    project purchases are taken as used by their project and become stock
--    only as recorded LEFTOVERS, whose lot keeps that project's cost.
--    Once stock uses a catalogue item (a match, a lot or a record), its kind
--    and unit are fixed, as 0092 fixes them once a request uses it — every
--    quantity already counted would otherwise change meaning.
--
-- ── 3. Receiving (Q6–Q7). A warehouse line is usable stock only as it is
--    received, in parts if need be; the rest is "Awaiting delivery" until
--    received or closed as NOT DELIVERED with a reason. Receipts are kept in
--    the purchase line's own unit and turned into item units by its match
--    (each new receipt = the converted total received less the item units
--    already assigned; a receipt's quantity never changes afterwards — so the
--    whole line adds up exactly, whatever the dates or the order of entry).
--
-- ── 4. Movements (Q8, Q10, Q11). Every action is one stk_records row; its
--    quantity effect is stk_moves rows. Goods are kept in LAYERS: each
--    delivery received (a part delivery is its own), each leftover record,
--    each confirmed opening stock and goods found by a count is one layer,
--    dated the day it entered stock; a layer travels with its goods. An
--    issue, a move or a loss takes the OLDEST RECEIVED layers first — never
--    by purchase date — unless staff names the lot the goods came from; the
--    lot is FIXED when the goods move (Q12). Issue = warehouse →
--    a project's site; return = back to the warehouse from one issue (the
--    same lots and layers); move = between sites, or a site's goods to the warehouse.
--    Goods entering a project fill a request line ("From stock") or are
--    unplanned with a reason. No reservations (Q9): only an issue counts.
--
-- ── 5. Requests. "Bought" in every capacity formula (pr_portion_bought,
--    pr_line_bought) now means COVERED: by recorded purchases and by live
--    stock records. So Still to buy, splitting, assigning and reducing a
--    request all count goods issued from stock, and Still to buy is never
--    negative. pr_portion_purchased / pr_line_purchased keep the purchases
--    alone (shown as "Bought"); *_from_stock the stock part.
--
-- ── 6. Counts and opening stock (Q13, Q27). A count that differs from the
--    books, and every opening count, wait for the MAIN OWNER. A count is
--    confirmed only while the books still read what they read when counted.
--
-- ── 7. Never edited (Q23). A mistaken record is REVERSED (reason kept,
--    never deleted); reversing is refused while the goods have moved on
--    (reverse those records first). A purchase line correction may not go
--    below what was received / entered as stock, nor change the unit,
--    destination or project of a line with stock (Q21); a purchase with live
--    stock records cannot be voided or replaced (Q22).
--
-- ── 8. Quantities only. No peso amount is read or written here: the value
--    of a lot and every cost move are Stage 2C (owner-confirmed). Nothing
--    here touches expenses, Spent, Earned or Profit.
--
-- ── 9. Dormant until launch. Every write is refused (STOCK_OFF) until the
--    main owner switches stock on for the company (2B + 2C launch together,
--    Q1). Once it is on, the old "Add to inventory" tickbox and the old
--    inventory table refuse writes (Q29).
--
-- Who: owner and office staff accounts allowed the Expenses section record
-- stock (Buyer staff are office staff); workers and team leaders never do.
-- Only the main owner switches stock on, confirms counts and opening stock,
-- and reverses them. Each call carries an operation id (pur_ops): a retry
-- returns the first answer. Locks: the purchase first, then items and
-- request lines in one sorted pass (pur_lock) — the same order as purchases.

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- The switch, one row per company that ever had it (main owner only).
create table if not exists stk_settings (
  owner_id uuid primary key references profiles(id),
  enabled boolean not null default false,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);

-- folder_id is history, not a foreign key (as purchase_lines.folder_id):
-- folder_name keeps what the project was called.
create table if not exists stk_locations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('warehouse', 'site')),
  folder_id uuid,
  folder_name text not null default '',
  created_at timestamptz not null default now(),
  check ((kind = 'site') = (folder_id is not null))
);
create unique index if not exists stk_locations_warehouse on stk_locations (owner_id) where kind = 'warehouse';
create unique index if not exists stk_locations_site on stk_locations (owner_id, folder_id) where kind = 'site';

-- How a purchase line counts as a catalogue item: `per` line units are
-- `covers` item units. Keyed by purchase and line number, which a
-- correction keeps (its lines are stored again with the same numbers).
create table if not exists stk_matches (
  purchase_id uuid not null references purchases(id),
  line_no int not null,
  owner_id uuid not null references profiles(id),
  item_id uuid not null references pr_catalog_items(id),
  line_unit text not null,
  per numeric(14,3) not null check (per > 0),
  covers numeric(14,3) not null check (covers > 0),
  auto boolean not null default false,
  note text not null default '' check (char_length(note) <= 300),
  matched_by uuid references profiles(id),
  matched_at timestamptz not null default now(),
  primary key (purchase_id, line_no)
);

-- A lot: the goods of one purchase line, or untraced old goods.
-- cost_folder_id: whose cost the goods are — null = the company's stock,
-- else that project's (leftovers). 2C moves cost; 2B-a never changes it.
create table if not exists stk_lots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  item_id uuid not null references pr_catalog_items(id),
  purchase_id uuid references purchases(id),
  line_no int,
  cost_folder_id uuid,
  untraced boolean not null default false,
  since date not null,                     -- purchase date (or the day counted), for display; issuing is by layer
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (purchase_id, line_no),
  check ((purchase_id is null) = (line_no is null)),
  check (untraced = (purchase_id is null)),
  check (not untraced or cost_folder_id is null)
);
create index if not exists stk_lots_item on stk_lots (owner_id, item_id);

-- One action. quantity: item units — except receive / not_delivered, in the
-- purchase line's unit; for a count, the quantity counted (book_quantity =
-- what the books said). Live = status 'done' and not reversed.
create table if not exists stk_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('receive', 'not_delivered', 'leftover', 'issue', 'return', 'move', 'count', 'opening')),
  status text not null default 'done' check (status in ('done', 'pending', 'rejected', 'withdrawn')),
  item_id uuid references pr_catalog_items(id),
  purchase_id uuid references purchases(id),
  line_no int,
  from_location uuid references stk_locations(id),
  to_location uuid references stk_locations(id),
  quantity numeric(14,3) not null check (quantity >= 0),
  book_quantity numeric(14,3),
  lot_id uuid references stk_lots(id),
  on_date date not null,
  request_line_id uuid references pr_lines(id),
  unplanned_reason text not null default '' check (char_length(unplanned_reason) <= 300),
  returns_record uuid references stk_records(id),
  reason text not null default '' check (char_length(reason) <= 500),
  note text not null default '' check (char_length(note) <= 300),
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default now(),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  reversed_by uuid references profiles(id),
  reversed_at timestamptz,
  reverse_reason text not null default '' check (char_length(reverse_reason) <= 500),
  check ((purchase_id is null) = (line_no is null)),
  check (kind not in ('receive', 'not_delivered', 'leftover') or purchase_id is not null),
  check (kind in ('receive', 'not_delivered') or item_id is not null),
  check (kind <> 'return' or returns_record is not null),
  check (reversed_at is null or status = 'done')
);
create index if not exists stk_records_owner on stk_records (owner_id, recorded_at desc);
create index if not exists stk_records_line on stk_records (purchase_id, line_no) where purchase_id is not null;
create index if not exists stk_records_item on stk_records (item_id, recorded_at desc) where item_id is not null;
create index if not exists stk_records_returns on stk_records (returns_record) where returns_record is not null;

-- The quantity a record moved, per lot and layer. from null = enters stock
-- (its layer is its own record: the receipt, leftover, opening or count);
-- to null = leaves stock (a confirmed loss). layer = the record that brought
-- these goods into stock — its on_date is the day they were received.
create table if not exists stk_moves (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  record_id uuid not null references stk_records(id),
  lot_id uuid not null references stk_lots(id),
  layer uuid not null references stk_records(id),
  from_location uuid references stk_locations(id),
  to_location uuid references stk_locations(id),
  quantity numeric(14,3) not null check (quantity > 0),
  check (from_location is not null or to_location is not null),
  check (from_location is distinct from to_location),
  check (from_location is not null or layer = record_id)
);
create index if not exists stk_moves_record on stk_moves (record_id);
create index if not exists stk_moves_lot on stk_moves (lot_id, layer);

-- What goods entering a project filled on a request line ("From stock").
-- They count while their record is live; a portion the office later removes
-- keeps the request line, so the line's figures stay right.
create table if not exists stk_covers (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  record_id uuid not null references stk_records(id),
  request_line_id uuid not null references pr_lines(id),
  portion_id uuid references pr_line_portions(id) on delete set null,
  quantity numeric(14,3) not null check (quantity > 0)
);
create index if not exists stk_covers_portion on stk_covers (portion_id) where portion_id is not null;
create index if not exists stk_covers_request_line on stk_covers (request_line_id);
create index if not exists stk_covers_record on stk_covers (record_id);

-- Append-only: the switch, matches, decisions and reversals.
create table if not exists stk_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('switched', 'matched', 'unmatched', 'confirmed', 'rejected', 'withdrawn', 'reversed')),
  record_id uuid references stk_records(id),
  purchase_id uuid references purchases(id),
  line_no int,
  detail jsonb not null default '{}'::jsonb,
  reason text not null default '',
  actor_id uuid not null references profiles(id),
  at timestamptz not null default now()
);

create or replace function stk_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists stk_events_no_change on stk_events;
create trigger stk_events_no_change before update or delete on stk_events
  for each row execute function stk_events_immutable();
drop trigger if exists stk_moves_no_change on stk_moves;
create trigger stk_moves_no_change before update or delete on stk_moves
  for each row execute function stk_events_immutable();
drop trigger if exists stk_covers_no_change on stk_covers;
create trigger stk_covers_no_change before update or delete on stk_covers
  for each row execute function stk_events_immutable();

-- Every read and write goes through the functions below: no table policy.
alter table stk_settings enable row level security;
alter table stk_locations enable row level security;
alter table stk_matches enable row level security;
alter table stk_lots enable row level security;
alter table stk_records enable row level security;
alter table stk_moves enable row level security;
alter table stk_covers enable row level security;
alter table stk_events enable row level security;

-- ════ 2. Who, and the switch ═════════════════════════════════════════

create or replace function stk_on(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.enabled from stk_settings s where s.owner_id = p_owner), false)
$$;

-- May the caller record stock? An active owner or staff account allowed
-- the Expenses section (0096's rule for ordinary entry). A boolean about the
-- caller only.
create or replace function stk_can_record() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and pr_is_office() and coalesce((
    select jsonb_typeof(p.allowed_modules) is distinct from 'array'
           or jsonb_array_length(p.allowed_modules) = 0 or p.allowed_modules ? 'expenses'
      from profiles p where p.id = auth.uid()), false)
$$;

-- The caller's company, for a stock write: refused unless they may record
-- and stock is switched on there.
create or replace function stk_actor() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  if not stk_on(v_owner) then
    raise exception 'STOCK_OFF' using errcode = 'P0001';
  end if;
  return v_owner;
end;
$$;

-- What the screens need to know.
create or replace function stk_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_can boolean := stk_can_record();
begin
  return jsonb_build_object('enabled', v_can and stk_on(data_owner_id()), 'can_record', v_can,
                            'is_main_owner', pur_is_main_owner(),
                            'is_owner', auth.uid() is not null and coalesce(is_owner(), false), 'user_id', auth.uid());
end;
$$;

-- The main owner switches stock on (launch) or off for the company.
create or replace function stk_set_enabled(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  if p_on is null then
    raise exception 'BAD_SWITCH' using errcode = 'P0001';
  end if;
  insert into stk_settings (owner_id, enabled, updated_by, updated_at) values (v_owner, p_on, auth.uid(), now())
  on conflict (owner_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
   where stk_settings.enabled is distinct from excluded.enabled;
  if found then
    insert into stk_events (owner_id, kind, detail, actor_id) values (v_owner, 'switched', jsonb_build_object('enabled', p_on), auth.uid());
  end if;
  return jsonb_build_object('enabled', p_on);
end;
$$;

-- ════ 3. Places, lines, lots and balances ════════════════════════════

create or replace function stk_warehouse(p_owner uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from stk_locations where owner_id = p_owner and kind = 'warehouse';
  if v is null then
    insert into stk_locations (owner_id, kind) values (p_owner, 'warehouse')
    on conflict do nothing;
    select id into v from stk_locations where owner_id = p_owner and kind = 'warehouse';
  end if;
  return v;
end;
$$;

-- A project's site: a folder of this company (Main Contract or an
-- Additional Works job).
create or replace function stk_site(p_owner uuid, p_folder uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
  v_name text;
begin
  select f.name into v_name from folders f where f.id = p_folder and f.owner_id = p_owner;
  if v_name is null then
    raise exception 'BAD_PROJECT' using errcode = 'P0001';
  end if;
  select id into v from stk_locations where owner_id = p_owner and kind = 'site' and folder_id = p_folder;
  if v is null then
    insert into stk_locations (owner_id, kind, folder_id, folder_name) values (p_owner, 'site', p_folder, v_name)
    on conflict do nothing;
    select id into v from stk_locations where owner_id = p_owner and kind = 'site' and folder_id = p_folder;
  end if;
  return v;
end;
$$;

-- A place from request text: 'warehouse', or a project folder's id.
create or replace function stk_place(p_owner uuid, p text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(p), '') = 'warehouse' then
    return stk_warehouse(p_owner);
  end if;
  if pur_uuid(p) is null then
    raise exception 'BAD_LOCATION' using errcode = 'P0001';
  end if;
  return stk_site(p_owner, pur_uuid(p));
end;
$$;

-- A line of a RECORDED purchase of this company.
create or replace function stk_line(p_owner uuid, p_purchase uuid, p_line_no int) returns purchase_lines
language plpgsql stable security definer set search_path = public as $$
declare v purchase_lines;
begin
  select l.* into v from purchase_lines l join purchases pu on pu.id = l.purchase_id
   where l.purchase_id = p_purchase and l.line_no = p_line_no and pu.owner_id = p_owner and pu.status = 'recorded';
  if v.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- An active catalogue item of this company.
create or replace function stk_item_ok(p_owner uuid, p_item uuid) returns pr_catalog_items
language plpgsql stable security definer set search_path = public as $$
declare v pr_catalog_items;
begin
  select * into v from pr_catalog_items where id = p_item and owner_id = p_owner;
  if v.id is null then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- The same, for a write: the item's row is held (FOR SHARE) until the end of
-- the transaction, so its kind and unit cannot change under a stock write
-- (a catalogue save waits, then finds the item in use — ITEM_IN_USE).
create or replace function stk_item_lock(p_owner uuid, p_item uuid) returns pr_catalog_items
language plpgsql security definer set search_path = public as $$
declare v pr_catalog_items;
begin
  select * into v from pr_catalog_items where id = p_item and owner_id = p_owner for share;
  if v.id is null then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- Received / closed as not delivered, in the line's own unit (live records).
create or replace function stk_received(p_purchase uuid, p_line_no int, p_kind text default 'receive') returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.quantity), 0) from stk_records r
   where r.purchase_id = p_purchase and r.line_no = p_line_no and r.kind = p_kind
     and r.status = 'done' and r.reversed_at is null
$$;

-- Line units → item units, by the line's match (null = not matched).
create or replace function stk_conv(p_purchase uuid, p_line_no int, p_qty numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select round(p_qty * m.covers / m.per, 3) from stk_matches m where m.purchase_id = p_purchase and m.line_no = p_line_no
$$;

-- The match a line gets without the office: linked to a request line whose
-- catalogue item has the line's own unit, and not a substitute — one line
-- unit is one item unit.
create or replace function stk_auto_item(p_line purchase_lines) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from pr_lines rl join pr_catalog_items c on c.id = rl.catalog_item_id
   where rl.id = p_line.request_line_id and not p_line.substitute
     and lower(btrim(c.unit)) = lower(btrim(p_line.unit))
$$;

-- The line's match, made automatically when it can be; else TO_MATCH.
create or replace function stk_ensure_match(p_line purchase_lines) returns stk_matches
language plpgsql security definer set search_path = public as $$
declare
  v stk_matches;
  v_item uuid;
begin
  select * into v from stk_matches where purchase_id = p_line.purchase_id and line_no = p_line.line_no;
  if v.purchase_id is not null then
    return v;
  end if;
  v_item := stk_auto_item(p_line);
  if v_item is not null then
    -- Hold the item, then check its unit again as it stands now.
    perform 1 from pr_catalog_items where id = v_item for share;
    v_item := stk_auto_item(p_line);
  end if;
  if v_item is null then
    raise exception 'TO_MATCH' using errcode = 'P0001',
      hint = 'Match this purchase line to a catalogue item first (office).';
  end if;
  insert into stk_matches (purchase_id, line_no, owner_id, item_id, line_unit, per, covers, auto, matched_by)
  values (p_line.purchase_id, p_line.line_no, p_line.owner_id, v_item, lower(btrim(p_line.unit)), 1, 1, true, auth.uid())
  returning * into v;
  insert into stk_events (owner_id, kind, purchase_id, line_no, detail, actor_id)
  values (p_line.owner_id, 'matched', p_line.purchase_id, p_line.line_no,
          jsonb_build_object('item_id', v_item, 'per', 1, 'covers', 1, 'auto', true), auth.uid());
  return v;
end;
$$;

-- The lot of a purchase line (made on first use; needs its match).
create or replace function stk_lot_for_line(p_line purchase_lines) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v uuid;
  m stk_matches := stk_ensure_match(p_line);
begin
  select id into v from stk_lots where purchase_id = p_line.purchase_id and line_no = p_line.line_no;
  if v is null then
    insert into stk_lots (owner_id, item_id, purchase_id, line_no, cost_folder_id, since, created_by)
    values (p_line.owner_id, m.item_id, p_line.purchase_id, p_line.line_no,
            case when p_line.destination = 'project' then p_line.folder_id end,
            (select purchase_date from purchases where id = p_line.purchase_id), auth.uid())
    returning id into v;
  end if;
  return v;
end;
$$;

-- The line's lot if it is matched, or can be automatically; else null.
create or replace function stk_try_lot(p_line purchase_lines) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from stk_matches where purchase_id = p_line.purchase_id and line_no = p_line.line_no)
     and stk_auto_item(p_line) is null then
    return null;
  end if;
  return stk_lot_for_line(p_line);
end;
$$;

-- A warehouse line's live receipts become stock, one layer each, once it
-- has a lot. A receipt already in stock keeps its quantity, always. Each new
-- one gets the converted total received (the receipts already in stock plus
-- this one, in line units) MINUS the item units already assigned to them —
-- whatever the receipt dates and whatever order they were entered in, so the
-- whole line adds up exactly (3 boxes = 100 pieces: 33.333, 33.334, 33.333),
-- and a reversed-then-received-again box brings it back to exactly 100.
-- Receipts made before the match are taken in the order received. The caller
-- holds the purchase's lock.
create or replace function stk_receipt_moves(p_line purchase_lines, p_lot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_received numeric;   -- line units of the live receipts already in stock
  v_assigned numeric;   -- the item units those receipts were given
  v_q numeric;
begin
  select coalesce(sum(x.quantity), 0), coalesce(sum(m.q), 0) into v_received, v_assigned
    from stk_records x
    join (select record_id, sum(quantity) as q from stk_moves group by record_id) m on m.record_id = x.id
   where x.purchase_id = p_line.purchase_id and x.line_no = p_line.line_no and x.kind = 'receive'
     and x.status = 'done' and x.reversed_at is null;
  for r in select x.* from stk_records x
            where x.purchase_id = p_line.purchase_id and x.line_no = p_line.line_no and x.kind = 'receive'
              and x.status = 'done' and x.reversed_at is null
              and not exists (select 1 from stk_moves m where m.record_id = x.id)
            order by x.on_date, x.recorded_at, x.id
  loop
    v_received := v_received + r.quantity;
    v_q := stk_conv(p_line.purchase_id, p_line.line_no, v_received) - v_assigned;
    continue when v_q is null or v_q <= 0;
    insert into stk_moves (owner_id, record_id, lot_id, layer, to_location, quantity)
    values (p_line.owner_id, r.id, p_lot, r.id, r.to_location, v_q);
    v_assigned := v_assigned + v_q;
  end loop;
end;
$$;

-- What a lot holds at a place: every live move in, minus every live move out.
create or replace function stk_balance(p_lot uuid, p_loc uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when m.to_location = p_loc then m.quantity else -m.quantity end), 0)
    from stk_moves m join stk_records r on r.id = m.record_id
   where m.lot_id = p_lot and (m.to_location = p_loc or m.from_location = p_loc)
     and r.status = 'done' and r.reversed_at is null
$$;

-- What one layer of a lot holds at a place.
create or replace function stk_layer_balance(p_lot uuid, p_layer uuid, p_loc uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when m.to_location = p_loc then m.quantity else -m.quantity end), 0)
    from stk_moves m join stk_records r on r.id = m.record_id
   where m.lot_id = p_lot and m.layer = p_layer and (m.to_location = p_loc or m.from_location = p_loc)
     and r.status = 'done' and r.reversed_at is null
$$;

-- Every non-zero layer of a company (optionally one item), with the day its
-- goods were received: lot, layer, received_on / received_at, place, quantity.
create or replace function stk_layers(p_owner uuid, p_item uuid default null)
returns table (lot_id uuid, layer uuid, received_on date, received_at timestamptz, location_id uuid, quantity numeric)
language sql stable security definer set search_path = public as $$
  select x.lot_id, x.layer, lr.on_date, lr.recorded_at, x.location_id, sum(x.q)
    from (select m.lot_id, m.layer, m.to_location as location_id, m.quantity as q
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.to_location is not null and r.status = 'done' and r.reversed_at is null
          union all
          select m.lot_id, m.layer, m.from_location, -m.quantity
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.from_location is not null and r.status = 'done' and r.reversed_at is null) x
    join stk_lots lt on lt.id = x.lot_id
    join stk_records lr on lr.id = x.layer
   where p_item is null or lt.item_id = p_item
   group by x.lot_id, x.layer, lr.on_date, lr.recorded_at, x.location_id
  having sum(x.q) <> 0
$$;

-- Every non-zero balance of a company: lot, item, place, quantity.
create or replace function stk_balances(p_owner uuid) returns table (lot_id uuid, item_id uuid, location_id uuid, quantity numeric)
language sql stable security definer set search_path = public as $$
  select x.lot_id, lt.item_id, x.location_id, sum(x.q)
    from (select m.lot_id, m.to_location as location_id, m.quantity as q
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.to_location is not null and r.status = 'done' and r.reversed_at is null
          union all
          select m.lot_id, m.from_location, -m.quantity
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.from_location is not null and r.status = 'done' and r.reversed_at is null) x
    join stk_lots lt on lt.id = x.lot_id
   group by x.lot_id, lt.item_id, x.location_id
  having sum(x.q) <> 0
$$;

create or replace function stk_item_balance(p_owner uuid, p_item uuid, p_loc uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(stk_balance(lt.id, p_loc)), 0) from stk_lots lt where lt.owner_id = p_owner and lt.item_id = p_item
$$;

-- Item units that entered stock from a PROJECT line as leftovers or traced
-- opening stock (pending openings included, so two can never exceed it).
create or replace function stk_line_in(p_purchase uuid, p_line_no int) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.quantity), 0) from stk_records r
   where r.purchase_id = p_purchase and r.line_no = p_line_no and r.kind in ('leftover', 'opening')
     and r.status in ('done', 'pending') and r.reversed_at is null
$$;

-- Take p_qty of an item from a place: layer by layer, the OLDEST RECEIVED
-- first (the day the goods entered stock — a late part delivery of an old
-- purchase goes after an earlier delivery of a newer one), within the lot
-- named if any. Returns [{lot_id, layer, quantity}]. The caller holds the
-- item's lock.
create or replace function stk_take(p_owner uuid, p_item uuid, p_from uuid, p_qty numeric, p_lot uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_left numeric := p_qty;
  v_take numeric;
  v_out jsonb := '[]'::jsonb;
begin
  for v in select l.lot_id, l.layer, l.quantity as bal from stk_layers(p_owner, p_item) l
            where l.location_id = p_from and l.quantity > 0 and (p_lot is null or l.lot_id = p_lot)
            order by l.received_on, l.received_at, l.layer
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v.bal);
    v_out := v_out || jsonb_build_object('lot_id', v.lot_id, 'layer', v.layer, 'quantity', v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'NOT_ENOUGH' using errcode = 'P0001',
      hint = 'Only ' || (p_qty - v_left) || ' there.';
  end if;
  return v_out;
end;
$$;

create or replace function stk_lock_items(p_items uuid[], p_extra text[] default '{}') returns void
language sql security definer set search_path = public as $$
  select pur_lock(coalesce((select array_agg('stk_item:' || i) from unnest(p_items) i where i is not null), '{}') || coalesce(p_extra, '{}'))
$$;

-- Every layer a record touched still holds a quantity of zero or more where
-- the record put goods (after a reversal).
create or replace function stk_check_record(p_record uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  for v in select distinct m.lot_id, m.layer, m.to_location from stk_moves m where m.record_id = p_record and m.to_location is not null loop
    if stk_layer_balance(v.lot_id, v.layer, v.to_location) < 0 then
      raise exception 'MOVED_ON' using errcode = 'P0001',
        hint = 'Those goods have moved on. Reverse the later records first.';
    end if;
  end loop;
end;
$$;

-- ════ 4. Requests: covered = purchases + stock ═══════════════════════

-- 0097's figures, by recorded purchases alone (shown as "Bought").
create or replace function pr_portion_purchased(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0)
    from purchase_line_covers c
    join purchase_lines l on l.id = c.line_id
    join purchases pu on pu.id = l.purchase_id
   where c.portion_id = p_portion and pu.status = 'recorded'
$$;

create or replace function pr_line_purchased(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0)
    from purchase_line_covers c
    join purchase_lines l on l.id = c.line_id
    join purchases pu on pu.id = l.purchase_id
   where c.request_line_id = p_line and pu.status = 'recorded'
$$;

-- From stock: live stock records only.
create or replace function pr_portion_from_stock(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0) from stk_covers c join stk_records r on r.id = c.record_id
   where c.portion_id = p_portion and r.status = 'done' and r.reversed_at is null
$$;

create or replace function pr_line_from_stock(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0) from stk_covers c join stk_records r on r.id = c.record_id
   where c.request_line_id = p_line and r.status = 'done' and r.reversed_at is null
$$;

-- COVERED, for every capacity formula of 0097 (Still to buy, splitting,
-- assigning, reducing): recorded purchases plus live stock records.
create or replace function pr_portion_bought(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select pr_portion_purchased(p_portion) + pr_portion_from_stock(p_portion)
$$;

create or replace function pr_line_bought(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select pr_line_purchased(p_line) + pr_line_from_stock(p_line)
$$;

-- Fill a request line from goods entering a project (record p_record, item
-- p_item, p_qty item units, at project p_folder). Picked portions are the
-- ONLY ones filled, each up to its pick; without picks the earliest batch
-- first. Each portion takes at most its Still to buy, and the whole
-- quantity must fit (the rest is a separate, unplanned record). The caller
-- holds the 'pr_line:' lock.
create or replace function stk_cover(p_owner uuid, p_record uuid, p_folder uuid, p_line uuid, p_item uuid, p_qty numeric, p_picks jsonb)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_req record;
  v_item pr_catalog_items;
  v_pick jsonb;
  v_p record;
  v_left numeric := p_qty;
  v_take numeric;
  v_cap numeric;
begin
  select ln.id, ln.unit, ln.catalog_item_id, ln.status as line_status, r.status as request_status, r.work_folder_id
    into v_req
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line and ln.owner_id = p_owner for update of ln;
  if v_req.id is null or v_req.work_folder_id <> p_folder then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  if v_req.line_status <> 'open' or v_req.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into v_item from pr_catalog_items where id = p_item;
  if v_req.catalog_item_id is not null and v_req.catalog_item_id <> p_item then
    raise exception 'ITEM_MISMATCH' using errcode = 'P0001';
  end if;
  if lower(btrim(v_req.unit)) <> lower(btrim(v_item.unit)) then
    raise exception 'UNIT_MISMATCH' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_picks, '[]'::jsonb)) <> 'array' then
    raise exception 'BAD_PORTION' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_picks, '[]'::jsonb)) > 0 then
    for v_pick in select value from jsonb_array_elements(p_picks) loop
      if pur_uuid(v_pick ->> 'portion_id') is null or pur_qty(v_pick ->> 'quantity') is null or pur_qty(v_pick ->> 'quantity') <= 0 then
        raise exception 'BAD_PORTION' using errcode = 'P0001';
      end if;
      select * into v_p from pr_line_portions where id = pur_uuid(v_pick ->> 'portion_id') and line_id = p_line for update;
      if v_p.id is null then
        raise exception 'BAD_PORTION' using errcode = 'P0001';
      end if;
      v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
      v_take := pur_qty(v_pick ->> 'quantity');
      if v_take > v_cap or v_take > v_left then
        raise exception 'REQUEST_EXCEEDED' using errcode = 'P0001', hint = 'Still to buy there: ' || v_cap || '.';
      end if;
      insert into stk_covers (owner_id, record_id, request_line_id, portion_id, quantity)
      values (p_owner, p_record, p_line, v_p.id, v_take);
      v_left := v_left - v_take;
    end loop;
  else
    for v_p in select p.* from pr_line_portions p join pr_batches b on b.id = p.batch_id
                where p.line_id = p_line order by b.cutoff_at, p.created_at, p.id for update of p
    loop
      exit when v_left <= 0;
      v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
      v_take := least(v_left, v_cap);
      continue when v_take <= 0;
      insert into stk_covers (owner_id, record_id, request_line_id, portion_id, quantity)
      values (p_owner, p_record, p_line, v_p.id, v_take);
      v_left := v_left - v_take;
    end loop;
  end if;
  if v_left > 0 then
    raise exception 'REQUEST_EXCEEDED' using errcode = 'P0001',
      hint = 'Still to buy: ' || (p_qty - v_left) || '. Record the rest separately, unplanned, with a reason.';
  end if;
  return p_qty;
end;
$$;

-- ════ 5. Guards on purchases and the old inventory ═══════════════════

-- A stored purchase line (recorded, corrected, checked) may not undo its
-- stock: destination, project and unit stay while it has stock records, and
-- its quantity covers what was received and closed (warehouse) or entered
-- as stock (project). A changed unit with no stock records drops the match.
create or replace function stk_guard_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m stk_matches;
  v_wh boolean;
  v_pj boolean;
  v_lot stk_lots;
begin
  select * into m from stk_matches where purchase_id = new.purchase_id and line_no = new.line_no;
  v_wh := exists (select 1 from stk_records r where r.purchase_id = new.purchase_id and r.line_no = new.line_no
                     and r.kind in ('receive', 'not_delivered') and r.status = 'done' and r.reversed_at is null);
  v_pj := exists (select 1 from stk_records r where r.purchase_id = new.purchase_id and r.line_no = new.line_no
                     and r.kind in ('leftover', 'opening') and r.status in ('done', 'pending') and r.reversed_at is null);
  if m.purchase_id is null and not v_wh and not v_pj then
    return null;
  end if;
  select * into v_lot from stk_lots where purchase_id = new.purchase_id and line_no = new.line_no;
  if (v_wh and new.destination <> 'warehouse')
     or (v_pj and (new.destination <> 'project' or new.folder_id is distinct from v_lot.cost_folder_id))
     or ((v_wh or v_pj) and m.purchase_id is not null and lower(btrim(new.unit)) <> m.line_unit)
     or (v_wh and new.quantity < stk_received(new.purchase_id, new.line_no) + stk_received(new.purchase_id, new.line_no, 'not_delivered'))
     or (v_pj and round(new.quantity * m.covers / m.per, 3) < stk_line_in(new.purchase_id, new.line_no)) then
    raise exception 'STOCK_IN_USE' using errcode = 'P0001',
      hint = 'Line ' || new.line_no || ' has stock records. Reverse them first, or keep the line''s destination, project, unit and enough quantity.';
  end if;
  if m.purchase_id is not null and not v_wh and not v_pj
     and (lower(btrim(new.unit)) <> m.line_unit or (v_lot.id is not null and new.destination = 'project' and new.folder_id is distinct from v_lot.cost_folder_id)
          or (v_lot.id is not null and new.destination = 'warehouse' and v_lot.cost_folder_id is not null)) then
    if exists (select 1 from stk_moves x where x.lot_id = v_lot.id) then
      raise exception 'STOCK_IN_USE' using errcode = 'P0001';
    end if;
    delete from stk_matches where purchase_id = new.purchase_id and line_no = new.line_no;
    if v_lot.id is not null then
      delete from stk_lots where id = v_lot.id;
    end if;
    insert into stk_events (owner_id, kind, purchase_id, line_no, detail, reason, actor_id)
    values (new.owner_id, 'unmatched', new.purchase_id, new.line_no, jsonb_build_object('item_id', m.item_id),
            'The purchase line changed', coalesce(auth.uid(), new.owner_id));
  end if;
  return null;
end;
$$;
drop trigger if exists stk_guard_line on purchase_lines;
create trigger stk_guard_line after insert or update of destination, folder_id, unit, quantity on purchase_lines
  for each row execute function stk_guard_line();

-- A purchase with live (or pending) stock records is never voided — nor
-- replaced, nor voided by an approved change request (they all void it).
create or replace function stk_guard_void() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'recorded' and new.status = 'void'
     and exists (select 1 from stk_records r where r.purchase_id = old.id
                    and r.status in ('done', 'pending') and r.reversed_at is null) then
    raise exception 'STOCK_IN_USE' using errcode = 'P0001',
      hint = 'This purchase has stock records. Reverse them first.';
  end if;
  return new;
end;
$$;
drop trigger if exists stk_guard_void on purchases;
create trigger stk_guard_void before update of status on purchases
  for each row execute function stk_guard_void();

-- One stock path (Q29): once stock is on, the old "Add to inventory"
-- tickbox (pur_move_stock) and the old Inventory screen write nothing.
create or replace function stk_inventory_frozen() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := coalesce(case when tg_op = 'DELETE' then old.owner_id else new.owner_id end, data_owner_id());
begin
  if stk_on(v_owner) then
    raise exception 'STOCK_TICK_RETIRED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists stk_inventory_frozen on inventory;
create trigger stk_inventory_frozen before insert or update or delete on inventory
  for each row execute function stk_inventory_frozen();

-- An item is IN USE once a request line or stock uses it (0092 counted
-- request lines; "when Stage 2 adds stock tables, extend the in-use test").
-- A match, a lot or any stock record — live, waiting or reversed: history.
create or replace function pr_item_in_use(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pr_lines l where l.catalog_item_id = p_item)
      or exists (select 1 from stk_matches m where m.item_id = p_item)
      or exists (select 1 from stk_lots lt where lt.item_id = p_item)
      or exists (select 1 from stk_records r where r.item_id = p_item)
$$;

-- The last word on it: no path changes the kind or unit of an item in use.
create or replace function stk_item_fixed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.kind is distinct from old.kind or new.unit is distinct from old.unit) and pr_item_in_use(old.id) then
    raise exception 'ITEM_IN_USE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists stk_item_fixed on pr_catalog_items;
create trigger stk_item_fixed before update of kind, unit on pr_catalog_items
  for each row execute function stk_item_fixed();

-- 0092's save, its in-use test extended to stock (pr_item_in_use).
create or replace function pr_office_save_item(p_item uuid, p_kind text, p_name text, p_spec text, p_unit text,
                                               p_category text, p_active boolean,
                                               p_aliases text[] default null, p_brand text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
  v_aliases text[] := case when p_aliases is null then null else pr_clean_aliases(p_aliases) end;
  v_kind text;
  v_unit text;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('material', 'tool')
     or btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_unit, '')) = '' then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  if (v_aliases is not null and (cardinality(v_aliases) > 20
        or exists (select 1 from unnest(v_aliases) a where length(a) > 60)))
     or length(btrim(coalesce(p_brand, ''))) > 80 then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  begin
    if p_item is null then
      insert into pr_catalog_items (owner_id, kind, name, spec, unit, category, active, aliases, brand)
      values (data_owner_id(), p_kind, btrim(p_name), btrim(coalesce(p_spec, '')), btrim(p_unit),
              btrim(coalesce(p_category, '')), coalesce(p_active, true), coalesce(v_aliases, '{}'::text[]),
              btrim(coalesce(p_brand, '')))
      returning id into v_id;
    else
      select owner_id into v_owner from pr_catalog_items where id = p_item;
      if v_owner is null or not can_access(v_owner) then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
      -- 0092: Kind and Unit are fixed once a request line uses the item.
      -- 0104: or stock (a match, a lot or a stock record).
      select kind, unit into v_kind, v_unit from pr_catalog_items where id = p_item for update;
      if (p_kind <> v_kind or btrim(p_unit) <> v_unit)
         and pr_item_in_use(p_item) then
        raise exception 'ITEM_IN_USE' using errcode = 'P0001';
      end if;
      update pr_catalog_items
         set kind = p_kind, name = btrim(p_name), spec = btrim(coalesce(p_spec, '')), unit = btrim(p_unit),
             category = btrim(coalesce(p_category, '')), active = coalesce(p_active, active),
             aliases = coalesce(v_aliases, aliases), brand = coalesce(btrim(p_brand), brand), updated_at = now()
       where id = p_item
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_ITEM' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id);
end;
$$;

-- 0092's catalogue list: `in_use` counts stock too, so Dacs Web locks Kind
-- and Unit before Save.
create or replace function pr_office_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
           'brand', c.brand, 'aliases', to_jsonb(c.aliases),
           'in_use', pr_item_in_use(c.id),
           'category', c.category, 'active', c.active)
         order by c.active desc, c.kind, lower(c.name), lower(c.spec)), '[]'::jsonb)
    from pr_catalog_items c
   where pr_is_office() and c.owner_id = data_owner_id()
$$;

-- ════ 6. The operations ══════════════════════════════════════════════

-- Match a purchase line to a catalogue item: p_covers = how many item units
-- the WHOLE line is (its quantity, for the same unit). A different unit
-- needs a note and is never checked by whoever recorded or bought it (the
-- owner may). A line already moving as stock is not re-matched.
create or replace function stk_match(p_op uuid, p_purchase uuid, p_line_no int, p_item uuid, p_covers text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_line purchase_lines;
  v_item pr_catalog_items;
  v_old stk_matches;
  v_lot stk_lots;
  v_covers numeric := pur_qty(p_covers);
  v_same boolean;
  pu purchases;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_purchase_lock(p_purchase);
  v_line := stk_line(v_owner, p_purchase, p_line_no);
  select * into v_old from stk_matches where purchase_id = p_purchase and line_no = p_line_no;
  perform stk_lock_items(array[p_item, v_old.item_id]);
  v_item := stk_item_lock(v_owner, p_item);
  if not v_item.active then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  v_same := lower(btrim(v_line.unit)) = lower(btrim(v_item.unit));
  if v_covers is null or v_covers <= 0 or v_covers > 1000000 or (v_same and v_covers <> v_line.quantity) then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if not v_same then
    perform pur_reason(p_note);
    select * into pu from purchases where id = p_purchase;
    if not is_owner() and auth.uid() in (pu.recorded_by, coalesce(pu.bought_by, pu.recorded_by)) then
      raise exception 'OWN_PURCHASE' using errcode = 'P0001';
    end if;
  end if;
  select * into v_lot from stk_lots where purchase_id = p_purchase and line_no = p_line_no;
  -- Fixed once any of its goods are stock (received under it, left over, …).
  if v_lot.id is not null and exists (select 1 from stk_moves m join stk_records r on r.id = m.record_id
                                       where m.lot_id = v_lot.id and r.status = 'done' and r.reversed_at is null) then
    raise exception 'STOCK_IN_USE' using errcode = 'P0001';
  end if;
  if exists (select 1 from stk_records r where r.purchase_id = p_purchase and r.line_no = p_line_no
                and r.kind = 'opening' and r.status = 'pending') then
    raise exception 'STOCK_IN_USE' using errcode = 'P0001';
  end if;
  insert into stk_matches (purchase_id, line_no, owner_id, item_id, line_unit, per, covers, auto, note, matched_by, matched_at)
  values (p_purchase, p_line_no, v_owner, p_item, lower(btrim(v_line.unit)), v_line.quantity, v_covers, false,
          pur_note(p_note), auth.uid(), now())
  on conflict (purchase_id, line_no) do update
    set item_id = excluded.item_id, line_unit = excluded.line_unit, per = excluded.per, covers = excluded.covers,
        auto = false, note = excluded.note, matched_by = excluded.matched_by, matched_at = excluded.matched_at;
  if v_lot.id is not null then
    update stk_lots set item_id = p_item where id = v_lot.id;
  elsif v_line.destination = 'warehouse' then
    perform stk_lot_for_line(v_line);
  end if;
  -- What was received before the match is stock now, one layer per receipt.
  if v_line.destination = 'warehouse' then
    perform stk_receipt_moves(v_line, (select id from stk_lots where purchase_id = p_purchase and line_no = p_line_no));
  end if;
  insert into stk_events (owner_id, kind, purchase_id, line_no, detail, reason, actor_id)
  values (v_owner, 'matched', p_purchase, p_line_no,
          jsonb_build_object('item_id', p_item, 'per', v_line.quantity, 'covers', v_covers, 'before', to_jsonb(v_old)),
          pur_note(p_note), auth.uid());
  v_result := jsonb_build_object('purchase_id', p_purchase, 'line', p_line_no, 'item_id', p_item, 'covers', v_covers);
  return pur_op_done(v_owner, p_op, 'stk_match', v_result);
end;
$$;

-- Goods of a warehouse line arrived (part or all), in the line's own unit.
create or replace function stk_receive(p_op uuid, p_purchase uuid, p_line_no int, p_qty text, p_on text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_line purchase_lines;
  v_qty numeric := pur_qty(p_qty);
  v_lot uuid;
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_purchase_lock(p_purchase);
  v_line := stk_line(v_owner, p_purchase, p_line_no);
  if v_line.destination <> 'warehouse' then
    raise exception 'NOT_WAREHOUSE' using errcode = 'P0001';
  end if;
  if v_qty is null or v_qty <= 0 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if v_qty > v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered') then
    raise exception 'MORE_THAN_AWAITED' using errcode = 'P0001',
      hint = 'Awaiting: ' || (v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered')) || '.';
  end if;
  insert into stk_records (owner_id, kind, purchase_id, line_no, to_location, quantity, on_date, note, recorded_by)
  values (v_owner, 'receive', p_purchase, p_line_no, stk_warehouse(v_owner), v_qty, pur_past_day(p_on), pur_note(p_note), auth.uid())
  returning id into v_id;
  -- A matched line's receipt is stock at once: its own layer, dated as received.
  v_lot := stk_try_lot(v_line);
  if v_lot is not null then
    perform stk_receipt_moves(v_line, v_lot);
  end if;
  v_result := jsonb_build_object('record_id', v_id, 'received', stk_received(p_purchase, p_line_no),
                                 'awaiting', v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered'));
  return pur_op_done(v_owner, p_op, 'stk_receive', v_result);
end;
$$;

-- The rest of a warehouse line will never come: closed with a reason (the
-- money goes through the supplier refund or credit of 2A-4).
create or replace function stk_not_delivered(p_op uuid, p_purchase uuid, p_line_no int, p_qty text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_line purchase_lines;
  v_qty numeric := pur_qty(p_qty);
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_purchase_lock(p_purchase);
  v_line := stk_line(v_owner, p_purchase, p_line_no);
  if v_line.destination <> 'warehouse' then
    raise exception 'NOT_WAREHOUSE' using errcode = 'P0001';
  end if;
  if v_qty is null or v_qty <= 0
     or v_qty > v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered') then
    raise exception 'MORE_THAN_AWAITED' using errcode = 'P0001';
  end if;
  insert into stk_records (owner_id, kind, purchase_id, line_no, quantity, on_date, reason, recorded_by)
  values (v_owner, 'not_delivered', p_purchase, p_line_no, v_qty, pur_manila_today(), pur_reason(p_reason), auth.uid())
  returning id into v_id;
  v_result := jsonb_build_object('record_id', v_id,
                                 'awaiting', v_line.quantity - stk_received(p_purchase, p_line_no) - stk_received(p_purchase, p_line_no, 'not_delivered'));
  return pur_op_done(v_owner, p_op, 'stk_not_delivered', v_result);
end;
$$;

-- Leftovers of a PROJECT purchase line: at its project's site, or brought
-- to the warehouse. Item units; never more than the line brought. The cost
-- stays with the project (the lot's cost_folder_id).
create or replace function stk_leftover(p_op uuid, p_purchase uuid, p_line_no int, p_qty text, p_where text, p_on text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_line purchase_lines;
  m stk_matches;
  v_qty numeric := pur_qty(p_qty);
  v_lot uuid;
  v_to uuid;
  v_room numeric;
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform pur_purchase_lock(p_purchase);
  v_line := stk_line(v_owner, p_purchase, p_line_no);
  if v_line.destination <> 'project' then
    raise exception 'NOT_PROJECT' using errcode = 'P0001';
  end if;
  if coalesce(p_where, '') not in ('site', 'warehouse') then
    raise exception 'BAD_LOCATION' using errcode = 'P0001';
  end if;
  m := stk_ensure_match(v_line);
  perform stk_lock_items(array[m.item_id]);
  if v_qty is null or v_qty <= 0 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  v_room := stk_conv(p_purchase, p_line_no, v_line.quantity) - stk_line_in(p_purchase, p_line_no);
  if v_qty > v_room then
    raise exception 'MORE_THAN_BOUGHT' using errcode = 'P0001', hint = 'At most ' || greatest(v_room, 0) || ' more.';
  end if;
  v_lot := stk_lot_for_line(v_line);
  v_to := case when p_where = 'site' then stk_site(v_owner, v_line.folder_id) else stk_warehouse(v_owner) end;
  insert into stk_records (owner_id, kind, item_id, purchase_id, line_no, to_location, quantity, lot_id, on_date, note, recorded_by)
  values (v_owner, 'leftover', m.item_id, p_purchase, p_line_no, v_to, v_qty, v_lot, pur_past_day(p_on), pur_note(p_note), auth.uid())
  returning id into v_id;
  insert into stk_moves (owner_id, record_id, lot_id, layer, to_location, quantity) values (v_owner, v_id, v_lot, v_id, v_to, v_qty);
  v_result := jsonb_build_object('record_id', v_id, 'lot_id', v_lot, 'item_id', m.item_id);
  return pur_op_done(v_owner, p_op, 'stk_leftover', v_result);
end;
$$;

-- Move goods. p_body: item_id, from / to ('warehouse' or a project folder's
-- id), quantity (item units), on (the day the goods arrived), lot_id
-- (optional: the lot the goods actually came from), returns_record (a
-- return: the issue being returned — its lots, back to the warehouse),
-- request_line_id + portion_picks, or unplanned_reason, when the goods go
-- to a project; note. Warehouse → project = an issue.
create or replace function stk_move(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_item uuid := pur_uuid(p_body ->> 'item_id');
  v_qty numeric := pur_qty(p_body ->> 'quantity');
  v_lot uuid := pur_uuid(p_body ->> 'lot_id');
  v_ret uuid := pur_uuid(p_body ->> 'returns_record');
  v_req uuid := pur_uuid(p_body ->> 'request_line_id');
  v_issue stk_records;
  v_from uuid;
  v_to uuid;
  v_to_loc stk_locations;
  v_kind text;
  v_takes jsonb;
  v_t jsonb;
  v_left numeric;
  v_m record;
  v_can numeric;
  v_id uuid;
  v_unplanned text := btrim(coalesce(p_body ->> 'unplanned_reason', ''));
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if coalesce(btrim(p_body ->> 'request_line_id'), '') <> '' and v_req is null then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  perform stk_lock_items(array[v_item], case when v_req is null then '{}'::text[] else array['pr_line:' || v_req] end);
  perform stk_item_lock(v_owner, v_item);
  if v_qty is null or v_qty <= 0 or v_qty > 1000000 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if v_ret is not null then
    select * into v_issue from stk_records where id = v_ret and owner_id = v_owner;
    if v_issue.id is null or v_issue.kind <> 'issue' or v_issue.status <> 'done' or v_issue.reversed_at is not null
       or v_issue.item_id <> v_item then
      raise exception 'BAD_RETURN' using errcode = 'P0001';
    end if;
    v_from := v_issue.to_location;
    v_to := v_issue.from_location;
    v_kind := 'return';
  else
    v_from := stk_place(v_owner, p_body ->> 'from');
    v_to := stk_place(v_owner, p_body ->> 'to');
    if v_from = v_to then
      raise exception 'BAD_LOCATION' using errcode = 'P0001';
    end if;
    v_kind := case when v_from = stk_warehouse(v_owner) then 'issue' else 'move' end;
  end if;
  select * into v_to_loc from stk_locations where id = v_to;
  if v_to_loc.kind = 'site' then
    if v_req is null and char_length(v_unplanned) not between 1 and 300 then
      raise exception 'UNPLANNED_REASON_REQUIRED' using errcode = 'P0001';
    end if;
  elsif v_req is not null or v_unplanned <> '' then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  if v_lot is not null and not exists (select 1 from stk_lots where id = v_lot and owner_id = v_owner and item_id = v_item) then
    raise exception 'BAD_LOT' using errcode = 'P0001';
  end if;

  if v_kind = 'return' then
    -- The issue's own lots and layers, the last moved first, each up to
    -- what this issue moved and has not had back, and to what is still there.
    v_takes := '[]'::jsonb;
    v_left := v_qty;
    for v_m in select m.lot_id, m.layer, sum(m.quantity) as qty, max(m.id) as last_id from stk_moves m
                where m.record_id = v_issue.id and (v_lot is null or m.lot_id = v_lot)
                group by m.lot_id, m.layer order by max(m.id) desc
    loop
      exit when v_left <= 0;
      v_can := v_m.qty - coalesce((select sum(x.quantity) from stk_moves x join stk_records r on r.id = x.record_id
                                    where r.returns_record = v_issue.id and r.status = 'done' and r.reversed_at is null
                                      and x.lot_id = v_m.lot_id and x.layer = v_m.layer), 0);
      v_can := least(v_can, stk_layer_balance(v_m.lot_id, v_m.layer, v_from));
      continue when v_can <= 0;
      v_takes := v_takes || jsonb_build_object('lot_id', v_m.lot_id, 'layer', v_m.layer, 'quantity', least(v_left, v_can));
      v_left := v_left - least(v_left, v_can);
    end loop;
    if v_left > 0 then
      raise exception 'MORE_THAN_ISSUED' using errcode = 'P0001',
        hint = 'At most ' || (v_qty - v_left) || ' of that issue can come back.';
    end if;
  else
    v_takes := stk_take(v_owner, v_item, v_from, v_qty, v_lot);
  end if;

  insert into stk_records (owner_id, kind, item_id, from_location, to_location, quantity, lot_id, on_date,
                           request_line_id, unplanned_reason, returns_record, note, recorded_by)
  values (v_owner, v_kind, v_item, v_from, v_to, v_qty, v_lot, pur_past_day(p_body ->> 'on'),
          v_req, case when v_req is null then v_unplanned else '' end, v_ret, pur_note(p_body ->> 'note'), auth.uid())
  returning id into v_id;
  for v_t in select value from jsonb_array_elements(v_takes) loop
    insert into stk_moves (owner_id, record_id, lot_id, layer, from_location, to_location, quantity)
    values (v_owner, v_id, (v_t ->> 'lot_id')::uuid, (v_t ->> 'layer')::uuid, v_from, v_to, (v_t ->> 'quantity')::numeric);
  end loop;
  if v_req is not null then
    perform stk_cover(v_owner, v_id, v_to_loc.folder_id, v_req, v_item, v_qty, p_body -> 'portion_picks');
  end if;
  v_result := jsonb_build_object('record_id', v_id, 'kind', v_kind, 'lots', v_takes);
  return pur_op_done(v_owner, p_op, 'stk_move', v_result);
end;
$$;

-- A count of one item at one place. Equal to the books: done. Different:
-- an adjustment waiting for the main owner, with a reason (lost, damaged,
-- expired, miscounted, other). p_body: item_id, at, counted, on, reason, note.
create or replace function stk_count(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_item uuid := pur_uuid(p_body ->> 'item_id');
  v_counted numeric := pur_qty(p_body ->> 'counted');
  v_at uuid;
  v_book numeric;
  v_reason text := btrim(coalesce(p_body ->> 'reason', ''));
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  perform stk_lock_items(array[v_item]);
  perform stk_item_lock(v_owner, v_item);
  v_at := stk_place(v_owner, p_body ->> 'at');
  if v_counted is null or v_counted > 1000000 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  v_book := stk_item_balance(v_owner, v_item, v_at);
  if v_counted <> v_book and v_reason not in ('lost', 'damaged', 'expired', 'miscounted', 'other') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if exists (select 1 from stk_records r where r.owner_id = v_owner and r.kind = 'count' and r.status = 'pending'
                and r.item_id = v_item and r.to_location = v_at) then
    raise exception 'COUNT_PENDING' using errcode = 'P0001';
  end if;
  insert into stk_records (owner_id, kind, status, item_id, to_location, quantity, book_quantity, on_date, reason, note, recorded_by)
  values (v_owner, 'count', case when v_counted = v_book then 'done' else 'pending' end, v_item, v_at, v_counted, v_book,
          pur_past_day(p_body ->> 'on'), case when v_counted = v_book then '' else v_reason end, pur_note(p_body ->> 'note'), auth.uid())
  returning id into v_id;
  v_result := jsonb_build_object('record_id', v_id, 'book', v_book, 'counted', v_counted, 'difference', v_counted - v_book,
                                 'status', case when v_counted = v_book then 'done' else 'pending' end);
  return pur_op_done(v_owner, p_op, 'stk_count', v_result);
end;
$$;

-- Goods already there on launch day, per place (waits for the main owner).
-- Traceable to a recorded PROJECT purchase line → that line's lot (its cost
-- stays with its project); otherwise an untraced lot. p_body: item_id, at,
-- quantity, on, purchase_id + line_no (optional), note.
create or replace function stk_opening(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  v_item uuid := pur_uuid(p_body ->> 'item_id');
  v_qty numeric := pur_qty(p_body ->> 'quantity');
  v_purchase uuid := pur_uuid(p_body ->> 'purchase_id');
  v_line_no int;
  v_line purchase_lines;
  m stk_matches;
  v_at uuid;
  v_lot uuid;
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if coalesce(btrim(p_body ->> 'purchase_id'), '') <> '' then
    if v_purchase is null or coalesce(p_body ->> 'line_no', '') !~ '^\d{1,2}$' then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    v_line_no := (p_body ->> 'line_no')::int;
    perform pur_purchase_lock(v_purchase);
  end if;
  perform stk_lock_items(array[v_item]);
  perform stk_item_lock(v_owner, v_item);
  v_at := stk_place(v_owner, p_body ->> 'at');
  if v_qty is null or v_qty <= 0 or v_qty > 1000000 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if v_purchase is not null then
    v_line := stk_line(v_owner, v_purchase, v_line_no);
    if v_line.destination <> 'project' then
      raise exception 'NOT_PROJECT' using errcode = 'P0001',
        hint = 'A warehouse purchase becomes stock by being received.';
    end if;
    m := stk_ensure_match(v_line);
    if m.item_id <> v_item then
      raise exception 'ITEM_MISMATCH' using errcode = 'P0001';
    end if;
    if v_qty > stk_conv(v_purchase, v_line_no, v_line.quantity) - stk_line_in(v_purchase, v_line_no) then
      raise exception 'MORE_THAN_BOUGHT' using errcode = 'P0001';
    end if;
    v_lot := stk_lot_for_line(v_line);
  end if;
  insert into stk_records (owner_id, kind, status, item_id, purchase_id, line_no, to_location, quantity, lot_id, on_date, note, recorded_by)
  values (v_owner, 'opening', 'pending', v_item, v_purchase, v_line_no, v_at, v_qty, v_lot, pur_past_day(p_body ->> 'on'),
          pur_note(p_body ->> 'note'), auth.uid())
  returning id into v_id;
  v_result := jsonb_build_object('record_id', v_id, 'status', 'pending');
  return pur_op_done(v_owner, p_op, 'stk_opening', v_result);
end;
$$;

-- The main owner confirms or rejects a count difference or opening stock.
-- A count is confirmed only while the books still read what they read when
-- it was counted (else count again): a loss comes off the lots there,
-- oldest first; goods found become an untraced lot.
create or replace function stk_decide(p_op uuid, p_record uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_prev jsonb;
  r stk_records;
  v_line purchase_lines;
  v_lot uuid;
  v_takes jsonb;
  v_t jsonb;
  v_diff numeric;
  v_result jsonb;
begin
  v_owner := pur_main_owner();
  if not stk_on(v_owner) then
    raise exception 'STOCK_OFF' using errcode = 'P0001';
  end if;
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if p_approve is null then
    raise exception 'BAD_SWITCH' using errcode = 'P0001';
  end if;
  select * into r from stk_records where id = p_record and owner_id = v_owner;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.purchase_id is not null then
    perform pur_purchase_lock(r.purchase_id);
  end if;
  perform stk_lock_items(array[r.item_id]);
  select * into r from stk_records where id = p_record;
  if r.status <> 'pending' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if not p_approve then
    update stk_records set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = pur_reason(p_note)
     where id = r.id;
    insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'rejected', r.id, pur_reason(p_note), auth.uid());
    return pur_op_done(v_owner, p_op, 'stk_decide', jsonb_build_object('record_id', r.id, 'status', 'rejected'));
  end if;

  if r.kind = 'count' then
    if stk_item_balance(v_owner, r.item_id, r.to_location) <> r.book_quantity then
      raise exception 'STALE_COUNT' using errcode = 'P0001',
        hint = 'The books changed since this count. Reject it and count again.';
    end if;
    v_diff := r.quantity - r.book_quantity;
    update stk_records set status = 'done', decided_by = auth.uid(), decided_at = now(), decision_note = pur_note(p_note, 500)
     where id = r.id;
    if v_diff < 0 then
      v_takes := stk_take(v_owner, r.item_id, r.to_location, -v_diff, null);
      for v_t in select value from jsonb_array_elements(v_takes) loop
        insert into stk_moves (owner_id, record_id, lot_id, layer, from_location, quantity)
        values (v_owner, r.id, (v_t ->> 'lot_id')::uuid, (v_t ->> 'layer')::uuid, r.to_location, (v_t ->> 'quantity')::numeric);
      end loop;
    else
      insert into stk_lots (owner_id, item_id, untraced, since, created_by)
      values (v_owner, r.item_id, true, r.on_date, auth.uid()) returning id into v_lot;
      insert into stk_moves (owner_id, record_id, lot_id, layer, to_location, quantity) values (v_owner, r.id, v_lot, r.id, r.to_location, v_diff);
    end if;
  else
    if r.purchase_id is not null then
      v_line := stk_line(v_owner, r.purchase_id, r.line_no);
      if v_line.destination <> 'project' or stk_conv(r.purchase_id, r.line_no, v_line.quantity) < stk_line_in(r.purchase_id, r.line_no) then
        raise exception 'MORE_THAN_BOUGHT' using errcode = 'P0001';
      end if;
      v_lot := stk_lot_for_line(v_line);
    else
      insert into stk_lots (owner_id, item_id, untraced, since, created_by)
      values (v_owner, r.item_id, true, r.on_date, auth.uid()) returning id into v_lot;
    end if;
    update stk_records set status = 'done', lot_id = v_lot, decided_by = auth.uid(), decided_at = now(),
                           decision_note = pur_note(p_note, 500)
     where id = r.id;
    insert into stk_moves (owner_id, record_id, lot_id, layer, to_location, quantity) values (v_owner, r.id, v_lot, r.id, r.to_location, r.quantity);
  end if;
  insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'confirmed', r.id, pur_note(p_note, 500), auth.uid());
  v_result := jsonb_build_object('record_id', r.id, 'status', 'done');
  return pur_op_done(v_owner, p_op, 'stk_decide', v_result);
end;
$$;

-- Reverse a mistaken record (reason kept; nothing is deleted), or withdraw
-- one still waiting for the main owner. The person who recorded it or an
-- owner account; a confirmed count or opening stock — the main owner only.
-- Refused while its goods have moved on, and for an issue with returns
-- (reverse those first).
create or replace function stk_reverse(p_op uuid, p_record uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  r stk_records;
  v_lot stk_lots;
  v_reason text := pur_reason(p_reason);
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into r from stk_records where id = p_record and owner_id = v_owner;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.purchase_id is not null then
    perform pur_purchase_lock(r.purchase_id);
  end if;
  select * into v_lot from stk_lots where purchase_id = r.purchase_id and line_no = r.line_no;
  perform stk_lock_items(array[r.item_id, v_lot.item_id],
                         case when r.request_line_id is null then '{}'::text[] else array['pr_line:' || r.request_line_id] end);
  select * into r from stk_records where id = p_record;
  if r.status = 'pending' then
    if auth.uid() <> r.recorded_by and not pur_is_main_owner() then
      raise exception 'NOT_YOURS' using errcode = 'P0001';
    end if;
    update stk_records set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_note = v_reason where id = r.id;
    insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'withdrawn', r.id, v_reason, auth.uid());
    return pur_op_done(v_owner, p_op, 'stk_reverse', jsonb_build_object('record_id', r.id, 'status', 'withdrawn'));
  end if;
  if r.status <> 'done' or r.reversed_at is not null then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if r.kind in ('count', 'opening') then
    if not pur_is_main_owner() then
      raise exception 'NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if not exists (select 1 from stk_moves m where m.record_id = r.id) then
      raise exception 'BAD_STATE' using errcode = 'P0001';
    end if;
  elsif auth.uid() <> r.recorded_by and not is_owner() then
    raise exception 'NOT_YOURS' using errcode = 'P0001';
  end if;
  if r.kind = 'issue' and exists (select 1 from stk_records x where x.returns_record = r.id and x.status = 'done' and x.reversed_at is null) then
    raise exception 'RETURNS_FIRST' using errcode = 'P0001';
  end if;
  update stk_records set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason where id = r.id;
  -- What the record put somewhere must still be there (a receipt's layer
  -- included: refused once any of that delivery has moved on).
  perform stk_check_record(r.id);
  insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'reversed', r.id, v_reason, auth.uid());
  v_result := jsonb_build_object('record_id', r.id, 'reversed', true);
  return pur_op_done(v_owner, p_op, 'stk_reverse', v_result);
end;
$$;

-- ════ 7. Reading (quantities only) ═══════════════════════════════════

-- The caller's company, for a stock read: whoever may record stock, while
-- it is on (the screens are hidden before launch).
create or replace function stk_reader() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not stk_can_record() then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if not stk_on(data_owner_id()) then
    raise exception 'STOCK_OFF' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

create or replace function stk_place_name(p_loc uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when l.kind = 'warehouse' then 'Warehouse' else coalesce(f.name, l.folder_name) end
    from stk_locations l left join folders f on f.id = l.folder_id where l.id = p_loc
$$;

-- One record as the screens show it.
create or replace function stk_record_json(p_record uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'status', r.status, 'item_id', r.item_id, 'item_name', c.name, 'item_unit', c.unit,
    'purchase_id', r.purchase_id, 'line_no', r.line_no, 'line_item', l.item_name, 'line_unit', l.unit,
    'from_id', r.from_location, 'from_name', stk_place_name(r.from_location),
    'to_id', r.to_location, 'to_name', stk_place_name(r.to_location),
    'quantity', r.quantity, 'book_quantity', r.book_quantity, 'on', r.on_date,
    'request_line_id', r.request_line_id, 'request_description', rl.description,
    'unplanned_reason', r.unplanned_reason, 'returns_record', r.returns_record, 'reason', r.reason, 'note', r.note,
    'recorded_by', r.recorded_by, 'recorded_by_name', pur_person_name(r.recorded_by), 'recorded_at', r.recorded_at,
    'decided_by_name', case when r.decided_by is null then null else pur_person_name(r.decided_by) end,
    'decided_at', r.decided_at, 'decision_note', r.decision_note,
    'reversed', r.reversed_at is not null, 'reversed_at', r.reversed_at, 'reverse_reason', r.reverse_reason,
    'reversed_by_name', case when r.reversed_by is null then null else pur_person_name(r.reversed_by) end,
    'returnable', case when r.kind = 'issue' and r.status = 'done' and r.reversed_at is null then
                    r.quantity - coalesce((select sum(x.quantity) from stk_records x where x.returns_record = r.id
                                             and x.status = 'done' and x.reversed_at is null), 0) end,
    'lots', (select coalesce(jsonb_agg(jsonb_build_object('lot_id', m.lot_id, 'layer', m.layer, 'quantity', m.quantity) order by m.id), '[]'::jsonb)
               from stk_moves m where m.record_id = r.id))
  from stk_records r
  left join pr_catalog_items c on c.id = r.item_id
  left join purchase_lines l on l.purchase_id = r.purchase_id and l.line_no = r.line_no
  left join pr_lines rl on rl.id = r.request_line_id
  where r.id = p_record
$$;

-- A warehouse or project purchase line, for the stock screens: what it is,
-- its match, and (warehouse) what is received and still awaited. No price.
create or replace function stk_line_json(p_line purchase_lines) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'purchase_id', p_line.purchase_id, 'line_no', p_line.line_no, 'destination', p_line.destination,
    'folder_id', p_line.folder_id, 'folder_name', p_line.folder_name,
    'item_name', p_line.item_name, 'unit', p_line.unit, 'quantity', p_line.quantity,
    'purchase_date', pu.purchase_date, 'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
    'received', stk_received(p_line.purchase_id, p_line.line_no),
    'not_delivered', stk_received(p_line.purchase_id, p_line.line_no, 'not_delivered'),
    'awaiting', case when p_line.destination = 'warehouse'
                     then p_line.quantity - stk_received(p_line.purchase_id, p_line.line_no)
                          - stk_received(p_line.purchase_id, p_line.line_no, 'not_delivered') end,
    'entered', stk_line_in(p_line.purchase_id, p_line.line_no),
    'match', (select jsonb_build_object('item_id', m.item_id, 'item_name', c.name, 'item_unit', c.unit,
                                        'per', m.per, 'covers', m.covers, 'auto', m.auto)
                from stk_matches m join pr_catalog_items c on c.id = m.item_id
               where m.purchase_id = p_line.purchase_id and m.line_no = p_line.line_no),
    'auto_item_id', stk_auto_item(p_line),
    -- The one active catalogue item with exactly this name and unit, as a
    -- suggestion for the office's match (never applied by itself).
    'suggested_item_id', (select case when count(*) = 1 then (array_agg(c.id))[1] end from pr_catalog_items c
                           where c.owner_id = p_line.owner_id and c.active
                             and lower(btrim(c.name)) = lower(btrim(p_line.item_name)) and lower(btrim(c.unit)) = lower(btrim(p_line.unit))),
    'can_check', is_owner() or auth.uid() not in (pu.recorded_by, coalesce(pu.bought_by, pu.recorded_by)))
  from purchases pu where pu.id = p_line.purchase_id
$$;

-- The Stock screen: every item with stock, by place; warehouse lines
-- awaiting delivery or a match; what waits for the main owner; the latest
-- records.
create or replace function stk_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  return jsonb_build_object(
    'warehouse_id', (select id from stk_locations where owner_id = v_owner and kind = 'warehouse'),
    'items', (select coalesce(jsonb_agg(x.doc order by x.name), '[]'::jsonb) from (
        select c.name, jsonb_build_object('item_id', c.id, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
                 'total', sum(b.quantity),
                 'places', jsonb_agg(jsonb_build_object('location_id', b.location_id, 'name', stk_place_name(b.location_id),
                                                        'kind', l.kind, 'folder_id', l.folder_id, 'quantity', b.quantity)
                                     order by l.kind = 'site', stk_place_name(b.location_id))) as doc
          from (select s.item_id, s.location_id, sum(s.quantity) as quantity from stk_balances(v_owner) s
                 group by s.item_id, s.location_id having sum(s.quantity) <> 0) b
          join pr_catalog_items c on c.id = b.item_id
          join stk_locations l on l.id = b.location_id
         group by c.id, c.name, c.spec, c.unit) x),
    'awaiting', (select coalesce(jsonb_agg(stk_line_json(l) order by pu.purchase_date, l.purchase_id, l.line_no), '[]'::jsonb)
                   from purchase_lines l join purchases pu on pu.id = l.purchase_id
                  where pu.owner_id = v_owner and pu.status = 'recorded' and l.destination = 'warehouse'
                    and (l.quantity - stk_received(l.purchase_id, l.line_no) - stk_received(l.purchase_id, l.line_no, 'not_delivered') > 0
                         or (not exists (select 1 from stk_matches m where m.purchase_id = l.purchase_id and m.line_no = l.line_no)
                             and stk_auto_item(l) is null))),
    'pending', (select coalesce(jsonb_agg(stk_record_json(r.id) order by r.recorded_at), '[]'::jsonb)
                  from stk_records r where r.owner_id = v_owner and r.status = 'pending'),
    'recent', (select coalesce(jsonb_agg(stk_record_json(x.id) order by x.recorded_at desc), '[]'::jsonb)
                 from (select r.id, r.recorded_at from stk_records r where r.owner_id = v_owner
                        order by r.recorded_at desc limit 50) x));
end;
$$;

-- One item: its lots and where each is, and its records (newest first).
create or replace function stk_item(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := stk_reader();
  c pr_catalog_items := stk_item_ok(v_owner, p_item);
begin
  return jsonb_build_object(
    'item_id', c.id, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
    'lots', (select coalesce(jsonb_agg(jsonb_build_object(
               'lot_id', lt.id, 'untraced', lt.untraced, 'since', lt.since, 'purchase_id', lt.purchase_id, 'line_no', lt.line_no,
               'cost_folder_id', lt.cost_folder_id,
               'cost_folder_name', case when lt.cost_folder_id is null then null
                                        else coalesce((select f.name from folders f where f.id = lt.cost_folder_id), l.folder_name) end,
               'line_item', l.item_name,
               'places', (select coalesce(jsonb_agg(jsonb_build_object('location_id', s.location_id, 'name', stk_place_name(s.location_id),
                                                                        'quantity', s.quantity) order by stk_place_name(s.location_id)), '[]'::jsonb)
                            from stk_balances(v_owner) s where s.lot_id = lt.id),
               -- Each delivery / entry still in stock, oldest received first (the issuing order).
               'layers', (select coalesce(jsonb_agg(jsonb_build_object('layer', y.layer, 'received_on', y.received_on,
                                                                        'location_id', y.location_id, 'name', stk_place_name(y.location_id),
                                                                        'quantity', y.quantity)
                                                     order by y.received_on, y.received_at, y.layer), '[]'::jsonb)
                            from stk_layers(v_owner, c.id) y where y.lot_id = lt.id and y.quantity > 0))
             order by lt.since, lt.created_at), '[]'::jsonb)
               from stk_lots lt left join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
              where lt.owner_id = v_owner and lt.item_id = c.id),
    'records', (select coalesce(jsonb_agg(stk_record_json(x.id) order by x.recorded_at desc), '[]'::jsonb)
                  from (select r.id, r.recorded_at from stk_records r
                         where r.owner_id = v_owner
                           and (r.item_id = c.id or exists (select 1 from stk_lots lt where lt.purchase_id = r.purchase_id
                                                              and lt.line_no = r.line_no and lt.item_id = c.id))
                         order by r.recorded_at desc limit 200) x));
end;
$$;

-- A project's purchase lines (recorded), for "Record leftovers" and traced
-- opening stock: what each brought and how much is already stock.
create or replace function stk_project_lines(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  return (select coalesce(jsonb_agg(stk_line_json(l) order by pu.purchase_date desc, l.purchase_id, l.line_no), '[]'::jsonb)
            from purchase_lines l join purchases pu on pu.id = l.purchase_id
           where pu.owner_id = v_owner and pu.status = 'recorded' and l.destination = 'project' and l.folder_id = p_folder);
end;
$$;

-- What the forms pick from: catalogue items and the company's projects.
create or replace function stk_choices() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object('item_id', c.id, 'name', c.name, 'spec', c.spec, 'unit', c.unit, 'kind', c.kind)
                                        order by lower(c.name), lower(c.spec)), '[]'::jsonb)
                from pr_catalog_items c where c.owner_id = v_owner and c.active),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('folder_id', f.id,
                   'name', case when f.parent_folder_id is null then f.name else coalesce(par.name, '') || ' — ' || f.name end,
                   'main', f.parent_folder_id is null,
                   'completed', f.completed_at is not null or par.completed_at is not null)
                   order by coalesce(par.name, f.name), f.parent_folder_id is not null, f.name), '[]'::jsonb)
                   from folders f left join folders par on par.id = f.parent_folder_id
                  where f.owner_id = v_owner));
end;
$$;

-- 0097's shopping list: "bought" is now what recorded PURCHASES covered;
-- "from_stock" what stock covered; "still_to_buy" counts both (as before,
-- through pr_portion_bought). "in_warehouse": usable warehouse stock of the
-- line's catalogue item, as a hint (no reservation, Q9) — 0 while stock is off.
create or replace function pur_shopping_list(p_batch uuid default null, p_folder uuid default null, p_scope text default 'open')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_on boolean;
  v_wh uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  v_on := stk_on(v_owner);
  v_wh := (select id from stk_locations where owner_id = v_owner and kind = 'warehouse');
  return (
    select coalesce(jsonb_agg(x.doc order by x.urgent desc, x.needed_by nulls last, x.first_cutoff nulls last, x.project_name, x.received_at, x.position), '[]'::jsonb)
      from (
        select l.urgent, l.needed_by, l.position, r.received_at, f.name as project_name,
               (select min(b.cutoff_at) from pr_line_portions p join pr_batches b on b.id = p.batch_id
                 where p.line_id = l.id and (p_batch is null or p.batch_id = p_batch)) as first_cutoff,
               jsonb_build_object(
                 'line_id', l.id, 'request_id', r.id, 'kind', l.kind,
                 'description', l.description, 'spec', l.spec, 'unit', l.unit, 'category', l.category,
                 'catalog_item_id', l.catalog_item_id, 'catalog_name', c.name,
                 'urgent', l.urgent, 'urgent_reason', l.urgent_reason, 'needed_by', l.needed_by, 'notes', l.notes,
                 'project_id', r.folder_id, 'project_name', f.name, 'work_id', r.work_folder_id,
                 'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
                 'requester_name', pr_person_name(r.requester_id),
                 'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id),
                 'bought', pr_line_purchased(l.id),
                 'from_stock', pr_line_from_stock(l.id),
                 'in_warehouse', case when v_on and v_wh is not null and l.catalog_item_id is not null
                                      then stk_item_balance(v_owner, l.catalog_item_id, v_wh) else 0 end,
                 'in_warehouse_unit', c.unit,
                 'still_to_buy', (select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0)
                                    from pr_line_portions p where p.line_id = l.id),
                 'extra', (select coalesce(sum(pl.extra_qty), 0) from purchase_lines pl join purchases pu on pu.id = pl.purchase_id
                            where pl.request_line_id = l.id and pu.status = 'recorded'),
                 'unit_checks', (select count(*) from purchase_lines pl join purchases pu on pu.id = pl.purchase_id
                                  where pl.request_line_id = l.id and pu.status = 'recorded' and pl.unit_check = 'pending'),
                 'portions', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'id', p.id, 'batch_id', p.batch_id, 'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on,
                            'delivery_on', b.delivery_on, 'quantity', p.quantity, 'pending_reduction', p.pending_reduction,
                            'bought', pr_portion_purchased(p.id),
                            'from_stock', pr_portion_from_stock(p.id),
                            'still_to_buy', greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id)),
                            'arranged', p.arranged_at is not null,
                            'buyer_id', p.buyer_id, 'buyer_name', case when p.buyer_id is null then null else pur_person_name(p.buyer_id) end,
                            'mine', p.buyer_id = auth.uid(), 'assigned_at', p.assigned_at,
                            'changed', p.assigned_at is not null and exists (
                               select 1 from pr_events e
                                where e.line_id = l.id and e.created_at > p.assigned_at
                                  and e.kind in ('quantity_changed', 'office_quantity_changed', 'conflict_resolved',
                                                 'line_cancelled', 'office_line_cancelled', 'reduction_resolved')))
                          order by b.cutoff_at, p.created_at), '[]'::jsonb)
                     from pr_line_portions p join pr_batches b on b.id = p.batch_id
                    where p.line_id = l.id and (p_batch is null or p.batch_id = p_batch))
               ) as doc
          from pr_lines l
          join pr_requests r on r.id = l.request_id
          join folders f on f.id = r.folder_id
          join folders w on w.id = r.work_folder_id
          left join pr_catalog_items c on c.id = l.catalog_item_id
         where l.owner_id = v_owner
           and (p_folder is null or r.folder_id = p_folder)
           and (p_batch is null or exists (select 1 from pr_line_portions p where p.line_id = l.id and p.batch_id = p_batch))
           and (coalesce(p_scope, 'open') = 'all'
                or (l.status = 'open' and r.status = 'submitted'
                    and exists (select 1 from pr_line_portions p
                                 where p.line_id = l.id and (p_batch is null or p.batch_id = p_batch)
                                   and p.quantity - p.pending_reduction - pr_portion_bought(p.id) > 0))
                or exists (select 1 from purchase_lines pl join purchases pu on pu.id = pl.purchase_id
                            where pl.request_line_id = l.id and pu.status = 'recorded' and pl.unit_check = 'pending'))
         order by l.urgent desc, l.needed_by nulls last, first_cutoff nulls last, f.name, r.received_at, l.position
         limit 500
      ) x);
end;
$$;

-- Requests open to stock: the open lines of a project (Main Contract or an
-- Additional Works job) with Still to buy, for an issue's "Fills request".
create or replace function stk_request_lines(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'line_id', l.id, 'description', l.description, 'spec', l.spec, 'unit', l.unit,
            'catalog_item_id', l.catalog_item_id, 'requester_name', pr_person_name(r.requester_id),
            'still_to_buy', (select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0)
                               from pr_line_portions p where p.line_id = l.id),
            'portions', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'cutoff_at', b.cutoff_at,
                                   'still_to_buy', greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id)))
                                 order by b.cutoff_at, p.created_at), '[]'::jsonb)
                           from pr_line_portions p join pr_batches b on b.id = p.batch_id where p.line_id = l.id))
          order by r.received_at, l.position), '[]'::jsonb)
            from pr_lines l join pr_requests r on r.id = l.request_id
           where l.owner_id = v_owner and r.work_folder_id = p_folder and l.status = 'open' and r.status = 'submitted'
             and exists (select 1 from pr_line_portions p where p.line_id = l.id
                            and p.quantity - p.pending_reduction - pr_portion_bought(p.id) > 0));
end;
$$;

-- 0101's one-purchase view: a request's "bought" is purchases alone, with
-- "from_stock" beside it.
create or replace function pur_purchase_view(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select pur_doc(pu.id) || jsonb_build_object(
    'recorded_by_name', pur_person_name(pu.recorded_by),
    'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
    'created_at', pu.created_at, 'updated_at', pu.updated_at, 'replaced_by', pu.replaced_by,
    'no_receipt_reason', pu.no_receipt_reason,
    'covers', (select coalesce(jsonb_agg(jsonb_build_object(
                 'line', l.line_no, 'request_line_id', c.request_line_id, 'portion_id', c.portion_id,
                 'quantity', c.quantity, 'buyer_name', pur_person_name(c.buyer_id),
                 'request_description', rl.description, 'request_unit', rl.unit,
                 'cutoff_at', (select b.cutoff_at from pr_line_portions p join pr_batches b on b.id = p.batch_id where p.id = c.portion_id))
               order by l.line_no, c.id), '[]'::jsonb)
                 from purchase_line_covers c join purchase_lines l on l.id = c.line_id
                 join pr_lines rl on rl.id = c.request_line_id
                where l.purchase_id = pu.id),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('line', l.line_no, 'request_line_id', l.request_line_id,
                   'description', rl.description, 'spec', rl.spec, 'unit', rl.unit,
                   'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = rl.id),
                   'bought', pr_line_purchased(rl.id), 'from_stock', pr_line_from_stock(rl.id)) order by l.line_no), '[]'::jsonb)
                   from purchase_lines l join pr_lines rl on rl.id = l.request_line_id where l.purchase_id = pu.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'reason', h.reason, 'at', h.at,
                  'actor_name', pur_person_name(h.actor_id)) order by h.id), '[]'::jsonb)
                  from purchase_history h where h.purchase_id = pu.id),
    'change_requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status,
                          'reason', r.reason, 'requested_by_name', pur_person_name(r.requested_by), 'requested_at', r.requested_at,
                          'decision_note', r.decision_note) order by r.requested_at desc), '[]'::jsonb)
                          from purchase_change_requests r where r.purchase_id = pu.id))
  from purchases pu where pu.id = p_purchase
$$;

-- ════ 8. Who may call what ═══════════════════════════════════════════

-- The operations and readers (each refuses the wrong caller itself).
revoke all on function stk_status() from public, anon;
grant execute on function stk_status() to authenticated;
revoke all on function stk_set_enabled(boolean) from public, anon;
grant execute on function stk_set_enabled(boolean) to authenticated;
revoke all on function stk_match(uuid, uuid, int, uuid, text, text) from public, anon;
grant execute on function stk_match(uuid, uuid, int, uuid, text, text) to authenticated;
revoke all on function stk_receive(uuid, uuid, int, text, text, text) from public, anon;
grant execute on function stk_receive(uuid, uuid, int, text, text, text) to authenticated;
revoke all on function stk_not_delivered(uuid, uuid, int, text, text) from public, anon;
grant execute on function stk_not_delivered(uuid, uuid, int, text, text) to authenticated;
revoke all on function stk_leftover(uuid, uuid, int, text, text, text, text) from public, anon;
grant execute on function stk_leftover(uuid, uuid, int, text, text, text, text) to authenticated;
revoke all on function stk_move(uuid, jsonb) from public, anon;
grant execute on function stk_move(uuid, jsonb) to authenticated;
revoke all on function stk_count(uuid, jsonb) from public, anon;
grant execute on function stk_count(uuid, jsonb) to authenticated;
revoke all on function stk_opening(uuid, jsonb) from public, anon;
grant execute on function stk_opening(uuid, jsonb) to authenticated;
revoke all on function stk_decide(uuid, uuid, boolean, text) from public, anon;
grant execute on function stk_decide(uuid, uuid, boolean, text) to authenticated;
revoke all on function stk_reverse(uuid, uuid, text) from public, anon;
grant execute on function stk_reverse(uuid, uuid, text) to authenticated;
revoke all on function stk_overview() from public, anon;
grant execute on function stk_overview() to authenticated;
revoke all on function stk_item(uuid) from public, anon;
grant execute on function stk_item(uuid) to authenticated;
revoke all on function stk_project_lines(uuid) from public, anon;
grant execute on function stk_project_lines(uuid) to authenticated;
revoke all on function stk_choices() from public, anon;
grant execute on function stk_choices() to authenticated;
revoke all on function stk_request_lines(uuid) from public, anon;
grant execute on function stk_request_lines(uuid) to authenticated;
-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function pur_shopping_list(uuid, uuid, text) from public, anon;
grant execute on function pur_shopping_list(uuid, uuid, text) to authenticated;
revoke all on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) from public, anon;
grant execute on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function stk_on(uuid) from public, anon, authenticated;
revoke all on function stk_can_record() from public, anon, authenticated;
revoke all on function stk_actor() from public, anon, authenticated;
revoke all on function stk_reader() from public, anon, authenticated;
revoke all on function stk_warehouse(uuid) from public, anon, authenticated;
revoke all on function stk_site(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_place(uuid, text) from public, anon, authenticated;
revoke all on function stk_line(uuid, uuid, int) from public, anon, authenticated;
revoke all on function stk_item_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_item_lock(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_received(uuid, int, text) from public, anon, authenticated;
revoke all on function stk_conv(uuid, int, numeric) from public, anon, authenticated;
revoke all on function stk_auto_item(purchase_lines) from public, anon, authenticated;
revoke all on function stk_ensure_match(purchase_lines) from public, anon, authenticated;
revoke all on function stk_lot_for_line(purchase_lines) from public, anon, authenticated;
revoke all on function stk_try_lot(purchase_lines) from public, anon, authenticated;
revoke all on function stk_balance(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_layer_balance(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function stk_layers(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_receipt_moves(purchase_lines, uuid) from public, anon, authenticated;
revoke all on function pr_item_in_use(uuid) from public, anon, authenticated;
revoke all on function stk_item_fixed() from public, anon, authenticated;
revoke all on function stk_balances(uuid) from public, anon, authenticated;
revoke all on function stk_item_balance(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function stk_line_in(uuid, int) from public, anon, authenticated;
revoke all on function stk_take(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function stk_lock_items(uuid[], text[]) from public, anon, authenticated;
revoke all on function stk_check_record(uuid) from public, anon, authenticated;
revoke all on function stk_cover(uuid, uuid, uuid, uuid, uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function stk_place_name(uuid) from public, anon, authenticated;
revoke all on function stk_record_json(uuid) from public, anon, authenticated;
revoke all on function stk_line_json(purchase_lines) from public, anon, authenticated;
revoke all on function stk_guard_line() from public, anon, authenticated;
revoke all on function stk_guard_void() from public, anon, authenticated;
revoke all on function stk_inventory_frozen() from public, anon, authenticated;
revoke all on function stk_events_immutable() from public, anon, authenticated;
revoke all on function pr_portion_purchased(uuid) from public, anon, authenticated;
revoke all on function pr_line_purchased(uuid) from public, anon, authenticated;
revoke all on function pr_portion_from_stock(uuid) from public, anon, authenticated;
revoke all on function pr_line_from_stock(uuid) from public, anon, authenticated;
revoke all on function pr_portion_bought(uuid) from public, anon, authenticated;
revoke all on function pr_line_bought(uuid) from public, anon, authenticated;
revoke all on function pur_purchase_view(uuid) from public, anon, authenticated;
