-- 0087 — WorkMate Requests: name office accounts "Office", not "Worker".
--
-- ── WHY. pr_person_name (0085) falls back to 'Worker' for anyone with no
--    display name and no worker number. The owner and staff accounts have
--    neither, so Dacs Web → Requests history read "Worker — Office changed
--    the quantity…" for every office action (found in the 1a-3 phone test,
--    2026-10-06). Office roles now fall back to 'Office'. A display name,
--    when set, still wins; workers and team leaders are unchanged.
--
-- ── SAFE. CREATE OR REPLACE keeps the function's grants (execute stays
--    with postgres/service_role; it is only called inside the 0085/0086
--    security-definer RPCs). No table, policy or data changes.

create or replace function pr_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.display_name), ''),
                  case when p.worker_no is null then null else 'W-' || lpad(p.worker_no::text, 4, '0') end,
                  case when p.role in ('owner', 'staff') then 'Office' else 'Worker' end)
    from profiles p where p.id = p_id
$$;

-- Check (read-only): the owner account now reads 'Office'.
-- select pr_person_name(id), role from profiles where role in ('owner', 'staff');
