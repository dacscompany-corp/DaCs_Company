-- 0090 — WorkMate Stage 1b-1: Find Previous Item — the server.
--
-- ── WHAT. Workers search items the company requested before and see a
--    dated, labelled history with reviewed product photos; "Request this
--    item again" starts a normal request that remembers the entry it came
--    from. The office switches history on per project, adds historical
--    references by hand, and reviews photos into a separate gallery.
--    Spec: docs/superpowers/specs/2026-10-09-workmate-stage1b-item-history-design.md.
--
-- ── WHO SEES WHAT. One function, pr_history_entries(), decides per ENTRY:
--    a worker sees a request line matched to a catalogue item when it is
--    their own, or when its project has "Allow item history" on; and a
--    non-retired historical reference on such a project. Additional Works
--    follow their parent project. Every worker read, the gallery storage
--    rule and the Request Again check go through it — nothing else decides.
--
-- ── WORKERS NEVER TOUCH TABLES. No policy grants a worker anything; every
--    worker read is a SECURITY DEFINER RPC. Workers never get requester
--    names, line notes, raw request photos or retired items.
--
-- ── NO MONEY. Nothing here holds or returns a price, amount or cost. A
--    historical reference creates no expense, purchase, stock or payment.
--    Outside the money model: nothing here feeds Spent / Earned / Profit.
--
-- ── RE-DECLARED. pr_submit_request (0085) and pr_request_doc,
--    pr_office_catalog, pr_office_projects (0086) are copied unchanged and
--    only GAIN lines; pr_office_save_item gains two optional arguments
--    (the old 7-argument call still works). App 0.4.0 keeps working.

set local lock_timeout = '5s';

-- ════ §1 New columns ═══════════════════════════════════════════════════

-- "Allow item history": separate from "Allow requests" on purpose (spec §3).
-- Off by default; stays on after the project is completed.
alter table pr_project_settings add column if not exists allow_history boolean not null default false;

-- Search aids for workers' own words. Not part of the item's identity.
alter table pr_catalog_items add column if not exists aliases text[] not null default '{}';
alter table pr_catalog_items add column if not exists brand text not null default '';

-- Request Again: the history entry a new line came from (a pr_lines id or a
-- pr_item_refs id — no foreign key, the entry may later be retired).
alter table pr_lines add column if not exists ref_kind text;
alter table pr_lines add column if not exists ref_id uuid;
alter table pr_lines drop constraint if exists pr_lines_ref_pair;
alter table pr_lines add constraint pr_lines_ref_pair check ((ref_kind is null) = (ref_id is null)
  and (ref_kind is null or ref_kind in ('request_line', 'reference')));

-- A private request photo the office has reviewed for the gallery: a copy
-- was published, or it was kept private. Either way it leaves the queue.
alter table pr_photos add column if not exists gallery_review text;
alter table pr_photos add column if not exists gallery_reviewed_by uuid references profiles(id);
alter table pr_photos add column if not exists gallery_reviewed_at timestamptz;
alter table pr_photos drop constraint if exists pr_photos_gallery_review_kind;
alter table pr_photos add constraint pr_photos_gallery_review_kind
  check (gallery_review is null or gallery_review in ('published', 'kept_private'));
alter table pr_photos drop constraint if exists pr_photos_gallery_review_pair;
alter table pr_photos add constraint pr_photos_gallery_review_pair
  check ((gallery_review is null) = (gallery_reviewed_at is null) and (gallery_reviewed_at is null) = (gallery_reviewed_by is null));

-- ════ §2 Historical references and gallery photos ═════════════════════

-- Staff-entered: "this item was used on project Y around date Z". Creates
-- no expense, stock or purchase. Retired, never deleted. Deleting the
-- project itself removes its references with it.
create table if not exists pr_item_refs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  catalog_item_id uuid not null references pr_catalog_items(id),
  folder_id uuid not null references folders(id) on delete cascade,
  work_folder_id uuid not null references folders(id) on delete cascade,
  description text not null check (btrim(description) <> ''),
  ref_date date,
  date_precision text not null check (date_precision in ('exact', 'approximate', 'unknown')),
  source_note text not null default '',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  retired_by uuid references profiles(id),
  retired_at timestamptz,
  retire_reason text,
  check ((date_precision = 'unknown') = (ref_date is null)),
  check ((retired_at is null) = (retired_by is null)),
  check (retired_at is null or btrim(coalesce(retire_reason, '')) <> '')
);
create index if not exists pr_item_refs_item on pr_item_refs (catalog_item_id);
-- History lookups by item (pr_history_entries) scan pr_lines by catalogue item.
create index if not exists pr_lines_catalog_item on pr_lines (catalog_item_id) where catalog_item_id is not null;
alter table pr_item_refs enable row level security;

-- Reviewed product photos (bucket item-gallery). Never a raw request photo:
-- publishing makes a separate COPY. Several per item, one cover. Retired,
-- never deleted.
create table if not exists pr_gallery_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  catalog_item_id uuid not null references pr_catalog_items(id),
  storage_path text not null unique,
  source text not null check (source in ('upload', 'request_photo', 'reference')),
  source_photo_id uuid references pr_photos(id),
  source_ref_id uuid references pr_item_refs(id) on delete set null,
  is_cover boolean not null default false,
  cover_set_by uuid references profiles(id),
  cover_set_at timestamptz,
  status text not null default 'approved' check (status in ('approved', 'retired')),
  checklist_confirmed boolean not null check (checklist_confirmed),
  approved_by uuid not null references profiles(id),
  approved_at timestamptz not null default now(),
  retired_by uuid references profiles(id),
  retired_at timestamptz,
  retire_reason text,
  check ((status = 'retired') = (retired_at is not null)),
  check ((retired_at is null) = (retired_by is null)),
  check (status = 'approved' or not is_cover),
  check (source <> 'request_photo' or source_photo_id is not null),
  check (status <> 'retired' or btrim(coalesce(retire_reason, '')) <> '')
);
create unique index if not exists pr_gallery_one_cover on pr_gallery_photos (catalog_item_id) where is_cover and status = 'approved';
create index if not exists pr_gallery_item on pr_gallery_photos (catalog_item_id);
alter table pr_gallery_photos enable row level security;

