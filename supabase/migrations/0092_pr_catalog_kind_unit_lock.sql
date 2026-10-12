-- 0092 — A catalogue item's Kind and Unit are fixed once requests use it.
--
-- ── WHY. Request lines, history and (from Stage 2) stock and purchases count
--    an item in its unit and treat it by its kind. Turning a used "pc"
--    item into "box", or a material into a tool, would silently change what
--    every past quantity means. Required before Stage 2 (spec: unified
--    worker app §stages; memory "before Stage 2" note).
--
-- ── WHAT. pr_office_save_item refuses a Kind or Unit change with
--    ITEM_IN_USE when any request line is matched to the item (cancelled
--    lines count too — they are history). Name, size/spec, category, brand,
--    other names and Active stay editable for corrections. To change Kind or
--    Unit, the office adds a new item and deactivates the old one.
--    pr_office_catalog gains `in_use` so Dacs Web can lock the two fields
--    before Save. Both functions are 0090's copied unchanged; the only
--    differences are ADDED lines (tests/workmate-history.test.js checks).
--    When Stage 2 adds stock/purchase tables, extend the in-use test here.
--
-- ── No table, no data, no permission change. No money.

set local lock_timeout = '5s';

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
      select kind, unit into v_kind, v_unit from pr_catalog_items where id = p_item for update;
      if (p_kind <> v_kind or btrim(p_unit) <> v_unit)
         and exists (select 1 from pr_lines l where l.catalog_item_id = p_item) then
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

create or replace function pr_office_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
           'brand', c.brand, 'aliases', to_jsonb(c.aliases),
           'in_use', exists (select 1 from pr_lines l where l.catalog_item_id = c.id),
           'category', c.category, 'active', c.active)
         order by c.active desc, c.kind, lower(c.name), lower(c.spec)), '[]'::jsonb)
    from pr_catalog_items c
   where pr_is_office() and c.owner_id = data_owner_id()
$$;

revoke all on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) from public, anon;
grant execute on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) to authenticated;
