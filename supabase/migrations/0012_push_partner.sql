-- 0012_push_partner.sql
-- Extend push_subscriptions so the PARTNER/CLIENT portal can also opt into the
-- nightly project summary (separate audience + which portal page to open).

alter table push_subscriptions add column if not exists audience text default 'admin';  -- admin | partner
alter table push_subscriptions add column if not exists page     text;                  -- portal page to open on click

-- Let any logged-in user manage THEIR OWN subscription rows (covers partners/
-- clients). Admins remain covered by the existing owner/staff policy.
drop policy if exists push_subs_self on push_subscriptions;
create policy push_subs_self on push_subscriptions for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