-- The office reads; every change goes through an office RPC (§5).
drop policy if exists pr_item_refs_office_read on pr_item_refs;
create policy pr_item_refs_office_read on pr_item_refs for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_gallery_photos_office_read on pr_gallery_photos;
create policy pr_gallery_photos_office_read on pr_gallery_photos for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));

revoke all on pr_item_refs from anon;
revoke all on pr_gallery_photos from anon;
revoke insert, update, delete, truncate, references, trigger on pr_item_refs from authenticated;
revoke insert, update, delete, truncate, references, trigger on pr_gallery_photos from authenticated;

-- ════ §3 Who may see history ══════════════════════════════════════════

-- "Allow item history" is on for this top-level project of this company.
create or replace function pr_history_open(p_folder uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pr_project_settings s join folders f on f.id = s.folder_id
     where s.folder_id = p_folder and s.allow_history
       and f.owner_id = p_owner and f.parent_folder_id is null)
$$;

-- Every history entry the viewer may see, one row per entry. THE rule.
-- p_office: the office sees everything of its company (retired flagged);
-- otherwise a line counts when it is the viewer's own or its project has
-- history on, and a reference when it is not retired and its project has
-- history on. Only lines matched to a catalogue item are history.
-- Requested quantity = what is still needed; none for a cancelled line.
create or replace function pr_history_entries(p_owner uuid, p_viewer uuid, p_office boolean, p_item uuid)
returns table (catalog_item_id uuid, entry_kind text, entry_id uuid, folder_id uuid, work_folder_id uuid,
               at_date date, date_precision text, cancelled boolean, retired boolean, quantity numeric,
               unit text, description text, note text, requester_id uuid, sort_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.catalog_item_id, 'request_line'::text, l.id, r.folder_id, r.work_folder_id,
         (r.received_at at time zone 'Asia/Manila')::date, 'exact'::text,
         (l.status = 'cancelled' or r.status = 'cancelled'), false,
         case when l.status = 'cancelled' or r.status = 'cancelled' then null::numeric
              else (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id) end,
         l.unit, null::text, null::text,
         case when p_office then r.requester_id end,
         r.received_at
    from pr_lines l
    join pr_requests r on r.id = l.request_id
   where l.catalog_item_id is not null
     and r.owner_id = p_owner
     and (p_item is null or l.catalog_item_id = p_item)
     and (p_office or r.requester_id = p_viewer or pr_history_open(r.folder_id, p_owner))
  union all
  select ir.catalog_item_id, 'reference'::text, ir.id, ir.folder_id, ir.work_folder_id,
         ir.ref_date, ir.date_precision,
         false, ir.retired_at is not null, null::numeric,
         null::text, ir.description, ir.source_note, null::uuid,
         coalesce((ir.ref_date::timestamp at time zone 'Asia/Manila'), ir.created_at)
    from pr_item_refs ir
   where ir.owner_id = p_owner
     and (p_item is null or ir.catalog_item_id = p_item)
     and (p_office or (ir.retired_at is null and pr_history_open(ir.folder_id, p_owner)))
$$;

create or replace function pr_entry_label(p_kind text, p_cancelled boolean) returns text
language sql immutable security definer set search_path = public as $$
  select case when p_kind = 'reference' then 'Historical reference'
              when p_cancelled then 'Requested — cancelled'
              else 'Requested' end
$$;

-- Gallery files: private bucket, <owner_id>/<catalog_item_id>/<uuid>.jpg.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-gallery', 'item-gallery', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A worker may read an APPROVED photo of an item with at least one entry
-- they may see. Retired photos and unrecorded uploads are never readable.
create or replace function pr_can_read_gallery_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select pr_is_requester() and exists (
    select 1 from pr_gallery_photos g
     where g.storage_path = p_name and g.status = 'approved'
       and g.owner_id = attendance_data_owner()
       and exists (select 1 from pr_history_entries(g.owner_id, auth.uid(), false, g.catalog_item_id)))
$$;

-- Owner/staff, under their own company's folder, for one of its own items.
create or replace function pr_office_gallery_path_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_owner() or is_staff(), false)
     and (storage.foldername(p_name))[1] = data_owner_id()::text
     and exists (select 1 from pr_catalog_items c
                  where c.id::text = (storage.foldername(p_name))[2] and c.owner_id = data_owner_id())
$$;

drop policy if exists "item-gallery: office uploads" on storage.objects;
create policy "item-gallery: office uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-gallery' and pr_office_gallery_path_ok(name));

drop policy if exists "item-gallery: office reads" on storage.objects;
create policy "item-gallery: office reads" on storage.objects for select to authenticated
  using (bucket_id = 'item-gallery' and pr_office_gallery_path_ok(name));

drop policy if exists "item-gallery: workers read approved" on storage.objects;
create policy "item-gallery: workers read approved" on storage.objects for select to authenticated
  using (bucket_id = 'item-gallery' and pr_can_read_gallery_path(name));

