-- 0107 — WorkMate Stage 3a: tools on the server (custody, no money).
--
-- Spec: docs/superpowers/specs/2026-09-29-workmate-prototype-and-workflow-guide.md
-- (§12 Reusable tools, §16 Stage 3); answers:
-- docs/superpowers/specs/2026-10-28-workmate-stage3-tools-questions.md (all A);
-- plan: docs/superpowers/plans/2026-10-28-workmate-stage3a-tools.md.
--
-- ── 1. What is a tool (Q3–Q6). Every catalogue item of kind "tool" is
--    tracked as NUMBERED tools — TOOL-0001, TOOL-0002… per company, never
--    reused (a cancelled, lost or retired tool keeps its number). From this
--    migration a tool item is never quantity stock: a match, a lot or a stock
--    record of a tool item is refused (TOOL_ITEM), and a purchase line that
--    has tools registered from it never becomes stock (TOOL_LINE).
--
-- ── 2. Getting tools in (Q7–Q9). The office registers each tool — from a
--    recorded purchase line (never more than it bought; its cost stays where
--    the purchase put it) or as an opening register, which needs a PHOTO of
--    the tool (Q7) — at the warehouse, or issued to a NAMED RESPONSIBLE
--    PERSON on a project. A tool at a project always has its person (Q10):
--    there is no "at the site, no one". A tool already damaged beyond repair
--    is registered at the warehouse: Under repair, with a Retire request
--    waiting for the main owner (as a damaged return, Q16).
--
-- ── 3. Custody (Q10–Q15). A tool is always in one state: available,
--    issued (one person, one project), repair, lost_pending, lost,
--    retire_pending, retired — or cancelled (registered by mistake). Only an
--    available tool is issued; an issued one is handed over person to person
--    (and project to project) or returned with its condition (Q16). A tool
--    registered at a project as needing repair or missing parts stays with
--    its named person and project but is NOT usable: it cannot be handed over
--    until it is marked Repaired there (or returned).
--
-- ── 4. Requests (Q13–Q14). A tool request line is filled by tools, each
--    counted once: FILLED = tools bought for the line (its purchases, as
--    before) + tools issued for it that were NOT bought for it (tl_covers).
--    A tool bought for the line and issued for it adds nothing — it is
--    already counted through its purchase. A return or a handover keeps the
--    line filled; reversing an issue reopens it only if that issue counted
--    on its own. pr_portion_bought / pr_line_bought (every Still to buy)
--    gain the tools term.
--
-- ── 5. The owner (Q16–Q17). Lost and Retire wait for the MAIN OWNER; while
--    they wait the tool cannot be issued, handed over or returned. Confirm →
--    lost / retired. Reject (or the office withdraws) → exactly where it was
--    before (a lost report), or Under repair (a retire request — it was
--    reported damaged). A lost tool can be Found.
--
-- ── 6. Never edited (Q18). A mistaken record is REVERSED with a reason, by
--    whoever recorded it or an owner, only while it is the tool's latest
--    record. A confirmed loss or retirement is not reversed (Found exists).
--
-- ── 7. No money (Q5). No peso amount is read or written here; nothing
--    touches expenses, Spent, Earned or Profit.
--
-- ── 8. Dormant until switched on (Q23). Every write is refused (TOOLS_OFF)
--    until the main owner switches tools on for the company — first for the
--    ZZ pilot, then kept on (launch) or switched off again.
--
-- Who holds a tool (T1 = C, the user's decision): anyone active in the
-- company — a worker, a team leader, office staff or an owner account —
-- never a client or partner account, never another company's people.
-- Who records: owner and office staff accounts allowed the Expenses section (the
-- same rule as stock); workers and team leaders record nothing in 3a (3b,
-- the phone, comes with the crew's move to WorkMate). Each call carries an
-- operation id (pur_ops): a retry returns the first answer. Locks: the
-- purchase, then the tool row, then request lines (pur_lock).

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- The switch, one row per company that ever had it (main owner only).
create table if not exists tl_settings (
  owner_id uuid primary key references profiles(id),
  enabled boolean not null default false,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);

-- One real tool. folder_id is history, not a foreign key (as
-- purchase_lines.folder_id). holder / folder: who has it and where while
-- issued — and, while lost or waiting to be, who had it last.
create table if not exists tl_tools (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  number int not null check (number > 0),
  item_id uuid not null references pr_catalog_items(id),
  purchase_id uuid references purchases(id),
  line_no int,
  details text not null default '' check (char_length(details) <= 200),
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  state text not null check (state in ('available', 'issued', 'repair', 'lost_pending', 'lost',
                                       'retire_pending', 'retired', 'cancelled')),
  condition text not null default 'good' check (condition in ('good', 'needs_repair', 'missing_parts', 'damaged')),
  holder_id uuid references profiles(id),
  folder_id uuid,
  since timestamptz not null default now(),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (owner_id, number),
  check ((purchase_id is null) = (line_no is null)),
  check (state <> 'issued' or (holder_id is not null and folder_id is not null)),
  check (state not in ('available', 'repair', 'retire_pending', 'retired', 'cancelled')
         or (holder_id is null and folder_id is null))
);
create index if not exists tl_tools_line on tl_tools (purchase_id, line_no) where purchase_id is not null;
create index if not exists tl_tools_holder on tl_tools (holder_id) where holder_id is not null;
create index if not exists tl_tools_folder on tl_tools (folder_id) where folder_id is not null;

-- One action on one tool. before / after: the tool's state, holder, folder
-- and condition around it (for a pending record, `after` is what the main
-- owner's confirmation sets). holder_id / folder_id: the custody the record
-- gave (issue, handover, register) or ended (return, lost).
create table if not exists tl_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  tool_id uuid not null references tl_tools(id),
  kind text not null check (kind in ('register', 'issue', 'handover', 'return', 'repaired', 'lost', 'found', 'retire')),
  status text not null default 'done' check (status in ('done', 'pending', 'rejected', 'withdrawn')),
  before jsonb not null,
  after jsonb not null,
  holder_id uuid references profiles(id),
  folder_id uuid,
  request_line_id uuid references pr_lines(id),
  condition text check (condition is null or condition in ('good', 'needs_repair', 'missing_parts', 'damaged')),
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  note text not null default '' check (char_length(note) <= 500),
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  reversed_by uuid references profiles(id),
  reversed_at timestamptz,
  reverse_reason text not null default '' check (char_length(reverse_reason) <= 500),
  check (status = 'done' or kind in ('lost', 'retire')),
  check (reversed_at is null or status = 'done')
);
create index if not exists tl_records_tool on tl_records (tool_id, recorded_at desc);
create index if not exists tl_records_owner on tl_records (owner_id, recorded_at desc);
create index if not exists tl_records_request_line on tl_records (request_line_id) where request_line_id is not null;

-- What an issue filled on a request line when the tool was NOT bought for
-- it (Q14). Counts while its issue is live.
create table if not exists tl_covers (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  record_id uuid not null references tl_records(id),
  request_line_id uuid not null references pr_lines(id),
  portion_id uuid references pr_line_portions(id) on delete set null,
  quantity numeric(14,3) not null check (quantity > 0)
);
create index if not exists tl_covers_portion on tl_covers (portion_id) where portion_id is not null;
create index if not exists tl_covers_request_line on tl_covers (request_line_id);
create index if not exists tl_covers_record on tl_covers (record_id);

-- Append-only: the switch, decisions, withdrawals and reversals.
create table if not exists tl_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('switched', 'confirmed', 'rejected', 'withdrawn', 'reversed')),
  record_id uuid references tl_records(id),
  detail jsonb not null default '{}'::jsonb,
  reason text not null default '',
  actor_id uuid not null references profiles(id),
  at timestamptz not null default now()
);

