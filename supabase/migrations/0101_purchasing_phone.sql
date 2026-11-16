-- 0101 — WorkMate Stage 2A-3a: what phone purchasing needs from the server.
--
-- Spec: docs/superpowers/specs/2026-09-30-workmate-mobile-purchasing-design.md;
-- answers: docs/superpowers/specs/2026-10-20-workmate-stage2a3-questions.md
-- (Q1–Q22 = A; Q23, the Terms screen for buyers, is pending for 2A-3b);
-- roadmap and rulings R1–R8:
-- docs/superpowers/plans/2026-10-20-workmate-stage2a3-roadmap.md;
-- plan: docs/superpowers/plans/2026-10-20-workmate-stage2a3a-server-web.md.
--
-- ── 1. Signing a buyer in (Q1, R1, R3). The attendance-signin Edge Function
--    runs as the service role, where pur_buyer() (which reads auth.uid())
--    cannot be asked. pur_signin_can_buy(user) gives it the very same answer
--    for a given account: pur_can_buy in that account's own company, the
--    company worked out exactly as data_owner_id() does. Service role only.
--
-- ── 2. An Additional Works job with no billing period (Q19, R4). 0096
--    refused such a purchase (AW_NO_PERIOD); Dacs Web avoided it by creating
--    one hidden period in the browser first, which the phone cannot do.
--    pur_fund now creates that ONE period itself — a projects row with
--    funding_type 'downpayment' and the purchase's month and year, as the
--    web's staff path does: no budget row, no allocation snapshot (an
--    allocation is never back-filled with defaults). The cost is the same as
--    before: an AW job is charged in full to its own period, never Cover.
--    Every purchase write already holds the job's 'pur_folder:' lock
--    (pur_lock), and pur_fund takes it again (a no-op when held), so two
--    purchases at once still create one period. pur_fund becomes VOLATILE;
--    only pur_charge_rows calls it.
--
-- ── 3. "No receipt" (Q8, R5). purchases.no_receipt_reason. A PHONE purchase
--    (source 'workmate') needs a receipt photo or a reason: refused
--    NO_RECEIPT on insert and on any update that would leave it with
--    neither. The web form keeps receipts optional. pur_insert is redefined
--    only to store the reason (≤ 300 characters, BAD_REASON).
--
-- ── 4. What the phone reads. pur_my_purchases(days): what the caller bought
--    or recorded, every status, newest first (Q12). pur_destinations(): open
--    projects with their open Additional Works jobs, for the record form
--    (Q11). pur_purchases / pur_purchase show no_receipt_reason; both lists
--    share one row builder, pur_list_doc.
--
-- ── 5. "Waiting for the owner" in Project Control (Q16). Staff without the
--    Buyer switch read no purchase rows (0097, R3), and a change request is
--    keyed by purchase while a Project Control row knows only its purchase
--    LINE. pur_my_pending_changes() returns the caller's own pending change
--    requests with the ids of their purchase's lines and charges — ids,
--    kind, reason and time only, no amounts — so the row can say so and
--    offer Withdraw (0097's pur_withdraw_change).
--
-- Money: Spent is computed exactly as in 0096/0097. Nothing here writes an
-- expense row except through the unchanged pur_charge_rows.

-- ════ 1. Signing a buyer in ═══════════════════════════════════════════

create or replace function pur_signin_can_buy(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select pur_can_buy(p.id, case when p.role = 'staff' then coalesce(p.owner_id, p.id) else p.id end)
      from profiles p where p.id = p_user), false)
$$;

-- ════ 2. The Additional Works period ══════════════════════════════════