revoke all on function pr_history_open(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_history_entries(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function pr_entry_label(text, boolean) from public, anon, authenticated;
revoke all on function pr_can_read_gallery_path(text) from public, anon;
grant execute on function pr_can_read_gallery_path(text) to authenticated;
revoke all on function pr_office_gallery_path_ok(text) from public, anon;
grant execute on function pr_office_gallery_path_ok(text) to authenticated;

-- ════ §4 What a worker reads ══════════════════════════════════════════

-- One page of item cards. Workers: items with at least one visible entry.
-- Office: also items with no history yet (to seed them), unless a project
-- or date filter is set. "latest" is the newest entry the caller may see
-- inside the filters; retired references never count.
create or replace function pr_history_search_doc(p_owner uuid, p_viewer uuid, p_office boolean, p_query text, p_kind text,
                                                 p_category text, p_folder uuid, p_from date, p_to date,
                                                 p_limit int, p_offset int) returns jsonb
language sql stable security definer set search_path = public as $$
  with q as (
    select '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           btrim(coalesce(p_query, '')) = '' as everything,
           least(greatest(coalesce(p_limit, 30), 1), 50) as lim,
           greatest(coalesce(p_offset, 0), 0) as off
  ), e as (
    select v.catalog_item_id, v.entry_kind, v.entry_id, v.folder_id, v.work_folder_id,
           v.at_date, v.date_precision, v.cancelled, v.sort_at
      from pr_history_entries(p_owner, p_viewer, p_office, null) v
     where not v.retired
       and (p_folder is null or v.folder_id = p_folder)
       and (p_from is null or v.at_date >= p_from)
       and (p_to is null or v.at_date <= p_to)
  ), latest as (
    select distinct on (e.catalog_item_id) e.*
      from e
     order by e.catalog_item_id, e.sort_at desc, e.entry_id
  ), hits as (
    select c.id, c.kind, c.name, c.spec, c.unit, c.category, c.brand, c.aliases, c.active,
           lt.entry_kind, lt.entry_id, lt.folder_id, lt.work_folder_id, lt.at_date, lt.date_precision,
           lt.cancelled, lt.sort_at, pf.name as project_name,
           case when lt.work_folder_id = lt.folder_id then 'Main Contract' else wf.name end as work_name
      from pr_catalog_items c
      cross join q
      left join latest lt on lt.catalog_item_id = c.id
      left join folders pf on pf.id = lt.folder_id
      left join folders wf on wf.id = lt.work_folder_id
     where c.owner_id = p_owner
       and ((p_office and p_folder is null and p_from is null and p_to is null) or lt.catalog_item_id is not null)
       and (p_kind is null or c.kind = p_kind)
       and (p_category is null or lower(c.category) = lower(btrim(p_category)))
       and (q.everything or c.name ilike q.pat or c.spec ilike q.pat or c.brand ilike q.pat or c.category ilike q.pat
            or exists (select 1 from unnest(c.aliases) a where a ilike q.pat))
  ), page as (
    select h.*, row_number() over (order by h.sort_at desc nulls last, lower(h.name), h.id) as rn
      from hits h
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'kind', p.kind, 'name', p.name, 'spec', p.spec, 'unit', p.unit,
               'category', p.category, 'brand', p.brand, 'aliases', to_jsonb(p.aliases), 'active', p.active,
               'cover_path', (select g.storage_path from pr_gallery_photos g
                               where g.catalog_item_id = p.id and g.status = 'approved'
                               order by g.is_cover desc, g.approved_at desc, g.id
                               limit 1),
               'latest', case when p.entry_id is null then null else jsonb_build_object(
                           'entry_kind', p.entry_kind, 'entry_id', p.entry_id,
                           'label', pr_entry_label(p.entry_kind, p.cancelled),
                           'project_id', p.folder_id, 'project_name', p.project_name,
                           'work_id', p.work_folder_id, 'work_name', p.work_name,
                           'date', p.at_date, 'date_precision', p.date_precision) end)
             order by p.rn)
        from page p, q
       where p.rn > q.off and p.rn <= q.off + q.lim), '[]'::jsonb),
    'has_more', exists (select 1 from page p, q where p.rn > q.off + q.lim))
$$;

-- One item: photos (cover first) and its history, newest first, at most
-- 200 entries. Workers: approved photos only; never requester names.
-- Office: retired photos and references too, with who and why.
create or replace function pr_history_item_doc(p_owner uuid, p_viewer uuid, p_office boolean, p_item uuid, p_folder uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit, 'category', c.category,
    'brand', c.brand, 'aliases', to_jsonb(c.aliases), 'active', c.active,
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'path', g.storage_path, 'is_cover', g.is_cover, 'status', g.status,
               'source', case when p_office then g.source end,
               'approved_at', case when p_office then g.approved_at end,
               'approved_by_name', case when p_office then pr_person_name(g.approved_by) end,
               'retired_at', case when p_office then g.retired_at end,
               'retire_reason', case when p_office then g.retire_reason end)
             order by (g.status = 'approved') desc, g.is_cover desc, g.approved_at desc, g.id)
        from pr_gallery_photos g
       where g.catalog_item_id = c.id and (p_office or g.status = 'approved')), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entry_kind', e.entry_kind, 'entry_id', e.entry_id,
               'label', pr_entry_label(e.entry_kind, e.cancelled),
               'project_id', e.folder_id, 'project_name', pf.name,
               'work_id', e.work_folder_id,
               'work_name', case when e.work_folder_id = e.folder_id then 'Main Contract' else wf.name end,
               'date', e.at_date, 'date_precision', e.date_precision,
               'quantity', e.quantity, 'unit', e.unit,
               'description', e.description, 'note', e.note,
               'retired', e.retired,
               'requester_name', case when p_office and e.requester_id is not null then pr_person_name(e.requester_id) end)
             order by e.sort_at desc, e.entry_id)
        from (select v.* from pr_history_entries(p_owner, p_viewer, p_office, p_item) v
               where p_folder is null or v.folder_id = p_folder
               order by v.sort_at desc, v.entry_id
               limit 200) e
        join folders pf on pf.id = e.folder_id
        join folders wf on wf.id = e.work_folder_id), '[]'::jsonb))
  from pr_catalog_items c
  where c.id = p_item and c.owner_id = p_owner
$$;

