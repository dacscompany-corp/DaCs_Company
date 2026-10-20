-- 0097 — WorkMate Stage 2A-2: the office Purchasing tab and the Buyer switch.
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md
-- (Buyer assignment, Partial buying, One receipt across projects, Office
-- side); answers: docs/superpowers/specs/2026-10-16-workmate-stage2a2-questions.md;
-- plan: docs/superpowers/plans/2026-10-16-workmate-stage2a2-purchasing-office.md.
--
-- ── 1. The Buyer switch. The main owner turns it on per staff account.
--    Who may BUY: an active owner account, or an active staff account of that
--    owner with the switch on — and in both cases only an account allowed the
--    Expenses section (an account focused on other sections, e.g. admin-pm@ =
--    ["pm"], cannot buy; Q3 = B). Every rule is checked on the server, inside
--    the caller's own company (data_owner_id()). Phone purchasing ('workmate',
--    refused by 0096) and the Purchasing tab ('purchasing') need it; the
--    Expenses / Project Control forms ('expenses_form') keep 0096's rule for
--    ordinary entry — but linking a line to a request, picking portions or
--    taking a portion over needs the switch WHATEVER the source (review,
--    16 Oct). Purchase rows themselves are read only by those who may buy;
--    Project Control's staff entry reads the one line it edits through
--    pur_entry_row.
--
-- ── 2. Who is buying what. A request line's quantity already lives in
--    weekly-batch portions (0085). A portion now has a buyer. The office
--    assigns a whole portion or part of it (part = a new portion is split
--    off); a buyer claims an unassigned one ("I'll buy this"). Only the owner
--    reassigns someone else's portion. Assigning is NOT "arranged" — that
--    stays the separate 0086 mark. Every change is a pr_events row.
--
-- ── 3. Bought = covered by purchases, never a counter. A purchase line may
--    link to one request line. Portions PICKED on the form are authoritative:
--    the line covers those and nothing else. Without picks the server covers
--    the buyer's own portions, then unassigned ones (which the buyer then
--    holds), then (owner only) other buyers' — earliest batch first, each up
--    to its Still to buy. Once covered, a line's portions are its history:
--    a correction, replacement or unit check covers the SAME portions again
--    and covers others only for quantity it adds — a price fix never moves
--    coverage to another week. What a line cannot cover is EXTRA and needs a
--    reason and a location (same project or warehouse). The location is
--    where the goods are: the cost stays on the project's line (2C moves
--    cost, with the main owner's approval). A different unit, or a
--    substitute whose important specification differs, covers nothing until
--    the office confirms how much it covers (audited). Covers are rebuilt
--    from the stored purchase lines every time a purchase is recorded,
--    corrected, replaced or voided — in the same transaction as its expense
--    rows — so Bought can never be counted twice and Still to buy is never
--    negative.
--
-- ── 4. Owner approval. A staff correction that moves a cost to another
--    project, or touches a completed project, is sent to the owner as a
--    change request; approving runs the same correct / replace / void. The
--    request keeps the purchase exactly as the staff member saw it; any
--    change to the purchase since (a correction, a unit check, a receipt)
--    makes it stale. The owner sees every field of both versions.
--
-- ── 5. Suppliers and receipts. A simple supplier list. Purchase receipt
--    photos go to a private `purchases/` storage folder: readable only by
--    those who can buy in that company, checked on every download (Dacs Web
--    never hands out a signed link for this folder). Workers, team leaders,
--    clients and partners read nothing purchase-related.
--
-- Outside the money model: nothing here changes how a purchase becomes
-- Spent (0096 is unchanged in that respect).

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- The Buyer switch, one row per staff account that ever had it.
create table if not exists pur_buyers (
  user_id uuid primary key references profiles(id),
  owner_id uuid not null references profiles(id),
  is_buyer boolean not null default false,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);
create table if not exists pur_buyer_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  user_id uuid not null references profiles(id),
  is_buyer boolean not null,
  actor_id uuid not null references profiles(id),
  at timestamptz not null default now()
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  branch text not null default '' check (char_length(branch) <= 120),
  contact text not null default '' check (char_length(contact) <= 200),
  active boolean not null default true,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists suppliers_owner_name_branch on suppliers (owner_id, lower(btrim(name)), lower(btrim(branch)));

-- Who is buying a portion. Null = unassigned.
alter table pr_line_portions add column if not exists buyer_id uuid references profiles(id);
alter table pr_line_portions add column if not exists assigned_by uuid references profiles(id);
alter table pr_line_portions add column if not exists assigned_at timestamptz;
create index if not exists pr_line_portions_buyer on pr_line_portions (buyer_id) where buyer_id is not null;

-- Who actually bought (the encoder is recorded_by), and the supplier picked.
alter table purchases add column if not exists bought_by uuid references profiles(id);
alter table purchases add column if not exists supplier_id uuid references suppliers(id);
alter table purchases drop constraint if exists purchases_source_check;
alter table purchases add constraint purchases_source_check check (source in ('expenses_form', 'workmate', 'purchasing'));
alter table purchase_history drop constraint if exists purchase_history_kind_check;
alter table purchase_history add constraint purchase_history_kind_check
  check (kind in ('recorded', 'corrected', 'refunded', 'voided', 'replaced', 'unit_checked'));

-- A purchase line's link to a request, and what it did NOT cover.
alter table purchase_lines add column if not exists request_line_id uuid references pr_lines(id);
alter table purchase_lines add column if not exists portion_picks jsonb not null default '[]'::jsonb;
alter table purchase_lines add column if not exists covered_qty numeric(14,3) not null default 0 check (covered_qty >= 0);
alter table purchase_lines add column if not exists extra_qty numeric(14,3) not null default 0 check (extra_qty >= 0);
alter table purchase_lines add column if not exists extra_reason text not null default '' check (char_length(extra_reason) <= 300);
alter table purchase_lines add column if not exists extra_location text check (extra_location in ('project', 'warehouse'));
alter table purchase_lines add column if not exists unit_check text not null default 'none' check (unit_check in ('none', 'pending', 'confirmed'));
alter table purchase_lines add column if not exists unit_covers numeric(14,3) check (unit_covers >= 0);
alter table purchase_lines add column if not exists unit_checked_by uuid references profiles(id);
alter table purchase_lines add column if not exists unit_checked_at timestamptz;
alter table purchase_lines add column if not exists unit_note text not null default '' check (char_length(unit_note) <= 300);
alter table purchase_lines add column if not exists unplanned_reason text not null default '' check (char_length(unplanned_reason) <= 300);
-- A substitute: the buyer says an important specification differs from the
-- request (spec, 12 Oct). Its reason is kept; it covers the request only
-- after the office checks it, like a different unit.
alter table purchase_lines add column if not exists substitute boolean not null default false;
alter table purchase_lines add column if not exists substitute_reason text not null default '' check (char_length(substitute_reason) <= 300);
create index if not exists purchase_lines_request_line on purchase_lines (request_line_id) where request_line_id is not null;

-- Which portions a purchase line covers, and how much. Rebuilt with the
-- line; kept (as history) when the purchase is voided — every reader counts
-- only RECORDED purchases. A portion the office later removes keeps the
-- request line, so the line's Bought stays right.
create table if not exists purchase_line_covers (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  line_id uuid not null references purchase_lines(id) on delete cascade,
  request_line_id uuid not null references pr_lines(id),
  portion_id uuid references pr_line_portions(id) on delete set null,
  buyer_id uuid not null references profiles(id),
  quantity numeric(14,3) not null check (quantity > 0)
);
create index if not exists purchase_line_covers_line on purchase_line_covers (line_id);
create index if not exists purchase_line_covers_portion on purchase_line_covers (portion_id) where portion_id is not null;
create index if not exists purchase_line_covers_request_line on purchase_line_covers (request_line_id);

-- A staff change that needs the owner (Q13 = B).
create table if not exists purchase_change_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  purchase_id uuid not null references purchases(id),
  kind text not null check (kind in ('correct', 'replace', 'void')),
  body jsonb,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  base_updated_at timestamptz not null,
  -- The purchase (pur_doc) exactly as the requester saw it. Approval applies
  -- only while the purchase still reads the same.
  base_doc jsonb not null,
  requested_by uuid not null references profiles(id),
  requested_at timestamptz not null default now(),
  op_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'stale')),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  result jsonb,
  unique (requested_by, op_id),
  check ((kind = 'void') = (body is null))
);
create unique index if not exists purchase_change_requests_one_pending on purchase_change_requests (purchase_id) where status = 'pending';


-- ════ 2. Who may buy ═════════════════════════════════════════════════

-- May p_user buy for the company p_owner? An active account allowed the
-- Expenses section that is either that owner, or that owner's staff with
-- the Buyer switch on.
create or replace function pur_can_buy(p_user uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(p.status, 'active') = 'active'
       and (jsonb_typeof(p.allowed_modules) is distinct from 'array'
            or jsonb_array_length(p.allowed_modules) = 0
            or p.allowed_modules ? 'expenses')
       and ((p.role = 'owner' and p.id = p_owner)
            or (p.role = 'staff' and p.owner_id = p_owner
                and exists (select 1 from pur_buyers b
                             where b.user_id = p.id and b.owner_id = p_owner and b.is_buyer)))
      from profiles p where p.id = p_user), false)
$$;

-- The caller may buy in their own company. A boolean about the caller only:
-- the read policies below call it.
create or replace function pur_buyer() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_office() then
    return false;
  end if;
  return pur_can_buy(auth.uid(), data_owner_id());
end;
$$;

-- Who may READ purchase rows (0096's rule, narrowed — review R3): those who
-- may buy. 0096 let every staff account allowed Expenses read every
-- purchase, its lines, charges and history; Project Control's staff entry
-- now reads only the line it edits, through pur_entry_row / pur_review_lines
-- below. Every 0096 and 0097 read policy calls this.
create or replace function pur_reader() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return pur_buyer();
end;
$$;

-- What the screens need to know about the caller.
create or replace function pur_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('can_buy', pur_buyer(),
                            'is_owner', auth.uid() is not null and coalesce(is_owner(), false),
                            'user_id', auth.uid());
end;
$$;

-- A person's name for buyers and approvers: the display name, else the
-- part of the e-mail before the at sign (office accounts often have no
-- display name), else 'Office'.
create or replace function pur_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.display_name), ''), nullif(split_part(coalesce(p.email, ''), '@', 1), ''), 'Office')
    from profiles p where p.id = p_id
$$;

-- Reading: the office reads the switch; buyers read suppliers; the purchase
-- readers (buyers, above) read covers; change requests — the owner all of
-- them, buyers their own. Every write goes through the functions below.
alter table pur_buyers enable row level security;
alter table pur_buyer_events enable row level security;
alter table suppliers enable row level security;
alter table purchase_line_covers enable row level security;
alter table purchase_change_requests enable row level security;
drop policy if exists pur_buyers_office_read on pur_buyers;
create policy pur_buyers_office_read on pur_buyers for select to authenticated using (can_access(owner_id) and pr_is_office());
drop policy if exists pur_buyer_events_owner_read on pur_buyer_events;
create policy pur_buyer_events_owner_read on pur_buyer_events for select to authenticated using (can_access(owner_id) and is_owner());
drop policy if exists suppliers_buyer_read on suppliers;
create policy suppliers_buyer_read on suppliers for select to authenticated using (can_access(owner_id) and pur_buyer());
drop policy if exists purchase_line_covers_reader on purchase_line_covers;
create policy purchase_line_covers_reader on purchase_line_covers for select to authenticated using (can_access(owner_id) and pur_reader());
drop policy if exists purchase_change_requests_read on purchase_change_requests;
create policy purchase_change_requests_read on purchase_change_requests for select to authenticated
  using (can_access(owner_id) and pur_reader() and (is_owner() or requested_by = auth.uid()));

