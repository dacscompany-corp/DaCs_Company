-- ════════════════════════════════════════════════════════════════════
-- 0021_agreement_events.sql
--
-- APPEND-ONLY audit log for every terms/agreement acceptance across all
-- portals (employee, design-services client, construction client, partner,
-- per-project terms). The profiles.*/partner_agreements records remain the
-- fast "has accepted?" flags the gates read; THIS table is the evidence:
-- one immutable row per signing event with the signer, the exact document
-- (frozen PDF snapshot URL + SHA-256, or the full text), signature, IP and
-- user agent.
--
-- Immutability: RLS grants INSERT (self) and SELECT only — no UPDATE/DELETE
-- policies exist — and a guard trigger raises on UPDATE/DELETE for EVERYONE,
-- including service_role (triggers fire even where RLS is bypassed). If a
-- row must ever legitimately be removed, drop the trigger consciously first.
-- ════════════════════════════════════════════════════════════════════

create table if not exists agreement_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete set null,
  email               text,
  audience            text,   -- employee | client | construction_client | partner
  doc_type            text,   -- employee_terms | client_portal_terms | cost_plus_agreement | partnership_agreement | project_terms
  doc_title           text,
  project_id          uuid references construction_projects(id) on delete set null,
  signature           text,   -- typed name
  signature_image_url text,   -- drawn signature PNG (uploads bucket)
  pdf_snapshot_url    text,   -- frozen copy of the exact PDF shown (signed-terms/…)
  pdf_snapshot_name   text,
  doc_sha256          text,   -- SHA-256 of the snapshotted PDF, or of doc_text
  doc_text            text,   -- full text for hardcoded/text-mode documents
  ip                  text,
  user_agent          text,
  accepted_at         timestamptz default now()
);
create index if not exists agreement_events_user_idx    on agreement_events(user_id);
create index if not exists agreement_events_project_idx on agreement_events(project_id);

alter table agreement_events enable row level security;

-- Signers append their own events; owner/staff can read everything; signers
-- can read their own history. Nobody gets UPDATE or DELETE.
drop policy if exists agr_events_insert_self on agreement_events;
create policy agr_events_insert_self on agreement_events for insert
  with check (user_id = auth.uid());
drop policy if exists agr_events_admin_read on agreement_events;
create policy agr_events_admin_read on agreement_events for select
  using (is_owner() or is_staff());
drop policy if exists agr_events_self_read on agreement_events;
create policy agr_events_self_read on agreement_events for select
  using (user_id = auth.uid());

-- Belt and suspenders: block UPDATE/DELETE at the trigger level too, so even
-- service_role (which bypasses RLS) cannot silently rewrite history.
create or replace function agreement_events_guard()
returns trigger language plpgsql as $$
begin
  raise exception 'agreement_events is append-only';
end $$;
drop trigger if exists agreement_events_no_update on agreement_events;
create trigger agreement_events_no_update
  before update or delete on agreement_events
  for each row execute function agreement_events_guard();

notify pgrst, 'reload schema';