create or replace function tl_history_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists tl_events_no_change on tl_events;
create trigger tl_events_no_change before update or delete on tl_events
  for each row execute function tl_history_immutable();
drop trigger if exists tl_covers_no_change on tl_covers;
create trigger tl_covers_no_change before update or delete on tl_covers
  for each row execute function tl_history_immutable();
drop trigger if exists tl_records_no_delete on tl_records;
create trigger tl_records_no_delete before delete on tl_records
  for each row execute function tl_history_immutable();
drop trigger if exists tl_tools_no_delete on tl_tools;
create trigger tl_tools_no_delete before delete on tl_tools
  for each row execute function tl_history_immutable();

-- Every read and write goes through the functions below: no table policy.
alter table tl_settings enable row level security;
alter table tl_tools enable row level security;
alter table tl_records enable row level security;
alter table tl_covers enable row level security;
alter table tl_events enable row level security;

-- ════ 2. Who, and the switch ═════════════════════════════════════════

create or replace function tl_on(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.enabled from tl_settings s where s.owner_id = p_owner), false)
$$;

-- The caller's company, for a tools write: an owner or office staff account
-- allowed the Expenses section (stock's rule), while tools are on there.
create or replace function tl_actor() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  if not tl_on(v_owner) then
    raise exception 'TOOLS_OFF' using errcode = 'P0001';
  end if;
  return v_owner;
end;
$$;

-- The caller's company, for a tools read: the same accounts, while on.
create or replace function tl_reader() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not stk_can_record() then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if not tl_on(data_owner_id()) then
    raise exception 'TOOLS_OFF' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

-- What the screens need to know.
create or replace function tl_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_can boolean := stk_can_record();
begin
  return jsonb_build_object('enabled', v_can and tl_on(data_owner_id()), 'can_record', v_can,
                            'is_main_owner', pur_is_main_owner(),
                            'is_owner', auth.uid() is not null and coalesce(is_owner(), false), 'user_id', auth.uid());
end;
$$;

-- The main owner switches tools on (the ZZ pilot, then launch) or off.
create or replace function tl_set_enabled(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  if p_on is null then
    raise exception 'BAD_SWITCH' using errcode = 'P0001';
  end if;
  insert into tl_settings (owner_id, enabled, updated_by, updated_at) values (v_owner, p_on, auth.uid(), now())
  on conflict (owner_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
   where tl_settings.enabled is distinct from excluded.enabled;
  if found then
    insert into tl_events (owner_id, kind, detail, actor_id) values (v_owner, 'switched', jsonb_build_object('enabled', p_on), auth.uid());
  end if;
  return jsonb_build_object('enabled', p_on);
end;
$$;

-- ════ 3. Checks and helpers ══════════════════════════════════════════

-- A tool row of this company, held for the rest of the transaction.
create or replace function tl_tool_lock(p_owner uuid, p_tool uuid) returns tl_tools
language plpgsql security definer set search_path = public as $$
declare v tl_tools;
begin
  select * into v from tl_tools where id = p_tool and owner_id = p_owner for update;
  if v.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- A named responsible person (T1 = C): anyone active in this company — a
-- worker, a team leader, office staff or an owner account; never a client or
-- a partner.
create or replace function tl_person(p_owner uuid, p_person uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if p_person is null then
    raise exception 'PERSON_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (
       select 1 from profiles p
        where p.id = p_person and p.role in ('worker', 'teamLeader', 'staff', 'owner')
          and coalesce(p.status, 'active') = 'active' and coalesce(p.owner_id, p.id) = p_owner) then
    raise exception 'BAD_PERSON' using errcode = 'P0001';
  end if;
  return p_person;
end;
$$;

-- A holder's name: the crew by their name or worker number (as requests show
-- them), office and owner accounts by their name or e-mail (as purchasing does).
create or replace function tl_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p.role in ('worker', 'teamLeader') then pr_person_name(p.id) else pur_person_name(p.id) end
    from profiles p where p.id = p_id
$$;

-- A project of this company (Main Contract or an Additional Works job);
-- not completed unless p_completed_ok (a tool already out there).
create or replace function tl_project(p_owner uuid, p_folder uuid, p_completed_ok boolean default false) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  select f.id, f.completed_at is not null or coalesce(par.completed_at is not null, false) as done
    into v
    from folders f left join folders par on par.id = f.parent_folder_id
   where f.id = p_folder and f.owner_id = p_owner;
  if v.id is null then
    raise exception 'BAD_PROJECT' using errcode = 'P0001';
  end if;
  if v.done and not p_completed_ok then
    raise exception 'PROJECT_COMPLETED' using errcode = 'P0001';
  end if;
  return v.id;
end;
$$;

create or replace function tl_condition(p text, p_allow_damaged boolean) returns text
language plpgsql immutable as $$
begin
  if p is null or p not in ('good', 'needs_repair', 'missing_parts', 'damaged') or (p = 'damaged' and not p_allow_damaged) then
    raise exception 'BAD_CONDITION' using errcode = 'P0001';
  end if;
  return p;
end;
$$;

-- A photo: null, or a file this company's tools folder holds —
-- tools/<owner>/<yyyy-mm>/<uuid>.jpg (Dacs Web uploads it first).
create or replace function tl_photo(p_owner uuid, p text) returns text
language plpgsql immutable as $$
begin
  if coalesce(btrim(p), '') = '' then
    return null;
  end if;
  if p !~ ('^tools/' || p_owner::text || '/[0-9]{4}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'BAD_PHOTO' using errcode = 'P0001';
  end if;
  return p;
end;
$$;

-- The tool's custody as a record's before / after.
create or replace function tl_snap(t tl_tools) returns jsonb
language sql immutable as $$
  select jsonb_build_object('state', t.state, 'holder_id', t.holder_id, 'folder_id', t.folder_id,
                            'condition', t.condition, 'since', t.since)
$$;

-- Put a tool into a snapshot's custody (since = now unless the snapshot's own).
create or replace function tl_apply(p_tool uuid, p jsonb, p_keep_since boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  update tl_tools set state = p ->> 'state',
                      holder_id = (p ->> 'holder_id')::uuid,
                      folder_id = (p ->> 'folder_id')::uuid,
                      condition = p ->> 'condition',
                      since = case when p_keep_since and p ? 'since' then (p ->> 'since')::timestamptz else now() end
   where id = p_tool;
end;
$$;

-- The tool's latest record that still stands (done and not reversed, or
-- waiting for the owner).
create or replace function tl_latest(p_tool uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select r.id from tl_records r
   where r.tool_id = p_tool and r.status in ('done', 'pending') and r.reversed_at is null
   order by r.recorded_at desc, r.id desc limit 1
$$;

-- Write one record and move the tool into its `after` custody (a pending
-- record moves it into the waiting state its `after` names in `pending`).
create or replace function tl_write(p_owner uuid, t tl_tools, p_kind text, p_status text, p_after jsonb, p_extra jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_now jsonb := case when p_status = 'pending' then p_extra -> 'pending' else p_after end;
begin
  insert into tl_records (owner_id, tool_id, kind, status, before, after, holder_id, folder_id, request_line_id,
                          condition, photo_path, note, recorded_by)
  values (p_owner, t.id, p_kind, p_status, tl_snap(t), p_after,
          (p_extra ->> 'holder_id')::uuid, (p_extra ->> 'folder_id')::uuid, (p_extra ->> 'request_line_id')::uuid,
          p_extra ->> 'condition', p_extra ->> 'photo_path', coalesce(p_extra ->> 'note', ''), auth.uid())
  returning id into v_id;
  perform tl_apply(t.id, v_now, v_now ? 'since');
  return v_id;
end;
$$;

-- A purchase line counts as a TOOL line: tools were registered from it, or
-- it was bought for a tool request line.
create or replace function tl_tool_line(p_line purchase_lines) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tl_tools t where t.purchase_id = p_line.purchase_id and t.line_no = p_line.line_no
                    and t.state <> 'cancelled')
      or exists (select 1 from pr_lines r where r.id = p_line.request_line_id and r.kind = 'tool')
      or exists (select 1 from purchase_line_covers c join pr_lines r on r.id = c.request_line_id
                  where c.line_id = p_line.id and r.kind = 'tool')
$$;

-- Tools registered from a purchase line (a cancelled registration frees its place).
create or replace function tl_line_registered(p_purchase uuid, p_line_no int) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from tl_tools t where t.purchase_id = p_purchase and t.line_no = p_line_no and t.state <> 'cancelled'
$$;

-- ════ 4. Requests: covered = purchases + stock + tools (Q14) ═════════

create or replace function pr_portion_from_tools(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0) from tl_covers c join tl_records r on r.id = c.record_id
   where c.portion_id = p_portion and r.status = 'done' and r.reversed_at is null
$$;

create or replace function pr_line_from_tools(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0) from tl_covers c join tl_records r on r.id = c.record_id
   where c.request_line_id = p_line and r.status = 'done' and r.reversed_at is null
$$;

-- COVERED, for every capacity formula of 0097 (Still to buy, splitting,
-- assigning, reducing): recorded purchases, live stock records, and tools
-- issued for the line that were not bought for it.
create or replace function pr_portion_bought(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select pr_portion_purchased(p_portion) + pr_portion_from_stock(p_portion) + pr_portion_from_tools(p_portion)
$$;

create or replace function pr_line_bought(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select pr_line_purchased(p_line) + pr_line_from_stock(p_line) + pr_line_from_tools(p_line)
$$;

-- Is this issue already counted through the tool's purchase? The tool's
-- purchase line covered this request line, and fewer of that line's tools
-- than it covered are counted that way by live issues (so a line that
-- covered 2 counts 2 issues of its tools, never a 3rd).
create or replace function tl_bought_for(t tl_tools, p_line uuid, p_except uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select t.purchase_id is not null and
         coalesce((select floor(sum(c.quantity)) from purchase_line_covers c
                     join purchase_lines l on l.id = c.line_id join purchases pu on pu.id = l.purchase_id
                    where c.request_line_id = p_line and l.purchase_id = t.purchase_id and l.line_no = t.line_no
                      and pu.status = 'recorded'), 0)
         > (select count(*) from tl_records r join tl_tools x on x.id = r.tool_id
             where r.request_line_id = p_line and r.kind = 'issue' and r.status = 'done' and r.reversed_at is null
               and x.purchase_id = t.purchase_id and x.line_no = t.line_no and r.id is distinct from p_except
               and not exists (select 1 from tl_covers c where c.record_id = r.id))
$$;

-- Fill a tool request line with one tool NOT bought for it: the earliest
-- batch first, each portion up to its Still to buy. The caller holds the
-- 'pr_line:' lock.
create or replace function tl_cover(p_owner uuid, p_record uuid, p_folder uuid, p_line uuid, p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p record;
  v_left numeric := 1;
  v_take numeric;
  v_cap numeric;
begin
  for v_p in select p.* from pr_line_portions p join pr_batches b on b.id = p.batch_id
              where p.line_id = p_line order by b.cutoff_at, p.created_at, p.id for update of p
  loop
    exit when v_left <= 0;
    v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
    v_take := least(v_left, v_cap);
    continue when v_take <= 0;
    insert into tl_covers (owner_id, record_id, request_line_id, portion_id, quantity)
    values (p_owner, p_record, p_line, v_p.id, v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'REQUEST_EXCEEDED' using errcode = 'P0001',
      hint = 'That request line is already filled. Issue the tool without a request.';
  end if;
end;
$$;

-- A tool request line this issue may name: open, of a submitted request for
-- this project, a TOOL line, of this tool's catalogue item (when it names
-- one) and unit.
create or replace function tl_request_line(p_owner uuid, p_line uuid, p_folder uuid, p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_item pr_catalog_items;
begin
  select ln.id, ln.kind, ln.unit, ln.catalog_item_id, ln.status as line_status, r.status as request_status, r.work_folder_id
    into v
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line and ln.owner_id = p_owner for update of ln;
  if v.id is null or v.work_folder_id <> p_folder then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  if v.kind <> 'tool' then
    raise exception 'NOT_A_TOOL_LINE' using errcode = 'P0001';
  end if;
  if v.line_status <> 'open' or v.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into v_item from pr_catalog_items where id = p_item;
  if v.catalog_item_id is not null and v.catalog_item_id <> p_item then
    raise exception 'ITEM_MISMATCH' using errcode = 'P0001';
  end if;
  if lower(btrim(v.unit)) <> lower(btrim(v_item.unit)) then
    raise exception 'UNIT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$$;

-- ════ 5. Guards: tools are never quantity stock (Q6) ═══════════════

-- A tool item never becomes stock: no match, lot or stock record of it.
-- A purchase line with tools registered from it never becomes stock either.
create or replace function tl_no_tool_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null and exists (select 1 from pr_catalog_items c where c.id = new.item_id and c.kind = 'tool') then
    raise exception 'TOOL_ITEM' using errcode = 'P0001',
      hint = 'A tool is not counted as stock — register it under Requests → Tools.';
  end if;
  if tg_table_name in ('stk_matches', 'stk_records') and new.purchase_id is not null
     and tl_line_registered(new.purchase_id, new.line_no) > 0 then
    raise exception 'TOOL_LINE' using errcode = 'P0001',
      hint = 'Tools were registered from this purchase line — it is never stock.';
  end if;
  return new;
end;
$$;
drop trigger if exists tl_no_tool_stock on stk_matches;
create trigger tl_no_tool_stock before insert or update of item_id on stk_matches
  for each row execute function tl_no_tool_stock();
drop trigger if exists tl_no_tool_stock on stk_lots;
create trigger tl_no_tool_stock before insert or update of item_id on stk_lots
  for each row execute function tl_no_tool_stock();
drop trigger if exists tl_no_tool_stock on stk_records;
create trigger tl_no_tool_stock before insert on stk_records
  for each row execute function tl_no_tool_stock();

-- A purchase line may not lose the tools registered from it: the line
-- (same purchase, same line number) stays, with at least that many. A
-- correction deletes and re-inserts every line, so this is checked at the
-- end of the transaction.
create or replace function tl_guard_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_purchase uuid := case when tg_op = 'DELETE' then old.purchase_id else new.purchase_id end;
  v_line_no int := case when tg_op = 'DELETE' then old.line_no else new.line_no end;
  v_n int := tl_line_registered(v_purchase, v_line_no);
  v_qty numeric;
begin
  if v_n = 0 then
    return null;
  end if;
  select l.quantity into v_qty from purchase_lines l where l.purchase_id = v_purchase and l.line_no = v_line_no;
  if v_qty is null or v_qty < v_n then
    raise exception 'TOOLS_IN_USE' using errcode = 'P0001',
      hint = 'Line ' || v_line_no || ' has ' || v_n || ' tool(s) registered from it. Cancel those registrations first, or keep the line and enough quantity.';
  end if;
  return null;
end;
$$;
drop trigger if exists tl_guard_line on purchase_lines;
create constraint trigger tl_guard_line after insert or update or delete on purchase_lines
  deferrable initially deferred for each row execute function tl_guard_line();

-- A purchase with tools registered from it is never voided (nor replaced,
-- nor voided by an approved change request — they all void it).
create or replace function tl_guard_void() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'recorded' and new.status = 'void'
     and exists (select 1 from tl_tools t where t.purchase_id = old.id and t.state <> 'cancelled') then
    raise exception 'TOOLS_IN_USE' using errcode = 'P0001',
      hint = 'Tools were registered from this purchase. Cancel those registrations first.';
  end if;
  return new;
end;
$$;
drop trigger if exists tl_guard_void on purchases;
create trigger tl_guard_void before update of status on purchases
  for each row execute function tl_guard_void();

-- A catalogue item is IN USE once tools use it too (0104's test plus
-- tl_tools): its kind and unit are then fixed (Q3), so a numbered tool can
-- never turn into a quantity item, nor the other way round.
create or replace function pr_item_in_use(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pr_lines l where l.catalog_item_id = p_item)
      or exists (select 1 from stk_matches m where m.item_id = p_item)
      or exists (select 1 from stk_lots lt where lt.item_id = p_item)
      or exists (select 1 from stk_records r where r.item_id = p_item)
      or exists (select 1 from tl_tools t where t.item_id = p_item)
$$;

-- ════ 6. The operations ══════════════════════════════════════════════

-- Register tools (Q7–Q9). p_body: item_id, count (1–50), at ('warehouse' or
-- a project folder's id), holder_id (needed at a project), condition
-- ('good', 'needs_repair', 'missing_parts', or 'damaged' — at the warehouse
-- only), details, photo_path (needed for an opening register), note, and
-- optionally purchase_id + line_no (the purchase line they came from).
-- Several identical tools registered together share the one photo.
create or replace function tl_register(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  v_item pr_catalog_items;
  v_count int;
  v_at text := coalesce(btrim(p_body ->> 'at'), '');
  v_folder uuid;
  v_holder uuid;
  v_cond text := tl_condition(coalesce(nullif(p_body ->> 'condition', ''), 'good'), true);
  v_photo text := tl_photo(v_owner, p_body ->> 'photo_path');
  v_details text := btrim(coalesce(p_body ->> 'details', ''));
  v_purchase uuid := pur_uuid(p_body ->> 'purchase_id');
  v_line_no int;
  v_line purchase_lines;
  v_after jsonb;
  v_num int;
  t tl_tools;
  v_ids jsonb := '[]'::jsonb;
  v_retire uuid;
  i int;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  begin
    v_count := coalesce(nullif(p_body ->> 'count', ''), '1')::int;
  exception when others then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end;
  if v_count < 1 or v_count > 50 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if char_length(v_details) > 200 then
    raise exception 'BAD_NOTE' using errcode = 'P0001';
  end if;
  select * into v_item from pr_catalog_items where id = pur_uuid(p_body ->> 'item_id') and owner_id = v_owner for share;
  if v_item.id is null or not v_item.active then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  if v_item.kind <> 'tool' then
    raise exception 'NOT_A_TOOL' using errcode = 'P0001';
  end if;
  if v_at = 'warehouse' then
    v_after := jsonb_build_object('state', case when v_cond = 'good' then 'available' else 'repair' end,
                                  'holder_id', null, 'folder_id', null, 'condition', v_cond);
  else
    -- A tool damaged beyond repair waits at the warehouse for the owner (Q16).
    if v_cond = 'damaged' then
      raise exception 'DAMAGED_AT_PROJECT' using errcode = 'P0001';
    end if;
    -- At a project: always with its named responsible person (Q10).
    v_folder := tl_project(v_owner, pur_uuid(v_at));
    v_holder := tl_person(v_owner, pur_uuid(p_body ->> 'holder_id'));
    v_after := jsonb_build_object('state', 'issued', 'holder_id', v_holder, 'folder_id', v_folder, 'condition', v_cond);
  end if;
  if v_purchase is not null or nullif(p_body ->> 'line_no', '') is not null then
    begin
      v_line_no := (p_body ->> 'line_no')::int;
    exception when others then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end;
    perform pur_purchase_lock(v_purchase);
    v_line := stk_line(v_owner, v_purchase, v_line_no);
    if exists (select 1 from stk_records r where r.purchase_id = v_purchase and r.line_no = v_line_no
                  and r.status in ('done', 'pending') and r.reversed_at is null)
       or exists (select 1 from stk_matches m where m.purchase_id = v_purchase and m.line_no = v_line_no) then
      raise exception 'LINE_IS_STOCK' using errcode = 'P0001';
    end if;
    if tl_line_registered(v_purchase, v_line_no) + v_count > v_line.quantity then
      raise exception 'MORE_THAN_BOUGHT' using errcode = 'P0001',
        hint = 'Still to register from this line: ' || greatest(0, floor(v_line.quantity) - tl_line_registered(v_purchase, v_line_no)) || '.';
    end if;
    -- A warehouse line's tools start at the warehouse; a project line's at
    -- the warehouse or with a person on that project (Q8).
    if (v_line.destination = 'warehouse' and v_at <> 'warehouse')
       or (v_line.destination = 'project' and v_at <> 'warehouse' and v_folder is distinct from v_line.folder_id) then
      raise exception 'BAD_PLACE' using errcode = 'P0001';
    end if;
  end if;
  -- The opening register keeps a photo of each tool (Q7); one bought on a
  -- recorded purchase is traced by its purchase.
  if v_purchase is null and v_photo is null then
    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tl_number:' || v_owner, 0));
  select coalesce(max(number), 0) into v_num from tl_tools where owner_id = v_owner;
  for i in 1 .. v_count loop
    insert into tl_tools (owner_id, number, item_id, purchase_id, line_no, details, photo_path, state, condition, created_by)
    values (v_owner, v_num + i, v_item.id, v_purchase, case when v_purchase is null then null else v_line_no end,
            v_details, v_photo, 'cancelled', 'good', auth.uid())
    returning * into t;
    -- `before` of a registration: nothing yet (cancelled), so reversing it cancels the tool.
    perform tl_write(v_owner, t, 'register', 'done', v_after,
                     jsonb_build_object('holder_id', v_holder, 'folder_id', v_folder, 'condition', v_cond,
                                        'photo_path', v_photo, 'note', pur_note(p_body ->> 'note')));
    v_retire := null;
    if v_cond = 'damaged' then
      select * into t from tl_tools where id = t.id;
      v_retire := tl_write(v_owner, t, 'retire', 'pending',
                           jsonb_build_object('state', 'retired', 'holder_id', null, 'folder_id', null, 'condition', 'damaged'),
                           jsonb_build_object('note', coalesce(nullif(pur_note(p_body ->> 'note'), ''), 'Registered damaged beyond repair'),
                                              'pending', jsonb_build_object('state', 'retire_pending', 'holder_id', null,
                                                                            'folder_id', null, 'condition', 'damaged')));
    end if;
    v_ids := v_ids || jsonb_build_object('tool_id', t.id, 'number', t.number, 'retire_record_id', v_retire);
  end loop;
  return pur_op_done(v_owner, p_op, 'tl_register', jsonb_build_object('tools', v_ids));
end;
$$;

-- Issue an available tool to a named person on a project (Q10, Q13).
-- p_body: tool_id, holder_id, folder_id, request_line_id (optional), note, photo_path.
create or replace function tl_issue(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_holder uuid;
  v_folder uuid;
  v_req uuid := pur_uuid(p_body ->> 'request_line_id');
  v_rec uuid;
  v_counted boolean := false;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if t.state <> 'available' then
    raise exception 'NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  v_holder := tl_person(v_owner, pur_uuid(p_body ->> 'holder_id'));
  v_folder := tl_project(v_owner, pur_uuid(p_body ->> 'folder_id'));
  if nullif(p_body ->> 'request_line_id', '') is not null and v_req is null then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  if v_req is not null then
    perform pur_lock(array['pr_line:' || v_req]);
    perform tl_request_line(v_owner, v_req, v_folder, t.item_id);
    v_counted := not tl_bought_for(t, v_req);
  end if;
  v_rec := tl_write(v_owner, t, 'issue', 'done',
                    jsonb_build_object('state', 'issued', 'holder_id', v_holder, 'folder_id', v_folder, 'condition', t.condition),
                    jsonb_build_object('holder_id', v_holder, 'folder_id', v_folder, 'request_line_id', v_req,
                                       'photo_path', tl_photo(v_owner, p_body ->> 'photo_path'), 'note', pur_note(p_body ->> 'note')));
  if v_counted then
    perform tl_cover(v_owner, v_rec, v_folder, v_req, t.item_id);
  end if;
  return pur_op_done(v_owner, p_op, 'tl_issue', jsonb_build_object('record_id', v_rec, 'tool_id', t.id,
                                                                   'fills_request', v_counted, 'bought_for_request', v_req is not null and not v_counted));
end;
$$;

-- Hand an issued tool straight to another person (and, if need be, another
-- project) — never through the warehouse (Q15). p_body: tool_id, holder_id,
-- folder_id (optional: stays on its project), note.
create or replace function tl_handover(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_holder uuid;
  v_folder uuid;
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if t.state <> 'issued' then
    raise exception 'NOT_ISSUED' using errcode = 'P0001';
  end if;
  -- Not usable until repaired: it stays with its person and project (rev 3).
  if t.condition <> 'good' then
    raise exception 'NEEDS_REPAIR' using errcode = 'P0001';
  end if;
  v_holder := tl_person(v_owner, pur_uuid(p_body ->> 'holder_id'));
  if coalesce(p_body ->> 'folder_id', '') = '' or pur_uuid(p_body ->> 'folder_id') = t.folder_id then
    v_folder := t.folder_id;          -- staying on its project, completed or not
  else
    v_folder := tl_project(v_owner, pur_uuid(p_body ->> 'folder_id'));
  end if;
  if v_holder = t.holder_id and v_folder = t.folder_id then
    raise exception 'SAME_HOLDER' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'handover', 'done',
                    jsonb_build_object('state', 'issued', 'holder_id', v_holder, 'folder_id', v_folder, 'condition', t.condition),
                    jsonb_build_object('holder_id', v_holder, 'folder_id', v_folder, 'note', pur_note(p_body ->> 'note')));
  return pur_op_done(v_owner, p_op, 'tl_handover', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- A return, with its condition (Q16): good → available; needs repair or
-- missing parts → Under repair; damaged beyond repair → Under repair AND a
-- Retire request waiting for the main owner (cannot be issued meanwhile).
-- p_body: tool_id, condition, note, photo_path.
create or replace function tl_return(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_cond text := tl_condition(p_body ->> 'condition', true);
  v_rec uuid;
  v_retire uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if t.state <> 'issued' then
    raise exception 'NOT_ISSUED' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'return', 'done',
                    jsonb_build_object('state', case when v_cond = 'good' then 'available' else 'repair' end,
                                       'holder_id', null, 'folder_id', null, 'condition', v_cond),
                    jsonb_build_object('holder_id', t.holder_id, 'folder_id', t.folder_id, 'condition', v_cond,
                                       'photo_path', tl_photo(v_owner, p_body ->> 'photo_path'), 'note', pur_note(p_body ->> 'note')));
  if v_cond = 'damaged' then
    select * into t from tl_tools where id = t.id;
    v_retire := tl_write(v_owner, t, 'retire', 'pending',
                         jsonb_build_object('state', 'retired', 'holder_id', null, 'folder_id', null, 'condition', 'damaged'),
                         jsonb_build_object('note', coalesce(nullif(pur_note(p_body ->> 'note'), ''), 'Returned damaged beyond repair'),
                                            'pending', jsonb_build_object('state', 'retire_pending', 'holder_id', null,
                                                                          'folder_id', null, 'condition', 'damaged')));
  end if;
  return pur_op_done(v_owner, p_op, 'tl_return', jsonb_build_object('record_id', v_rec, 'tool_id', t.id, 'retire_record_id', v_retire));
end;
$$;

-- A tool is fixed. Under repair at the warehouse → available again. One
-- still with its person on a project, not in good condition (registered
-- there needing repair or missing parts) → good, with the SAME person,
-- project and days out (rev 3).
create or replace function tl_repaired(p_op uuid, p_tool uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, p_tool);
  if not (t.state = 'repair' or (t.state = 'issued' and t.condition <> 'good')) then
    raise exception 'NOT_IN_REPAIR' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'repaired', 'done',
                    case when t.state = 'issued'
                         then jsonb_build_object('state', 'issued', 'holder_id', t.holder_id, 'folder_id', t.folder_id,
                                                 'condition', 'good', 'since', t.since)
                         else jsonb_build_object('state', 'available', 'holder_id', null, 'folder_id', null, 'condition', 'good') end,
                    jsonb_build_object('holder_id', t.holder_id, 'folder_id', t.folder_id, 'condition', 'good', 'note', pur_note(p_note)));
  return pur_op_done(v_owner, p_op, 'tl_repaired', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- Report a tool lost (Q17): it waits for the main owner, and cannot be
-- issued, handed over or returned meanwhile; who had it stays recorded.
create or replace function tl_report_lost(p_op uuid, p_tool uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_reason text := pur_reason(p_reason);
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, p_tool);
  if t.state not in ('available', 'issued', 'repair') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'lost', 'pending',
                    jsonb_build_object('state', 'lost', 'holder_id', t.holder_id, 'folder_id', t.folder_id, 'condition', t.condition),
                    jsonb_build_object('holder_id', t.holder_id, 'folder_id', t.folder_id, 'note', v_reason,
                                       'pending', jsonb_build_object('state', 'lost_pending', 'holder_id', t.holder_id,
                                                                     'folder_id', t.folder_id, 'condition', t.condition)));
  return pur_op_done(v_owner, p_op, 'tl_report_lost', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- Ask the main owner to retire an Under-repair tool (Q16).
create or replace function tl_request_retire(p_op uuid, p_tool uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_reason text := pur_reason(p_reason);
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, p_tool);
  if t.state <> 'repair' then
    raise exception 'NOT_IN_REPAIR' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'retire', 'pending',
                    jsonb_build_object('state', 'retired', 'holder_id', null, 'folder_id', null, 'condition', t.condition),
                    jsonb_build_object('note', v_reason,
                                       'pending', jsonb_build_object('state', 'retire_pending', 'holder_id', null,
                                                                     'folder_id', null, 'condition', t.condition)));
  return pur_op_done(v_owner, p_op, 'tl_request_retire', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- A lost tool turned up (Q17): available if good, otherwise Under repair.
-- p_body: tool_id, condition, note.
create or replace function tl_found(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_cond text := tl_condition(p_body ->> 'condition', true);
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if t.state <> 'lost' then
    raise exception 'NOT_LOST' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'found', 'done',
                    jsonb_build_object('state', case when v_cond = 'good' then 'available' else 'repair' end,
                                       'holder_id', null, 'folder_id', null, 'condition', v_cond),
                    jsonb_build_object('condition', v_cond, 'note', pur_note(p_body ->> 'note')));
  return pur_op_done(v_owner, p_op, 'tl_found', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- The main owner confirms or rejects a Lost report or a Retire request
-- (Q16–Q17). Confirm → its `after` (lost / retired). Reject → its `before`:
-- exactly where the tool was before the report — for a retire request that
-- is always Under repair.
create or replace function tl_decide(p_op uuid, p_record uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  r tl_records;
  t tl_tools;
  v_note text;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if not pur_is_main_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  v_note := case when p_approve then pur_note(p_note) else pur_reason(p_note) end;
  select * into r from tl_records where id = p_record and owner_id = v_owner;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  t := tl_tool_lock(v_owner, r.tool_id);
  select * into r from tl_records where id = p_record;
  if r.status <> 'pending' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update tl_records set status = case when p_approve then 'done' else 'rejected' end,
                        decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = r.id;
  perform tl_apply(t.id, case when p_approve then r.after else r.before end, not p_approve);
  insert into tl_events (owner_id, kind, record_id, reason, actor_id)
  values (v_owner, case when p_approve then 'confirmed' else 'rejected' end, r.id, v_note, auth.uid());
  return pur_op_done(v_owner, p_op, 'tl_decide', jsonb_build_object('record_id', r.id, 'approved', p_approve));
end;
$$;

-- Withdraw a record still waiting for the owner (whoever recorded it, or the
-- main owner) — the same result as a rejection; or reverse a mistaken one
-- (whoever recorded it, or an owner) while it is the tool's latest record.
-- Reversing a registration cancels the tool (its number is never reused);
-- reversing an issue drops what it filled on its request line.
create or replace function tl_reverse(p_op uuid, p_record uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  r tl_records;
  t tl_tools;
  v_reason text := pur_reason(p_reason);
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into r from tl_records where id = p_record and owner_id = v_owner;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  t := tl_tool_lock(v_owner, r.tool_id);
  select * into r from tl_records where id = p_record;
  if r.request_line_id is not null then
    perform pur_lock(array['pr_line:' || r.request_line_id]);
  end if;
  if r.status = 'pending' then
    if auth.uid() <> r.recorded_by and not pur_is_main_owner() then
      raise exception 'NOT_YOURS' using errcode = 'P0001';
    end if;
    update tl_records set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_note = v_reason where id = r.id;
    perform tl_apply(t.id, r.before, true);
    insert into tl_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'withdrawn', r.id, v_reason, auth.uid());
    return pur_op_done(v_owner, p_op, 'tl_reverse', jsonb_build_object('record_id', r.id, 'status', 'withdrawn'));
  end if;
  if r.status <> 'done' or r.reversed_at is not null or r.kind in ('lost', 'retire') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if auth.uid() <> r.recorded_by and not is_owner() then
    raise exception 'NOT_YOURS' using errcode = 'P0001';
  end if;
  if tl_latest(t.id) <> r.id then
    raise exception 'LATER_RECORDS' using errcode = 'P0001';
  end if;
  update tl_records set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason where id = r.id;
  perform tl_apply(t.id, r.before, true);
  insert into tl_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'reversed', r.id, v_reason, auth.uid());
  return pur_op_done(v_owner, p_op, 'tl_reverse', jsonb_build_object('record_id', r.id, 'reversed', true));
end;
$$;

-- ════ 7. Reading (no money) ══════════════════════════════════════════

create or replace function tl_label(p_number int) returns text
language sql immutable as $$
  select 'TOOL-' || lpad(p_number::text, 4, '0')
$$;

create or replace function tl_folder_name(p_folder uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when f.parent_folder_id is null then f.name else coalesce(par.name, '') || ' — ' || f.name end
    from folders f left join folders par on par.id = f.parent_folder_id where f.id = p_folder
$$;

-- Whole days in the current state, by the Philippine calendar.
create or replace function tl_days(p_since timestamptz) returns int
language sql stable as $$
  select ((now() at time zone 'Asia/Manila')::date - (p_since at time zone 'Asia/Manila')::date)
$$;

create or replace function tl_tool_json(p_tool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'number', t.number, 'label', tl_label(t.number),
    'item_id', t.item_id, 'item_name', c.name, 'item_spec', c.spec, 'details', t.details, 'photo_path', t.photo_path,
    'state', t.state, 'condition', t.condition,
    'holder_id', t.holder_id, 'holder_name', case when t.holder_id is null then null else tl_person_name(t.holder_id) end,
    'folder_id', t.folder_id, 'folder_name', case when t.folder_id is null then null else tl_folder_name(t.folder_id) end,
    'since', t.since, 'days', tl_days(t.since),
    'purchase_id', t.purchase_id, 'line_no', t.line_no,
    'purchase_date', (select pu.purchase_date from purchases pu where pu.id = t.purchase_id),
    'pending_record_id', (select r.id from tl_records r where r.tool_id = t.id and r.status = 'pending' limit 1))
  from tl_tools t join pr_catalog_items c on c.id = t.item_id
  where t.id = p_tool
$$;

create or replace function tl_record_json(p_record uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'tool_id', r.tool_id, 'label', tl_label(t.number), 'item_name', c.name,
    'kind', r.kind, 'status', r.status, 'before', r.before, 'after', r.after,
    'holder_id', r.holder_id, 'holder_name', case when r.holder_id is null then null else tl_person_name(r.holder_id) end,
    'folder_id', r.folder_id, 'folder_name', case when r.folder_id is null then null else tl_folder_name(r.folder_id) end,
    'from_holder_name', case when r.before ->> 'holder_id' is null then null else tl_person_name((r.before ->> 'holder_id')::uuid) end,
    'request_line_id', r.request_line_id, 'request_description', rl.description,
    'fills_request', exists (select 1 from tl_covers x where x.record_id = r.id),
    'condition', r.condition, 'photo_path', r.photo_path, 'note', r.note,
    'recorded_by', r.recorded_by, 'recorded_by_name', pur_person_name(r.recorded_by), 'recorded_at', r.recorded_at,
    'decided_by_name', case when r.decided_by is null then null else pur_person_name(r.decided_by) end,
    'decided_at', r.decided_at, 'decision_note', r.decision_note,
    'reversed', r.reversed_at is not null, 'reversed_at', r.reversed_at, 'reverse_reason', r.reverse_reason,
    'reversed_by_name', case when r.reversed_by is null then null else pur_person_name(r.reversed_by) end,
    'latest', tl_latest(r.tool_id) = r.id)
  from tl_records r join tl_tools t on t.id = r.tool_id join pr_catalog_items c on c.id = t.item_id
  left join pr_lines rl on rl.id = r.request_line_id
  where r.id = p_record
$$;

-- The Tools screen: every tool (not cancelled), the tools out (longest
-- first), what waits for the owner, and purchase lines with tools to register.
create or replace function tl_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_reader();
begin
  return jsonb_build_object(
    'tools', (select coalesce(jsonb_agg(tl_tool_json(t.id) order by t.number), '[]'::jsonb)
                from tl_tools t where t.owner_id = v_owner and t.state <> 'cancelled'),
    'out', (select coalesce(jsonb_agg(tl_tool_json(t.id) order by t.since, t.number), '[]'::jsonb)
              from tl_tools t where t.owner_id = v_owner and t.state = 'issued'),
    'pending', (select coalesce(jsonb_agg(tl_record_json(r.id) order by r.recorded_at), '[]'::jsonb)
                  from tl_records r where r.owner_id = v_owner and r.status = 'pending'),
    'to_register', (select coalesce(jsonb_agg(jsonb_build_object(
                      'purchase_id', l.purchase_id, 'line_no', l.line_no, 'item_name', l.item_name, 'unit', l.unit,
                      'quantity', l.quantity, 'destination', l.destination, 'folder_id', l.folder_id,
                      'folder_name', case when l.folder_id is null then null else coalesce(tl_folder_name(l.folder_id), l.folder_name) end,
                      'purchase_date', pu.purchase_date, 'registered', tl_line_registered(l.purchase_id, l.line_no),
                      'suggested_item_id', (select r.catalog_item_id from pr_lines r where r.id = l.request_line_id and r.kind = 'tool'))
                      order by pu.purchase_date, l.purchase_id, l.line_no), '[]'::jsonb)
                      from purchase_lines l join purchases pu on pu.id = l.purchase_id
                     where pu.owner_id = v_owner and pu.status = 'recorded' and tl_tool_line(l)
                       and tl_line_registered(l.purchase_id, l.line_no) < floor(l.quantity)
                       and not exists (select 1 from stk_matches m where m.purchase_id = l.purchase_id and m.line_no = l.line_no)));
end;
$$;

-- One tool and its whole history (newest first).
create or replace function tl_tool(p_tool uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_reader();
begin
  if not exists (select 1 from tl_tools t where t.id = p_tool and t.owner_id = v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return tl_tool_json(p_tool) || jsonb_build_object(
    'records', (select coalesce(jsonb_agg(tl_record_json(r.id) order by r.recorded_at desc, r.id desc), '[]'::jsonb)
                  from tl_records r where r.tool_id = p_tool));
end;
$$;

-- What the forms pick from: tool items, people (everyone active in the
-- company — T1 = C — the crew with their teams) and the company's projects.
create or replace function tl_choices() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_reader();
begin
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object('item_id', c.id, 'name', c.name, 'spec', c.spec, 'unit', c.unit)
                                        order by lower(c.name), lower(c.spec)), '[]'::jsonb)
                from pr_catalog_items c where c.owner_id = v_owner and c.active and c.kind = 'tool'),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', tl_person_name(p.id), 'role', p.role,
                 'teams', (select coalesce(jsonb_agg(tm.name order by lower(tm.name)), '[]'::jsonb)
                             from pr_team_members m join pr_teams tm on tm.id = m.team_id
                            where m.worker_id = p.id and m.removed_at is null and tm.active))
                 order by lower(tl_person_name(p.id))), '[]'::jsonb)
                 from profiles p
                where p.role in ('worker', 'teamLeader', 'staff', 'owner') and coalesce(p.status, 'active') = 'active'
                  and coalesce(p.owner_id, p.id) = v_owner),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('folder_id', f.id, 'name', tl_folder_name(f.id),
                   'main', f.parent_folder_id is null,
                   'completed', f.completed_at is not null or par.completed_at is not null)
                   order by coalesce(par.name, f.name), f.parent_folder_id is not null, f.name), '[]'::jsonb)
                   from folders f left join folders par on par.id = f.parent_folder_id
                  where f.owner_id = v_owner));
end;
$$;

-- Open TOOL request lines of a project with something still to fill, for an
-- issue's "Fills request".
create or replace function tl_request_lines(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_reader();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'line_id', l.id, 'description', l.description, 'spec', l.spec, 'unit', l.unit,
            'catalog_item_id', l.catalog_item_id, 'requester_name', pr_person_name(r.requester_id),
            'still_to_buy', (select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0)
                               from pr_line_portions p where p.line_id = l.id),
            'bought', pr_line_purchased(l.id))
          order by r.received_at, l.position), '[]'::jsonb)
            from pr_lines l join pr_requests r on r.id = l.request_id
           where l.owner_id = v_owner and r.work_folder_id = p_folder and l.kind = 'tool'
             and l.status = 'open' and r.status = 'submitted');
end;
$$;

-- Tools still out on a project and its Additional Works jobs (Q20), for
-- Project Control's "Mark as Complete". Empty while tools are off.
create or replace function tl_project_out(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := data_owner_id();
begin
  if not stk_can_record() or not tl_on(v_owner) then
    return '[]'::jsonb;
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('label', tl_label(t.number), 'item_name', c.name,
                                                       'holder_name', tl_person_name(t.holder_id),
                                                       'folder_name', tl_folder_name(t.folder_id), 'days', tl_days(t.since))
                                    order by t.number), '[]'::jsonb)
            from tl_tools t join pr_catalog_items c on c.id = t.item_id
           where t.owner_id = v_owner and t.state = 'issued'
             and t.folder_id in (select f.id from folders f where f.owner_id = v_owner
                                   and (f.id = p_folder or f.parent_folder_id = p_folder)));