-- The owner's list of staff and their Buyer switch.
create or replace function pur_office_buyers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not coalesce(is_owner(), false) then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'user_id', p.id, 'name', pur_person_name(p.id), 'email', p.email,
            'active', coalesce(p.status, 'active') = 'active',
            'is_buyer', coalesce(b.is_buyer, false),
            'expenses_ok', jsonb_typeof(p.allowed_modules) is distinct from 'array'
                           or jsonb_array_length(p.allowed_modules) = 0 or p.allowed_modules ? 'expenses',
            'can_buy', pur_can_buy(p.id, auth.uid()))
          order by pur_person_name(p.id)), '[]'::jsonb)
            from profiles p
            left join pur_buyers b on b.user_id = p.id
           where p.role = 'staff' and p.owner_id = auth.uid());
end;
$$;

-- The main owner turns a staff account's Buyer switch on or off.
create or replace function pur_set_buyer(p_user uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not coalesce(is_owner(), false) then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  if p_on is null then
    raise exception 'BAD_SWITCH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p where p.id = p_user and p.role = 'staff' and p.owner_id = v_uid) then
    raise exception 'NOT_STAFF' using errcode = 'P0001';
  end if;
  insert into pur_buyers (user_id, owner_id, is_buyer, updated_by, updated_at)
  values (p_user, v_uid, p_on, v_uid, now())
  on conflict (user_id) do update set is_buyer = excluded.is_buyer, owner_id = excluded.owner_id,
                                      updated_by = excluded.updated_by, updated_at = excluded.updated_at
   where pur_buyers.is_buyer is distinct from excluded.is_buyer or pur_buyers.owner_id <> excluded.owner_id;
  if found then
    insert into pur_buyer_events (owner_id, user_id, is_buyer, actor_id) values (v_uid, p_user, p_on, v_uid);
  end if;
  return jsonb_build_object('user_id', p_user, 'is_buyer', p_on, 'can_buy', pur_can_buy(p_user, v_uid));
end;
$$;

-- Who a portion can be assigned to: the company's accounts that may buy.
create or replace function pur_buyer_options() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'name', pur_person_name(p.id), 'is_me', p.id = auth.uid())
                                    order by p.id <> auth.uid(), pur_person_name(p.id)), '[]'::jsonb)
            from profiles p
           where (p.id = v_owner or (p.role = 'staff' and p.owner_id = v_owner))
             and pur_can_buy(p.id, v_owner));
end;
$$;

-- 0096's caller check, plus the Buyer switch: 'purchasing' (this tab) and
-- 'workmate' (the phone) need it; 'expenses_form' keeps 0096's rule (an
-- active owner/staff account allowed the Expenses section) for ordinary
-- entry. Whatever the source, a NEW request link, new picks or taking a
-- portion over need the switch too — pur_cover_lines refuses them.
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
  if coalesce(p_source, 'expenses_form') in ('workmate', 'purchasing') and not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

-- ════ 3. Suppliers ═══════════════════════════════════════════════════

create or replace function pur_suppliers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'branch', s.branch,
                                                       'contact', s.contact, 'active', s.active)
                                    order by s.active desc, lower(s.name), lower(s.branch)), '[]'::jsonb)
            from suppliers s where s.owner_id = data_owner_id());
end;
$$;

-- Add (p_id null) or change a supplier. A buyer can add one while recording.
create or replace function pur_save_supplier(p_id uuid, p_name text, p_branch text, p_contact text, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_branch, ''))) > 120 or char_length(btrim(coalesce(p_contact, ''))) > 200 then
    raise exception 'BAD_SUPPLIER' using errcode = 'P0001';
  end if;
  begin
    if p_id is null then
      insert into suppliers (owner_id, name, branch, contact, active, created_by)
      values (v_owner, btrim(p_name), btrim(coalesce(p_branch, '')), btrim(coalesce(p_contact, '')), coalesce(p_active, true), auth.uid())
      returning id into v_id;
    else
      update suppliers set name = btrim(p_name), branch = btrim(coalesce(p_branch, '')), contact = btrim(coalesce(p_contact, '')),
                           active = coalesce(p_active, active), updated_at = now()
       where id = p_id and owner_id = v_owner
      returning id into v_id;
      if v_id is null then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_SUPPLIER' using errcode = 'P0001';
  end;
  return (select jsonb_build_object('id', s.id, 'name', s.name, 'branch', s.branch, 'contact', s.contact, 'active', s.active)
            from suppliers s where s.id = v_id);
end;
$$;

-- ════ 4. Portions: who is buying, and how much is bought ════════════

-- How much of a portion RECORDED purchases cover (a voided purchase's
-- covers stay as history and count for nothing).
create or replace function pr_portion_bought(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0)
    from purchase_line_covers c
    join purchase_lines l on l.id = c.line_id
    join purchases pu on pu.id = l.purchase_id
   where c.portion_id = p_portion and pu.status = 'recorded'
$$;

-- How much of a request line recorded purchases cover (including covers
-- whose portion the office later removed).
create or replace function pr_line_bought(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0)
    from purchase_line_covers c
    join purchase_lines l on l.id = c.line_id
    join purchases pu on pu.id = l.purchase_id
   where c.request_line_id = p_line and pu.status = 'recorded'
$$;

-- Still to buy on a portion: what is needed and not yet covered. Never
-- negative — a portion covered beyond its (later reduced) need shows 0.
create or replace function pr_portion_still(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))
    from pr_line_portions p where p.id = p_portion
$$;

