-- 0105 — WorkMate Stage 2C: owner-confirmed stock cost moves (the money of stock).
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- (Warehouse cost assignment, Project-to-project material cost transfers,
-- §3.8); answers: docs/superpowers/specs/2026-10-24-workmate-stage2bc-questions.md
-- (all A); plan: docs/superpowers/plans/2026-10-26-workmate-stage2c-cost-moves.md.
-- Builds on 0104 (2B-a, quantities). Stock stays switched off until the joint launch.
--
-- ── 1. Whose cost goods are (the HOLDER). The company (null) or a project
--    (its folder). Every stock move row now carries the holder of the goods
--    it moved; goods entering stock take their lot's own holder (a warehouse
--    purchase: the company; leftovers or traced opening stock: their
--    project — 12 Oct: leftovers keep their project's cost, even in the
--    warehouse). Quantities are kept per (lot, layer, holder, place).
--
-- ── 2. When goods cross holders, the server asks the main owner. After
--    every physical move: goods arriving at a project held by someone else
--    → a PENDING cost move to that project ("Cost assignment pending" from
--    the company, Q11; "Cost transfer pending" from another project, Q12);
--    a company lot's goods brought back to the warehouse while a project
--    holds them → a pending cost move back to company stock (Q10). Until
--    the main owner approves, the cost stays where it was. A pending cost
--    move covers what is STILL there: goods that left before approval are
--    not charged (Q10, "the pending assignment simply shrinks"); approval is
--    whole or nothing for what is there (Q20). Reject keeps the movement and
--    the cost where it was (Q19); a stock recorder resubmits the cost request
--    for the same movement, with a note.
--
-- ── 3. What a portion is worth (Q12). By lot: a purchase line's item amount
--    less its discount shares plus its delivery-fee shares, over the line's
--    quantity in item units. The line's base holder starts holding all of it;
--    each approved move takes the line's cost × quantity / the line's
--    quantity, rounded to the centavo, and the LAST portion out of a holder
--    takes what it holds — so the portions of a line always add up to exactly
--    its cost (₱100 for 3 pieces → ₱33.33 + ₱33.33 + ₱33.34).
--    Untraced old stock is worth ₱0 and never asks for a cost move (Q13).
--
-- ── 4. The money (Q14, Q15, Q24, Q25). Approval writes ordinary expense
--    rows tied to the cost move (expenses.stk_cost_move_id), so every place
--    that shows Spent reads them like any other row:
--      receiving project — funded like a purchase (pur_fund): its periods for
--      the month it RECEIVED the goods, earliest billing number first, the
--      rest Cover; rows "From warehouse — item" / "Moved from A — item";
--      giving project — negative rows on every (billing period, Cover) group
--      that carried that lot's cost for it (its purchase line rows, its share
--      of the delivery fee, earlier cost-move rows), in proportion, to the
--      centavo (largest remainder, like fee shares); "Moved to B — item" /
--      "Back to company stock — item".
--    Company stock is never in any project's Spent nor in G&A. A confirmed
--    warehouse loss of company-held goods moves their value to COMPANY STOCK
--    LOSS with the count (Q27) — no Spent anywhere; a project's own leftovers
--    lost stay its cost. Every peso of a line is in exactly one place.
--    Client billing is never changed (Q25).
--
-- ── 5. Never edited (Q21–Q23). An approved cost move is reversed by the
--    main owner with a reason (its rows removed; refused while later moves
--    depend on it); a physical record is not reversed while an approved cost
--    move rides on it. A purchase line's price or quantity can't change while
--    approved cost moves value its lot — and neither can WHERE the purchase's
--    cost sits (its billing periods and Cover): a correction, re-funding or
--    approved change request that would move its rows waits until those cost
--    moves are reversed (rev 2). Into or out of a completed project:
--    refused until it is reopened (Q16).
--
-- Who: stock recorders (0104) cause cost moves by moving goods and may
-- resubmit a rejected one; only the MAIN OWNER approves, rejects and
-- reverses. Values are shown to owner accounts only (Q28). Each call carries
-- an operation id (pur_ops). Locks: the item, then each project charged
-- (pur_folder), in one sorted pass — the order purchases use.

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- Whose cost the moved goods are: a project (folder) or null = the company.
alter table stk_moves add column if not exists holder uuid;

-- A cost move: quantity of one lot and layer, at one place, from one holder
-- to another (null = company stock). 'loss' = company stock → company stock
-- loss (no place: the goods left stock).
create table if not exists stk_cost_moves (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('assign', 'transfer', 'back', 'loss')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  record_id uuid not null references stk_records(id),
  move_id bigint not null references stk_moves(id),
  lot_id uuid not null references stk_lots(id),
  layer uuid not null references stk_records(id),
  location uuid references stk_locations(id),
  from_folder uuid,
  to_folder uuid,
  quantity numeric(14,3) not null check (quantity > 0),
  approved_quantity numeric(14,3) check (approved_quantity > 0),
  value numeric(14,2) check (value >= 0),
  basis_value numeric(14,2),
  basis_quantity numeric(14,3),
  basis_alloc jsonb,                 -- where its purchase's cost sat when approved: {period|folder|cover: ₱}
  received_on date not null,
  resubmits uuid references stk_cost_moves(id),
  note text not null default '' check (char_length(note) <= 500),
  requested_by uuid not null references profiles(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  reversed_by uuid references profiles(id),
  reversed_at timestamptz,
  reverse_reason text not null default '' check (char_length(reverse_reason) <= 500),
  check ((kind = 'loss') = (location is null)),
  check (kind <> 'loss' or (from_folder is null and to_folder is null)),
  check (kind <> 'assign' or (from_folder is null and to_folder is not null)),
  check (kind <> 'transfer' or (from_folder is not null and to_folder is not null and from_folder <> to_folder)),
  check (kind <> 'back' or (from_folder is not null and to_folder is null)),
  check ((status = 'approved') = (approved_quantity is not null and value is not null)),
  check (reversed_at is null or status = 'approved')
);
create index if not exists stk_cost_moves_lot on stk_cost_moves (lot_id, layer);
create index if not exists stk_cost_moves_record on stk_cost_moves (record_id);
create index if not exists stk_cost_moves_owner on stk_cost_moves (owner_id, status, requested_at);
alter table stk_cost_moves enable row level security;

-- The expense rows an approved cost move wrote (both sides).
alter table expenses add column if not exists stk_cost_move_id uuid references stk_cost_moves(id);
create index if not exists expenses_stk_cost_move on expenses (stk_cost_move_id) where stk_cost_move_id is not null;

alter table stk_events drop constraint if exists stk_events_kind_check;
alter table stk_events add constraint stk_events_kind_check
  check (kind in ('switched', 'matched', 'unmatched', 'confirmed', 'rejected', 'withdrawn', 'reversed',
                  'cost_requested', 'cost_approved', 'cost_rejected', 'cost_resubmitted', 'cost_withdrawn', 'cost_reversed'));
alter table stk_events add column if not exists cost_move_id uuid references stk_cost_moves(id);

-- Goods entering stock take their lot's own holder (receipts: the company;
-- leftovers and traced opening stock: their project). 0104's inflow paths
-- need no change.
create or replace function stk_moves_holder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.from_location is null then
    new.holder := (select lt.cost_folder_id from stk_lots lt where lt.id = new.lot_id);
  end if;
  return new;
