-- ════════════════════════════════════════════════════════════════════
-- ENFORCE THE PER-PROJECT PARTNER GATE (database-level, partners only)
--
-- A PARTNER account cannot READ a project's data until they have signed that
-- project's terms (a row in partner_agreements). CLIENTS are unaffected.
--
-- HOW IT'S SAFE:
--   • profiles.is_partner defaults FALSE → nothing changes for existing accounts
--     until they're flagged (auto-set on partner-portal login).
--   • These are RESTRICTIVE policies (AND-combined). A restrictive policy can only
--     NARROW access, never grant it — so it cannot accidentally expose data.
--   • The restriction is a no-op for anyone who is NOT a flagged partner
--     (clients, admins, staff): they pass it trivially (the NOT ... short-circuits).
--   • construction_projects itself is NOT gated — the partner must read the project
--     row (name + partner_terms) to see what they're signing. Only its DATA is held.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- 1. Flag column (default false = current behaviour for everyone).
alter table profiles
  add column if not exists is_partner boolean not null default false;

-- 2. Helper: is the CURRENT user a flagged partner?  (named caller_is_partner to
--    avoid any clash with the is_partner COLUMN.)
create or replace function caller_is_partner()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_partner from profiles p where p.id = auth.uid()), false)
$$;

-- 3. Helper: has the current user signed the given project's terms?
create or replace function partner_signed_project(p uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from partner_agreements pa
    where pa.project_id = p
      and (pa.data ->> 'partnerUid') = auth.uid()::text
  )
$$;

-- 4. Restrictive gate on each project DATA subtable. Written out explicitly (no
--    dynamic SQL) so it is unambiguous and easy to audit.

drop policy if exists weekly_bills_partner_gate on weekly_bills;
create policy weekly_bills_partner_gate on weekly_bills as restrictive for all
  using (not caller_is_partner() or partner_signed_project(project_id));

drop policy if exists procurement_items_partner_gate on procurement_items;
create policy procurement_items_partner_gate on procurement_items as restrictive for all
  using (not caller_is_partner() or partner_signed_project(project_id));

drop policy if exists revolving_funds_partner_gate on revolving_funds;
create policy revolving_funds_partner_gate on revolving_funds as restrictive for all
  using (not caller_is_partner() or partner_signed_project(project_id));

drop policy if exists revolving_fund_expenses_partner_gate on revolving_fund_expenses;
create policy revolving_fund_expenses_partner_gate on revolving_fund_expenses as restrictive for all
  using (not caller_is_partner() or partner_signed_project(project_id));

drop policy if exists revolving_fund_replenishments_partner_gate on revolving_fund_replenishments;
create policy revolving_fund_replenishments_partner_gate on revolving_fund_replenishments as restrictive for all
  using (not caller_is_partner() or partner_signed_project(project_id));

drop policy if exists daily_logs_partner_gate on daily_logs;
create policy daily_logs_partner_gate on daily_logs as restrictive for all
  using (not caller_is_partner() or partner_signed_project(project_id));

drop policy if exists milestones_partner_gate on milestones;
create policy milestones_partner_gate on milestones as restrictive for all
  using (not caller_is_partner() or partner_signed_project(project_id));

drop policy if exists accomplishment_reports_partner_gate on accomplishment_reports;
create policy accomplishment_reports_partner_gate on accomplishment_reports as restrictive for all
  using (not caller_is_partner() or partner_signed_project(project_id));

drop policy if exists walkthroughs_partner_gate on walkthroughs;
create policy walkthroughs_partner_gate on walkthroughs as restrictive for all
  using (not caller_is_partner() or partner_signed_project(project_id));

-- 5. partner_agreements itself is intentionally NOT gated here — the partner must
--    read/write it to sign. Its existing policies (0018) govern it unchanged.