-- Split p_qty off a portion into a new portion of the same batch (same
-- "arranged" mark; the new one has no buyer yet). The caller holds the
-- line's lock and has checked that p_qty is part of the still-to-buy
-- quantity, so the original keeps everything bought and every pending
-- reduction.
create or replace function pr_split_portion(p_portion uuid, p_qty numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p record;
  v_id uuid;
begin
  select * into p from pr_line_portions where id = p_portion for update;
  if p.id is null or p_qty is null or p_qty <= 0 or p_qty >= p.quantity then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if p.pending_reduction > p.quantity - p_qty then
    raise exception 'REDUCTION_PENDING' using errcode = 'P0001';
  end if;
  update pr_line_portions set quantity = quantity - p_qty where id = p_portion;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity, arranged_at, arranged_by)
  values (p.owner_id, p.line_id, p.batch_id, p_qty, p.arranged_at, p.arranged_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- Assign, claim, reassign or release a portion (p_buyer null = release).
-- p_quantity null = all of its Still to buy; less = that part only (split
-- off into its own portion). Quantity already bought always stays where it
-- is, with the buyer who bought it: handing over a partly bought portion
-- splits off its still-to-buy part. Who may:
--   the owner — anything;
--   a Buyer — claim an unassigned portion ("I'll buy this"), give an
--   unassigned one to another buyer, release their own. Never someone
--   else's (ask the owner).
create or replace function pur_assign_portion(p_portion uuid, p_buyer uuid, p_quantity numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_line uuid;
  v_bought numeric;
  v_still numeric;
  v_qty numeric;
  v_target uuid;
  v_kind text;
  l record;
  p record;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  if char_length(btrim(coalesce(p_note, ''))) > 300 then
    raise exception 'BAD_NOTE' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion and owner_id = v_owner;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Same lock order as every other portion change (0085/0086): the line first.
  select ln.id, ln.owner_id, ln.request_id, ln.status, r.status as request_status
    into l from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = v_line for update of ln;
  if l.status <> 'open' or l.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if p_buyer is not null and not pur_can_buy(p_buyer, v_owner) then
    raise exception 'BAD_BUYER' using errcode = 'P0001';
  end if;
  if not coalesce(is_owner(), false) then
    if p_buyer is null and p.buyer_id is distinct from v_uid then
      raise exception 'NOT_YOUR_PORTION' using errcode = 'P0001';
    end if;
    if p_buyer is not null and p.buyer_id is not null and p.buyer_id <> p_buyer then
      raise exception 'ASSIGNED_TO_OTHER' using errcode = 'P0001';
    end if;
  end if;

  v_bought := pr_portion_bought(p.id);
  v_still := greatest(0, p.quantity - p.pending_reduction - v_bought);
  if p.buyer_id is not distinct from p_buyer and p_quantity is null then
    return jsonb_build_object('portion_id', p.id, 'changed', false);
  end if;
  if v_still <= 0 then
    raise exception 'NOTHING_TO_BUY' using errcode = 'P0001';
  end if;
  v_qty := coalesce(p_quantity, v_still);
  if v_qty <= 0 or v_qty > v_still or v_qty <> round(v_qty, 3) then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;

  if v_bought = 0 and v_qty = v_still then
    v_target := p.id;           -- nothing bought: the whole portion changes hands
  else
    v_target := pr_split_portion(p.id, v_qty);   -- the bought part stays put
  end if;
  update pr_line_portions set buyer_id = p_buyer, assigned_by = v_uid, assigned_at = now() where id = v_target;

  v_kind := case when p_buyer is null then 'portion_released'
                 when p_buyer = v_uid and p.buyer_id is null then 'portion_claimed'
                 else 'portion_assigned' end;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, v_kind,
          jsonb_build_object('portion_id', v_target, 'from_portion_id', p.id, 'quantity', v_qty,
                             'from_buyer', case when p.buyer_id is null then null else pur_person_name(p.buyer_id) end,
                             'to_buyer', case when p_buyer is null then null else pur_person_name(p_buyer) end,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('portion_id', v_target, 'changed', true, 'split', v_target <> p.id);
end;
$$;

-- 0085's quantity rule, now protecting what was BOUGHT as well as what was
-- arranged (spec: "reduce newest unarranged demand first, then flag
-- supplier-arranged/purchased portions for action"):
--   increase → first take back quantity flagged for reduction (newest
--              first); the rest is new demand in NOW's batch, merged only
--              into a portion nobody is buying and nothing covers yet;
--   decrease → remove unbought, unarranged quantity first — unassigned
--              portions before assigned ones, newest first; a portion is
--              deleted only when nothing of it was bought. Whatever is left
--              is FLAGGED (pending_reduction) on arranged or bought
--              portions for the office: a placed order or a purchase is
--              never erased.
create or replace function pr_apply_quantity(p_line uuid, p_new numeric, p_owner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
  v_delta numeric;
  v_take numeric;
  v_free numeric;
  v_batch uuid;
  v_target uuid;
  p record;
begin
  select coalesce(sum(quantity - pending_reduction), 0) into v_total
    from pr_line_portions where line_id = p_line;

  if p_new > v_total then
    v_delta := p_new - v_total;
    for p in select * from pr_line_portions
              where line_id = p_line and pending_reduction > 0
                and (arranged_at is not null or pr_portion_bought(id) > 0)
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.pending_reduction);
      update pr_line_portions set pending_reduction = pending_reduction - v_take where id = p.id;
      v_delta := v_delta - v_take;
    end loop;
    if v_delta > 0 then
      v_batch := pr_batch_for(p_owner, now());
      select id into v_target from pr_line_portions
       where line_id = p_line and batch_id = v_batch and arranged_at is null and buyer_id is null
         and pr_portion_bought(id) = 0
       order by created_at desc, id desc limit 1 for update;
      if v_target is not null then
        update pr_line_portions set quantity = quantity + v_delta where id = v_target;
      else
        insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (p_owner, p_line, v_batch, v_delta);
      end if;
    end if;

  elsif p_new < v_total then
    v_delta := v_total - p_new;
    for p in select * from pr_line_portions
              where line_id = p_line and arranged_at is null
              order by (buyer_id is not null), created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_free := greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id));
      v_take := least(v_delta, v_free);
      continue when v_take <= 0;
      if v_take >= p.quantity then
        delete from pr_line_portions where id = p.id;
      else
        update pr_line_portions set quantity = quantity - v_take where id = p.id;
      end if;
      v_delta := v_delta - v_take;
    end loop;
    for p in select * from pr_line_portions
              where line_id = p_line and (arranged_at is not null or pr_portion_bought(id) > 0)
              order by created_at desc, id desc for update loop
      exit when v_delta <= 0;
      v_take := least(v_delta, p.quantity - p.pending_reduction);
      if v_take > 0 then
        update pr_line_portions set pending_reduction = pending_reduction + v_take where id = p.id;
        v_delta := v_delta - v_take;
      end if;
    end loop;
  end if;
end;
$$;

-- 0086's move to another weekly batch, refusing a portion something was
-- already bought for (its purchase belongs to that batch's buying), and
-- merging only into a portion with the same buyer that nothing covers.
create or replace function pr_office_move_portion(p_portion uuid, p_batch uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_line uuid;
  v_target uuid;
  v_merged boolean := false;
  l record;
  p record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select line_id into v_line from pr_line_portions where id = p_portion;
  if v_line is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  select ln.id, ln.owner_id, ln.request_id, ln.status into l from pr_lines ln where ln.id = v_line for update;
  if not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.status <> 'open' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into p from pr_line_portions where id = p_portion for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p.arranged_at is not null then
    raise exception 'ARRANGED' using errcode = 'P0001';
  end if;
  if pr_portion_bought(p.id) > 0 then
    raise exception 'BOUGHT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pr_batches b where b.id = p_batch and b.owner_id = l.owner_id) then
    raise exception 'BAD_BATCH' using errcode = 'P0001';
  end if;
  if p.batch_id = p_batch then
    return jsonb_build_object('moved', false, 'merged', false);
  end if;

  select id into v_target from pr_line_portions
   where line_id = v_line and batch_id = p_batch and arranged_at is null and id <> p_portion
     and buyer_id is not distinct from p.buyer_id and pr_portion_bought(id) = 0
   order by created_at desc, id desc limit 1 for update;
  if v_target is not null then
    update pr_line_portions set quantity = quantity + p.quantity where id = v_target;
    delete from pr_line_portions where id = p_portion;
    v_merged := true;
  else
    update pr_line_portions set batch_id = p_batch where id = p_portion;
  end if;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'portion_moved',
          jsonb_build_object('from_batch', p.batch_id, 'to_batch', p_batch, 'quantity', p.quantity,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));
  return jsonb_build_object('moved', true, 'merged', v_merged);
end;
$$;

-- ════ 5. Recording a purchase against requests ═══════════════════════

-- 0096's lock keys, plus each request line a body or stored purchase
-- covers ('pr_line:'), taken in the same single sorted pass (pur_lock), so
-- two purchases covering the same request line wait for each other.
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
    union
    select 'pr_line:' || coalesce(pur_uuid(l ->> 'request_line_id')::text, btrim(l ->> 'request_line_id'))
      from jsonb_array_elements(case when jsonb_typeof(p_body -> 'lines') = 'array' then p_body -> 'lines' else '[]'::jsonb end) l
     where coalesce(l ->> 'request_line_id', '') <> ''
  ) x
$$;

create or replace function pur_stored_keys(p_purchase uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct k), '{}') from (
    select 'pur_folder:' || l.folder_id k from purchase_lines l where l.purchase_id = p_purchase and l.folder_id is not null
    union
    select 'pr_line:' || l.request_line_id from purchase_lines l where l.purchase_id = p_purchase and l.request_line_id is not null
  ) x
$$;

-- Who bought, from a body: the given buyer, else (Purchasing tab / phone)
-- the caller, else p_current (a correction keeps the stored one). Only the
-- owner records a purchase for someone else, and only for an account that
-- may buy in this company.
create or replace function pur_bought_by(p_owner uuid, p_body jsonb, p_current uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := pur_uuid(p_body ->> 'bought_by');
begin
  if coalesce(btrim(p_body ->> 'bought_by'), '') <> '' and v is null then
    raise exception 'BAD_BUYER' using errcode = 'P0001';
  end if;
  if v is null then
    return coalesce(p_current, case when coalesce(p_body ->> 'source', 'expenses_form') in ('purchasing', 'workmate') then auth.uid() end);
  end if;
  if v is distinct from p_current then
    if v <> auth.uid() and not coalesce(is_owner(), false) then
      raise exception 'BAD_BUYER' using errcode = 'P0001';
    end if;
    if not pur_can_buy(v, p_owner) then
      raise exception 'BAD_BUYER' using errcode = 'P0001';
    end if;
  end if;
  return v;
end;
$$;

-- The supplier picked from the list (this company's), or null.
create or replace function pur_supplier_of(p_owner uuid, p_body jsonb) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := pur_uuid(p_body ->> 'supplier_id');
begin
  if coalesce(btrim(p_body ->> 'supplier_id'), '') = '' then
    return null;
  end if;
  if v is null or not exists (select 1 from suppliers s where s.id = v and s.owner_id = p_owner) then
    raise exception 'BAD_SUPPLIER' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- 0096's validate-and-store, plus each line's request link: request_line_id
-- (that request's own project/work, a project line), portion_picks
-- [{portion_id, quantity}], extra_reason / extra_location, substitute /
-- substitute_reason, and — for the Purchasing tab and the phone —
-- unplanned_reason when there is no request. Coverage itself (and who may
-- link) is pur_cover_lines'.
create or replace function pur_store(p_owner uuid, p_purchase uuid, p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lines jsonb := coalesce(p_body -> 'lines', '[]'::jsonb);
  v_charges jsonb := coalesce(p_body -> 'charges', '[]'::jsonb);
  v_source text := (select pu.source from purchases pu where pu.id = p_purchase);
  v_line jsonb;
  v_charge jsonb;
  v_share jsonb;
  v_pick jsonb;
  v_picks jsonb;
  v_dest text;
  v_folder uuid;
  v_folder_name text;
  v_req uuid;
  v_req_work uuid;
  v_loc text;
  v_sub boolean;
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

    -- The request this line is for: same company, same project/work.
    v_req := pur_uuid(v_line ->> 'request_line_id');
    if coalesce(btrim(v_line ->> 'request_line_id'), '') <> '' then
      select r.work_folder_id into v_req_work
        from pr_lines ln join pr_requests r on r.id = ln.request_id
       where ln.id = v_req and ln.owner_id = p_owner;
      if v_req is null or v_req_work is null or v_dest <> 'project' or v_req_work <> v_folder then
        raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
      end if;
    end if;
    v_picks := '[]'::jsonb;
    if v_line -> 'portion_picks' is not null and jsonb_typeof(v_line -> 'portion_picks') <> 'null' then
      if jsonb_typeof(v_line -> 'portion_picks') <> 'array' or (v_req is null and jsonb_array_length(v_line -> 'portion_picks') > 0) then
        raise exception 'BAD_PORTION' using errcode = 'P0001';
      end if;
      for v_pick in select value from jsonb_array_elements(v_line -> 'portion_picks') loop
        if pur_uuid(v_pick ->> 'portion_id') is null or pur_qty(v_pick ->> 'quantity') is null
           or pur_qty(v_pick ->> 'quantity') <= 0 then
          raise exception 'BAD_PORTION' using errcode = 'P0001';
        end if;
        v_picks := v_picks || jsonb_build_object('portion_id', pur_uuid(v_pick ->> 'portion_id'),
                                                 'quantity', pur_qty(v_pick ->> 'quantity'));
      end loop;
    end if;
    v_loc := nullif(btrim(coalesce(v_line ->> 'extra_location', '')), '');
    if v_loc is not null and v_loc not in ('project', 'warehouse') then
      raise exception 'BAD_EXTRA' using errcode = 'P0001';
    end if;
    if char_length(btrim(coalesce(v_line ->> 'extra_reason', ''))) > 300
       or char_length(btrim(coalesce(v_line ->> 'unplanned_reason', ''))) > 300 then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
    if v_req is null and v_source in ('purchasing', 'workmate')
       and btrim(coalesce(v_line ->> 'unplanned_reason', '')) = '' then
      raise exception 'UNPLANNED_REASON_REQUIRED' using errcode = 'P0001';
    end if;
    -- A substitute (only for a request) states why; the office checks it.
    if v_line -> 'substitute' is not null and jsonb_typeof(v_line -> 'substitute') not in ('boolean', 'null') then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
    v_sub := v_req is not null and coalesce((v_line ->> 'substitute')::boolean, false);
    if char_length(btrim(coalesce(v_line ->> 'substitute_reason', ''))) > 300 then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
    if v_sub and btrim(coalesce(v_line ->> 'substitute_reason', '')) = '' then
      raise exception 'SUBSTITUTE_REASON_REQUIRED' using errcode = 'P0001';
    end if;

    insert into purchase_lines (owner_id, purchase_id, line_no, destination, folder_id, folder_name, item_name, category,
                                quantity, unit, gross_amount, in_inventory, min_stock,
                                request_line_id, portion_picks, extra_reason, extra_location, unplanned_reason,
                                substitute, substitute_reason)
    values (p_owner, p_purchase, n, v_dest, v_folder, coalesce(v_folder_name, ''), btrim(v_line ->> 'item_name'),
            btrim(coalesce(v_line ->> 'category', '')), v_qty, btrim(coalesce(v_line ->> 'unit', '')), v_amount,
            coalesce((v_line ->> 'in_inventory')::boolean, false), v_min,
            v_req, v_picks, btrim(coalesce(v_line ->> 'extra_reason', '')), v_loc,
            case when v_req is null then btrim(coalesce(v_line ->> 'unplanned_reason', '')) else '' end,
            v_sub, case when v_sub then btrim(v_line ->> 'substitute_reason') else '' end)
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

-- What a purchase's request lines covered, as it stands — kept before a
-- correction, replacement or unit check, and authoritative afterwards:
-- [{line_no, request_line_id, picks, target, covers: [{portion_id, quantity}]}].
-- target = what the line counted toward its request: its quantity when it
-- counts directly, what the office check said, else 0.
create or replace function pur_cover_history(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'line_no', l.line_no, 'request_line_id', l.request_line_id, 'picks', l.portion_picks,
           'target', case when l.unit_check = 'confirmed' then coalesce(l.unit_covers, 0)
                          when l.unit_check = 'none' then l.quantity else 0 end,
           'covers', (select coalesce(jsonb_agg(jsonb_build_object('portion_id', c.portion_id, 'quantity', c.quantity) order by c.id), '[]'::jsonb)
                        from purchase_line_covers c where c.line_id = l.id and c.portion_id is not null))
         order by l.line_no), '[]'::jsonb)
    from purchase_lines l where l.purchase_id = p_purchase and l.request_line_id is not null
$$;

-- Rebuild what a purchase covers, from its stored lines. Called after the
-- lines are (re)stored, and after a unit check; the caller holds the
-- purchase's 'pr_line:' locks. p_history = pur_cover_history taken BEFORE
-- the change ('[]' for a new purchase; null = take it now). For each line
-- linked to a request:
--   who            → a request link, or portion picks, that the history does
--                    not already have are a buying decision: only someone who
--                    may buy (pur_buyer) makes it, whatever the source. Only
--                    someone who may buy hands an unassigned portion to the
--                    purchase's buyer, and only if that buyer may buy;
--   counts         → same unit and not a substitute: up to its quantity;
--                    otherwise nothing until the office confirms how much
--                    (unit_check 'confirmed', unit_covers), then that much;
--   picked         → portions picked in THIS change are AUTHORITATIVE: the
--                    line covers those, at most the picked quantity each, and
--                    no other portion — the rest is extra. A picked portion
--                    the line did not cover before is a new choice: never
--                    another buyer's (the owner's to give);
--   history        → otherwise each portion this line covered before is
--                    covered again — in the old order and at most the SAME
--                    quantity — and quantity is looked for elsewhere only for
--                    what the line's target ROSE by (unchanged picks: more of
--                    the picked portions only). A price fix, a voided earlier
--                    purchase, a reduced request or a check on another line
--                    never moves coverage between weeks;
--   automatically  → a new link: the buyer's own portions, then unassigned
--                    ones (the buyer now holds them), then — the owner only —
--                    other buyers' portions; within each, the earliest batch
--                    first. Each portion takes at most its Still to buy, so
--                    Still to buy never goes negative;
--   extra          → (counts directly) the quantity it could not cover; needs
--                    a reason and a location — except when the line's target
--                    did not rise since its history: then the request shrank
--                    after buying, and the line says so.
-- A voided purchase covers nothing (its rows stay as history).
create or replace function pur_cover_lines(p_purchase uuid, p_actor uuid, p_history jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hist jsonb := coalesce(p_history, pur_cover_history(p_purchase));
  pu purchases;
  v_buyer uuid;
  v_owner_caller boolean := coalesce(is_owner(), false);
  v_may_buy boolean := pur_buyer();
  v_may_assign boolean;
  v_line record;
  v_req record;
  v_h jsonb;
  v_pick jsonb;
  v_p record;
  v_direct boolean;
  v_picked boolean;
  v_repicked boolean;
  v_had uuid[];
  v_target numeric;
  v_left numeric;
  v_auto numeric;
  v_cap numeric;
  v_take numeric;
  v_extra numeric;
  v_out jsonb := '[]'::jsonb;
begin
  select * into pu from purchases where id = p_purchase;
  v_buyer := coalesce(pu.bought_by, pu.recorded_by);
  v_may_assign := v_may_buy and pur_can_buy(v_buyer, pu.owner_id);
  delete from purchase_line_covers c using purchase_lines l where l.id = c.line_id and l.purchase_id = p_purchase;
  if pu.status <> 'recorded' then
    return v_out;
  end if;

  for v_line in select * from purchase_lines where purchase_id = p_purchase and request_line_id is not null order by line_no loop
    select ln.id, ln.unit, ln.request_id, ln.owner_id, ln.status as line_status, rq.status as request_status into v_req
      from pr_lines ln join pr_requests rq on rq.id = ln.request_id
     where ln.id = v_line.request_line_id for update of ln;
    -- This line's history: its request, and its place among this purchase's
    -- lines for that request (1st line for X ↔ 1st history entry for X), so
    -- a line inserted ahead of it changes nothing.
    v_h := (select e.h from (select h, row_number() over (order by (h ->> 'line_no')::int) rn
                               from jsonb_array_elements(v_hist) h
                              where h ->> 'request_line_id' = v_line.request_line_id::text) e
             where e.rn = (select count(*) from purchase_lines x
                            where x.purchase_id = p_purchase and x.request_line_id = v_line.request_line_id
                              and x.line_no <= v_line.line_no));
    -- A NEW link to a cancelled line or request is refused; a line that was
    -- bought before it was cancelled keeps working (it has history).
    if v_h is null and (v_req.line_status <> 'open' or v_req.request_status <> 'submitted') then
      raise exception 'LINE_CLOSED' using errcode = 'P0001',
        hint = 'Line ' || v_line.line_no || ': that request line was cancelled.';
    end if;
    if not v_may_buy and (v_h is null or v_line.portion_picks is distinct from v_h -> 'picks') then
      raise exception 'BUYER_REQUIRED' using errcode = 'P0001',
        hint = 'Line ' || v_line.line_no || ': linking a purchase to a request needs the Buyer switch.';
    end if;
    v_direct := lower(btrim(v_line.unit)) = lower(btrim(v_req.unit)) and not v_line.substitute;
    v_picked := jsonb_array_length(v_line.portion_picks) > 0;
    -- Picks made in THIS change: none before, or different from before.
    v_repicked := v_picked and (v_h is null or v_line.portion_picks is distinct from v_h -> 'picks');
    -- The portions this line covered before. Any other portion is a new
    -- choice, and another buyer's is the owner's alone to give.
    v_had := coalesce((select array_agg((c ->> 'portion_id')::uuid) from jsonb_array_elements(v_h -> 'covers') c), '{}');
    v_target := case when v_direct then v_line.quantity
                     when v_line.unit_check = 'confirmed' then coalesce(v_line.unit_covers, 0)
                     else 0 end;
    v_left := v_target;
    v_auto := case when v_repicked then 0
                   when v_h is null then v_target
                   else greatest(0, v_target - (v_h ->> 'target')::numeric) end;

    if v_repicked then
      -- The portions picked on the form, in the order given — and only those.
      for v_pick in select value from jsonb_array_elements(v_line.portion_picks) loop
        exit when v_left <= 0;
        select * into v_p from pr_line_portions
         where id = (v_pick ->> 'portion_id')::uuid and line_id = v_line.request_line_id for update;
        if v_p.id is null then
          continue when (v_pick ->> 'portion_id')::uuid = any (v_had);   -- covered before, removed since
          raise exception 'BAD_PORTION' using errcode = 'P0001';
        end if;
        if not (v_p.id = any (v_had)) and not v_owner_caller and v_p.buyer_id is not null and v_p.buyer_id <> v_buyer then
          raise exception 'ASSIGNED_TO_OTHER' using errcode = 'P0001';
        end if;
        v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
        v_take := least(v_left, (v_pick ->> 'quantity')::numeric, v_cap);
        continue when v_take <= 0;
        insert into purchase_line_covers (owner_id, line_id, request_line_id, portion_id, buyer_id, quantity)
        values (v_line.owner_id, v_line.id, v_line.request_line_id, v_p.id, v_buyer, v_take);
        v_left := v_left - v_take;
        if v_p.buyer_id is null and v_may_assign then
          update pr_line_portions set buyer_id = v_buyer, assigned_by = p_actor, assigned_at = now() where id = v_p.id;
          insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
          values (v_req.owner_id, v_req.request_id, v_req.id, p_actor, 'portion_claimed',
                  jsonb_build_object('portion_id', v_p.id, 'quantity', v_p.quantity, 'to_buyer', pur_person_name(v_buyer),
                                     'by_purchase', p_purchase));
        end if;
      end loop;
    else
      if v_h is not null then
        -- What this line covered before: the same portions, in their old
        -- order, and at most the SAME quantity of each — room freed since
        -- (another purchase voided) never pulls coverage from one week to
        -- another. Nothing is taken over: they were this purchase's already.
        for v_pick in select value from jsonb_array_elements(v_h -> 'covers') loop
          exit when v_left <= 0;
          select * into v_p from pr_line_portions
           where id = (v_pick ->> 'portion_id')::uuid and line_id = v_line.request_line_id for update;
          continue when v_p.id is null;
          v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
          v_take := least(v_left, (v_pick ->> 'quantity')::numeric, v_cap);
          continue when v_take <= 0;
          insert into purchase_line_covers (owner_id, line_id, request_line_id, portion_id, buyer_id, quantity)
          values (v_line.owner_id, v_line.id, v_line.request_line_id, v_p.id, v_buyer, v_take);
          v_left := v_left - v_take;
        end loop;
      end if;

      -- Quantity the change ADDS, on a line whose picks are unchanged: more
      -- of the picked portions only, up to each pick.
      if v_left > 0 and v_auto > 0 and v_picked then
        for v_pick in select value from jsonb_array_elements(v_line.portion_picks) loop
          exit when v_left <= 0 or v_auto <= 0;
          select * into v_p from pr_line_portions
           where id = (v_pick ->> 'portion_id')::uuid and line_id = v_line.request_line_id for update;
          continue when v_p.id is null;
          if not (v_p.id = any (v_had)) and not v_owner_caller and v_p.buyer_id is not null and v_p.buyer_id <> v_buyer then
            raise exception 'ASSIGNED_TO_OTHER' using errcode = 'P0001';
          end if;
          v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
          v_take := least(v_left, v_auto, v_cap,
                          (v_pick ->> 'quantity')::numeric - (select coalesce(sum(c.quantity), 0) from purchase_line_covers c
                                                               where c.line_id = v_line.id and c.portion_id = v_p.id));
          continue when v_take <= 0;
          insert into purchase_line_covers (owner_id, line_id, request_line_id, portion_id, buyer_id, quantity)
          values (v_line.owner_id, v_line.id, v_line.request_line_id, v_p.id, v_buyer, v_take);
          v_left := v_left - v_take;
          v_auto := v_auto - v_take;
          if v_p.buyer_id is null and v_may_assign then
            update pr_line_portions set buyer_id = v_buyer, assigned_by = p_actor, assigned_at = now() where id = v_p.id;
            insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
            values (v_req.owner_id, v_req.request_id, v_req.id, p_actor, 'portion_claimed',
                    jsonb_build_object('portion_id', v_p.id, 'quantity', v_p.quantity, 'to_buyer', pur_person_name(v_buyer),
                                       'by_purchase', p_purchase));
          end if;
        end loop;
      end if;
    end if;

    -- Then automatically (a line without picks), up to v_auto: own,
    -- unassigned, (owner only) others'.
    if v_left > 0 and v_auto > 0 and not v_picked then
      for v_p in
        select p.* from pr_line_portions p join pr_batches b on b.id = p.batch_id
         where p.line_id = v_line.request_line_id
           and (p.buyer_id = v_buyer
                or (p.buyer_id is null and v_may_assign)
                or (p.buyer_id is not null and v_owner_caller))
         order by case when p.buyer_id = v_buyer then 0 when p.buyer_id is null then 1 else 2 end,
                  b.cutoff_at, p.created_at, p.id
         for update of p
      loop
        exit when v_left <= 0 or v_auto <= 0;
        v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
        v_take := least(v_left, v_auto, v_cap);
        continue when v_take <= 0;
        insert into purchase_line_covers (owner_id, line_id, request_line_id, portion_id, buyer_id, quantity)
        values (v_line.owner_id, v_line.id, v_line.request_line_id, v_p.id, v_buyer, v_take);
        v_left := v_left - v_take;
        v_auto := v_auto - v_take;
        if v_p.buyer_id is null then
          update pr_line_portions set buyer_id = v_buyer, assigned_by = p_actor, assigned_at = now() where id = v_p.id;
          insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
          values (v_req.owner_id, v_req.request_id, v_req.id, p_actor, 'portion_claimed',
                  jsonb_build_object('portion_id', v_p.id, 'quantity', v_p.quantity, 'to_buyer', pur_person_name(v_buyer),
                                     'by_purchase', p_purchase));
        end if;
      end loop;
    end if;
    v_extra := case when v_direct then v_line.quantity - (v_target - v_left) else 0 end;
    -- The line's target did not rise since its history: the extra comes from
    -- the request shrinking after buying — say so, never ask the person
    -- fixing a price for a buying reason they never had.
    if v_extra > 0 and v_h is not null and v_target <= (v_h ->> 'target')::numeric and btrim(v_line.extra_reason) = '' then
      update purchase_lines set extra_reason = 'The request was reduced after this was bought',
                                extra_location = coalesce(extra_location, 'project')
       where id = v_line.id
      returning * into v_line;
    end if;
    if v_extra > 0 and (btrim(v_line.extra_reason) = '' or v_line.extra_location is null) then
      raise exception 'EXTRA_REASON_REQUIRED' using errcode = 'P0001',
        hint = 'Line ' || v_line.line_no || ': ' || v_extra || ' more than ' || case when v_picked then 'the portions picked' else 'Still to buy' end || '.';
    end if;
    update purchase_lines
       set covered_qty = v_target - v_left,
           extra_qty = v_extra,
           unit_check = case when v_direct then 'none' when unit_check = 'confirmed' then 'confirmed' else 'pending' end
     where id = v_line.id;
    v_out := v_out || jsonb_build_object('line', v_line.line_no, 'covered', v_target - v_left, 'extra', v_extra,
                                         'unit_check', case when v_direct then 'none' when v_line.unit_check = 'confirmed' then 'confirmed' else 'pending' end);
  end loop;
  return v_out;
end;
$$;

-- Office checks already made, so a correction or replacement that keeps a
-- line's request, item, unit, quantity and substitute mark keeps its check
-- (a renamed or re-marked line is checked again).
create or replace function pur_keep_checks(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('request_line_id', l.request_line_id, 'unit', lower(btrim(l.unit)),
                                               'item', lower(btrim(l.item_name)), 'substitute', l.substitute,
                                               'quantity', l.quantity, 'covers', l.unit_covers, 'by', l.unit_checked_by,
                                               'at', l.unit_checked_at, 'note', l.unit_note) order by l.line_no), '[]'::jsonb)
    from purchase_lines l where l.purchase_id = p_purchase and l.unit_check = 'confirmed'
$$;

create or replace function pur_apply_checks(p_purchase uuid, p_keep jsonb) returns void
language sql security definer set search_path = public as $$
  update purchase_lines l
     set unit_check = 'confirmed', unit_covers = k.covers, unit_checked_by = k.by_id, unit_checked_at = k.at, unit_note = k.note
    from (select (e.v ->> 'request_line_id')::uuid as request_line_id, e.v ->> 'unit' as unit, e.v ->> 'item' as item,
                 (e.v ->> 'substitute')::boolean as substitute,
                 (e.v ->> 'quantity')::numeric as quantity, (e.v ->> 'covers')::numeric as covers,
                 (e.v ->> 'by')::uuid as by_id, (e.v ->> 'at')::timestamptz as at, coalesce(e.v ->> 'note', '') as note,
                 row_number() over (partition by e.v ->> 'request_line_id', e.v ->> 'unit', e.v ->> 'item', e.v ->> 'substitute',
                                                 (e.v ->> 'quantity')::numeric
                                    order by e.i) as rn
            from jsonb_array_elements(coalesce(p_keep, '[]'::jsonb)) with ordinality e(v, i)) k,
         (select y.id, y.request_line_id, lower(btrim(y.unit)) as unit, lower(btrim(y.item_name)) as item, y.substitute, y.quantity,
                 row_number() over (partition by y.request_line_id, lower(btrim(y.unit)), lower(btrim(y.item_name)), y.substitute,
                                                 y.quantity order by y.line_no) rn
            from purchase_lines y where y.purchase_id = p_purchase and y.request_line_id is not null) n
   where l.id = n.id and n.request_line_id = k.request_line_id and n.unit = k.unit and n.item = k.item
     and n.substitute = k.substitute and n.quantity = k.quantity and n.rn = k.rn
$$;

-- A correction body may leave out what Project Control's form does not know
-- (the request link and its reasons, who bought, the supplier picked): each
-- line keeps the stored line's values, matched by line number.
create or replace function pur_inherit(p_purchase uuid, p_body jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_i int := 0;
  s record;
  pu purchases;
  v_body jsonb := p_body;
begin
  select * into pu from purchases where id = p_purchase;
  if jsonb_typeof(p_body -> 'lines') = 'array' then
    for v_line in select value from jsonb_array_elements(p_body -> 'lines') loop
      v_i := v_i + 1;
      select * into s from purchase_lines where purchase_id = p_purchase and line_no = v_i;
      if s.id is not null and not (v_line ? 'request_line_id') then
        v_line := v_line || jsonb_build_object('request_line_id', s.request_line_id, 'portion_picks', s.portion_picks,
                                               'extra_reason', s.extra_reason, 'extra_location', s.extra_location,
                                               'unplanned_reason', s.unplanned_reason,
                                               'substitute', s.substitute, 'substitute_reason', s.substitute_reason);
      end if;
      v_lines := v_lines || jsonb_build_array(v_line);
    end loop;
    v_body := jsonb_set(v_body, '{lines}', v_lines);
  end if;
  if not (v_body ? 'supplier_id') and pu.supplier_id is not null then
    v_body := v_body || jsonb_build_object('supplier_id', pu.supplier_id);
  end if;
  return v_body;
end;
$$;

-- 0096's insert, plus who bought, the supplier picked, kept unit checks
-- (p_keep) and the request covers — all in the same transaction as the
-- expense rows. p_history: what a replaced purchase covered (none for a new
-- one). p_current_buyer: who bought the purchase this one replaces — kept
-- when the body names nobody, so a replacement never re-attributes the
-- earlier purchase to whoever happens to make the change. Replaces the
-- 4-argument 0096 version.
drop function if exists pur_insert(uuid, uuid, jsonb, jsonb);
create or replace function pur_insert(p_owner uuid, p_actor uuid, p_body jsonb, p_carry jsonb, p_keep jsonb default null,
                                      p_history jsonb default null, p_current_buyer uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_supplier uuid := pur_supplier_of(p_owner, p_body);
  v_covers jsonb;
  v_result jsonb;
begin
  -- A receipt "link" must be an https address (a stored javascript: value
  -- would run when someone opens it). Empty values are ignored as before.
  if exists (select 1 from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
              where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                and jsonb_typeof(v) = 'string' and v #>> '{}' <> '' and v #>> '{}' !~ '^https://') then
    raise exception 'BAD_DOCS' using errcode = 'P0001';
  end if;
  insert into purchases (owner_id, source, purchase_date, date_time, supplier, receipt_total, notes, payment_method, docs,
                         recorded_by, bought_by, supplier_id)
  values (p_owner, coalesce(p_body ->> 'source', 'expenses_form'), (p_body ->> 'purchase_date')::date,
          coalesce(nullif(p_body ->> 'date_time', ''), p_body ->> 'purchase_date'),
          coalesce(nullif(btrim(coalesce(p_body ->> 'supplier', '')), ''),
                   (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end from suppliers s where s.id = v_supplier), ''),
          pur_money(p_body ->> 'receipt_total'), btrim(coalesce(p_body ->> 'notes', '')),
          btrim(coalesce(p_body ->> 'payment_method', '')),
          coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
                     where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                       and jsonb_typeof(v) = 'string'), '{}'::jsonb),
          p_actor, pur_bought_by(p_owner, p_body, p_current_buyer), v_supplier)
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
  perform pur_apply_checks(v_id, p_keep);
  v_covers := pur_cover_lines(v_id, p_actor, coalesce(p_history, '[]'::jsonb));
  v_result := pur_charge_rows(v_id) || jsonb_build_object('stock_moves', pur_move_stock(v_id, p_actor), 'covers', v_covers);
  insert into purchase_history (owner_id, purchase_id, kind, after, actor_id)
  values (p_owner, v_id, 'recorded', pur_doc(v_id), p_actor);
  return v_result;
end;
$$;

-- 0096's correction, plus: lines the body leaves unlinked keep their stored
-- request link (pur_inherit); who bought and the supplier can change (who
-- bought — the owner only); office checks are kept when the line's request,
-- item, unit and quantity stay; the covers are rebuilt in the same
-- transaction, on the same portions as before (pur_cover_history).
create or replace function pur_correct(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  pu purchases;
  v_body jsonb;
  v_before jsonb;
  v_old_folders uuid[];
  v_moves jsonb;
  v_keep jsonb;
  v_hist jsonb;
  v_covers jsonb;
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
  -- This purchase first, then its CURRENT projects and requests and the new ones together.
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase) || pur_body_keys(p_body));
  pu := pur_open(v_owner, p_purchase);
  if jsonb_array_length(coalesce(p_body -> 'lines', '[]'::jsonb))
     <> (select count(*) from purchase_lines where purchase_id = p_purchase) then
    raise exception 'LINES_CHANGED' using errcode = 'P0001';
  end if;
  select array_agg(l.folder_id order by l.line_no)
    into v_old_folders from purchase_lines l where l.purchase_id = p_purchase;
  if not is_owner() and exists (select 1
                                  from jsonb_array_elements(p_body -> 'lines') with ordinality n(v, i)
                                 where pur_uuid(n.v ->> 'folder_id') is distinct from v_old_folders[n.i]) then
    raise exception 'OWNER_APPROVAL_NEEDED' using errcode = 'P0001';
  end if;
  v_body := pur_inherit(p_purchase, p_body);
  if not pur_buyer() and pur_links_dropped(p_purchase, v_body) then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001',
      hint = 'Taking a purchase off its request needs the Buyer switch.';
  end if;

  v_before := pur_doc(p_purchase);
  v_keep := pur_keep_checks(p_purchase);
  v_hist := pur_cover_history(p_purchase);
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

  -- A receipt "link" must be an https address (a stored javascript: value
  -- would run when someone opens it). Empty values are ignored as before.
  if exists (select 1 from jsonb_each(coalesce(v_body -> 'docs', '{}'::jsonb)) d(k, v)
              where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                and jsonb_typeof(v) = 'string' and v #>> '{}' <> '' and v #>> '{}' !~ '^https://') then
    raise exception 'BAD_DOCS' using errcode = 'P0001';
  end if;
  update purchases set
    purchase_date = (v_body ->> 'purchase_date')::date,
    date_time = coalesce(nullif(v_body ->> 'date_time', ''), v_body ->> 'purchase_date'),
    supplier = coalesce(nullif(btrim(coalesce(v_body ->> 'supplier', '')), ''),
                        (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                           from suppliers s where s.id = pur_supplier_of(v_owner, v_body)), ''),
    supplier_id = pur_supplier_of(v_owner, v_body),
    bought_by = pur_bought_by(v_owner, v_body, pu.bought_by),
    receipt_total = pur_money(v_body ->> 'receipt_total'),
    notes = btrim(coalesce(v_body ->> 'notes', '')),
    payment_method = btrim(coalesce(v_body ->> 'payment_method', '')),
    docs = docs || coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(v_body -> 'docs', '{}'::jsonb)) d(k, v)
                              where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                                and jsonb_typeof(v) = 'string'), '{}'::jsonb),
    updated_at = now()
  where id = p_purchase;

  perform pur_store(v_owner, p_purchase, v_body);
  insert into purchase_stock_moves (line_id, inventory_id, quantity, moved_at)
  select l.id, k.inventory_id, k.quantity, k.moved_at
    from jsonb_to_recordset(v_moves) as k(line_no int, inventory_id uuid, quantity numeric, moved_at timestamptz)
    join purchase_lines l on l.purchase_id = p_purchase and l.line_no = k.line_no;
  perform pur_apply_checks(p_purchase, v_keep);
  v_covers := pur_cover_lines(p_purchase, v_uid, v_hist);
  v_result := pur_charge_rows(p_purchase) || jsonb_build_object('covers', v_covers);
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'corrected', btrim(p_reason), v_before, pur_doc(p_purchase), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'correct', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- 0096's replacement, with the old purchase voided BEFORE the new one is
-- recorded — so the new one can cover the request portions the old one
-- covered, and does (its lines' history, matched by request line and its
-- order among that request's lines) — and with matching office checks kept.
create or replace function pur_replace(p_op uuid, p_purchase uuid, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(p_body ->> 'source');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_carry jsonb;
  v_keep jsonb;
  v_hist jsonb;
  v_body jsonb := p_body;
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
  -- The supplier picked stays unless the body says otherwise (as in pur_inherit).
  if not (v_body ? 'supplier_id') and pu.supplier_id is not null then
    v_body := v_body || jsonb_build_object('supplier_id', pu.supplier_id);
  end if;
  -- Without the Buyer switch nobody drops a request link.
  if not pur_buyer() and pur_links_dropped(p_purchase, p_body) then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001',
      hint = 'Taking a purchase off its request needs the Buyer switch.';
  end if;

  v_before := pur_doc(p_purchase);
  v_keep := pur_keep_checks(p_purchase);
  v_hist := pur_cover_history(p_purchase);
  select coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'item_name', l.item_name, 'inventory_id', m.inventory_id, 'quantity', m.quantity)), '[]'::jsonb)
    into v_carry
    from purchase_stock_moves m join purchase_lines l on l.id = m.line_id where l.purchase_id = p_purchase;
  perform set_config('dacs.purchase_write', 'on', true);
  perform pur_clear_rows(p_purchase);
  delete from purchase_stock_moves m using purchase_lines l where l.id = m.line_id and l.purchase_id = p_purchase;
  update purchases set status = 'void', updated_at = now() where id = p_purchase;
  v_result := pur_insert(v_owner, v_uid, v_body, v_carry, v_keep, v_hist, coalesce(pu.bought_by, pu.recorded_by));
  update purchases set replaced_by = (v_result ->> 'purchase_id')::uuid where id = p_purchase;
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'replaced', btrim(p_reason), v_before, jsonb_build_object('replaced_by', v_result ->> 'purchase_id'), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'replace', v_result);
  perform set_config('dacs.purchase_write', '', true);
  return v_result;