create or replace function pr_history_search(p_query text default '', p_kind text default null, p_category text default null,
                                             p_folder uuid default null, p_from date default null, p_to date default null,
                                             p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  return pr_history_search_doc(attendance_data_owner(), auth.uid(), false, p_query, p_kind, p_category,
                               p_folder, p_from, p_to, p_limit, p_offset);
end;
$$;

create or replace function pr_history_item(p_item uuid, p_folder uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_doc jsonb;
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pr_history_entries(attendance_data_owner(), auth.uid(), false, p_item)) then
    raise exception 'HISTORY_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  v_doc := pr_history_item_doc(attendance_data_owner(), auth.uid(), false, p_item, p_folder);
  if v_doc is null then
    raise exception 'HISTORY_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  return v_doc;
end;
$$;

-- The phone sends the items it has saved; the answer lists, for each one
-- still visible, the entries and approved photos it may keep. Everything
-- else saved on the phone is deleted (spec §4.4: per entry, not per item).
create or replace function pr_history_visible(p_items uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_items), 0) > 500 then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', i.id,
             'entries', (select jsonb_agg(v.entry_kind || ':' || v.entry_id order by v.entry_kind, v.entry_id)
                           from pr_history_entries(attendance_data_owner(), auth.uid(), false, i.id) v),
             'photo_ids', coalesce((select jsonb_agg(g.id order by g.id) from pr_gallery_photos g
                                     where g.catalog_item_id = i.id and g.status = 'approved'), '[]'::jsonb))
           order by i.id), '[]'::jsonb)
      from (select distinct u.id from unnest(coalesce(p_items, '{}'::uuid[])) as u(id)) i
     where exists (select 1 from pr_history_entries(attendance_data_owner(), auth.uid(), false, i.id)));
end;
$$;

revoke all on function pr_history_search_doc(uuid, uuid, boolean, text, text, text, uuid, date, date, integer, integer) from public, anon, authenticated;
revoke all on function pr_history_item_doc(uuid, uuid, boolean, uuid, uuid) from public, anon, authenticated;
revoke all on function pr_history_search(text, text, text, uuid, date, date, integer, integer) from public, anon;
grant execute on function pr_history_search(text, text, text, uuid, date, date, integer, integer) to authenticated;
revoke all on function pr_history_item(uuid, uuid) from public, anon;
grant execute on function pr_history_item(uuid, uuid) to authenticated;
revoke all on function pr_history_visible(uuid[]) from public, anon;
grant execute on function pr_history_visible(uuid[]) to authenticated;

-- ════ §5 The office ═══════════════════════════════════════════════════

-- Aliases: trimmed, blanks dropped, one per spelling (case-insensitive).
create or replace function pr_clean_aliases(p_aliases text[]) returns text[]
language sql immutable security definer set search_path = public as $$
  select coalesce(array_agg(d.a order by lower(d.a)), '{}'::text[])
    from (select distinct on (lower(btrim(x))) btrim(x) as a
            from unnest(coalesce(p_aliases, '{}'::text[])) as x
           where btrim(coalesce(x, '')) <> ''
           order by lower(btrim(x)), btrim(x)) d
$$;

-- 0086's catalogue save, with two OPTIONAL search aids. Null leaves them
-- unchanged, so the 7-argument call Dacs Web makes today keeps working.
drop function if exists pr_office_save_item(uuid, text, text, text, text, text, boolean);
create or replace function pr_office_save_item(p_item uuid, p_kind text, p_name text, p_spec text, p_unit text,
                                               p_category text, p_active boolean,
                                               p_aliases text[] default null, p_brand text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
  v_aliases text[] := case when p_aliases is null then null else pr_clean_aliases(p_aliases) end;
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

-- "Allow item history" per top-level project. Never touches Allow requests.
create or replace function pr_office_set_allow_history(p_folder uuid, p_allow boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from folders where id = p_folder and parent_folder_id is null;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into pr_project_settings (folder_id, owner_id, allow_history, updated_by, updated_at)
  values (p_folder, v_owner, coalesce(p_allow, false), auth.uid(), now())
  on conflict (folder_id) do update
    set allow_history = excluded.allow_history, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('folder_id', p_folder, 'allow_history', coalesce(p_allow, false));
end;
$$;

create or replace function pr_office_history_search(p_query text default '', p_kind text default null, p_category text default null,
                                                    p_folder uuid default null, p_from date default null, p_to date default null,
                                                    p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  return pr_history_search_doc(data_owner_id(), auth.uid(), true, p_query, p_kind, p_category,
                               p_folder, p_from, p_to, p_limit, p_offset);
end;
$$;

create or replace function pr_office_history_item(p_item uuid, p_folder uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_catalog_items where id = p_item;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return pr_history_item_doc(v_owner, auth.uid(), true, p_item, p_folder);
end;
$$;

-- A hand-entered historical reference. The work is the project itself
-- (Main Contract) or one of its OWN Additional Works; completed is fine —
-- history outlives the job. Creates no expense, stock or purchase.
create or replace function pr_office_add_ref(p_item uuid, p_folder uuid, p_work uuid, p_description text,
                                             p_ref_date date, p_precision text, p_source_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
  v_work uuid := coalesce(p_work, p_folder);
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_catalog_items where id = p_item;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from folders f where f.id = p_folder and f.owner_id = v_owner and f.parent_folder_id is null)
     or not (v_work = p_folder
             or exists (select 1 from folders c where c.id = v_work and c.parent_folder_id = p_folder)) then
    raise exception 'BAD_DESTINATION' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_description, '')) = '' or p_precision is null
     or p_precision not in ('exact', 'approximate', 'unknown')
     or (p_precision = 'unknown') <> (p_ref_date is null) then
    raise exception 'BAD_REFERENCE' using errcode = 'P0001';
  end if;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date,
                            date_precision, source_note, created_by)
  values (v_owner, p_item, p_folder, v_work, btrim(p_description), p_ref_date, p_precision,
          btrim(coalesce(p_source_note, '')), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function pr_office_retire_ref(p_ref uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select ir.id, ir.owner_id, ir.retired_at into r from pr_item_refs ir where ir.id = p_ref for update;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.retired_at is null then
    update pr_item_refs set retired_at = now(), retired_by = auth.uid(), retire_reason = btrim(p_reason) where id = p_ref;
  end if;
  return jsonb_build_object('id', p_ref, 'retired', true);
end;
$$;

-- Private request photos waiting for review: on a line matched to a
-- catalogue item, not yet published or kept private. Newest first, 200.
create or replace function pr_office_photo_queue() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.doc order by x.created_at desc), '[]'::jsonb)
    from (
      select ph.created_at, jsonb_build_object(
               'photo_id', ph.id, 'path', ph.storage_path, 'created_at', ph.created_at,
               'request_id', r.id, 'line_id', l.id, 'line_description', l.description,
               'project_name', f.name,
               'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
               'requester_name', pr_person_name(r.requester_id),
               'item', jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit)) as doc
        from pr_photos ph
        join pr_lines l on l.id = ph.line_id
        join pr_requests r on r.id = ph.request_id
        join pr_catalog_items c on c.id = l.catalog_item_id
        join folders f on f.id = r.folder_id
        join folders w on w.id = r.work_folder_id
       where pr_is_office() and ph.owner_id = data_owner_id() and ph.gallery_review is null
       order by ph.created_at desc
       limit 200) x