end;
$$;
drop trigger if exists stk_moves_holder on stk_moves;
create trigger stk_moves_holder before insert on stk_moves
  for each row execute function stk_moves_holder();

-- ════ 2. Holders: quantities, values ═════════════════════════════════

-- What one holder has of a lot's layer at a place: live moves in and out
-- with that holder, plus approved cost moves re-labelling quantity there.
create or replace function stk_bucket_balance(p_lot uuid, p_layer uuid, p_holder uuid, p_loc uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(case when m.to_location = p_loc then m.quantity else -m.quantity end)
                     from stk_moves m join stk_records r on r.id = m.record_id
                    where m.lot_id = p_lot and m.layer = p_layer and m.holder is not distinct from p_holder
                      and (m.to_location = p_loc or m.from_location = p_loc)
                      and r.status = 'done' and r.reversed_at is null), 0)
       + coalesce((select sum(case when c.to_folder is not distinct from p_holder then c.approved_quantity else 0 end
                            - case when c.from_folder is not distinct from p_holder then c.approved_quantity else 0 end)
                     from stk_cost_moves c
                    where c.lot_id = p_lot and c.layer = p_layer and c.location = p_loc
                      and c.status = 'approved' and c.reversed_at is null), 0)
$$;

-- Every non-zero bucket of a company (optionally one item): lot, layer,
-- holder, place, the day its goods were received, quantity.
create or replace function stk_buckets(p_owner uuid, p_item uuid default null)
returns table (lot_id uuid, layer uuid, holder uuid, location_id uuid, received_on date, received_at timestamptz, quantity numeric)
language sql stable security definer set search_path = public as $$
  select x.lot_id, x.layer, x.holder, x.location_id, lr.on_date, lr.recorded_at, sum(x.q)
    from (select m.lot_id, m.layer, m.holder, m.to_location as location_id, m.quantity as q
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.to_location is not null and r.status = 'done' and r.reversed_at is null
          union all
          select m.lot_id, m.layer, m.holder, m.from_location, -m.quantity
            from stk_moves m join stk_records r on r.id = m.record_id
           where m.owner_id = p_owner and m.from_location is not null and r.status = 'done' and r.reversed_at is null
          union all
          select c.lot_id, c.layer, c.to_folder, c.location, c.approved_quantity
            from stk_cost_moves c
           where c.owner_id = p_owner and c.location is not null and c.status = 'approved' and c.reversed_at is null
          union all
          select c.lot_id, c.layer, c.from_folder, c.location, -c.approved_quantity
            from stk_cost_moves c
           where c.owner_id = p_owner and c.location is not null and c.status = 'approved' and c.reversed_at is null) x
    join stk_lots lt on lt.id = x.lot_id
    join stk_records lr on lr.id = x.layer
   where p_item is null or lt.item_id = p_item
   group by x.lot_id, x.layer, x.holder, x.location_id, lr.on_date, lr.recorded_at
  having sum(x.q) <> 0
$$;

-- A purchase lot's cost and quantity (Q12): the line's item amount less its
-- discount shares plus its delivery-fee shares; the line in item units.
-- Untraced lots: (0, 0).
create or replace function stk_lot_basis(p_lot uuid, out value numeric, out quantity numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(round(l.gross_amount
                        - coalesce((select sum(s.amount) from purchase_charge_shares s
                                      join purchase_charges c on c.id = s.charge_id and c.kind = 'discount'
                                     where s.line_id = l.id), 0)
                        + coalesce((select sum(s.amount) from purchase_charge_shares s
                                      join purchase_charges c on c.id = s.charge_id and c.kind = 'delivery_fee'
                                     where s.line_id = l.id), 0), 2), 0),
         coalesce(stk_conv(l.purchase_id, l.line_no, l.quantity), 0)
    from stk_lots lt
    left join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
   where lt.id = p_lot
$$;

-- Where a purchase's cost sits: its expense rows (lines and delivery fees),
-- summed by billing period, project (no period) and Cover. Every key and sum
-- must stay the same while approved cost moves rely on the purchase (rev 2).
create or replace function stk_purchase_alloc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(x.k, x.amount order by x.k), '{}'::jsonb)
    from (select coalesce(e.project_id::text, '-') || '|' || coalesce(e.folder_id::text, '-') || '|' || e.cover_expense::text as k,
                 round(sum(e.amount), 2) as amount
            from expenses e
           where e.purchase_line_id in (select l.id from purchase_lines l where l.purchase_id = p_purchase)
              or e.purchase_charge_id in (select c.id from purchase_charges c where c.purchase_id = p_purchase)
           group by 1) x
$$;

-- What a holder holds of a lot, in value and quantity: the lot's own holder
-- starts with all of it; approved, unreversed cost moves add and take.
create or replace function stk_held(p_lot uuid, p_holder uuid, out value numeric, out quantity numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(case when lt.cost_folder_id is not distinct from p_holder then b.value else 0 end, 0)
         + coalesce((select sum(c.value) from stk_cost_moves c
                      where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
                        and c.kind <> 'loss' and c.to_folder is not distinct from p_holder), 0)
         - coalesce((select sum(c.value) from stk_cost_moves c
                      where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
                        and c.from_folder is not distinct from p_holder), 0),
         coalesce(case when lt.cost_folder_id is not distinct from p_holder then b.quantity else 0 end, 0)
         + coalesce((select sum(c.approved_quantity) from stk_cost_moves c
                      where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
                        and c.kind <> 'loss' and c.to_folder is not distinct from p_holder), 0)
         - coalesce((select sum(c.approved_quantity) from stk_cost_moves c
                      where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
                        and c.from_folder is not distinct from p_holder), 0)
    from stk_lots lt, stk_lot_basis(p_lot) b
   where lt.id = p_lot
$$;

-- The value of p_qty of a lot leaving a holder (Q12): the line's cost ×
-- qty / the line's quantity, to the centavo — and the LAST of what a holder
-- has takes what it holds, so a line's portions always add up to exactly its
-- cost (₱100 for 3 pieces → ₱33.33 + ₱33.33 + ₱33.34). Never more than the
-- holder holds.
create or replace function stk_cost_value(p_lot uuid, p_holder uuid, p_qty numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  h record;
  b record;
begin
  select * into h from stk_held(p_lot, p_holder);
  if h.quantity is null or h.quantity <= 0 or p_qty > h.quantity then
    raise exception 'COST_BASIS' using errcode = 'P0001',
      hint = 'That holder does not hold this much of the lot''s cost.';
  end if;
  if p_qty = h.quantity then
    return h.value;
  end if;
  select * into b from stk_lot_basis(p_lot);
  return least(h.value, round(b.value * p_qty / b.quantity, 2));
end;
$$;

-- What a pending cost move still covers: its quantity, but never more than
-- the holder still has there after the earlier pending requests on the
-- same goods (Q10 — goods that left before approval are not charged).
create or replace function stk_cost_effective(p_cost uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, least(c.quantity,
           stk_bucket_balance(c.lot_id, c.layer, c.from_folder, c.location)
           - coalesce((select sum(x.quantity) from stk_cost_moves x
                        where x.lot_id = c.lot_id and x.layer = c.layer and x.location = c.location
                          and x.from_folder is not distinct from c.from_folder and x.status = 'pending'
                          and (x.requested_at, x.id) < (c.requested_at, c.id)), 0)))
    from stk_cost_moves c where c.id = p_cost
$$;

-- A project's name for a row: "Main" or "Main — Additional Works job".
create or replace function stk_folder_name(p_folder uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(par.name || ' — ', '') || f.name
                     from folders f left join folders par on par.id = f.parent_folder_id where f.id = p_folder),
                  (select l.folder_name from stk_locations l where l.folder_id = p_folder limit 1), 'a project')
$$;

-- Is a project (or the project its job belongs to) completed?
create or replace function stk_folder_completed(p_folder uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select f.completed_at is not null or par.completed_at is not null
                     from folders f left join folders par on par.id = f.parent_folder_id where f.id = p_folder), false)