end;
$$;

-- 0096's header check, accepting the Purchasing tab's source.
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
end;
$$;

-- 0096's document, plus who bought, the supplier picked and each line's
-- request link, covers and unit check.
create or replace function pur_doc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', pu.id, 'status', pu.status, 'source', pu.source, 'purchase_date', pu.purchase_date,
    'date_time', pu.date_time, 'supplier', pu.supplier, 'supplier_id', pu.supplier_id,
    'bought_by', pu.bought_by, 'receipt_total', pu.receipt_total, 'notes', pu.notes,
    'payment_method', pu.payment_method, 'docs', pu.docs,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'line', l.line_no, 'destination', l.destination, 'folder_id', l.folder_id, 'folder_name', l.folder_name,
                'item_name', l.item_name, 'category', l.category, 'quantity', l.quantity, 'unit', l.unit,
                'amount', l.gross_amount, 'in_inventory', l.in_inventory, 'min_stock', l.min_stock,
                'needs_funding_review', l.needs_funding_review,
                'request_line_id', l.request_line_id, 'portion_picks', l.portion_picks,
                'covered', l.covered_qty, 'extra', l.extra_qty, 'extra_reason', l.extra_reason,
                'extra_location', l.extra_location, 'unit_check', l.unit_check, 'unit_covers', l.unit_covers,
                'unplanned_reason', l.unplanned_reason, 'substitute', l.substitute,
                'substitute_reason', l.substitute_reason) order by l.line_no), '[]'::jsonb)
                from purchase_lines l where l.purchase_id = pu.id),
    'charges', (select coalesce(jsonb_agg(jsonb_build_object(
                  'kind', c.kind, 'amount', c.amount,
                  'shares', (select coalesce(jsonb_agg(jsonb_build_object('line', l.line_no, 'amount', s.amount) order by l.line_no), '[]'::jsonb)
                               from purchase_charge_shares s join purchase_lines l on l.id = s.line_id where s.charge_id = c.id))
                  order by c.charge_no), '[]'::jsonb)
                  from purchase_charges c where c.purchase_id = pu.id))
  from purchases pu where pu.id = p_purchase