$$;

-- The file must already be in item-gallery, under this company and item,
-- with a uuid name, and not be in the gallery yet.
create or replace function pr_gallery_check_path(p_owner uuid, p_item uuid, p_path text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_path is null or p_path !~ ('^' || p_owner::text || '/' || p_item::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'BAD_PATH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'item-gallery' and o.name = p_path) then
    raise exception 'FILE_MISSING' using errcode = 'P0001';
  end if;
  if exists (select 1 from pr_gallery_photos g where g.storage_path = p_path) then
    raise exception 'ALREADY_IN_GALLERY' using errcode = 'P0001';
  end if;
end;
$$;

-- p_photo given: it becomes the only cover. Null: keep the current cover,
-- or promote the newest approved photo when the item has none.
-- Callers hold the pr_catalog_items row lock. The cover records who made it
-- the cover and when (spec §4.2: every office change records who and when).
create or replace function pr_gallery_ensure_cover(p_item uuid, p_photo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_photo is not null then
    update pr_gallery_photos set is_cover = false where catalog_item_id = p_item and is_cover and id <> p_photo;
    update pr_gallery_photos set is_cover = true, cover_set_by = auth.uid(), cover_set_at = now()
     where id = p_photo and status = 'approved';
  elsif not exists (select 1 from pr_gallery_photos g
                     where g.catalog_item_id = p_item and g.is_cover and g.status = 'approved') then
    update pr_gallery_photos set is_cover = true, cover_set_by = auth.uid(), cover_set_at = now()
     where id = (select g.id from pr_gallery_photos g
                  where g.catalog_item_id = p_item and g.status = 'approved'
                  order by g.approved_at desc, g.id desc
                  limit 1);
  end if;
end;
$$;

-- Publish a reviewed COPY of a private request photo. Dacs Web uploads the
-- copy to item-gallery first, then calls this. The original stays private.
create or replace function pr_office_publish_photo(p_photo uuid, p_path text, p_checklist boolean,
                                                   p_make_cover boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if not coalesce(p_checklist, false) then
    raise exception 'CHECKLIST_REQUIRED' using errcode = 'P0001';
  end if;
  select ph.id, ph.owner_id, ph.gallery_review, l.catalog_item_id into r
    from pr_photos ph left join pr_lines l on l.id = ph.line_id
   where ph.id = p_photo
     for update of ph;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.gallery_review is not null then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;
  if r.catalog_item_id is null then
    raise exception 'NOT_MATCHED' using errcode = 'P0001';
  end if;
  perform 1 from pr_catalog_items where id = r.catalog_item_id for no key update;
  perform pr_gallery_check_path(r.owner_id, r.catalog_item_id, p_path);
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, source_photo_id,
                                 checklist_confirmed, approved_by)
  values (r.owner_id, r.catalog_item_id, p_path, 'request_photo', p_photo, true, auth.uid())
  returning id into v_id;
  update pr_photos set gallery_review = 'published', gallery_reviewed_by = auth.uid(), gallery_reviewed_at = now()
   where id = p_photo;
  perform pr_gallery_ensure_cover(r.catalog_item_id, case when coalesce(p_make_cover, false) then v_id end);
  return jsonb_build_object('id', v_id, 'is_cover', (select g.is_cover from pr_gallery_photos g where g.id = v_id));
end;
$$;

create or replace function pr_office_keep_private(p_photo uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select ph.id, ph.owner_id, ph.gallery_review into r from pr_photos ph where ph.id = p_photo for update;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.gallery_review is null then
    update pr_photos set gallery_review = 'kept_private', gallery_reviewed_by = auth.uid(), gallery_reviewed_at = now()
     where id = p_photo;
  end if;
  return jsonb_build_object('photo_id', p_photo,
                            'gallery_review', (select ph.gallery_review from pr_photos ph where ph.id = p_photo));
end;
$$;

-- A photo staff took or found themselves (optionally for one of the item's
-- historical references). Uploaded to item-gallery first, then recorded.
create or replace function pr_office_add_gallery_photo(p_item uuid, p_path text, p_checklist boolean,
                                                       p_make_cover boolean default false, p_ref uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if not coalesce(p_checklist, false) then
    raise exception 'CHECKLIST_REQUIRED' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_catalog_items where id = p_item;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_ref is not null and not exists (
       select 1 from pr_item_refs ir where ir.id = p_ref and ir.catalog_item_id = p_item and ir.retired_at is null) then
    raise exception 'BAD_REFERENCE' using errcode = 'P0001';
  end if;
  perform 1 from pr_catalog_items where id = p_item for no key update;
  perform pr_gallery_check_path(v_owner, p_item, p_path);
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, source_ref_id,
                                 checklist_confirmed, approved_by)
  values (v_owner, p_item, p_path, case when p_ref is null then 'upload' else 'reference' end, p_ref, true, auth.uid())
  returning id into v_id;
  perform pr_gallery_ensure_cover(p_item, case when coalesce(p_make_cover, false) then v_id end);
  return jsonb_build_object('id', v_id, 'is_cover', (select g.is_cover from pr_gallery_photos g where g.id = v_id));
end;
$$;

create or replace function pr_office_set_cover(p_photo uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_status text;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select g.id, g.owner_id, g.catalog_item_id, g.status into r from pr_gallery_photos g where g.id = p_photo;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform 1 from pr_catalog_items where id = r.catalog_item_id for no key update;
  -- Every cover change holds the item lock, so the status read here is stable.
  select g.status into v_status from pr_gallery_photos g where g.id = p_photo;
  if v_status <> 'approved' then
    raise exception 'PHOTO_RETIRED' using errcode = 'P0001';
  end if;
  perform pr_gallery_ensure_cover(r.catalog_item_id, p_photo);
  return jsonb_build_object('id', p_photo, 'is_cover', true);
end;
$$;

-- Retired, never deleted: workers stop seeing it on their next refresh; the
-- office keeps it, greyed, with who and why. A retired cover hands the
-- cover to the newest remaining approved photo.
create or replace function pr_office_retire_photo(p_photo uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_status text;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select g.id, g.owner_id, g.catalog_item_id, g.status into r from pr_gallery_photos g where g.id = p_photo;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  perform 1 from pr_catalog_items where id = r.catalog_item_id for no key update;
  -- Re-read under the lock: a concurrent retire must not overwrite who/when/why.
  select g.status into v_status from pr_gallery_photos g where g.id = p_photo;
  if v_status = 'approved' then
    update pr_gallery_photos
       set status = 'retired', is_cover = false, retired_at = now(), retired_by = auth.uid(), retire_reason = btrim(p_reason)
     where id = p_photo;
    perform pr_gallery_ensure_cover(r.catalog_item_id, null);
  end if;
  return jsonb_build_object('id', p_photo, 'status', 'retired');
end;
$$;

revoke all on function pr_clean_aliases(text[]) from public, anon, authenticated;
revoke all on function pr_gallery_check_path(uuid, uuid, text) from public, anon, authenticated;
revoke all on function pr_gallery_ensure_cover(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) from public, anon;
grant execute on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) to authenticated;
revoke all on function pr_office_set_allow_history(uuid, boolean) from public, anon;
grant execute on function pr_office_set_allow_history(uuid, boolean) to authenticated;
revoke all on function pr_office_history_search(text, text, text, uuid, date, date, integer, integer) from public, anon;
grant execute on function pr_office_history_search(text, text, text, uuid, date, date, integer, integer) to authenticated;
revoke all on function pr_office_history_item(uuid, uuid) from public, anon;
grant execute on function pr_office_history_item(uuid, uuid) to authenticated;
revoke all on function pr_office_add_ref(uuid, uuid, uuid, text, date, text, text) from public, anon;
grant execute on function pr_office_add_ref(uuid, uuid, uuid, text, date, text, text) to authenticated;
revoke all on function pr_office_retire_ref(uuid, text) from public, anon;
grant execute on function pr_office_retire_ref(uuid, text) to authenticated;
revoke all on function pr_office_photo_queue() from public, anon;
grant execute on function pr_office_photo_queue() to authenticated;
revoke all on function pr_office_publish_photo(uuid, text, boolean, boolean) from public, anon;
grant execute on function pr_office_publish_photo(uuid, text, boolean, boolean) to authenticated;
revoke all on function pr_office_keep_private(uuid) from public, anon;
grant execute on function pr_office_keep_private(uuid) to authenticated;
revoke all on function pr_office_add_gallery_photo(uuid, text, boolean, boolean, uuid) from public, anon;
grant execute on function pr_office_add_gallery_photo(uuid, text, boolean, boolean, uuid) to authenticated;
revoke all on function pr_office_set_cover(uuid) from public, anon;
grant execute on function pr_office_set_cover(uuid) to authenticated;
revoke all on function pr_office_retire_photo(uuid, text) from public, anon;
grant execute on function pr_office_retire_photo(uuid, text) to authenticated;

-- ════ §6 Request Again: the link on a request line ═════════════════════

-- The office's readable name for a line's source entry.
create or replace function pr_ref_label(p_kind text, p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p_kind is null then null else coalesce(case
    when p_kind = 'request_line' then (
      select f.name || ' · ' || case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end
             || ' · ' || to_char(r.received_at at time zone 'Asia/Manila', 'FMMon FMDD, YYYY') || ' · Requested'
        from pr_lines l
        join pr_requests r on r.id = l.request_id
        join folders f on f.id = r.folder_id
        join folders w on w.id = r.work_folder_id
       where l.id = p_id)
    when p_kind = 'reference' then (
      select f.name || ' · ' || case when ir.work_folder_id = ir.folder_id then 'Main Contract' else w.name end
             || ' · ' || case ir.date_precision
                           when 'unknown' then 'Date unknown'
                           when 'approximate' then 'around ' || to_char(ir.ref_date, 'FMMon YYYY')
                           else to_char(ir.ref_date, 'FMMon FMDD, YYYY') end
             || ' · Historical reference'
        from pr_item_refs ir
        join folders f on f.id = ir.folder_id
        join folders w on w.id = ir.work_folder_id
       where ir.id = p_id)
  end, 'Source no longer available') end
$$;

-- The four functions below are 0085/0086 copied unchanged; the only
-- differences are ADDED lines (tests/workmate-history.test.js checks).

create or replace function pr_submit_request(p_op uuid, p_request jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_prev jsonb;
  v_owner uuid;
  v_folder uuid;
  v_work uuid;
  v_team uuid;
  v_batch uuid;
  v_req uuid;
  v_line jsonb;
  v_line_id uuid;
  v_pos int := 0;
  v_kind text;
  v_qty numeric;
  v_urgent boolean;
  v_item uuid;
  v_member uuid;
  v_needed_by date;
  v_drafted timestamptz;
  v_ref_kind text;
  v_ref_id uuid;
  v_result jsonb;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_request is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('pr_op:' || v_uid::text || ':' || p_op::text));
  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  v_owner := attendance_data_owner();

  begin
    v_folder := (p_request ->> 'folder_id')::uuid;
    v_work := coalesce(nullif(p_request ->> 'work_id', '')::uuid, v_folder);
  exception when invalid_text_representation then
    raise exception 'DESTINATION_CLOSED' using errcode = 'P0001';
  end;
  if v_folder is null or not pr_work_open(v_folder, v_work) then
    raise exception 'DESTINATION_CLOSED' using errcode = 'P0001';
  end if;

  begin
    v_team := nullif(p_request ->> 'team_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'NOT_IN_TEAM' using errcode = 'P0001';
  end;
  if v_team is not null and not (
       pr_is_current_member(v_team, v_uid)
       and exists (select 1 from pr_teams t where t.id = v_team and t.owner_id = v_owner)) then
    raise exception 'NOT_IN_TEAM' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_request -> 'lines') is distinct from 'array' or jsonb_array_length(p_request -> 'lines') = 0 then
    raise exception 'NO_LINES' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_request -> 'lines') > 100 then
    raise exception 'TOO_MANY_LINES' using errcode = 'P0001';
  end if;

  begin
    v_drafted := nullif(p_request ->> 'drafted_at', '')::timestamptz;
  exception when others then
    v_drafted := null;  -- the phone's draft time is information only; never fail a request on it
  end;

  v_batch := pr_batch_for(v_owner, v_now);

  insert into pr_requests (owner_id, requester_id, team_id, folder_id, work_folder_id, client_op_id, drafted_at, received_at, note)
  values (v_owner, v_uid, v_team, v_folder, v_work, p_op, v_drafted, v_now, coalesce(p_request ->> 'note', ''))
  returning id into v_req;

  for v_line in select value from jsonb_array_elements(p_request -> 'lines') loop
    v_kind := v_line ->> 'kind';
    if v_kind is null or v_kind not in ('material', 'tool')
       or coalesce(btrim(v_line ->> 'description'), '') = ''
       or coalesce(btrim(v_line ->> 'unit'), '') = '' then
      raise exception 'BAD_LINE' using errcode = 'P0001';
    end if;

    begin
      v_qty := (v_line ->> 'quantity')::numeric;
    exception when others then
      v_qty := null;
    end;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 or v_qty <> round(v_qty, 3) then
      raise exception 'BAD_QUANTITY' using errcode = 'P0001';
    end if;

    begin
      v_urgent := coalesce((v_line ->> 'urgent')::boolean, false);
      v_needed_by := nullif(v_line ->> 'needed_by', '')::date;
      v_item := nullif(v_line ->> 'catalog_item_id', '')::uuid;
      v_member := case when v_kind = 'material' then nullif(v_line ->> 'intended_member_id', '')::uuid end;
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'BAD_LINE' using errcode = 'P0001';
    end;

    if v_urgent and (coalesce(btrim(v_line ->> 'urgent_reason'), '') = '' or v_needed_by is null) then
      raise exception 'URGENT_NEEDS_REASON' using errcode = 'P0001';
    end if;
    if v_item is not null and not exists (
         select 1 from pr_catalog_items c
          where c.id = v_item and c.owner_id = v_owner and c.active and c.kind = v_kind) then
      raise exception 'BAD_CATALOG_ITEM' using errcode = 'P0001';
    end if;
    -- Request Again (0090): the line may name the history entry it came
    -- from. A malformed link, or one naming no entry of this company, is a
    -- client bug and refuses the request. A real entry this worker can no
    -- longer see, or one the office has since matched to another item,
    -- only drops the link: an offline draft must never get stuck.
    v_ref_kind := nullif(v_line ->> 'ref_kind', '');
    v_ref_id := null;
    if v_ref_kind is not null or nullif(v_line ->> 'ref_id', '') is not null then
      begin
        v_ref_id := nullif(v_line ->> 'ref_id', '')::uuid;
      exception when invalid_text_representation then
        raise exception 'BAD_REFERENCE' using errcode = 'P0001';
      end;
      if v_ref_kind is null or v_ref_kind not in ('request_line', 'reference') or v_ref_id is null or v_item is null
         or (v_ref_kind = 'request_line' and not exists (
               select 1 from pr_lines x where x.id = v_ref_id and x.owner_id = v_owner))
         or (v_ref_kind = 'reference' and not exists (
               select 1 from pr_item_refs x where x.id = v_ref_id and x.owner_id = v_owner)) then
        raise exception 'BAD_REFERENCE' using errcode = 'P0001';
      end if;
      if not exists (select 1 from pr_history_entries(v_owner, v_uid, false, v_item) e
                      where e.entry_kind = v_ref_kind and e.entry_id = v_ref_id) then
        v_ref_kind := null;
        v_ref_id := null;
      end if;
    end if;
    -- "Optional intended member from the request's team" (spec §4A). Naming
    -- someone other than yourself is acting for the team: leader only.
    if v_member is not null then
      if v_team is null or not pr_is_current_member(v_team, v_member) then
        raise exception 'BAD_MEMBER' using errcode = 'P0001';
      end if;
      if v_member <> v_uid and not pr_is_current_leader(v_team, v_uid) then
        raise exception 'NOT_TEAM_LEADER' using errcode = 'P0001';
      end if;
    end if;

    insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, spec, unit, category,
                          intended_member_id, urgent, urgent_reason, needed_by, notes)
    values (v_owner, v_req, v_pos, v_kind, v_item, btrim(v_line ->> 'description'), coalesce(btrim(v_line ->> 'spec'), ''),
            btrim(v_line ->> 'unit'), coalesce(btrim(v_line ->> 'category'), ''), v_member, v_urgent,
            case when v_urgent then btrim(v_line ->> 'urgent_reason') end, v_needed_by, coalesce(v_line ->> 'notes', ''))
    returning id into v_line_id;
    if v_ref_kind is not null then
      update pr_lines set ref_kind = v_ref_kind, ref_id = v_ref_id where id = v_line_id;
    end if;

    insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line_id, v_batch, v_qty);
    v_pos := v_pos + 1;
  end loop;

  insert into pr_events (owner_id, request_id, actor_id, kind, detail)
  values (v_owner, v_req, v_uid, 'submitted', jsonb_build_object('lines', v_pos, 'batch_id', v_batch));

  select jsonb_build_object(
           'request_id', v_req, 'received_at', v_now, 'batch_id', b.id,
           'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on,
           'line_ids', (select jsonb_agg(l.id order by l.position) from pr_lines l where l.request_id = v_req))
    into v_result
    from pr_batches b where b.id = v_batch;

  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'submit', v_result);
  return v_result;
end;
$$;

create or replace function pr_request_doc(p_request uuid, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'received_at', r.received_at, 'drafted_at', r.drafted_at,
    'note', r.note, 'cancelled_at', r.cancelled_at,
    'requester_id', r.requester_id, 'requester_name', pr_person_name(r.requester_id),
    'project_id', r.folder_id, 'project_name', f.name,
    'work_id', r.work_folder_id,
    'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
    'team_id', r.team_id, 'team_name', t.name,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.id, 'position', l.position, 'kind', l.kind, 'description', l.description,
               'spec', l.spec, 'unit', l.unit, 'category', l.category,
               'catalog_item_id', l.catalog_item_id, 'catalog_name', c.name, 'catalog_spec', c.spec, 'catalog_unit', c.unit,
               'ref_kind', l.ref_kind, 'ref_id', l.ref_id,
               'ref_label', case when l.ref_kind is null then null else pr_ref_label(l.ref_kind, l.ref_id) end,
               'intended_member_id', l.intended_member_id,
               'intended_member_name', case when l.intended_member_id is null then null else pr_person_name(l.intended_member_id) end,
               'urgent', l.urgent, 'urgent_reason', l.urgent_reason, 'needed_by', l.needed_by, 'notes', l.notes,
               'status', l.status, 'version', l.version, 'has_conflict', l.has_conflict,
               'needed', (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id),
               'portions', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', p.id, 'batch_id', p.batch_id, 'quantity', p.quantity,
                          'pending_reduction', p.pending_reduction,
                          'arranged', p.arranged_at is not null, 'arranged_at', p.arranged_at,
                          'arranged_by_name', case when p.arranged_by is null then null else pr_person_name(p.arranged_by) end,
                          'cutoff_at', b.cutoff_at, 'purchase_on', b.purchase_on, 'delivery_on', b.delivery_on)
                        order by b.cutoff_at, p.created_at), '[]'::jsonb)
                   from pr_line_portions p join pr_batches b on b.id = p.batch_id
                  where p.line_id = l.id),
               'open_conflicts', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', k.id, 'proposed_quantity', k.proposed_quantity, 'current_quantity', k.current_quantity,
                          'base_version', k.base_version, 'current_version', k.current_version,
                          'created_at', k.created_at, 'proposed_by_name', pr_person_name(k.proposed_by))
                        order by k.created_at), '[]'::jsonb)
                   from pr_line_conflicts k
                  where k.line_id = l.id and k.resolved_at is null))
             order by l.position), '[]'::jsonb)
        from pr_lines l
        left join pr_catalog_items c on c.id = l.catalog_item_id
       where l.request_id = r.id),
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'line_id', ph.line_id, 'path', ph.storage_path)
                       order by ph.created_at), '[]'::jsonb)
        from pr_photos ph where ph.request_id = r.id),
    'events', case when p_full then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind', e.kind, 'detail', e.detail, 'line_id', e.line_id,
               'actor_name', pr_person_name(e.actor_id), 'created_at', e.created_at)
             order by e.created_at, e.id), '[]'::jsonb)
        from pr_events e where e.request_id = r.id) end)
  from pr_requests r
  join folders f on f.id = r.folder_id
  join folders w on w.id = r.work_folder_id
  left join pr_teams t on t.id = r.team_id
  where r.id = p_request