end;
$$;

-- The tools issued for request lines, for the shopping list (Q14): per line,
-- each tool issued for it ("counted": it filled the line on its own; not
-- counted: it was bought for the line and counts through its purchase), how
-- much tools filled, and per weekly portion. Buyers and office accounts;
-- empty while tools are off.
create or replace function tl_line_tools(p_lines uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := data_owner_id();
begin
  if auth.uid() is null or not (stk_can_record() or pur_buyer()) or not tl_on(v_owner) then
    return '{}'::jsonb;
  end if;
  return (select coalesce(jsonb_object_agg(x.line_id, jsonb_build_object(
            'tools', x.tools,
            'filled', pr_line_from_tools(x.line_id),
            'portions', (select coalesce(jsonb_object_agg(p.portion_id, p.q), '{}'::jsonb)
                           from (select c.portion_id, sum(c.quantity) as q
                                   from tl_covers c join tl_records cr on cr.id = c.record_id
                                  where c.request_line_id = x.line_id and c.portion_id is not null
                                    and cr.status = 'done' and cr.reversed_at is null
                                  group by c.portion_id) p))), '{}'::jsonb) from (
            select r.request_line_id as line_id,
                   jsonb_agg(jsonb_build_object('label', tl_label(t.number), 'holder_name', tl_person_name(r.holder_id),
                                                'counted', exists (select 1 from tl_covers c where c.record_id = r.id))
                             order by t.number) as tools
              from tl_records r join tl_tools t on t.id = r.tool_id
             where r.owner_id = v_owner and r.kind = 'issue' and r.status = 'done' and r.reversed_at is null
               and r.request_line_id = any (p_lines)
             group by r.request_line_id) x);
end;
$$;

-- 0104's Stock screen, its Receiving list without TOOL lines (Q6: they are
-- registered under Tools, never received as stock). Otherwise unchanged.
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
                    and not tl_tool_line(l)
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