$$;

-- The office confirms how much a different-unit or substitute purchase line
-- covers, in the REQUEST's unit (e.g. a box bought for a request in pcs
-- covers 12; a substitute that does the job covers what it replaces).
-- Audited (purchase_history 'unit_checked'). The owner, or a buyer who
-- neither recorded nor bought the purchase — never the buyer themself. The
-- purchase counts as changed (a change request waiting on it goes stale);
-- its other lines keep exactly the portions they covered.
create or replace function pur_check_unit(p_op uuid, p_purchase uuid, p_line_no int, p_covers numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner('purchasing');
  v_prev jsonb;
  pu purchases;
  v_before jsonb;
  v_line purchase_lines;
  v_hist jsonb;
  v_covers jsonb;
  v_result jsonb;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 1 and 300 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_covers is null or p_covers < 0 or p_covers > 1000000 or p_covers <> round(p_covers, 3) then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  perform pur_purchase_lock(p_purchase);
  perform pur_lock(pur_stored_keys(p_purchase));
  pu := pur_open(v_owner, p_purchase);
  if not is_owner() and v_uid in (pu.recorded_by, coalesce(pu.bought_by, pu.recorded_by)) then
    raise exception 'OWN_PURCHASE' using errcode = 'P0001';
  end if;
  select * into v_line from purchase_lines where purchase_id = p_purchase and line_no = p_line_no;
  if v_line.id is null or v_line.request_line_id is null or v_line.unit_check = 'none' then
    raise exception 'NO_UNIT_CHECK' using errcode = 'P0001';
  end if;
  v_before := pur_doc(p_purchase);
  v_hist := pur_cover_history(p_purchase);
  update purchase_lines
     set unit_check = 'confirmed', unit_covers = p_covers, unit_checked_by = v_uid, unit_checked_at = now(), unit_note = btrim(p_note)
   where id = v_line.id;
  update purchases set updated_at = now() where id = p_purchase;
  v_covers := pur_cover_lines(p_purchase, v_uid, v_hist);
  if (select covered_qty from purchase_lines where id = v_line.id) < p_covers then
    raise exception 'MORE_THAN_NEEDED' using errcode = 'P0001';
  end if;
  v_result := jsonb_build_object('purchase_id', p_purchase, 'covers', v_covers);
  insert into purchase_history (owner_id, purchase_id, kind, reason, before, after, actor_id)
  values (v_owner, p_purchase, 'unit_checked', btrim(p_note), v_before, pur_doc(p_purchase), v_uid);
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'unit_check', v_result);
  return v_result;
