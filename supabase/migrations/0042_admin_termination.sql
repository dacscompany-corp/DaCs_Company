-- ════════════════════════════════════════════════════════════════════
-- 0042 — Admin-only project closeout (complete / terminate)
-- --------------------------------------------------------------------
-- Two changes, one intent: the CLIENT no longer opens a termination.
-- Only the owner decides how a project ends — and there are two ways it
-- can end, so `outcome` records which one:
--
--   completed  — the good ending. Work finished; settle what's owed.
--   terminated — cut short. Work stopped early; settle what was consumed.
--
-- The money is the SAME arithmetic either way, because this is a
-- cost-plus system: the client owes actual direct costs + the management
-- fee, and construction_projects.budget is an estimate, not a price.
-- Only the meaning, the project status and the client's wording differ.
--
-- 1) Missing columns. termination_requests has been written with
--    project_name / decided_at / decided_by / rejected_reason since day
--    one, and construction_projects with terminated_at / terminated_by /
--    termination_request_id — none of which were ever created in 0001.
--    The shim maps camelCase straight to snake_case, so every approval
--    was failing on the missing column. Added here.
--
-- 2) RLS. The client INSERT policy is dropped: a client can no longer
--    create a termination row at all. The client SELECT policy stays —
--    they must still be able to see the record of their own terminated
--    project and the final invoice it produced.
-- ════════════════════════════════════════════════════════════════════

alter table termination_requests
  add column if not exists project_name    text,
  add column if not exists decided_at      timestamptz,
  add column if not exists decided_by      text,
  add column if not exists rejected_reason text,
  -- Direct cost as the Overview KPI computes it (labor + materials + site
  -- overhead). Stored so the record's breakdown still adds up later: site
  -- overhead lives inside directCostTotal and is not in labor or materials.
  add column if not exists direct_cost     numeric,
  -- 'admin' for closeouts raised in the portal; existing rows stay
  -- 'client' so historical requests keep reading correctly.
  add column if not exists initiated_by    text default 'client',
  -- 'completed' | 'terminated'. Defaults to 'terminated' so every
  -- pre-existing row keeps its original meaning.
  add column if not exists outcome         text default 'terminated';

alter table construction_projects
  add column if not exists terminated_at          timestamptz,
  add column if not exists terminated_by          text,
  add column if not exists termination_request_id uuid;

-- The final invoice raised by invGenerateFromTermination stamps both of
-- these. created_by is written by every invoice path and exists in the live
-- DB as drift; termination_request_id has never landed, because the approve
-- step above it always failed first. `if not exists` covers both cases.
alter table invoices
  add column if not exists created_by             text,
  add column if not exists termination_request_id uuid;

-- Clients may no longer raise a termination. Owner/staff insert is
-- already covered by the existing `termination_admin` FOR ALL policy.
drop policy if exists termination_client_create on termination_requests;