-- ════ 8. Who may call what ═══════════════════════════════════════════

-- The operations and readers (each refuses the wrong caller itself).
revoke all on function tl_status() from public, anon;
grant execute on function tl_status() to authenticated;
revoke all on function tl_set_enabled(boolean) from public, anon;
grant execute on function tl_set_enabled(boolean) to authenticated;
revoke all on function tl_register(uuid, jsonb) from public, anon;
grant execute on function tl_register(uuid, jsonb) to authenticated;
revoke all on function tl_issue(uuid, jsonb) from public, anon;
grant execute on function tl_issue(uuid, jsonb) to authenticated;
revoke all on function tl_handover(uuid, jsonb) from public, anon;
grant execute on function tl_handover(uuid, jsonb) to authenticated;
revoke all on function tl_return(uuid, jsonb) from public, anon;
grant execute on function tl_return(uuid, jsonb) to authenticated;
revoke all on function tl_repaired(uuid, uuid, text) from public, anon;
grant execute on function tl_repaired(uuid, uuid, text) to authenticated;
revoke all on function tl_report_lost(uuid, uuid, text) from public, anon;
grant execute on function tl_report_lost(uuid, uuid, text) to authenticated;
revoke all on function tl_request_retire(uuid, uuid, text) from public, anon;
grant execute on function tl_request_retire(uuid, uuid, text) to authenticated;
revoke all on function tl_found(uuid, jsonb) from public, anon;
grant execute on function tl_found(uuid, jsonb) to authenticated;
revoke all on function tl_decide(uuid, uuid, boolean, text) from public, anon;
grant execute on function tl_decide(uuid, uuid, boolean, text) to authenticated;
revoke all on function tl_reverse(uuid, uuid, text) from public, anon;
grant execute on function tl_reverse(uuid, uuid, text) to authenticated;
revoke all on function tl_overview() from public, anon;
grant execute on function tl_overview() to authenticated;
revoke all on function tl_tool(uuid) from public, anon;
grant execute on function tl_tool(uuid) to authenticated;
revoke all on function tl_choices() from public, anon;
grant execute on function tl_choices() to authenticated;
revoke all on function tl_request_lines(uuid) from public, anon;
grant execute on function tl_request_lines(uuid) to authenticated;
revoke all on function tl_project_out(uuid) from public, anon;
grant execute on function tl_project_out(uuid) to authenticated;
revoke all on function tl_line_tools(uuid[]) from public, anon;
grant execute on function tl_line_tools(uuid[]) to authenticated;
-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function stk_overview() from public, anon;
grant execute on function stk_overview() to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function tl_history_immutable() from public, anon, authenticated;
revoke all on function tl_on(uuid) from public, anon, authenticated;
revoke all on function tl_actor() from public, anon, authenticated;
revoke all on function tl_reader() from public, anon, authenticated;
revoke all on function tl_tool_lock(uuid, uuid) from public, anon, authenticated;
revoke all on function tl_person(uuid, uuid) from public, anon, authenticated;
revoke all on function tl_person_name(uuid) from public, anon, authenticated;
revoke all on function tl_project(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function tl_condition(text, boolean) from public, anon, authenticated;
revoke all on function tl_photo(uuid, text) from public, anon, authenticated;
revoke all on function tl_snap(tl_tools) from public, anon, authenticated;
revoke all on function tl_apply(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function tl_latest(uuid) from public, anon, authenticated;
revoke all on function tl_write(uuid, tl_tools, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function tl_tool_line(purchase_lines) from public, anon, authenticated;
revoke all on function tl_line_registered(uuid, int) from public, anon, authenticated;
revoke all on function pr_portion_from_tools(uuid) from public, anon, authenticated;
revoke all on function pr_line_from_tools(uuid) from public, anon, authenticated;
revoke all on function pr_portion_bought(uuid) from public, anon, authenticated;
revoke all on function pr_line_bought(uuid) from public, anon, authenticated;
revoke all on function tl_bought_for(tl_tools, uuid, uuid) from public, anon, authenticated;
revoke all on function tl_cover(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function tl_request_line(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function tl_no_tool_stock() from public, anon, authenticated;
revoke all on function tl_guard_line() from public, anon, authenticated;
revoke all on function tl_guard_void() from public, anon, authenticated;
revoke all on function tl_label(int) from public, anon, authenticated;
revoke all on function tl_folder_name(uuid) from public, anon, authenticated;
revoke all on function tl_days(timestamptz) from public, anon, authenticated;
revoke all on function tl_tool_json(uuid) from public, anon, authenticated;
revoke all on function tl_record_json(uuid) from public, anon, authenticated;
revoke all on function pr_item_in_use(uuid) from public, anon, authenticated;