end;
$$;

-- ════ 6. Owner approval of staff changes (Q13 = B) ═══════════════════

-- Does this change body link a line to a request, or pick portions,
-- differently from the stored purchase (same line number)? Lines the body
-- leaves unlinked keep their stored link (pur_inherit), so Project
-- Control's form never does. Picks compare as pur_store stores them.
create or replace function pur_links_changed(p_purchase uuid, p_body jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from jsonb_array_elements(pur_inherit(p_purchase, p_body) -> 'lines') with ordinality n(v, i)
      left join purchase_lines l on l.purchase_id = p_purchase and l.line_no = n.i
     where coalesce(btrim(n.v ->> 'request_line_id'), '') <> ''
       and (l.id is null
            or pur_uuid(n.v ->> 'request_line_id') is distinct from l.request_line_id
            or (select coalesce(jsonb_agg(jsonb_build_object('portion_id', pur_uuid(p.v ->> 'portion_id'),
                                                             'quantity', pur_qty(p.v ->> 'quantity')) order by p.k), '[]'::jsonb)
                  from jsonb_array_elements(case when jsonb_typeof(n.v -> 'portion_picks') = 'array'
                                                 then n.v -> 'portion_picks' else '[]'::jsonb end) with ordinality p(v, k))
               is distinct from l.portion_picks))
$$;

-- Does this change body take a request link OFF the stored purchase? Per
-- request line: the body must carry at least as many lines linked to it as
-- the stored purchase has. For a correction pass the body AFTER pur_inherit
-- (an omitted key keeps the link; an explicit null drops it).
create or replace function pur_links_dropped(p_purchase uuid, p_body jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from (select l.request_line_id, count(*) n from purchase_lines l
             where l.purchase_id = p_purchase and l.request_line_id is not null
             group by l.request_line_id) s
     where s.n > (select count(*)
                    from jsonb_array_elements(case when jsonb_typeof(p_body -> 'lines') = 'array' then p_body -> 'lines' else '[]'::jsonb end) b(v)
                   where pur_uuid(b.v ->> 'request_line_id') = s.request_line_id))
$$;