$$;

-- ════ 3. Taking goods: oldest received first, then whose cost ════════

-- Take p_qty of an item from a place: oldest received layer first (0104),
-- and within a layer the goods NOT yet the place's own holder first (goods
-- waiting for a cost assignment leave before goods already charged here).
-- Returns [{lot_id, layer, holder, quantity}]. The caller holds the item's lock.
create or replace function stk_take(p_owner uuid, p_item uuid, p_from uuid, p_qty numeric, p_lot uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_home uuid := (select l.folder_id from stk_locations l where l.id = p_from);
  v_left numeric := p_qty;
  v_take numeric;
  v_out jsonb := '[]'::jsonb;
begin
  for v in select b.lot_id, b.layer, b.holder, b.quantity as bal from stk_buckets(p_owner, p_item) b
            where b.location_id = p_from and b.quantity > 0 and (p_lot is null or b.lot_id = p_lot)
            order by b.received_on, b.received_at, b.layer, (b.holder is not distinct from v_home), b.holder
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v.bal);
    v_out := v_out || jsonb_build_object('lot_id', v.lot_id, 'layer', v.layer, 'holder', v.holder, 'quantity', v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'NOT_ENOUGH' using errcode = 'P0001',
      hint = 'Only ' || (p_qty - v_left) || ' there.';
  end if;
  return v_out;
end;
$$;

-- Every bucket a record put goods in still holds zero or more (after a reversal).
create or replace function stk_check_record(p_record uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  for v in select distinct m.lot_id, m.layer, m.holder, m.to_location from stk_moves m
            where m.record_id = p_record and m.to_location is not null loop
    if stk_layer_balance(v.lot_id, v.layer, v.to_location) < 0
       or stk_bucket_balance(v.lot_id, v.layer, v.holder, v.to_location) < 0 then
      raise exception 'MOVED_ON' using errcode = 'P0001',
        hint = 'Those goods have moved on. Reverse the later records first.';
    end if;
  end loop;
end;
$$;

-- ════ 4. Asking the main owner ═══════════════════════════════════════

-- After a physical record: a pending cost move for every move row whose goods
-- arrive where someone else holds their cost (see the header, §2).
create or replace function stk_cost_requests(p_record uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_n int := 0;
  v_id uuid;
begin
  for m in select x.id, x.owner_id, x.lot_id, x.layer, x.holder, x.to_location, x.quantity, r.on_date,
                  lt.untraced, lt.cost_folder_id, l.kind as loc_kind, l.folder_id as loc_folder
             from stk_moves x
             join stk_records r on r.id = x.record_id
             join stk_lots lt on lt.id = x.lot_id
             join stk_locations l on l.id = x.to_location
            where x.record_id = p_record and x.from_location is not null and not lt.untraced
            order by x.id
  loop
    v_id := null;
    if m.loc_kind = 'site' and m.holder is distinct from m.loc_folder then
      insert into stk_cost_moves (owner_id, kind, record_id, move_id, lot_id, layer, location, from_folder, to_folder,
                                  quantity, received_on, requested_by)
      values (m.owner_id, case when m.holder is null then 'assign' else 'transfer' end, p_record, m.id, m.lot_id, m.layer,
              m.to_location, m.holder, m.loc_folder, m.quantity, m.on_date, auth.uid())
      returning id into v_id;
    elsif m.loc_kind = 'warehouse' and m.holder is not null and m.cost_folder_id is null then
      insert into stk_cost_moves (owner_id, kind, record_id, move_id, lot_id, layer, location, from_folder, to_folder,
                                  quantity, received_on, requested_by)
      values (m.owner_id, 'back', p_record, m.id, m.lot_id, m.layer, m.to_location, m.holder, null, m.quantity, m.on_date, auth.uid())
      returning id into v_id;
    end if;
    if v_id is not null then
      insert into stk_events (owner_id, kind, record_id, cost_move_id, actor_id)
      values (m.owner_id, 'cost_requested', p_record, v_id, auth.uid());
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- A confirmed loss of company-held goods (a count): their value moves to
-- company stock loss with the confirmation (Q27). No expense row.
create or replace function stk_cost_losses(p_record uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  m record;
  v_n int := 0;
  v_value numeric;
  b record;
begin
  for m in select x.id, x.owner_id, x.lot_id, x.layer, x.quantity, r.on_date, lt.purchase_id
             from stk_moves x join stk_records r on r.id = x.record_id join stk_lots lt on lt.id = x.lot_id
            where x.record_id = p_record and x.to_location is null and x.holder is null and not lt.untraced
            order by x.id
  loop
    -- The lot's row: a correction of its purchase at this moment waits (or is seen).
    perform 1 from stk_lots lt where lt.id = m.lot_id for update;
    v_value := stk_cost_value(m.lot_id, null, m.quantity);
    select * into b from stk_lot_basis(m.lot_id);
    insert into stk_cost_moves (owner_id, kind, status, record_id, move_id, lot_id, layer, location, quantity,
                                approved_quantity, value, basis_value, basis_quantity, basis_alloc, received_on,
                                requested_by, decided_by, decided_at)
    values (m.owner_id, 'loss', 'approved', p_record, m.id, m.lot_id, m.layer, null, m.quantity,
            m.quantity, v_value, b.value, b.quantity, stk_purchase_alloc(m.purchase_id), m.on_date, auth.uid(), auth.uid(), now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- The (billing period, folder, Cover) groups carrying a lot's cost for a
-- project: its purchase line rows, its share of the delivery-fee rows (when
-- the lot is that project's own purchase), and every approved cost-move row
-- of the lot in that project. Amount = what each group still carries.
create or replace function stk_cost_carriers(p_lot uuid, p_holder uuid)
returns table (project_id uuid, folder_id uuid, cover boolean, amount numeric)
language sql stable security definer set search_path = public as $$
  select g.project_id, g.folder_id, g.cover, sum(g.amt)
    from (
      -- the lot's own purchase line rows
      select e.project_id, e.folder_id, e.cover_expense as cover, e.amount as amt
        from stk_lots lt
        join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
        join expenses e on e.purchase_line_id = l.id
       where lt.id = p_lot and lt.cost_folder_id = p_holder
      union all
      -- its share of each delivery-fee row of its project
      select e.project_id, e.folder_id, e.cover_expense, e.amount * s.amount / t.total
        from stk_lots lt
        join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
        join purchase_charge_shares s on s.line_id = l.id
        join purchase_charges c on c.id = s.charge_id and c.kind = 'delivery_fee'
        join (select sh.charge_id, sum(sh.amount) as total
                from purchase_charge_shares sh join purchase_lines l2 on l2.id = sh.line_id
               where l2.folder_id = p_holder group by sh.charge_id) t on t.charge_id = c.id and t.total > 0
        join expenses e on e.purchase_charge_id = c.id
        left join projects pp on pp.id = e.project_id
       where lt.id = p_lot and lt.cost_folder_id = p_holder and coalesce(e.folder_id, pp.folder_id) = p_holder
      union all
      -- earlier cost moves of this lot, in and out of this project
      select e.project_id, e.folder_id, e.cover_expense, e.amount
        from stk_cost_moves c
        join expenses e on e.stk_cost_move_id = c.id
        left join projects pp on pp.id = e.project_id
       where c.lot_id = p_lot and c.status = 'approved' and c.reversed_at is null
         and coalesce(e.folder_id, pp.folder_id) = p_holder) g
   group by g.project_id, g.folder_id, g.cover
$$;

-- Write an approved cost move's expense rows (header, §4). The caller holds
-- the projects' locks and sets dacs.purchase_write.
create or replace function stk_cost_rows(p_cost uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c stk_cost_moves;
  v_item text;
  v_cat text;
  v_label text;
  v_split record;
  v_splits jsonb;
  v_n int;
  v_k int;
  v_groups record;
  v_g jsonb;
  v_weights numeric[] := '{}';
  v_keys jsonb := '[]'::jsonb;
  v_shares numeric[];
  v_carried numeric := 0;
  v_rows jsonb := '[]'::jsonb;
  i int;
begin
  select * into c from stk_cost_moves where id = p_cost;
  select ci.name, coalesce(nullif(l.category, ''), 'Materials') into v_item, v_cat
    from stk_lots lt join pr_catalog_items ci on ci.id = lt.item_id
    left join purchase_lines l on l.purchase_id = lt.purchase_id and l.line_no = lt.line_no
   where lt.id = c.lot_id;
  -- Into the receiving project, funded like a purchase for the month it received the goods.
  if c.to_folder is not null and c.value > 0 then
    v_label := case when c.kind = 'assign' then 'From warehouse — ' else 'Moved from ' || stk_folder_name(c.from_folder) || ' — ' end || v_item;
    select coalesce(jsonb_agg(jsonb_build_object('period_id', f.period_id, 'amount', f.amount, 'cover', f.cover) order by f.n), '[]'::jsonb)
      into v_splits
      from pur_fund(c.owner_id, c.to_folder, c.received_on, c.value) with ordinality f(period_id, amount, cover, review, n);
    v_n := jsonb_array_length(v_splits);
    v_k := 0;
    for v_split in select * from jsonb_to_recordset(v_splits) as x(period_id uuid, amount numeric, cover boolean) loop
      v_k := v_k + 1;
      insert into expenses (owner_id, project_id, folder_id, expense_name, category, quantity, amount, date_time, notes,
                            payment_method, cover_expense, split_group, split_index, split_total, stk_cost_move_id)
      values (c.owner_id, v_split.period_id, case when v_split.period_id is null then c.to_folder end,
              v_label || case when v_n > 1 then ' (' || v_k || '/' || v_n || ')' else '' end, v_cat,
              case when v_n > 1 then 1 else c.approved_quantity end, v_split.amount, c.received_on::text,
              'Stock cost move approved by the owner', '', v_split.cover,
              case when v_n > 1 then 'stkcost:' || c.id || ':in' end, case when v_n > 1 then v_k end,
              case when v_n > 1 then v_n end, c.id);
      v_rows := v_rows || jsonb_build_object('side', 'in', 'period_id', v_split.period_id, 'amount', v_split.amount, 'cover', v_split.cover);
    end loop;
  end if;
  -- Out of the giving project, from every group that carried this lot's cost, in proportion.
  if c.from_folder is not null and c.value > 0 then
    v_label := case when c.kind = 'back' then 'Back to company stock — ' else 'Moved to ' || stk_folder_name(c.to_folder) || ' — ' end || v_item;
    for v_groups in select * from stk_cost_carriers(c.lot_id, c.from_folder) g where g.amount > 0
                     order by g.amount desc, g.project_id nulls last, g.cover loop
      v_weights := v_weights || v_groups.amount;
      v_carried := v_carried + v_groups.amount;
      v_keys := v_keys || jsonb_build_object('project_id', v_groups.project_id, 'folder_id', v_groups.folder_id, 'cover', v_groups.cover);
    end loop;
    if v_carried + 0.01 < c.value then
      raise exception 'COST_BASIS' using errcode = 'P0001',
        hint = 'The giving project carries less of this lot''s cost than the move.';
    end if;
    v_shares := pur_prorate(c.value, v_weights);
    v_n := coalesce(array_length(v_shares, 1), 0);
    for i in 1 .. v_n loop
      continue when v_shares[i] <= 0;
      v_g := v_keys -> (i - 1);
      insert into expenses (owner_id, project_id, folder_id, expense_name, category, quantity, amount, date_time, notes,
                            payment_method, cover_expense, split_group, split_index, split_total, stk_cost_move_id)
      values (c.owner_id, (v_g ->> 'project_id')::uuid, (v_g ->> 'folder_id')::uuid,
              v_label || case when v_n > 1 then ' (' || i || '/' || v_n || ')' else '' end, v_cat,
              case when v_n > 1 then 1 else c.approved_quantity end, -v_shares[i], c.received_on::text,
              'Stock cost move approved by the owner', '', (v_g ->> 'cover')::boolean,
              case when v_n > 1 then 'stkcost:' || c.id || ':out' end, case when v_n > 1 then i end,
              case when v_n > 1 then v_n end, c.id);
      v_rows := v_rows || jsonb_build_object('side', 'out', 'period_id', v_g ->> 'project_id', 'amount', -v_shares[i],
                                             'cover', (v_g ->> 'cover')::boolean);
    end loop;
  end if;
  return v_rows;
end;
$$;

-- ════ 5. 0104's operations, now cost-aware ═══════════════════════════

-- 0104's stk_move: every move row carries the holder of its goods; a return
-- takes the issue's goods as their cost now stands; afterwards the main
-- owner is asked wherever goods arrive in someone else's cost (§2).
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
  v_h record;
  v_can numeric;
  v_take numeric;
  v_first uuid;
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
    -- what this issue moved and has not had back, and to what is still there
    -- — taken as their cost now stands: the site's own first when the issue's
    -- cost assignment was approved, else the goods still waiting for it (2C).
    v_takes := '[]'::jsonb;
    v_left := v_qty;
    for v_m in select m.lot_id, m.layer, sum(m.quantity) as qty, max(m.id) as last_id, (array_agg(m.holder order by m.id))[1] as holder,
                      bool_or(exists (select 1 from stk_cost_moves c where c.move_id = m.id and c.status = 'approved'
                                         and c.reversed_at is null)) as assigned
                 from stk_moves m
                where m.record_id = v_issue.id and (v_lot is null or m.lot_id = v_lot)
                group by m.lot_id, m.layer order by max(m.id) desc
    loop
      exit when v_left <= 0;
      v_can := v_m.qty - coalesce((select sum(x.quantity) from stk_moves x join stk_records r on r.id = x.record_id
                                    where r.returns_record = v_issue.id and r.status = 'done' and r.reversed_at is null
                                      and x.lot_id = v_m.lot_id and x.layer = v_m.layer), 0);
      v_can := least(v_can, stk_layer_balance(v_m.lot_id, v_m.layer, v_from));
      continue when v_can <= 0;
      v_first := case when v_m.assigned then (select l.folder_id from stk_locations l where l.id = v_from) else v_m.holder end;
      for v_h in select b.holder, b.quantity from stk_buckets(v_owner, v_item) b
                  where b.lot_id = v_m.lot_id and b.layer = v_m.layer and b.location_id = v_from and b.quantity > 0
                  order by (b.holder is not distinct from v_first) desc, b.holder
      loop
        exit when v_can <= 0 or v_left <= 0;
        v_take := least(v_can, v_left, v_h.quantity);
        v_takes := v_takes || jsonb_build_object('lot_id', v_m.lot_id, 'layer', v_m.layer, 'holder', v_h.holder, 'quantity', v_take);
        v_can := v_can - v_take;
        v_left := v_left - v_take;
      end loop;
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
    insert into stk_moves (owner_id, record_id, lot_id, layer, holder, from_location, to_location, quantity)
    values (v_owner, v_id, (v_t ->> 'lot_id')::uuid, (v_t ->> 'layer')::uuid, (v_t ->> 'holder')::uuid, v_from, v_to,
            (v_t ->> 'quantity')::numeric);
  end loop;
  -- 2C: goods now held by someone else's cost ask the main owner.
  perform stk_cost_requests(v_id);
  if v_req is not null then
    perform stk_cover(v_owner, v_id, v_to_loc.folder_id, v_req, v_item, v_qty, p_body -> 'portion_picks');
  end if;
  v_result := jsonb_build_object('record_id', v_id, 'kind', v_kind, 'lots', v_takes,
                                 'cost_moves', (select coalesce(jsonb_agg(c.id order by c.requested_at, c.id), '[]'::jsonb)
                                                  from stk_cost_moves c where c.record_id = v_id));
  return pur_op_done(v_owner, p_op, 'stk_move', v_result);
end;
$$;
-- 0104's stk_decide: a loss carries the holder of the goods lost, and a loss
-- of company-held goods moves their value to company stock loss (Q27).
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
        insert into stk_moves (owner_id, record_id, lot_id, layer, holder, from_location, quantity)
        values (v_owner, r.id, (v_t ->> 'lot_id')::uuid, (v_t ->> 'layer')::uuid, (v_t ->> 'holder')::uuid, r.to_location,
                (v_t ->> 'quantity')::numeric);
      end loop;
      -- 2C (Q27): company-held goods lost → their value to company stock loss.
      perform stk_cost_losses(r.id);
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
-- 0104's stk_reverse: refused while an approved cost move rides on the record
-- (the main owner reverses that first, Q23); its pending ones are withdrawn;
-- a count's loss value comes back with it.
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
  -- 2C: an approved cost move rides on this record — the main owner reverses it first.
  if exists (select 1 from stk_cost_moves c where c.record_id = r.id and c.kind <> 'loss'
                and c.status = 'approved' and c.reversed_at is null) then
    raise exception 'COST_MOVED' using errcode = 'P0001',
      hint = 'The main owner approved this movement''s cost. Reverse that cost move first (Purchasing → Owner approvals).';
  end if;
  update stk_cost_moves set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(),
                            decision_note = 'The movement was reversed: ' || v_reason
   where record_id = r.id and status = 'pending';
  -- A count's loss value comes back with it.
  update stk_cost_moves set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason
   where record_id = r.id and kind = 'loss' and status = 'approved' and reversed_at is null;
  update stk_records set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason where id = r.id;
  -- What the record put somewhere must still be there (a receipt's layer
  -- included: refused once any of that delivery has moved on).
  perform stk_check_record(r.id);
  insert into stk_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'reversed', r.id, v_reason, auth.uid());
  v_result := jsonb_build_object('record_id', r.id, 'reversed', true);
  return pur_op_done(v_owner, p_op, 'stk_reverse', v_result);
end;
$$;
-- ════ 6. The main owner decides ════════════════════════════════════

-- Approve or reject a pending cost move (Q18–Q20). Approve: whole, for what
-- is still there; refused into or out of a completed project (Q16). Reject:
-- a reason; the goods stay recorded, the cost stays with its holder (Q19).
create or replace function stk_cost_decide(p_op uuid, p_cost uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  c stk_cost_moves;
  v_item uuid;
  v_purchase uuid;
  v_eff numeric;
  v_value numeric;
  b record;
  v_rows jsonb;
  v_result jsonb;
begin
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
  select * into c from stk_cost_moves where id = p_cost and owner_id = v_owner;
  if c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select lt.item_id, lt.purchase_id into v_item, v_purchase from stk_lots lt where lt.id = c.lot_id;
  -- The purchase first (as every purchase write does), so its price cannot change under us.
  if v_purchase is not null then
    perform pur_purchase_lock(v_purchase);
  end if;
  perform stk_lock_items(array[v_item], array_remove(array['pur_folder:' || c.from_folder, 'pur_folder:' || c.to_folder], null));
  select * into c from stk_cost_moves where id = p_cost for update;
  if c.status <> 'pending' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if not p_approve then
    update stk_cost_moves set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = pur_reason(p_note)
     where id = c.id;
    insert into stk_events (owner_id, kind, record_id, cost_move_id, reason, actor_id)
    values (v_owner, 'cost_rejected', c.record_id, c.id, pur_reason(p_note), auth.uid());
    return pur_op_done(v_owner, p_op, 'stk_cost_decide', jsonb_build_object('cost_move_id', c.id, 'status', 'rejected'));
  end if;
  if (c.from_folder is not null and stk_folder_completed(c.from_folder))
     or (c.to_folder is not null and stk_folder_completed(c.to_folder)) then
    raise exception 'COMPLETED_PROJECT' using errcode = 'P0001',
      hint = 'Reopen the project first; the goods'' record stays as it is.';
  end if;
  v_eff := stk_cost_effective(c.id);
  if v_eff <= 0 then
    raise exception 'NOTHING_LEFT' using errcode = 'P0001',
      hint = 'These goods are no longer there. Reject it with a reason.';
  end if;
  v_value := stk_cost_value(c.lot_id, c.from_folder, v_eff);
  select * into b from stk_lot_basis(c.lot_id);
  update stk_cost_moves set status = 'approved', approved_quantity = v_eff, value = v_value,
                            basis_value = b.value, basis_quantity = b.quantity, basis_alloc = stk_purchase_alloc(v_purchase),
                            decided_by = auth.uid(), decided_at = now(), decision_note = pur_note(p_note, 500)
   where id = c.id;
  perform set_config('dacs.purchase_write', 'on', true);
  v_rows := stk_cost_rows(c.id);
  perform set_config('dacs.purchase_write', '', true);
  insert into stk_events (owner_id, kind, record_id, cost_move_id, detail, reason, actor_id)
  values (v_owner, 'cost_approved', c.record_id, c.id, jsonb_build_object('quantity', v_eff, 'value', v_value),
          pur_note(p_note, 500), auth.uid());
  v_result := jsonb_build_object('cost_move_id', c.id, 'status', 'approved', 'quantity', v_eff, 'value', v_value, 'rows', v_rows);
  return pur_op_done(v_owner, p_op, 'stk_cost_decide', v_result);
end;
$$;

-- Reverse an approved cost move (Q23): its rows leave Spent, the record and
-- its reason stay. Refused while later approved moves depend on what it
-- moved (reverse those first). A loss is reversed with its count instead.
create or replace function stk_cost_reverse(p_op uuid, p_cost uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := pur_main_owner();
  v_prev jsonb;
  c stk_cost_moves;
  v_item uuid;
  v_purchase uuid;
  v_reason text := pur_reason(p_reason);
  h record;
  v_result jsonb;
begin
  if not stk_on(v_owner) then
    raise exception 'STOCK_OFF' using errcode = 'P0001';
  end if;
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into c from stk_cost_moves where id = p_cost and owner_id = v_owner;
  if c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select lt.item_id, lt.purchase_id into v_item, v_purchase from stk_lots lt where lt.id = c.lot_id;
  -- The purchase first (as every purchase write does), so its price cannot change under us.
  if v_purchase is not null then
    perform pur_purchase_lock(v_purchase);
  end if;
  perform stk_lock_items(array[v_item], array_remove(array['pur_folder:' || c.from_folder, 'pur_folder:' || c.to_folder], null));
  select * into c from stk_cost_moves where id = p_cost for update;
  if c.status <> 'approved' or c.reversed_at is not null or c.kind = 'loss' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update stk_cost_moves set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason where id = c.id;
  -- Nothing may depend on it: what it gave the receiver is still the receiver's, there.
  select * into h from stk_held(c.lot_id, c.to_folder);
  if h.quantity < 0 or h.value < 0 or stk_bucket_balance(c.lot_id, c.layer, c.to_folder, c.location) < 0 then
    raise exception 'LATER_MOVES_FIRST' using errcode = 'P0001',
      hint = 'Later movements or cost moves rely on this one. Reverse those first.';
  end if;
  perform set_config('dacs.purchase_write', 'on', true);
  delete from expenses where stk_cost_move_id = c.id;
  perform set_config('dacs.purchase_write', '', true);
  insert into stk_events (owner_id, kind, record_id, cost_move_id, reason, actor_id)
  values (v_owner, 'cost_reversed', c.record_id, c.id, v_reason, auth.uid());
  v_result := jsonb_build_object('cost_move_id', c.id, 'reversed', true);
  return pur_op_done(v_owner, p_op, 'stk_cost_reverse', v_result);
end;
$$;

-- After a rejection — or after the main owner reversed an approved cost move
-- (say, to fix the purchase's price) — a stock recorder asks again for the
-- same movement: no second physical record (Q19), with a note (the evidence).
create or replace function stk_cost_resubmit(p_op uuid, p_cost uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := stk_actor();
  v_prev jsonb;
  c stk_cost_moves;
  v_item uuid;
  v_id uuid;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into c from stk_cost_moves where id = p_cost and owner_id = v_owner;
  if c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select lt.item_id into v_item from stk_lots lt where lt.id = c.lot_id;
  perform stk_lock_items(array[v_item]);
  select * into c from stk_cost_moves where id = p_cost for update;
  if not (c.status = 'rejected' or (c.status = 'approved' and c.reversed_at is not null and c.kind <> 'loss'))
     or exists (select 1 from stk_cost_moves x where x.move_id = c.move_id and x.status in ('pending', 'approved')
                   and x.reversed_at is null)
     or exists (select 1 from stk_records r where r.id = c.record_id and (r.status <> 'done' or r.reversed_at is not null)) then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  insert into stk_cost_moves (owner_id, kind, record_id, move_id, lot_id, layer, location, from_folder, to_folder,
                              quantity, received_on, resubmits, note, requested_by)
  values (c.owner_id, c.kind, c.record_id, c.move_id, c.lot_id, c.layer, c.location, c.from_folder, c.to_folder,
          c.quantity, c.received_on, c.id, pur_reason(p_note), auth.uid())
  returning id into v_id;
  insert into stk_events (owner_id, kind, record_id, cost_move_id, reason, actor_id)
  values (v_owner, 'cost_resubmitted', c.record_id, v_id, pur_reason(p_note), auth.uid());
  v_result := jsonb_build_object('cost_move_id', v_id, 'status', 'pending');
  return pur_op_done(v_owner, p_op, 'stk_cost_resubmit', v_result);
end;
$$;

-- ════ 7. Guards ═════════════════════════════════════════════════════

-- Q21: a purchase line's price or quantity cannot change while approved
-- cost moves value its lot (reverse those first) — nor, rev 2, can where the
-- purchase's cost sits: its rows' billing periods and Cover (R81). Checked
-- when a purchase's correction, unit check or re-funding (an approved change
-- request is a correction) is written to its history — after every line,
-- share and row is stored again — so every 2A path is covered.
create or replace function stk_guard_cost_basis() returns trigger
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if new.kind not in ('corrected', 'unit_checked', 'refunded') then
    return null;
  end if;
  -- The lots' rows: a count's loss being confirmed at this moment waits (or is seen).
  perform 1 from stk_lots lt where lt.purchase_id = new.purchase_id order by lt.id for update;
  for v in select lt.id as lot_id, (select b.value from stk_lot_basis(lt.id) b) as v_now,
                  (select b.quantity from stk_lot_basis(lt.id) b) as q_now
             from stk_lots lt where lt.purchase_id = new.purchase_id
  loop
    if exists (select 1 from stk_cost_moves c where c.lot_id = v.lot_id and c.status = 'approved' and c.reversed_at is null
                  and (c.basis_value is distinct from v.v_now or c.basis_quantity is distinct from v.q_now)) then
      raise exception 'STOCK_COST_IN_USE' using errcode = 'P0001',
        hint = 'The owner approved cost moves valued at this line''s price and quantity. Reverse them first.';
    end if;
  end loop;
  if exists (select 1 from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id
              where lt.purchase_id = new.purchase_id and c.status = 'approved' and c.reversed_at is null
                and c.basis_alloc is distinct from stk_purchase_alloc(new.purchase_id)) then
    raise exception 'STOCK_COST_FUNDING' using errcode = 'P0001',
      hint = 'The owner approved stock cost moves that rely on where this purchase''s cost sits — its billing periods and Cover. Reverse them first.';
  end if;
  return null;
end;
$$;
drop trigger if exists stk_guard_cost_basis on purchase_history;
create trigger stk_guard_cost_basis after insert on purchase_history
  for each row execute function stk_guard_cost_basis();
-- 0096's guard on expense rows, extended to cost-move rows: only the stock
-- functions write, change or remove them.
create or replace function pur_guard_expense_row() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('dacs.purchase_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  -- 2C: a stock cost move's rows — the main owner reverses the cost move instead.
  if tg_op in ('UPDATE', 'DELETE') and old.stk_cost_move_id is not null then
    raise exception 'STOCK_COST_ROW' using errcode = 'P0001',
      hint = 'This expense is a stock cost move the owner approved. The main owner reverses the cost move instead.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.stk_cost_move_id is not null then
    raise exception 'STOCK_COST_ROW' using errcode = 'P0001';
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
-- 0096's delete guard, extended: a project with stock or stock cost moves,
-- or a billing period carrying cost-move rows, is never deleted.
create or replace function pur_guard_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'folders' then
    if exists (select 1 from purchase_lines l join purchases pu on pu.id = l.purchase_id
                where l.folder_id = old.id and pu.status = 'recorded') then
      raise exception 'PURCHASES_LIVE' using errcode = 'P0001',
        hint = 'This project has purchases. Void them first, or mark the project completed.';
    end if;
    -- 2C: goods recorded at its site, or a cost move to or from it.
    if exists (select 1 from stk_locations sl join stk_moves m on m.from_location = sl.id or m.to_location = sl.id
                 join stk_records r on r.id = m.record_id
                where sl.folder_id = old.id and r.status = 'done' and r.reversed_at is null)
       or exists (select 1 from stk_cost_moves c where (c.from_folder = old.id or c.to_folder = old.id)
                     and (c.status = 'pending' or (c.status = 'approved' and c.reversed_at is null))) then
      raise exception 'STOCK_LIVE' using errcode = 'P0001',
        hint = 'This project has stock records or stock cost moves. Mark it completed instead.';
    end if;
  elsif exists (select 1 from expenses e
                 where e.project_id = old.id and (e.purchase_line_id is not null or e.purchase_charge_id is not null)) then
    raise exception 'PURCHASES_LIVE' using errcode = 'P0001',
      hint = 'This billing period has purchases. Void them first.';
  elsif exists (select 1 from expenses e where e.project_id = old.id and e.stk_cost_move_id is not null) then
    raise exception 'STOCK_LIVE' using errcode = 'P0001',
      hint = 'This billing period carries stock cost moves. The owner reverses them first.';
  end if;
  return old;
end;
$$;
-- ════ 8. Reading ═════════════════════════════════════════════════════

-- One cost move as the screens show it. Values only for owner accounts (Q28).
create or replace function stk_cost_json(p_cost uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'status', c.status, 'record_id', c.record_id, 'move_id', c.move_id, 'lot_id', c.lot_id,
    'quantity', c.quantity, 'approved_quantity', c.approved_quantity,
    'effective', case when c.status = 'pending' then stk_cost_effective(c.id) end,
    'from_folder', c.from_folder, 'to_folder', c.to_folder,
    'from_name', case when c.from_folder is null then 'Company stock' else stk_folder_name(c.from_folder) end,
    'to_name', case when c.kind = 'loss' then 'Company stock loss' when c.to_folder is null then 'Company stock'
                    else stk_folder_name(c.to_folder) end,
    'received_on', c.received_on, 'note', c.note, 'resubmits', c.resubmits,
    'requested_at', c.requested_at, 'requested_by_name', pur_person_name(c.requested_by),
    'decided_at', c.decided_at, 'decided_by_name', case when c.decided_by is null then null else pur_person_name(c.decided_by) end,
    'decision_note', c.decision_note, 'reversed', c.reversed_at is not null, 'reverse_reason', c.reverse_reason)
    -- Pesos: owner accounts only — for anyone else the keys are not there at all.
    || case when coalesce(is_owner(), false) then jsonb_build_object(
         'value', c.value,
         -- what approving now would charge (the same rule as the approval)
         'estimate', case when c.status = 'pending' and stk_cost_effective(c.id) > 0
                          then stk_cost_value(c.lot_id, c.from_folder, stk_cost_effective(c.id)) end)
       else '{}'::jsonb end
  from stk_cost_moves c where c.id = p_cost
$$;

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
    'lots', (select coalesce(jsonb_agg(jsonb_build_object('lot_id', m.lot_id, 'layer', m.layer, 'holder', m.holder,
                                                           'quantity', m.quantity) order by m.id), '[]'::jsonb)
               from stk_moves m where m.record_id = r.id),
    -- 2C: its cost moves — states for everyone who reads stock, values for owner accounts only (Q28).
    'costs', (select coalesce(jsonb_agg(stk_cost_json(c.id) order by c.requested_at, c.id), '[]'::jsonb)
                from stk_cost_moves c where c.record_id = r.id))
  from stk_records r
  left join pr_catalog_items c on c.id = r.item_id
  left join purchase_lines l on l.purchase_id = r.purchase_id and l.line_no = r.line_no
  left join pr_lines rl on rl.id = r.request_line_id
  where r.id = p_record
$$;

-- The main owner's Owner approvals cards (Q18): every pending cost move, with
-- what it would cost each side — the receiving month, and the giving
-- project's billing periods it comes off — and its evidence.
create or replace function stk_cost_pending() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  -- Stock off: nothing can be decided, so nothing is shown (the tab still opens).
  if not stk_on(v_owner) then
    return '[]'::jsonb;
  end if;
  return (select coalesce(jsonb_agg(stk_cost_json(c.id) || jsonb_build_object(
            'item_name', ci.name, 'item_unit', ci.unit, 'kind_record', r.kind, 'record_on', r.on_date, 'record_note', r.note,
            'record_by_name', pur_person_name(r.recorded_by), 'place_name', stk_place_name(c.location),
            'from_groups', case when c.from_folder is null then '[]'::jsonb else
              (select coalesce(jsonb_agg(jsonb_build_object('project_id', g.project_id, 'cover', g.cover, 'carries', round(g.amount, 2),
                                                            'month', p.month, 'year', p.year, 'billing_number', p.billing_number)
                                         order by p.year, p.billing_number), '[]'::jsonb)
                 from stk_cost_carriers(c.lot_id, c.from_folder) g left join projects p on p.id = g.project_id
                where g.amount > 0) end,
            'completed', (c.from_folder is not null and stk_folder_completed(c.from_folder))
                         or (c.to_folder is not null and stk_folder_completed(c.to_folder)))
          order by c.requested_at, c.id), '[]'::jsonb)
            from stk_cost_moves c
            join stk_records r on r.id = c.record_id
            join stk_lots lt on lt.id = c.lot_id
            join pr_catalog_items ci on ci.id = lt.item_id
           where c.owner_id = v_owner and c.status = 'pending');
end;
$$;

-- Company stock (Q17), by item, for owner accounts: in the warehouse; issued
-- to a project with the cost assignment pending (still company cost);
-- awaiting delivery (bought, not yet received); and company stock loss.
-- Never in any project's Spent, never in G&A.
create or replace function stk_company_stock() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  if not coalesce(is_owner(), false) then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(x.doc order by x.name), '[]'::jsonb) from (
    select ci.name, jsonb_build_object('item_id', ci.id, 'name', ci.name, 'spec', ci.spec, 'unit', ci.unit,
             'in_warehouse', jsonb_build_object('quantity', sum(v.wh_q), 'value', sum(v.wh_v)),
             'issued_pending', jsonb_build_object('quantity', sum(v.site_q), 'value', sum(v.site_v)),
             'awaiting', jsonb_build_object('quantity', sum(v.away_q), 'value', sum(v.away_v)),
             'loss', jsonb_build_object('quantity', sum(v.loss_q), 'value', sum(v.loss_v)),
             'total_value', sum(v.wh_v + v.site_v + v.away_v)) as doc
      from (
        select lt.item_id, q.wh, q.site,
               q.wh as wh_q, round(h.value * q.wh / nullif(h.quantity, 0), 2) as wh_v,
               q.site as site_q, round(h.value * q.site / nullif(h.quantity, 0), 2) as site_v,
               h.quantity - q.wh - q.site as away_q,
               h.value - coalesce(round(h.value * q.wh / nullif(h.quantity, 0), 2), 0)
                       - coalesce(round(h.value * q.site / nullif(h.quantity, 0), 2), 0) as away_v,
               coalesce((select sum(c.approved_quantity) from stk_cost_moves c where c.lot_id = lt.id and c.kind = 'loss'
                           and c.status = 'approved' and c.reversed_at is null), 0) as loss_q,
               coalesce((select sum(c.value) from stk_cost_moves c where c.lot_id = lt.id and c.kind = 'loss'
                           and c.status = 'approved' and c.reversed_at is null), 0) as loss_v
          from stk_lots lt
          cross join lateral stk_held(lt.id, null) h
          cross join lateral (select coalesce(sum(b.quantity) filter (where l.kind = 'warehouse'), 0) as wh,
                                     coalesce(sum(b.quantity) filter (where l.kind = 'site'), 0) as site
                                from stk_buckets(v_owner, lt.item_id) b join stk_locations l on l.id = b.location_id
                               where b.lot_id = lt.id and b.holder is null) q
         where lt.owner_id = v_owner and not lt.untraced and lt.cost_folder_id is null
           and (h.quantity > 0 or q.wh > 0 or q.site > 0)) v
      join pr_catalog_items ci on ci.id = v.item_id
     group by ci.id, ci.name, ci.spec, ci.unit) x);
end;
$$;

-- ════ 9. Who may call what ═══════════════════════════════════════════

revoke all on function stk_cost_decide(uuid, uuid, boolean, text) from public, anon;
grant execute on function stk_cost_decide(uuid, uuid, boolean, text) to authenticated;
revoke all on function stk_cost_reverse(uuid, uuid, text) from public, anon;
grant execute on function stk_cost_reverse(uuid, uuid, text) to authenticated;
revoke all on function stk_cost_resubmit(uuid, uuid, text) from public, anon;
grant execute on function stk_cost_resubmit(uuid, uuid, text) to authenticated;
revoke all on function stk_cost_pending() from public, anon;
grant execute on function stk_cost_pending() to authenticated;
revoke all on function stk_company_stock() from public, anon;
grant execute on function stk_company_stock() to authenticated;
-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function stk_move(uuid, jsonb) from public, anon;
grant execute on function stk_move(uuid, jsonb) to authenticated;
revoke all on function stk_decide(uuid, uuid, boolean, text) from public, anon;
grant execute on function stk_decide(uuid, uuid, boolean, text) to authenticated;
revoke all on function stk_reverse(uuid, uuid, text) from public, anon;
grant execute on function stk_reverse(uuid, uuid, text) to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function stk_moves_holder() from public, anon, authenticated;
revoke all on function stk_bucket_balance(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function stk_buckets(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_lot_basis(uuid) from public, anon, authenticated;
revoke all on function stk_purchase_alloc(uuid) from public, anon, authenticated;
revoke all on function stk_held(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_cost_value(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function stk_cost_effective(uuid) from public, anon, authenticated;
revoke all on function stk_folder_name(uuid) from public, anon, authenticated;
revoke all on function stk_folder_completed(uuid) from public, anon, authenticated;
revoke all on function stk_take(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function stk_check_record(uuid) from public, anon, authenticated;
revoke all on function stk_cost_requests(uuid) from public, anon, authenticated;
revoke all on function stk_cost_losses(uuid) from public, anon, authenticated;
revoke all on function stk_cost_carriers(uuid, uuid) from public, anon, authenticated;
revoke all on function stk_cost_rows(uuid) from public, anon, authenticated;
revoke all on function stk_cost_json(uuid) from public, anon, authenticated;
revoke all on function stk_record_json(uuid) from public, anon, authenticated;
revoke all on function stk_guard_cost_basis() from public, anon, authenticated;
revoke all on function pur_guard_expense_row() from public, anon, authenticated;
revoke all on function pur_guard_delete() from public, anon, authenticated;