$$;

create or replace function pr_office_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
           'brand', c.brand, 'aliases', to_jsonb(c.aliases),
           'category', c.category, 'active', c.active)
         order by c.active desc, c.kind, lower(c.name), lower(c.spec)), '[]'::jsonb)
    from pr_catalog_items c
   where pr_is_office() and c.owner_id = data_owner_id()
$$;

create or replace function pr_office_projects() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'folder_id', f.id, 'name', f.name, 'completed', f.completed_at is not null,
           'allow_requests', coalesce(s.allow_requests, false),
           'allow_history', coalesce(s.allow_history, false),
           'hidden_from_time_in', exists (select 1 from attendance_project_config h
                                           where h.project_system = 'pc' and h.folder_id = f.id
                                             and h.owner_id = f.owner_id and not h.attendance_enabled),
           'requestable', pr_project_open(f.id),
           'additional_works', (select count(*) from folders c where c.parent_folder_id = f.id and c.completed_at is null))
         order by (f.completed_at is not null), lower(f.name)), '[]'::jsonb)
    from folders f
    left join pr_project_settings s on s.folder_id = f.id
   where pr_is_office() and f.owner_id = data_owner_id()
     and f.parent_folder_id is null and coalesce(btrim(f.name), '') <> ''
$$;

revoke all on function pr_ref_label(text, uuid) from public, anon, authenticated;
revoke all on function pr_request_doc(uuid, boolean) from public, anon, authenticated;
revoke all on function pr_submit_request(uuid, jsonb) from public, anon;
grant execute on function pr_submit_request(uuid, jsonb) to authenticated;
revoke all on function pr_office_catalog() from public, anon;
grant execute on function pr_office_catalog() to authenticated;
revoke all on function pr_office_projects() from public, anon;
grant execute on function pr_office_projects() to authenticated;