create or replace function pur_fund(p_owner uuid, p_folder uuid, p_date date, p_amount numeric)
returns table (period_id uuid, amount numeric, cover boolean, review boolean)
language plpgsql volatile security definer set search_path = public as $$
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
    -- The same key pur_lock takes for this project (already held by every
    -- purchase write): two purchases at once still make ONE period.
    perform pg_advisory_xact_lock(hashtextextended('pur_folder:' || p_folder::text, 0));
    select p.id into v_cover
      from projects p
     where p.folder_id = p_folder and p.owner_id = p_owner
     order by (pur_month_no(p.month) = extract(month from p_date)::int and p.year = extract(year from p_date)::int) desc nulls last,
              p.year desc nulls last, pur_month_no(p.month) desc nulls last, p.billing_number desc nulls last, p.created_at desc, p.id
     limit 1;
    if v_cover is null then
      -- 0101 (Q19): the job's one hidden period, as Dacs Web's staff path makes it.
      insert into projects (owner_id, folder_id, month, year, funding_type)
      values (p_owner, p_folder,
              (array['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                     'September', 'October', 'November', 'December'])[extract(month from p_date)::int],
              extract(year from p_date)::int, 'downpayment')
      returning id into v_cover;
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

-- ════ 3. No receipt ═══════════════════════════════════════════════════

alter table purchases add column if not exists no_receipt_reason text not null default '';
alter table purchases drop constraint if exists purchases_no_receipt_reason_check;
alter table purchases add constraint purchases_no_receipt_reason_check check (char_length(no_receipt_reason) <= 300);

-- A phone purchase keeps a receipt photo (an https link in docs) or says why
-- there is none.
create or replace function pur_require_receipt() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.source = 'workmate'
     and btrim(coalesce(new.no_receipt_reason, '')) = ''
     and not exists (select 1 from jsonb_each_text(case when jsonb_typeof(new.docs) = 'object' then new.docs else '{}'::jsonb end) d(k, v)
                      where v ~ '^https://') then
    raise exception 'NO_RECEIPT' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists purchases_require_receipt on purchases;
create trigger purchases_require_receipt
  before insert or update of docs, no_receipt_reason, source on purchases
  for each row execute function pur_require_receipt();

-- 0097's pur_insert, plus the "No receipt" reason (the only change).
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
  if char_length(btrim(coalesce(p_body ->> 'no_receipt_reason', ''))) > 300 then
    raise exception 'BAD_REASON' using errcode = 'P0001';
  end if;
  insert into purchases (owner_id, source, purchase_date, date_time, supplier, receipt_total, notes, payment_method, docs,
                         recorded_by, bought_by, supplier_id, no_receipt_reason)
  values (p_owner, coalesce(p_body ->> 'source', 'expenses_form'), (p_body ->> 'purchase_date')::date,
          coalesce(nullif(p_body ->> 'date_time', ''), p_body ->> 'purchase_date'),
          coalesce(nullif(btrim(coalesce(p_body ->> 'supplier', '')), ''),
                   (select s.name || case when s.branch <> '' then ' · ' || s.branch else '' end from suppliers s where s.id = v_supplier), ''),
          pur_money(p_body ->> 'receipt_total'), btrim(coalesce(p_body ->> 'notes', '')),
          btrim(coalesce(p_body ->> 'payment_method', '')),
          coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_body -> 'docs', '{}'::jsonb)) d(k, v)
                     where k in ('po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url')
                       and jsonb_typeof(v) = 'string'), '{}'::jsonb),
          p_actor, pur_bought_by(p_owner, p_body, p_current_buyer), v_supplier,
          btrim(coalesce(p_body ->> 'no_receipt_reason', '')))
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

-- ════ 4. What the phone reads ═════════════════════════════════════════

-- One row of a purchases list (0097's pur_purchases row, plus the
-- "No receipt" reason and the purchase that replaced a voided one).
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
           'replaced_by', pu.replaced_by)
    from purchases pu where pu.id = p_purchase
$$;