-- Staff send a change the server reserves for the owner — moving a cost to
-- another project, or touching a completed project — as a request. It
-- stores exactly what the owner will apply, and the purchase exactly as the
-- requester saw it (base_doc). A staff member without the Buyer switch may
-- not ask for a new request link or new picks (the owner would apply them
-- unseen as a buying decision). One pending request per purchase; a retry
-- with the same operation id returns the same request.
create or replace function pur_request_change(p_op uuid, p_purchase uuid, p_kind text, p_body jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := pur_actor_owner(case when p_kind = 'void' then 'expenses_form' else coalesce(p_body ->> 'source', 'expenses_form') end);
  v_id uuid;
  pu purchases;
begin
  if p_op is null then
    raise exception 'BAD_OP' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pur_cr_op:' || v_uid || ':' || p_op, 0));
  select r.id into v_id from purchase_change_requests r where r.requested_by = v_uid and r.op_id = p_op;
  if v_id is not null then
    return (select jsonb_build_object('request_id', r.id, 'status', r.status, 'replayed', true)
              from purchase_change_requests r where r.id = v_id);
  end if;
  if coalesce(is_owner(), false) then
    raise exception 'OWNER_CAN_DO_IT' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('correct', 'replace', 'void') then
    raise exception 'BAD_KIND' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_kind = 'void' then
    if p_body is not null and jsonb_typeof(p_body) <> 'null' then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
  else
    perform pur_header_ok(p_body);
    if jsonb_typeof(p_body -> 'lines') is distinct from 'array' or jsonb_array_length(p_body -> 'lines') not between 1 and 50 then
      raise exception 'BAD_LINES' using errcode = 'P0001';
    end if;
  end if;
  perform pur_purchase_lock(p_purchase);
  select * into pu from purchases where id = p_purchase and owner_id = v_owner;
  if pu.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if pu.status <> 'recorded' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if p_kind = 'correct' and jsonb_array_length(p_body -> 'lines') <> (select count(*) from purchase_lines where purchase_id = p_purchase) then
    raise exception 'LINES_CHANGED' using errcode = 'P0001';
  end if;
  if p_kind <> 'void' and not pur_buyer() and pur_links_changed(p_purchase, p_body) then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  if p_kind <> 'void' and not pur_buyer()
     and pur_links_dropped(p_purchase, case when p_kind = 'correct' then pur_inherit(p_purchase, p_body) else p_body end) then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001',
      hint = 'Taking a purchase off its request needs the Buyer switch.';
  end if;
  begin
    insert into purchase_change_requests (owner_id, purchase_id, kind, body, reason, base_updated_at, base_doc, requested_by, op_id)
    values (v_owner, p_purchase, p_kind, case when p_kind = 'void' then null else p_body end, btrim(p_reason),
            pu.updated_at, pur_doc(p_purchase), v_uid, p_op)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'ALREADY_PENDING' using errcode = 'P0001';
  end;
  return jsonb_build_object('request_id', v_id, 'status', 'pending');
end;
$$;

-- The requester takes back a request the owner has not decided.
create or replace function pur_withdraw_change(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  update purchase_change_requests set status = 'withdrawn', decided_by = v_uid, decided_at = now()
   where id = p_request and requested_by = v_uid and status = 'pending';
  if not found then
    raise exception 'NOT_PENDING' using errcode = 'P0001';
  end if;
  return jsonb_build_object('request_id', p_request, 'status', 'withdrawn');
end;
$$;

-- The owner approves or rejects. Approving re-checks that the purchase
-- still reads exactly as the requester saw it — every header field, line,
-- cover, office check, receipt and fee split (pur_doc = base_doc), and its
-- updated_at — else the request is marked 'stale' and nothing is applied;
-- then runs the very same correct / replace / void as the owner — every
-- money, coverage and stock rule applies unchanged. A rejection needs a
-- note. Retry-safe like the other operations.
create or replace function pur_decide_change(p_op uuid, p_request uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_owner uuid;
  r purchase_change_requests;
  pu purchases;
  v_apply uuid;
  v_reason text;
  v_applied jsonb;
  v_result jsonb;
begin
  if v_uid is null or not coalesce(is_owner(), false) then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  v_owner := pur_actor_owner('expenses_form');
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if p_approve is null then
    raise exception 'BAD_DECISION' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) > 500 or (not p_approve and btrim(coalesce(p_note, '')) = '') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select * into r from purchase_change_requests where id = p_request and owner_id = v_owner for update;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'NOT_PENDING' using errcode = 'P0001';
  end if;

  if not p_approve then
    update purchase_change_requests set status = 'rejected', decided_by = v_uid, decided_at = now(),
                                        decision_note = btrim(p_note)
     where id = r.id;
    v_result := jsonb_build_object('request_id', r.id, 'status', 'rejected');
  else
    perform pur_purchase_lock(r.purchase_id);
    select * into pu from purchases where id = r.purchase_id;
    if pu.status <> 'recorded' or pu.updated_at <> r.base_updated_at or pur_doc(pu.id) is distinct from r.base_doc then
      update purchase_change_requests set status = 'stale', decided_by = v_uid, decided_at = now(),
                                          decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                                                                   'The purchase changed after this request — ask for a new one')
       where id = r.id;
      v_result := jsonb_build_object('request_id', r.id, 'status', 'stale');
    else
      v_apply := md5(p_op::text || ':apply')::uuid;
      v_reason := r.reason || ' (requested by ' || pur_person_name(r.requested_by) || ', approved by the owner)';
      v_applied := case r.kind
                     when 'correct' then pur_correct(v_apply, r.purchase_id, r.body, v_reason)
                     when 'replace' then pur_replace(v_apply, r.purchase_id, r.body, v_reason)
                     else pur_void(v_apply, r.purchase_id, v_reason)
                   end;
      update purchase_change_requests set status = 'approved', decided_by = v_uid, decided_at = now(),
                                          decision_note = btrim(coalesce(p_note, '')), result = v_applied
       where id = r.id;
      v_result := jsonb_build_object('request_id', r.id, 'status', 'approved', 'result', v_applied);
    end if;
  end if;
  insert into pur_ops (owner_id, op_id, actor_id, kind, result) values (v_owner, p_op, v_uid, 'decide', v_result);
  return v_result;
end;
$$;

-- A purchase document (pur_doc) or a change body, in the words the owner
-- reviews: every header field (date and time, supplier, who bought, total,
-- payment, notes, which receipt photos), every line (item, quantity, unit,
-- amount, project and work, request, picked portions with their weekly
-- cutoff, extra, substitute, Unplanned reason) and every fee or discount
-- with its split per line — the automatic split (pur_prorate) when the body
-- gives none. Names only where the document has ids; this company's only.
create or replace function pur_review_doc(p_owner uuid, p_doc jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_charges jsonb := '[]'::jsonb;
  v_weights numeric[] := '{}';
  v_shares numeric[];
  v_l jsonb;
  v_c jsonb;
  v_n int := 0;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then
    return null;
  end if;
  for v_l in select value from jsonb_array_elements(case when jsonb_typeof(p_doc -> 'lines') = 'array' then p_doc -> 'lines' else '[]'::jsonb end) loop
    v_n := v_n + 1;
    v_lines := v_lines || jsonb_build_object(
      'line', v_n,
      'item_name', btrim(coalesce(v_l ->> 'item_name', '')),
      'category', btrim(coalesce(v_l ->> 'category', '')),
      'quantity', case when v_l ->> 'quantity' is null then 1 else pur_qty(v_l ->> 'quantity') end,
      'unit', btrim(coalesce(v_l ->> 'unit', '')),
      'amount', pur_money(v_l ->> 'amount'),
      'in_inventory', (v_l ->> 'in_inventory') = 'true',
      'where', case when coalesce(v_l ->> 'destination', 'project') = 'warehouse' then 'Warehouse'
                    else (select case when f.parent_folder_id is null then f.name || ' · Main Contract' else par.name || ' · ' || f.name end
                            from folders f left join folders par on par.id = f.parent_folder_id
                           where f.id = pur_uuid(v_l ->> 'folder_id') and f.owner_id = p_owner) end,
      'request', (select rl.description || case when rl.spec <> '' then ' ' || rl.spec else '' end || ' (' || rl.unit || ')'
                    from pr_lines rl where rl.id = pur_uuid(v_l ->> 'request_line_id') and rl.owner_id = p_owner),
      'picks', (select coalesce(jsonb_agg(jsonb_build_object('quantity', pur_qty(p.v ->> 'quantity'), 'cutoff_at', b.cutoff_at,
                                                         'buyer', case when po.buyer_id is null then null else pur_person_name(po.buyer_id) end) order by p.k), '[]'::jsonb)
                  from jsonb_array_elements(case when jsonb_typeof(v_l -> 'portion_picks') = 'array' then v_l -> 'portion_picks' else '[]'::jsonb end)
                       with ordinality p(v, k)
                  left join pr_line_portions po on po.id = pur_uuid(p.v ->> 'portion_id') and po.owner_id = p_owner
                  left join pr_batches b on b.id = po.batch_id),
      'extra_reason', btrim(coalesce(v_l ->> 'extra_reason', '')),
      'extra_location', v_l ->> 'extra_location',
      'substitute', (v_l ->> 'substitute') = 'true',
      'substitute_reason', btrim(coalesce(v_l ->> 'substitute_reason', '')),
      'unplanned_reason', btrim(coalesce(v_l ->> 'unplanned_reason', '')));
    v_weights := v_weights || coalesce(pur_money(v_l ->> 'amount'), 0);
  end loop;
  for v_c in select value from jsonb_array_elements(case when jsonb_typeof(p_doc -> 'charges') = 'array' then p_doc -> 'charges' else '[]'::jsonb end) loop
    if jsonb_typeof(v_c -> 'shares') = 'array' and jsonb_array_length(v_c -> 'shares') > 0 then
      select coalesce(array_agg(coalesce((select sum(pur_money(s ->> 'amount')) from jsonb_array_elements(v_c -> 'shares') s
                                           where s ->> 'line' = k::text), 0) order by k), '{}')
        into v_shares from generate_series(1, v_n) k;
    else
      v_shares := pur_prorate(coalesce(pur_money(v_c ->> 'amount'), 0), v_weights);
    end if;
    v_charges := v_charges || jsonb_build_object('kind', v_c ->> 'kind', 'amount', pur_money(v_c ->> 'amount'),
                                                 'shares', to_jsonb(coalesce(v_shares, '{}'::numeric[])));
  end loop;
  return jsonb_build_object(
    'purchase_date', p_doc ->> 'purchase_date',
    'date_time', coalesce(nullif(p_doc ->> 'date_time', ''), p_doc ->> 'purchase_date'),
    'supplier', coalesce(nullif(btrim(coalesce(p_doc ->> 'supplier', '')), ''),
                         (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end
                            from suppliers s where s.id = pur_uuid(p_doc ->> 'supplier_id') and s.owner_id = p_owner), ''),
    'bought_by', case when pur_uuid(p_doc ->> 'bought_by') is null then null else pur_person_name(pur_uuid(p_doc ->> 'bought_by')) end,
    'receipt_total', pur_money(p_doc ->> 'receipt_total'),
    'payment_method', btrim(coalesce(p_doc ->> 'payment_method', '')),
    'notes', btrim(coalesce(p_doc ->> 'notes', '')),
    -- Which receipt photos, and a short fingerprint of each, so a replaced photo shows as a change.
    'receipts', (select coalesce(jsonb_object_agg(d.k, left(md5(d.v), 8)), '{}'::jsonb)
                   from jsonb_each_text(case when jsonb_typeof(p_doc -> 'docs') = 'object' then p_doc -> 'docs' else '{}'::jsonb end) d(k, v)
                  where coalesce(d.v, '') <> ''),
    'lines', v_lines,
    'charges', v_charges);
end;
$$;

-- Change requests: the owner sees the company's; staff see their own. Each
-- carries the purchase as the requester saw it ('base'), as it is now
-- ('current') and as asked for ('proposed' — a correction as the server
-- will apply it: unlinked lines keep their link, receipts merge), all in
-- pur_review_doc's words; 'changed_since' = approving now would go stale.
create or replace function pur_change_requests(p_scope text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  v_owner := pur_actor_owner('expenses_form');
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', r.id, 'purchase_id', r.purchase_id, 'kind', r.kind, 'reason', r.reason, 'status', r.status,
            'requested_by', r.requested_by, 'requested_by_name', pur_person_name(r.requested_by),
            'requested_at', r.requested_at, 'decided_by_name', case when r.decided_by is null then null else pur_person_name(r.decided_by) end,
            'decided_at', r.decided_at, 'decision_note', r.decision_note,
            'changed_since', r.status = 'pending' and (pu.status <> 'recorded' or pu.updated_at <> r.base_updated_at
                                                       or pur_doc(pu.id) is distinct from r.base_doc),
            -- Whoever may not read purchases (R3) gets only their own proposal back.
            'base', case when coalesce(is_owner(), false) or pur_buyer() then pur_review_doc(r.owner_id, r.base_doc) end,
            'current', case when coalesce(is_owner(), false) or pur_buyer() then pur_review_doc(r.owner_id, pur_doc(r.purchase_id)) end,
            'proposed', case when r.body is null then null
                             when r.kind = 'correct' then pur_review_doc(r.owner_id,
                               jsonb_set(pur_inherit(r.purchase_id, r.body), '{docs}',
                                         coalesce(r.base_doc -> 'docs', '{}'::jsonb) || coalesce(r.body -> 'docs', '{}'::jsonb)))
                             else pur_review_doc(r.owner_id, r.body) end)
          order by r.requested_at desc), '[]'::jsonb)
            from purchase_change_requests r
            join purchases pu on pu.id = r.purchase_id
           where r.owner_id = v_owner
             and (coalesce(is_owner(), false) or r.requested_by = auth.uid())
             and (coalesce(p_scope, 'pending') = 'all' or r.status = 'pending'));
end;
$$;

-- ════ 7. What the Purchasing tab reads ═══════════════════════════════

