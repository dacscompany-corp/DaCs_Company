-- 0018_project_partner_email.sql
-- A construction project previously linked only ONE person (client_email), so
-- the "client" and the "partner" of a project were forced to be the same
-- account. This adds a separate partner link: the Dacs Partnership portal now
-- loads projects by partner_email (falling back to client_email for legacy
-- setups), while the Client Management portal keeps using client_email — so a
-- real client and a real partner can each have their own account, portal,
-- signed agreement, and liability on the same project.

alter table construction_projects
  add column if not exists partner_email text;

create index if not exists construction_projects_partner_email_idx
  on construction_projects(partner_email);