-- 0097's purchases list, built from pur_list_doc (same filters, same limit).
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
            from (select pu.purchase_date, pu.created_at, pur_list_doc(pu.id) as doc
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

-- My purchases (Q12): what the caller bought or recorded in the last p_days
-- days (Philippine date), every status, newest first, at most 300.
create or replace function pur_my_purchases(p_days int default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
  v_uid uuid := auth.uid();
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'BAD_DAYS' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select coalesce(jsonb_agg(x.doc order by x.purchase_date desc, x.created_at desc), '[]'::jsonb)
            from (select pu.purchase_date, pu.created_at, pur_list_doc(pu.id) as doc
                    from purchases pu
                   where pu.owner_id = v_owner
                     and (pu.recorded_by = v_uid or pu.bought_by = v_uid)
                     and pu.purchase_date >= (now() at time zone 'Asia/Manila')::date - p_days
                   order by pu.purchase_date desc, pu.created_at desc
                   limit 300) x);
end;
$$;

-- Where a phone purchase may go (Q11): the company's open projects, each
-- with its open Additional Works jobs. The warehouse needs no row.
create or replace function pur_destinations() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not pur_buyer() then
    raise exception 'BUYER_REQUIRED' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'folder_id', f.id, 'name', f.name,
            'works', (select coalesce(jsonb_agg(jsonb_build_object('folder_id', c.id, 'name', c.name) order by lower(c.name), c.id), '[]'::jsonb)
                        from folders c
                       where c.parent_folder_id = f.id and c.owner_id = v_owner and c.completed_at is null
                         and coalesce(btrim(c.name), '') <> ''))
          order by lower(f.name), f.id), '[]'::jsonb)
            from folders f
           where f.owner_id = v_owner and f.parent_folder_id is null and f.completed_at is null
             and coalesce(btrim(f.name), '') <> '');
end;
$$;

-- The caller's own pending change requests, with their purchase's line and
-- charge ids (Q16). Any account that may record (0096's rule), buyer or not.
create or replace function pur_my_pending_changes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', r.id, 'purchase_id', r.purchase_id, 'kind', r.kind, 'reason', r.reason, 'requested_at', r.requested_at,
            'line_ids', (select coalesce(jsonb_agg(l.id order by l.line_no), '[]'::jsonb) from purchase_lines l where l.purchase_id = r.purchase_id),
            'charge_ids', (select coalesce(jsonb_agg(c.id order by c.charge_no), '[]'::jsonb) from purchase_charges c where c.purchase_id = r.purchase_id))
          order by r.requested_at desc), '[]'::jsonb)
            from purchase_change_requests r
           where r.owner_id = v_owner and r.requested_by = auth.uid() and r.status = 'pending');
end;
$$;

-- 0097's one-purchase view, plus the "No receipt" reason.
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

-- ════ 5. Who may call what ════════════════════════════════════════════

-- The sign-in function only (service role). Never a signed-in user: it
-- answers for ANY account id.
revoke all on function pur_signin_can_buy(uuid) from public, anon, authenticated;
grant execute on function pur_signin_can_buy(uuid) to service_role;

-- Internal helpers: only the SECURITY DEFINER operations call them.
-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function pur_fund(uuid, uuid, date, numeric) from public, anon, authenticated;
revoke all on function pur_require_receipt() from public, anon, authenticated;
revoke all on function pur_insert(uuid, uuid, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function pur_list_doc(uuid) from public, anon, authenticated;
revoke all on function pur_purchase_view(uuid) from public, anon, authenticated;

-- Readers for buyers (each refuses BUYER_REQUIRED itself).
revoke all on function pur_purchases(date, date, uuid, text) from public, anon;
grant execute on function pur_purchases(date, date, uuid, text) to authenticated;
revoke all on function pur_my_purchases(int) from public, anon;
grant execute on function pur_my_purchases(int) to authenticated;
revoke all on function pur_destinations() from public, anon;
grant execute on function pur_destinations() to authenticated;
-- Project Control's "Waiting for the owner" (refuses NOT_OFFICE / NOT_ALLOWED itself).
revoke all on function pur_my_pending_changes() from public, anon;
grant execute on function pur_my_pending_changes() to authenticated;
