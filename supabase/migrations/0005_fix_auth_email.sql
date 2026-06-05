-- ════════════════════════════════════════════════════════════════════
-- SECURITY FIX: auth_email() returned '' for unauthenticated requests,
-- which matched rows whose client_email was also '' (unassigned folders/
-- BOQs/budgets) — leaking them to the anon key. Return NULL instead of ''
-- so "no email" matches no row. Fixes folders / folder_budgets /
-- project_budgets / boq_documents (and all other email-based client reads).
-- ════════════════════════════════════════════════════════════════════
create or replace function auth_email()
returns text language sql stable as $$
  select lower(nullif(auth.jwt() ->> 'email', ''))
$$;

-- Defense-in-depth: also ignore empty client_email in the client-read policies.
drop policy if exists folders_client_read on folders;
create policy folders_client_read on folders for select
  using (client_email is not null and client_email <> '' and lower(client_email) = auth_email());

drop policy if exists boq_client_read on boq_documents;
create policy boq_client_read on boq_documents for select
  using (client_email is not null and client_email <> '' and lower(client_email) = auth_email());
