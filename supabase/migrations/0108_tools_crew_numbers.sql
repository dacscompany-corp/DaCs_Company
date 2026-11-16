-- 0108 — WorkMate Stage 3a follow-up TF1: crew names in Tools carry their
-- worker number.
--
-- Plan: docs/superpowers/plans/2026-10-29-workmate-3a-tool-names.md.
--
-- ── WHY. Two active workers share the name "John Tapales" (W-0005 and
--    W-0007), and the Tools screens named a holder by name alone — the
--    responsible-person list, the Out list, a tool's page and history, the
--    shopping list's "Issued:" and Mark as Complete's tools-out note — so the
--    office could not tell them apart (found in the 3a ZZ pilot, 29 Oct).
--    Every one of those names comes from tl_person_name (0107), so this one
--    function changes them all: a worker or team leader with a display name
--    now reads "John Tapales (W-0007)". One with no display name already reads
--    "W-0007" (pr_person_name) and is not doubled; office and owner accounts
--    have no worker number and are unchanged. Requests, Purchasing and Work
--    Plan keep their own names (pr_person_name / pur_person_name, untouched).
--
-- ── SAFE. CREATE OR REPLACE keeps the function's grants (nobody may call it
--    directly; only 0107's security-definer readers do). No table, policy or
--    data changes; no money anywhere.

create or replace function tl_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p.role in ('worker', 'teamLeader')
              then pr_person_name(p.id)
                   || case when nullif(btrim(p.display_name), '') is not null and p.worker_no is not null
                           then ' (W-' || lpad(p.worker_no::text, 4, '0') || ')' else '' end
              else pur_person_name(p.id) end
    from profiles p where p.id = p_id
$$;

revoke all on function tl_person_name(uuid) from public, anon, authenticated;

-- Check (read-only): the crew with their numbers, the office unchanged.
-- select role, tl_person_name(id) from profiles
--  where role in ('worker', 'teamLeader', 'staff', 'owner') and coalesce(status, 'active') = 'active' order by 2;