-- The shopping list: every open request line with something still to buy
-- (or a different-unit purchase waiting for its check), one entry per
-- line with its portions. p_batch = only that batch's portions; p_folder =
-- that project (and its Additional Works). Quantities and names only.
-- Changed = the quantity changed after a portion was assigned.
create or replace function pur_shopping_list(p_batch uuid default null, p_folder uuid default null, p_scope text default 'open')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
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
                 'bought', pr_line_bought(l.id),
                 'from_stock', 0,
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
                            'bought', pr_portion_bought(p.id),
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

-- One purchase as the Purchasing tab shows it: the document, who recorded
-- and who bought, each line's request and covers, the history and any
-- change requests.
create or replace function pur_purchase_view(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select pur_doc(pu.id) || jsonb_build_object(
    'recorded_by_name', pur_person_name(pu.recorded_by),
    'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
    'created_at', pu.created_at, 'updated_at', pu.updated_at, 'replaced_by', pu.replaced_by,
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
                   'bought', pr_line_bought(rl.id)) order by l.line_no), '[]'::jsonb)
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

-- The purchases list (newest first, at most 300): every purchase of the
-- company in the date range, optionally one project's. Buyers only.
create or replace function pur_purchases(p_from date default null, p_to date default null, p_folder uuid default null,
                                         p_status text default 'recorded') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select coalesce(jsonb_agg(x.doc order by x.purchase_date desc, x.created_at desc), '[]'::jsonb)
            from (select pu.purchase_date, pu.created_at,
                         jsonb_build_object(
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
                           'pending_change', exists (select 1 from purchase_change_requests r where r.purchase_id = pu.id and r.status = 'pending')
                         ) as doc
                    from purchases pu
                   where pu.owner_id = v_owner
                     and (p_from is null or pu.purchase_date >= p_from)
                     and (p_to is null or pu.purchase_date <= p_to)
                     and (coalesce(p_status, 'recorded') = 'all' or pu.status = coalesce(p_status, 'recorded'))
                     and (p_folder is null or exists (select 1 from purchase_lines l
                                                        left join folders f on f.id = l.folder_id
                                                       where l.purchase_id = pu.id
                                                         and (l.folder_id = p_folder or f.parent_folder_id = p_folder)))
                   order by pu.purchase_date desc, pu.created_at desc
                   limit 300) x);
end;
$$;

-- One purchase, for buyers (and for the owner deciding a change request).
create or replace function pur_purchase(p_purchase uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from purchases pu where pu.id = p_purchase and pu.owner_id = data_owner_id()) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return pur_purchase_view(p_purchase);
end;
$$;

-- Project Control's data entry (owner decision 2026-10-15) for every account
-- that may record — including staff without the Buyer switch, who no longer
-- read purchase tables (R3): the ONE purchase line behind an expense row
-- (p_line), or the purchase behind a fee/discount row (p_charge), with its
-- header and how many lines and charges it has (only a one-line purchase
-- without fees is edited there). Nothing else: no other line, cover,
-- request, buyer, history or change request.
create or replace function pur_entry_row(p_line uuid, p_charge uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := pur_actor_owner('expenses_form');
  v_purchase uuid;
  v_whole boolean;
  l purchase_lines;
begin
  if p_line is not null then
    select * into l from purchase_lines where id = p_line and owner_id = v_owner;
    v_purchase := l.purchase_id;
  elsif p_charge is not null then
    select c.purchase_id into v_purchase from purchase_charges c where c.id = p_charge and c.owner_id = v_owner;
  end if;
  if v_purchase is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  -- The header (supplier, total, notes, receipts) only where the form can
  -- edit it: a buyer, or a purchase of one line without fees.
  v_whole := pur_buyer() or ((select count(*) from purchase_lines x where x.purchase_id = v_purchase) = 1
                             and not exists (select 1 from purchase_charges x where x.purchase_id = v_purchase));
  return (select jsonb_build_object(
            'purchase', case when v_whole then jsonb_build_object('id', pu.id, 'status', pu.status, 'purchase_date', pu.purchase_date,
                                           'date_time', pu.date_time, 'supplier', pu.supplier, 'receipt_total', pu.receipt_total,
                                           'notes', pu.notes, 'payment_method', pu.payment_method, 'docs', pu.docs)
                             else jsonb_build_object('id', pu.id, 'status', pu.status) end,
            'line', case when l.id is null then null else jsonb_build_object(
                       'id', l.id, 'purchase_id', l.purchase_id, 'line_no', l.line_no, 'folder_id', l.folder_id,
                       'item_name', l.item_name, 'category', l.category, 'quantity', l.quantity, 'unit', l.unit,
                       'gross_amount', l.gross_amount, 'in_inventory', l.in_inventory, 'min_stock', l.min_stock) end,
            'line_count', (select count(*) from purchase_lines x where x.purchase_id = pu.id),
            'charge_count', (select count(*) from purchase_charges x where x.purchase_id = pu.id))
            from purchases pu where pu.id = v_purchase);
end;
$$;

-- The "Office review" mark in Expenses and Project Control: ids of the lines
-- the server charged to Cover for want of a billing period (0096) — ids only.
create or replace function pur_review_lines() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  return (select coalesce(jsonb_agg(l.id), '[]'::jsonb) from purchase_lines l
           where l.owner_id = v_owner and l.needs_funding_review);
end;
$$;

-- ════ 8. Purchase receipt photos (Q14 / Q17) ═════════════════════════

-- 0089's rules plus one folder: purchases/<company>/<yyyy-mm>/<uuid>.jpg —
-- read and written only by accounts that may BUY in that company (owner,
-- full admin accounts, Buyer staff). Clients, partners, workers, team
-- leaders and non-Buyer staff never. Checked before the generic owner/staff
-- rule, like the 0089 receipt folders.
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

-- 0089's overwrite policy, with the purchases folder locked the same way.
drop policy if exists "uploads_admin_update" on storage.objects;
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end);

-- The upload ledger (0089) learns the purchase kind.
alter table public.receipt_uploads drop constraint if exists receipt_uploads_path_check;
alter table public.receipt_uploads add constraint receipt_uploads_path_check
  check (path ~ '^(expenseReceipts|payrollReceipts|purchases)/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$');
alter table public.receipt_uploads drop constraint if exists receipt_uploads_kind_check;
alter table public.receipt_uploads add constraint receipt_uploads_kind_check check (kind in ('expense', 'payroll', 'purchase'));
drop policy if exists receipt_uploads_insert on public.receipt_uploads;
create policy receipt_uploads_insert on public.receipt_uploads
  for insert to authenticated
  with check ((is_owner() or is_staff())
              and owner_id = data_owner_id()
              and uploaded_by = auth.uid()
              and state = 'pending'
              and split_part(path, '/', 2) = owner_id::text
              and (kind <> 'purchase' or pur_buyer())
              and split_part(path, '/', 1) = case kind when 'expense' then 'expenseReceipts'
                                                       when 'payroll' then 'payrollReceipts'
                                                       else 'purchases' end);

-- A purchase's own receipt marks its upload attached — a warehouse-only
-- purchase writes no expense row to do it.
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
drop trigger if exists purchases_receipt_attach on public.purchases;
create trigger purchases_receipt_attach
  after insert or update of docs on public.purchases for each row execute function public.receipt_mark_attached();

-- ════ 9. Permissions ═════════════════════════════════════════════════

-- Called by Dacs Web (each checks the caller itself).
revoke all on function pur_me() from public, anon;
grant execute on function pur_me() to authenticated;
revoke all on function pur_office_buyers() from public, anon;
grant execute on function pur_office_buyers() to authenticated;
revoke all on function pur_set_buyer(uuid, boolean) from public, anon;
grant execute on function pur_set_buyer(uuid, boolean) to authenticated;
revoke all on function pur_buyer_options() from public, anon;
grant execute on function pur_buyer_options() to authenticated;
revoke all on function pur_suppliers() from public, anon;
grant execute on function pur_suppliers() to authenticated;
revoke all on function pur_save_supplier(uuid, text, text, text, boolean) from public, anon;
grant execute on function pur_save_supplier(uuid, text, text, text, boolean) to authenticated;
revoke all on function pur_assign_portion(uuid, uuid, numeric, text) from public, anon;
grant execute on function pur_assign_portion(uuid, uuid, numeric, text) to authenticated;
revoke all on function pur_check_unit(uuid, uuid, int, numeric, text) from public, anon;
grant execute on function pur_check_unit(uuid, uuid, int, numeric, text) to authenticated;
revoke all on function pur_request_change(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function pur_request_change(uuid, uuid, text, jsonb, text) to authenticated;
revoke all on function pur_withdraw_change(uuid) from public, anon;
grant execute on function pur_withdraw_change(uuid) to authenticated;
revoke all on function pur_decide_change(uuid, uuid, boolean, text) from public, anon;
grant execute on function pur_decide_change(uuid, uuid, boolean, text) to authenticated;
revoke all on function pur_change_requests(text) from public, anon;
grant execute on function pur_change_requests(text) to authenticated;
revoke all on function pur_shopping_list(uuid, uuid, text) from public, anon;
grant execute on function pur_shopping_list(uuid, uuid, text) to authenticated;
revoke all on function pur_purchases(date, date, uuid, text) from public, anon;
grant execute on function pur_purchases(date, date, uuid, text) to authenticated;
revoke all on function pur_purchase(uuid) from public, anon;
grant execute on function pur_purchase(uuid) to authenticated;
revoke all on function pur_entry_row(uuid, uuid) from public, anon;
grant execute on function pur_entry_row(uuid, uuid) to authenticated;
revoke all on function pur_review_lines() from public, anon;
grant execute on function pur_review_lines() to authenticated;
-- Replaced in this file; CREATE OR REPLACE keeps 0096's grants, restated here.
revoke all on function pur_correct(uuid, uuid, jsonb, text) from public, anon;
grant execute on function pur_correct(uuid, uuid, jsonb, text) to authenticated;
revoke all on function pur_replace(uuid, uuid, jsonb, text) from public, anon;
grant execute on function pur_replace(uuid, uuid, jsonb, text) to authenticated;
-- Booleans about the caller only: the read and storage policies call them.
revoke all on function pur_buyer() from public, anon;
grant execute on function pur_buyer() to authenticated;
revoke all on function pur_reader() from public, anon;
grant execute on function pur_reader() to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function pur_can_buy(uuid, uuid) from public, anon, authenticated;
revoke all on function pur_person_name(uuid) from public, anon, authenticated;
revoke all on function pur_actor_owner(text) from public, anon, authenticated;
revoke all on function pr_portion_bought(uuid) from public, anon, authenticated;
revoke all on function pr_line_bought(uuid) from public, anon, authenticated;
revoke all on function pr_portion_still(uuid) from public, anon, authenticated;
revoke all on function pr_split_portion(uuid, numeric) from public, anon, authenticated;
revoke all on function pr_apply_quantity(uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function pur_body_keys(jsonb) from public, anon, authenticated;
revoke all on function pur_stored_keys(uuid) from public, anon, authenticated;
revoke all on function pur_bought_by(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function pur_supplier_of(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_store(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_cover_history(uuid) from public, anon, authenticated;
revoke all on function pur_cover_lines(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_links_changed(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_links_dropped(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_review_doc(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_keep_checks(uuid) from public, anon, authenticated;
revoke all on function pur_apply_checks(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_inherit(uuid, jsonb) from public, anon, authenticated;
revoke all on function pur_insert(uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function pur_header_ok(jsonb) from public, anon, authenticated;
revoke all on function pur_doc(uuid) from public, anon, authenticated;
revoke all on function pur_purchase_view(uuid) from public, anon, authenticated;
