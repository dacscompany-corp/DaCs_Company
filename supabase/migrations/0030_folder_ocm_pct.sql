-- ════════════════════════════════════════════════════════════════════
-- 0030_folder_ocm_pct.sql
--
-- OCM ALLOWANCE. Contracts price overhead in (OCM — Overhead, Contingencies
-- & Miscellaneous, typically 8–12% of the contract in a PH BOQ), but the app
-- never compared that allowance against actual overhead spend. This stores
-- what was priced, per project folder; the Overhead drill in Project Control
-- shows "priced ₱X · spent ₱Y (Z% used)" and flags overruns.
--
-- NULL / 0 = no allowance configured (the drill shows a "set allowance"
-- prompt instead of a comparison). Existing folders_rw RLS already covers
-- updates. Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table folders
  add column if not exists ocm_pct numeric;

alter table folders
  drop constraint if exists folders_ocm_pct_chk;

alter table folders
  add constraint folders_ocm_pct_chk
  check (ocm_pct is null or (ocm_pct >= 0 and ocm_pct <= 100));
