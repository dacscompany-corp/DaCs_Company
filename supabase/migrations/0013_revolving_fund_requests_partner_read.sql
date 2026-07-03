-- 0013_revolving_fund_requests_partner_read.sql
-- The partner Weekly Summary now surfaces each week's revolving fund + the
-- difference vs site spend. Migration 0010 made revolving_fund_requests
-- admin-only; this adds SELECT for the project's own account (the partner/client
-- logs in as the project's client_email), mirroring weekly_bills and the other
-- construction subtables. Admin owner/staff keep full access from 0010.
-- Reads only — no insert/update/delete for the partner; the admin still owns the data.

drop policy if exists rf_requests_client_read on revolving_fund_requests;
create policy rf_requests_client_read on revolving_fund_requests for select
  using (cproj_client_can_read(project_id));
